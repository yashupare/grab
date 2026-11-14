/** Transport pieces shared by the player bar and Now Playing. */
import { useState } from "react";
import { Slider } from "radix-ui";
import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { useLibrary } from "../../hooks/useLibrary";
import { formatDuration } from "../../lib/format";
import type { Track } from "../../lib/ipc";
import { currentTrack, usePlayer } from "../../stores/player";
import { cn } from "../../lib/cn";

/** The current song, with live fields (liked, cover) from the library when available. */
export function useCurrentTrack(): Track | null {
  const t = usePlayer((s) => currentTrack(s));
  const lib = useLibrary();
  if (!t) return null;
  return lib.tracks.find((x) => x.id === t.id) ?? t;
}

const iconBtn = "grid place-items-center rounded-full text-muted transition-colors hover:text-fg disabled:opacity-40";

export function Transport({ big }: { big?: boolean }) {
  const { playing, shuffle, repeat, index } = usePlayer();
  const has = index >= 0;
  const s = big ? "size-11 [&_svg]:size-6" : "size-9 [&_svg]:size-[18px]";
  return (
    <div className={cn("flex items-center", big ? "gap-5" : "gap-2")}>
      <button
        className={cn(iconBtn, s, shuffle && "text-accent hover:text-accent")}
        onClick={() => usePlayer.getState().toggleShuffle()}
        aria-label="Shuffle"
        aria-pressed={shuffle}
        title="Shuffle"
      >
        <Shuffle />
      </button>
      <button
        className={cn(iconBtn, s)}
        onClick={() => usePlayer.getState().prev()}
        disabled={!has}
        aria-label="Previous"
        title="Previous (Ctrl+←)"
      >
        <SkipBack className="fill-current" />
      </button>
      <button
        className={cn(
          "grid place-items-center rounded-full bg-fg text-bg transition-transform hover:scale-105 disabled:opacity-40",
          big ? "size-16 [&_svg]:size-7" : "size-10 [&_svg]:size-5",
        )}
        onClick={() => usePlayer.getState().toggle()}
        disabled={!has}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
      >
        {playing ? <Pause className="fill-current" /> : <Play className="translate-x-px fill-current" />}
      </button>
      <button
        className={cn(iconBtn, s)}
        onClick={() => usePlayer.getState().next()}
        disabled={!has}
        aria-label="Next"
        title="Next (Ctrl+→)"
      >
        <SkipForward className="fill-current" />
      </button>
      <button
        className={cn(iconBtn, s, repeat !== "off" && "text-accent hover:text-accent")}
        onClick={() => usePlayer.getState().cycleRepeat()}
        aria-label={`Repeat: ${repeat}`}
        title={repeat === "off" ? "Repeat" : repeat === "all" ? "Repeat all" : "Repeat this song"}
      >
        {repeat === "one" ? <Repeat1 /> : <Repeat />}
      </button>
    </div>
  );
}

export function SeekBar({ className }: { className?: string }) {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? position;
  return (
    <div className={cn("flex items-center gap-3 text-[12px] text-muted tabular", className)}>
      <span className="w-10 text-right">{formatDuration(shown)}</span>
      <Slider.Root
        className="group relative flex h-4 flex-1 touch-none items-center select-none"
        value={[Math.min(shown, duration || 0)]}
        max={duration || 1}
        step={0.5}
        disabled={!duration}
        onValueChange={([v]) => setDrag(v ?? 0)}
        onValueCommit={([v]) => {
          usePlayer.getState().seek(v ?? 0);
          setDrag(null);
        }}
        aria-label="Seek"
      >
        <Slider.Track className="relative h-1 grow overflow-hidden rounded-full bg-surface-3">
          <Slider.Range className="absolute h-full bg-fg group-hover:bg-accent" />
        </Slider.Track>
        <Slider.Thumb
          className="block size-3 rounded-full bg-fg opacity-0 shadow group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Position"
        />
      </Slider.Root>
      <span className="w-10">{formatDuration(duration)}</span>
    </div>
  );
}

export function VolumeControl({ className }: { className?: string }) {
  const { volume, muted } = usePlayer();
  const v = muted ? 0 : volume;
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2;
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <button
        className={cn(iconBtn, "size-8 [&_svg]:size-[18px]")}
        onClick={() => usePlayer.getState().toggleMute()}
        aria-label={muted ? "Unmute" : "Mute"}
        title="Mute (M)"
      >
        <Icon />
      </button>
      <Slider.Root
        className="group relative flex h-4 w-24 touch-none items-center select-none"
        value={[v]}
        max={1}
        step={0.01}
        onValueChange={([x]) => usePlayer.getState().setVolume(x ?? 0)}
        aria-label="Volume"
      >
        <Slider.Track className="relative h-1 grow overflow-hidden rounded-full bg-surface-3">
          <Slider.Range className="absolute h-full bg-fg group-hover:bg-accent" />
        </Slider.Track>
        <Slider.Thumb
          className="block size-3 rounded-full bg-fg opacity-0 shadow group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Volume"
        />
      </Slider.Root>
    </div>
  );
}
