/** Display formatting. Pure functions, covered by format.test.ts. */

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : v >= 10 ? 1 : i >= 3 ? 2 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number | null | undefined): string {
  const b = formatBytes(bytesPerSec);
  return b ? `${b}/s` : "";
}

/** 75 → "1:15", 3725 → "1:02:05" */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Parse "90", "1:30", "1:02:05" or "1:30.5" into seconds. Returns null if it isn't a time. */
export function parseTime(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) return null;
  const parts = s.split(":").map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Time left, in words: "8s left", "3 min left", "1 h 5 min left". */
export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min left`;
  return `${Math.floor(m / 60)} h ${m % 60} min left`;
}

export function formatCount(n: number | null | undefined): string {
  if (n == null) return "";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** "20240131" → Date */
export function parseYmd(s: string | null | undefined): Date | null {
  if (!s || !/^\d{8}$/.test(s)) return null;
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

export function formatRelative(date: Date | string | null | undefined, now = new Date()): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (!Number.isFinite(diff)) return "";
  if (diff < 45) return "just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
    [Infinity, "year"],
  ];
  let prev = 1;
  for (const [limit, unit] of steps) {
    if (diff < limit) return rtf.format(-Math.round(diff / prev), unit);
    prev = limit;
  }
  return "";
}
