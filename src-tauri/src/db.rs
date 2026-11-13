//! SQLite storage with forward-only migrations tracked in `PRAGMA user_version`.
//!
//! Rules: never edit or reorder an existing migration; only append. A database written by a
//! newer app version refuses to open instead of being damaged.

use std::{path::Path, sync::Mutex};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Append-only. Index + 1 is the schema version.
const MIGRATIONS: &[&str] = &[
    // 1: settings (key → JSON value)
    "CREATE TABLE settings (
        key        TEXT PRIMARY KEY NOT NULL,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );",
    // 2: download jobs (queue + history)
    "CREATE TABLE jobs (
        id          TEXT PRIMARY KEY NOT NULL,
        kind        TEXT NOT NULL,
        url         TEXT NOT NULL,
        title       TEXT NOT NULL,
        thumbnail   TEXT,
        request     TEXT NOT NULL,
        status      TEXT NOT NULL,
        progress    REAL NOT NULL DEFAULT 0,
        error       TEXT,
        file_path   TEXT,
        file_size   INTEGER,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        finished_at TEXT
    );
    CREATE INDEX jobs_by_status ON jobs (status, created_at);",
    // 3: where playback stopped, per downloaded file
    "CREATE TABLE watch_progress (
        job_id     TEXT PRIMARY KEY NOT NULL,
        position   REAL NOT NULL,
        duration   REAL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );",
    // 4: Spotify import: song → YouTube Music matches, what was imported from where, playlists
    "CREATE TABLE spotify_matches (
        spotify_id TEXT PRIMARY KEY NOT NULL,
        video_id   TEXT,              -- NULL: searched, nothing good found
        title      TEXT,
        artists    TEXT NOT NULL DEFAULT '[]',
        album      TEXT,
        duration   REAL,
        thumbnail  TEXT,
        source     TEXT NOT NULL DEFAULT 'song',
        score      REAL NOT NULL DEFAULT 0,
        manual     INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE spotify_imports (
        source      TEXT NOT NULL,    -- spotify:playlist:ID
        track_id    TEXT NOT NULL,
        job_id      TEXT NOT NULL,
        file_path   TEXT,             -- set when the download finishes
        imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (source, track_id)
    );
    CREATE TABLE playlists (
        id         TEXT PRIMARY KEY NOT NULL,
        name       TEXT NOT NULL,
        cover      TEXT,
        source     TEXT UNIQUE,       -- spotify:playlist:ID for imported playlists
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE playlist_tracks (
        playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
        track_ref   TEXT NOT NULL,    -- spotify:track:ID
        position    INTEGER NOT NULL,
        path        TEXT,             -- set when the download finishes
        PRIMARY KEY (playlist_id, track_ref)
    );",
];

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> AppResult<Self> {
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get::<_, String>(0))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        migrate(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Run `f` with exclusive access to the connection.
    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Invalid("database lock poisoned".into()))?;
        f(&mut conn)
    }

    pub fn schema_version(&self) -> AppResult<usize> {
        self.with(|c| Ok(user_version(c)?))
    }
}

fn user_version(conn: &Connection) -> rusqlite::Result<usize> {
    conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).map(|v| v as usize)
}

fn migrate(conn: &mut Connection) -> AppResult<()> {
    let current = user_version(conn)?;
    if current > MIGRATIONS.len() {
        return Err(AppError::Invalid(format!(
            "This data was saved by a newer version of Grab (schema {current}). Please update the app."
        )));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
        tracing::info!(version = i + 1, "applied database migration");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_all_migrations() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len());
    }

    #[test]
    fn migrating_twice_is_a_no_op() {
        let db = Db::open_in_memory().unwrap();
        db.with(|c| migrate(c)).unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len());
    }

    #[test]
    fn refuses_newer_schema() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", 999).unwrap();
        assert!(matches!(migrate(&mut conn), Err(AppError::Invalid(_))));
    }
}
