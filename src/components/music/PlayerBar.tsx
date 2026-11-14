import { Link } from "@tanstack/react-router";
import { ChevronUp, ListMusic } from "lucide-react";
import { albumKey, artistKey } from "../../lib/library";
import { usePlayer } from "../../stores/player";
import { Cover } from "./Cover";
import { LikeButton } from "./TrackTable";
import { SeekBar, Transport, useCurrentTrack, VolumeControl } from "./PlayerControls";
import { IconButton } from "../ui/IconButton";

/** Bottom bar, shown once something has been played. */
export function PlayerBar() {
  const t = useCurrentTrack();
  const open = usePlayer((s) => s.setNowPlaying);
  if (!t) return null;
  const key = albumKey(t);
  return (
    <footer
      className="grid h-[76px] shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-4 border-t border-line bg-surface-1 px-4"
      aria-label="Player"
    >
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={() => open(true)} className="group relative shrink-0 rounded" aria-label="Open Now Playing">
          <Cover src={t.cover} className="size-12" />
          <span className="absolute inset-0 grid place-items-center rounded bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <ChevronUp className="size-5" />
          </span>
        </button>
        <div className="min-w-0">
          {key ? (
            <Link
              to="/music/album/$key"
              params={{ key }}
              className="block truncate font-medium hover:underline"
              title={t.title}
            >
              {t.title}
            </Link>
          ) : (
            <span className="block truncate font-medium" title={t.title}>
              {t.title}
            </span>
          )}
          <span className="block truncate text-[13px] text-muted">
            {t.artists.map((a, i) => (
              <span key={a}>
                {i > 0 && ", "}
                <Link to="/music/artist/$key" params={{ key: artistKey(a) }} className="hover:text-fg hover:underline">
                  {a}
                </Link>
              </span>
            ))}
          </span>
        </div>
        <LikeButton track={t} />
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <Transport />
        <SeekBar className="w-full max-w-[560px]" />
      </div>

      <div className="flex items-center justify-end gap-1">
        <IconButton label="Up next" tooltipSide="top" onClick={() => open(true, "next")}>
          <ListMusic />
        </IconButton>
        <VolumeControl />
        <IconButton label="Now Playing" shortcut="F" tooltipSide="top" onClick={() => open(true)}>
          <ChevronUp />
        </IconButton>
      </div>
    </footer>
  );
}
