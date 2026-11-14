//! Downloaded videos and where playback stopped.
//!
//! Files are played through Tauri's asset protocol. Its scope starts empty (tauri.conf.json);
//! only the download folders and files listed here are opened up, so the UI can't read
//! anything else on disk.

use std::path::Path;

use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{
    db::Db,
    error::{AppError, AppResult},
    jobs::{self, Kind, Status},
    settings::Settings,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoItem {
    pub job_id: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub path: String,
    pub size: Option<i64>,
    pub duration: Option<f64>,
    pub finished_at: Option<String>,
    /// Seconds watched (None = never played).
    pub position: Option<f64>,
    pub url: String,
}

/// Exports that are videos (not audio or GIFs) belong in the Videos library.
fn is_video_file(p: Option<&str>) -> bool {
    p.and_then(|p| Path::new(p).extension()).and_then(|e| e.to_str()).is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "mp4" | "mkv" | "webm" | "mov"))
}

/// Allow the player to read the download folders (called at startup and when settings change).
pub fn allow_folders(app: &AppHandle, s: &Settings) {
    let scope = app.asset_protocol_scope();
    for dir in [&s.video_dir, &s.music_dir].into_iter().chain(s.library_dirs.iter()) {
        if !dir.is_empty() {
            if let Err(e) = scope.allow_directory(dir, true) {
                tracing::warn!(%dir, error = %e, "couldn't allow folder for playback");
            }
        }
    }
}

/// Short song clips for the Fix match dialog. Emptied at every start.
pub fn previews_dir(app: &AppHandle) -> std::path::PathBuf {
    let base = app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("Grab"));
    base.join("previews")
}

pub fn reset_previews(app: &AppHandle) {
    let dir = previews_dir(app);
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    if let Err(e) = app.asset_protocol_scope().allow_directory(&dir, false) {
        tracing::warn!(error = %e, "couldn't allow previews folder");
    }
}

fn positions(db: &Db) -> AppResult<std::collections::HashMap<String, f64>> {
    db.with(|c| {
        let mut stmt = c.prepare("SELECT job_id, position FROM watch_progress")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?.collect::<Result<_, _>>()?;
        Ok(rows)
    })
}

/// Finished video downloads whose file still exists, newest first.
pub fn videos(app: &AppHandle, db: &Db) -> AppResult<Vec<VideoItem>> {
    let watched = positions(db)?;
    let scope = app.asset_protocol_scope();
    let items = jobs::list(db)?
        .into_iter()
        .filter(|j| j.status == Status::Done && (j.kind == Kind::Video || (j.kind == Kind::Export && is_video_file(j.file_path.as_deref()))))
        .filter_map(|j| {
            let path = j.file_path.clone()?;
            if !Path::new(&path).is_file() {
                return None;
            }
            // Files saved before a folder change live outside the current folders.
            let _ = scope.allow_file(&path);
            Some(VideoItem {
                position: watched.get(&j.id).copied(),
                job_id: j.id,
                title: j.title,
                thumbnail: j.thumbnail,
                path,
                size: j.file_size,
                duration: j.request.duration,
                finished_at: j.finished_at,
                url: j.url,
            })
        })
        .collect();
    Ok(items)
}

pub fn save_position(db: &Db, job_id: &str, position: f64, duration: Option<f64>) -> AppResult<()> {
    if !position.is_finite() || position < 0.0 {
        return Err(AppError::Invalid("Invalid position.".into()));
    }
    db.with(|c| {
        c.execute(
            "INSERT INTO watch_progress (job_id, position, duration) VALUES (?1, ?2, ?3)
             ON CONFLICT(job_id) DO UPDATE SET position = excluded.position,
               duration = COALESCE(excluded.duration, duration), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            params![job_id, position, duration],
        )?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_updates_positions() {
        let db = Db::open_in_memory().unwrap();
        save_position(&db, "j1", 12.5, Some(100.0)).unwrap();
        save_position(&db, "j1", 40.0, None).unwrap();
        assert_eq!(positions(&db).unwrap().get("j1"), Some(&40.0));
        let duration: Option<f64> = db
            .with(|c| Ok(c.query_row("SELECT duration FROM watch_progress WHERE job_id='j1'", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(duration, Some(100.0), "a missing duration keeps the known one");
        assert!(save_position(&db, "j1", f64::NAN, None).is_err());
    }
}
