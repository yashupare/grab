//! Tool manager: installs pinned versions of the external tools from their official sources
//! into the app's data folder, verifying every download against a known SHA-256 first.
//!
//! To update a tool: change its version, URL, SHA-256 and size below. Use only releases at
//! least 7 days old, and take the checksum from the publisher (GitHub release digest,
//! SHASUMS256.txt, or a verified winget manifest), never from our own download.

use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, AppResult};

pub enum Payload {
    /// The download is the program itself, saved under this file name.
    Exe(&'static str),
    /// A zip archive: (path suffix inside the zip, installed file name).
    Zip(&'static [(&'static str, &'static str)]),
}

pub struct Package {
    pub id: &'static str,
    pub label: &'static str,
    pub version: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    /// Approximate download size in bytes (progress display only).
    pub size: u64,
    pub payload: Payload,
}

impl Package {
    fn files(&self) -> Vec<&'static str> {
        match self.payload {
            Payload::Exe(name) => vec![name],
            Payload::Zip(files) => files.iter().map(|(_, dest)| *dest).collect(),
        }
    }
}

pub const PACKAGES: &[Package] = &[
    Package {
        id: "yt-dlp",
        label: "yt-dlp (downloader)",
        version: "2026.10.26",
        url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe",
        sha256: "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d",
        size: 23_575_744,
        payload: Payload::Exe("yt-dlp.exe"),
    },
    Package {
        id: "ffmpeg",
        label: "FFmpeg (video and audio processing)",
        version: "9.0.2",
        url: "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip",
        sha256: "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba",
        size: 114_768_076,
        payload: Payload::Zip(&[("/bin/ffmpeg.exe", "ffmpeg.exe"), ("/bin/ffprobe.exe", "ffprobe.exe")]),
    },
    Package {
        id: "aria2",
        label: "aria2 (faster downloads)",
        version: "1.37.0",
        url: "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip",
        sha256: "67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288",
        size: 2_475_379,
        payload: Payload::Zip(&[("/aria2c.exe", "aria2c.exe")]),
    },
    Package {
        id: "node",
        label: "Node.js (YouTube playback challenges)",
        version: "26.13.0",
        url: "https://nodejs.org/dist/v26.13.0/node-v26.13.0-win-x64.zip",
        sha256: "dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a",
        size: 41_157_375,
        payload: Payload::Zip(&[("/node.exe", "node.exe")]),
    },
];

static TOOLS_DIR: OnceLock<PathBuf> = OnceLock::new();
static INSTALLING: AtomicBool = AtomicBool::new(false);

pub fn init(dir: PathBuf) -> AppResult<()> {
    std::fs::create_dir_all(&dir)?;
    // Leftovers from an interrupted install.
    let _ = std::fs::remove_dir_all(dir.join(".downloads"));
    let _ = TOOLS_DIR.set(dir);
    Ok(())
}

pub fn dir() -> Option<&'static Path> {
    TOOLS_DIR.get().map(PathBuf::as_path)
}

fn record_path(dir: &Path) -> PathBuf {
    dir.join("installed.json")
}

fn installed_versions(dir: &Path) -> BTreeMap<String, String> {
    std::fs::read_to_string(record_path(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn is_installed(dir: &Path, pkg: &Package, record: &BTreeMap<String, String>) -> bool {
    record.get(pkg.id).map(String::as_str) == Some(pkg.version) && pkg.files().iter().all(|f| dir.join(f).is_file())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub version: &'static str,
    pub size: u64,
}

/// Packages that aren't installed at the pinned version.
pub fn missing() -> Vec<PackageInfo> {
    let Some(dir) = dir() else { return Vec::new() };
    let record = installed_versions(dir);
    PACKAGES
        .iter()
        .filter(|p| !is_installed(dir, p, &record))
        .map(|p| PackageInfo { id: p.id, label: p.label, version: p.version, size: p.size })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "phase")]
pub enum Progress {
    Downloading { id: &'static str, received: u64, total: u64 },
    Installing { id: &'static str },
    Done { id: &'static str },
    Failed { id: &'static str, message: String },
}

pub const PROGRESS_EVENT: &str = "tools-progress";

fn emit(app: &AppHandle, p: Progress) {
    let _ = app.emit(PROGRESS_EVENT, p);
}

/// Install everything that's missing, in parallel. Progress is sent as `tools-progress` events.
pub async fn install_missing(app: AppHandle) -> AppResult<()> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err(AppError::Invalid("Setup is already running.".into()));
    }
    let result = install_inner(app).await;
    INSTALLING.store(false, Ordering::SeqCst);
    result
}

async fn install_inner(app: AppHandle) -> AppResult<()> {
    let dir = dir().ok_or_else(|| AppError::Invalid("tools folder not initialised".into()))?.to_path_buf();
    let record = installed_versions(&dir);
    let client = reqwest::Client::builder()
        .user_agent(concat!("Grab/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .build()?;

    let todo: Vec<&'static Package> = PACKAGES.iter().filter(|p| !is_installed(&dir, p, &record)).collect();
    let tasks: Vec<_> = todo
        .into_iter()
        .map(|pkg| {
            let (app, dir, client) = (app.clone(), dir.clone(), client.clone());
            tauri::async_runtime::spawn(async move {
                let r = install_one(&app, &client, &dir, pkg).await;
                match &r {
                    Ok(()) => emit(&app, Progress::Done { id: pkg.id }),
                    Err(e) => {
                        tracing::error!(tool = pkg.id, error = %e, "tool install failed");
                        emit(&app, Progress::Failed { id: pkg.id, message: e.to_string() });
                    }
                }
                r.map(|()| pkg)
            })
        })
        .collect();

    let mut first_error = None;
    let mut record = installed_versions(&dir);
    for t in tasks {
        match t.await {
            Ok(Ok(pkg)) => {
                record.insert(pkg.id.to_string(), pkg.version.to_string());
            }
            Ok(Err(e)) => {
                first_error.get_or_insert(e);
            }
            Err(e) => {
                first_error.get_or_insert(AppError::Invalid(format!("install task failed: {e}")));
            }
        }
    }
    std::fs::write(record_path(&dir), serde_json::to_string_pretty(&record)?)?;
    match first_error {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

async fn install_one(app: &AppHandle, client: &reqwest::Client, dir: &Path, pkg: &'static Package) -> AppResult<()> {
    tracing::info!(tool = pkg.id, version = pkg.version, "downloading tool");
    let downloads = dir.join(".downloads");
    tokio::fs::create_dir_all(&downloads).await?;
    let part = downloads.join(format!("{}.part", pkg.id));

    let mut resp = client.get(pkg.url).send().await?.error_for_status()?;
    let total = resp.content_length().unwrap_or(pkg.size);
    let mut file = tokio::fs::File::create(&part).await?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    emit(app, Progress::Downloading { id: pkg.id, received, total });

    while let Some(chunk) = resp.chunk().await? {
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(150) {
            emit(app, Progress::Downloading { id: pkg.id, received, total });
            last_emit = Instant::now();
        }
    }
    file.flush().await?;
    drop(file);
    emit(app, Progress::Downloading { id: pkg.id, received, total });

    let digest = hex::encode(hasher.finalize().as_slice());
    if !digest.eq_ignore_ascii_case(pkg.sha256) {
        let _ = tokio::fs::remove_file(&part).await;
        tracing::error!(tool = pkg.id, expected = pkg.sha256, got = %digest, "checksum mismatch");
        return Err(AppError::Invalid(format!(
            "{} failed its safety check (the download was damaged or changed), so it wasn't installed. Try again.",
            pkg.label
        )));
    }

    emit(app, Progress::Installing { id: pkg.id });
    let dir = dir.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || unpack(&part, &dir, pkg))
        .await
        .map_err(|e| AppError::Invalid(format!("install task failed: {e}")))??;
    tracing::info!(tool = pkg.id, version = pkg.version, "tool installed");
    Ok(())
}

/// Move the verified download into place. Files are written to `*.new` and renamed, so a crash
/// never leaves a half-written program behind.
fn unpack(part: &Path, dir: &Path, pkg: &Package) -> AppResult<()> {
    match pkg.payload {
        Payload::Exe(name) => replace(part, &dir.join(name))?,
        Payload::Zip(files) => {
            let mut archive = zip::ZipArchive::new(std::fs::File::open(part)?)
                .map_err(|e| AppError::Invalid(format!("{} archive is unreadable: {e}", pkg.label)))?;
            for (suffix, dest) in files {
                let index = (0..archive.len())
                    .find(|&i| matches!(archive.name_for_index(i), Some(Ok(n)) if n.replace('\\', "/").ends_with(suffix)))
                    .ok_or_else(|| AppError::Invalid(format!("{dest} not found in the {} archive", pkg.label)))?;
                let mut entry = archive
                    .by_index(index)
                    .map_err(|e| AppError::Invalid(format!("couldn't read {dest}: {e}")))?;
                let tmp = dir.join(format!("{dest}.new"));
                let mut out = std::fs::File::create(&tmp)?;
                let mut buf = vec![0u8; 1 << 16];
                loop {
                    let n = entry.read(&mut buf)?;
                    if n == 0 {
                        break;
                    }
                    std::io::Write::write_all(&mut out, &buf[..n])?;
                }
                drop(out);
                replace(&tmp, &dir.join(dest))?;
            }
            std::fs::remove_file(part)?;
        }
    }
    Ok(())
}

fn replace(from: &Path, to: &Path) -> AppResult<()> {
    if to.exists() {
        std::fs::remove_file(to)?;
    }
    std::fs::rename(from, to)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_well_formed() {
        let mut ids = std::collections::HashSet::new();
        for p in PACKAGES {
            assert!(ids.insert(p.id), "duplicate id {}", p.id);
            assert!(p.url.starts_with("https://"), "{} must use https", p.id);
            assert_eq!(p.sha256.len(), 64, "{} sha256 must be 64 hex chars", p.id);
            assert!(p.sha256.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(p.url.contains(p.version), "{} url should contain its version", p.id);
            assert!(!p.files().is_empty());
        }
    }

    #[test]
    fn detects_missing_and_installed() {
        let dir = std::env::temp_dir().join(format!("grab-toolmgr-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pkg = &PACKAGES[2]; // aria2
        let mut record = BTreeMap::new();
        assert!(!is_installed(&dir, pkg, &record));
        std::fs::write(dir.join("aria2c.exe"), b"x").unwrap();
        assert!(!is_installed(&dir, pkg, &record), "file without a version record isn't trusted");
        record.insert("aria2".into(), pkg.version.into());
        assert!(is_installed(&dir, pkg, &record));
        record.insert("aria2".into(), "0.0.1".into());
        assert!(!is_installed(&dir, pkg, &record), "old version triggers reinstall");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
