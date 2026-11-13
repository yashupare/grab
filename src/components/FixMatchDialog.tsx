import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { useQuery } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AlertTriangle, Check, Link2, Loader2, Music2, Pause, Play, X } from "lucide-react";
import { api, type MatchCandidate, type MatchResult, type SpotifyTrack } from "../lib/ipc";
import { lengthDiff, toQuery } from "../lib/spotify";
import { formatDuration } from "../lib/format";
import { errorMessage } from "../hooks/useSettings";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { cn } from "../lib/cn";

/** Pick the right YouTube Music result for one Spotify song, or paste a link. */
export function FixMatchDialog({
  track,
  current,
  onClose,
  onPicked,
}: {
  track: SpotifyTrack | null;
  current: MatchCandidate | null;
  onClose: () => void;
  onPicked: (r: MatchResult) => void;
}) {
  return (
    <Dialog.Root open={track !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          tabIndex={-1}
          // Focus the dialog, not the close button (which would pop its tooltip).
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          className="outline-none fixed top-[10vh] left-1/2 z-50 flex max-h-[80vh] w-[min(640px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line bg-surface-1 shadow-(--shadow-float)"
        >
          {track && <Body key={track.id} track={track} current={current} onClose={onClose} onPicked={onPicked} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Body({
  track,
  current,
  onClose,
  onPicked,
}: {
  track: SpotifyTrack;
  current: MatchCandidate | null;
  onClose: () => void;
  onPicked: (r: MatchResult) => void;
}) {
  const results = useQuery({
    queryKey: ["candidates", track.id],
    queryFn: () => api.spotifyCandidates(toQuery(track)),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = usePreview();

  async function pick(p: { candidate: MatchCandidate } | { link: string }, key: string) {
    setSaving(key);
    setError(null);
    try {
      onPicked(await api.spotifySetMatch(toQuery(track), p));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <Dialog.Title className="text-[16px] font-semibold">Choose the right song</Dialog.Title>
          <Dialog.Description className="mt-0.5 truncate text-[13px] text-muted">
            {track.title} · {track.artists.join(", ")} · {formatDuration(track.durationMs / 1000)}
          </Dialog.Description>
        </div>
        <Dialog.Close asChild>
          <IconButton label="Close" size="sm">
            <X />
          </IconButton>
        </Dialog.Close>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-busy={results.isPending}>
        {results.isPending &&
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="m-1 h-16 animate-pulse rounded-md bg-surface-2" />
          ))}
        {results.isError && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-muted">
            <AlertTriangle className="size-5 text-warning" aria-hidden />
            <p>{errorMessage(results.error)}</p>
            <Button size="sm" onClick={() => results.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {results.data?.length === 0 && (
          <p className="px-4 py-8 text-center text-muted">No results on YouTube Music. Paste a link below.</p>
        )}
        <ul aria-label="YouTube Music results">
          {results.data?.map((c) => {
            const diff = lengthDiff(c.duration, track.durationMs);
            const isCurrent = current?.videoId === c.videoId;
            return (
              <li
                key={c.videoId}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2.5 py-2",
                  isCurrent ? "bg-accent-soft/60" : "hover:bg-surface-2",
                )}
              >
                <PreviewButton candidate={c} preview={preview} />
                <span className="size-12 shrink-0 overflow-hidden rounded bg-surface-3">
                  {c.thumbnail ? (
                    <img src={c.thumbnail} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <Music2 className="m-3.5 size-5 text-faint" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium" title={c.title}>
                      {c.title}
                    </span>
                    <span className="shrink-0 rounded bg-surface-3 px-1.5 text-[10.5px] leading-4 font-semibold text-muted uppercase">
                      {c.source === "song" ? "Song" : "Video"}
                    </span>
                  </span>
                  <span className="block truncate text-[13px] text-muted">
                    {[c.artists.join(", "), c.album, formatDuration(c.duration)].filter(Boolean).join(" · ")}
                    {diff && (
                      <span className={cn("ml-1.5", diff === "same length" ? "text-success" : "text-faint")}>
                        ({diff})
                      </span>
                    )}
                  </span>
                </span>
                {isCurrent ? (
                  <span className="flex items-center gap-1 px-2 text-[13px] font-medium text-accent">
                    <Check className="size-4" aria-hidden /> Current
                  </span>
                ) : (
                  <Button
                    size="sm"
                    loading={saving === c.videoId}
                    disabled={saving !== null}
                    onClick={() => pick({ candidate: c }, c.videoId)}
                  >
                    Use this
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <form
        className="flex items-center gap-2 border-t border-line px-5 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) pick({ link: link.trim() }, "link");
        }}
      >
        <label className="flex h-9 flex-1 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 focus-within:border-muted">
          <Link2 className="size-4 text-faint" aria-hidden />
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Or paste a YouTube link instead"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
            aria-label="YouTube link"
          />
        </label>
        <Button type="submit" size="md" disabled={!link.trim() || saving !== null} loading={saving === "link"}>
          Use link
        </Button>
      </form>
      {error && (
        <p role="alert" className="border-t border-line px-5 py-2.5 text-[13px] text-danger">
          {error}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- preview

type Preview = ReturnType<typeof usePreview>;

/** One 12-second clip at a time. Clips are fetched by yt-dlp, so the first play takes a few seconds. */
function usePreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const wanted = useRef<string | null>(null);

  useEffect(
    () => () => {
      wanted.current = null;
      audio.current?.pause();
    },
    [],
  );

  function stop() {
    wanted.current = null;
    audio.current?.pause();
    setPlaying(null);
    setLoading(null);
  }

  async function toggle(c: MatchCandidate) {
    if (playing === c.videoId || loading === c.videoId) return stop();
    stop();
    setFailed(({ [c.videoId]: _, ...rest }) => rest); // clicking again retries
    wanted.current = c.videoId;
    setLoading(c.videoId);
    try {
      const path = await api.previewClip(c.videoId, c.duration);
      if (wanted.current !== c.videoId) return; // another one was clicked meanwhile
      const el = audio.current ?? new Audio();
      audio.current = el;
      el.src = convertFileSrc(path);
      el.onended = () => setPlaying((p) => (p === c.videoId ? null : p));
      await el.play();
      setPlaying(c.videoId);
    } catch (e) {
      if (wanted.current === c.videoId) setFailed((f) => ({ ...f, [c.videoId]: errorMessage(e) }));
    } finally {
      setLoading((l) => (l === c.videoId ? null : l));
    }
  }

  return { playing, loading, failed, toggle };
}

function PreviewButton({ candidate, preview }: { candidate: MatchCandidate; preview: Preview }) {
  const id = candidate.videoId;
  const isPlaying = preview.playing === id;
  const isLoading = preview.loading === id;
  const failed = preview.failed[id];
  return (
    <IconButton
      label={
        failed
          ? `Preview didn't load: ${failed} Click to try again.`
          : isPlaying
            ? "Stop preview"
            : isLoading
              ? "Loading preview…"
              : "Play a 12-second preview"
      }
      size="sm"
      onClick={() => preview.toggle(candidate)}
      tooltipSide="right"
    >
      {isLoading ? (
        <Loader2 className="animate-spin" />
      ) : isPlaying ? (
        <Pause />
      ) : failed ? (
        <AlertTriangle className="text-warning" />
      ) : (
        <Play />
      )}
    </IconButton>
  );
}
