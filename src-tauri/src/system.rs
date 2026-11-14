//! Windows integration: the tray icon and menu, keeping Grab running when the window is closed,
//! media keys and the Windows media overlay (System Media Transport Controls), and starting
//! with Windows.
//!
//! The player lives in the UI, so this module only relays: controls → `player-command` events,
//! and the UI reports what's playing through `media_update`.

use std::{
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig, SeekDirection};
use tauri::{
    AppHandle, Emitter, Manager, WebviewWindow, WindowEvent,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_notification::NotificationExt;

use crate::{AppState, error::AppResult, settings};

/// What the tray menu, media keys and the media overlay ask the player to do.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum PlayerCommand {
    Toggle,
    Play,
    Pause,
    Next,
    Previous,
    Stop,
    /// Seconds from the start.
    SeekTo { position: f64 },
    /// Relative, in seconds (negative = back).
    SeekBy { offset: f64 },
}

pub fn command_for(e: &MediaControlEvent) -> Option<PlayerCommand> {
    Some(match e {
        MediaControlEvent::Play => PlayerCommand::Play,
        MediaControlEvent::Pause => PlayerCommand::Pause,
        MediaControlEvent::Toggle => PlayerCommand::Toggle,
        MediaControlEvent::Next => PlayerCommand::Next,
        MediaControlEvent::Previous => PlayerCommand::Previous,
        MediaControlEvent::Stop => PlayerCommand::Stop,
        MediaControlEvent::Seek(d) => PlayerCommand::SeekBy { offset: if *d == SeekDirection::Forward { 10.0 } else { -10.0 } },
        MediaControlEvent::SeekBy(d, by) => {
            let s = by.as_secs_f64();
            PlayerCommand::SeekBy { offset: if *d == SeekDirection::Forward { s } else { -s } }
        }
        MediaControlEvent::SetPosition(p) => PlayerCommand::SeekTo { position: p.0.as_secs_f64() },
        _ => return None,
    })
}

/// What's playing, as reported by the UI.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    /// Local image path (the overlay loads it from disk).
    pub cover: Option<String>,
    pub playing: bool,
    pub position: f64,
    pub duration: f64,
}

/// Tray tooltip: "Grab · Song – Artist", kept under Windows' 127-character limit.
pub fn tooltip(np: Option<&NowPlaying>) -> String {
    match np {
        Some(n) => {
            let s = format!("Grab · {} – {}", n.title, n.artist);
            if s.chars().count() > 120 { format!("{}…", s.chars().take(119).collect::<String>()) } else { s }
        }
        None => "Grab".into(),
    }
}

pub struct System {
    tray: Mutex<Option<TrayIcon>>,
    toggle_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    media: Mutex<Option<MediaControls>>,
    last: Mutex<Option<NowPlaying>>,
    /// The "still running in the tray" hint is shown once per run.
    hinted: AtomicBool,
    pub quitting: AtomicBool,
}

// SMTC objects are agile COM objects; souvlaki just doesn't mark them. All access goes through
// the Mutex above.
unsafe impl Send for System {}
unsafe impl Sync for System {}

impl System {
    pub fn new() -> Self {
        Self {
            tray: Mutex::new(None),
            toggle_item: Mutex::new(None),
            media: Mutex::new(None),
            last: Mutex::new(None),
            hinted: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
        }
    }

    pub fn setup(&self, app: &AppHandle) -> AppResult<()> {
        self.setup_tray(app)?;
        if let Some(w) = app.get_webview_window("main") {
            self.setup_media(app, &w);
        }
        Ok(())
    }

    fn setup_tray(&self, app: &AppHandle) -> AppResult<()> {
        let err = |e: tauri::Error| crate::error::AppError::Invalid(format!("tray: {e}"));
        let toggle = MenuItem::with_id(app, "toggle", "Play", true, None::<&str>).map_err(err)?;
        let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>).map_err(err)?;
        let prev = MenuItem::with_id(app, "previous", "Previous", true, None::<&str>).map_err(err)?;
        let show = MenuItem::with_id(app, "show", "Show Grab", true, None::<&str>).map_err(err)?;
        let quit_item = MenuItem::with_id(app, "quit", "Quit Grab", true, None::<&str>).map_err(err)?;
        let sep = PredefinedMenuItem::separator(app).map_err(err)?;
        let menu = Menu::with_items(app, &[&toggle, &next, &prev, &sep, &show, &quit_item]).map_err(err)?;

        let mut builder = TrayIconBuilder::with_id("main")
            .tooltip("Grab")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, e| match e.id.as_ref() {
                "toggle" => emit(app, PlayerCommand::Toggle),
                "next" => emit(app, PlayerCommand::Next),
                "previous" => emit(app, PlayerCommand::Previous),
                "show" => show_main(app),
                "quit" => quit(app),
                _ => {}
            })
            .on_tray_icon_event(|tray, e| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                    show_main(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        let tray = builder.build(app).map_err(err)?;
        *self.tray.lock().unwrap_or_else(|p| p.into_inner()) = Some(tray);
        *self.toggle_item.lock().unwrap_or_else(|p| p.into_inner()) = Some(toggle);
        Ok(())
    }

    fn setup_media(&self, app: &AppHandle, w: &WebviewWindow) {
        let hwnd = match w.hwnd() {
            Ok(h) => h.0,
            Err(e) => {
                tracing::warn!(error = %e, "no window handle; media keys unavailable");
                return;
            }
        };
        let config = PlatformConfig { display_name: "Grab", dbus_name: "grab", hwnd: Some(hwnd) };
        match MediaControls::new(config) {
            Ok(mut c) => {
                let app = app.clone();
                if let Err(e) = c.attach(move |ev| {
                    if let Some(cmd) = command_for(&ev) {
                        emit(&app, cmd);
                    }
                }) {
                    tracing::warn!(error = ?e, "couldn't listen to media keys");
                }
                *self.media.lock().unwrap_or_else(|p| p.into_inner()) = Some(c);
                tracing::info!("media keys and Windows media overlay ready");
            }
            Err(e) => tracing::warn!(error = ?e, "media controls unavailable"),
        }
    }

    /// The UI reports what's playing: update the overlay, tray tooltip and tray menu.
    pub fn update(&self, np: Option<NowPlaying>) {
        let mut last = self.last.lock().unwrap_or_else(|p| p.into_inner());
        let song_changed = last.as_ref().map(|l| (&l.title, &l.artist, &l.cover)) != np.as_ref().map(|n| (&n.title, &n.artist, &n.cover));
        let playing_changed = last.as_ref().map(|l| l.playing) != np.as_ref().map(|n| n.playing);

        if let Some(media) = self.media.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
            let r = (|| {
                if song_changed && let Some(n) = &np {
                    let cover = n.cover.as_ref().map(|c| format!("file://{c}"));
                    media.set_metadata(MediaMetadata {
                        title: Some(&n.title),
                        artist: Some(&n.artist),
                        album: n.album.as_deref(),
                        cover_url: cover.as_deref(),
                        duration: (n.duration > 0.0).then(|| Duration::from_secs_f64(n.duration)),
                    })?;
                }
                let progress = np.as_ref().map(|n| MediaPosition(Duration::from_secs_f64(n.position.max(0.0))));
                media.set_playback(match &np {
                    None => MediaPlayback::Stopped,
                    Some(n) if n.playing => MediaPlayback::Playing { progress },
                    Some(_) => MediaPlayback::Paused { progress },
                })
            })();
            if let Err(e) = r {
                tracing::debug!(error = ?e, "media overlay update failed");
            }
        }
        if song_changed && let Some(tray) = self.tray.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            let _ = tray.set_tooltip(Some(tooltip(np.as_ref())));
        }
        if playing_changed && let Some(item) = self.toggle_item.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            let _ = item.set_text(if np.as_ref().is_some_and(|n| n.playing) { "Pause" } else { "Play" });
        }
        *last = np;
    }

    /// Window close button: hide to the tray when that's on (Settings → General).
    pub fn on_window_event(&self, w: &tauri::Window, e: &WindowEvent) {
        let WindowEvent::CloseRequested { api, .. } = e else { return };
        if self.quitting.load(Ordering::SeqCst) {
            return;
        }
        let app = w.app_handle();
        let st = app.state::<AppState>();
        let to_tray = settings::load(&st.db, &st.default_settings).map(|s| s.close_to_tray).unwrap_or(true);
        if !to_tray {
            return;
        }
        api.prevent_close();
        let _ = w.hide();
        if !self.hinted.swap(true, Ordering::SeqCst) {
            let playing = self.last.lock().ok().and_then(|l| l.as_ref().map(|n| n.playing)).unwrap_or(false);
            let body = if playing {
                "Music keeps playing. Use the tray icon or media keys to control it, or right-click the icon to quit."
            } else {
                "Grab keeps running in the tray so downloads can finish. Right-click the icon to quit."
            };
            let _ = app.notification().builder().title("Grab is still running").body(body).show();
        }
    }
}

fn emit(app: &AppHandle, cmd: PlayerCommand) {
    let _ = app.emit("player-command", cmd);
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn quit(app: &AppHandle) {
    if let Some(sys) = app.try_state::<System>() {
        sys.quitting.store(true, Ordering::SeqCst);
    }
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_media_events() {
        assert_eq!(command_for(&MediaControlEvent::Toggle), Some(PlayerCommand::Toggle));
        assert_eq!(
            command_for(&MediaControlEvent::SeekBy(SeekDirection::Backward, Duration::from_secs(5))),
            Some(PlayerCommand::SeekBy { offset: -5.0 })
        );
        assert_eq!(
            command_for(&MediaControlEvent::SetPosition(MediaPosition(Duration::from_millis(61_500)))),
            Some(PlayerCommand::SeekTo { position: 61.5 })
        );
        assert_eq!(command_for(&MediaControlEvent::SetVolume(0.5)), None);
        assert_eq!(serde_json::to_value(PlayerCommand::SeekBy { offset: 5.0 }).unwrap(), serde_json::json!({ "action": "seekBy", "offset": 5.0 }));
    }

    #[test]
    fn tooltips_fit() {
        assert_eq!(tooltip(None), "Grab");
        let n = NowPlaying { title: "x".repeat(200), artist: "A".into(), album: None, cover: None, playing: true, position: 0.0, duration: 1.0 };
        assert!(tooltip(Some(&n)).chars().count() <= 120);
    }
}
