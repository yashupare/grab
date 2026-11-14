import { describe, expect, it } from "vitest";
import type { Probe } from "./ipc";
import { canFastJoin, encodeEstimate, folderOf, joinDifference, stem } from "./tools";

const clip = (p: Partial<Probe> & { w?: number; h?: number; codec?: string; audio?: Probe["audio"] }): Probe => ({
  path: "C:/v/a.mp4",
  name: "a.mp4",
  duration: 10,
  size: 1,
  video: { codec: p.codec ?? "h264", width: p.w ?? 1920, height: p.h ?? 1080, fps: 30, pixFmt: "yuv420p" },
  audio: p.audio === undefined ? { codec: "aac", sampleRate: 48000, channels: 2 } : p.audio,
});

describe("tools helpers", () => {
  it("names and folders", () => {
    expect(stem("C:\\Videos\\My clip.final.mp4")).toBe("My clip.final");
    expect(stem("noext")).toBe("noext");
    expect(folderOf("C:\\Videos\\a.mp4")).toBe("C:\\Videos");
  });

  it("fast join only when clips match", () => {
    expect(canFastJoin([clip({}), clip({})], "first")).toBe(true);
    expect(canFastJoin([clip({}), clip({})], "p720")).toBe(false);
    expect(canFastJoin([clip({}), clip({ w: 1280, h: 720 })], "first")).toBe(false);
    expect(canFastJoin([clip({}), clip({ audio: null })], "first")).toBe(false);
    expect(joinDifference(clip({}), clip({ w: 1280, h: 720 }))).toBe("the clips are different sizes");
    expect(joinDifference(clip({}), clip({ audio: null }))).toBe("some clips have no sound");
    expect(joinDifference(clip({}), clip({}))).toBeNull();
  });

  it("estimates time", () => {
    expect(encodeEstimate(60, true)).toBe("under a minute");
    expect(encodeEstimate(600, false)).toBe("about 7 min");
  });
});
