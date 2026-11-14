//! The music library: songs found in the music folders (Music\Grab plus Settings → Library
//! folders), with their tags and cover art, kept up to date by a folder watcher.
//!
//! Scans are incremental: a file is only read again when its size or modified time changes.
//! Cover art embedded in files is saved once per distinct image to a cache folder; a
//! cover.jpg/folder.jpg next to the songs is used when a file has none.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, UNIX_EPOCH},
};

use lofty::{file::TaggedFile, picture::MimeType, prelude::*};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer, notify::RecommendedWatcher};
use rusqlite::params;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    AppState,
    db::Db,
    error::{AppError, AppResult},
    settings::{self, Settings},
};

/// Formats the player (WebView2) can play and lofty can read.
const AUDIO_EXTS: &[&str] = &["mp3", "m4a", "aac", "opus", "ogg", "oga", "flac", "wav"];
const FOLDER_COVERS: &[&str] = &["cover.jpg", "folder.jpg", "front.jpg", "albumart.jpg", "cover.png", "folder.png"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub path: String,
    pub title: String,
    /// As tagged: "Pitbull, Sensato".
    pub artist: String,
    /// Split for links: ["Pitbull", "Sensato"].
    pub artists: Vec<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub duration: f64,
    pub format: String,
    pub cover: Option<String>,
    pub added_at: String,
    pub liked: bool,
}

/// "A, B & C" → ["A", "B", "C"]; "A; B" too. Names with commas inside ("Tyler, The Creator")
/// get split as well: a known limit of single-string artist tags.
pub fn split_artists(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for part in s.split([',', ';', '/']).flat_map(|p| p.split(" & ")).flat_map(|p| p.split(" feat. ")) {
        let name = part.trim();
        if !name.is_empty() && !out.iter().any(|a| a.eq_ignore_ascii_case(name)) {
            out.push(name.to_string());
        }
    }
    out
}

// ---------------------------------------------------------------- reading files

/// What a scan learns from one file.
#[derive(Debug, Clone, PartialEq)]
pub struct Scanned {
    pub path: String,
    pub size: i64,
    pub mtime: i64,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub duration: f64,
    pub bitrate: Option<u32>,
    pub format: String,
    pub cover: Option<String>,
}

fn is_audio(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| AUDIO_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Title and artist from a file name like "Artist - Title [id].opus" when tags are missing.
pub fn guess_from_name(stem: &str) -> (String, Option<String>) {
    // Drop a trailing " [videoid]" that yt-dlp's default template adds.
    let stem = match stem.rfind(" [") {
        Some(i) if stem.ends_with(']') => &stem[..i],
        _ => stem,
    };
    match stem.split_once(" - ") {
        Some((a, t)) if !a.trim().is_empty() && !t.trim().is_empty() => (t.trim().to_string(), Some(a.trim().to_string())),
        _ => (stem.trim().to_string(), None),
    }
}

fn clean(s: Option<std::borrow::Cow<'_, str>>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn read_file(path: &Path, size: i64, mtime: i64, covers: &Path) -> Scanned {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Untitled");
    let (name_title, name_artist) = guess_from_name(stem);
    let format = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mut s = Scanned {
        path: path.display().to_string(),
        size,
        mtime,
        title: name_title,
        artist: name_artist.unwrap_or_else(|| "Unknown artist".into()),
        album: None,
        album_artist: None,
        track_no: None,
        disc_no: None,
        year: None,
        genre: None,
        duration: 0.0,
        bitrate: None,
        format,
        cover: None,
    };
    match lofty::read_from_path(path) {
        Ok(file) => fill_from_tags(&mut s, &file, covers),
        Err(e) => tracing::debug!(path = %path.display(), error = %e, "couldn't read tags"),
    }
    if s.cover.is_none() {
        s.cover = folder_cover(path);
    }
    s
}

fn fill_from_tags(s: &mut Scanned, file: &TaggedFile, covers: &Path) {
    let props = file.properties();
    s.duration = props.duration().as_secs_f64();
    s.bitrate = props.audio_bitrate();
    let Some(tag) = file.primary_tag().or_else(|| file.first_tag()) else { return };
    if let Some(t) = clean(tag.title()) {
        s.title = t;
    }
    if let Some(a) = clean(tag.artist()) {
        s.artist = a;
    }
    s.album = clean(tag.album());
    s.album_artist = tag.get_string(ItemKey::AlbumArtist).map(str::trim).filter(|v| !v.is_empty()).map(String::from);
    s.track_no = tag.track();
    s.disc_no = tag.disk();
    s.year = tag.date().map(|d| d.year as u32).filter(|y| *y > 0);
    s.genre = clean(tag.genre());
    let pic = tag
        .pictures()
        .iter()
        .find(|p| p.pic_type() == lofty::picture::PictureType::CoverFront)
        .or_else(|| tag.pictures().first());
    if let Some(p) = pic {
        s.cover = save_cover(p.data(), p.mime_type(), covers);
    }
}

/// Save an embedded cover once per distinct image.
fn save_cover(data: &[u8], mime: Option<&MimeType>, covers: &Path) -> Option<String> {
    if data.len() < 100 {
        return None;
    }
    let ext = match mime {
        Some(MimeType::Png) => "png",
        Some(MimeType::Jpeg) | None => "jpg",
        Some(MimeType::Bmp) => "bmp",
        Some(MimeType::Gif) => "gif",
        _ => "jpg",
    };
    let hash = hex::encode(&Sha256::digest(data)[..12]);
    let file = covers.join(format!("{hash}.{ext}"));
    if !file.is_file()
        && let Err(e) = std::fs::write(&file, data)
    {
        tracing::warn!(error = %e, "couldn't save cover");
        return None;
    }
    Some(file.display().to_string())
}

fn folder_cover(song: &Path) -> Option<String> {
    let dir = song.parent()?;
    FOLDER_COVERS.iter().map(|n| dir.join(n)).find(|p| p.is_file()).map(|p| p.display().to_string())
}

/// Every audio file under the roots, with size and modified time. Skips hidden and system folders.
fn walk(roots: &[PathBuf]) -> Vec<(PathBuf, i64, i64)> {
    let mut out = Vec::new();
    let mut seen_dirs = HashSet::new();
    let mut stack: Vec<PathBuf> = roots.to_vec();
    while let Some(dir) = stack.pop() {
        let Ok(canon) = dir.canonicalize() else { continue };
        if !seen_dirs.insert(canon) {
            continue; // overlapping roots
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let name = e.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || name.starts_with('$') || name.eq_ignore_ascii_case("System Volume Information") {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            let path = e.path();
            if ft.is_dir() {
                stack.push(path);
            } else if ft.is_file()
                && is_audio(&path)
                && let Ok(m) = e.metadata()
            {
                let mtime = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs() as i64);
                out.push((path, m.len() as i64, mtime));
            }
        }
    }
    out
}

// ---------------------------------------------------------------- database

#[derive(Debug, Default, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanStats {
    pub total: usize,
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
}

impl ScanStats {
    pub fn changed(&self) -> bool {
        self.added + self.updated + self.removed > 0
    }
}

fn known(db: &Db) -> AppResult<HashMap<String, (i64, i64)>> {
    db.with(|c| {
        let mut stmt = c.prepare("SELECT path, size, mtime FROM tracks")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))?.collect::<Result<_, _>>()?;
        Ok(rows)
    })
}

pub fn save(db: &Db, rows: &[Scanned]) -> AppResult<()> {
    db.with(|c| {
        let tx = c.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO tracks (path, size, mtime, title, artist, album, album_artist, track_no, disc_no, year, genre,
                   duration, bitrate, format, cover, added_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                   strftime('%Y-%m-%dT%H:%M:%fZ', MIN(?3, CAST(strftime('%s', 'now') AS INTEGER)), 'unixepoch'))
                 ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, title = excluded.title,
                   artist = excluded.artist, album = excluded.album, album_artist = excluded.album_artist,
                   track_no = excluded.track_no, disc_no = excluded.disc_no, year = excluded.year, genre = excluded.genre,
                   duration = excluded.duration, bitrate = excluded.bitrate, format = excluded.format, cover = excluded.cover",
            )?;
            for s in rows {
                stmt.execute(params![
                    s.path, s.size, s.mtime, s.title, s.artist, s.album, s.album_artist, s.track_no, s.disc_no, s.year,
                    s.genre, s.duration, s.bitrate, s.format, s.cover
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

/// Scan the roots and bring the `tracks` table in line with what's on disk.
pub fn scan(db: &Db, roots: &[PathBuf], covers: &Path) -> AppResult<ScanStats> {
    std::fs::create_dir_all(covers)?;
    let before = known(db)?;
    let files = walk(roots);
    let mut stats = ScanStats { total: files.len(), ..Default::default() };
    let on_disk: HashSet<String> = files.iter().map(|(p, ..)| p.display().to_string()).collect();

    let mut batch = Vec::new();
    for (path, size, mtime) in &files {
        let key = path.display().to_string();
        match before.get(&key) {
            Some(&(s, m)) if s == *size && m == *mtime => continue,
            Some(_) => stats.updated += 1,
            None => stats.added += 1,
        }
        batch.push(read_file(path, *size, *mtime, covers));
        if batch.len() >= 200 {
            save(db, &batch)?;
            batch.clear();
        }
    }
    save(db, &batch)?;

    let gone: Vec<&String> = before.keys().filter(|p| !on_disk.contains(*p)).collect();
    stats.removed = gone.len();
    if !gone.is_empty() {
        db.with(|c| {
            let tx = c.transaction()?;
            for p in &gone {
                tx.execute("DELETE FROM tracks WHERE path = ?1", [p])?;
            }
            tx.commit()?;
            Ok(())
        })?;
    }
    Ok(stats)
}

pub(crate) fn row_to_track(r: &rusqlite::Row) -> rusqlite::Result<Track> {
    let artist: String = r.get("artist")?;
    Ok(Track {
        id: r.get("id")?,
        path: r.get("path")?,
        title: r.get("title")?,
        artists: split_artists(&artist),
        artist,
        album: r.get("album")?,
        album_artist: r.get("album_artist")?,
        track_no: r.get("track_no")?,
        disc_no: r.get("disc_no")?,
        year: r.get("year")?,
        genre: r.get("genre")?,
        duration: r.get("duration")?,
        format: r.get("format")?,
        cover: r.get("cover")?,
        added_at: r.get("added_at")?,
        liked: r.get("liked")?,
    })
}

pub fn tracks(db: &Db) -> AppResult<Vec<Track>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT t.*, (l.path IS NOT NULL) AS liked FROM tracks t LEFT JOIN likes l ON l.path = t.path
             ORDER BY t.added_at DESC, t.id DESC",
        )?;
        let rows = stmt.query_map([], row_to_track)?.collect::<Result<_, _>>()?;
        Ok(rows)
    })
}

pub fn set_liked(db: &Db, ids: &[i64], liked: bool) -> AppResult<()> {
    db.with(|c| {
        let tx = c.transaction()?;
        for id in ids {
            if liked {
                tx.execute("INSERT OR IGNORE INTO likes (path) SELECT path FROM tracks WHERE id = ?1", [id])?;
            } else {
                tx.execute("DELETE FROM likes WHERE path = (SELECT path FROM tracks WHERE id = ?1)", [id])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

/// Path of a library song by id (the UI passes ids, never paths).
pub fn track_path(db: &Db, id: i64) -> AppResult<String> {
    db.with(|c| {
        c.query_row("SELECT path FROM tracks WHERE id = ?1", [id], |r| r.get(0))
            .map_err(|_| AppError::Invalid("That song is no longer in your library.".into()))
    })
}

// ---------------------------------------------------------------- service: scanning + watching

pub fn roots(s: &Settings) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for d in std::iter::once(&s.music_dir).chain(s.library_dirs.iter()) {
        let p = PathBuf::from(d);
        if !d.is_empty() && !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

pub struct Library {
    app: AppHandle,
    running: AtomicBool,
    /// A change arrived while scanning: scan again when done.
    again: AtomicBool,
    watcher: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}

impl Library {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self { app, running: AtomicBool::new(false), again: AtomicBool::new(false), watcher: Mutex::new(None) })
    }

    pub fn covers_dir(app: &AppHandle) -> PathBuf {
        app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("Grab")).join("covers")
    }

    fn settings(&self) -> AppResult<Settings> {
        let st = self.app.state::<AppState>();
        settings::load(&st.db, &st.default_settings)
    }

    /// Start watching the library folders and run a first scan.
    pub fn start(self: &Arc<Self>) {
        let covers = Self::covers_dir(&self.app);
        let _ = std::fs::create_dir_all(&covers);
        if let Err(e) = self.app.asset_protocol_scope().allow_directory(&covers, false) {
            tracing::warn!(error = %e, "couldn't allow covers folder");
        }
        self.rewatch();
        self.rescan();
    }

    /// Watch the current library folders (call again when they change in Settings).
    pub fn rewatch(self: &Arc<Self>) {
        let roots = match self.settings() {
            Ok(s) => roots(&s),
            Err(_) => return,
        };
        let me = Arc::downgrade(self);
        let debouncer = new_debouncer(Duration::from_secs(2), move |res: DebounceEventResult| {
            let relevant = match &res {
                Ok(events) => events.iter().any(|e| is_audio(&e.path) || e.path.extension().is_none()),
                Err(_) => false,
            };
            if relevant && let Some(me) = me.upgrade() {
                me.rescan();
            }
        });
        match debouncer {
            Ok(mut d) => {
                for r in &roots {
                    let _ = std::fs::create_dir_all(r);
                    if let Err(e) = d.watcher().watch(r, notify_debouncer_mini::notify::RecursiveMode::Recursive) {
                        tracing::warn!(root = %r.display(), error = %e, "couldn't watch folder");
                    }
                }
                if let Ok(mut w) = self.watcher.lock() {
                    *w = Some(d);
                }
            }
            Err(e) => tracing::warn!(error = %e, "folder watcher unavailable"),
        }
    }

    /// Scan in the background. Calls while a scan runs are folded into one follow-up scan.
    pub fn rescan(self: &Arc<Self>) {
        if self.running.swap(true, Ordering::SeqCst) {
            self.again.store(true, Ordering::SeqCst);
            return;
        }
        let me = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            loop {
                me.again.store(false, Ordering::SeqCst);
                let result = me.settings().and_then(|s| {
                    let st = me.app.state::<AppState>();
                    scan(&st.db, &roots(&s), &Self::covers_dir(&me.app))
                });
                match result {
                    Ok(stats) => {
                        tracing::info!(?stats, "library scanned");
                        if stats.changed() {
                            let _ = me.app.emit("library-changed", stats);
                        }
                    }
                    Err(e) => tracing::warn!(error = %e, "library scan failed"),
                }
                if !me.again.load(Ordering::SeqCst) {
                    break;
                }
            }
            me.running.store(false, Ordering::SeqCst);
        });
    }

    pub fn scanning(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tags::{self, TrackTags};

    #[test]
    fn splits_artists() {
        assert_eq!(split_artists("Pitbull, Sensato"), vec!["Pitbull", "Sensato"]);
        assert_eq!(split_artists("A & B; C feat. D"), vec!["A", "B", "C", "D"]);
        assert_eq!(split_artists("Solo"), vec!["Solo"]);
        assert!(split_artists(" ").is_empty());
    }

    #[test]
    fn guesses_names() {
        assert_eq!(guess_from_name("Pitbull - Global Warming"), ("Global Warming".into(), Some("Pitbull".into())));
        assert_eq!(guess_from_name("Some Video [dQw4w9WgXcQ]"), ("Some Video".into(), None));
        assert_eq!(guess_from_name("A - B - C [x]"), ("B - C".into(), Some("A".into())));
    }

    /// A real (tiny) Opus file, made by ffmpeg when it's installed; otherwise the test is skipped.
    fn make_opus(dir: &Path, name: &str) -> Option<PathBuf> {
        let installed = std::env::var("LOCALAPPDATA").ok().map(|d| PathBuf::from(d).join("app.grab.desktop/tools/ffmpeg.exe"));
        let ffmpeg = crate::tools::locate("ffmpeg").0.or(installed.filter(|p| p.is_file()))?;
        let out = dir.join(name);
        let ok = std::process::Command::new(ffmpeg)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "libopus"])
            .arg(&out)
            .status()
            .ok()?
            .success();
        ok.then_some(out)
    }

    #[test]
    fn scans_incrementally_and_keeps_likes() {
        let root = std::env::temp_dir().join(format!("grab-music-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("Album")).unwrap();
        let Some(song) = make_opus(&root.join("Album"), "Artist X - Tone.opus") else {
            eprintln!("ffmpeg not found; skipping");
            return;
        };
        let covers = root.join("covers");
        let db = Db::open_in_memory().unwrap();

        // Untagged file: name is used.
        let s = scan(&db, std::slice::from_ref(&root), &covers).unwrap();
        assert_eq!((s.total, s.added), (1, 1));
        let t = &tracks(&db).unwrap()[0];
        assert_eq!((t.title.as_str(), t.artist.as_str()), ("Tone", "Artist X"));
        assert!(t.duration > 1.5 && t.duration < 2.5, "{}", t.duration);

        // Nothing changed: nothing re-read.
        assert!(!scan(&db, std::slice::from_ref(&root), &covers).unwrap().changed());

        // Like it, then retag (changes size/mtime): updated, like kept, cover cached.
        set_liked(&db, &[t.id], true).unwrap();
        let png: Vec<u8> = [b"\x89PNG\r\n\x1a\n".as_slice(), &[0u8; 200]].concat();
        let tagz = TrackTags { title: "Real Title".into(), artists: vec!["A".into(), "B".into()], album: Some("LP".into()), track_number: Some(3), ..Default::default() };
        tags::write(&song, &tagz, Some(png)).unwrap(); // changes the size, so it's re-read
        let s = scan(&db, std::slice::from_ref(&root), &covers).unwrap();
        assert_eq!(s.updated, 1);
        let t = &tracks(&db).unwrap()[0];
        assert_eq!((t.title.as_str(), t.artists.clone(), t.album.as_deref(), t.track_no), ("Real Title", vec!["A".to_string(), "B".to_string()], Some("LP"), Some(3)));
        assert!(t.liked);
        assert!(t.cover.as_deref().is_some_and(|c| c.ends_with(".png") && Path::new(c).is_file()));

        // Deleted: removed from the library.
        std::fs::remove_file(&song).unwrap();
        assert_eq!(scan(&db, std::slice::from_ref(&root), &covers).unwrap().removed, 1);
        assert!(tracks(&db).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
