import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatEta, formatRelative, formatSpeed, parseYmd } from "./format";

describe("format", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("");
    expect(formatBytes(null)).toBe("");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1_500_000)).toBe("1.5 MB");
    expect(formatBytes(41_157_375)).toBe("41.2 MB");
    expect(formatBytes(410_000_000)).toBe("410 MB");
    expect(formatBytes(1_850_000_000)).toBe("1.85 GB");
  });

  it("formats speed", () => {
    expect(formatSpeed(8_200_000)).toBe("8.2 MB/s");
    expect(formatSpeed(null)).toBe("");
  });

  it("formats durations", () => {
    expect(formatDuration(19)).toBe("0:19");
    expect(formatDuration(75)).toBe("1:15");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(null)).toBe("");
  });

  it("formats time left", () => {
    expect(formatEta(8)).toBe("8s left");
    expect(formatEta(180)).toBe("3 min left");
    expect(formatEta(3900)).toBe("1 h 5 min left");
  });

  it("parses yt-dlp dates", () => {
    expect(parseYmd("20050424")?.getFullYear()).toBe(2005);
    expect(parseYmd("bad")).toBeNull();
  });

  it("formats relative time", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    expect(formatRelative("2026-11-12T11:59:50Z", now)).toBe("just now");
    expect(formatRelative("2026-11-12T11:55:00Z", now)).toBe("5 minutes ago");
    expect(formatRelative("2026-11-11T12:00:00Z", now)).toBe("yesterday");
  });
});
