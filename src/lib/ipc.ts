/** Typed wrappers for the Rust commands in src-tauri/src/commands.rs. Keep the types in sync with
 *  the Rust structs (serde camelCase). Every call rejects with an `AppError`. */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Theme = "system" | "dark" | "light";
export type AudioFormat = "opus" | "m4a" | "mp3";
export type SponsorBlock = "off" | "remove" | "mark";
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
  sponsorblock: SponsorBlock;
  subtitleLangs: string[];
}

export interface DownloadOptions {
  subtitles: string[];
  subtitleMode: "embed" | "file";
  section: { start: number; end: number } | null;
  sponsorblock: SponsorBlock;
  splitChapters: boolean;
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
  options?: Partial<DownloadOptions>;
  /** Seconds, when known (shown in the Videos library). */
  duration?: number | null;
}

// ---- library (Rust: library.rs)
export interface VideoItem {
  jobId: string;
  title: string;
  thumbnail: string | null;
  path: string;
  size: number | null;
  duration: number | null;
  finishedAt: string | null;
  position: number | null;
  url: string;
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

// ---- Spotify import (Rust: spotify.rs, matcher.rs, importer.rs)
export type SpotifyKind = "track" | "album" | "playlist";
export interface SpotifyTrack {
  id: string;
  title: string;
  artists: string[];
  durationMs: number;
  explicit: boolean;
  /** Position in the album/playlist, from 1. */
  position: number;
  playable: boolean;
}
export interface SpotifyCollection {
  kind: SpotifyKind;
  id: string;
  uri: string;
  url: string;
  name: string;
  owner: string | null;
  cover: string | null;
  /** "#rrggbb" picked by Spotify from the cover. */
  tint: string | null;
  tracks: SpotifyTrack[];
  /** Spotify shared only the first 100 songs. */
  limited: boolean;
}
export interface MatchQuery {
  id: string;
  title: string;
  artists: string[];
  durationMs: number;
}
export interface MatchCandidate {
  videoId: string;
  title: string;
  artists: string[];
  album: string | null;
  duration: number | null;
  thumbnail: string | null;
  source: "song" | "video";
  score: number;
}
export interface MatchResult {
  spotifyId: string;
  status: "matched" | "notFound";
  candidate: MatchCandidate | null;
  manual: boolean;
}
export interface ImportState {
  lastImport: string | null;
  tracks: Record<string, { state: "downloaded" | "queued" | "missing"; jobId: string }>;
  inPlaylist: boolean;
}
export interface ImportRequest {
  collection: { uri: string; kind: SpotifyKind; name: string; owner: string | null; cover: string | null };
  tracks: {
    spotifyId: string;
    title: string;
    artists: string[];
    position: number;
    durationMs: number;
    videoId: string;
    album: string | null;
    thumbnail: string | null;
  }[];
  order: string[];
  audioFormat: AudioFormat;
  addToPlaylist: boolean;
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
  videoLibrary: () => call<VideoItem[]>("video_library"),
  saveWatchPosition: (jobId: string, position: number, duration: number | null) =>
    call<void>("save_watch_position", { jobId, position, duration }),
  onYtdlpUpdated: (fn: (r: UpdateResult) => void) => on<UpdateResult>("ytdlp-updated", fn),

  spotifyFetch: (url: string) => call<SpotifyCollection>("spotify_fetch", { url }),
  spotifyImportState: (uri: string) => call<ImportState>("spotify_import_state", { uri }),
  spotifyMatch: (track: MatchQuery) => call<MatchResult>("spotify_match", { track }),
  spotifyCandidates: (track: MatchQuery) => call<MatchCandidate[]>("spotify_candidates", { track }),
  spotifySetMatch: (track: MatchQuery, pick: { candidate: MatchCandidate } | { link: string }) =>
    call<MatchResult>("spotify_set_match", {
      track,
      candidate: "candidate" in pick ? pick.candidate : null,
      link: "link" in pick ? pick.link : null,
    }),
  spotifyImport: (request: ImportRequest) => call<number>("spotify_import", { request }),
  /** Local file path of a 12-second clip (play with convertFileSrc). */
  previewClip: (videoId: string, duration: number | null) => call<string>("preview_clip", { videoId, duration }),
};

export interface UpdateResult {
  before: string;
  after: string;
  updated: boolean;
}

function on<T>(event: string, fn: (payload: T) => void): Promise<UnlistenFn> {
  return isTauri() ? listen<T>(event, (e) => fn(e.payload)) : Promise.resolve(() => {});
}
