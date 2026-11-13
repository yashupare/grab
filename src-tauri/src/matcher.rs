//! Finding each Spotify song on YouTube Music.
//!
//! Search uses YouTube Music's own web search (the same request its website makes), which returns
//! title, artists, album and length, enough to score candidates without fetching each video.
//! Scoring is a pure function with tests. Results are cached per Spotify track in
//! `spotify_matches`, and a match the user picked by hand always wins.

use std::{collections::HashSet, time::Duration};

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    db::Db,
    error::{AppError, AppResult},
};

// ---------------------------------------------------------------- types

/// What the matcher needs to know about a Spotify song.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// An official song upload (YouTube Music "Songs").
    Song,
    /// A regular video (music video, fan upload…).
    Video,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub video_id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub album: Option<String>,
    /// Seconds.
    pub duration: Option<f64>,
    /// Square cover art when YouTube Music has one.
    pub thumbnail: Option<String>,
    pub source: Source,
    /// 0–1; filled in by scoring.
    #[serde(default)]
    pub score: f64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MatchStatus {
    Matched,
    NotFound,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchResult {
    pub spotify_id: String,
    pub status: MatchStatus,
    pub candidate: Option<Candidate>,
    /// Picked by the user in the Fix dialog.
    pub manual: bool,
}

/// Lowest score accepted automatically. Below this the row shows "Couldn't find" with a Fix button.
pub const ACCEPT: f64 = 0.68;

// ---------------------------------------------------------------- search

const SEARCH_URL: &str = "https://music.youtube.com/youtubei/v1/search?prettyPrint=false";
const CLIENT_VERSION: &str = "1.20251101.01.00";
// Search filters, as YouTube Music's own "Songs" and "Videos" chips send them.
const FILTER_SONGS: &str = "EgWKAQIIAWoKEAkQBRAKEAMQBA==";
const FILTER_VIDEOS: &str = "EgWKAQIQAWoKEAkQChAFEAMQBA==";

fn client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
        .timeout(Duration::from_secs(15))
        .build()?)
}

async fn search(client: &reqwest::Client, query: &str, source: Source) -> AppResult<Vec<Candidate>> {
    let body = json!({
        "context": { "client": { "clientName": "WEB_REMIX", "clientVersion": CLIENT_VERSION, "hl": "en", "gl": "US" } },
        "query": query,
        "params": match source { Source::Song => FILTER_SONGS, Source::Video => FILTER_VIDEOS },
    });
    let res = client
        .post(SEARCH_URL)
        .header("Content-Type", "application/json")
        .header("Origin", "https://music.youtube.com")
        .body(body.to_string())
        .send()
        .await?
        .error_for_status()?;
    let data: Value = serde_json::from_slice(&res.bytes().await?)?;
    Ok(parse_results(&data, source))
}

pub fn search_text(q: &Query) -> String {
    let artists = q.artists.iter().take(2).cloned().collect::<Vec<_>>().join(" ");
    format!("{artists} {}", strip_feat(&q.title)).trim().to_string()
}

/// Songs first; regular videos only when no song is a good fit (or `all` is set for the Fix dialog).
pub async fn find(q: &Query, all: bool) -> AppResult<Vec<Candidate>> {
    let client = client()?;
    let text = search_text(q);
    let mut found = score_all(q, search(&client, &text, Source::Song).await?);
    if all || found.first().is_none_or(|c| c.score < ACCEPT) {
        let videos = score_all(q, search(&client, &text, Source::Video).await.unwrap_or_default());
        let seen: HashSet<String> = found.iter().map(|c| c.video_id.clone()).collect();
        found.extend(videos.into_iter().filter(|c| !seen.contains(&c.video_id)));
        found.sort_by(|a, b| b.score.total_cmp(&a.score));
    }
    Ok(found)
}

fn score_all(q: &Query, mut v: Vec<Candidate>) -> Vec<Candidate> {
    for c in &mut v {
        c.score = score(q, c);
    }
    v.sort_by(|a, b| b.score.total_cmp(&a.score));
    v
}

// ---------------------------------------------------------------- parsing YouTube Music results

fn runs_text(runs: &Value) -> String {
    runs.as_array().map(|r| r.iter().filter_map(|x| x["text"].as_str()).collect()).unwrap_or_default()
}

fn parse_duration(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.trim().split(':').collect();
    if parts.len() < 2 || parts.len() > 3 || parts.iter().any(|p| p.is_empty() || !p.chars().all(|c| c.is_ascii_digit())) {
        return None;
    }
    Some(parts.iter().fold(0.0, |acc, p| acc * 60.0 + p.parse::<f64>().unwrap_or(0.0)))
}

/// "PitbullVEVO" → "Pitbull", "Artist - Topic" → "Artist".
fn clean_channel(s: &str) -> String {
    let s = s.trim();
    let s = s.strip_suffix(" - Topic").unwrap_or(s);
    let s = s.strip_suffix("VEVO").unwrap_or(s);
    s.trim().to_string()
}

pub fn parse_results(data: &Value, source: Source) -> Vec<Candidate> {
    let sections = &data["contents"]["tabbedSearchResultsRenderer"]["tabs"][0]["tabRenderer"]["content"]["sectionListRenderer"]["contents"];
    let mut out = Vec::new();
    for section in sections.as_array().into_iter().flatten() {
        for item in section["musicShelfRenderer"]["contents"].as_array().into_iter().flatten() {
            if let Some(c) = parse_item(&item["musicResponsiveListItemRenderer"], source) {
                out.push(c);
            }
        }
    }
    out
}

fn parse_item(r: &Value, source: Source) -> Option<Candidate> {
    let cols = r["flexColumns"].as_array()?;
    let title_runs = cols.first()?.get("musicResponsiveListItemFlexColumnRenderer")?.get("text")?.get("runs")?;
    let title = runs_text(title_runs).trim().to_string();
    let video_id = r["playlistItemData"]["videoId"]
        .as_str()
        .or_else(|| title_runs[0]["navigationEndpoint"]["watchEndpoint"]["videoId"].as_str())?
        .to_string();
    if title.is_empty() || !valid_video_id(&video_id) {
        return None;
    }

    // Second column: "Artist, Artist & Artist • Album • 3:46" (songs) or "Channel • 639K views • 3:46".
    let mut album = None;
    let mut duration = None;
    let mut first_segment = String::new();
    let mut segment = 0;
    let second = cols.get(1).map(|c| &c["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]);
    for run in second.and_then(Value::as_array).into_iter().flatten() {
        let text = run["text"].as_str().unwrap_or("");
        if matches!(text.trim(), "•" | "∙") {
            segment += 1;
            continue;
        }
        let page = run["navigationEndpoint"]["browseEndpoint"]["browseEndpointContextSupportedConfigs"]
            ["browseEndpointContextMusicConfig"]["pageType"]
            .as_str()
            .unwrap_or("");
        if page == "MUSIC_PAGE_TYPE_ALBUM" {
            album = Some(text.trim().to_string());
        } else if let Some(d) = parse_duration(text) {
            duration = Some(d);
        } else if segment == 0 {
            first_segment.push_str(text);
        }
    }
    let artists: Vec<String> = first_segment
        .split([',', '&'])
        .map(clean_channel)
        .filter(|n| !n.is_empty() && !matches!(n.as_str(), "Song" | "Video"))
        .collect();

    let thumbnail = r["thumbnail"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"]
        .as_array()
        .and_then(|t| t.last())
        .and_then(|t| t["url"].as_str())
        .map(bigger_thumbnail);
    Some(Candidate { video_id, title, artists, album, duration, thumbnail, source, score: 0.0 })
}

/// YouTube Music thumbnails end in "=w60-h60-l90-rj"; ask for a size good for cover art.
fn bigger_thumbnail(url: &str) -> String {
    match url.rfind("=w") {
        Some(i) if url.contains("googleusercontent.com") => format!("{}=w544-h544-l90-rj", &url[..i]),
        _ => url.to_string(),
    }
}

pub fn valid_video_id(id: &str) -> bool {
    id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The 11-character id from a YouTube / YouTube Music link, or a bare id.
pub fn video_id_from(input: &str) -> Option<String> {
    let s = input.trim();
    if valid_video_id(s) {
        return Some(s.to_string());
    }
    let rest = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(s);
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.trim_start_matches("www.").trim_start_matches("m.");
    let id = match host {
        "youtu.be" => path.split(['?', '&', '#', '/']).next(),
        "youtube.com" | "music.youtube.com" => {
            if let Some(q) = path.strip_prefix("watch?") {
                q.split('&').find_map(|kv| kv.strip_prefix("v="))
            } else {
                ["shorts/", "live/", "embed/"].iter().find_map(|p| path.strip_prefix(p)).and_then(|p| p.split(['?', '/', '#']).next())
            }
        }
        _ => None,
    }?;
    valid_video_id(id).then(|| id.to_string())
}

// ---------------------------------------------------------------- scoring

/// Words that mean "a different recording". If the candidate has one the Spotify title doesn't,
/// it's probably the wrong version.
const VERSION_WORDS: &[&str] = &[
    "live", "remix", "acoustic", "instrumental", "karaoke", "cover", "sped", "slowed", "nightcore", "8d", "reverb",
    "edit", "mix", "unplugged", "demo", "piano", "orchestral", "extended", "loop", "mashup", "tutorial", "reaction",
    // re-recordings and covers: "Re-Recorded", "Classic Version", "Revisited by", "Tribute to",
    // "Originally Performed By", "Made Famous by", "in the Style of"
    "recorded", "rerecorded", "classic", "revisited", "tribute", "performed", "famous", "style",
];
/// Strongly wrong for an import even when the title otherwise matches.
const WRONG_WORDS: &[&str] = &[
    "karaoke", "instrumental", "sped", "slowed", "nightcore", "8d", "reaction", "tutorial", "cover", "tribute", "performed",
    "famous", "style", "boosted", "lofi", "parody", "remake",
];
/// Noise in video titles that says nothing about the recording.
const NOISE_WORDS: &[&str] = &[
    "official", "video", "audio", "lyric", "lyrics", "visualizer", "visualiser", "music", "mv", "hd", "hq", "4k",
    "remastered", "remaster", "explicit", "clean", "version", "full", "song", "topic", "vevo", "original",
];

fn strip_feat(title: &str) -> String {
    let lower = title.to_lowercase();
    for pat in ["(feat", "[feat", "(ft.", "[ft.", "(with ", " feat.", " ft. "] {
        if let Some(i) = lower.find(pat) {
            let tail = &title[i..];
            // Drop the bracketed part, keep whatever follows it.
            let end = if pat.starts_with(['(', '[']) { tail.find([')', ']']).map(|e| i + e + 1) } else { None };
            let rest = end.map(|e| &title[e..]).unwrap_or("");
            return format!("{}{}", &title[..i], rest).trim().to_string();
        }
    }
    title.to_string()
}

fn tokens(s: &str) -> Vec<String> {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

/// Dice similarity of two token sets, with a bonus when one fully contains the other.
fn similarity(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let sa: HashSet<&String> = a.iter().collect();
    let sb: HashSet<&String> = b.iter().collect();
    let common = sa.intersection(&sb).count() as f64;
    let dice = 2.0 * common / (sa.len() + sb.len()) as f64;
    let contained = common / sa.len().min(sb.len()) as f64;
    dice.max(contained * 0.9)
}

fn version_words(tokens: &[String]) -> HashSet<&'static str> {
    VERSION_WORDS.iter().copied().filter(|w| tokens.iter().any(|t| t == w)).collect()
}

/// 0–1: how likely `c` is the same recording as `q`.
pub fn score(q: &Query, c: &Candidate) -> f64 {
    let artist_tokens: HashSet<String> = q.artists.iter().flat_map(|a| tokens(a)).collect();
    let q_title = tokens(&strip_feat(&q.title));
    let q_title_all = tokens(&q.title);

    // Video titles are often "Artist - Song (Official Video)": drop artist names and noise.
    let c_title_all = tokens(&c.title);
    let c_title: Vec<String> = tokens(&strip_feat(&c.title))
        .into_iter()
        .filter(|t| !NOISE_WORDS.contains(&t.as_str()) && (c.source == Source::Song || !artist_tokens.contains(t) || q_title.contains(t)))
        .collect();
    let q_core: Vec<String> = q_title.iter().filter(|t| !NOISE_WORDS.contains(&t.as_str())).cloned().collect();
    let title = similarity(if q_core.is_empty() { &q_title } else { &q_core }, &c_title);

    // Artists: share of Spotify artists found in the candidate's artists, or in a video's title
    // ("Artist - Song"). Never a song's title: covers are named "Song (Originally by Artist)".
    let title_evidence = if c.source == Source::Video { c_title_all.clone() } else { Vec::new() };
    let c_artist_text: HashSet<String> = c.artists.iter().flat_map(|a| tokens(a)).chain(title_evidence).collect();
    // "Bob Marley & The Wailers" is found in "Bob Marley" (most of the name), but "Bob Marley"
    // isn't found in "Ziggy Marley" (only half).
    let found = |a: &String| {
        let t: Vec<String> = tokens(a).into_iter().filter(|x| !matches!(x.as_str(), "the" | "and")).collect();
        let hits = t.iter().filter(|x| c_artist_text.contains(*x)).count();
        !t.is_empty() && (hits == t.len() || hits * 2 > t.len())
    };
    let any_artist = q.artists.iter().any(&found);
    // For a video, `artists` is the uploading channel.
    let from_artist_channel = {
        let channel: HashSet<String> = c.artists.iter().flat_map(|a| tokens(a)).collect();
        q.artists.iter().any(|a| {
            let t = tokens(a);
            !t.is_empty() && t.iter().all(|x| channel.contains(x))
        })
    };
    let artist = match q.artists.first() {
        None => 0.5,
        Some(first) if found(first) => 0.75 + 0.25 * (q.artists.iter().filter(|a| found(a)).count() as f64 / q.artists.len() as f64),
        Some(_) => 0.5 * (q.artists.iter().filter(|a| found(a)).count() as f64 / q.artists.len() as f64),
    };

    let diff = c.duration.filter(|_| q.duration_ms > 0).map(|d| (d - q.duration_ms as f64 / 1000.0).abs());
    let duration = match diff {
        Some(d) if d <= 3.0 => 1.0,
        Some(d) => (1.0 - (d - 3.0) / 17.0).max(0.0),
        None => 0.5,
    };

    let mut s = 0.45 * title + 0.30 * artist + 0.25 * duration;
    if !q.artists.is_empty() && !any_artist {
        s *= 0.6; // same title by someone else: almost always a cover
    }
    if c.source == Source::Video && !from_artist_channel {
        s *= 0.85; // someone else's upload: may be edited, sped up or have an intro
    }
    if diff.is_some_and(|d| d > 20.0) {
        s *= 0.85; // extended/album/radio version of a different length
    }
    let q_versions = version_words(&q_title_all);
    let c_versions = version_words(&c_title_all);
    let extra: Vec<&&str> = c_versions.difference(&q_versions).collect();
    // "528hz", "432 hz": pitch-shifted re-uploads.
    let pitched = c_title_all.windows(2).any(|w| w[1] == "hz" && w[0].chars().all(|c| c.is_ascii_digit()))
        || c_title_all.iter().any(|t| t.len() > 2 && t.ends_with("hz") && t[..t.len() - 2].chars().all(|c| c.is_ascii_digit()));
    if pitched || extra.iter().any(|w| WRONG_WORDS.contains(w)) {
        s *= 0.4;
    } else if !extra.is_empty() {
        s *= 0.6;
    }
    if !q_versions.is_empty() {
        if q_versions.is_subset(&c_versions) {
            s = (s + 0.03).min(1.0); // both say "Live"/"Remix": a good sign
        } else {
            s *= 0.75; // Spotify wants the live/remix version, this isn't it
        }
    }
    if c.source == Source::Song {
        s = (s + 0.02).min(1.0); // official audio beats a video with intro/outro
    }
    (s * 1000.0).round() / 1000.0
}

// ---------------------------------------------------------------- cache

fn row_to_candidate(r: &rusqlite::Row) -> rusqlite::Result<Option<Candidate>> {
    let Some(video_id) = r.get::<_, Option<String>>("video_id")? else { return Ok(None) };
    let artists: String = r.get("artists")?;
    let source: String = r.get("source")?;
    Ok(Some(Candidate {
        video_id,
        title: r.get::<_, Option<String>>("title")?.unwrap_or_default(),
        artists: serde_json::from_str(&artists).unwrap_or_default(),
        album: r.get("album")?,
        duration: r.get("duration")?,
        thumbnail: r.get("thumbnail")?,
        source: if source == "song" { Source::Song } else { Source::Video },
        score: r.get("score")?,
    }))
}

pub fn cached(db: &Db, spotify_id: &str) -> AppResult<Option<MatchResult>> {
    db.with(|c| {
        Ok(c.query_row("SELECT * FROM spotify_matches WHERE spotify_id = ?1", [spotify_id], |r| {
            let candidate = row_to_candidate(r)?;
            let manual: bool = r.get("manual")?;
            Ok(MatchResult {
                spotify_id: spotify_id.to_string(),
                status: if candidate.is_some() { MatchStatus::Matched } else { MatchStatus::NotFound },
                candidate,
                manual,
            })
        })
        .optional()?)
    })
}

pub fn save(db: &Db, spotify_id: &str, c: Option<&Candidate>, manual: bool) -> AppResult<()> {
    let artists = serde_json::to_string(&c.map(|c| c.artists.clone()).unwrap_or_default())?;
    db.with(|conn| {
        conn.execute(
            "INSERT INTO spotify_matches (spotify_id, video_id, title, artists, album, duration, thumbnail, source, score, manual)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(spotify_id) DO UPDATE SET video_id = excluded.video_id, title = excluded.title,
               artists = excluded.artists, album = excluded.album, duration = excluded.duration,
               thumbnail = excluded.thumbnail, source = excluded.source, score = excluded.score,
               manual = excluded.manual, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            params![
                spotify_id,
                c.map(|c| &c.video_id),
                c.map(|c| &c.title),
                artists,
                c.and_then(|c| c.album.as_ref()),
                c.and_then(|c| c.duration),
                c.and_then(|c| c.thumbnail.as_ref()),
                if c.is_some_and(|c| c.source == Source::Video) { "video" } else { "song" },
                c.map_or(0.0, |c| c.score),
                manual,
            ],
        )?;
        Ok(())
    })
}

/// Cached result, or search now and remember the answer.
pub async fn match_track(db: &Db, q: &Query) -> AppResult<MatchResult> {
    // "Couldn't find" is retried after a day, in case YouTube Music has it by then.
    let fresh_miss = db.with(|c| {
        Ok(c.query_row(
            "SELECT video_id IS NULL AND updated_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day') FROM spotify_matches WHERE spotify_id = ?1",
            [&q.id],
            |r| r.get::<_, bool>(0),
        )
        .optional()?
        .unwrap_or(false))
    })?;
    if let Some(hit) = cached(db, &q.id)?
        && (hit.status == MatchStatus::Matched || fresh_miss)
    {
        return Ok(hit);
    }
    let found = find(q, false).await?;
    let best = found.into_iter().next().filter(|c| c.score >= ACCEPT);
    save(db, &q.id, best.as_ref(), false)?;
    Ok(MatchResult {
        spotify_id: q.id.clone(),
        status: if best.is_some() { MatchStatus::Matched } else { MatchStatus::NotFound },
        candidate: best,
        manual: false,
    })
}

pub fn check_query(q: &Query) -> AppResult<()> {
    let ok = !q.id.is_empty()
        && q.id.len() <= 40
        && q.id.chars().all(|c| c.is_ascii_alphanumeric())
        && !q.title.trim().is_empty()
        && q.title.len() <= 500
        && q.artists.len() <= 30;
    if ok { Ok(()) } else { Err(AppError::Invalid("Invalid song.".into())) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(title: &str, artists: &[&str], secs: u64) -> Query {
        Query { id: "t".into(), title: title.into(), artists: artists.iter().map(|s| s.to_string()).collect(), duration_ms: secs * 1000 }
    }
    fn c(title: &str, artists: &[&str], secs: f64, source: Source) -> Candidate {
        Candidate {
            video_id: "aaaaaaaaaaa".into(),
            title: title.into(),
            artists: artists.iter().map(|s| s.to_string()).collect(),
            album: None,
            duration: Some(secs),
            thumbnail: None,
            source,
            score: 0.0,
        }
    }

    #[test]
    fn exact_song_scores_high() {
        let s = score(&q("BbY WOW", &["KAROL G", "Judeline", "rusowsky"], 226), &c("BbY WOW", &["KAROL G", "Judeline", "rusowsky"], 226.0, Source::Song));
        assert!(s > 0.95, "{s}");
    }

    #[test]
    fn music_video_title_with_artist_and_noise_still_matches() {
        let s = score(
            &q("Blinding Lights", &["The Weeknd"], 200),
            &c("The Weeknd - Blinding Lights (Official Video)", &["The Weeknd"], 202.0, Source::Video),
        );
        assert!(s >= ACCEPT, "{s}");
    }

    #[test]
    fn feat_in_title_is_ignored() {
        let s = score(
            &q("Global Warming (feat. Sensato)", &["Pitbull", "Sensato"], 85),
            &c("Global Warming", &["Pitbull", "Sensato"], 85.0, Source::Song),
        );
        assert!(s > 0.9, "{s}");
    }

    #[test]
    fn wrong_versions_lose() {
        let query = q("Shape of You", &["Ed Sheeran"], 234);
        let original = score(&query, &c("Shape of You", &["Ed Sheeran"], 234.0, Source::Song));
        let karaoke = score(&query, &c("Shape of You (Karaoke Version)", &["Sing King"], 234.0, Source::Video));
        let live = score(&query, &c("Shape of You (Live)", &["Ed Sheeran"], 250.0, Source::Song));
        let sped = score(&query, &c("Shape of You (Sped Up)", &["Ed Sheeran"], 190.0, Source::Song));
        assert!(original > live && live > karaoke, "{original} {live} {karaoke}");
        assert!(karaoke < ACCEPT && sped < ACCEPT && live < ACCEPT);
    }

    #[test]
    fn covers_and_rerecordings_lose() {
        let query = q("Summer Of '69", &["Bryan Adams"], 216);
        for (title, artist) in [
            ("Summer of '69 (Originally Performed By Bryan Adams) [Full Vocal Version]", "Chart Collective"),
            ("Summer of '69 in the Style of Bryan Adams", "Sunfly Karaoke"),
            ("Summer of '69 (Made Famous by Bryan Adams)", "All-Stars"),
            ("Summer of '69 (Re-Recorded)", "Bryan Adams"),
        ] {
            let s = score(&query, &c(title, &[artist], 216.0, Source::Song));
            assert!(s < ACCEPT, "{title}: {s}");
        }
        let video = score(&query, &c("Bryan Adams - Summer Of '69 (Official Music Video)", &["Bryan Adams"], 218.0, Source::Video));
        assert!(video >= ACCEPT, "{video}");
    }

    #[test]
    fn band_names_match_partly() {
        let query = q("Could You Be Loved", &["Bob Marley & The Wailers"], 237);
        assert!(score(&query, &c("Could You Be Loved", &["Bob Marley"], 237.0, Source::Song)) >= ACCEPT);
        let query = q("One Love", &["Bob Marley"], 170);
        assert!(score(&query, &c("One Love", &["Ziggy Marley"], 170.0, Source::Song)) < ACCEPT);
    }

    #[test]
    fn pitch_shifted_uploads_lose() {
        let query = q("Caribbean Queen (No More Love On the Run)", &["Billy Ocean"], 244);
        let s = score(&query, &c("Billy Ocean - Caribbean Queen 528hz", &["528hz12o"], 247.0, Source::Video));
        assert!(s < ACCEPT, "{s}");
    }

    #[test]
    fn much_longer_versions_lose() {
        let query = q("Total Eclipse of the Heart", &["Bonnie Tyler"], 267);
        assert!(score(&query, &c("Total Eclipse of the Heart", &["Bonnie Tyler"], 418.0, Source::Song)) < ACCEPT);
    }

    #[test]
    fn live_matches_live() {
        let query = q("Hotel California - Live On MTV, 1994", &["Eagles"], 427);
        let live = score(&query, &c("Hotel California (Live On MTV, 1994)", &["Eagles"], 428.0, Source::Song));
        let studio = score(&query, &c("Hotel California", &["Eagles"], 391.0, Source::Song));
        assert!(live > studio && live >= ACCEPT, "{live} {studio}");
    }

    #[test]
    fn different_artist_or_length_is_rejected() {
        let query = q("Hello", &["Adele"], 295);
        assert!(score(&query, &c("Hello", &["Lionel Richie"], 247.0, Source::Song)) < ACCEPT);
        assert!(score(&query, &c("Hello", &["Adele"], 420.0, Source::Song)) < score(&query, &c("Hello", &["Adele"], 296.0, Source::Song)));
    }

    #[test]
    fn strips_feat() {
        assert_eq!(strip_feat("Global Warming (feat. Sensato)"), "Global Warming");
        assert_eq!(tokens(&strip_feat("Song [ft. X] - Remix")), vec!["song", "remix"]);
        assert_eq!(strip_feat("Plain"), "Plain");
    }

    #[test]
    fn reads_video_ids() {
        assert_eq!(video_id_from("https://music.youtube.com/watch?v=ljAH6jNaApU&si=x").as_deref(), Some("ljAH6jNaApU"));
        assert_eq!(video_id_from("https://youtu.be/ljAH6jNaApU?t=3").as_deref(), Some("ljAH6jNaApU"));
        assert_eq!(video_id_from("www.youtube.com/shorts/ljAH6jNaApU").as_deref(), Some("ljAH6jNaApU"));
        assert_eq!(video_id_from("ljAH6jNaApU").as_deref(), Some("ljAH6jNaApU"));
        assert!(video_id_from("https://example.com/watch?v=ljAH6jNaApU").is_none());
        assert!(video_id_from("https://youtube.com/watch?v=short").is_none());
    }

    #[test]
    fn parses_search_results() {
        let run = |t: &str, page: Option<&str>| match page {
            Some(p) => json!({ "text": t, "navigationEndpoint": { "browseEndpoint": { "browseEndpointContextSupportedConfigs": {
                "browseEndpointContextMusicConfig": { "pageType": p } } } } }),
            None => json!({ "text": t }),
        };
        let item = |title: &str, id: &str, second: Vec<Value>| json!({ "musicResponsiveListItemRenderer": {
            "playlistItemData": { "videoId": id },
            "thumbnail": { "musicThumbnailRenderer": { "thumbnail": { "thumbnails": [
                { "url": "https://lh3.googleusercontent.com/abc=w60-h60-l90-rj" } ] } } },
            "flexColumns": [
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": title }] } } },
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": second } } }
            ] } });
        let data = json!({ "contents": { "tabbedSearchResultsRenderer": { "tabs": [{ "tabRenderer": { "content": {
            "sectionListRenderer": { "contents": [{ "musicShelfRenderer": { "contents": [
                item("BbY WOW", "ljAH6jNaApU", vec![
                    run("KAROL G", Some("MUSIC_PAGE_TYPE_ARTIST")), run(", ", None), run("Judeline", None), run(" & ", None),
                    run("rusowsky", Some("MUSIC_PAGE_TYPE_ARTIST")), run(" • ", None),
                    run("NO ME ARREPIENTO", Some("MUSIC_PAGE_TYPE_ALBUM")), run(" • ", None), run("3:46", None)]),
                item("Global Warming", "q7xBoh0emqo", vec![
                    run("PitbullVEVO", Some("MUSIC_PAGE_TYPE_USER_CHANNEL")), run(" • ", None), run("639K views", None),
                    run(" • ", None), run("1:01:25", None)]),
                item("bad id", "x", vec![]),
            ] } }] } } } }] } } });
        let r = parse_results(&data, Source::Song);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].artists, vec!["KAROL G", "Judeline", "rusowsky"]);
        assert_eq!(r[0].album.as_deref(), Some("NO ME ARREPIENTO"));
        assert_eq!(r[0].duration, Some(226.0));
        assert_eq!(r[0].thumbnail.as_deref(), Some("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj"));
        assert_eq!(r[1].artists, vec!["Pitbull"]);
        assert_eq!(r[1].duration, Some(3685.0));
    }

    #[test]
    fn cache_keeps_manual_choice() {
        let db = Db::open_in_memory().unwrap();
        assert!(cached(&db, "s1").unwrap().is_none());
        save(&db, "s1", None, false).unwrap();
        assert_eq!(cached(&db, "s1").unwrap().unwrap().status, MatchStatus::NotFound);
        let mut pick = c("Song", &["A"], 100.0, Source::Video);
        pick.score = 0.5;
        save(&db, "s1", Some(&pick), true).unwrap();
        let hit = cached(&db, "s1").unwrap().unwrap();
        assert!(hit.manual && hit.status == MatchStatus::Matched);
        assert_eq!(hit.candidate.unwrap(), pick);
    }

    /// Live check against YouTube Music: `cargo test live_matching -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_matching() {
        for (title, artists, secs) in [
            ("BbY WOW", vec!["KAROL G", "Judeline", "rusowsky"], 226),
            ("Global Warming (feat. Sensato)", vec!["Pitbull", "Sensato"], 85),
            ("Blinding Lights", vec!["The Weeknd"], 200),
        ] {
            let query = Query { id: "x".into(), title: title.into(), artists: artists.iter().map(|s| s.to_string()).collect(), duration_ms: secs * 1000 };
            let found = find(&query, false).await.unwrap();
            let best = &found[0];
            println!("{title} → {} / {:?} ({:.3})", best.title, best.artists, best.score);
            assert!(best.score >= ACCEPT);
        }
    }
}

/// Match a whole real playlist and print every result:
/// `GRAB_SPOTIFY=<link> cargo test live_playlist -- --ignored --nocapture`
#[cfg(test)]
#[tokio::test]
#[ignore]
async fn live_playlist() {
    let url = std::env::var("GRAB_SPOTIFY").unwrap_or_else(|_| "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M".into());
    let coll = crate::spotify::fetch(&crate::spotify::parse_link(&url).unwrap()).await.unwrap();
    let mut misses = 0;
    for chunk in coll.tracks.chunks(3) {
        let found = futures_join(chunk).await;
        for (t, best) in chunk.iter().zip(found) {
            let ok = best.as_ref().is_some_and(|c| c.score >= ACCEPT);
            if !ok {
                misses += 1;
            }
            println!(
                "{} {:>3} {} — {} ({}s)\n        → {}",
                if ok { "OK  " } else { "MISS" },
                t.position,
                t.title,
                t.artists.join(", "),
                t.duration_ms / 1000,
                best.map(|c| format!("[{:.3}] {} — {} ({:?}s, {:?}) {}", c.score, c.title, c.artists.join(", "), c.duration, c.source, c.video_id)).unwrap_or_default()
            );
        }
    }
    println!("{} of {} matched", coll.tracks.len() - misses, coll.tracks.len());
}

#[cfg(test)]
async fn futures_join(chunk: &[crate::spotify::Track]) -> Vec<Option<Candidate>> {
    let tasks: Vec<_> = chunk
        .iter()
        .map(|t| {
            let q = Query { id: t.id.clone(), title: t.title.clone(), artists: t.artists.clone(), duration_ms: t.duration_ms };
            tokio::spawn(async move { find(&q, false).await.ok().and_then(|v| v.into_iter().next()) })
        })
        .collect();
    let mut out = Vec::new();
    for t in tasks {
        out.push(t.await.unwrap());
    }
    out
}
