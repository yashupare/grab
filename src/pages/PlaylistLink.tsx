import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, AudioLines, Clapperboard, ListVideo, RotateCw, Search } from "lucide-react";
import { api, type AudioFormat, type PlaylistInfo, type Settings } from "../lib/ipc";
import { formatDuration } from "../lib/format";
import { errorMessage, useSettings } from "../hooks/useSettings";
import { Segmented } from "../components/ui/Segmented";
import { Button } from "../components/ui/Button";
import { toast } from "../stores/toasts";
import { useUi } from "../stores/ui";
import { cn } from "../lib/cn";

const QUALITIES = [
  { value: "best", label: "Best" },
  { value: "2160", label: "4K" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
];

function totalTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function PlaylistLink({ url }: { url: string }) {
  const list = useQuery({ queryKey: ["playlist", url], queryFn: () => api.fetchPlaylist(url), staleTime: 10 * 60_000, retry: false });
  const settings = useSettings();

  if (list.isPending) {
    return (
      <div className="mx-auto max-w-[920px] animate-pulse" aria-busy aria-label="Loading playlist">
        <div className="h-7 w-2/3 rounded bg-surface-2" />
        <div className="mt-3 h-4 w-1/3 rounded bg-surface-2" />
        <div className="mt-8 flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-16 rounded-md bg-surface-2" />
          ))}
        </div>
      </div>
    );
  }
  if (list.isError) {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col items-center gap-3 rounded-lg border border-line bg-surface-1 px-6 py-12 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-surface-2 text-warning">
          <AlertTriangle className="size-5" aria-hidden />
        </div>
        <h2 className="font-semibold">Couldn't open this playlist</h2>
        <p className="selectable max-w-md text-muted">{errorMessage(list.error)}</p>
        <Button icon={<RotateCw />} onClick={() => list.refetch()} loading={list.isFetching}>
          Try again
        </Button>
      </div>
    );
  }
  if (!settings.data) return null;
  return <PlaylistView info={list.data} settings={settings.data} />;
}

function PlaylistView({ info, settings }: { info: PlaylistInfo; settings: Settings }) {
  const available = useMemo(() => info.entries.filter((e) => !e.unavailable), [info]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(available.map((e) => e.id)));
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<"video" | "audio">("video");
  const [quality, setQuality] = useState<string>(() =>
    QUALITIES.some((q) => q.value === settings.videoQuality) ? settings.videoQuality : "1080",
  );
  const [audio, setAudio] = useState<AudioFormat>(settings.audioFormat);
  const lastClicked = useRef<number | null>(null);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? info.entries.filter((e) => e.title.toLowerCase().includes(q)) : info.entries;
  }, [info, filter]);
  const visibleAvailable = visible.filter((e) => !e.unavailable);
  const allVisibleSelected = visibleAvailable.length > 0 && visibleAvailable.every((e) => selected.has(e.id));
  const duration = available.reduce((s, e) => s + (e.duration ?? 0), 0);
  const hidden = info.entries.length - available.length;

  function toggle(index: number, shift: boolean) {
    const entry = visible[index];
    if (!entry || entry.unavailable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const on = !prev.has(entry.id);
      // Shift-click selects or clears the whole range since the last click.
      const from = shift && lastClicked.current != null ? Math.min(lastClicked.current, index) : index;
      const to = shift && lastClicked.current != null ? Math.max(lastClicked.current, index) : index;
      for (let i = from; i <= to; i++) {
        const e = visible[i];
        if (e && !e.unavailable) {
          if (on) next.add(e.id);
          else next.delete(e.id);
        }
      }
      return next;
    });
    lastClicked.current = index;
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const e of visibleAvailable) {
        if (allVisibleSelected) next.delete(e.id);
        else next.add(e.id);
      }
      return next;
    });
  }

  const enqueue = useMutation({
    mutationFn: () => {
      const groupId = `${info.id || info.url}-${Date.now()}`;
      const picked = info.entries.filter((e) => selected.has(e.id) && !e.unavailable);
      return api.enqueueMany(
        picked.map((e) => ({
          url: e.url,
          title: e.title,
          thumbnail: e.thumbnail,
          kind,
          quality: kind === "video" ? quality : "best",
          audioFormat: audio,
          groupId,
          groupTitle: info.title,
          // Batches use the defaults from Settings (per-video subtitle lists aren't known here).
          options: { sponsorblock: settings.sponsorblock },
          duration: e.duration,
        })),
      );
    },
    onSuccess: (n) => {
      toast.success(`Added ${n} download${n === 1 ? "" : "s"}`, { label: "Show", run: () => useUi.getState().setActivityOpen(true) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-[920px]">
      <header className="flex items-start gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <ListVideo className="size-6" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="selectable line-clamp-2 text-[24px] leading-[30px] font-semibold tracking-[-0.02em]">{info.title}</h1>
          <p className="mt-1 text-muted">
            {[info.channel, `${available.length} video${available.length === 1 ? "" : "s"}`, duration ? totalTime(duration) : null]
              .filter(Boolean)
              .join(" · ")}
            {hidden > 0 && ` · ${hidden} unavailable`}
          </p>
          {info.truncated && (
            <p className="mt-1 text-[13px] text-warning">Showing the first {info.entries.length} videos{info.total ? ` of ${info.total}` : ""}.</p>
          )}
        </div>
      </header>

      <section className="mt-6 rounded-lg border border-line bg-surface-1">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Segmented<"video" | "audio">
            label="Download type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "video", label: "Video", icon: Clapperboard },
              { value: "audio", label: "Audio only", icon: AudioLines },
            ]}
          />
          {kind === "video" ? (
            <Segmented<string> label="Quality for all" value={quality} onChange={setQuality} options={QUALITIES} />
          ) : (
            <Segmented<AudioFormat>
              label="Audio format"
              value={audio}
              onChange={setAudio}
              options={[
                { value: "opus", label: "Opus" },
                { value: "m4a", label: "M4A" },
                { value: "mp3", label: "MP3" },
              ]}
            />
          )}
          <span className="text-[12.5px] text-faint">{kind === "video" ? "Best available up to this quality, per video" : "Same format for every video"}</span>
        </div>

        <div className="flex items-center gap-3 border-b border-line px-4 py-2">
          <input
            type="checkbox"
            className="size-4 accent-(--accent)"
            checked={allVisibleSelected}
            onChange={toggleAllVisible}
            aria-label={allVisibleSelected ? "Clear selection" : "Select all"}
          />
          <span className="text-[13px] text-muted tabular">
            {selected.size} of {available.length} selected
          </span>
          <label className="ml-auto flex h-8 w-64 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 focus-within:border-muted">
            <Search className="size-3.5 text-faint" aria-hidden />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by title"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
              aria-label="Filter by title"
            />
          </label>
        </div>

        <ul className="max-h-[56vh] overflow-y-auto p-1.5" aria-label="Videos">
          {visible.map((e, i) => {
            const on = selected.has(e.id);
            return (
              <li key={e.id} className="[contain-intrinsic-size:auto_64px] [content-visibility:auto]">
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 select-none",
                    e.unavailable ? "cursor-default opacity-45" : on ? "bg-accent-soft/60 hover:bg-accent-soft" : "hover:bg-surface-2",
                  )}
                  onClick={(ev) => {
                    ev.preventDefault();
                    toggle(i, ev.shiftKey);
                  }}
                >
                  <input type="checkbox" className="size-4 accent-(--accent)" checked={on} disabled={e.unavailable} readOnly tabIndex={-1} />
                  <span className="w-8 text-right text-[12px] text-faint tabular">{i + 1}</span>
                  <span className="relative h-[52px] w-[92px] shrink-0 overflow-hidden rounded bg-surface-3">
                    {e.thumbnail && <img src={e.thumbnail} alt="" loading="lazy" className="size-full object-cover" referrerPolicy="no-referrer" />}
                    {e.duration != null && (
                      <span className="absolute right-1 bottom-1 rounded bg-black/75 px-1 text-[10.5px] font-medium text-white tabular">
                        {formatDuration(e.duration)}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={e.title}>
                    {e.title}
                  </span>
                  {e.unavailable && <span className="text-[12px] text-muted">Unavailable</span>}
                </label>
              </li>
            );
          })}
          {visible.length === 0 && <li className="px-3 py-8 text-center text-muted">No videos match "{filter}".</li>}
        </ul>

        <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-4">
          <span className="text-[13px] text-muted">Tip: Shift-click to select a range.</span>
          <Button
            variant="primary"
            size="lg"
            icon={<ArrowDownToLine />}
            disabled={selected.size === 0}
            loading={enqueue.isPending}
            onClick={() => enqueue.mutate()}
          >
            Download {selected.size} {kind === "audio" ? "as audio" : "video"}
            {selected.size === 1 ? "" : "s"}
          </Button>
        </div>
      </section>
    </div>
  );
}
