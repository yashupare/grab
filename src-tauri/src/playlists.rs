//! Playlists: made in Grab, or imported from Spotify (importer.rs fills those). Entries point at
//! files by path, so a playlist survives rescans; entries whose file is gone (or still
//! downloading) are counted as missing instead of shown.

use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use crate::{
    db::Db,
    error::{AppError, AppResult},
    music::{self, Track},
};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSummary {
    pub id: String,
    pub name: String,
    /// Imported from (spotify:playlist:ID), if any.
    pub source: Option<String>,
    /// Up to four covers of its songs, for a mosaic.
    pub covers: Vec<String>,
    pub count: usize,
    pub duration: f64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetail {
    #[serde(flatten)]
    pub summary: PlaylistSummary,
    pub tracks: Vec<Track>,
    /// Entries whose file isn't in the library (deleted, or an import still downloading).
    pub missing: usize,
}

fn new_id() -> String {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("pl-{nanos:x}")
}

fn check_name(name: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 120 {
        return Err(AppError::Invalid("Give the playlist a name (up to 120 characters).".into()));
    }
    Ok(n.to_string())
}

fn tracks_of(db: &Db, id: &str) -> AppResult<(Vec<Track>, usize)> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT t.*, (l.path IS NOT NULL) AS liked FROM playlist_tracks p
             JOIN tracks t ON t.path = p.path LEFT JOIN likes l ON l.path = t.path
             WHERE p.playlist_id = ?1 ORDER BY p.position, t.id",
        )?;
        let tracks: Vec<Track> = stmt.query_map([id], music::row_to_track)?.collect::<Result<_, _>>()?;
        let total: i64 = c.query_row("SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?1", [id], |r| r.get(0))?;
        let missing = (total as usize).saturating_sub(tracks.len());
        Ok((tracks, missing))
    })
}

fn summary(db: &Db, id: &str, tracks: &[Track]) -> AppResult<Option<PlaylistSummary>> {
    let row = db.with(|c| {
        Ok(c.query_row("SELECT name, source, updated_at FROM playlists WHERE id = ?1", [id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?))
        })
        .optional()?)
    })?;
    Ok(row.map(|(name, source, updated_at)| {
        let mut covers: Vec<String> = Vec::new();
        for t in tracks {
            if let Some(c) = &t.cover
                && !covers.contains(c)
            {
                covers.push(c.clone());
                if covers.len() == 4 {
                    break;
                }
            }
        }
        PlaylistSummary {
            id: id.to_string(),
            name,
            source,
            covers,
            count: tracks.len(),
            duration: tracks.iter().map(|t| t.duration).sum(),
            updated_at,
        }
    }))
}

pub fn list(db: &Db) -> AppResult<Vec<PlaylistSummary>> {
    let ids: Vec<String> = db.with(|c| {
        let mut stmt = c.prepare("SELECT id FROM playlists ORDER BY name COLLATE NOCASE")?;
        let rows = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    let mut out = Vec::new();
    for id in ids {
        let (tracks, _) = tracks_of(db, &id)?;
        if let Some(s) = summary(db, &id, &tracks)? {
            out.push(s);
        }
    }
    Ok(out)
}

pub fn get(db: &Db, id: &str) -> AppResult<PlaylistDetail> {
    let (tracks, missing) = tracks_of(db, id)?;
    let summary = summary(db, id, &tracks)?.ok_or_else(|| AppError::Invalid("That playlist no longer exists.".into()))?;
    Ok(PlaylistDetail { summary, tracks, missing })
}

fn touch(c: &rusqlite::Connection, id: &str) -> rusqlite::Result<usize> {
    c.execute("UPDATE playlists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1", [id])
}

pub fn create(db: &Db, name: &str, track_ids: &[i64]) -> AppResult<String> {
    let name = check_name(name)?;
    let id = new_id();
    db.with(|c| {
        c.execute("INSERT INTO playlists (id, name) VALUES (?1, ?2)", params![id, name])?;
        Ok(())
    })?;
    add(db, &id, track_ids)?;
    Ok(id)
}

pub fn rename(db: &Db, id: &str, name: &str) -> AppResult<()> {
    let name = check_name(name)?;
    db.with(|c| {
        c.execute("UPDATE playlists SET name = ?2 WHERE id = ?1", params![id, name])?;
        touch(c, id)?;
        Ok(())
    })
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM playlists WHERE id = ?1", [id])?;
        Ok(())
    })
}

/// Append songs (ones already in the playlist are skipped). Returns how many were added.
pub fn add(db: &Db, id: &str, track_ids: &[i64]) -> AppResult<usize> {
    db.with(|c| {
        let tx = c.transaction()?;
        let exists: bool = tx.query_row("SELECT COUNT(*) FROM playlists WHERE id = ?1", [id], |r| r.get::<_, i64>(0))? > 0;
        if !exists {
            return Err(AppError::Invalid("That playlist no longer exists.".into()));
        }
        let mut next: i64 = tx.query_row("SELECT COALESCE(MAX(position), 0) FROM playlist_tracks WHERE playlist_id = ?1", [id], |r| r.get(0))?;
        let mut added = 0;
        for tid in track_ids {
            let Some(path): Option<String> = tx.query_row("SELECT path FROM tracks WHERE id = ?1", [tid], |r| r.get(0)).optional()? else { continue };
            let dup: bool = tx.query_row("SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?1 AND path = ?2", params![id, path], |r| r.get::<_, i64>(0))? > 0;
            if dup {
                continue;
            }
            next += 1;
            tx.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_ref, position, path) VALUES (?1, ?2, ?3, ?4)",
                params![id, format!("file:{path}"), next, path],
            )?;
            added += 1;
        }
        touch(&tx, id)?;
        tx.commit()?;
        Ok(added)
    })
}

pub fn remove(db: &Db, id: &str, track_ids: &[i64]) -> AppResult<()> {
    db.with(|c| {
        let tx = c.transaction()?;
        for tid in track_ids {
            tx.execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND path = (SELECT path FROM tracks WHERE id = ?2)",
                params![id, tid],
            )?;
        }
        touch(&tx, id)?;
        tx.commit()?;
        Ok(())
    })
}

/// New order of the playlist's (visible) songs. Missing entries keep their place at the end.
pub fn reorder(db: &Db, id: &str, track_ids: &[i64]) -> AppResult<()> {
    db.with(|c| {
        let tx = c.transaction()?;
        tx.execute("UPDATE playlist_tracks SET position = position + 1000000 WHERE playlist_id = ?1", [id])?;
        for (i, tid) in track_ids.iter().enumerate() {
            tx.execute(
                "UPDATE playlist_tracks SET position = ?3 WHERE playlist_id = ?1 AND path = (SELECT path FROM tracks WHERE id = ?2)",
                params![id, tid, i as i64 + 1],
            )?;
        }
        touch(&tx, id)?;
        tx.commit()?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::music::Scanned;

    fn song(path: &str, title: &str) -> Scanned {
        Scanned {
            path: path.into(),
            size: 1,
            mtime: 1,
            title: title.into(),
            artist: "A".into(),
            album: None,
            album_artist: None,
            track_no: None,
            disc_no: None,
            year: None,
            genre: None,
            duration: 100.0,
            bitrate: None,
            format: "opus".into(),
            cover: Some(format!("C:/covers/{title}.jpg")),
        }
    }

    #[test]
    fn create_add_reorder_remove() {
        let db = Db::open_in_memory().unwrap();
        music::save(&db, &[song("C:/m/1.opus", "One"), song("C:/m/2.opus", "Two"), song("C:/m/3.opus", "Three")]).unwrap();
        let ids: Vec<i64> = music::tracks(&db).unwrap().iter().map(|t| t.id).collect();
        let by_title = |title: &str| music::tracks(&db).unwrap().into_iter().find(|t| t.title == title).unwrap().id;
        let (one, two, three) = (by_title("One"), by_title("Two"), by_title("Three"));

        assert!(create(&db, "  ", &[]).is_err());
        let pl = create(&db, "Road trip", &[one, two]).unwrap();
        assert_eq!(add(&db, &pl, &[two, three]).unwrap(), 1, "duplicates are skipped");
        let titles = |d: &PlaylistDetail| d.tracks.iter().map(|t| t.title.clone()).collect::<Vec<_>>();
        assert_eq!(titles(&get(&db, &pl).unwrap()), ["One", "Two", "Three"]);

        reorder(&db, &pl, &[three, one, two]).unwrap();
        assert_eq!(titles(&get(&db, &pl).unwrap()), ["Three", "One", "Two"]);

        remove(&db, &pl, &[one]).unwrap();
        rename(&db, &pl, "Trip").unwrap();
        let d = get(&db, &pl).unwrap();
        assert_eq!((d.summary.name.as_str(), d.summary.count, d.summary.duration), ("Trip", 2, 200.0));
        assert_eq!(d.summary.covers.len(), 2);
        assert_eq!(list(&db).unwrap().len(), 1);

        // A deleted file shows up as missing, not as a broken row.
        db.with(|c| Ok(c.execute("DELETE FROM tracks WHERE title = 'Two'", [])?)).unwrap();
        let d = get(&db, &pl).unwrap();
        assert_eq!((d.tracks.len(), d.missing), (1, 1));

        delete(&db, &pl).unwrap();
        assert!(get(&db, &pl).is_err());
        assert_eq!(ids.len(), 3);
    }

    #[test]
    fn spotify_playlists_resolve_when_downloads_finish() {
        let db = Db::open_in_memory().unwrap();
        db.with(|c| {
            c.execute_batch(
                "INSERT INTO playlists (id, name, source) VALUES ('spotify:playlist:p', 'Mix', 'spotify:playlist:p');
                 INSERT INTO playlist_tracks (playlist_id, track_ref, position) VALUES
                   ('spotify:playlist:p', 'spotify:track:b', 2), ('spotify:playlist:p', 'spotify:track:a', 1);",
            )?;
            Ok(())
        })
        .unwrap();
        assert_eq!(get(&db, "spotify:playlist:p").unwrap().missing, 2, "still downloading");
        music::save(&db, &[song("C:/m/a.opus", "A song"), song("C:/m/b.opus", "B song")]).unwrap();
        db.with(|c| {
            c.execute_batch(
                "UPDATE playlist_tracks SET path = 'C:/m/a.opus' WHERE track_ref = 'spotify:track:a';
                 UPDATE playlist_tracks SET path = 'C:/m/b.opus' WHERE track_ref = 'spotify:track:b';",
            )?;
            Ok(())
        })
        .unwrap();
        let d = get(&db, "spotify:playlist:p").unwrap();
        assert_eq!(d.tracks.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), ["A song", "B song"], "Spotify order");
        assert_eq!(d.summary.source.as_deref(), Some("spotify:playlist:p"));
    }
}
