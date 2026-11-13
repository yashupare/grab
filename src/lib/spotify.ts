/** Pure helpers for the Spotify import page: what each song row shows. */
import type { ImportState, Job, MatchCandidate, MatchQuery, MatchResult, SpotifyTrack } from "./ipc";

export const toQuery = (t: SpotifyTrack): MatchQuery => ({
  id: t.id,
  title: t.title,
  artists: t.artists,
  durationMs: t.durationMs,
});

/** Matching progress for one song (UI side). */
export type MatchState =
  | { status: "waiting" }
  | { status: "matching" }
  | { status: "done"; result: MatchResult }
  | { status: "error"; message: string };

export type RowState =
  | { kind: "downloaded" }
  | { kind: "downloading"; progress: number | null }
  | { kind: "queued" }
  | { kind: "waiting" }
  | { kind: "matching" }
  | { kind: "matched"; candidate: MatchCandidate; manual: boolean }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

/**
 * Download state wins over match state: a song imported before shows its download, even when
 * the job was cleared from Activity (then the server's record decides).
 */
export function rowState(
  track: SpotifyTrack,
  imports: ImportState | undefined,
  jobs: Record<string, Job>,
  live: Record<string, { fraction: number } | undefined>,
  match: MatchState | undefined,
): RowState {
  const imported = imports?.tracks[track.id];
  if (imported) {
    const job = jobs[imported.jobId];
    if (job) {
      if (job.status === "done") return { kind: "downloaded" };
      if (job.status === "running") return { kind: "downloading", progress: live[job.id]?.fraction ?? null };
      if (job.status === "queued" || job.status === "paused") return { kind: "queued" };
      // failed or cancelled: offer it again (falls through to the match state)
    } else if (imported.state === "downloaded") return { kind: "downloaded" };
    else if (imported.state === "queued") return { kind: "queued" };
  }
  if (!match || match.status === "waiting") return { kind: "waiting" };
  if (match.status === "matching") return { kind: "matching" };
  if (match.status === "error") return { kind: "error", message: match.message };
  const { result } = match;
  return result.status === "matched" && result.candidate
    ? { kind: "matched", candidate: result.candidate, manual: result.manual }
    : { kind: "notFound" };
}

/** Already in the library or on its way: not selected and not matched again. */
export const isInLibrary = (s: RowState) => s.kind === "downloaded" || s.kind === "downloading" || s.kind === "queued";

/** "+2 s" / "−14 s" difference between the match and Spotify's length. */
export function lengthDiff(candidateSeconds: number | null, spotifyMs: number): string | null {
  if (candidateSeconds == null || !spotifyMs) return null;
  const d = Math.round(candidateSeconds - spotifyMs / 1000);
  if (Math.abs(d) <= 1) return "same length";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} s`;
}

/** Spotify album/playlist page colour → a translucent wash for the hero. */
export function tintWash(tint: string | null): string | undefined {
  if (!tint || !/^#[0-9a-f]{6}$/i.test(tint)) return undefined;
  return `linear-gradient(180deg, ${tint}59 0%, ${tint}1f 55%, transparent 100%)`;
}
