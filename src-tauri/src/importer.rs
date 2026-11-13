//! Importing Spotify songs: turn matched tracks into tagged audio downloads, remember what was
//! imported from which album/playlist (for re-sync), and keep a Music playlist in Spotify's order.

use std::{collections::HashMap, path::Path, sync::Arc};

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::{
    db::Db,
    error::{AppError, AppResult},
    jobs::{self, DownloadOptions, DownloadRequest, Kind},
    matcher,
    settings::AudioFormat,
    spotify::LinkKind,
    tags::TrackTags,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCollection {
    /// spotify:playlist:ID
    pub uri: String,
    pub kind: LinkKind,
    pub name: String,
    pub owner: Option<String>,
    pub cover: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTrack {
    pub spotify_id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub position: u32,
    pub duration_ms: u64,
    pub video_id: String,
    /// From the YouTube Music match (playlists don't list albums).
    pub album: Option<String>,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub collection: ImportCollection,
    pub tracks: Vec<ImportTrack>,
    /// Every Spotify track id in Spotify's order, so the playlist can follow reordering.
    #[serde(default)]
    pub order: Vec<String>,
    pub audio_format: AudioFormat,
    pub add_to_playlist: bool,
}

fn check(req: &ImportRequest) -> AppResult<()> {
    let c = &req.collection;
    let uri_ok = c.uri.split(':').collect::<Vec<_>>().as_slice().len() == 3
        && c.uri.starts_with("spotify:")
        && c.uri.len() <= 80
        && c.uri.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == ':');
    if !uri_ok || c.name.len() > 500 {
        return Err(AppError::Invalid("Invalid Spotify link.".into()));
    }
    if req.tracks.is_empty() {
        return Err(AppError::Invalid("Pick at least one song.".into()));
    }
    for t in &req.tracks {
        matcher::check_query(&matcher::Query {
            id: t.spotify_id.clone(),
            title: t.title.clone(),
            artists: t.artists.clone(),
            duration_ms: t.duration_ms,
        })?;
        if !matcher::valid_video_id(&t.video_id) {
            return Err(AppError::Invalid(format!("“{}” has no match yet.", t.title)));
        }
    }
    Ok(())
}

/// One tagged audio download per track.
pub fn build_requests(req: &ImportRequest) -> Vec<DownloadRequest> {
    let c = &req.collection;
    req.tracks
        .iter()
        .map(|t| {
            let is_album = c.kind == LinkKind::Album;
            let tags = TrackTags {
                title: t.title.clone(),
                artists: t.artists.clone(),
                album: if is_album { Some(c.name.clone()) } else { t.album.clone() },
                album_artist: if is_album { c.owner.clone() } else { None },
                track_number: is_album.then_some(t.position),
                // Album and single-song covers come from Spotify; playlist songs use their own
                // album art from YouTube Music (the playlist cover would be wrong on every song).
                cover: match c.kind {
                    LinkKind::Album | LinkKind::Track => c.cover.clone().or_else(|| t.thumbnail.clone()),
                    LinkKind::Playlist => t.thumbnail.clone(),
                },
                source: Some(c.uri.clone()),
                source_track: Some(t.spotify_id.clone()),
            };
            DownloadRequest {
                url: format!("https://music.youtube.com/watch?v={}", t.video_id),
                title: format!("{} · {}", t.title, t.artists.first().map(String::as_str).unwrap_or("")),
                thumbnail: tags.cover.clone(),
                kind: Kind::Audio,
                quality: "best".into(),
                audio_format: req.audio_format,
                group_id: Some(c.uri.clone()),
                group_title: Some(c.name.clone()),
                options: DownloadOptions::default(),
                duration: Some(t.duration_ms as f64 / 1000.0),
                tags: Some(tags),
            }
        })
        .collect()
}

pub fn import(db: &Db, jobs: &Arc<jobs::Manager>, req: ImportRequest) -> AppResult<usize> {
    check(&req)?;
    let ids = jobs.enqueue_many(build_requests(&req))?;
    let c = &req.collection;
    let playlist = req.add_to_playlist && c.kind != LinkKind::Track;
    db.with(|conn| {
        let tx = conn.transaction()?;
        for (t, job_id) in req.tracks.iter().zip(&ids) {
            tx.execute(
                "INSERT INTO spotify_imports (source, track_id, job_id) VALUES (?1, ?2, ?3)
                 ON CONFLICT(source, track_id) DO UPDATE SET job_id = excluded.job_id, file_path = NULL,
                   imported_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                params![c.uri, t.spotify_id, job_id],
            )?;
        }
        if playlist {
            tx.execute(
                "INSERT INTO playlists (id, name, cover, source) VALUES (?1, ?2, ?3, ?1)
                 ON CONFLICT(source) DO UPDATE SET name = excluded.name, cover = excluded.cover,
                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                params![c.uri, c.name, c.cover],
            )?;
            let playlist_id: String = tx.query_row("SELECT id FROM playlists WHERE source = ?1", [&c.uri], |r| r.get(0))?;
            for t in &req.tracks {
                tx.execute(
                    "INSERT INTO playlist_tracks (playlist_id, track_ref, position) VALUES (?1, ?2, ?3)
                     ON CONFLICT(playlist_id, track_ref) DO UPDATE SET position = excluded.position",
                    params![playlist_id, format!("spotify:track:{}", t.spotify_id), t.position],
                )?;
            }
            // Songs imported earlier follow Spotify's current order too.
            for (i, id) in req.order.iter().enumerate() {
                tx.execute(
                    "UPDATE playlist_tracks SET position = ?3 WHERE playlist_id = ?1 AND track_ref = ?2",
                    params![playlist_id, format!("spotify:track:{id}"), i as i64 + 1],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    })?;
    tracing::info!(source = %c.uri, count = ids.len(), playlist, "spotify import queued");
    Ok(ids.len())
}

/// A finished download: remember where the file is.
pub fn complete(db: &Db, tags: &TrackTags, path: &str) -> AppResult<()> {
    let (Some(source), Some(track)) = (&tags.source, &tags.source_track) else { return Ok(()) };
    db.with(|c| {
        c.execute(
            "UPDATE spotify_imports SET file_path = ?3 WHERE source = ?1 AND track_id = ?2",
            params![source, track, path],
        )?;
        c.execute(
            "UPDATE playlist_tracks SET path = ?3
             WHERE track_ref = ?2 AND playlist_id IN (SELECT id FROM playlists WHERE source = ?1)",
            params![source, format!("spotify:track:{track}"), path],
        )?;
        Ok(())
    })
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TrackState {
    /// The file exists.
    Downloaded,
    /// Queued, downloading or paused.
    Queued,
    /// Imported before but failed, was cancelled or the file is gone: offered again.
    Missing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTrack {
    pub state: TrackState,
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportState {
    pub last_import: Option<String>,
    pub tracks: HashMap<String, ImportedTrack>,
    pub in_playlist: bool,
}

/// track id, job id, file path, job status, imported at
type ImportRow = (String, String, Option<String>, Option<String>, String);

/// What was imported from this album/playlist before (drives "12 new songs since last import").
pub fn state(db: &Db, uri: &str) -> AppResult<ImportState> {
    let rows: Vec<ImportRow> = db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT i.track_id, i.job_id, i.file_path, j.status, i.imported_at
             FROM spotify_imports i LEFT JOIN jobs j ON j.id = i.job_id WHERE i.source = ?1",
        )?;
        let rows = stmt
            .query_map([uri], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    let in_playlist = db.with(|c| Ok(c.query_row("SELECT COUNT(*) FROM playlists WHERE source = ?1", [uri], |r| r.get::<_, i64>(0))? > 0))?;
    let last_import = rows.iter().map(|r| r.4.clone()).max();
    let tracks = rows
        .into_iter()
        .map(|(track, job_id, path, status, _)| {
            let state = match (path, status.as_deref()) {
                (Some(p), _) if Path::new(&p).is_file() => TrackState::Downloaded,
                (_, Some("queued" | "running" | "paused")) => TrackState::Queued,
                _ => TrackState::Missing,
            };
            (track, ImportedTrack { state, job_id })
        })
        .collect();
    Ok(ImportState { last_import, tracks, in_playlist })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(kind: LinkKind) -> ImportRequest {
        ImportRequest {
            collection: ImportCollection {
                uri: format!("spotify:{}:abc", kind.as_str()),
                kind,
                name: "Global Warming".into(),
                owner: Some("Pitbull".into()),
                cover: Some("https://i.scdn.co/image/album".into()),
            },
            tracks: vec![ImportTrack {
                spotify_id: "t1".into(),
                title: "Global Warming (feat. Sensato)".into(),
                artists: vec!["Pitbull".into(), "Sensato".into()],
                position: 1,
                duration_ms: 85_400,
                video_id: "q7xBoh0emqo".into(),
                album: Some("YTM Album".into()),
                thumbnail: Some("https://lh3.googleusercontent.com/x=w544-h544-l90-rj".into()),
            }],
            order: vec![],
            audio_format: AudioFormat::Opus,
            add_to_playlist: true,
        }
    }

    #[test]
    fn album_imports_use_spotify_album_details() {
        let r = &build_requests(&req(LinkKind::Album))[0];
        let t = r.tags.as_ref().unwrap();
        assert_eq!(r.url, "https://music.youtube.com/watch?v=q7xBoh0emqo");
        assert_eq!((r.kind, r.group_id.as_deref()), (Kind::Audio, Some("spotify:album:abc")));
        assert_eq!((t.album.as_deref(), t.album_artist.as_deref(), t.track_number), (Some("Global Warming"), Some("Pitbull"), Some(1)));
        assert_eq!(t.cover.as_deref(), Some("https://i.scdn.co/image/album"));
    }

    #[test]
    fn playlist_imports_use_each_songs_own_album() {
        let r = &build_requests(&req(LinkKind::Playlist))[0];
        let t = r.tags.as_ref().unwrap();
        assert_eq!((t.album.as_deref(), t.track_number), (Some("YTM Album"), None));
        assert!(t.cover.as_deref().unwrap().contains("googleusercontent"));
    }

    #[test]
    fn rejects_unmatched_or_bad_tracks() {
        let mut r = req(LinkKind::Playlist);
        r.tracks[0].video_id = String::new();
        assert!(check(&r).is_err());
        let mut r = req(LinkKind::Playlist);
        r.collection.uri = "spotify:playlist:a b".into();
        assert!(check(&r).is_err());
        let mut r = req(LinkKind::Playlist);
        r.tracks.clear();
        assert!(check(&r).is_err());
        assert!(check(&req(LinkKind::Playlist)).is_ok());
    }

    #[test]
    fn state_reflects_jobs_and_files() {
        let db = Db::open_in_memory().unwrap();
        let file = std::env::temp_dir().join("grab-importer-test.opus");
        std::fs::write(&file, b"x").unwrap();
        db.with(|c| {
            c.execute_batch(
                "INSERT INTO jobs (id, kind, url, title, request, status) VALUES
                   ('j1','audio','u','t','{}','done'), ('j2','audio','u','t','{}','queued'), ('j3','audio','u','t','{}','failed');
                 INSERT INTO spotify_imports (source, track_id, job_id) VALUES
                   ('spotify:playlist:p','a','j1'), ('spotify:playlist:p','b','j2'), ('spotify:playlist:p','c','j3'),
                   ('spotify:playlist:p','d','gone');",
            )?;
            Ok(())
        })
        .unwrap();
        let tags = TrackTags { source: Some("spotify:playlist:p".into()), source_track: Some("a".into()), ..TrackTags::default() };
        complete(&db, &tags, &file.display().to_string()).unwrap();
        let s = state(&db, "spotify:playlist:p").unwrap();
        assert_eq!(s.tracks["a"].state, TrackState::Downloaded);
        assert_eq!(s.tracks["b"].state, TrackState::Queued);
        assert_eq!(s.tracks["c"].state, TrackState::Missing);
        assert_eq!(s.tracks["d"].state, TrackState::Missing, "cleared job, no file");
        assert!(s.last_import.is_some() && !s.in_playlist);
        let _ = std::fs::remove_file(file);
    }
}
