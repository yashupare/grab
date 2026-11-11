//! Typed app settings. Stored one row per field (key → JSON) so adding a field later needs no
//! migration: missing keys fall back to defaults, and a bad stored value is ignored with a warning.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{
    db::Db,
    error::{AppError, AppResult},
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AudioFormat {
    /// Original Opus stream, no re-encoding (best quality from YouTube)
    Opus,
    /// Original AAC stream, no re-encoding (plays everywhere)
    M4a,
    /// Converted MP3 (compatibility only)
    Mp3,
}

/// SponsorBlock: community-marked sponsor segments in YouTube videos.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SponsorBlock {
    #[default]
    Off,
    /// Cut sponsor, self-promotion and "like & subscribe" segments out.
    Remove,
    /// Keep them, but mark them as chapters.
    Mark,
}

pub const VIDEO_QUALITIES: &[&str] = &["best", "2160", "1440", "1080", "720", "480", "360"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: Theme,
    pub video_dir: String,
    pub music_dir: String,
    /// Extra folders scanned into the music/video library.
    pub library_dirs: Vec<String>,
    pub video_quality: String,
    pub audio_format: AudioFormat,
    pub concurrent_downloads: u8,
    pub filename_template: String,
    pub close_to_tray: bool,
    pub notifications: bool,
    /// Default for new downloads (YouTube only).
    pub sponsorblock: SponsorBlock,
    /// Subtitle languages to pre-select when a video has them, e.g. ["en"].
    pub subtitle_langs: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            video_dir: String::new(),
            music_dir: String::new(),
            library_dirs: Vec::new(),
            video_quality: "1080".into(),
            audio_format: AudioFormat::Opus,
            concurrent_downloads: 3,
            filename_template: "%(title)s [%(id)s].%(ext)s".into(),
            close_to_tray: true,
            notifications: true,
            sponsorblock: SponsorBlock::Off,
            subtitle_langs: Vec::new(),
        }
    }
}

impl Settings {
    pub fn validate(&self) -> AppResult<()> {
        if !(1..=5).contains(&self.concurrent_downloads) {
            return Err(AppError::Invalid("Simultaneous downloads must be between 1 and 5.".into()));
        }
        if !VIDEO_QUALITIES.contains(&self.video_quality.as_str()) {
            return Err(AppError::Invalid(format!("Unknown video quality '{}'.", self.video_quality)));
        }
        for (name, dir) in [("Video folder", &self.video_dir), ("Music folder", &self.music_dir)] {
            // Empty means "use the default" (filled in at startup); anything else must be absolute.
            if !dir.is_empty() && !std::path::Path::new(dir).is_absolute() {
                return Err(AppError::Invalid(format!("{name} must be a full path, like C:\\Users\\you\\Videos.")));
            }
        }
        let t = self.filename_template.trim();
        if t.is_empty() || t.contains("..") || t.contains(':') {
            return Err(AppError::Invalid("File name pattern can't be empty or contain '..' or ':'.".into()));
        }
        Ok(())
    }
}

fn to_map(s: &Settings) -> AppResult<Map<String, Value>> {
    match serde_json::to_value(s)? {
        Value::Object(m) => Ok(m),
        _ => unreachable!("Settings serialises to an object"),
    }
}

/// Load settings: defaults overlaid with whatever valid values are stored.
pub fn load(db: &Db, defaults: &Settings) -> AppResult<Settings> {
    let rows: Vec<(String, String)> = db.with(|c| {
        let mut stmt = c.prepare("SELECT key, value FROM settings")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    })?;

    let mut merged = to_map(defaults)?;
    for (key, raw) in rows {
        if !merged.contains_key(&key) {
            continue; // setting from an older version that no longer exists
        }
        let Ok(value) = serde_json::from_str::<Value>(&raw) else { continue };
        // Check this one value on its own so one bad row can't reset everything.
        let mut probe = merged.clone();
        probe.insert(key.clone(), value.clone());
        if serde_json::from_value::<Settings>(Value::Object(probe)).is_ok() {
            merged.insert(key, value);
        } else {
            tracing::warn!(%key, "ignoring invalid stored setting");
        }
    }
    let settings: Settings = serde_json::from_value(Value::Object(merged))?;
    Ok(settings)
}

/// Apply a partial update (only known keys), validate, and save the changed fields.
pub fn update(db: &Db, defaults: &Settings, patch: Map<String, Value>) -> AppResult<Settings> {
    let current = load(db, defaults)?;
    let mut merged = to_map(&current)?;
    for (key, value) in &patch {
        if !merged.contains_key(key) {
            return Err(AppError::Invalid(format!("Unknown setting '{key}'.")));
        }
        merged.insert(key.clone(), value.clone());
    }
    let next: Settings = serde_json::from_value(Value::Object(merged.clone()))
        .map_err(|e| AppError::Invalid(format!("Invalid setting value: {e}")))?;
    next.validate()?;

    db.with(|c| {
        let tx = c.transaction()?;
        for key in patch.keys() {
            tx.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
                (key, serde_json::to_string(&merged[key])?),
            )?;
        }
        tx.commit()?;
        Ok(())
    })?;
    tracing::info!(keys = ?patch.keys().collect::<Vec<_>>(), "settings updated");
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn patch(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn empty_db_returns_defaults() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(load(&db, &Settings::default()).unwrap(), Settings::default());
    }

    #[test]
    fn update_persists_and_reloads() {
        let db = Db::open_in_memory().unwrap();
        let d = Settings::default();
        let s = update(&db, &d, patch(json!({ "theme": "dark", "concurrentDownloads": 5 }))).unwrap();
        assert_eq!(s.theme, Theme::Dark);
        let again = load(&db, &d).unwrap();
        assert_eq!(again.theme, Theme::Dark);
        assert_eq!(again.concurrent_downloads, 5);
    }

    #[test]
    fn rejects_out_of_range_and_unknown_keys() {
        let db = Db::open_in_memory().unwrap();
        let d = Settings::default();
        assert!(update(&db, &d, patch(json!({ "concurrentDownloads": 9 }))).is_err());
        assert!(update(&db, &d, patch(json!({ "videoQuality": "4k" }))).is_err());
        assert!(update(&db, &d, patch(json!({ "nope": true }))).is_err());
        assert!(update(&db, &d, patch(json!({ "filenameTemplate": "../x" }))).is_err());
        assert!(update(&db, &d, patch(json!({ "videoDir": "relative\\folder" }))).is_err());
        // nothing was saved by the rejected updates
        assert_eq!(load(&db, &d).unwrap(), d);
    }

    #[test]
    fn bad_stored_value_falls_back_to_default() {
        let db = Db::open_in_memory().unwrap();
        db.with(|c| {
            c.execute("INSERT INTO settings (key, value) VALUES ('theme', '\"purple\"')", [])?;
            c.execute("INSERT INTO settings (key, value) VALUES ('notifications', 'false')", [])?;
            Ok(())
        })
        .unwrap();
        let s = load(&db, &Settings::default()).unwrap();
        assert_eq!(s.theme, Theme::System);
        assert!(!s.notifications);
    }
}
