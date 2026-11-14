/** Pure helpers for the Tools pages. The Rust side (media.rs) decides the real ffmpeg commands;
 *  these only explain choices to the user before they export. */
import type { ConvertTo, MergeSize, Probe } from "./ipc";

export const VIDEO_EXTS = ["mp4", "mkv", "webm", "mov", "avi", "m4v", "wmv", "flv", "ts", "3gp"];
export const AUDIO_EXTS = ["mp3", "m4a", "aac", "opus", "ogg", "flac", "wav", "wma"];

/** "C:\\a\\My clip.mp4" → "My clip" */
export function stem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

/** Same rules as media::can_fast_join. */
export function canFastJoin(clips: Probe[], size: MergeSize): boolean {
  const first = clips[0];
  if (!first) return false;
  const sameVideo = clips.every((c) => {
    const a = c.video;
    const b = first.video;
    if (!a || !b) return !a && !b;
    return (
      a.codec === b.codec &&
      a.width === b.width &&
      a.height === b.height &&
      a.pixFmt === b.pixFmt &&
      Math.abs(a.fps - b.fps) < 0.01
    );
  });
  const sameAudio = clips.every((c) => {
    const a = c.audio;
    const b = first.audio;
    if (!a || !b) return !a && !b;
    return a.codec === b.codec && a.sampleRate === b.sampleRate && a.channels === b.channels;
  });
  const sizeOk = size === "first" || !first.video || first.video.height === (size === "p1080" ? 1080 : 720);
  return sameVideo && sameAudio && sizeOk;
}

/** Rough re-encode time: hardware ≈ 4× real time, software ≈ 1.5× at 1080p. */
export function encodeEstimate(seconds: number, hardware: boolean): string {
  const t = seconds / (hardware ? 4 : 1.5);
  if (t < 45) return "under a minute";
  const m = Math.round(t / 60);
  return m <= 1 ? "about a minute" : `about ${m} min`;
}

/** Why two clips can't be joined fast, in a few words. */
export function joinDifference(a: Probe, b: Probe): string | null {
  if (!!a.video !== !!b.video) return "some clips have no video";
  if (a.video && b.video) {
    if (a.video.width !== b.video.width || a.video.height !== b.video.height) return "the clips are different sizes";
    if (a.video.codec !== b.video.codec) return "the clips use different video formats";
    if (Math.abs(a.video.fps - b.video.fps) >= 0.01) return "the clips have different frame rates";
  }
  if (!!a.audio !== !!b.audio) return "some clips have no sound";
  if (a.audio && b.audio && (a.audio.codec !== b.audio.codec || a.audio.sampleRate !== b.audio.sampleRate))
    return "the sound formats differ";
  return null;
}

export const COMPRESS_PRESETS = [
  { id: "whatsapp", label: "WhatsApp", mb: 16, note: "16 MB" },
  { id: "whatsapp-hd", label: "WhatsApp HD", mb: 64, note: "64 MB" },
  { id: "discord", label: "Discord", mb: 10, note: "10 MB" },
  { id: "email", label: "Email", mb: 25, note: "25 MB" },
] as const;

export const CONVERT_TARGETS: { id: ConvertTo; label: string; detail: string; video: boolean }[] = [
  { id: "mp4", label: "MP4", detail: "Plays everywhere. Instant when the video is already H.264.", video: true },
  { id: "mkv", label: "MKV", detail: "Keeps every track and subtitle. Always instant.", video: true },
  { id: "webm", label: "WebM", detail: "For the web. Re-encodes unless it's already VP9.", video: true },
  { id: "gif", label: "GIF", detail: "Silent animation, 12 fps, up to 480 px wide.", video: true },
  { id: "mp3", label: "MP3", detail: "Audio for any device (192 kbps).", video: false },
  { id: "m4a", label: "M4A", detail: "AAC audio for phones and iTunes.", video: false },
  { id: "opus", label: "Opus", detail: "Small files, great quality.", video: false },
  { id: "audio", label: "Original audio", detail: "The sound track exactly as it is, no quality loss.", video: false },
];

/** Where an export lands by default: audio goes to the music library. */
export const isAudioTarget = (to: ConvertTo) => !CONVERT_TARGETS.find((t) => t.id === to)?.video;

export const QUALITY_LABELS = {
  great: "Great quality",
  good: "Good quality",
  ok: "OK quality",
  low: "Low quality",
} as const;
