//! The external programs Grab drives. In release builds they ship inside the installer next to
//! Grab.exe; debug builds may also use copies found on PATH so development works before bundling.

use std::{
    path::{Path, PathBuf},
    process::Command,
};

use serde::Serialize;

pub struct Tool {
    pub name: &'static str,
    pub purpose: &'static str,
    version_arg: &'static str,
}

pub const TOOLS: &[Tool] = &[
    Tool { name: "yt-dlp", purpose: "Downloads videos and music", version_arg: "--version" },
    Tool { name: "ffmpeg", purpose: "Merges, converts and edits media", version_arg: "-version" },
    Tool { name: "ffprobe", purpose: "Reads media details", version_arg: "-version" },
    Tool { name: "aria2c", purpose: "Faster downloads over parallel connections", version_arg: "--version" },
    Tool { name: "node", purpose: "Solves YouTube's playback challenges", version_arg: "--version" },
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub name: &'static str,
    pub purpose: &'static str,
    pub path: Option<String>,
    pub version: Option<String>,
    /// "installed" (tool manager), "bundled" (next to Grab.exe), "system" (PATH, dev builds only) or "missing"
    pub source: &'static str,
}

fn exe_name(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

/// Bundled copy next to the app executable (where Tauri puts `externalBin` sidecars).
fn bundled(name: &str) -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let p = dir.join(exe_name(name));
    p.is_file().then_some(p)
}

fn on_path(name: &str) -> Option<PathBuf> {
    let exe = exe_name(name);
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .map(|dir| dir.join(&exe))
        .find(|p| p.is_file())
}

/// Where to run `name` from, and where it came from.
pub fn locate(name: &str) -> (Option<PathBuf>, &'static str) {
    if let Some(dir) = crate::toolmgr::dir() {
        let p = dir.join(exe_name(name));
        if p.is_file() {
            return (Some(p), "installed");
        }
    }
    if let Some(p) = bundled(name) {
        return (Some(p), "bundled");
    }
    if cfg!(debug_assertions) {
        if let Some(p) = on_path(name) {
            return (Some(p), "system");
        }
    }
    (None, "missing")
}

/// A `Command` that never flashes a console window on Windows.
pub fn command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// First meaningful line of `--version` output, trimmed to the version itself where possible.
pub fn parse_version(name: &str, output: &str) -> Option<String> {
    let line = output.lines().map(str::trim).find(|l| !l.is_empty())?;
    let v = match name {
        // "ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright …"
        "ffmpeg" | "ffprobe" => line.split_whitespace().nth(2).unwrap_or(line),
        // "aria2 version 1.37.0"
        "aria2c" => line.rsplit(' ').next().unwrap_or(line),
        _ => line,
    };
    Some(v.trim_start_matches('v').chars().take(40).collect())
}

pub fn status() -> Vec<ToolStatus> {
    TOOLS
        .iter()
        .map(|t| {
            let (path, source) = locate(t.name);
            let version = path.as_ref().and_then(|p| {
                let out = command(p).arg(t.version_arg).output().ok()?;
                parse_version(t.name, &String::from_utf8_lossy(&out.stdout))
            });
            ToolStatus {
                name: t.name,
                purpose: t.purpose,
                path: path.map(|p| p.display().to_string()),
                version,
                source,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn parses_versions() {
        assert_eq!(parse_version("yt-dlp", "2026.10.26\n").as_deref(), Some("2026.10.26"));
        assert_eq!(parse_version("node", "v26.8.1\r\n").as_deref(), Some("26.8.1"));
        assert_eq!(
            parse_version("ffmpeg", "ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright (c) 2000-2026").as_deref(),
            Some("9.0.2-full_build-www.gyan.dev")
        );
        assert_eq!(parse_version("aria2c", "aria2 version 1.37.0\nCopyright").as_deref(), Some("1.37.0"));
        assert_eq!(parse_version("x", "\n\n"), None);
    }
}
