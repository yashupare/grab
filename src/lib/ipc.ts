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
  onToolProgress: (fn: (p: ToolProgress) => void): Promise<UnlistenFn> =>
    isTauri() ? listen<ToolProgress>("tools-progress", (e) => fn(e.payload)) : Promise.resolve(() => {}),
};
