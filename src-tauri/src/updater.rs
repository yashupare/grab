//! Updates for Grab itself, from GitHub Releases (tauri-plugin-updater). Every update is signed;
//! the public key in tauri.conf.json rejects anything not signed with Grab's private key.
//!
//! Checked once a day at startup when Settings → Updates → "Update Grab automatically" is on.
//! Installing never happens without the user clicking Install: the installer closes Grab.

use std::{
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::{
    AppState,
    error::{AppError, AppResult},
    settings,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    received: u64,
    total: Option<u64>,
}

/// The update found by the last check, ready to install.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

fn err(e: impl std::fmt::Display) -> AppError {
    AppError::Network(format!("Couldn't check for updates: {e}"))
}

pub async fn check(app: &AppHandle) -> AppResult<Option<UpdateInfo>> {
    let update = app.updater().map_err(err)?.check().await.map_err(err)?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().filter(|b| !b.trim().is_empty()),
        date: u.date.map(|d| d.to_string()),
    });
    if let Some(p) = app.try_state::<Pending>() {
        *p.0.lock().unwrap_or_else(|e| e.into_inner()) = update;
    }
    Ok(info)
}

/// Download and run the installer (it closes Grab and starts the new version).
pub async fn install(app: &AppHandle) -> AppResult<()> {
    let update = app
        .try_state::<Pending>()
        .and_then(|p| p.0.lock().ok().and_then(|mut g| g.take()))
        .ok_or_else(|| AppError::Invalid("Check for updates first.".into()))?;
    tracing::info!(version = %update.version, "installing update");
    let mut received = 0u64;
    let handle = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                received += chunk as u64;
                let _ = handle.emit("app-update-progress", Progress { received, total });
            },
            || tracing::info!("update downloaded"),
        )
        .await
        .map_err(|e| AppError::Network(format!("The update couldn't be installed: {e}")))?;
    // On Windows the installer has taken over by now; elsewhere, restart into the new version.
    app.restart();
}

fn stamp(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("app-update-last-check"))
}

/// Daily background check (Settings → Updates). Tells the UI when an update is available.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Let startup (tools, library scan) settle first.
        tokio::time::sleep(Duration::from_secs(20)).await;
        let enabled = {
            let st = app.state::<AppState>();
            settings::load(&st.db, &st.default_settings).map(|s| s.auto_update).unwrap_or(true)
        };
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let last = stamp(&app).and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0);
        if !enabled || now.saturating_sub(last) < 24 * 3600 {
            return;
        }
        if let Some(p) = stamp(&app) {
            let _ = std::fs::write(p, now.to_string());
        }
        match check(&app).await {
            Ok(Some(info)) => {
                tracing::info!(version = %info.version, "Grab update available");
                let _ = app.emit("app-update-available", info);
            }
            Ok(None) => tracing::info!("Grab is up to date"),
            Err(e) => tracing::info!(error = %e, "update check failed"),
        }
    });
}
