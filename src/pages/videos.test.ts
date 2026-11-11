import { describe, expect, it, vi } from "vitest";

// The page modules import Tauri APIs; the helpers under test don't need them.
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn(), isTauri: () => false }));

const { resumeAt } = await import("./VideoPlayerPage");
const { watchedFraction } = await import("./VideosPage");

describe("resumeAt", () => {
  it("starts from the beginning when barely started or almost finished", () => {
    expect(resumeAt(null, 600)).toBe(0);
    expect(resumeAt(3, 600)).toBe(0);
    expect(resumeAt(595, 600)).toBe(0);
  });
  it("resumes in the middle", () => {
    expect(resumeAt(240, 600)).toBe(240);
  });
});

describe("watchedFraction", () => {
  it("is null when never played or length unknown", () => {
    expect(watchedFraction({ position: null, duration: 100 })).toBeNull();
    expect(watchedFraction({ position: 10, duration: null })).toBeNull();
  });
  it("is capped at 1", () => {
    expect(watchedFraction({ position: 50, duration: 100 })).toBe(0.5);
    expect(watchedFraction({ position: 120, duration: 100 })).toBe(1);
  });
});
