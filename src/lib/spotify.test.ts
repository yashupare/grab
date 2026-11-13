import { describe, expect, it } from "vitest";
import type { ImportState, Job, MatchCandidate, SpotifyTrack } from "./ipc";
import { isInLibrary, lengthDiff, rowState, tintWash } from "./spotify";

const track: SpotifyTrack = {
  id: "t1",
  title: "Song",
  artists: ["A"],
  durationMs: 200_000,
  explicit: false,
  position: 1,
  playable: true,
};
const candidate: MatchCandidate = {
  videoId: "aaaaaaaaaaa",
  title: "Song",
  artists: ["A"],
  album: null,
  duration: 201,
  thumbnail: null,
  source: "song",
  score: 1,
};
const imported = (state: "downloaded" | "queued" | "missing"): ImportState => ({
  lastImport: "2026-11-01T00:00:00Z",
  tracks: { t1: { state, jobId: "j1" } },
  inPlaylist: true,
});
const job = (status: Job["status"]) => ({ j1: { id: "j1", status } as Job });
const matched = {
  status: "done" as const,
  result: { spotifyId: "t1", status: "matched" as const, candidate, manual: false },
};

describe("rowState", () => {
  it("shows match progress for new songs", () => {
    expect(rowState(track, undefined, {}, {}, undefined).kind).toBe("waiting");
    expect(rowState(track, undefined, {}, {}, { status: "matching" }).kind).toBe("matching");
    expect(rowState(track, undefined, {}, {}, matched)).toEqual({ kind: "matched", candidate, manual: false });
    const miss = {
      status: "done" as const,
      result: { spotifyId: "t1", status: "notFound" as const, candidate: null, manual: false },
    };
    expect(rowState(track, undefined, {}, {}, miss).kind).toBe("notFound");
  });

  it("prefers the live download state over the match", () => {
    expect(rowState(track, imported("queued"), job("running"), { j1: { fraction: 0.4 } }, matched)).toEqual({
      kind: "downloading",
      progress: 0.4,
    });
    expect(rowState(track, imported("queued"), job("done"), {}, matched).kind).toBe("downloaded");
    expect(rowState(track, imported("queued"), job("paused"), {}, matched).kind).toBe("queued");
  });

  it("offers failed downloads again", () => {
    expect(rowState(track, imported("missing"), job("failed"), {}, matched).kind).toBe("matched");
    expect(rowState(track, imported("missing"), {}, {}, undefined).kind).toBe("waiting");
  });

  it("trusts the server record when the job was cleared from Activity", () => {
    expect(rowState(track, imported("downloaded"), {}, {}, undefined).kind).toBe("downloaded");
    expect(isInLibrary(rowState(track, imported("downloaded"), {}, {}, undefined))).toBe(true);
    expect(isInLibrary(rowState(track, undefined, {}, {}, matched))).toBe(false);
  });
});

describe("helpers", () => {
  it("describes length differences", () => {
    expect(lengthDiff(201, 200_000)).toBe("same length");
    expect(lengthDiff(214, 200_000)).toBe("+14 s");
    expect(lengthDiff(190, 200_000)).toBe("−10 s");
    expect(lengthDiff(null, 200_000)).toBeNull();
  });

  it("only uses valid tint colours", () => {
    expect(tintWash("#530aff")).toContain("#530aff59");
    expect(tintWash("red; background: url(x)")).toBeUndefined();
    expect(tintWash(null)).toBeUndefined();
  });
});
