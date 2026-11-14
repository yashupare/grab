//! Download queue: jobs stored in SQLite, a scheduler that runs up to N at a time (Settings →
//! Simultaneous downloads), and the yt-dlp runner that streams progress to the UI.
//!
//! Restart-safe: on startup, jobs that were running go back to the queue, and because each job
//! keeps its partial files in its own temp folder, yt-dlp continues where it stopped.
//!
//! Events: `job-updated` (full Job on any status change), `job-progress` (live progress),
//! `job-removed` (id).

use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use rusqlite::{OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager as _};
use tauri_plugin_notification::NotificationExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, BufReader},
    sync::{Notify, mpsc},
};

use crate::{
    AppState,
    db::Db,
    error::{AppError, AppResult},
    importer, media,
    settings::{self, AudioFormat, SponsorBlock},
    tags::{self, TrackTags},
    ytdlp,
};

// ---------------------------------------------------------------- types

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Video,
    Audio,
    /// A Tools export (merge, trim, compress, convert) run by ffmpeg.
    Export,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Video => "video",
            Kind::Audio => "audio",
            Kind::Export => "export",
        }
    }
}

fn default_quality() -> String {
    "best".into()
}
fn default_audio() -> AudioFormat {
    AudioFormat::Opus
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SubtitleMode {
    /// Inside the video file (switchable in players).
    #[default]
    Embed,
    /// Separate .srt file next to the video.
    File,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Section {
    pub start: f64,
    pub end: f64,
}

/// Extra options from "More options". All default to off.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DownloadOptions {
    /// Subtitle language codes as reported by yt-dlp ("en", "hi-orig", …). Video only.
    pub subtitles: Vec<String>,
    pub subtitle_mode: SubtitleMode,
    /// Only download this part (seconds).
    pub section: Option<Section>,
    pub sponsorblock: SponsorBlock,
    /// One file per chapter (in addition to the full file).
    pub split_chapters: bool,
}

impl DownloadOptions {
    fn validate(&self) -> AppResult<()> {
        if self.subtitles.len() > 20
            || self.subtitles.iter().any(|c| c.is_empty() || c.len() > 20 || !c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'))
        {
            return Err(AppError::Invalid("Invalid subtitle language.".into()));
        }
        if let Some(s) = self.section {
            if !(s.start.is_finite() && s.end.is_finite() && s.start >= 0.0 && s.end > s.start) {
                return Err(AppError::Invalid("The end time must be after the start time.".into()));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub kind: Kind,
    /// Maximum height ("1080") or "best". Video only.
    #[serde(default = "default_quality")]
    pub quality: String,
    #[serde(default = "default_audio")]
    pub audio_format: AudioFormat,
    /// Set when the job is part of a playlist/channel batch, so the UI can group it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_title: Option<String>,
    #[serde(default)]
    pub options: DownloadOptions,
    /// Length in seconds when known at queue time (for the library).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    /// Song details written into the file after download (Spotify imports). Audio only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<TrackTags>,
    /// What to make (Kind::Export only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export: Option<media::ExportRequest>,
}

impl DownloadRequest {
    fn validate(&self) -> AppResult<()> {
        if self.kind == Kind::Export {
            return self.export.as_ref().ok_or_else(|| AppError::Invalid("Nothing to export.".into()))?.validate();
        }
        if self.export.is_some() {
            return Err(AppError::Invalid("Invalid download.".into()));
        }
        self.options.validate()?;
        if let Some(t) = &self.tags {
            if self.kind != Kind::Audio {
                return Err(AppError::Invalid("Song details only apply to audio downloads.".into()));
            }
            t.validate()?;
        }
        if !(self.url.starts_with("https://") || self.url.starts_with("http://")) {
            return Err(AppError::Invalid("That doesn't look like a web link.".into()));
        }
        if self.quality != "best" && !(self.quality.len() <= 4 && self.quality.chars().all(|c| c.is_ascii_digit())) {
            return Err(AppError::Invalid(format!("Unknown quality '{}'.", self.quality)));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Queued,
    Running,
    Paused,
    Done,
    Failed,
    Cancelled,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Status::Queued => "queued",
            Status::Running => "running",
            Status::Paused => "paused",
            Status::Done => "done",
            Status::Failed => "failed",
            Status::Cancelled => "cancelled",
        }
    }
    fn parse(s: &str) -> Self {
        match s {
            "queued" => Status::Queued,
            "running" => Status::Running,
            "paused" => Status::Paused,
            "done" => Status::Done,
            "cancelled" => Status::Cancelled,
            _ => Status::Failed,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub kind: Kind,
    pub url: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub status: Status,
    pub progress: f64,
    pub error: Option<String>,
    pub file_path: Option<String>,
    pub file_size: Option<i64>,
    pub created_at: String,
    pub finished_at: Option<String>,
    pub request: DownloadRequest,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Downloading,
    Processing,
    /// A Tools export: `fraction` and `eta` are set.
    Exporting,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub id: String,
    pub stage: Stage,
    /// 1 = first stream (video), 2 = second (audio) for video jobs.
    pub part: u8,
    pub fraction: f64,
    pub downloaded: Option<u64>,
    pub total: Option<u64>,
    pub speed: Option<f64>,
    pub eta: Option<u64>,
    /// yt-dlp post-processor name while processing (Merger, ExtractAudio, …).
    pub step: Option<String>,
}

// ---------------------------------------------------------------- storage

fn from_row(r: &Row) -> rusqlite::Result<Job> {
    let request: String = r.get("request")?;
    let request: DownloadRequest = serde_json::from_str(&request)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
    Ok(Job {
        id: r.get("id")?,
        kind: request.kind,
        url: r.get("url")?,
        title: r.get("title")?,
        thumbnail: r.get("thumbnail")?,
        status: Status::parse(&r.get::<_, String>("status")?),
        progress: r.get("progress")?,
        error: r.get("error")?,
        file_path: r.get("file_path")?,
        file_size: r.get("file_size")?,
        created_at: r.get("created_at")?,
        finished_at: r.get("finished_at")?,
        request,
    })
}

fn insert(db: &Db, id: &str, req: &DownloadRequest) -> AppResult<()> {
    let request = serde_json::to_string(req)?;
    db.with(|c| {
        c.execute(
            "INSERT INTO jobs (id, kind, url, title, thumbnail, request, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued')",
            params![id, req.kind.as_str(), req.url, req.title, req.thumbnail, request],
        )?;
        Ok(())
    })
}

pub fn get(db: &Db, id: &str) -> AppResult<Option<Job>> {
    db.with(|c| Ok(c.query_row("SELECT * FROM jobs WHERE id = ?1", [id], from_row).optional()?))
}

pub fn list(db: &Db) -> AppResult<Vec<Job>> {
    db.with(|c| {
        let mut stmt = c.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 500")?;
        let rows = stmt.query_map([], from_row)?.collect::<Result<_, _>>()?;
        Ok(rows)
    })
}

fn next_queued(db: &Db, exclude: &[String]) -> AppResult<Option<Job>> {
    db.with(|c| {
        let mut stmt = c.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC")?;
        let mut rows = stmt.query([])?;
        while let Some(r) = rows.next()? {
            let job = from_row(r)?;
            if !exclude.contains(&job.id) {
                return Ok(Some(job));
            }
        }
        Ok(None)
    })
}

fn set_status(db: &Db, id: &str, status: Status, error: Option<&str>) -> AppResult<()> {
    db.with(|c| {
        let finished = matches!(status, Status::Done | Status::Failed | Status::Cancelled);
        c.execute(
            "UPDATE jobs SET status = ?2, error = ?3,
               finished_at = CASE WHEN ?4 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END
             WHERE id = ?1",
            params![id, status.as_str(), error, finished],
        )?;
        Ok(())
    })
}

fn set_progress(db: &Db, id: &str, progress: f64) -> AppResult<()> {
    db.with(|c| {
        c.execute("UPDATE jobs SET progress = ?2 WHERE id = ?1", params![id, progress])?;
        Ok(())
    })
}

fn finish(db: &Db, id: &str, path: &str, size: i64) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "UPDATE jobs SET status = 'done', progress = 1, error = NULL, file_path = ?2, file_size = ?3,
               finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
            params![id, path, size],
        )?;
        Ok(())
    })
}

fn delete(db: &Db, id: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM jobs WHERE id = ?1", [id])?;
        Ok(())
    })
}

/// After a restart: anything that was running is queued again.
fn requeue_running(db: &Db) -> AppResult<usize> {
    db.with(|c| Ok(c.execute("UPDATE jobs SET status = 'queued' WHERE status = 'running'", [])?))
}

// ---------------------------------------------------------------- yt-dlp arguments & output

const PROGRESS_TEMPLATE: &str = "download:GRABP|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s";
const POSTPROCESS_TEMPLATE: &str = "postprocess:GRABPP|%(progress.status)s|%(progress.postprocessor)s";

pub fn download_args(req: &DownloadRequest, dir: &Path, temp: &Path, template: &str) -> Vec<String> {
    let mut a: Vec<String> = [
        "--newline", "--progress", "--no-simulate", "--no-playlist", "--no-mtime", "--windows-filenames",
        "--retries", "10", "--fragment-retries", "10", "--concurrent-fragments", "4",
        "--progress-template", PROGRESS_TEMPLATE, "--progress-template", POSTPROCESS_TEMPLATE,
        "--print", "after_move:GRABFILE|%(filepath)s", "--embed-metadata",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    a.extend(["-P".into(), dir.display().to_string()]);
    a.extend(["-P".into(), format!("temp:{}", temp.display())]);
    a.extend(["-o".into(), template.to_string()]);

    match req.kind {
        Kind::Video => {
            // Resolution first; then H.264 + AAC in MP4 when the site offers it at that resolution
            // (plays in every Windows app without extra codecs). Above 1080p YouTube only has
            // VP9/AV1, so those still download at full quality (MKV if MP4 can't hold them).
            let sort = if req.quality == "best" {
                "res,vcodec:h264,ext:mp4:m4a".to_string()
            } else {
                format!("res:{},vcodec:h264,ext:mp4:m4a", req.quality)
            };
            a.extend(["-f", "bv*+ba/b", "-S"].map(String::from));
            a.push(sort);
            a.extend(["--merge-output-format", "mp4/mkv", "--embed-chapters"].map(String::from));
        }
        Kind::Audio => {
            let fmt: &[&str] = match req.audio_format {
                AudioFormat::Opus => &["-f", "ba[acodec^=opus]/ba", "-x", "--audio-format", "opus"],
                AudioFormat::M4a => &["-f", "ba[ext=m4a]/ba", "-x", "--audio-format", "m4a"],
                AudioFormat::Mp3 => &["-f", "ba", "-x", "--audio-format", "mp3", "--audio-quality", "192K"],
            };
            a.extend(fmt.iter().map(|s| s.to_string()));
            // Imported songs get their cover from Spotify/YouTube Music afterwards (tags.rs).
            if req.tags.is_none() {
                a.extend(["--embed-thumbnail", "--convert-thumbnails", "jpg"].map(String::from));
            }
        }
        Kind::Export => {} // never sent to yt-dlp
    }
    a.extend(option_args(req));
    a.push("--".into());
    a.push(req.url.clone());
    a
}

/// yt-dlp wants "1:02.5"-style or plain seconds; plain seconds with decimals is unambiguous.
fn secs(v: f64) -> String {
    let s = format!("{v:.3}");
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

fn option_args(req: &DownloadRequest) -> Vec<String> {
    let o = &req.options;
    let mut a: Vec<String> = Vec::new();
    if req.kind == Kind::Video && !o.subtitles.is_empty() {
        a.extend(["--sub-langs".into(), o.subtitles.join(",")]);
        a.push("--write-subs".into());
        if o.subtitles.iter().any(|c| c.ends_with("-orig")) {
            a.push("--write-auto-subs".into());
        }
        match o.subtitle_mode {
            SubtitleMode::Embed => a.push("--embed-subs".into()),
            SubtitleMode::File => a.extend(["--convert-subs", "srt"].map(String::from)),
        }
    }
    if let Some(s) = o.section {
        // Cuts land on the nearest keyframe (fast, may be ±1–2 s off).
        a.extend(["--download-sections".into(), format!("*{}-{}", secs(s.start), secs(s.end))]);
    }
    match o.sponsorblock {
        SponsorBlock::Off => {}
        SponsorBlock::Remove => a.extend(["--sponsorblock-remove", "sponsor,selfpromo,interaction"].map(String::from)),
        SponsorBlock::Mark => a.extend(["--sponsorblock-mark", "all"].map(String::from)),
    }
    if o.split_chapters {
        a.extend([
            "--split-chapters".into(),
            "-o".into(),
            "chapter:%(title)s - chapters/%(section_number)02d %(section_title)s.%(ext)s".into(),
        ]);
    }
    a
}

#[derive(Debug, PartialEq)]
pub enum Line {
    Progress { downloaded: Option<u64>, total: Option<u64>, speed: Option<f64>, eta: Option<u64>, format_id: String },
    Processing { started: bool, step: String },
    File(String),
    Other,
}

pub fn parse_line(line: &str) -> Line {
    let line = line.trim_end_matches(['\r', '\n']);
    let num = |s: Option<&str>| s.and_then(|v| v.parse::<f64>().ok());
    if let Some(rest) = line.strip_prefix("GRABP|") {
        let f: Vec<&str> = rest.split('|').collect();
        let total = num(f.get(1).copied()).or_else(|| num(f.get(2).copied()));
        return Line::Progress {
            downloaded: num(f.first().copied()).map(|v| v as u64),
            total: total.map(|v| v as u64),
            speed: num(f.get(3).copied()),
            eta: num(f.get(4).copied()).map(|v| v as u64),
            format_id: f.get(5).unwrap_or(&"").to_string(),
        };
    }
    if let Some(rest) = line.strip_prefix("GRABPP|") {
        let (status, step) = rest.split_once('|').unwrap_or((rest, ""));
        return Line::Processing { started: status == "started", step: step.to_string() };
    }
    if let Some(path) = line.strip_prefix("GRABFILE|") {
        return Line::File(path.to_string());
    }
    Line::Other
}

// ---------------------------------------------------------------- manager

/// Forward a child process's output lines into one channel (`is_err` marks stderr).
fn pump(r: impl AsyncRead + Unpin + Send + 'static, is_err: bool, tx: mpsc::UnboundedSender<(bool, String)>) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(r).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            if tx.send((is_err, l)).is_err() {
                break;
            }
        }
    });
}

struct Control {
    stop: Notify,
    reason: Mutex<Option<Status>>,
}

enum Outcome {
    Stopped(Status),
    /// `message` is shown to the user; `raw` is yt-dlp's stderr (for diagnosis).
    Failed { message: String, raw: String },
}

impl Outcome {
    fn failed(e: AppError) -> Self {
        Outcome::Failed { message: e.to_string(), raw: String::new() }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub before: String,
    pub after: String,
    pub updated: bool,
}

/// Check for a new yt-dlp at most once a day automatically.
const UPDATE_INTERVAL: Duration = Duration::from_secs(24 * 3600);

pub struct Manager {
    app: AppHandle,
    running: Mutex<HashMap<String, Arc<Control>>>,
    wake: Notify,
    /// While yt-dlp updates itself, no new downloads start.
    updating: AtomicBool,
    /// Jobs already retried once after a downloader update (no endless loops).
    retried: Mutex<HashSet<String>>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn update_stamp() -> Option<PathBuf> {
    crate::toolmgr::dir().map(|d| d.join("ytdlp-last-check"))
}

fn update_due() -> bool {
    let last = update_stamp()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0);
    now_secs().saturating_sub(last) >= UPDATE_INTERVAL.as_secs()
}

impl Manager {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            app,
            running: Mutex::new(HashMap::new()),
            wake: Notify::new(),
            updating: AtomicBool::new(false),
            retried: Mutex::new(HashSet::new()),
        })
    }

    /// Update yt-dlp now. Callers must have set `updating`; this clears it and wakes the queue.
    async fn run_update(&self) -> AppResult<UpdateResult> {
        let result = async {
            let tools = ytdlp::tool_paths()?;
            ytdlp::self_update(&tools).await
        }
        .await;
        if let Some(p) = update_stamp() {
            let _ = std::fs::write(p, now_secs().to_string());
        }
        self.updating.store(false, Ordering::SeqCst);
        self.wake();
        let (before, after) = result?;
        let updated = before != after;
        if updated {
            tracing::info!(%before, %after, "yt-dlp updated");
            let _ = self.app.emit("ytdlp-updated", UpdateResult { before: before.clone(), after: after.clone(), updated });
        } else {
            tracing::info!(version = %after, "yt-dlp is up to date");
        }
        Ok(UpdateResult { before, after, updated })
    }

    /// "Check for updates" in Settings. Refuses while downloads run.
    pub async fn check_ytdlp_update(&self) -> AppResult<UpdateResult> {
        if !self.running_ids().is_empty() {
            return Err(AppError::Invalid("Wait for the current downloads to finish, then check again.".into()));
        }
        if self.updating.swap(true, Ordering::SeqCst) {
            return Err(AppError::Invalid("Already checking for updates.".into()));
        }
        self.run_update().await
    }

    fn notify(&self, job: &Job, ok: bool, message: Option<&str>) {
        let st = self.state();
        let enabled = settings::load(&st.db, &st.default_settings).map(|s| s.notifications).unwrap_or(true);
        let focused = self.app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
        if !enabled || focused {
            return;
        }
        let export = job.kind == Kind::Export;
        let (title, body) = match (ok, export) {
            (true, false) => ("Download finished", job.title.clone()),
            (true, true) => ("Export finished", job.title.clone()),
            (false, e) => (
                if e { "Export failed" } else { "Download failed" },
                format!("{}: {}", job.title, message.unwrap_or("something went wrong")),
            ),
        };
        if let Err(e) = self.app.notification().builder().title(title).body(body).show() {
            tracing::debug!(error = %e, "notification not shown");
        }
    }

    fn state(&self) -> tauri::State<'_, AppState> {
        self.app.state::<AppState>()
    }

    fn temp_dir(&self, id: &str) -> PathBuf {
        let base = self.app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("Grab"));
        base.join("temp").join(id)
    }

    fn running_ids(&self) -> Vec<String> {
        self.running.lock().map(|m| m.keys().cloned().collect()).unwrap_or_default()
    }

    pub fn start(self: &Arc<Self>) -> AppResult<()> {
        let n = requeue_running(&self.state().db)?;
        if n > 0 {
            tracing::info!(count = n, "resuming interrupted downloads");
        }
        // Daily yt-dlp update check, before any download starts.
        if update_due() {
            self.updating.store(true, Ordering::SeqCst);
            let me = self.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = me.run_update().await {
                    tracing::warn!(error = %e, "yt-dlp update check failed");
                }
            });
        }
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                me.fill();
                me.wake.notified().await;
            }
        });
        Ok(())
    }

    fn wake(&self) {
        self.wake.notify_one();
    }

    fn emit_job(&self, id: &str) {
        match get(&self.state().db, id) {
            Ok(Some(job)) => {
                let _ = self.app.emit("job-updated", job);
            }
            Ok(None) => {
                let _ = self.app.emit("job-removed", id);
            }
            Err(e) => tracing::warn!(%id, error = %e, "couldn't read job"),
        }
    }

    /// Start queued jobs until the concurrency limit is reached.
    fn fill(self: &Arc<Self>) {
        if self.updating.load(Ordering::SeqCst) {
            return; // run_update() wakes us when it's done
        }
        let st = self.state();
        let limit = settings::load(&st.db, &st.default_settings).map(|s| s.concurrent_downloads).unwrap_or(3) as usize;
        loop {
            let running = self.running_ids();
            if running.len() >= limit {
                break;
            }
            let job = match next_queued(&st.db, &running) {
                Ok(Some(job)) => job,
                Ok(None) => break,
                Err(e) => {
                    tracing::error!(error = %e, "queue read failed");
                    break;
                }
            };
            if let Err(e) = set_status(&st.db, &job.id, Status::Running, None) {
                tracing::error!(error = %e, "couldn't start job");
                break;
            }
            let ctl = Arc::new(Control { stop: Notify::new(), reason: Mutex::new(None) });
            if let Ok(mut m) = self.running.lock() {
                m.insert(job.id.clone(), ctl.clone());
            }
            self.emit_job(&job.id);
            let me = self.clone();
            tauri::async_runtime::spawn(async move { me.run(job, ctl).await });
        }
    }

    async fn run(self: Arc<Self>, job: Job, ctl: Arc<Control>) {
        tracing::info!(id = %job.id, url = %job.url, kind = job.kind.as_str(), "download started");
        let temp = self.temp_dir(&job.id);
        let mut outcome = self.execute(&job, &ctl, &temp).await;

        // YouTube changed something? Update yt-dlp and try this job once more.
        let mut retry = false;
        if let Err(Outcome::Failed { raw, .. }) = &outcome {
            let first_time = self.retried.lock().map(|mut r| r.insert(job.id.clone())).unwrap_or(false);
            if ytdlp::looks_outdated(raw) && first_time && !self.updating.swap(true, Ordering::SeqCst) {
                tracing::info!(id = %job.id, "download failed in a way an update may fix; updating yt-dlp");
                let _ = self.app.emit("job-progress", JobProgress {
                    id: job.id.clone(), stage: Stage::Processing, part: 0, fraction: 0.0,
                    downloaded: None, total: None, speed: None, eta: None, step: Some("UpdateDownloader".into()),
                });
                if let Ok(r) = self.run_update().await {
                    retry = r.updated;
                }
                if !retry {
                    if let Err(Outcome::Failed { message, .. }) = &mut outcome {
                        *message = format!("{message} (The downloader is already up to date.)");
                    }
                }
            }
        }

        {
            let db = &self.state().db;
            let r = match &outcome {
                _ if retry => set_status(db, &job.id, Status::Queued, None),
                Ok((path, size)) => {
                    tracing::info!(id = %job.id, %path, "download finished");
                    self.notify(&job, true, None);
                    finish(db, &job.id, path, *size)
                }
                Err(Outcome::Stopped(s)) => set_status(db, &job.id, *s, None),
                Err(Outcome::Failed { message, raw }) => {
                    tracing::warn!(id = %job.id, error = %message, stderr = %raw, "download failed");
                    self.notify(&job, false, Some(message));
                    set_status(db, &job.id, Status::Failed, Some(message))
                }
            };
            if let Err(e) = r {
                tracing::error!(id = %job.id, error = %e, "couldn't save job result");
            }
        }
        // Paused, failed and retried jobs keep their partial files so they can resume.
        if !retry && matches!(outcome, Ok(_) | Err(Outcome::Stopped(Status::Cancelled))) {
            let _ = tokio::fs::remove_dir_all(&temp).await;
        }
        if let Ok(mut m) = self.running.lock() {
            m.remove(&job.id);
        }
        self.emit_job(&job.id);
        self.wake();
    }

    async fn execute(&self, job: &Job, ctl: &Control, temp: &Path) -> Result<(String, i64), Outcome> {
        if job.kind == Kind::Export {
            return self.execute_export(job, ctl, temp).await;
        }
        let fail = Outcome::failed;
        let tools = ytdlp::tool_paths().map_err(fail)?;
        let s = {
            let st = self.state();
            settings::load(&st.db, &st.default_settings).map_err(fail)?
        };
        let dir = PathBuf::from(match job.kind {
            Kind::Video | Kind::Export => &s.video_dir,
            Kind::Audio => &s.music_dir,
        });
        std::fs::create_dir_all(&dir).map_err(|e| fail(e.into()))?;
        std::fs::create_dir_all(temp).map_err(|e| fail(e.into()))?;

        let template = job.request.tags.as_ref().map(TrackTags::file_template).unwrap_or_else(|| s.filename_template.clone());
        let mut cmd = ytdlp::command(&tools);
        cmd.args(download_args(&job.request, &dir, temp, &template))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| fail(e.into()))?;

        let (tx, mut rx) = mpsc::unbounded_channel::<(bool, String)>();
        if let Some(out) = child.stdout.take() {
            pump(out, false, tx.clone());
        }
        if let Some(err) = child.stderr.take() {
            pump(err, true, tx.clone());
        }
        drop(tx);

        let mut final_path: Option<String> = None;
        let mut errors: VecDeque<String> = VecDeque::new();
        let (mut part, mut last_format) = (0u8, String::new());
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        let mut last_saved = Instant::now();

        loop {
            tokio::select! {
                msg = rx.recv() => {
                    let Some((is_err, line)) = msg else { break };
                    match parse_line(&line) {
                        Line::Progress { downloaded, total, speed, eta, format_id } => {
                            if format_id != last_format {
                                part = part.saturating_add(1);
                                last_format = format_id;
                            }
                            let fraction = match (downloaded, total) {
                                (Some(d), Some(t)) if t > 0 => (d as f64 / t as f64).min(1.0),
                                _ => 0.0,
                            };
                            if last_emit.elapsed() >= Duration::from_millis(250) || fraction >= 1.0 {
                                last_emit = Instant::now();
                                let _ = self.app.emit("job-progress", JobProgress {
                                    id: job.id.clone(), stage: Stage::Downloading, part, fraction,
                                    downloaded, total, speed, eta, step: None,
                                });
                            }
                            if last_saved.elapsed() >= Duration::from_secs(5) {
                                last_saved = Instant::now();
                                let _ = set_progress(&self.state().db, &job.id, fraction);
                            }
                        }
                        Line::Processing { started: true, step } => {
                            let _ = self.app.emit("job-progress", JobProgress {
                                id: job.id.clone(), stage: Stage::Processing, part, fraction: 1.0,
                                downloaded: None, total: None, speed: None, eta: None, step: Some(step),
                            });
                        }
                        Line::File(p) => final_path = Some(p),
                        Line::Processing { .. } => {}
                        Line::Other => {
                            if is_err && !line.trim().is_empty() {
                                errors.push_back(line);
                                if errors.len() > 40 {
                                    errors.pop_front();
                                }
                            }
                        }
                    }
                }
                _ = ctl.stop.notified() => {
                    let _ = child.kill().await;
                    let reason = ctl.reason.lock().ok().and_then(|r| *r).unwrap_or(Status::Paused);
                    tracing::info!(id = %job.id, status = reason.as_str(), "download stopped");
                    return Err(Outcome::Stopped(reason));
                }
            }
        }

        let status = child.wait().await.map_err(|e| fail(e.into()))?;
        let stderr: String = errors.into_iter().collect::<Vec<_>>().join("\n");
        match (status.success(), final_path) {
            (true, Some(path)) => {
                if let Some(t) = &job.request.tags {
                    let _ = self.app.emit("job-progress", JobProgress {
                        id: job.id.clone(), stage: Stage::Processing, part, fraction: 1.0,
                        downloaded: None, total: None, speed: None, eta: None, step: Some("Tagging".into()),
                    });
                    // A file without tags is still a good download: log and carry on.
                    if let Err(e) = tags::apply(Path::new(&path), t).await {
                        tracing::warn!(id = %job.id, %path, error = %e, "couldn't tag file");
                    }
                    if let Err(e) = importer::complete(&self.state().db, t, &path) {
                        tracing::warn!(id = %job.id, error = %e, "couldn't record import");
                    }
                }
                let size = std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
                Ok((path, size))
            }
            (true, None) => Err(Outcome::Failed {
                message: "The download finished but the file couldn't be found.".into(),
                raw: stderr,
            }),
            (false, _) => Err(Outcome::Failed { message: ytdlp::friendly_error(&stderr), raw: stderr }),
        }
    }

    // ------------------------------------------------------------ Tools exports

    /// Run a merge/trim/compress/convert with ffmpeg. Writes into the job's temp folder and moves
    /// the file into place only when it's complete. A hardware encoder that fails is retried once
    /// in software.
    async fn execute_export(&self, job: &Job, ctl: &Control, temp: &Path) -> Result<(String, i64), Outcome> {
        let fail = Outcome::failed;
        let req = job.request.export.as_ref().ok_or_else(|| fail(AppError::Invalid("Nothing to export.".into())))?;
        let hardware = {
            let st = self.state();
            settings::load(&st.db, &st.default_settings).map_err(fail)?.hardware_accel
        };
        let mut probes = Vec::new();
        for i in req.tool.inputs() {
            probes.push(media::probe(i).await.map_err(fail)?);
        }
        let dir = PathBuf::from(&req.output_dir);
        std::fs::create_dir_all(&dir).map_err(|e| fail(e.into()))?;
        // A paused/retried export starts over.
        let _ = std::fs::remove_dir_all(temp);
        std::fs::create_dir_all(temp).map_err(|e| fail(e.into()))?;

        let mut enc = media::pick_encoder(hardware).await;
        loop {
            let plan = media::plan(&req.tool, &probes, enc).map_err(fail)?;
            let tmp_out = temp.join(format!("output.{}", plan.ext));
            if let Some(list) = &plan.concat_list {
                std::fs::write(temp.join("list.txt"), list).map_err(|e| fail(e.into()))?;
            }
            tracing::info!(id = %job.id, tool = req.tool.verb(), encoder = ?enc, copy = plan.copy, "export started");
            match self.run_passes(job, ctl, &plan, &tmp_out, temp).await {
                Ok(()) => {
                    let out = media::unique_output(&dir, &req.name, &plan.ext);
                    if std::fs::rename(&tmp_out, &out).is_err() {
                        // Different drive: copy, then remove.
                        std::fs::copy(&tmp_out, &out).map_err(|e| fail(e.into()))?;
                        let _ = std::fs::remove_file(&tmp_out);
                    }
                    let size = std::fs::metadata(&out).map(|m| m.len() as i64).unwrap_or(0);
                    return Ok((out.display().to_string(), size));
                }
                Err(Outcome::Failed { raw, .. }) if enc != media::Encoder::Software && !plan.copy => {
                    tracing::warn!(id = %job.id, encoder = ?enc, stderr = %raw, "hardware encode failed; retrying in software");
                    enc = media::Encoder::Software;
                }
                Err(e) => return Err(e),
            }
        }
    }

    async fn run_passes(&self, job: &Job, ctl: &Control, plan: &media::Plan, out: &Path, temp: &Path) -> Result<(), Outcome> {
        let fail = Outcome::failed;
        let started = Instant::now();
        let passes = plan.passes.len().max(1) as f64;
        let audio = temp.join("audio.m4a");
        for (i, pass) in plan.passes.iter().enumerate() {
            // Compress: size the video from the measured audio (see media::Budget).
            let vkbps = plan.budget.map(|b| b.video_kbps(std::fs::metadata(&audio).map_or(0, |m| m.len())));
            let args: Vec<String> = pass
                .iter()
                .map(|a| match a.as_str() {
                    media::OUT => out.display().to_string(),
                    media::PASSLOG => temp.join("pass").display().to_string(),
                    media::LIST => temp.join("list.txt").display().to_string(),
                    media::AUDIO => audio.display().to_string(),
                    media::VKBPS => format!("{}k", vkbps.unwrap_or(1000)),
                    _ => a.clone(),
                })
                .collect();
            let mut cmd = media::ffmpeg().map_err(fail)?;
            // Two-pass logs land in the working directory unless told otherwise.
            cmd.current_dir(temp).args(&args).stdout(Stdio::piped()).stderr(Stdio::piped());
            let mut child = cmd.spawn().map_err(|e| fail(e.into()))?;
            let (tx, mut rx) = mpsc::unbounded_channel::<(bool, String)>();
            if let Some(o) = child.stdout.take() {
                pump(o, false, tx.clone());
            }
            if let Some(e) = child.stderr.take() {
                pump(e, true, tx.clone());
            }
            drop(tx);
            let mut errors: VecDeque<String> = VecDeque::new();
            let mut last_emit = Instant::now() - Duration::from_secs(1);
            loop {
                tokio::select! {
                    msg = rx.recv() => {
                        let Some((is_err, line)) = msg else { break };
                        if is_err {
                            if !line.trim().is_empty() {
                                errors.push_back(line);
                                if errors.len() > 30 { errors.pop_front(); }
                            }
                        } else if let Some(t) = media::progress_seconds(&line)
                            && last_emit.elapsed() >= Duration::from_millis(400)
                        {
                            last_emit = Instant::now();
                            let fraction = ((i as f64 + (t / plan.duration.max(0.1)).min(1.0)) / passes).clamp(0.0, 1.0);
                            let elapsed = started.elapsed().as_secs_f64();
                            let eta = (fraction > 0.02).then(|| (elapsed / fraction * (1.0 - fraction)) as u64);
                            let _ = self.app.emit("job-progress", JobProgress {
                                id: job.id.clone(), stage: Stage::Exporting, part: (i + 1) as u8, fraction,
                                downloaded: None, total: None, speed: None, eta, step: None,
                            });
                        }
                    }
                    _ = ctl.stop.notified() => {
                        let _ = child.kill().await;
                        let reason = ctl.reason.lock().ok().and_then(|r| *r).unwrap_or(Status::Paused);
                        return Err(Outcome::Stopped(reason));
                    }
                }
            }
            let status = child.wait().await.map_err(|e| fail(e.into()))?;
            if !status.success() {
                let raw: String = errors.into_iter().collect::<Vec<_>>().join("\n");
                return Err(Outcome::Failed { message: media::friendly_error(&raw), raw });
            }
        }
        if !out.is_file() {
            return Err(fail(AppError::Invalid("The export finished but the file is missing.".into())));
        }
        Ok(())
    }

    // ------------------------------------------------------------ public actions

    pub fn enqueue(self: &Arc<Self>, req: DownloadRequest) -> AppResult<Job> {
        req.validate()?;
        let id = new_id();
        insert(&self.state().db, &id, &req)?;
        self.emit_job(&id);
        self.wake();
        get(&self.state().db, &id)?.ok_or_else(|| AppError::Invalid("job disappeared".into()))
    }

    /// Queue a batch (playlist/channel selection) in one go. All requests are validated first,
    /// so a bad item can't leave half a batch queued.
    pub fn enqueue_many(self: &Arc<Self>, reqs: Vec<DownloadRequest>) -> AppResult<Vec<String>> {
        if reqs.is_empty() {
            return Err(AppError::Invalid("Pick at least one video.".into()));
        }
        for r in &reqs {
            r.validate()?;
        }
        let db = &self.state().db;
        let ids: Vec<String> = reqs.iter().map(|_| new_id()).collect();
        let rows: Vec<(String, String)> = reqs
            .iter()
            .zip(&ids)
            .map(|(r, id)| Ok((id.clone(), serde_json::to_string(r)?)))
            .collect::<AppResult<_>>()?;
        db.with(|c| {
            let tx = c.transaction()?;
            for ((id, json), r) in rows.iter().zip(&reqs) {
                tx.execute(
                    "INSERT INTO jobs (id, kind, url, title, thumbnail, request, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued')",
                    params![id, r.kind.as_str(), r.url, r.title, r.thumbnail, json],
                )?;
            }
            tx.commit()?;
            Ok(())
        })?;
        for id in &ids {
            self.emit_job(id);
        }
        self.wake();
        tracing::info!(count = ids.len(), "batch queued");
        Ok(ids)
    }

    fn stop_running(&self, id: &str, reason: Status) -> bool {
        let ctl = self.running.lock().ok().and_then(|m| m.get(id).cloned());
        match ctl {
            Some(ctl) => {
                if let Ok(mut r) = ctl.reason.lock() {
                    *r = Some(reason);
                }
                ctl.stop.notify_one();
                true
            }
            None => false,
        }
    }

    fn require(&self, id: &str) -> AppResult<Job> {
        get(&self.state().db, id)?.ok_or_else(|| AppError::Invalid("That download no longer exists.".into()))
    }

    pub fn pause(&self, id: &str) -> AppResult<()> {
        let job = self.require(id)?;
        if !self.stop_running(id, Status::Paused) && job.status == Status::Queued {
            set_status(&self.state().db, id, Status::Paused, None)?;
            self.emit_job(id);
        }
        Ok(())
    }

    /// Resume a paused job, or retry a failed/cancelled one.
    pub fn resume(&self, id: &str) -> AppResult<()> {
        let job = self.require(id)?;
        if matches!(job.status, Status::Paused | Status::Failed | Status::Cancelled) {
            set_status(&self.state().db, id, Status::Queued, None)?;
            self.emit_job(id);
            self.wake();
        }
        Ok(())
    }

    pub fn cancel(&self, id: &str) -> AppResult<()> {
        let job = self.require(id)?;
        if !self.stop_running(id, Status::Cancelled) && matches!(job.status, Status::Queued | Status::Paused) {
            set_status(&self.state().db, id, Status::Cancelled, None)?;
            let _ = std::fs::remove_dir_all(self.temp_dir(id));
            self.emit_job(id);
        }
        Ok(())
    }

    /// Remove from the list (never deletes the downloaded file).
    pub fn remove(&self, id: &str) -> AppResult<()> {
        if self.running_ids().iter().any(|r| r == id) {
            return Err(AppError::Invalid("Stop the download before removing it.".into()));
        }
        delete(&self.state().db, id)?;
        let _ = std::fs::remove_dir_all(self.temp_dir(id));
        let _ = self.app.emit("job-removed", id);
        Ok(())
    }

    pub fn clear_finished(&self) -> AppResult<usize> {
        let n = self.state().db.with(|c| Ok(c.execute("DELETE FROM jobs WHERE status IN ('done', 'cancelled')", [])?))?;
        let _ = self.app.emit("jobs-cleared", ());
        Ok(n)
    }
}

/// Time-ordered unique id (sortable, no extra dependency).
fn new_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{nanos:x}{:04x}", SEQ.fetch_add(1, Ordering::Relaxed) & 0xffff)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(kind: Kind) -> DownloadRequest {
        DownloadRequest {
            url: "https://www.youtube.com/watch?v=abc".into(),
            title: "T".into(),
            thumbnail: None,
            kind,
            quality: "1080".into(),
            audio_format: AudioFormat::Opus,
            group_id: None,
            group_title: None,
            options: DownloadOptions::default(),
            duration: None,
            tags: None,
            export: None,
        }
    }

    #[test]
    fn option_args_cover_subtitles_sections_sponsorblock_chapters() {
        let mut r = req(Kind::Video);
        r.options = DownloadOptions {
            subtitles: vec!["en".into(), "hi-orig".into()],
            subtitle_mode: SubtitleMode::File,
            section: Some(Section { start: 62.5, end: 125.0 }),
            sponsorblock: SponsorBlock::Remove,
            split_chapters: true,
        };
        let s = option_args(&r).join(" ");
        assert!(s.contains("--sub-langs en,hi-orig --write-subs --write-auto-subs --convert-subs srt"));
        assert!(s.contains("--download-sections *62.5-125"));
        assert!(s.contains("--sponsorblock-remove sponsor,selfpromo,interaction"));
        assert!(s.contains("--split-chapters -o chapter:"));

        // audio jobs never ask for subtitles
        r.kind = Kind::Audio;
        assert!(!option_args(&r).join(" ").contains("--sub-langs"));
        // defaults add nothing
        assert!(option_args(&req(Kind::Video)).is_empty());
    }

    #[test]
    fn rejects_bad_options() {
        let mut r = req(Kind::Video);
        r.options.section = Some(Section { start: 30.0, end: 10.0 });
        assert!(r.validate().is_err());
        r.options.section = None;
        r.options.subtitles = vec!["en;rm".into()];
        assert!(r.validate().is_err());
    }

    #[test]
    fn parses_progress_lines() {
        assert_eq!(
            parse_line("GRABP|1024|223779|NA|213096.86|1|395"),
            Line::Progress { downloaded: Some(1024), total: Some(223779), speed: Some(213096.86), eta: Some(1), format_id: "395".into() }
        );
        // falls back to the estimate when the exact total is unknown
        assert!(matches!(parse_line("GRABP|10|NA|5000|NA|NA|251"), Line::Progress { total: Some(5000), speed: None, .. }));
        assert_eq!(parse_line("GRABPP|started|Merger"), Line::Processing { started: true, step: "Merger".into() });
        assert_eq!(parse_line("GRABFILE|C:\\x\\a b.mkv\r"), Line::File("C:\\x\\a b.mkv".into()));
        assert_eq!(parse_line("[youtube] Extracting URL"), Line::Other);
    }

    #[test]
    fn video_args_limit_resolution_and_prefer_mp4() {
        let a = download_args(&req(Kind::Video), Path::new("C:/V"), Path::new("C:/T"), "%(title)s.%(ext)s");
        let s = a.join(" ");
        assert!(s.contains("-S res:1080,vcodec:h264,ext:mp4:m4a"));
        assert!(s.contains("--merge-output-format mp4/mkv"));
        assert!(s.contains("temp:C:/T"));
        assert_eq!(a[a.len() - 2], "--", "URL must come after -- so it can't be read as an option");
    }

    #[test]
    fn audio_args_follow_format() {
        let mut r = req(Kind::Audio);
        r.audio_format = AudioFormat::M4a;
        let s = download_args(&r, Path::new("C:/M"), Path::new("C:/T"), "x").join(" ");
        assert!(s.contains("-x --audio-format m4a") && s.contains("--embed-thumbnail"));
        assert!(!s.contains("-S "));

        // Imported songs: cover comes from tags, not the video thumbnail.
        r.tags = Some(TrackTags { title: "Song".into(), ..TrackTags::default() });
        let s = download_args(&r, Path::new("C:/M"), Path::new("C:/T"), "x").join(" ");
        assert!(!s.contains("--embed-thumbnail"));
        assert!(r.validate().is_ok());
        r.kind = Kind::Video;
        assert!(r.validate().is_err(), "tags are audio only");
    }

    #[test]
    fn rejects_bad_requests() {
        let mut r = req(Kind::Video);
        r.quality = "1080; rm".into();
        assert!(r.validate().is_err());
        r.quality = "best".into();
        r.url = "file:///C:/Windows".into();
        assert!(r.validate().is_err());
    }

    #[test]
    fn queue_order_and_restart_recovery() {
        let db = Db::open_in_memory().unwrap();
        insert(&db, "a", &req(Kind::Video)).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        insert(&db, "b", &req(Kind::Audio)).unwrap();
        assert_eq!(next_queued(&db, &[]).unwrap().unwrap().id, "a");
        assert_eq!(next_queued(&db, &["a".into()]).unwrap().unwrap().id, "b");

        set_status(&db, "a", Status::Running, None).unwrap();
        assert_eq!(requeue_running(&db).unwrap(), 1);
        assert_eq!(get(&db, "a").unwrap().unwrap().status, Status::Queued);

        finish(&db, "b", "C:/M/x.opus", 42).unwrap();
        let b = get(&db, "b").unwrap().unwrap();
        assert_eq!((b.status, b.file_size, b.kind), (Status::Done, Some(42), Kind::Audio));
        assert!(b.finished_at.is_some());
    }

    #[test]
    fn ids_are_unique_and_sortable() {
        let a = new_id();
        let b = new_id();
        assert_ne!(a, b);
        assert!(a < b || a.len() != b.len());
    }
}
