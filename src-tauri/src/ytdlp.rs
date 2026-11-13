//! Running yt-dlp: shared arguments, reading media info, and turning yt-dlp's raw output into a
//! small, UI-ready summary. Parsing and error mapping are pure functions with tests.

use std::{collections::BTreeMap, path::PathBuf, process::Stdio, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
    tools,
};

// ---------------------------------------------------------------- running

pub struct ToolPaths {
    pub ytdlp: PathBuf,
    pub ffmpeg_dir: PathBuf,
    pub node: Option<PathBuf>,
}

pub fn tool_paths() -> AppResult<ToolPaths> {
    let need = |name: &str| {
        tools::locate(name).0.ok_or_else(|| {
            AppError::Invalid(format!("{name} isn't installed. Restart Grab to finish setting up its tools."))
        })
    };
    let ytdlp = need("yt-dlp")?;
    let ffmpeg = need("ffmpeg")?;
    Ok(ToolPaths {
        ytdlp,
        ffmpeg_dir: ffmpeg.parent().map(PathBuf::from).unwrap_or_default(),
        node: tools::locate("node").0,
    })
}

/// Arguments every yt-dlp run gets.
pub fn base_args(t: &ToolPaths) -> Vec<String> {
    let mut a = vec![
        "--ignore-config".into(), // the user's own yt-dlp config must not change Grab's behaviour
        "--no-warnings".into(),
        "--encoding".into(),
        "utf-8".into(),
        "--ffmpeg-location".into(),
        t.ffmpeg_dir.display().to_string(),
    ];
    if let Some(node) = &t.node {
        a.push("--js-runtimes".into());
        a.push(format!("node:{}", node.display()));
    }
    a
}

/// A yt-dlp process with UTF-8 output and no console window.
pub fn command(t: &ToolPaths) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(&t.ytdlp);
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd.args(base_args(t));
    cmd
}

/// Fetch and summarise info for one video.
pub async fn fetch_info(url: &str) -> AppResult<MediaInfo> {
    let t = tool_paths()?;
    let mut cmd = command(&t);
    cmd.args(["-J", "--no-playlist", "--", url]).stdout(Stdio::piped()).stderr(Stdio::piped());
    let child = cmd.spawn()?;
    let out = tokio::time::timeout(Duration::from_secs(90), child.wait_with_output())
        .await
        .map_err(|_| AppError::Network("Getting the video details took too long. Check your connection and try again.".into()))??;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        tracing::warn!(%url, stderr = %stderr.trim(), "yt-dlp info failed");
        return Err(AppError::Invalid(friendly_error(&stderr)));
    }
    let raw: RawInfo = serde_json::from_slice(&out.stdout)
        .map_err(|e| AppError::Invalid(format!("Couldn't read the video details ({e}).")))?;
    summarize(raw)
}

/// Save a short clip of a song for the in-app preview (Fix match dialog). Stream URLs only work
/// inside yt-dlp's own session, so the clip is downloaded and played from disk.
pub async fn preview_clip(video_id: &str, start: f64, dir: &std::path::Path) -> AppResult<PathBuf> {
    let file = dir.join(format!("{video_id}-{}.m4a", start as u32));
    if file.is_file() {
        return Ok(file);
    }
    std::fs::create_dir_all(dir)?;
    let t = tool_paths()?;
    let mut cmd = command(&t);
    let url = format!("https://music.youtube.com/watch?v={video_id}");
    let section = format!("*{}-{}", start as u32, start as u32 + 12);
    let out_name = format!("{video_id}-{}.%(ext)s", start as u32);
    cmd.args(["-q", "--no-playlist", "--no-part", "-f", "ba[ext=m4a]/ba[acodec^=mp4a]", "--download-sections", &section])
        .arg("-P")
        .arg(dir)
        .args(["-o", &out_name, "--", &url])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let out = tokio::time::timeout(Duration::from_secs(60), cmd.spawn()?.wait_with_output())
        .await
        .map_err(|_| AppError::Network("The preview took too long to load.".into()))??;
    if !out.status.success() || !file.is_file() {
        return Err(AppError::Invalid(friendly_error(&String::from_utf8_lossy(&out.stderr))));
    }
    Ok(file)
}

// ---------------------------------------------------------------- playlists & channels

/// Most items listed for one playlist or channel (keeps huge channels responsive).
pub const PLAYLIST_LIMIT: usize = 1000;

#[derive(Debug, Deserialize)]
pub struct RawPlaylist {
    pub id: Option<String>,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub uploader: Option<String>,
    pub playlist_count: Option<u64>,
    pub webpage_url: Option<String>,
    #[serde(default)]
    pub entries: Vec<RawEntry>,
}

#[derive(Debug, Deserialize)]
pub struct RawEntry {
    pub id: Option<String>,
    pub url: Option<String>,
    pub title: Option<String>,
    pub duration: Option<f64>,
    #[serde(default)]
    pub thumbnails: Vec<RawThumb>,
    pub live_status: Option<String>,
    pub availability: Option<String>,
    pub ie_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RawThumb {
    pub url: String,
    pub width: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub id: String,
    pub url: String,
    pub title: String,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    /// Private, deleted, or not yet live: shown but can't be selected.
    pub unavailable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistInfo {
    pub id: String,
    pub url: String,
    pub title: String,
    pub channel: Option<String>,
    /// Total reported by the site (may be larger than `entries` when truncated).
    pub total: Option<u64>,
    pub entries: Vec<PlaylistEntry>,
    pub truncated: bool,
}

/// A bare channel link lists its tabs; point it at the Videos tab instead.
pub fn normalize_channel_url(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    let lower = trimmed.to_lowercase();
    let is_channel = ["youtube.com/@", "youtube.com/channel/", "youtube.com/c/", "youtube.com/user/"]
        .iter()
        .any(|p| lower.contains(p));
    let has_tab = ["/videos", "/shorts", "/streams", "/playlists", "/podcasts", "/releases"]
        .iter()
        .any(|t| lower.ends_with(t));
    if is_channel && !has_tab && !lower.contains("list=") { format!("{trimmed}/videos") } else { url.to_string() }
}

pub fn summarize_playlist(raw: RawPlaylist, url: &str) -> PlaylistInfo {
    let entries: Vec<PlaylistEntry> = raw
        .entries
        .into_iter()
        .filter_map(|e| {
            let id = e.id?;
            let youtube = e.ie_key.as_deref().is_none_or(|k| k.starts_with("Youtube"));
            let url = e.url.unwrap_or_else(|| format!("https://www.youtube.com/watch?v={id}"));
            let title = e.title.unwrap_or_else(|| "Untitled".into());
            let unavailable = title.starts_with("[Private")
                || title.starts_with("[Deleted")
                || matches!(e.availability.as_deref(), Some("private" | "needs_auth" | "subscriber_only" | "premium_only"))
                || matches!(e.live_status.as_deref(), Some("is_live" | "is_upcoming"));
            let thumbnail = e
                .thumbnails
                .into_iter()
                .max_by_key(|t| t.width.unwrap_or(0))
                .map(|t| t.url)
                .or_else(|| youtube.then(|| format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg")));
            Some(PlaylistEntry { id, url, title, duration: e.duration, thumbnail, unavailable })
        })
        .collect();
    PlaylistInfo {
        id: raw.id.unwrap_or_default(),
        url: raw.webpage_url.unwrap_or_else(|| url.to_string()),
        title: raw.title.unwrap_or_else(|| "Playlist".into()),
        channel: raw.channel.or(raw.uploader),
        total: raw.playlist_count,
        truncated: entries.len() >= PLAYLIST_LIMIT,
        entries,
    }
}

pub async fn fetch_playlist(url: &str) -> AppResult<PlaylistInfo> {
    let url = normalize_channel_url(url);
    let t = tool_paths()?;
    let mut cmd = command(&t);
    cmd.args(["-J", "--flat-playlist", "-I", &format!("1:{PLAYLIST_LIMIT}"), "--", &url])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let out = tokio::time::timeout(Duration::from_secs(180), cmd.spawn()?.wait_with_output())
        .await
        .map_err(|_| AppError::Network("Listing the playlist took too long. Check your connection and try again.".into()))??;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        tracing::warn!(%url, stderr = %stderr.trim(), "yt-dlp playlist failed");
        return Err(AppError::Invalid(friendly_error(&stderr)));
    }
    let raw: RawPlaylist = serde_json::from_slice(&out.stdout)
        .map_err(|e| AppError::Invalid(format!("Couldn't read the playlist ({e}).")))?;
    Ok(summarize_playlist(raw, &url))
}

// ---------------------------------------------------------------- updates

/// The installed yt-dlp version, e.g. "2026.10.26".
pub async fn version(t: &ToolPaths) -> AppResult<String> {
    let mut cmd = command(t);
    cmd.arg("--version").stdout(Stdio::piped()).stderr(Stdio::null());
    let out = tokio::time::timeout(Duration::from_secs(20), cmd.output())
        .await
        .map_err(|_| AppError::Invalid("yt-dlp didn't respond.".into()))??;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Run yt-dlp's own updater (stable channel; it verifies the release against the project's
/// signed checksums). Returns (version before, version after).
pub async fn self_update(t: &ToolPaths) -> AppResult<(String, String)> {
    let before = version(t).await?;
    let mut cmd = command(t);
    cmd.arg("-U").stdout(Stdio::piped()).stderr(Stdio::piped());
    let out = tokio::time::timeout(Duration::from_secs(180), cmd.output())
        .await
        .map_err(|_| AppError::Network("Checking for downloader updates took too long.".into()))??;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        tracing::warn!(stderr = %err.trim(), "yt-dlp self-update failed");
        return Err(AppError::Network(friendly_error(&err)));
    }
    let after = version(t).await?;
    Ok((before, after))
}

/// Signs that YouTube changed something and a newer yt-dlp is likely to fix it.
pub fn looks_outdated(stderr: &str) -> bool {
    let s = stderr.to_lowercase();
    [
        "unable to extract",
        "nsig extraction failed",
        "signature extraction failed",
        "precondition check failed",
        "please report this issue",
        "no video formats found",
        "http error 403",
    ]
    .iter()
    .any(|p| s.contains(p))
}

// ---------------------------------------------------------------- errors

/// Turn yt-dlp's stderr into one sentence a person can act on.
pub fn friendly_error(stderr: &str) -> String {
    let s = stderr.to_lowercase();
    let has = |p: &str| s.contains(p);
    let msg = if has("private video") {
        "This video is private."
    } else if has("confirm your age") || has("age-restricted") || has("inappropriate for some users") {
        "This video is age-restricted, so it needs you to be signed in. Sign-in support is coming in Settings → Advanced."
    } else if has("members-only") || has("join this channel") {
        "This video is for channel members only."
    } else if has("not a bot") {
        "YouTube is asking to confirm you're not a bot. Wait a few minutes and try again."
    } else if has("this live event will begin") || has("premieres in") {
        "This video hasn't started yet (it's a scheduled live stream or premiere)."
    } else if has("is not available in your country") || has("geo restrict") {
        "This video isn't available in your country."
    } else if has("video unavailable") || has("has been removed") || has("does not exist") || has("404") {
        "This video isn't available. It may have been removed."
    } else if has("unsupported url") {
        "This link isn't supported. Try a link to a single video page."
    } else if has("http error 429") || has("too many requests") {
        "The site is limiting requests right now. Wait a few minutes and try again."
    } else if has("requested format is not available") {
        "That quality isn't available for this video. Pick another one."
    } else if has("drm") {
        "This video is copy-protected (DRM) and can't be downloaded."
    } else if has("unable to download webpage") || has("getaddrinfo") || has("connection") || has("timed out") {
        "Couldn't reach the site. Check your internet connection and try again."
    } else if has("no space left") {
        "Your disk is full. Free up space or choose another download folder."
    } else {
        // Fall back to yt-dlp's own last error line, without the "ERROR: [site] id:" prefix.
        return stderr
            .lines()
            .rev()
            .find(|l| l.contains("ERROR"))
            .map(|l| {
                let l = l.trim().trim_start_matches("ERROR:").trim();
                let l = if l.starts_with('[') { l.split_once(": ").map_or(l, |(_, r)| r) } else { l };
                l.chars().take(240).collect()
            })
            .filter(|l: &String| !l.is_empty())
            .unwrap_or_else(|| "Something went wrong. Try again.".into());
    };
    msg.into()
}

// ---------------------------------------------------------------- parsing

#[derive(Debug, Deserialize)]
pub struct RawInfo {
    pub id: String,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub view_count: Option<u64>,
    pub upload_date: Option<String>,
    pub is_live: Option<bool>,
    pub webpage_url: Option<String>,
    pub extractor_key: Option<String>,
    #[serde(default)]
    pub formats: Vec<RawFormat>,
    #[serde(default)]
    pub chapters: Option<Vec<Value>>,
    #[serde(default)]
    pub subtitles: Option<BTreeMap<String, Vec<RawSub>>>,
    #[serde(default)]
    pub automatic_captions: Option<BTreeMap<String, Vec<RawSub>>>,
}

#[derive(Debug, Deserialize)]
pub struct RawFormat {
    pub format_id: String,
    pub ext: Option<String>,
    pub protocol: Option<String>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub dynamic_range: Option<String>,
    pub tbr: Option<f64>,
    pub filesize: Option<u64>,
    pub filesize_approx: Option<u64>,
    pub format_note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RawSub {
    pub name: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoOption {
    pub height: u32,
    pub label: String,
    pub fps: Option<u32>,
    pub hdr: bool,
    pub codec: String,
    /// Estimated total size including audio, in bytes.
    pub size: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioOption {
    pub id: &'static str,
    pub label: &'static str,
    pub detail: String,
    pub size: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleLang {
    pub code: String,
    pub name: String,
    pub auto: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub id: String,
    pub url: String,
    pub title: String,
    pub channel: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub view_count: Option<u64>,
    pub upload_date: Option<String>,
    pub site: String,
    pub video: Vec<VideoOption>,
    pub audio: Vec<AudioOption>,
    pub subtitles: Vec<SubtitleLang>,
    pub chapters: usize,
}

fn is_none(c: &Option<String>) -> bool {
    matches!(c.as_deref(), None | Some("none"))
}

fn is_direct(f: &RawFormat) -> bool {
    f.protocol.as_deref().is_some_and(|p| p.starts_with("http") && !p.contains("m3u8"))
}

fn is_drc(f: &RawFormat) -> bool {
    f.format_id.contains("drc") || f.format_note.as_deref().is_some_and(|n| n.contains("DRC"))
}

fn size_of(f: &RawFormat, duration: f64) -> Option<u64> {
    f.filesize
        .or(f.filesize_approx)
        .or_else(|| f.tbr.filter(|_| duration > 0.0).map(|tbr| (tbr * 1000.0 / 8.0 * duration) as u64))
}

fn codec_label(vcodec: &str) -> String {
    let c = vcodec.to_lowercase();
    if c.starts_with("avc") { "H.264" } else if c.starts_with("vp09") || c.starts_with("vp9") { "VP9" } else if c.starts_with("av01") { "AV1" } else if c.starts_with("hev") || c.starts_with("hvc") { "HEVC" } else { return vcodec.split('.').next().unwrap_or(vcodec).to_uppercase() }
        .into()
}

pub fn summarize(raw: RawInfo) -> AppResult<MediaInfo> {
    if raw.is_live == Some(true) {
        return Err(AppError::Invalid("Live streams can't be downloaded while they're live. Try again after it ends.".into()));
    }
    let duration = raw.duration.unwrap_or(0.0);

    // Best audio-only stream per codec (skip DRC variants).
    let audio_only: Vec<&RawFormat> = raw
        .formats
        .iter()
        .filter(|f| is_none(&f.vcodec) && !is_none(&f.acodec) && !is_drc(f))
        .collect();
    let best_audio = |pred: &dyn Fn(&RawFormat) -> bool| {
        audio_only.iter().copied().filter(|f| pred(f)).max_by(|a, b| a.tbr.unwrap_or(0.0).total_cmp(&b.tbr.unwrap_or(0.0)))
    };
    let opus = best_audio(&|f| f.acodec.as_deref().is_some_and(|c| c.starts_with("opus")));
    let m4a = best_audio(&|f| f.ext.as_deref() == Some("m4a"));
    let any_audio = best_audio(&|_| true);
    let audio_size = any_audio.and_then(|f| size_of(f, duration)).unwrap_or(0);

    // Best video stream per height: prefer direct downloads, then highest bitrate.
    let videos: Vec<&RawFormat> = raw.formats.iter().filter(|f| !is_none(&f.vcodec) && f.height.is_some()).collect();
    let prefer_direct = videos.iter().any(|f| is_direct(f));
    let mut by_height: BTreeMap<u32, &RawFormat> = BTreeMap::new();
    for f in videos.into_iter().filter(|f| !prefer_direct || is_direct(f)) {
        let h = f.height.unwrap_or(0);
        let better = by_height.get(&h).is_none_or(|cur| {
            let key = |x: &RawFormat| (x.dynamic_range.as_deref().is_some_and(|d| d != "SDR"), x.fps.unwrap_or(0.0) as u32, x.tbr.unwrap_or(0.0) as u64);
            key(f) > key(cur)
        });
        if better {
            by_height.insert(h, f);
        }
    }
    let video = by_height
        .into_iter()
        .rev()
        .map(|(h, f)| {
            let has_audio = !is_none(&f.acodec);
            VideoOption {
                height: h,
                label: format!("{h}p"),
                fps: f.fps.map(|x| x.round() as u32),
                hdr: f.dynamic_range.as_deref().is_some_and(|d| d != "SDR"),
                codec: codec_label(f.vcodec.as_deref().unwrap_or("")),
                size: size_of(f, duration).map(|s| s + if has_audio { 0 } else { audio_size }),
            }
        })
        .collect();

    let mut audio = Vec::new();
    if let Some(f) = opus.or(any_audio) {
        let kbps = f.tbr.map(|t| t.round() as u32).unwrap_or(0);
        audio.push(AudioOption { id: "opus", label: "Best quality", detail: format!("Opus · ~{kbps} kbps · original, no re-encoding"), size: size_of(f, duration) });
    }
    if let Some(f) = m4a {
        let kbps = f.tbr.map(|t| t.round() as u32).unwrap_or(0);
        audio.push(AudioOption { id: "m4a", label: "M4A", detail: format!("AAC · ~{kbps} kbps · plays on every device"), size: size_of(f, duration) });
    }
    if any_audio.is_some() {
        audio.push(AudioOption {
            id: "mp3",
            label: "MP3",
            detail: "Converted · for old devices".into(),
            size: (duration > 0.0).then(|| (duration * 192_000.0 / 8.0) as u64),
        });
    }

    let mut subtitles: Vec<SubtitleLang> = raw
        .subtitles
        .unwrap_or_default()
        .into_iter()
        .filter(|(code, _)| code != "live_chat")
        .map(|(code, v)| SubtitleLang { name: v.first().and_then(|s| s.name.clone()).unwrap_or_else(|| code.clone()), code, auto: false })
        .collect();
    // Auto-captions come in 100+ machine-translated languages: offer only the original one.
    for (code, v) in raw.automatic_captions.unwrap_or_default() {
        if code.ends_with("-orig") && !subtitles.iter().any(|s| code.starts_with(&s.code)) {
            let name = v.first().and_then(|s| s.name.clone()).unwrap_or_else(|| code.clone());
            subtitles.push(SubtitleLang { code, name: format!("{name} (auto)"), auto: true });
        }
    }

    Ok(MediaInfo {
        url: raw.webpage_url.unwrap_or_else(|| format!("https://www.youtube.com/watch?v={}", raw.id)),
        id: raw.id,
        title: raw.title.unwrap_or_else(|| "Untitled".into()),
        channel: raw.channel.or(raw.uploader),
        duration: raw.duration,
        thumbnail: raw.thumbnail,
        view_count: raw.view_count,
        upload_date: raw.upload_date,
        site: raw.extractor_key.unwrap_or_else(|| "Web".into()),
        video,
        audio,
        subtitles,
        chapters: raw.chapters.map_or(0, |c| c.len()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fmt(id: &str, proto: &str, v: &str, a: &str, h: Option<u32>, fps: f64, tbr: f64, size: Option<u64>) -> Value {
        json!({ "format_id": id, "ext": if a.starts_with("opus") || v.starts_with("vp") { "webm" } else { "m4a" },
                "protocol": proto, "vcodec": v, "acodec": a, "height": h, "fps": fps, "dynamic_range": "SDR",
                "tbr": tbr, "filesize": size })
    }

    fn sample() -> RawInfo {
        serde_json::from_value(json!({
            "id": "abc123", "title": "Sample", "channel": "Chan", "duration": 100.0, "extractor_key": "Youtube",
            "webpage_url": "https://www.youtube.com/watch?v=abc123",
            "formats": [
                fmt("140", "https", "none", "mp4a.40.2", None, 0.0, 129.8, Some(1_600_000)),
                fmt("251", "https", "none", "opus", None, 0.0, 135.0, Some(1_700_000)),
                fmt("251-drc", "https", "none", "opus", None, 0.0, 200.0, Some(9_999_999)),
                fmt("137", "https", "avc1.640028", "none", Some(1080), 30.0, 4000.0, Some(50_000_000)),
                fmt("248", "https", "vp9", "none", Some(1080), 30.0, 3000.0, Some(40_000_000)),
                fmt("616", "m3u8_native", "vp09.00.40.08", "none", Some(1080), 30.0, 9000.0, None),
                fmt("136", "https", "avc1.4d401f", "none", Some(720), 30.0, 2000.0, Some(20_000_000)),
                fmt("18", "https", "avc1.42001E", "mp4a.40.2", Some(360), 30.0, 500.0, Some(6_000_000)),
            ],
            "chapters": [{}, {}],
            "subtitles": { "en": [{ "name": "English" }], "live_chat": [{}] },
            "automatic_captions": { "en-orig": [{ "name": "English (Original)" }], "de": [{ "name": "German" }], "hi-orig": [{ "name": "Hindi (Original)" }] }
        }))
        .unwrap()
    }

    #[test]
    fn picks_best_direct_stream_per_height() {
        let info = summarize(sample()).unwrap();
        let heights: Vec<u32> = info.video.iter().map(|v| v.height).collect();
        assert_eq!(heights, vec![1080, 720, 360]);
        // 1080: direct avc (4000 kbps) beats direct vp9; the m3u8 stream is ignored.
        assert_eq!(info.video[0].codec, "H.264");
        // video-only size includes the best audio (opus 251, not the DRC variant).
        assert_eq!(info.video[0].size, Some(50_000_000 + 1_700_000));
        // 360p already has audio: nothing added.
        assert_eq!(info.video[2].size, Some(6_000_000));
    }

    #[test]
    fn audio_options_skip_drc() {
        let info = summarize(sample()).unwrap();
        let ids: Vec<&str> = info.audio.iter().map(|a| a.id).collect();
        assert_eq!(ids, vec!["opus", "m4a", "mp3"]);
        assert_eq!(info.audio[0].size, Some(1_700_000));
    }

    #[test]
    fn subtitles_keep_manual_and_original_auto_only() {
        let info = summarize(sample()).unwrap();
        let codes: Vec<&str> = info.subtitles.iter().map(|s| s.code.as_str()).collect();
        assert_eq!(codes, vec!["en", "hi-orig"]);
        assert_eq!(info.chapters, 2);
    }

    #[test]
    fn live_streams_are_rejected() {
        let mut raw = sample();
        raw.is_live = Some(true);
        assert!(summarize(raw).is_err());
    }

    #[test]
    fn maps_common_errors() {
        assert_eq!(friendly_error("ERROR: [youtube] abc: Private video. Sign in if you've been granted access"), "This video is private.");
        assert!(friendly_error("ERROR: [youtube] x: Sign in to confirm your age.").contains("age-restricted"));
        assert!(friendly_error("ERROR: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>").contains("internet"));
        assert_eq!(
            friendly_error("WARNING: something\nERROR: [generic] weird: Some new failure"),
            "Some new failure"
        );
        assert_eq!(friendly_error(""), "Something went wrong. Try again.");
    }

    #[test]
    fn channel_links_point_at_videos_tab() {
        assert_eq!(normalize_channel_url("https://www.youtube.com/@YouTube"), "https://www.youtube.com/@YouTube/videos");
        assert_eq!(normalize_channel_url("https://www.youtube.com/@YouTube/"), "https://www.youtube.com/@YouTube/videos");
        assert_eq!(normalize_channel_url("https://www.youtube.com/@YouTube/shorts"), "https://www.youtube.com/@YouTube/shorts");
        let pl = "https://www.youtube.com/playlist?list=PL123";
        assert_eq!(normalize_channel_url(pl), pl);
    }

    #[test]
    fn summarizes_playlists() {
        let raw: RawPlaylist = serde_json::from_value(json!({
            "id": "PL1", "title": "Mix", "channel": "C", "playlist_count": 3,
            "entries": [
                { "id": "aaaaaaaaaaa", "url": "https://www.youtube.com/watch?v=aaaaaaaaaaa", "title": "One", "duration": 60.0,
                  "thumbnails": [{ "url": "small", "width": 120 }, { "url": "big", "width": 336 }], "ie_key": "Youtube" },
                { "id": "bbbbbbbbbbb", "title": "[Private video]", "ie_key": "Youtube" },
                { "id": "ccccccccccc", "title": "Soon", "live_status": "is_upcoming", "ie_key": "Youtube" },
                { "title": "no id: dropped" }
            ]
        }))
        .unwrap();
        let p = summarize_playlist(raw, "https://x");
        assert_eq!(p.entries.len(), 3);
        assert_eq!(p.entries[0].thumbnail.as_deref(), Some("big"));
        assert!(!p.entries[0].unavailable && p.entries[1].unavailable && p.entries[2].unavailable);
        assert_eq!(p.entries[1].url, "https://www.youtube.com/watch?v=bbbbbbbbbbb");
        assert_eq!(p.entries[1].thumbnail.as_deref(), Some("https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg"));
        assert!(!p.truncated);
    }

    #[test]
    fn detects_outdated_downloader() {
        assert!(looks_outdated("ERROR: [youtube] x: nsig extraction failed: Some formats may be missing"));
        assert!(looks_outdated("ERROR: unable to download video data: HTTP Error 403: Forbidden"));
        assert!(!looks_outdated("ERROR: [youtube] x: Private video"));
    }
}
