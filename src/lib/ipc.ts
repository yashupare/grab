/** Typed wrappers for the Rust commands in src-tauri/src/commands.rs. Keep the types in sync with
 *  the Rust structs (serde camelCase). Every call rejects with an `AppError`. */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Theme = "system" | "dark" | "light";
export type AudioFormat = "opus" | "m4a" | "mp3";
export type VideoQuality = "best" | "2160" | "1440" | "1080" | "720" | "480" | "360";

export interface Settings {
  theme: Theme;
  videoDir: string;
  musicDir: string;
  libraryDirs: string[];
  videoQuality: VideoQuality;
  audioFormat: AudioFormat;
  concurrentDownloads: number;
  filenameTemplate: string;
  closeToTray: boolean;
  notifications: boolean;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  logDir: string;
  schemaVersion: number;
}

export interface ToolStatus {
  name: string;
  purpose: string;
  path: string | null;
  version: string | null;
  source: "installed" | "bundled" | "system" | "missing";
}

export interface ToolPackage {
  id: string;
  label: string;
  version: string;
  size: number;
}

/** `tools-progress` event payload (Rust: toolmgr::Progress). */
export type ToolProgress =
  | { phase: "downloading"; id: string; received: number; total: number }
  | { phase: "installing"; id: string }
  | { phase: "done"; id: string }
  | { phase: "failed"; id: string; message: string };

// ---- media info (Rust: ytdlp::MediaInfo)
export interface VideoOption {
  height: number;
  label: string;
  fps: number | null;
  hdr: boolean;
  codec: string;
  size: number | null;
}
export interface AudioOption {
  id: AudioFormat;
  label: string;
  detail: string;
  size: number | null;
}
export interface SubtitleLang {
  code: string;
  name: string;
  auto: boolean;
}
export interface MediaInfo {
  id: string;
  url: string;
  title: string;
  channel: string | null;
  duration: number | null;
  thumbnail: string | null;
  viewCount: number | null;
  uploadDate: string | null;
  site: string;
  video: VideoOption[];
  audio: AudioOption[];
  subtitles: SubtitleLang[];
  chapters: number;
}

// ---- download queue (Rust: jobs.rs)
export type JobKind = "video" | "audio";
export type JobStatus = "queued" | "running" | "paused" | "done" | "failed" | "cancelled";

export interface DownloadRequest {
  url: string;
  title: string;
  thumbnail: string | null;
  kind: JobKind;
  quality: string;
  audioFormat: AudioFormat;
  /** Set for playlist/channel batches. */
  groupId?: string;
  groupTitle?: string;
}

// ---- playlists (Rust: ytdlp::PlaylistInfo)
export interface PlaylistEntry {
  id: string;
  url: string;
  title: string;
  duration: number | null;
  thumbnail: string | null;
  unavailable: boolean;
}
export interface PlaylistInfo {
  id: string;
  url: string;
  title: string;
  channel: string | null;
  total: number | null;
  entries: PlaylistEntry[];
  truncated: boolean;
}

export interface Job {
  id: string;
  kind: JobKind;
  url: string;
  title: string;
  thumbnail: string | null;
  status: JobStatus;
  progress: number;
  error: string | null;
  filePath: string | null;
  fileSize: number | null;
  createdAt: string;
  finishedAt: string | null;
  request: DownloadRequest;
}

export interface JobProgress {
  id: string;
  stage: "downloading" | "processing";
  part: number;
  fraction: number;
  downloaded: number | null;
  total: number | null;
  speed: number | null;
  eta: number | null;
  step: string | null;
}

export interface AppError {
  kind: "db" | "io" | "network" | "invalid" | "unavailable";
  message: string;
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw { kind: "unavailable", message: "This needs the Grab desktop app (not a browser tab)." } satisfies AppError;
  }
  return invoke<T>(cmd, args);
}

export const api = {
  getSettings: () => call<Settings>("get_settings"),
  updateSettings: (patch: Partial<Settings>) => call<Settings>("update_settings", { patch }),
  appInfo: () => call<AppInfo>("app_info"),
  toolStatus: () => call<ToolStatus[]>("tool_status"),
  toolsMissing: () => call<ToolPackage[]>("tools_missing"),
  installTools: () => call<void>("install_tools"),
  onToolProgress: (fn: (p: ToolProgress) => void) => on<ToolProgress>("tools-progress", fn),

  fetchInfo: (url: string) => call<MediaInfo>("fetch_info", { url }),
  enqueueDownload: (request: DownloadRequest) => call<Job>("enqueue_download", { request }),
  enqueueMany: (requests: DownloadRequest[]) => call<number>("enqueue_many", { requests }),
  fetchPlaylist: (url: string) => call<PlaylistInfo>("fetch_playlist", { url }),
  listJobs: () => call<Job[]>("list_jobs"),
  pauseJob: (id: string) => call<void>("pause_job", { id }),
  resumeJob: (id: string) => call<void>("resume_job", { id }),
  cancelJob: (id: string) => call<void>("cancel_job", { id }),
  removeJob: (id: string) => call<void>("remove_job", { id }),
  clearFinishedJobs: () => call<number>("clear_finished_jobs"),
  openJobFile: (id: string) => call<void>("open_job_file", { id }),
  revealJobFile: (id: string) => call<void>("reveal_job_file", { id }),
  onJobUpdated: (fn: (j: Job) => void) => on<Job>("job-updated", fn),
  onJobProgress: (fn: (p: JobProgress) => void) => on<JobProgress>("job-progress", fn),
  onJobRemoved: (fn: (id: string) => void) => on<string>("job-removed", fn),
  onJobsCleared: (fn: () => void) => on<null>("jobs-cleared", () => fn()),
  updateYtdlp: () => call<UpdateResult>("update_ytdlp"),
  onYtdlpUpdated: (fn: (r: UpdateResult) => void) => on<UpdateResult>("ytdlp-updated", fn),
};

export interface UpdateResult {
  before: string;
  after: string;
  updated: boolean;
}

function on<T>(event: string, fn: (payload: T) => void): Promise<UnlistenFn> {
  return isTauri() ? listen<T>(event, (e) => fn(e.payload)) : Promise.resolve(() => {});
}
