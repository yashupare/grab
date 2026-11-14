//! Video tools (Merge, Trim, Compress, Convert): reading files with ffprobe, finding a working
//! hardware encoder, and turning a tool request into ffmpeg passes.
//!
//! `plan` is a pure function (probes in, ffmpeg arguments out) so every tool's command line is
//! tested without running ffmpeg; `jobs.rs` runs the passes and reports progress.

use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::OnceLock,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
    tags::safe_file_name,
    ytdlp,
};

// ---------------------------------------------------------------- probing

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoStream {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub pix_fmt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioStream {
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub path: String,
    pub name: String,
    pub duration: f64,
    pub size: u64,
    pub video: Option<VideoStream>,
    pub audio: Option<AudioStream>,
}

fn ffmpeg_dir() -> AppResult<PathBuf> {
    Ok(ytdlp::tool_paths()?.ffmpeg_dir)
}

fn tool(name: &str) -> AppResult<tokio::process::Command> {
    let mut cmd = tokio::process::Command::new(ffmpeg_dir()?.join(format!("{name}.exe")));
    cmd.stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    Ok(cmd)
}

pub fn ffmpeg() -> AppResult<tokio::process::Command> {
    tool("ffmpeg")
}

fn rate(s: &str) -> f64 {
    match s.split_once('/') {
        Some((n, d)) => {
            let (n, d) = (n.parse::<f64>().unwrap_or(0.0), d.parse::<f64>().unwrap_or(0.0));
            if d > 0.0 { n / d } else { 0.0 }
        }
        None => s.parse().unwrap_or(0.0),
    }
}

/// ffprobe's JSON → Probe. Cover art in audio files is not a video stream.
pub fn parse_probe(path: &str, size: u64, v: &Value) -> Probe {
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"].as_u64() != Some(1))
        .map(|s| VideoStream {
            codec: s["codec_name"].as_str().unwrap_or("").into(),
            width: s["width"].as_u64().unwrap_or(0) as u32,
            height: s["height"].as_u64().unwrap_or(0) as u32,
            fps: { let f = rate(s["avg_frame_rate"].as_str().unwrap_or("0")); if f > 0.0 { f } else { rate(s["r_frame_rate"].as_str().unwrap_or("0")) } },
            pix_fmt: s["pix_fmt"].as_str().unwrap_or("").into(),
        });
    let audio = streams.iter().find(|s| s["codec_type"] == "audio").map(|s| AudioStream {
        codec: s["codec_name"].as_str().unwrap_or("").into(),
        sample_rate: s["sample_rate"].as_str().and_then(|r| r.parse().ok()).unwrap_or(0),
        channels: s["channels"].as_u64().unwrap_or(0) as u32,
    });
    let duration = v["format"]["duration"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0.0);
    Probe {
        path: path.into(),
        name: Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        duration,
        size,
        video,
        audio,
    }
}

pub async fn probe(path: &str) -> AppResult<Probe> {
    let meta = std::fs::metadata(path).map_err(|_| AppError::Invalid(format!("Can't find {path}.")))?;
    if !meta.is_file() {
        return Err(AppError::Invalid(format!("{path} isn't a file.")));
    }
    let mut cmd = tool("ffprobe")?;
    cmd.args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "--"]).arg(path);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let out = tokio::time::timeout(Duration::from_secs(30), cmd.output())
        .await
        .map_err(|_| AppError::Invalid("Reading the file took too long.".into()))??;
    if !out.status.success() {
        return Err(AppError::Invalid(format!(
            "“{}” isn't a video or audio file Grab can read.",
            Path::new(path).file_name().map(|n| n.to_string_lossy()).unwrap_or_default()
        )));
    }
    let v: Value = serde_json::from_slice(&out.stdout)?;
    let p = parse_probe(path, meta.len(), &v);
    if p.video.is_none() && p.audio.is_none() {
        return Err(AppError::Invalid(format!("“{}” has no video or audio.", p.name)));
    }
    Ok(p)
}

/// A small JPEG from `at` seconds, for clip lists. Cached by path + modified time.
pub async fn thumbnail(path: &str, at: f64, cache: &Path) -> AppResult<PathBuf> {
    use sha2::{Digest, Sha256};
    let mtime = std::fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    let key = hex::encode(&Sha256::digest(format!("{path}|{mtime}|{at:.1}").as_bytes())[..10]);
    let out = cache.join(format!("{key}.jpg"));
    if out.is_file() {
        return Ok(out);
    }
    std::fs::create_dir_all(cache)?;
    let mut cmd = ffmpeg()?;
    cmd.args(["-hide_banner", "-loglevel", "error", "-ss", &format!("{at:.2}"), "-i"])
        .arg(path)
        .args(["-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "4", "-y"])
        .arg(&out)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let ok = tokio::time::timeout(Duration::from_secs(20), cmd.status()).await.map(|s| s.map(|s| s.success()).unwrap_or(false)).unwrap_or(false);
    if ok && out.is_file() { Ok(out) } else { Err(AppError::Invalid("No preview for this file.".into())) }
}

// ---------------------------------------------------------------- hardware encoders

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Encoder {
    Nvenc,
    Qsv,
    Amf,
    Software,
}

impl Encoder {
    pub fn label(self) -> &'static str {
        match self {
            Encoder::Nvenc => "NVIDIA (NVENC)",
            Encoder::Qsv => "Intel Quick Sync",
            Encoder::Amf => "AMD (AMF)",
            Encoder::Software => "Software (x264)",
        }
    }

    /// H.264 at good quality, sized by the encoder's own quality scale.
    pub fn video_args(self) -> Vec<String> {
        let a: &[&str] = match self {
            Encoder::Nvenc => &["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "23", "-b:v", "0"],
            Encoder::Qsv => &["-c:v", "h264_qsv", "-preset", "medium", "-global_quality", "23"],
            Encoder::Amf => &["-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", "22", "-qp_p", "24"],
            Encoder::Software => &["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"],
        };
        a.iter().map(|s| s.to_string()).collect()
    }
}

static DETECTED: OnceLock<Vec<Encoder>> = OnceLock::new();

/// Hardware encoders that actually work on this PC (a driver can be missing even when ffmpeg
/// lists the encoder). Tested once, with a tiny encode each.
pub async fn detect() -> Vec<Encoder> {
    if let Some(d) = DETECTED.get() {
        return d.clone();
    }
    let mut found = Vec::new();
    for (enc, name) in [(Encoder::Nvenc, "h264_nvenc"), (Encoder::Qsv, "h264_qsv"), (Encoder::Amf, "h264_amf")] {
        let Ok(mut cmd) = ffmpeg() else { break };
        cmd.args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=256x144:d=0.2", "-c:v", name, "-f", "null", "-"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Ok(Ok(s)) = tokio::time::timeout(Duration::from_secs(15), cmd.status()).await
            && s.success()
        {
            found.push(enc);
        }
    }
    tracing::info!(encoders = ?found, "hardware video encoders");
    let _ = DETECTED.set(found.clone());
    found
}

/// The encoder to use: the first working hardware one, unless switched off.
pub async fn pick_encoder(hardware: bool) -> Encoder {
    if !hardware {
        return Encoder::Software;
    }
    detect().await.first().copied().unwrap_or(Encoder::Software)
}

// ---------------------------------------------------------------- requests

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MergeSize {
    /// Same size as the first clip.
    First,
    P1080,
    P720,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConvertTo {
    Mp4,
    Mkv,
    Webm,
    Gif,
    Mp3,
    M4a,
    Opus,
    /// The original audio stream, no re-encoding.
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "tool", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Tool {
    Merge { inputs: Vec<String>, size: MergeSize },
    Trim { input: String, start: f64, end: f64, precise: bool },
    /// Target size in megabytes (1 MB = 1,000,000 bytes, like WhatsApp and Discord count).
    Compress { input: String, target_mb: f64 },
    Convert { input: String, to: ConvertTo },
}

impl Tool {
    pub fn inputs(&self) -> Vec<&str> {
        match self {
            Tool::Merge { inputs, .. } => inputs.iter().map(String::as_str).collect(),
            Tool::Trim { input, .. } | Tool::Compress { input, .. } | Tool::Convert { input, .. } => vec![input.as_str()],
        }
    }
    pub fn verb(&self) -> &'static str {
        match self {
            Tool::Merge { .. } => "Merge",
            Tool::Trim { .. } => "Trim",
            Tool::Compress { .. } => "Compress",
            Tool::Convert { .. } => "Convert",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    #[serde(flatten)]
    pub tool: Tool,
    /// Folder to save in (absolute).
    pub output_dir: String,
    /// File name without extension.
    pub name: String,
}

impl ExportRequest {
    pub fn validate(&self) -> AppResult<()> {
        let inputs = self.tool.inputs();
        if inputs.is_empty() || inputs.len() > 200 {
            return Err(AppError::Invalid("Add at least one file.".into()));
        }
        if let Tool::Merge { inputs, .. } = &self.tool
            && inputs.len() < 2
        {
            return Err(AppError::Invalid("Add at least two clips to merge.".into()));
        }
        for i in &inputs {
            if !Path::new(i).is_absolute() || !Path::new(i).is_file() {
                return Err(AppError::Invalid(format!("Can't find {i}.")));
            }
        }
        if !Path::new(&self.output_dir).is_absolute() {
            return Err(AppError::Invalid("Choose a folder to save in.".into()));
        }
        if self.name.trim().is_empty() || self.name.len() > 200 {
            return Err(AppError::Invalid("Give the file a name.".into()));
        }
        match &self.tool {
            Tool::Trim { start, end, .. } if !(start.is_finite() && end.is_finite() && *start >= 0.0 && end > start) => {
                Err(AppError::Invalid("The end must be after the start.".into()))
            }
            Tool::Compress { target_mb, .. } if !(target_mb.is_finite() && *target_mb >= 0.5 && *target_mb <= 100_000.0) => {
                Err(AppError::Invalid("Pick a size of at least 0.5 MB.".into()))
            }
            _ => Ok(()),
        }
    }
}

// ---------------------------------------------------------------- planning

/// ffmpeg work for one export.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    /// One or two passes (two-pass compress). The last one writes `{OUT}`.
    pub passes: Vec<Vec<String>>,
    pub ext: String,
    /// Seconds of output, for progress.
    pub duration: f64,
    /// No re-encoding: fast, and hardware doesn't matter.
    pub copy: bool,
    /// Concat list file contents (fast merge), written next to the job's temp files.
    pub concat_list: Option<String>,
    /// Compress: once `{AUDIO}` exists, `{VKBPS}` is set from what's left of the target.
    pub budget: Option<Budget>,
}

/// A size target for compress. The audio is encoded first and measured, so the video gets
/// exactly what's left (quiet or simple audio uses far less than its nominal bitrate).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Budget {
    pub target_bytes: f64,
    pub duration: f64,
    /// Used before the audio is measured, and when there's no audio.
    pub estimate_kbps: u32,
}

impl Budget {
    /// Video kbps for the bytes left after `audio_bytes`. Keeps 1.5% for the MP4 container.
    pub fn video_kbps(&self, audio_bytes: u64) -> u32 {
        let left = self.target_bytes * 0.985 - audio_bytes as f64;
        ((left * 8.0 / 1000.0 / self.duration.max(0.1)).max(80.0)) as u32
    }
}

/// Placeholders replaced by the runner with real paths.
pub const OUT: &str = "{OUT}";
pub const PASSLOG: &str = "{PASSLOG}";
pub const LIST: &str = "{LIST}";
pub const NULL: &str = "NUL";
pub const AUDIO: &str = "{AUDIO}";
pub const VKBPS: &str = "{VKBPS}";

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

fn even(n: u32) -> u32 {
    n.max(2) & !1
}

/// Codecs MP4 plays everywhere with.
fn mp4_video(c: &str) -> bool {
    matches!(c, "h264" | "hevc" | "av1")
}
fn mp4_audio(c: &str) -> bool {
    matches!(c, "aac" | "mp3")
}

fn ext_of(path: &str) -> String {
    Path::new(path).extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_else(|| "mkv".into())
}

fn audio_ext(codec: &str) -> Option<&'static str> {
    Some(match codec {
        "aac" => "m4a",
        "opus" => "opus",
        "mp3" => "mp3",
        "vorbis" => "ogg",
        "flac" => "flac",
        _ => return None,
    })
}

/// Can the clips be joined without re-encoding?
pub fn can_fast_join(p: &[Probe], size: MergeSize) -> bool {
    let Some(first) = p.first() else { return false };
    let same_video = p.iter().all(|x| match (&x.video, &first.video) {
        (Some(a), Some(b)) => a.codec == b.codec && a.width == b.width && a.height == b.height && a.pix_fmt == b.pix_fmt && (a.fps - b.fps).abs() < 0.01,
        (None, None) => true,
        _ => false,
    });
    let same_audio = p.iter().all(|x| match (&x.audio, &first.audio) {
        (Some(a), Some(b)) => a.codec == b.codec && a.sample_rate == b.sample_rate && a.channels == b.channels,
        (None, None) => true,
        _ => false,
    });
    let size_ok = match (size, &first.video) {
        (MergeSize::First, _) | (_, None) => true,
        (MergeSize::P1080, Some(v)) => v.height == 1080,
        (MergeSize::P720, Some(v)) => v.height == 720,
    };
    same_video && same_audio && size_ok
}

/// Escape a path for an ffmpeg concat list.
fn concat_line(path: &str) -> String {
    format!("file '{}'\n", path.replace('\'', "'\\''"))
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompressEstimate {
    pub video_kbps: u32,
    pub audio_kbps: u32,
    /// Output height after downscaling (never upscaled).
    pub height: u32,
    /// "great", "good", "ok", "low"
    pub quality: &'static str,
    /// The file is already at or under the target.
    pub already_smaller: bool,
    /// Too long for that size: even the lowest settings won't fit.
    pub too_small: bool,
}

/// Bitrates and resolution for a target size. Leaves ~3% for the container.
pub fn compress_estimate(p: &Probe, target_mb: f64) -> CompressEstimate {
    let target_bytes = target_mb * 1_000_000.0;
    let dur = p.duration.max(0.1);
    let total_kbps = target_bytes * 8.0 / 1000.0 / dur * 0.97;
    let audio_kbps = if p.audio.is_some() { (total_kbps * 0.1).clamp(48.0, 128.0) } else { 0.0 };
    let video_kbps = (total_kbps - audio_kbps).max(0.0);
    let src_h = p.video.as_ref().map_or(0, |v| v.height);
    let cap = if video_kbps >= 2500.0 { 1080 } else if video_kbps >= 1200.0 { 720 } else if video_kbps >= 600.0 { 480 } else { 360 };
    let height = if src_h == 0 { 0 } else { src_h.min(cap) };
    let pixels = height as f64 * height as f64 * 16.0 / 9.0;
    let bpp = if pixels > 0.0 { video_kbps * 1000.0 / (pixels * 30.0) } else { 0.0 };
    let quality = if bpp >= 0.1 { "great" } else if bpp >= 0.06 { "good" } else if bpp >= 0.035 { "ok" } else { "low" };
    CompressEstimate {
        video_kbps: video_kbps as u32,
        audio_kbps: audio_kbps as u32,
        height,
        quality,
        already_smaller: p.size as f64 <= target_bytes,
        too_small: video_kbps < 80.0,
    }
}

pub fn plan(tool: &Tool, probes: &[Probe], enc: Encoder) -> AppResult<Plan> {
    let head = s(&["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats"]);
    let mp4_tail = s(&["-movflags", "+faststart"]);
    let first = probes.first().ok_or_else(|| AppError::Invalid("No input.".into()))?;
    let input = |p: &Probe| vec!["-i".to_string(), p.path.clone()];

    let plan = match tool {
        Tool::Merge { size, .. } => {
            let total: f64 = probes.iter().map(|p| p.duration).sum();
            let any_video = probes.iter().any(|p| p.video.is_some());
            if can_fast_join(probes, *size) {
                let list: String = probes.iter().map(|p| concat_line(&p.path)).collect();
                let ext = match (&first.video, &first.audio) {
                    (Some(v), a) if mp4_video(&v.codec) && a.as_ref().is_none_or(|a| mp4_audio(&a.codec)) => "mp4",
                    (None, Some(a)) => audio_ext(&a.codec).unwrap_or("mka"),
                    _ => "mkv",
                };
                let mut a = head.clone();
                a.extend(s(&["-f", "concat", "-safe", "0", "-i", LIST, "-map", "0", "-c", "copy"]));
                if ext == "mp4" {
                    a.extend(mp4_tail.clone());
                }
                a.push(OUT.into());
                Plan { passes: vec![a], ext: ext.into(), duration: total, copy: true, concat_list: Some(list) , budget: None }
            } else if !any_video {
                // Audio only: decode and join, AAC out.
                let mut a = head.clone();
                for p in probes {
                    a.extend(input(p));
                }
                let chain: String = (0..probes.len()).map(|i| format!("[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a{i}];")).collect();
                let joins: String = (0..probes.len()).map(|i| format!("[a{i}]")).collect();
                a.extend(["-filter_complex".into(), format!("{chain}{joins}concat=n={}:v=0:a=1[a]", probes.len()), "-map".into(), "[a]".into()]);
                a.extend(s(&["-c:a", "aac", "-b:a", "192k"]));
                a.push(OUT.into());
                Plan { passes: vec![a], ext: "m4a".into(), duration: total, copy: false, concat_list: None , budget: None }
            } else {
                let (w, h) = match size {
                    MergeSize::P1080 => (1920, 1080),
                    MergeSize::P720 => (1280, 720),
                    MergeSize::First => first.video.as_ref().or(probes.iter().find_map(|p| p.video.as_ref())).map_or((1280, 720), |v| (even(v.width), even(v.height))),
                };
                let fps = first.video.as_ref().map_or(30.0, |v| v.fps).clamp(1.0, 60.0);
                let fps = if fps > 0.0 { (fps * 1000.0).round() / 1000.0 } else { 30.0 };
                let mut a = head.clone();
                for p in probes {
                    a.extend(input(p));
                }
                // Clips without sound get silence of the same length (extra inputs after the clips).
                let mut filters = String::new();
                let mut silent = 0usize;
                for (i, p) in probes.iter().enumerate() {
                    match &p.video {
                        Some(_) => filters.push_str(&format!(
                            "[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p[v{i}];"
                        )),
                        None => filters.push_str(&format!("color=c=black:s={w}x{h}:r={fps}:d={:.3},format=yuv420p[v{i}];", p.duration)),
                    }
                    if p.audio.is_some() {
                        filters.push_str(&format!("[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a{i}];"));
                    } else {
                        let idx = probes.len() + silent;
                        silent += 1;
                        a.extend(["-f".into(), "lavfi".into(), "-t".into(), format!("{:.3}", p.duration.max(0.04)), "-i".into(), "anullsrc=r=48000:cl=stereo".into()]);
                        filters.push_str(&format!("[{idx}:a]anull[a{i}];"));
                    }
                }
                let joins: String = (0..probes.len()).map(|i| format!("[v{i}][a{i}]")).collect();
                filters.push_str(&format!("{joins}concat=n={}:v=1:a=1[v][a]", probes.len()));
                a.extend(["-filter_complex".into(), filters, "-map".into(), "[v]".into(), "-map".into(), "[a]".into()]);
                a.extend(enc.video_args());
                a.extend(s(&["-c:a", "aac", "-b:a", "192k"]));
                a.extend(mp4_tail.clone());
                a.push(OUT.into());
                Plan { passes: vec![a], ext: "mp4".into(), duration: total, copy: false, concat_list: None , budget: None }
            }
        }

        Tool::Trim { start, end, precise, .. } => {
            let end = end.min(first.duration.max(*start + 0.1));
            let len = (end - start).max(0.1);
            let mut a = head.clone();
            a.extend(["-ss".into(), format!("{start:.3}")]);
            a.extend(input(first));
            a.extend(["-t".into(), format!("{len:.3}")]);
            if *precise && first.video.is_some() {
                a.extend(s(&["-map", "0:v:0", "-map", "0:a:0?"]));
                a.extend(enc.video_args());
                a.extend(s(&["-c:a", "aac", "-b:a", "192k"]));
                a.extend(mp4_tail.clone());
                a.push(OUT.into());
                Plan { passes: vec![a], ext: "mp4".into(), duration: len, copy: false, concat_list: None , budget: None }
            } else {
                // Fast: cuts at the nearest keyframe (audio cuts are exact anyway).
                let ext = ext_of(&first.path);
                a.extend(s(&["-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero"]));
                if ext == "mp4" || ext == "m4a" || ext == "mov" {
                    a.extend(mp4_tail.clone());
                }
                a.push(OUT.into());
                Plan { passes: vec![a], ext, duration: len, copy: true, concat_list: None , budget: None }
            }
        }

        Tool::Compress { target_mb, .. } => {
            let v = first.video.as_ref().ok_or_else(|| AppError::Invalid("Compress works on videos. For audio, use Convert.".into()))?;
            let e = compress_estimate(first, *target_mb);
            if e.too_small {
                return Err(AppError::Invalid(format!(
                    "This video is too long to fit in {target_mb} MB. Trim it first, or pick a bigger size."
                )));
            }
            let scale = if e.height < v.height { format!("scale=-2:{},format=yuv420p", e.height) } else { "format=yuv420p".into() };
            let has_audio = first.audio.is_some();
            let mut passes = Vec::new();
            // 0: the audio on its own, so its real size is known before the video is sized.
            if has_audio {
                let mut a = head.clone();
                a.extend(input(first));
                a.extend(["-vn".into(), "-c:a".into(), "aac".into(), "-b:a".into(), format!("{}k", e.audio_kbps), AUDIO.into()]);
                passes.push(a);
            }
            // Two-pass x264 is the reliable way to land on a size (hardware encoders miss by more).
            let video = |pass: &str| {
                let mut a = head.clone();
                a.extend(input(first));
                if pass == "2" && has_audio {
                    a.extend(["-i".into(), AUDIO.into(), "-map".into(), "0:v:0".into(), "-map".into(), "1:a:0".into(), "-c:a".into(), "copy".into()]);
                }
                a.extend(["-vf".into(), scale.clone()]);
                a.extend(s(&["-c:v", "libx264", "-preset", "medium", "-b:v", VKBPS]));
                a.extend(["-pass".into(), pass.into(), "-passlogfile".into(), PASSLOG.into()]);
                a
            };
            let mut p1 = video("1");
            p1.extend(s(&["-an", "-f", "null", NULL]));
            let mut p2 = video("2");
            if !has_audio {
                p2.push("-an".into());
            }
            p2.extend(mp4_tail.clone());
            p2.push(OUT.into());
            passes.extend([p1, p2]);
            let budget = Budget { target_bytes: target_mb * 1_000_000.0, duration: first.duration, estimate_kbps: e.video_kbps };
            Plan { passes, ext: "mp4".into(), duration: first.duration, copy: false, concat_list: None, budget: Some(budget) }
        }

        Tool::Convert { to, .. } => {
            let mut a = head.clone();
            a.extend(input(first));
            let vc = first.video.as_ref().map(|v| v.codec.as_str());
            let ac = first.audio.as_ref().map(|x| x.codec.as_str());
            let need_video = matches!(to, ConvertTo::Mp4 | ConvertTo::Webm | ConvertTo::Gif);
            if need_video && vc.is_none() {
                return Err(AppError::Invalid("This file has no video. Pick an audio format.".into()));
            }
            if !need_video && *to != ConvertTo::Mkv && ac.is_none() {
                return Err(AppError::Invalid("This file has no audio to extract.".into()));
            }
            let (ext, copy): (&str, bool) = match to {
                ConvertTo::Mp4 => {
                    let copy_v = vc.is_some_and(mp4_video);
                    let copy_a = ac.is_none_or(mp4_audio);
                    a.extend(s(&["-map", "0:v:0", "-map", "0:a:0?"]));
                    if copy_v { a.extend(s(&["-c:v", "copy"])) } else { a.extend(enc.video_args()) }
                    if copy_a { a.extend(s(&["-c:a", "copy"])) } else { a.extend(s(&["-c:a", "aac", "-b:a", "192k"])) }
                    a.extend(mp4_tail.clone());
                    ("mp4", copy_v && copy_a)
                }
                ConvertTo::Mkv => {
                    a.extend(s(&["-map", "0", "-c", "copy"]));
                    ("mkv", true)
                }
                ConvertTo::Webm => {
                    let copy_v = matches!(vc, Some("vp8" | "vp9" | "av1"));
                    let copy_a = ac.is_none_or(|c| matches!(c, "opus" | "vorbis"));
                    a.extend(s(&["-map", "0:v:0", "-map", "0:a:0?"]));
                    if copy_v {
                        a.extend(s(&["-c:v", "copy"]))
                    } else {
                        a.extend(s(&["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1"]))
                    }
                    if copy_a { a.extend(s(&["-c:a", "copy"])) } else { a.extend(s(&["-c:a", "libopus", "-b:a", "128k"])) }
                    ("webm", copy_v && copy_a)
                }
                ConvertTo::Gif => {
                    let w = first.video.as_ref().map_or(480, |v| v.width.min(480));
                    a.extend([
                        "-filter_complex".into(),
                        format!("[0:v]fps=12,scale={w}:-1:flags=lanczos,split[x][y];[x]palettegen=stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=4"),
                        "-an".into(),
                    ]);
                    ("gif", false)
                }
                ConvertTo::Mp3 => {
                    a.push("-vn".into());
                    if ac == Some("mp3") { a.extend(s(&["-c:a", "copy"])) } else { a.extend(s(&["-c:a", "libmp3lame", "-b:a", "192k"])) }
                    ("mp3", ac == Some("mp3"))
                }
                ConvertTo::M4a => {
                    a.push("-vn".into());
                    if ac == Some("aac") { a.extend(s(&["-c:a", "copy"])) } else { a.extend(s(&["-c:a", "aac", "-b:a", "192k"])) }
                    a.extend(mp4_tail.clone());
                    ("m4a", ac == Some("aac"))
                }
                ConvertTo::Opus => {
                    a.push("-vn".into());
                    if ac == Some("opus") { a.extend(s(&["-c:a", "copy"])) } else { a.extend(s(&["-c:a", "libopus", "-b:a", "128k"])) }
                    ("opus", ac == Some("opus"))
                }
                ConvertTo::Audio => {
                    a.push("-vn".into());
                    match ac.and_then(audio_ext) {
                        Some(ext) => {
                            a.extend(s(&["-c:a", "copy"]));
                            if ext == "m4a" {
                                a.extend(mp4_tail.clone());
                            }
                            (ext, true)
                        }
                        None => {
                            a.extend(s(&["-c:a", "aac", "-b:a", "192k"]));
                            a.extend(mp4_tail.clone());
                            ("m4a", false)
                        }
                    }
                }
            };
            a.push(OUT.into());
            Plan { passes: vec![a], ext: ext.into(), duration: first.duration, copy, concat_list: None , budget: None }
        }
    };
    Ok(plan)
}

/// `dir\name.ext`, or `dir\name (2).ext` … when taken.
pub fn unique_output(dir: &Path, name: &str, ext: &str) -> PathBuf {
    let base = safe_file_name(name);
    let mut p = dir.join(format!("{base}.{ext}"));
    let mut n = 2;
    while p.exists() {
        p = dir.join(format!("{base} ({n}).{ext}"));
        n += 1;
    }
    p
}

/// `out_time_us=12345678` lines from `-progress pipe:1` → seconds.
pub fn progress_seconds(line: &str) -> Option<f64> {
    let v = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms="))?;
    v.trim().parse::<f64>().ok().filter(|x| *x >= 0.0).map(|us| us / 1_000_000.0)
}

/// Turn ffmpeg's last error lines into one sentence.
pub fn friendly_error(stderr: &str) -> String {
    let s = stderr.to_lowercase();
    if s.contains("no space left") {
        return "Your disk is full. Free up space or choose another folder.".into();
    }
    if s.contains("permission denied") {
        return "Grab can't write to that folder. Choose another one.".into();
    }
    if s.contains("invalid data found") {
        return "One of the files is damaged or isn't a video Grab can read.".into();
    }
    stderr.lines().rev().map(str::trim).find(|l| !l.is_empty()).map(|l| l.chars().take(240).collect()).unwrap_or_else(|| "The export failed.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub fn vid(path: &str, w: u32, h: u32, codec: &str, audio: Option<&str>, dur: f64) -> Probe {
        Probe {
            path: path.into(),
            name: path.into(),
            duration: dur,
            size: 50_000_000,
            video: Some(VideoStream { codec: codec.into(), width: w, height: h, fps: 30.0, pix_fmt: "yuv420p".into() }),
            audio: audio.map(|c| AudioStream { codec: c.into(), sample_rate: 48000, channels: 2 }),
        }
    }

    #[test]
    fn parses_ffprobe_and_skips_cover_art() {
        let v = json!({
            "format": { "duration": "12.5" },
            "streams": [
                { "codec_type": "audio", "codec_name": "aac", "sample_rate": "44100", "channels": 2 },
                { "codec_type": "video", "codec_name": "mjpeg", "width": 600, "height": 600, "disposition": { "attached_pic": 1 } },
                { "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080, "avg_frame_rate": "30000/1001", "pix_fmt": "yuv420p", "disposition": { "attached_pic": 0 } }
            ]
        });
        let p = parse_probe("C:/v/a.mp4", 10, &v);
        let vs = p.video.unwrap();
        assert_eq!((vs.codec.as_str(), vs.width, (vs.fps * 100.0).round()), ("h264", 1920, 2997.0));
        assert_eq!(p.audio.unwrap().sample_rate, 44100);
        assert_eq!(p.duration, 12.5);

        let song = json!({ "format": { "duration": "3" }, "streams": [
            { "codec_type": "audio", "codec_name": "mp3", "sample_rate": "44100", "channels": 2 },
            { "codec_type": "video", "codec_name": "mjpeg", "disposition": { "attached_pic": 1 } }
        ]});
        assert!(parse_probe("s.mp3", 1, &song).video.is_none(), "cover art isn't video");
    }

    #[test]
    fn merge_joins_fast_when_clips_match() {
        let a = vid("C:/a.mp4", 1920, 1080, "h264", Some("aac"), 10.0);
        let b = vid("C:/it's.mp4", 1920, 1080, "h264", Some("aac"), 5.0);
        let p = plan(&Tool::Merge { inputs: vec![], size: MergeSize::First }, &[a.clone(), b.clone()], Encoder::Qsv).unwrap();
        assert!(p.copy && p.ext == "mp4" && p.duration == 15.0);
        assert!(p.concat_list.as_deref().unwrap().contains("file 'C:/it'\\''s.mp4'"));
        assert!(p.passes[0].join(" ").contains("-f concat -safe 0 -i {LIST} -map 0 -c copy"));
        // A preset that changes size forces re-encoding.
        assert!(!plan(&Tool::Merge { inputs: vec![], size: MergeSize::P720 }, &[a, b], Encoder::Qsv).unwrap().copy);
    }

    #[test]
    fn merge_reencodes_mixed_clips_with_silence_for_mute_ones() {
        let a = vid("C:/a.mp4", 1280, 720, "h264", Some("aac"), 10.0);
        let b = vid("C:/b.webm", 1920, 1080, "vp9", None, 4.0);
        let p = plan(&Tool::Merge { inputs: vec![], size: MergeSize::First }, &[a, b], Encoder::Qsv).unwrap();
        let cmd = p.passes[0].join(" ");
        assert!(!p.copy && p.ext == "mp4");
        assert!(cmd.contains("scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720"), "{cmd}");
        assert!(cmd.contains("-f lavfi -t 4.000 -i anullsrc"), "{cmd}");
        assert!(cmd.contains("[2:a]anull[a1]") && cmd.contains("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"), "{cmd}");
        assert!(cmd.contains("-c:v h264_qsv"));
    }

    #[test]
    fn trim_fast_copies_and_precise_reencodes() {
        let a = vid("C:/clip.mkv", 1920, 1080, "h264", Some("aac"), 60.0);
        let fast = plan(&Tool::Trim { input: String::new(), start: 5.0, end: 12.5, precise: false }, std::slice::from_ref(&a), Encoder::Software).unwrap();
        assert!(fast.copy && fast.ext == "mkv" && (fast.duration - 7.5).abs() < 1e-9);
        assert!(fast.passes[0].join(" ").contains("-ss 5.000 -i C:/clip.mkv -t 7.500 -map 0 -c copy"));
        let precise = plan(&Tool::Trim { input: String::new(), start: 5.0, end: 12.5, precise: true }, &[a], Encoder::Software).unwrap();
        assert!(!precise.copy && precise.ext == "mp4" && precise.passes[0].join(" ").contains("libx264"));
    }

    #[test]
    fn compress_sizes_bitrate_for_the_target() {
        let a = vid("C:/long.mp4", 1920, 1080, "h264", Some("aac"), 120.0);
        let e = compress_estimate(&a, 16.0);
        // 16 MB over 2 min ≈ 1035 kbps total → ~931 video + ~103 audio, 480p
        assert_eq!((e.height, e.audio_kbps), (480, 103));
        assert!((925..=935).contains(&e.video_kbps), "{}", e.video_kbps);
        assert!(!e.already_smaller && !e.too_small);
        let p = plan(&Tool::Compress { input: String::new(), target_mb: 16.0 }, std::slice::from_ref(&a), Encoder::Qsv).unwrap();
        assert_eq!(p.passes.len(), 3, "audio, video pass 1, video pass 2");
        assert!(p.passes[0].join(" ").ends_with("-vn -c:a aac -b:a 103k {AUDIO}"));
        assert!(p.passes[1].join(" ").contains("-b:v {VKBPS} -pass 1") && p.passes[1].join(" ").ends_with("-an -f null NUL"));
        assert!(p.passes[2].join(" ").contains("-i {AUDIO} -map 0:v:0 -map 1:a:0 -c:a copy -vf scale=-2:480"));
        let b = p.budget.unwrap();
        // 16 MB, 2 min, 1 MB of measured audio → (15.76 MB - 1 MB) over 120 s ≈ 984 kbps
        assert_eq!(b.video_kbps(1_000_000), 984);
        assert_eq!(b.video_kbps(100_000_000), 80, "never below the floor");
        assert!(compress_estimate(&a, 100.0).already_smaller);
        assert!(plan(&Tool::Compress { input: String::new(), target_mb: 0.5 }, &[a], Encoder::Qsv).is_err(), "2 min can't fit in 0.5 MB");
    }

    #[test]
    fn convert_copies_when_it_can() {
        let a = vid("C:/v.mkv", 1920, 1080, "h264", Some("aac"), 10.0);
        let mp4 = plan(&Tool::Convert { input: String::new(), to: ConvertTo::Mp4 }, std::slice::from_ref(&a), Encoder::Qsv).unwrap();
        assert!(mp4.copy && mp4.passes[0].join(" ").contains("-c:v copy"));
        let audio = plan(&Tool::Convert { input: String::new(), to: ConvertTo::Audio }, std::slice::from_ref(&a), Encoder::Qsv).unwrap();
        assert_eq!((audio.ext.as_str(), audio.copy), ("m4a", true));
        let webm = plan(&Tool::Convert { input: String::new(), to: ConvertTo::Webm }, std::slice::from_ref(&a), Encoder::Qsv).unwrap();
        assert!(!webm.copy && webm.passes[0].join(" ").contains("libvpx-vp9"));
        let gif = plan(&Tool::Convert { input: String::new(), to: ConvertTo::Gif }, std::slice::from_ref(&a), Encoder::Qsv).unwrap();
        assert!(gif.passes[0].join(" ").contains("palettegen"));
        let vp9 = vid("C:/v.webm", 640, 360, "vp9", Some("opus"), 10.0);
        let to_mp4 = plan(&Tool::Convert { input: String::new(), to: ConvertTo::Mp4 }, std::slice::from_ref(&vp9), Encoder::Nvenc).unwrap();
        assert!(!to_mp4.copy && to_mp4.passes[0].join(" ").contains("h264_nvenc") && to_mp4.passes[0].join(" ").contains("-c:a aac"));
        assert_eq!(plan(&Tool::Convert { input: String::new(), to: ConvertTo::Audio }, &[vp9], Encoder::Qsv).unwrap().ext, "opus");
        let song = Probe { video: None, ..vid("C:/s.mp3", 0, 0, "", Some("mp3"), 3.0) };
        assert!(plan(&Tool::Convert { input: String::new(), to: ConvertTo::Gif }, &[song], Encoder::Qsv).is_err());
    }

    #[test]
    fn reads_requests_as_the_ui_sends_them() {
        let r: ExportRequest = serde_json::from_value(json!({
            "tool": "compress", "input": "C:/v.mp4", "targetMb": 10, "outputDir": "C:/out", "name": "x"
        }))
        .unwrap();
        assert_eq!(r.tool, Tool::Compress { input: "C:/v.mp4".into(), target_mb: 10.0 });
        let r: ExportRequest = serde_json::from_value(json!({
            "tool": "merge", "inputs": ["a", "b"], "size": "p1080", "outputDir": "C:/out", "name": "m"
        }))
        .unwrap();
        assert_eq!(r.tool, Tool::Merge { inputs: vec!["a".into(), "b".into()], size: MergeSize::P1080 });
        let t: Tool = serde_json::from_value(json!({ "tool": "trim", "input": "a", "start": 1, "end": 2, "precise": true })).unwrap();
        assert!(matches!(t, Tool::Trim { precise: true, .. }));
        let c: Tool = serde_json::from_value(json!({ "tool": "convert", "input": "a", "to": "audio" })).unwrap();
        assert!(matches!(c, Tool::Convert { to: ConvertTo::Audio, .. }));
    }

    #[test]
    fn helpers() {
        assert_eq!(progress_seconds("out_time_us=1500000"), Some(1.5));
        assert_eq!(progress_seconds("out_time_us=N/A"), None);
        assert_eq!(progress_seconds("frame=10"), None);
        let dir = std::env::temp_dir();
        assert!(unique_output(&dir, "a:b", "mp4").ends_with("a_b.mp4"));
        assert!(friendly_error("x\nNo space left on device").contains("disk is full"));
    }
}

/// Runs every tool for real with ffmpeg (slow, ~1-2 min):
/// `cargo test live_tools -- --ignored --nocapture`
#[cfg(test)]
mod live {
    use super::*;

    fn bin(name: &str) -> PathBuf {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        PathBuf::from(local).join("app.grab.desktop/tools").join(format!("{name}.exe"))
    }

    fn run(args: &[String], cwd: &Path) {
        let out = std::process::Command::new(bin("ffmpeg")).current_dir(cwd).args(args).output().unwrap();
        assert!(out.status.success(), "ffmpeg failed: {}\n{}", args.join(" "), String::from_utf8_lossy(&out.stderr));
    }

    fn probe_sync(path: &Path) -> Probe {
        let out = std::process::Command::new(bin("ffprobe"))
            .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
            .arg(path)
            .output()
            .unwrap();
        let v: Value = serde_json::from_slice(&out.stdout).unwrap();
        parse_probe(&path.display().to_string(), std::fs::metadata(path).unwrap().len(), &v)
    }

    /// Execute a plan like the job runner does (placeholders → paths).
    fn exec(p: &Plan, dir: &Path, name: &str) -> PathBuf {
        let out = dir.join(format!("{name}.{}", p.ext));
        let audio = dir.join(format!("{name}-audio.m4a"));
        if let Some(list) = &p.concat_list {
            std::fs::write(dir.join("list.txt"), list).unwrap();
        }
        for pass in &p.passes {
            let vkbps = p.budget.map(|b| b.video_kbps(std::fs::metadata(&audio).map_or(0, |m| m.len())));
            let args: Vec<String> = pass
                .iter()
                .map(|a| match a.as_str() {
                    OUT => out.display().to_string(),
                    PASSLOG => dir.join("pass").display().to_string(),
                    LIST => dir.join("list.txt").display().to_string(),
                    AUDIO => audio.display().to_string(),
                    VKBPS => format!("{}k", vkbps.unwrap_or(1000)),
                    _ => a.clone(),
                })
                .collect();
            run(&args, dir);
        }
        out
    }

    fn source(dir: &Path, name: &str, size: &str, secs: u32, audio: bool, noisy: bool) -> Probe {
        let path = dir.join(name);
        let vf = if noisy { "noise=alls=25:allf=t+u" } else { "null" };
        let mut a: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i"].iter().map(|s| s.to_string()).collect();
        a.push(format!("testsrc2=s={size}:r=30:d={secs}"));
        if audio {
            a.extend(["-f".into(), "lavfi".into(), "-i".into(), format!("sine=f=440:d={secs}")]);
        }
        a.extend(["-vf".into(), vf.into(), "-c:v".into(), "libx264".into(), "-preset".into(), "ultrafast".into(), "-b:v".into(), "8M".into(), "-pix_fmt".into(), "yuv420p".into()]);
        if audio {
            a.extend(["-c:a".into(), "aac".into(), "-shortest".into()]);
        }
        a.push(path.display().to_string());
        run(&a, dir);
        probe_sync(&path)
    }

    #[test]
    #[ignore]
    fn live_tools() {
        let dir = std::env::temp_dir().join("grab-live-tools");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let enc = Encoder::Qsv;
        let a = source(&dir, "a.mp4", "1280x720", 6, true, false);
        let b = source(&dir, "b.mp4", "1280x720", 4, true, false);
        let mute = source(&dir, "mute.mp4", "640x360", 3, false, false);

        // Merge, fast join
        let p = plan(&Tool::Merge { inputs: vec![], size: MergeSize::First }, &[a.clone(), b.clone()], enc).unwrap();
        assert!(p.copy);
        let m = probe_sync(&exec(&p, &dir, "merged-fast"));
        println!("merge fast: {:.2}s", m.duration);
        assert!((m.duration - 10.0).abs() < 0.3);

        // Merge, re-encode with a silent clip and a different size
        let p = plan(&Tool::Merge { inputs: vec![], size: MergeSize::First }, &[a.clone(), mute.clone(), b.clone()], enc).unwrap();
        assert!(!p.copy);
        let m = probe_sync(&exec(&p, &dir, "merged-mixed"));
        println!("merge mixed: {:.2}s {:?} audio={}", m.duration, m.video.as_ref().map(|v| (v.width, v.height)), m.audio.is_some());
        assert!((m.duration - 13.0).abs() < 0.3 && m.audio.is_some());
        assert_eq!(m.video.as_ref().map(|v| (v.width, v.height)), Some((1280, 720)));

        // Trim fast + precise
        for precise in [false, true] {
            let p = plan(&Tool::Trim { input: String::new(), start: 1.0, end: 4.0, precise }, std::slice::from_ref(&a), enc).unwrap();
            let t = probe_sync(&exec(&p, &dir, &format!("trim-{precise}")));
            println!("trim precise={precise}: {:.2}s", t.duration);
            assert!((t.duration - 3.0).abs() < if precise { 0.1 } else { 1.1 });
        }

        // Convert to every format
        for to in [ConvertTo::Mp4, ConvertTo::Mkv, ConvertTo::Webm, ConvertTo::Gif, ConvertTo::Mp3, ConvertTo::M4a, ConvertTo::Opus, ConvertTo::Audio] {
            let p = plan(&Tool::Convert { input: String::new(), to }, std::slice::from_ref(&b), enc).unwrap();
            let c = probe_sync(&exec(&p, &dir, &format!("convert-{to:?}")));
            println!("convert {to:?}: .{} {:.2}s video={:?} audio={:?}", p.ext, c.duration, c.video.as_ref().map(|v| &v.codec), c.audio.as_ref().map(|a| &a.codec));
            assert!(c.duration > 3.5 || to == ConvertTo::Gif);
        }

        // Compress: a noisy (hard to compress) 30 s 1080p clip to 5 MB must land within 5%, never over.
        let big = source(&dir, "big.mp4", "1920x1080", 30, true, true);
        println!("compress source: {:.1} MB", big.size as f64 / 1e6);
        for target in [5.0, 10.0] {
            let p = plan(&Tool::Compress { input: String::new(), target_mb: target }, std::slice::from_ref(&big), enc).unwrap();
            let c = probe_sync(&exec(&p, &dir, &format!("compressed-{target}")));
            let mb = c.size as f64 / 1e6;
            println!("compress to {target} MB: {mb:.2} MB ({:+.1}%), {:?}", (mb / target - 1.0) * 100.0, c.video.as_ref().map(|v| v.height));
            assert!(mb <= target && mb >= target * 0.95, "{mb} MB for a {target} MB target");
        }
    }
}
