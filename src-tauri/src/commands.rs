//! Everything the UI can call. Keep each command thin: validate input, call a module, return.
//! Commands are `async` so they run off the main thread and never freeze the window.

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, State};

use crate::{
    AppState,
    error::{AppError, AppResult},
    settings::{self, Settings},
    toolmgr,
    tools::{self, ToolStatus},
};

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    settings::load(&state.db, &state.default_settings)
}

#[tauri::command]
pub async fn update_settings(state: State<'_, AppState>, patch: Map<String, Value>) -> AppResult<Settings> {
    settings::update(&state.db, &state.default_settings, patch)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    data_dir: String,
    log_dir: String,
    schema_version: usize,
}

#[tauri::command]
pub async fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.data_dir.display().to_string(),
        log_dir: state.log_dir.display().to_string(),
        schema_version: state.db.schema_version()?,
    })
}

/// Tools that still need to be downloaded (empty once setup is complete).
#[tauri::command]
pub async fn tools_missing() -> AppResult<Vec<toolmgr::PackageInfo>> {
    Ok(toolmgr::missing())
}

/// Download, verify and install missing tools. Progress arrives as `tools-progress` events.
#[tauri::command]
pub async fn install_tools(app: AppHandle) -> AppResult<()> {
    toolmgr::install_missing(app).await
}

#[tauri::command]
pub async fn tool_status() -> AppResult<Vec<ToolStatus>> {
    // Spawning five processes is blocking work: keep it off the async runtime's threads.
    tauri::async_runtime::spawn_blocking(tools::status)
        .await
        .map_err(|e| AppError::Invalid(format!("tool check failed: {e}")))
}
