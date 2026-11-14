mod commands;
mod db;
mod error;
mod importer;
mod jobs;
mod library;
mod logging;
mod matcher;
mod media;
mod music;
mod playlists;
mod settings;
mod system;
mod spotify;
mod tags;
mod toolmgr;
mod tools;
mod ytdlp;

use std::{path::PathBuf, sync::Mutex};

use tauri::{App, Manager};
use tracing_appender::non_blocking::WorkerGuard;

use db::Db;
use settings::Settings;

/// Shared state available to every command.
pub struct AppState {
    pub db: Db,
    /// Defaults that depend on this PC (folders), computed once at startup.
    pub default_settings: Settings,
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    _log_guard: Mutex<Option<WorkerGuard>>,
}

/// Machine-specific defaults: Videos\Grab, Music\Grab, plus the old app's folder if present.
fn default_settings(app: &App) -> Settings {
    let path = app.path();
    let home = path.home_dir().unwrap_or_default();
    let video = path.video_dir().unwrap_or_else(|_| home.join("Videos")).join("Grab");
    let music = path.audio_dir().unwrap_or_else(|_| home.join("Music")).join("Grab");
    let mut library = vec![music.display().to_string()];
    if let Ok(downloads) = path.download_dir() {
        let legacy = downloads.join("YT Downloads");
        if legacy.is_dir() {
            library.push(legacy.display().to_string());
        }
    }
    Settings {
        video_dir: video.display().to_string(),
        music_dir: music.display().to_string(),
        library_dirs: library,
        ..Settings::default()
    }
}

fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    let log_dir = app.path().app_log_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(&log_dir)?;

    let guard = logging::init(&log_dir);
    tracing::info!(version = %app.package_info().version, data = %data_dir.display(), "Grab starting");

    // Tools live in Local AppData (machine-specific, not roamed): yt-dlp updates itself there.
    toolmgr::init(app.path().app_local_data_dir()?.join("tools"))?;

    let db = Db::open(&data_dir.join("grab.db"))?;
    let default_settings = default_settings(app);
    if let Ok(s) = settings::load(&db, &default_settings) {
        library::allow_folders(app.handle(), &s);
    }
    library::reset_previews(app.handle());

    app.manage(AppState { db, default_settings, data_dir, log_dir, _log_guard: Mutex::new(guard) });

    // The download queue needs AppState, so it starts after it's registered.
    let jobs = jobs::Manager::new(app.handle().clone());
    jobs.start()?;
    app.manage(jobs);

    let library = music::Library::new(app.handle().clone());
    library.start();
    app.manage(library);

    // Find a working hardware encoder now, so the first export doesn't wait for it.
    tauri::async_runtime::spawn(media::detect());

    let sys = system::System::new();
    if let Err(e) = sys.setup(app.handle()) {
        tracing::warn!(error = %e, "tray unavailable");
    }
    app.manage(sys);

    // Started with Windows: stay in the tray. Otherwise show the window (hidden until now so it
    // doesn't flash before the UI loads).
    if !std::env::args().any(|a| a == "--hidden") {
        system::show_main(app.handle());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch just brings the running Grab forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| system::show_main(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(setup)
        .on_window_event(|w, e| {
            if let Some(sys) = w.app_handle().try_state::<system::System>() {
                sys.on_window_event(w, e);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::app_info,
            commands::tool_status,
            commands::tools_missing,
            commands::install_tools,
            commands::fetch_info,
            commands::enqueue_download,
            commands::list_jobs,
            commands::pause_job,
            commands::resume_job,
            commands::cancel_job,
            commands::remove_job,
            commands::clear_finished_jobs,
            commands::open_job_file,
            commands::reveal_job_file,
            commands::update_ytdlp,
            commands::enqueue_many,
            commands::fetch_playlist,
            commands::video_library,
            commands::save_watch_position,
            commands::spotify_fetch,
            commands::spotify_import_state,
            commands::spotify_match,
            commands::spotify_candidates,
            commands::spotify_set_match,
            commands::spotify_import,
            commands::preview_clip,
            commands::library_tracks,
            commands::library_rescan,
            commands::set_liked,
            commands::reveal_track,
            commands::playlists_list,
            commands::playlist_get,
            commands::playlist_create,
            commands::playlist_rename,
            commands::playlist_delete,
            commands::playlist_add,
            commands::playlist_remove,
            commands::playlist_reorder,
            commands::media_update,
            commands::autostart_get,
            commands::autostart_set,
            commands::quit_app,
            commands::media_probe,
            commands::media_thumbnail,
            commands::compress_estimate,
            commands::tools_info,
            commands::export_start,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Grab");
}
