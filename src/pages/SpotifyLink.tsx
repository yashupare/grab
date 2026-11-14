import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  Disc3,
  Info,
  ListMusic,
  Loader2,
  Music2,
  RefreshCw,
  RotateCw,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react";
import {
  api,
  type AudioFormat,
  type MatchResult,
  type Settings,
  type SpotifyCollection,
  type SpotifyTrack,
} from "../lib/ipc";
import { isInLibrary, rowState, toQuery, tintWash, type MatchState, type RowState } from "../lib/spotify";
import { formatDuration, formatRelative } from "../lib/format";
import { errorMessage, useSettings } from "../hooks/useSettings";
import { useJobs } from "../stores/jobs";
import { toast } from "../stores/toasts";
import { useUi } from "../stores/ui";
import { FixMatchDialog } from "../components/FixMatchDialog";
import { Segmented } from "../components/ui/Segmented";
import { Switch } from "../components/ui/Switch";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/cn";

const KIND_LABEL = { track: "Song", album: "Album", playlist: "Playlist" } as const;

export function SpotifyLink({ url }: { url: string }) {
  const coll = useQuery({
    queryKey: ["spotify", url],
    queryFn: () => api.spotifyFetch(url),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const settings = useSettings();

  if (coll.isPending) {
    return (
      <div className="mx-auto max-w-[920px] animate-pulse" aria-busy aria-label="Loading from Spotify">
        <div className="flex items-end gap-5">
          <div className="size-36 rounded-lg bg-surface-2" />
          <div className="flex-1 pb-2">
            <div className="h-7 w-2/3 rounded bg-surface-2" />
            <div className="mt-3 h-4 w-1/3 rounded bg-surface-2" />
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-12 rounded-md bg-surface-2" />
          ))}
        </div>
      </div>
    );
  }
  if (coll.isError) {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col items-center gap-3 rounded-lg border border-line bg-surface-1 px-6 py-12 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-surface-2 text-warning">
          <AlertTriangle className="size-5" aria-hidden />
        </div>
        <h2 className="font-semibold">Couldn't open this Spotify link</h2>
        <p className="selectable max-w-md text-muted">{errorMessage(coll.error)}</p>
        <Button icon={<RotateCw />} onClick={() => coll.refetch()} loading={coll.isFetching}>
          Try again
        </Button>
      </div>
    );
  }
  if (!settings.data) return null;
  return <SpotifyView key={coll.data.uri} coll={coll.data} settings={settings.data} />;
}

// ---------------------------------------------------------------- matching

const MATCH_CONCURRENCY = 3;

/** Matches songs three at a time in the background. Results stay when the list re-renders. */
function useMatching() {
  const [results, setResults] = useState<Record<string, MatchState>>({});
  const queued = useRef(new Set<string>());
  const pending = useRef<SpotifyTrack[]>([]);
  const active = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const pump = useCallback(() => {
    const step = () => {
      while (alive.current && active.current < MATCH_CONCURRENCY && pending.current.length > 0) {
        const t = pending.current.shift()!;
        active.current++;
        setResults((r) => ({ ...r, [t.id]: { status: "matching" } }));
        api
          .spotifyMatch(toQuery(t))
          .then((result) => alive.current && setResults((r) => ({ ...r, [t.id]: { status: "done", result } })))
          .catch(
            (e) =>
              alive.current && setResults((r) => ({ ...r, [t.id]: { status: "error", message: errorMessage(e) } })),
          )
          .finally(() => {
            active.current--;
            step();
          });
      }
    };
    step();
  }, []);

  const enqueue = useCallback(
    (tracks: SpotifyTrack[]) => {
      for (const t of tracks) {
        if (queued.current.has(t.id)) continue;
        queued.current.add(t.id);
        pending.current.push(t);
      }
      pump();
    },
    [pump],
  );

  const retry = useCallback(
    (t: SpotifyTrack) => {
      queued.current.delete(t.id);
      enqueue([t]);
    },
    [enqueue],
  );

  const set = useCallback((r: MatchResult) => {
    setResults((prev) => ({ ...prev, [r.spotifyId]: { status: "done", result: r } }));
  }, []);

  return { results, enqueue, retry, set };
}

// ---------------------------------------------------------------- page

function SpotifyView({ coll, settings }: { coll: SpotifyCollection; settings: Settings }) {
  const queryClient = useQueryClient();
  const imports = useQuery({
    queryKey: ["spotify-import", coll.uri],
    queryFn: () => api.spotifyImportState(coll.uri),
    retry: false,
  });
  const importJobIds = useMemo(() => Object.values(imports.data?.tracks ?? {}).map((t) => t.jobId), [imports.data]);
  const jobs = useJobs(
    useShallow((s) => Object.fromEntries(importJobIds.flatMap((id) => (s.jobs[id] ? [[id, s.jobs[id]]] : [])))),
  );
  const live = useJobs(
    useShallow((s) => Object.fromEntries(importJobIds.flatMap((id) => (s.live[id] ? [[id, s.live[id]]] : [])))),
  );
  const matching = useMatching();
  const { enqueue } = matching;

  const rows = useMemo(
    () => coll.tracks.map((t) => ({ track: t, state: rowState(t, imports.data, jobs, live, matching.results[t.id]) })),
    [coll.tracks, imports.data, jobs, live, matching.results],
  );

  // Match everything that isn't in the library yet, once we know what is.
  const ready = imports.isSuccess || imports.isError;
  useEffect(() => {
    if (!ready) return;
    const known = imports.data;
    enqueue(
      coll.tracks.filter((t) => {
        const s = known?.tracks[t.id]?.state;
        return s !== "downloaded" && s !== "queued";
      }),
    );
  }, [ready, imports.data, coll.tracks, enqueue]);

  // Songs that later failed or were cancelled need a match too.
  useEffect(() => {
    const need = rows.filter((r) => r.state.kind === "waiting" && !matching.results[r.track.id]).map((r) => r.track);
    if (ready && need.length) enqueue(need);
  }, [rows, ready, matching.results, enqueue]);

  const inLibrary = rows.filter((r) => isInLibrary(r.state)).length;
  const firstImport = !imports.data?.lastImport;
  const newSongs = rows.length - inLibrary;

  const [selected, setSelected] = useState<Set<string> | null>(null);
  // Until the user changes it, the selection is "everything not in the library yet".
  const effectiveSelected = useMemo(
    () => selected ?? new Set(rows.filter((r) => !isInLibrary(r.state)).map((r) => r.track.id)),
    [selected, rows],
  );
  const [filter, setFilter] = useState("");
  const [format, setFormat] = useState<AudioFormat>(settings.audioFormat);
  const [addToPlaylist, setAddToPlaylist] = useState(true);
  const [fixing, setFixing] = useState<SpotifyTrack | null>(null);
  const lastClicked = useRef<number | null>(null);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.track.title.toLowerCase().includes(q) || r.track.artists.some((a) => a.toLowerCase().includes(q)),
    );
  }, [rows, filter]);

  const selectable = (s: RowState) => !isInLibrary(s);
  const picked = rows.filter((r) => effectiveSelected.has(r.track.id) && selectable(r.state));
  const pickedMatched = picked.filter((r) => r.state.kind === "matched");
  const pickedPending = picked.filter((r) => r.state.kind === "waiting" || r.state.kind === "matching").length;
  const pickedMissing = picked.filter((r) => r.state.kind === "notFound" || r.state.kind === "error").length;
  const matchedCount = rows.filter((r) => r.state.kind === "matched").length;
  const matchingNow = rows.some((r) => r.state.kind === "waiting" || r.state.kind === "matching");
  const visibleSelectable = visible.filter((r) => selectable(r.state));
  const allVisibleSelected =
    visibleSelectable.length > 0 && visibleSelectable.every((r) => effectiveSelected.has(r.track.id));

  function toggle(index: number, shift: boolean) {
    const row = visible[index];
    if (!row || !selectable(row.state)) return;
    const next = new Set(effectiveSelected);
    const on = !next.has(row.track.id);
    const anchor = shift && lastClicked.current != null ? lastClicked.current : index;
    for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++) {
      const r = visible[i];
      if (r && selectable(r.state)) {
        if (on) next.add(r.track.id);
        else next.delete(r.track.id);
      }
    }
    setSelected(next);
    lastClicked.current = index;
  }

  function toggleAll() {
    const next = new Set(effectiveSelected);
    for (const r of visibleSelectable) {
      if (allVisibleSelected) next.delete(r.track.id);
      else next.add(r.track.id);
    }
    setSelected(next);
  }

  const importMut = useMutation({
    mutationFn: () =>
      api.spotifyImport({
        collection: { uri: coll.uri, kind: coll.kind, name: coll.name, owner: coll.owner, cover: coll.cover },
        tracks: pickedMatched.map(({ track: t, state }) => {
          const c = state.kind === "matched" ? state.candidate : null;
          return {
            spotifyId: t.id,
            title: t.title,
            artists: t.artists,
            position: t.position,
            durationMs: t.durationMs,
            videoId: c?.videoId ?? "",
            album: c?.album ?? null,
            thumbnail: c?.thumbnail ?? null,
          };
        }),
        order: coll.tracks.map((t) => t.id),
        audioFormat: format,
        addToPlaylist: addToPlaylist && coll.kind !== "track",
      }),
    onSuccess: async (n) => {
      await queryClient.invalidateQueries({ queryKey: ["spotify-import", coll.uri] });
      setSelected(null);
      const skipped =
        pickedMissing > 0 ? ` ${pickedMissing} without a match ${pickedMissing === 1 ? "was" : "were"} skipped.` : "";
      toast.success(`Importing ${n} song${n === 1 ? "" : "s"}.${skipped}`, {
        label: "Show",
        run: () => useUi.getState().setActivityOpen(true),
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const totalSeconds = coll.tracks.reduce((s, t) => s + t.durationMs / 1000, 0);
  const KindIcon = coll.kind === "album" ? Disc3 : coll.kind === "playlist" ? ListMusic : Music2;
  const fixingState = fixing ? rows.find((r) => r.track.id === fixing.id)?.state : undefined;

  return (
    <div className="mx-auto max-w-[920px]">
      {/* Hero, tinted with Spotify's cover colour */}
      <header className="rounded-xl p-5" style={{ backgroundImage: tintWash(coll.tint) }}>
        <div className="flex items-end gap-5">
          <div className="size-36 shrink-0 overflow-hidden rounded-lg bg-surface-2 shadow-(--shadow-float)">
            {coll.cover ? (
              <img src={coll.cover} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <KindIcon className="m-12 size-12 text-faint" aria-hidden />
            )}
          </div>
          <div className="min-w-0 pb-1">
            <span className="text-[12px] font-medium tracking-[0.06em] text-muted uppercase">
              Spotify {KIND_LABEL[coll.kind]}
            </span>
            <h1 className="selectable mt-1 line-clamp-2 text-[28px] leading-[34px] font-bold tracking-[-0.02em]">
              {coll.name}
            </h1>
            <p className="mt-1.5 text-muted">
              {[
                coll.owner,
                coll.kind !== "track" ? `${coll.tracks.length}${coll.limited ? "+" : ""} songs` : null,
                totalSeconds ? formatTotal(totalSeconds) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      </header>

      {/* What's going on: re-sync summary, limits, quality */}
      <div className="mt-5 flex flex-col gap-2">
        {!firstImport && imports.data && (
          <Banner icon={newSongs > 0 ? Sparkles : CheckCircle2} tone={newSongs > 0 ? "accent" : "success"}>
            {newSongs > 0
              ? `${newSongs} new song${newSongs === 1 ? "" : "s"} since your last import ${formatRelative(imports.data.lastImport)}. Only ${newSongs === 1 ? "it is" : "those are"} selected.`
              : `Everything here is already in your library (last import ${formatRelative(imports.data.lastImport)}).`}
          </Banner>
        )}
        {coll.limited && (
          <Banner icon={AlertTriangle} tone="warning">
            Spotify only shares the first 100 songs without signing in, so the rest of this playlist isn't listed.
            Signing in to Spotify is coming to Settings.
          </Banner>
        )}
        <Banner icon={Info}>
          Songs come from YouTube Music (about 130 kbps Opus, or AAC for M4A). Spotify's own audio is copy-protected and
          can't be saved.
        </Banner>
      </div>

      <section className="mt-5 rounded-lg border border-line bg-surface-1">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line px-4 py-3">
          <Segmented<AudioFormat>
            label="Audio format"
            value={format}
            onChange={setFormat}
            options={[
              { value: "opus", label: "Best (Opus)" },
              { value: "m4a", label: "M4A" },
              { value: "mp3", label: "MP3" },
            ]}
          />
          {coll.kind !== "track" && (
            <label className="flex items-center gap-2.5 text-[13px]">
              <Switch checked={addToPlaylist} onChange={setAddToPlaylist} label="Add to a playlist in Music" />
              Add to a playlist in Music
            </label>
          )}
          <span className="ml-auto text-[13px] text-muted tabular" aria-live="polite">
            {matchingNow ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Finding songs… {matchedCount +
                  rows.filter((r) => r.state.kind === "notFound").length +
                  inLibrary} of {rows.length}
              </span>
            ) : (
              `${matchedCount} found${inLibrary ? ` · ${inLibrary} in library` : ""}`
            )}
          </span>
        </div>

        {coll.kind !== "track" && (
          <div className="flex items-center gap-3 border-b border-line px-4 py-2">
            <input
              type="checkbox"
              className="size-4 accent-(--accent)"
              checked={allVisibleSelected}
              onChange={toggleAll}
              disabled={visibleSelectable.length === 0}
              aria-label={allVisibleSelected ? "Clear selection" : "Select all"}
            />
            <span className="text-[13px] text-muted tabular">
              {picked.length} of {rows.length - inLibrary} selected
            </span>
            <label className="ml-auto flex h-8 w-64 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 focus-within:border-muted">
              <Search className="size-3.5 text-faint" aria-hidden />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by song or artist"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
                aria-label="Filter by song or artist"
              />
            </label>
          </div>
        )}

        <ul className="max-h-[56vh] overflow-y-auto p-1.5" aria-label="Songs">
          {visible.map(({ track: t, state }, i) => {
            const canPick = selectable(state);
            const on = canPick && effectiveSelected.has(t.id);
            return (
              <li key={t.id} className="group [contain-intrinsic-size:auto_52px] [content-visibility:auto]">
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-md px-2.5 py-1.5 select-none",
                    canPick ? "cursor-pointer" : "cursor-default",
                    on ? "bg-accent-soft/50 hover:bg-accent-soft" : "hover:bg-surface-2",
                  )}
                  onClick={(ev) => {
                    if ((ev.target as HTMLElement).closest("button")) return;
                    toggle(i, ev.shiftKey);
                  }}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-(--accent)"
                    checked={on}
                    disabled={!canPick}
                    readOnly
                    tabIndex={-1}
                    aria-label={`Select ${t.title}`}
                  />
                  <span className="w-7 text-right text-[12px] text-faint tabular">{t.position}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium" title={t.title}>
                        {t.title}
                      </span>
                      {t.explicit && (
                        <span
                          className="grid size-4 shrink-0 place-items-center rounded-sm bg-surface-3 text-[9.5px] font-bold text-muted"
                          title="Explicit"
                        >
                          E
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[13px] text-muted">{t.artists.join(", ")}</span>
                  </span>
                  <span className="w-12 text-right text-[13px] text-muted tabular">
                    {formatDuration(t.durationMs / 1000)}
                  </span>
                  <StatusCell state={state} onFix={() => setFixing(t)} onRetry={() => matching.retry(t)} />
                </div>
              </li>
            );
          })}
          {visible.length === 0 && <li className="px-3 py-8 text-center text-muted">No songs match "{filter}".</li>}
        </ul>

        <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-4">
          <span className="text-[13px] text-muted">
            {pickedMissing > 0 ? (
              <span className="text-warning">
                {pickedMissing} selected song{pickedMissing === 1 ? " has" : "s have"} no match. Fix{" "}
                {pickedMissing === 1 ? "it" : "them"} or {pickedMissing === 1 ? "it'll" : "they'll"} be skipped.
              </span>
            ) : addToPlaylist && coll.kind !== "track" ? (
              <>
                Saves to Music › Grab and {imports.data?.inPlaylist ? "updates" : "creates"} the playlist{" "}
                <span className="text-fg">{coll.name}</span>.
              </>
            ) : (
              "Saves to Music › Grab with song details and cover art."
            )}
          </span>
          <Button
            variant="primary"
            size="lg"
            icon={pickedPending > 0 ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}
            disabled={pickedMatched.length === 0 || pickedPending > 0}
            loading={importMut.isPending}
            onClick={() => importMut.mutate()}
          >
            {pickedPending > 0
              ? `Finding ${pickedPending} song${pickedPending === 1 ? "" : "s"}…`
              : pickedMatched.length === 0 && inLibrary === rows.length
                ? "All imported"
                : `Import ${pickedMatched.length} song${pickedMatched.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </section>

      {inLibrary > 0 && (
        <p className="mt-3 text-center text-[13px] text-faint">
          Imported songs are in{" "}
          {imports.data?.inPlaylist ? (
            <Link
              to="/music/playlist/$id"
              params={{ id: coll.uri }}
              className="text-muted underline-offset-2 hover:underline"
            >
              the playlist {coll.name}
            </Link>
          ) : (
            <Link to="/music" className="text-muted underline-offset-2 hover:underline">
              Music
            </Link>
          )}
          .
        </p>
      )}

      <FixMatchDialog
        track={fixing}
        current={fixingState?.kind === "matched" ? fixingState.candidate : null}
        onClose={() => setFixing(null)}
        onPicked={(r) => {
          matching.set(r);
          toast.success("Match updated");
        }}
      />
    </div>
  );
}

function formatTotal(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

function Banner({
  icon: Icon,
  tone,
  children,
}: {
  icon: typeof Info;
  tone?: "warning" | "success" | "accent";
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-line bg-surface-1 px-3.5 py-2.5 text-[13px] text-muted">
      <Icon
        className={cn(
          "mt-px size-4 shrink-0",
          tone === "warning"
            ? "text-warning"
            : tone === "success"
              ? "text-success"
              : tone === "accent"
                ? "text-accent"
                : "text-faint",
        )}
        aria-hidden
      />
      <p>{children}</p>
    </div>
  );
}

function StatusCell({ state, onFix, onRetry }: { state: RowState; onFix: () => void; onRetry: () => void }) {
  const base = "flex w-52 shrink-0 items-center justify-end gap-2 text-[13px]";
  switch (state.kind) {
    case "downloaded":
      return (
        <span className={cn(base, "text-success")}>
          <CheckCircle2 className="size-4" aria-hidden /> Downloaded
        </span>
      );
    case "downloading":
      return (
        <span className={cn(base, "text-muted")}>
          <ArrowDownToLine className="size-4 text-accent" aria-hidden />
          Downloading{state.progress != null ? ` ${Math.floor(state.progress * 100)}%` : "…"}
        </span>
      );
    case "queued":
      return <span className={cn(base, "text-muted")}>In downloads</span>;
    case "waiting":
      return <span className={cn(base, "text-faint")}>Waiting…</span>;
    case "matching":
      return (
        <span className={cn(base, "text-muted")}>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Matching…
        </span>
      );
    case "matched": {
      const c = state.candidate;
      const detail = `YouTube Music: ${c.title} · ${c.artists.join(", ")}${c.album ? ` · ${c.album}` : ""} · ${formatDuration(c.duration)}`;
      return (
        <span className={base}>
          <span className="flex min-w-0 items-center gap-1.5 text-muted group-hover:hidden" title={detail}>
            <Check className="size-4 shrink-0 text-success" aria-hidden />
            <span className="truncate">{state.manual ? "Your pick" : "Matched"}</span>
          </span>
          <span className="hidden min-w-0 items-center gap-2 group-hover:flex">
            <span className="truncate text-[12px] text-faint" title={detail}>
              {c.title}
            </span>
            <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={onFix} aria-label="Change match">
              Change
            </Button>
          </span>
        </span>
      );
    }
    case "notFound":
      return (
        <span className={base}>
          <span className="text-warning">Couldn't find</span>
          <Button size="sm" icon={<Wrench />} onClick={onFix}>
            Fix
          </Button>
        </span>
      );
    case "error":
      return (
        <span className={base} title={state.message}>
          <span className="truncate text-danger">Search failed</span>
          <Button size="sm" variant="ghost" icon={<RotateCw />} onClick={onRetry}>
            Retry
          </Button>
        </span>
      );
  }
}
