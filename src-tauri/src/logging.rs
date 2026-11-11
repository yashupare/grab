//! Logs go to daily-rotating files (7 kept) in the app's log folder, plus the console in dev
//! builds. Level is `info` (Grab's own code at `debug`); override with the GRAB_LOG env var.

use std::path::Path;

use tracing_appender::{non_blocking::WorkerGuard, rolling};
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

/// Returns a guard that must be kept alive for the whole run, or buffered log lines are lost.
pub fn init(log_dir: &Path) -> Option<WorkerGuard> {
    let filter = EnvFilter::try_from_env("GRAB_LOG").unwrap_or_else(|_| EnvFilter::new("info,grab_lib=debug"));
    let console = cfg!(debug_assertions).then(fmt::layer);

    let appender = rolling::Builder::new()
        .rotation(rolling::Rotation::DAILY)
        .filename_prefix("grab")
        .filename_suffix("log")
        .max_log_files(7)
        .build(log_dir);

    let (file_layer, guard) = match appender {
        Ok(appender) => {
            let (writer, guard) = tracing_appender::non_blocking(appender);
            (Some(fmt::layer().with_writer(writer).with_ansi(false)), Some(guard))
        }
        Err(e) => {
            eprintln!("Grab: file logging disabled ({e})");
            (None, None)
        }
    };

    let _ = tracing_subscriber::registry().with(filter).with(console).with(file_layer).try_init();

    // Panics end up in the log file instead of vanishing.
    std::panic::set_hook(Box::new(|info| {
        tracing::error!(panic = %info, "panic");
    }));
    guard
}
