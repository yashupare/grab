import type { ReactNode } from "react";
import { Pause, Play, Shuffle } from "lucide-react";
import type { Track } from "../../lib/ipc";
import { currentTrack, usePlayer, type QueueContext } from "../../stores/player";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";

/** Album / artist / playlist header: art, title, details, Play and Shuffle. */
export function CollectionHero({
  art,
  kicker,
  title,
  meta,
  tracks,
  context,
  actions,
  titleSlot,
}: {
  art: ReactNode;
  kicker: string;
  title: string;
  meta: ReactNode;
  tracks: Track[];
  context: QueueContext;
  actions?: ReactNode;
  /** Replaces the title (e.g. an inline rename field). */
  titleSlot?: ReactNode;
}) {
  // "Pause" when this very list is what's playing.
  const isThis = usePlayer(
    (s) => s.context?.label === context.label && s.context?.href === context.href && currentTrack(s) !== null,
  );
  const playing = usePlayer((s) => s.playing);
  const active = isThis && playing;
  return (
    <header className="relative overflow-hidden rounded-xl border border-line bg-surface-1 p-6">
      <div className="flex items-end gap-6">
        <div className="size-44 shrink-0 overflow-hidden rounded-lg shadow-(--shadow-float)">{art}</div>
        <div className="min-w-0 pb-1">
          <span className="text-[12px] font-medium tracking-[0.06em] text-muted uppercase">{kicker}</span>
          {titleSlot ?? (
            <h1 className="selectable mt-1 line-clamp-2 text-[32px] leading-[38px] font-bold tracking-[-0.02em]">
              {title}
            </h1>
          )}
          <div className="mt-2 text-muted">{meta}</div>
          <div className="mt-5 flex items-center gap-2">
            <Button
              variant="primary"
              size="lg"
              icon={active ? <Pause className="fill-current" /> : <Play className="fill-current" />}
              disabled={!tracks.length}
              onClick={() =>
                isThis
                  ? usePlayer.getState().toggle()
                  : usePlayer.getState().playList(tracks, 0, context, { shuffle: false })
              }
            >
              {active ? "Pause" : "Play"}
            </Button>
            <IconButton
              label="Shuffle play"
              disabled={!tracks.length}
              onClick={() => usePlayer.getState().playList(tracks, 0, context, { shuffle: true })}
            >
              <Shuffle />
            </IconButton>
            {actions}
          </div>
        </div>
      </div>
    </header>
  );
}
