//! Writing song details (title, artists, album, track number, cover) into downloaded audio files.
//! Works for every format Grab saves: Opus (Vorbis comments), M4A (MP4 atoms) and MP3 (ID3v2).

use std::{path::Path, time::Duration};

use lofty::{
    config::WriteOptions,
    picture::{MimeType, Picture, PictureType},
    prelude::*,
    tag::Tag,
};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TrackTags {
    pub title: String,
    pub artists: Vec<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    /// Cover image URL (Spotify or YouTube Music image servers only).
    pub cover: Option<String>,
    /// Where the song was imported from (spotify:playlist:ID) and its Spotify id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_track: Option<String>,
}

const COVER_HOSTS: &[&str] = &["i.scdn.co", "mosaic.scdn.co", "i.ytimg.com"];
const COVER_HOST_SUFFIXES: &[&str] = &[".googleusercontent.com", ".spotifycdn.com", ".ggpht.com"];

fn cover_host_allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    !host.contains(['@', ':']) && (COVER_HOSTS.contains(&host) || COVER_HOST_SUFFIXES.iter().any(|s| host.ends_with(s)))
}

impl TrackTags {
    pub fn validate(&self) -> AppResult<()> {
        let too_long = |s: &str| s.len() > 500;
        if self.title.trim().is_empty()
            || too_long(&self.title)
            || self.artists.len() > 30
            || self.artists.iter().any(|a| too_long(a))
            || self.album.as_deref().is_some_and(too_long)
            || self.album_artist.as_deref().is_some_and(too_long)
        {
            return Err(AppError::Invalid("Invalid song details.".into()));
        }
        if self.cover.as_deref().is_some_and(|c| !cover_host_allowed(c)) {
            return Err(AppError::Invalid("Cover images can only come from Spotify or YouTube.".into()));
        }
        Ok(())
    }

    /// yt-dlp output template "Artist, Artist - Title.%(ext)s", safe for Windows file names.
    pub fn file_template(&self) -> String {
        let artists = self.artists.iter().take(3).cloned().collect::<Vec<_>>().join(", ");
        let name = if artists.is_empty() { self.title.clone() } else { format!("{artists} - {}", self.title) };
        format!("{}.%(ext)s", safe_file_name(&name).replace('%', "%%"))
    }
}

/// Replace characters Windows doesn't allow, trim trailing dots/spaces and keep names short.
pub fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let mut s: String = cleaned.chars().take(150).collect();
    while s.ends_with(['.', ' ']) {
        s.pop();
    }
    let s = s.trim_start().to_string();
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"];
    if s.is_empty() || reserved.contains(&s.to_uppercase().as_str()) { format!("_{s}") } else { s }
}

async fn fetch_cover(url: &str) -> AppResult<Vec<u8>> {
    if !cover_host_allowed(url) {
        return Err(AppError::Invalid("cover host not allowed".into()));
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("Grab/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(20))
        .build()?;
    let bytes = client.get(url).send().await?.error_for_status()?.bytes().await?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(AppError::Invalid("cover image too large".into()));
    }
    Ok(bytes.to_vec())
}

fn mime_of(data: &[u8]) -> Option<MimeType> {
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(MimeType::Jpeg)
    } else if data.starts_with(b"\x89PNG") {
        Some(MimeType::Png)
    } else {
        None // WebP etc. aren't supported as covers by most players
    }
}

/// Write tags (and the cover, if it can be fetched) into `path`.
pub async fn apply(path: &Path, tags: &TrackTags) -> AppResult<()> {
    let cover = match &tags.cover {
        Some(url) => match fetch_cover(url).await {
            Ok(c) => Some(c),
            Err(e) => {
                tracing::warn!(%url, error = %e, "couldn't fetch cover art");
                None
            }
        },
        None => None,
    };
    let path = path.to_path_buf();
    let tags = tags.clone();
    tauri::async_runtime::spawn_blocking(move || write(&path, &tags, cover))
        .await
        .map_err(|e| AppError::Invalid(format!("tagging stopped: {e}")))?
}

pub fn write(path: &Path, t: &TrackTags, cover: Option<Vec<u8>>) -> AppResult<()> {
    fn err(e: impl std::fmt::Display) -> AppError {
        AppError::Invalid(format!("Couldn't write song details: {e}"))
    }
    let mut file = lofty::read_from_path(path).map_err(err)?;
    let tag_type = file.primary_tag_type();
    if file.primary_tag_mut().is_none() {
        file.insert_tag(Tag::new(tag_type));
    }
    let tag = file.primary_tag_mut().ok_or_else(|| AppError::Invalid("no tag".into()))?;

    tag.set_title(t.title.clone());
    if !t.artists.is_empty() {
        tag.set_artist(t.artists.join(", "));
    }
    match &t.album {
        Some(a) => tag.set_album(a.clone()),
        None => tag.remove_album(),
    }
    // Groups an album's songs under one artist even when some songs have guests.
    let album_artist = t.album_artist.clone().or_else(|| t.artists.first().cloned());
    if let Some(a) = album_artist {
        tag.insert_text(ItemKey::AlbumArtist, a);
    }
    if let Some(n) = t.track_number {
        tag.set_track(n);
    }
    // yt-dlp's embedded description/URL comments are noise in a music library.
    tag.remove_comment();
    // yt-dlp writes the YouTube upload date as the year, which is wrong for songs (a 2012 album
    // uploaded in 2017). The real year isn't known here, so leave it empty rather than wrong.
    for key in [ItemKey::RecordingDate, ItemKey::Year, ItemKey::ReleaseDate] {
        tag.remove_key(key);
    }

    if let Some(data) = cover
        && let Some(mime) = mime_of(&data)
    {
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(Picture::unchecked(data).pic_type(PictureType::CoverFront).mime_type(mime).build());
    }
    tag.save_to_path(path, WriteOptions::default()).map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_windows_safe() {
        let t = TrackTags { title: "What? / Why: 100%".into(), artists: vec!["AC/DC".into(), "B".into()], ..Default::default() };
        assert_eq!(t.file_template(), "AC_DC, B - What_ _ Why_ 100%%.%(ext)s");
        assert_eq!(safe_file_name("con"), "_con");
        assert_eq!(safe_file_name("name. "), "name");
        assert_eq!(safe_file_name(""), "_");
    }

    #[test]
    fn only_known_cover_hosts() {
        assert!(cover_host_allowed("https://i.scdn.co/image/ab67"));
        assert!(cover_host_allowed("https://lh3.googleusercontent.com/x=w544-h544"));
        assert!(cover_host_allowed("https://image-cdn-ak.spotifycdn.com/image/x"));
        assert!(!cover_host_allowed("http://i.scdn.co/image/ab67"));
        assert!(!cover_host_allowed("https://evil.com/i.scdn.co"));
        assert!(!cover_host_allowed("https://i.scdn.co@evil.com/x"));
        assert!(!cover_host_allowed("https://googleusercontent.com.evil.com/x"));
    }

    #[test]
    fn validation() {
        let mut t = TrackTags { title: "x".into(), ..Default::default() };
        assert!(t.validate().is_ok());
        t.cover = Some("file:///C:/secret".into());
        assert!(t.validate().is_err());
    }
}

/// Tag a real file and read it back: `GRAB_TAG_FILE=<path> cargo test live_tag -- --ignored --nocapture`
#[cfg(test)]
#[tokio::test]
#[ignore]
async fn live_tag() {
    let path = std::path::PathBuf::from(std::env::var("GRAB_TAG_FILE").unwrap());
    let t = TrackTags {
        title: "Global Warming (feat. Sensato)".into(),
        artists: vec!["Pitbull".into(), "Sensato".into()],
        album: Some("Global Warming".into()),
        album_artist: Some("Pitbull".into()),
        track_number: Some(1),
        cover: Some("https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b2732c5b24ecfa39523a75c993c4".into()),
        ..TrackTags::default()
    };
    apply(&path, &t).await.unwrap();
    let file = lofty::read_from_path(&path).unwrap();
    let tag = file.primary_tag().unwrap();
    println!(
        "type={:?} title={:?} artist={:?} album={:?} albumartist={:?} track={:?} pictures={} comment={:?}",
        file.file_type(),
        tag.title(),
        tag.artist(),
        tag.album(),
        tag.get_string(ItemKey::AlbumArtist),
        tag.track(),
        tag.pictures().len(),
        tag.comment()
    );
    assert_eq!(tag.title().as_deref(), Some("Global Warming (feat. Sensato)"));
    assert_eq!(tag.track(), Some(1));
}
