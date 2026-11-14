//! Everything the UI can call. Keep each command thin: validate input, call a module, return.
//! Commands are `async` so they run off the main thread and never freeze the window.

use std::sync::Arc;

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::{
    AppState,
    error::{AppError, AppResult},
    importer, jobs, library, matcher, media, music, playlists,
    settings::{self, Settings},
    spotify,
    system, toolmgr,
    tools::{self, ToolStatus},
    ytdlp,
};

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    settings::load(&state.db, &state.default_settings)
}

#[tauri::command]
pub async fn update_settings(app: AppHandle, state: State<'_, AppState>, patch: Map<String, Value>) -> AppResult<Settings> {
    let before = settings::load(&state.db, &state.default_settings)?;
    let s = settings::update(&state.db, &state.default_settings, patch)?;
    library::allow_folders(&app, &s); // new folders become playable right away
    if music::roots(&before) != music::roots(&s) {
        let lib = app.state::<Arc<music::Library>>();
        lib.rewatch();
        lib.rescan();
    }
    Ok(s)
}

#[tauri::command]
pub async fn video_library(app: AppHandle, state: State<'_, AppState>) -> AppResult<Vec<library::VideoItem>> {
    library::videos(&app, &state.db)
}

#[tauri::command]
pub async fn save_watch_position(state: State<'_, AppState>, job_id: String, position: f64, duration: Option<f64>) -> AppResult<()> {
    library::save_position(&state.db, &job_id, position, duration)
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
pub async fn enqueue_many(jobs: Jobs<'_>, requests: Vec<jobs::DownloadRequest>) -> AppResult<usize> {
    jobs.enqueue_many(requests).map(|ids| ids.len())
}

/// Videos in a playlist or channel (flat listing: fast, no per-video details).
#[tauri::command]
pub async fn fetch_playlist(url: String) -> AppResult<ytdlp::PlaylistInfo> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(AppError::Invalid("That doesn't look like a web link.".into()));
    }
    ytdlp::fetch_playlist(url).await
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

/// Settings → Updates → "Check for updates" for the downloader.
#[tauri::command]
pub async fn update_ytdlp(jobs: Jobs<'_>) -> AppResult<jobs::UpdateResult> {
    jobs.check_ytdlp_update().await
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

// ---------------------------------------------------------------- Spotify import

/// Songs in a Spotify song/album/playlist link.
#[tauri::command]
pub async fn spotify_fetch(url: String) -> AppResult<spotify::Collection> {
    let link = spotify::parse_link(&url).ok_or_else(|| AppError::Invalid("That isn't a Spotify song, album or playlist link.".into()))?;
    spotify::fetch(&link).await
}

/// What was imported from this album/playlist before.
#[tauri::command]
pub async fn spotify_import_state(state: State<'_, AppState>, uri: String) -> AppResult<importer::ImportState> {
    importer::state(&state.db, &uri)
}

/// Best YouTube Music match for one song (cached).
#[tauri::command]
pub async fn spotify_match(state: State<'_, AppState>, track: matcher::Query) -> AppResult<matcher::MatchResult> {
    matcher::check_query(&track)?;
    matcher::match_track(&state.db, &track).await
}

/// Top results for the Fix match dialog, best first.
#[tauri::command]
pub async fn spotify_candidates(track: matcher::Query) -> AppResult<Vec<matcher::Candidate>> {
    matcher::check_query(&track)?;
    let mut found = matcher::find(&track, true).await?;
    found.truncate(6);
    Ok(found)
}

/// The user's choice in the Fix dialog: a listed candidate, or a pasted YouTube link.
#[tauri::command]
pub async fn spotify_set_match(
    state: State<'_, AppState>,
    track: matcher::Query,
    candidate: Option<matcher::Candidate>,
    link: Option<String>,
) -> AppResult<matcher::MatchResult> {
    matcher::check_query(&track)?;
    let picked = match (candidate, link) {
        (Some(c), _) if matcher::valid_video_id(&c.video_id) => c,
        (_, Some(link)) => {
            let id = matcher::video_id_from(&link).ok_or_else(|| AppError::Invalid("Paste a YouTube or YouTube Music video link.".into()))?;
            let info = ytdlp::fetch_info(&format!("https://www.youtube.com/watch?v={id}")).await?;
            matcher::Candidate {
                video_id: id,
                title: info.title,
                artists: info.channel.into_iter().collect(),
                album: None,
                duration: info.duration,
                thumbnail: info.thumbnail,
                source: matcher::Source::Video,
                score: 0.0,
            }
        }
        _ => return Err(AppError::Invalid("Pick a result or paste a link.".into())),
    };
    let mut picked = picked;
    picked.score = matcher::score(&track, &picked);
    matcher::save(&state.db, &track.id, Some(&picked), true)?;
    Ok(matcher::MatchResult { spotify_id: track.id, status: matcher::MatchStatus::Matched, candidate: Some(picked), manual: true })
}

/// Queue matched songs as tagged audio downloads (and update the Music playlist).
#[tauri::command]
pub async fn spotify_import(state: State<'_, AppState>, jobs: Jobs<'_>, request: importer::ImportRequest) -> AppResult<usize> {
    importer::import(&state.db, &jobs, request)
}

/// A 12-second clip of a YouTube Music result, from the middle of the song when it's long enough.
/// Returns a file path the player can open (the previews folder is allowed for playback).
#[tauri::command]
pub async fn preview_clip(app: AppHandle, video_id: String, duration: Option<f64>) -> AppResult<String> {
    if !matcher::valid_video_id(&video_id) {
        return Err(AppError::Invalid("Invalid video.".into()));
    }
    let start = if duration.unwrap_or(0.0) > 75.0 { 30.0 } else { 0.0 };
    let path = ytdlp::preview_clip(&video_id, start, &library::previews_dir(&app)).await?;
    Ok(path.display().to_string())
}

// ---------------------------------------------------------------- music library

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryData {
    tracks: Vec<music::Track>,
    /// A scan is running (first start, or folders changed).
    scanning: bool,
}

#[tauri::command]
pub async fn library_tracks(state: State<'_, AppState>, lib: State<'_, Arc<music::Library>>) -> AppResult<LibraryData> {
    Ok(LibraryData { tracks: music::tracks(&state.db)?, scanning: lib.scanning() })
}

#[tauri::command]
pub async fn library_rescan(lib: State<'_, Arc<music::Library>>) -> AppResult<()> {
    lib.rescan();
    Ok(())
}

#[tauri::command]
pub async fn set_liked(state: State<'_, AppState>, ids: Vec<i64>, liked: bool) -> AppResult<()> {
    music::set_liked(&state.db, &ids, liked)
}

#[tauri::command]
pub async fn reveal_track(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let path = music::track_path(&state.db, id)?;
    app.opener().reveal_item_in_dir(path).map_err(|e| AppError::Invalid(format!("Couldn't show the file: {e}")))
}

// ---------------------------------------------------------------- playlists

#[tauri::command]
pub async fn playlists_list(state: State<'_, AppState>) -> AppResult<Vec<playlists::PlaylistSummary>> {
    playlists::list(&state.db)
}

#[tauri::command]
pub async fn playlist_get(state: State<'_, AppState>, id: String) -> AppResult<playlists::PlaylistDetail> {
    playlists::get(&state.db, &id)
}

#[tauri::command]
pub async fn playlist_create(state: State<'_, AppState>, name: String, track_ids: Vec<i64>) -> AppResult<String> {
    playlists::create(&state.db, &name, &track_ids)
}

#[tauri::command]
pub async fn playlist_rename(state: State<'_, AppState>, id: String, name: String) -> AppResult<()> {
    playlists::rename(&state.db, &id, &name)
}

#[tauri::command]
pub async fn playlist_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    playlists::delete(&state.db, &id)
}

#[tauri::command]
pub async fn playlist_add(state: State<'_, AppState>, id: String, track_ids: Vec<i64>) -> AppResult<usize> {
    playlists::add(&state.db, &id, &track_ids)
}

#[tauri::command]
pub async fn playlist_remove(state: State<'_, AppState>, id: String, track_ids: Vec<i64>) -> AppResult<()> {
    playlists::remove(&state.db, &id, &track_ids)
}

#[tauri::command]
pub async fn playlist_reorder(state: State<'_, AppState>, id: String, track_ids: Vec<i64>) -> AppResult<()> {
    playlists::reorder(&state.db, &id, &track_ids)
}

// ---------------------------------------------------------------- Windows integration

/// The player reports what's playing (None = nothing loaded) for the media overlay and tray.
#[tauri::command]
pub async fn media_update(sys: State<'_, system::System>, now: Option<system::NowPlaying>) -> AppResult<()> {
    sys.update(now);
    Ok(())
}

#[tauri::command]
pub async fn autostart_get(app: AppHandle) -> AppResult<bool> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| AppError::Invalid(format!("Couldn't check: {e}")))
}

#[tauri::command]
pub async fn autostart_set(app: AppHandle, enabled: bool) -> AppResult<bool> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    let r = if enabled { al.enable() } else { al.disable() };
    r.map_err(|e| AppError::Invalid(format!("Couldn't change this: {e}")))?;
    al.is_enabled().map_err(|e| AppError::Invalid(format!("Couldn't check: {e}")))
}

/// Quit for real (the close button may only hide to the tray).
#[tauri::command]
pub async fn quit_app(app: AppHandle) -> AppResult<()> {
    system::quit(&app);
    Ok(())
}

// ---------------------------------------------------------------- Tools

/// Read files the user picked (duration, size, streams) and allow them in the preview player.
#[tauri::command]
pub async fn media_probe(app: AppHandle, paths: Vec<String>) -> AppResult<Vec<media::Probe>> {
    if paths.len() > 200 {
        return Err(AppError::Invalid("Pick at most 200 files.".into()));
    }
    let mut out = Vec::new();
    for p in &paths {
        let probe = media::probe(p).await?;
        let _ = app.asset_protocol_scope().allow_file(p);
        out.push(probe);
    }
    Ok(out)
}

/// A small frame from a video for clip lists (an image path).
#[tauri::command]
pub async fn media_thumbnail(app: AppHandle, path: String, at: f64) -> AppResult<String> {
    let cache = app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("Grab")).join("thumbs");
    let out = media::thumbnail(&path, at.max(0.0), &cache).await?;
    let _ = app.asset_protocol_scope().allow_file(&out);
    Ok(out.display().to_string())
}

#[tauri::command]
pub async fn compress_estimate(path: String, target_mb: f64) -> AppResult<media::CompressEstimate> {
    if !(target_mb.is_finite() && target_mb > 0.0) {
        return Err(AppError::Invalid("Pick a size.".into()));
    }
    let p = media::probe(&path).await?;
    if p.video.is_none() {
        return Err(AppError::Invalid("Compress works on videos. For audio, use Convert.".into()));
    }
    Ok(media::compress_estimate(&p, target_mb))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsInfo {
    /// Working hardware encoders, e.g. ["Intel Quick Sync"].
    hardware: Vec<String>,
    /// What exports use now (follows Settings → Tools).
    using: String,
    video_dir: String,
    music_dir: String,
}

#[tauri::command]
pub async fn tools_info(state: State<'_, AppState>) -> AppResult<ToolsInfo> {
    let s = settings::load(&state.db, &state.default_settings)?;
    let hardware = media::detect().await;
    let using = media::pick_encoder(s.hardware_accel).await;
    Ok(ToolsInfo {
        hardware: hardware.iter().map(|e| e.label().to_string()).collect(),
        using: using.label().into(),
        video_dir: s.video_dir,
        music_dir: s.music_dir,
    })
}

/// Queue a Tools export; progress shows in Activity like a download.
#[tauri::command]
pub async fn export_start(jobs: Jobs<'_>, request: media::ExportRequest) -> AppResult<jobs::Job> {
    request.validate()?;
    let first = request.tool.inputs().first().map(|s| s.to_string()).unwrap_or_default();
    jobs.enqueue(jobs::DownloadRequest {
        url: first,
        title: format!("{} · {}", request.tool.verb(), request.name.trim()),
        thumbnail: None,
        kind: jobs::Kind::Export,
        quality: "best".into(),
        audio_format: settings::AudioFormat::Opus,
        group_id: None,
        group_title: None,
        options: Default::default(),
        duration: None,
        tags: None,
        export: Some(request),
    })
}
