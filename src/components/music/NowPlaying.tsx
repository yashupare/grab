import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronDown, GripVertical, X } from "lucide-react";
import { albumKey, artistKey } from "../../lib/library";
import { formatDuration } from "../../lib/format";
import { usePlayer } from "../../stores/player";
import { Cover } from "./Cover";
import { LikeButton } from "./TrackTable";
import { SeekBar, Transport, useCurrentTrack, VolumeControl } from "./PlayerControls";
import { IconButton } from "../ui/IconButton";
import { cn } from "../../lib/cn";

/** Full-window player over the app (below the title bar). Esc or ↓ closes; music keeps playing. */
export function NowPlaying() {
  const open = usePlayer((s) => s.nowPlayingOpen);
  const t = useCurrentTrack();
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") usePlayer.getState().setNowPlaying(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <AnimatePresence>
      {open && t && (
        <motion.div
          role="dialog"
          aria-label="Now Playing"
          className="fixed inset-x-0 top-11 bottom-0 z-30 flex overflow-hidden bg-bg"
          initial={reduce ? { opacity: 0 } : { y: "100%" }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: "100%" }}
          transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {t.cover && (
            <img
              src={t.cover.startsWith("http") ? t.cover : convertFileSrc(t.cover)}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-30 blur-3xl saturate-150"
            />
          )}
          <div className="relative flex min-w-0 flex-1 flex-col px-10 pt-6 pb-8">
            <div className="flex justify-between">
              <IconButton label="Close (Esc)" onClick={() => usePlayer.getState().setNowPlaying(false)}>
                <ChevronDown />
              </IconButton>
              <PlayingFrom />
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7">
              <Cover src={t.cover} className="aspect-square w-[min(480px,46vh)] rounded-xl shadow-(--shadow-float)" />
              <div className="flex w-full max-w-[560px] items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[26px] leading-tight font-bold tracking-[-0.02em]" title={t.title}>
                    {t.title}
                  </h2>
                  <p className="mt-1 truncate text-[15px] text-muted">
                    {t.artists.map((a, i) => (
                      <span key={a}>
                        {i > 0 && ", "}
                        <Link
                          to="/music/artist/$key"
                          params={{ key: artistKey(a) }}
                          onClick={() => usePlayer.getState().setNowPlaying(false)}
                          className="hover:text-fg hover:underline"
                        >
                          {a}
                        </Link>
                      </span>
                    ))}
                    {t.album && albumKey(t) && (
                      <>
                        {" · "}
                        <Link
                          to="/music/album/$key"
                          params={{ key: albumKey(t)! }}
                          onClick={() => usePlayer.getState().setNowPlaying(false)}
                          className="hover:text-fg hover:underline"
                        >
                          {t.album}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <LikeButton track={t} size="md" />
              </div>
              <div className="flex w-full max-w-[560px] flex-col items-center gap-3">
                <SeekBar className="w-full" />
                <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center">
                  <span />
                  <Transport big />
                  <VolumeControl className="justify-self-end" />
                </div>
              </div>
            </div>
          </div>
          <SidePanel />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PlayingFrom() {
  const context = usePlayer((s) => s.context);
  if (!context) return null;
  return (
    <span className="self-center text-[13px] text-muted">
      Playing from <span className="font-medium text-fg">{context.label}</span>
    </span>
  );
}

function SidePanel() {
  const tab = usePlayer((s) => s.nowPlayingTab);
  return (
    <aside className="relative flex w-[380px] shrink-0 flex-col border-l border-line bg-surface-1/70 backdrop-blur-xl">
      <div className="flex gap-6 border-b border-line px-5 pt-4" role="tablist">
        {(["next", "lyrics"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => usePlayer.getState().setNowPlaying(true, k)}
            className={cn(
              "-mb-px border-b-2 pb-2.5 font-medium transition-colors",
              tab === k ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {k === "next" ? "Up next" : "Lyrics"}
          </button>
        ))}
      </div>
      {tab === "next" ? (
        <UpNext />
      ) : (
        <p className="px-6 py-10 text-center text-muted">Lyrics are coming in a later version.</p>
      )}
    </aside>
  );
}

function UpNext() {
  const { queue, index } = usePlayer();
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const upcoming = queue.slice(index + 1);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {upcoming.length === 0 ? (
        <p className="px-4 py-10 text-center text-muted">Nothing after this song. Use ⋯ → Add to queue on any song.</p>
      ) : (
        <>
          <div className="flex items-center justify-between px-3 py-2 text-[12px] font-medium tracking-[0.04em] text-faint uppercase">
            <span>Next · {upcoming.length}</span>
            <button
              className="normal-case hover:text-fg"
              onClick={() => usePlayer.setState((s) => ({ queue: s.queue.slice(0, s.index + 1), original: null }))}
            >
              Clear
            </button>
          </div>
          <ul aria-label="Up next">
            {upcoming.map((t, k) => {
              const i = index + 1 + k;
              return (
                <li
                  key={`${t.id}-${i}`}
                  draggable
                  onDragStart={() => setFrom(i)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(i);
                  }}
                  onDragEnd={() => {
                    if (from != null && over != null) usePlayer.getState().move(from, over);
                    setFrom(null);
                    setOver(null);
                  }}
                  onDoubleClick={() => usePlayer.getState().jump(i)}
                  className={cn(
                    "group flex h-14 items-center gap-2 rounded-md px-2 hover:bg-surface-2",
                    over === i && from !== i && "ring-1 ring-accent",
                  )}
                >
                  <GripVertical
                    className="size-4 shrink-0 cursor-grab text-faint opacity-0 group-hover:opacity-100"
                    aria-hidden
                  />
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => usePlayer.getState().jump(i)}
                    aria-label={`Play ${t.title}`}
                  >
                    <Cover src={t.cover} className="size-10" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{t.title}</span>
                      <span className="block truncate text-[13px] text-muted">{t.artist}</span>
                    </span>
                  </button>
                  <span className="text-[12px] text-faint tabular group-hover:hidden">
                    {formatDuration(t.duration)}
                  </span>
                  <button
                    className="hidden size-7 place-items-center rounded text-muted group-hover:grid hover:text-fg"
                    onClick={() => usePlayer.getState().removeAt(i)}
                    aria-label={`Remove ${t.title} from the queue`}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
