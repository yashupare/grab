//! Reading Spotify songs, albums and playlists.
//!
//! The source is swappable: today it's the public embed page (no sign-in, up to 100 songs);
//! a Web API client can be added as another `Source` once Spotify Premium is set up, without
//! changing anything that uses `fetch`.
//!
//! Only metadata is read (titles, artists, lengths, cover). Spotify's audio is DRM-protected and
//! never touched: songs are downloaded from YouTube Music (see `matcher`).

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LinkKind {
    Track,
    Album,
    Playlist,
}

impl LinkKind {
    pub fn as_str(self) -> &'static str {
        match self {
            LinkKind::Track => "track",
            LinkKind::Album => "album",
            LinkKind::Playlist => "playlist",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    pub kind: LinkKind,
    pub id: String,
}

impl Link {
    /// "spotify:playlist:ID": the key imports and playlists are stored under.
    pub fn uri(&self) -> String {
        format!("spotify:{}:{}", self.kind.as_str(), self.id)
    }
}

/// Accepts open.spotify.com links (with or without `intl-xx/`, query strings) and spotify: URIs.
pub fn parse_link(input: &str) -> Option<Link> {
    let s = input.trim();
    let rest = if let Some(r) = s.strip_prefix("spotify:") {
        r.replacen(':', "/", 1)
    } else {
        let r = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(s);
        let r = r.strip_prefix("open.spotify.com/")?;
        let r = r.split(['?', '#']).next().unwrap_or("");
        match r.split_once('/') {
            Some((first, more)) if first.starts_with("intl-") => more.to_string(),
            _ => r.to_string(),
        }
    };
    let rest = rest.strip_prefix("embed/").unwrap_or(&rest);
    let (kind, id) = rest.split_once('/')?;
    let id = id.split('/').next().unwrap_or("");
    let kind = match kind {
        "track" => LinkKind::Track,
        "album" => LinkKind::Album,
        "playlist" => LinkKind::Playlist,
        _ => return None,
    };
    if id.is_empty() || id.len() > 40 || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    Some(Link { kind, id: id.to_string() })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    /// Spotify track id.
    pub id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub duration_ms: u64,
    pub explicit: bool,
    /// Position in the album or playlist, from 1.
    pub position: u32,
    pub playable: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub kind: LinkKind,
    pub id: String,
    /// spotify:kind:id
    pub uri: String,
    pub url: String,
    pub name: String,
    /// Playlist owner or album artist.
    pub owner: Option<String>,
    pub cover: Option<String>,
    /// Background colour Spotify picked from the cover, "#rrggbb".
    pub tint: Option<String>,
    pub tracks: Vec<Track>,
    /// True when Spotify may have more songs than it shared (the embed stops at 100).
    pub limited: bool,
}

/// Most songs the embed page lists.
pub const EMBED_LIMIT: usize = 100;

pub async fn fetch(link: &Link) -> AppResult<Collection> {
    embed::fetch(link).await
}

mod embed {
    use super::*;

    pub async fn fetch(link: &Link) -> AppResult<Collection> {
        let url = format!("https://open.spotify.com/embed/{}/{}", link.kind.as_str(), link.id);
        let client = reqwest::Client::builder()
            .user_agent(concat!("Grab/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()?;
        let res = client.get(&url).send().await?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(not_found(link));
        }
        let html = res.error_for_status()?.text().await?;
        parse(&html, link)
    }
}

fn not_found(link: &Link) -> AppError {
    AppError::Invalid(format!(
        "Spotify couldn't find this {}. It may be private or deleted.",
        link.kind.as_str()
    ))
}

/// Pull the page's `__NEXT_DATA__` JSON and read the entity from it.
pub fn parse(html: &str, link: &Link) -> AppResult<Collection> {
    let marker = r#"<script id="__NEXT_DATA__" type="application/json">"#;
    let start = html.find(marker).map(|i| i + marker.len());
    let json = start.and_then(|s| html[s..].find("</script>").map(|e| &html[s..s + e]));
    let Some(json) = json else {
        return Err(AppError::Invalid("Spotify's page has changed, so this link can't be read right now.".into()));
    };
    let data: Value = serde_json::from_str(json)?;
    let props = &data["props"]["pageProps"];
    if props["status"].as_u64() == Some(404) {
        return Err(not_found(link));
    }
    let e = &props["state"]["data"]["entity"];
    if !e.is_object() {
        return Err(AppError::Invalid("Spotify's page has changed, so this link can't be read right now.".into()));
    }
    let s = |v: &Value| v.as_str().map(str::to_string).filter(|t| !t.trim().is_empty());
    let name = s(&e["name"]).or_else(|| s(&e["title"])).unwrap_or_else(|| "Untitled".into());

    // Largest cover image, from either place Spotify puts it.
    let cover = e["visualIdentity"]["image"]
        .as_array()
        .and_then(|imgs| imgs.iter().max_by_key(|i| i["maxWidth"].as_u64().unwrap_or(0)))
        .and_then(|i| s(&i["url"]))
        .or_else(|| e["coverArt"]["sources"].as_array().and_then(|a| a.last()).and_then(|i| s(&i["url"])));
    let tint = {
        let c = &e["visualIdentity"]["backgroundBase"];
        match (c["red"].as_u64(), c["green"].as_u64(), c["blue"].as_u64()) {
            (Some(r), Some(g), Some(b)) => Some(format!("#{r:02x}{g:02x}{b:02x}")),
            _ => None,
        }
    };

    let track_of = |t: &Value, position: u32, artists: Vec<String>| -> Option<Track> {
        let id = s(&t["uri"])?.rsplit(':').next()?.to_string();
        Some(Track {
            id,
            title: s(&t["title"]).or_else(|| s(&t["name"]))?,
            artists,
            duration_ms: t["duration"].as_u64().unwrap_or(0),
            explicit: t["isExplicit"].as_bool().unwrap_or(false),
            position,
            playable: t["isPlayable"].as_bool().unwrap_or(true),
        })
    };

    let (owner, tracks) = if link.kind == LinkKind::Track {
        let artists: Vec<String> = e["artists"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| s(&x["name"])).collect())
            .unwrap_or_default();
        let owner = artists.first().cloned();
        (owner, track_of(e, 1, artists).into_iter().collect())
    } else {
        let list = e["trackList"].as_array().cloned().unwrap_or_default();
        let tracks: Vec<Track> = list
            .iter()
            .enumerate()
            .filter(|(_, t)| t["entityType"].as_str().is_none_or(|k| k == "track"))
            .filter_map(|(i, t)| track_of(t, i as u32 + 1, split_artists(t["subtitle"].as_str().unwrap_or(""))))
            .collect();
        (s(&e["subtitle"]), tracks)
    };

    Ok(Collection {
        kind: link.kind,
        id: link.id.clone(),
        uri: link.uri(),
        url: format!("https://open.spotify.com/{}/{}", link.kind.as_str(), link.id),
        name,
        owner,
        cover,
        tint,
        limited: link.kind == LinkKind::Playlist && tracks.len() >= EMBED_LIMIT,
        tracks,
    })
}

/// The embed lists artists as one string: "KAROL G,\u{a0}Judeline,\u{a0}rusowsky".
fn split_artists(s: &str) -> Vec<String> {
    s.split(",\u{a0}").map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn page(entity: Value) -> String {
        let data = json!({ "props": { "pageProps": { "state": { "data": { "entity": entity } } } } });
        format!(r#"<html><script id="__NEXT_DATA__" type="application/json">{data}</script></html>"#)
    }

    #[test]
    fn parses_links() {
        let l = parse_link("https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc").unwrap();
        assert_eq!((l.kind, l.id.as_str()), (LinkKind::Playlist, "37i9dQZF1DXcBWIGoYBM5M"));
        assert_eq!(parse_link("spotify:album:4aawyAB9vmqN3uQ7FjRGTy").unwrap().kind, LinkKind::Album);
        assert_eq!(parse_link("open.spotify.com/track/3h5T5JypYU7huFiVYhv1dr").unwrap().uri(), "spotify:track:3h5T5JypYU7huFiVYhv1dr");
        assert!(parse_link("https://open.spotify.com/artist/abc").is_none());
        assert!(parse_link("https://open.spotify.com/track/../../x").is_none());
        assert!(parse_link("https://example.com/track/abc").is_none());
    }

    #[test]
    fn reads_playlist_embed() {
        let html = page(json!({
            "type": "playlist", "name": "Mix", "subtitle": "Spotify",
            "coverArt": { "sources": [{ "url": "https://i.scdn.co/small" }] },
            "visualIdentity": {
                "backgroundBase": { "red": 83, "green": 10, "blue": 255 },
                "image": [{ "url": "https://img/64", "maxWidth": 64 }, { "url": "https://img/640", "maxWidth": 640 }]
            },
            "trackList": [
                { "uri": "spotify:track:aaa", "title": "One", "subtitle": "A,\u{a0}B", "duration": 225834, "isExplicit": true, "entityType": "track" },
                { "uri": "spotify:episode:ep", "title": "Podcast", "subtitle": "X", "duration": 1, "entityType": "episode" },
                { "uri": "spotify:track:ccc", "title": "Three", "subtitle": "C", "duration": 1000, "isPlayable": false, "entityType": "track" }
            ]
        }));
        let link = parse_link("https://open.spotify.com/playlist/P1").unwrap();
        let c = parse(&html, &link).unwrap();
        assert_eq!((c.name.as_str(), c.owner.as_deref()), ("Mix", Some("Spotify")));
        assert_eq!(c.cover.as_deref(), Some("https://img/640"));
        assert_eq!(c.tint.as_deref(), Some("#530aff"));
        assert_eq!(c.tracks.len(), 2, "episodes are skipped");
        assert_eq!(c.tracks[0].artists, vec!["A", "B"]);
        assert_eq!((c.tracks[0].duration_ms, c.tracks[0].explicit, c.tracks[0].position), (225834, true, 1));
        assert_eq!(c.tracks[1].position, 3, "positions keep Spotify's numbering");
        assert!(!c.tracks[1].playable);
        assert!(!c.limited);
    }

    #[test]
    fn reads_single_track() {
        let html = page(json!({
            "type": "track", "name": "BbY WOW", "uri": "spotify:track:t1", "duration": 225834,
            "artists": [{ "name": "KAROL G" }, { "name": "Judeline" }]
        }));
        let c = parse(&html, &parse_link("spotify:track:t1").unwrap()).unwrap();
        assert_eq!(c.tracks.len(), 1);
        assert_eq!(c.tracks[0].artists, vec!["KAROL G", "Judeline"]);
        assert_eq!(c.owner.as_deref(), Some("KAROL G"));
    }

    #[test]
    fn flags_large_playlists_and_missing_pages() {
        let list: Vec<Value> = (0..100)
            .map(|i| json!({ "uri": format!("spotify:track:t{i}"), "title": "x", "subtitle": "y", "duration": 1 }))
            .collect();
        let link = parse_link("spotify:playlist:big").unwrap();
        assert!(parse(&page(json!({ "name": "Big", "trackList": list })), &link).unwrap().limited);

        let missing = r#"<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"status":404}}}</script>"#;
        assert!(parse(missing, &link).unwrap_err().to_string().contains("couldn't find"));
        assert!(parse("<html>nothing</html>", &link).is_err());
    }
}
