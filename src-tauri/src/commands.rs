//! Everything the UI can call. Keep each command thin: validate input, call a module, return.
//! Commands are `async` so they run off the main thread and never freeze the window.

use std::sync::Arc;

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::{
    AppState,
    error::{AppError, AppResult},
    jobs,
    settings::{self, Settings},
    toolmgr,
    tools::{self, ToolStatus},
    ytdlp,
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

/// Details and available qualities for one video link.
#[tauri::command]
pub async fn fetch_info(url: String) -> AppResult<ytdlp::MediaInfo> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(AppError::Invalid("That doesn't look like a web link.".into()));
    }
    ytdlp::fetch_info(url).await
}

type Jobs<'a> = State<'a, Arc<jobs::Manager>>;

#[tauri::command]
pub async fn enqueue_download(jobs: Jobs<'_>, request: jobs::DownloadRequest) -> AppResult<jobs::Job> {
    jobs.enqueue(request)
}

#[tauri::command]
pub async fn list_jobs(state: State<'_, AppState>) -> AppResult<Vec<jobs::Job>> {
    jobs::list(&state.db)
}

#[tauri::command]
pub async fn pause_job(jobs: Jobs<'_>, id: String) -> AppResult<()> {
    jobs.pause(&id)
}

#[tauri::command]
pub async fn resume_job(jobs: Jobs<'_>, id: String) -> AppResult<()> {
    jobs.resume(&id)
}

#[tauri::command]
pub async fn cancel_job(jobs: Jobs<'_>, id: String) -> AppResult<()> {
    jobs.cancel(&id)
}

#[tauri::command]
pub async fn remove_job(jobs: Jobs<'_>, id: String) -> AppResult<()> {
    jobs.remove(&id)
}

#[tauri::command]
pub async fn clear_finished_jobs(jobs: Jobs<'_>) -> AppResult<usize> {
    jobs.clear_finished()
}

/// The finished file of a job. The UI passes only a job id, never a path, so it can't be used
/// to open arbitrary files.
fn job_file(state: &AppState, id: &str) -> AppResult<String> {
    let job = jobs::get(&state.db, id)?.ok_or_else(|| AppError::Invalid("That download no longer exists.".into()))?;
    let path = job.file_path.ok_or_else(|| AppError::Invalid("This download hasn't finished yet.".into()))?;
    if !std::path::Path::new(&path).is_file() {
        return Err(AppError::Invalid("The file was moved or deleted.".into()));
    }
    Ok(path)
}

#[tauri::command]
pub async fn open_job_file(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let path = job_file(&state, &id)?;
    app.opener().open_path(path, None::<&str>).map_err(|e| AppError::Invalid(format!("Couldn't open the file: {e}")))
}

#[tauri::command]
pub async fn reveal_job_file(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let path = job_file(&state, &id)?;
    app.opener().reveal_item_in_dir(path).map_err(|e| AppError::Invalid(format!("Couldn't show the file: {e}")))
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
