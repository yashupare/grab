import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link, useNavigate } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import {
  Disc3,
  FolderOpen,
  Heart,
  ListEnd,
  ListPlus,
  ListStart,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
  User,
  X,
} from "lucide-react";
import { api, type Track } from "../../lib/ipc";
import { albumKey, artistKey } from "../../lib/library";
import { formatDuration, formatRelative } from "../../lib/format";
import { currentTrack, usePlayer, type QueueContext } from "../../stores/player";
import { setLiked } from "../../hooks/useLibrary";
import { addToPlaylist, createPlaylist, nextPlaylistName, usePlaylists } from "../../hooks/usePlaylists";
import { errorMessage } from "../../hooks/useSettings";
import { toast } from "../../stores/toasts";
import { Cover } from "./Cover";
import { cn } from "../../lib/cn";

export interface TrackTableProps {
  tracks: Track[];
  context: QueueContext;
  /** "#" column shows the album track number instead of the row number. */
  albumNumbers?: boolean;
  showAlbum?: boolean;
  showCover?: boolean;
  showAdded?: boolean;
  /** Playlist page: adds "Remove from playlist" and drag-to-reorder. */
  playlist?: { id: string; onRemove: (tracks: Track[]) => void; onReorder?: (ids: number[]) => void };
  empty?: ReactNode;
}

export function TrackTable({
  tracks,
  context,
  albumNumbers,
  showAlbum = true,
  showCover = true,
  showAdded,
  playlist,
  empty,
}: TrackTableProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const current = usePlayer((s) => currentTrack(s)?.id ?? null);
  const playing = usePlayer((s) => s.playing);

  const picked = useMemo(() => tracks.filter((t) => selected.has(t.id)), [tracks, selected]);
  const playFrom = (i: number) => usePlayer.getState().playList(tracks, i, context);

  function click(e: React.MouseEvent, i: number) {
    const id = tracks[i]!.id;
    if (e.shiftKey && anchor.current != null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      setSelected(new Set(tracks.slice(a, b + 1).map((t) => t.id)));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    } else setSelected(new Set([id]));
    anchor.current = i;
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && picked.length) {
      e.preventDefault();
      playFrom(tracks.indexOf(picked[0]!));
    } else if (e.key === "Delete" && playlist && picked.length) {
      e.preventDefault();
      playlist.onRemove(picked);
      setSelected(new Set());
    } else if (e.key === "Escape") setSelected(new Set());
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(tracks.map((t) => t.id)));
    }
  }

  function drop(to: number) {
    if (dragFrom == null || !playlist?.onReorder || dragFrom === to) return;
    const ids = tracks.map((t) => t.id);
    const [moved] = ids.splice(dragFrom, 1);
    ids.splice(to > dragFrom ? to - 1 : to, 0, moved!);
    playlist.onReorder(ids);
  }

  // Only the rows on screen are rendered (libraries can have thousands of songs). The page
  // scrolls in <main>, so the list measures where it starts inside it.
  const body = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const batch = picked.length > 1;
  useLayoutEffect(() => {
    const main = document.getElementById("main");
    const measure = () => {
      if (body.current && main)
        setOffset(body.current.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [batch, tracks.length]);
  // Its functions can't be memoised by React Compiler; this component is rendered normally.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virt = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => document.getElementById("main"),
    estimateSize: () => ROW_H,
    overscan: 12,
    scrollMargin: offset,
  });

  if (tracks.length === 0) return <>{empty}</>;

  const grid = cn(
    "grid items-center gap-3 px-3",
    showAlbum
      ? showAdded
        ? "grid-cols-[2.25rem_minmax(0,1.6fr)_minmax(0,1fr)_7rem_2rem_3.5rem_2rem]"
        : "grid-cols-[2.25rem_minmax(0,1.6fr)_minmax(0,1fr)_2rem_3.5rem_2rem]"
      : "grid-cols-[2.25rem_minmax(0,1fr)_2rem_3.5rem_2rem]",
  );

  return (
    <div
      onKeyDown={onKey}
      role="grid"
      aria-label={context.label}
      aria-multiselectable
      aria-rowcount={tracks.length + 1}
    >
      {picked.length > 1 && (
        <BatchBar tracks={picked} context={context} playlist={playlist} onClear={() => setSelected(new Set())} />
      )}
      <div
        role="row"
        aria-rowindex={1}
        className={cn(grid, "h-9 border-b border-line text-[12px] font-medium tracking-[0.04em] text-faint uppercase")}
      >
        <span role="columnheader" className="text-right">
          #
        </span>
        <span role="columnheader">Title</span>
        {showAlbum && <span role="columnheader">Album</span>}
        {showAlbum && showAdded && <span role="columnheader">Added</span>}
        <span role="columnheader">
          <span className="sr-only">Liked</span>
        </span>
        <span role="columnheader" className="text-right">
          Time
        </span>
        <span role="columnheader">
          <span className="sr-only">More</span>
        </span>
      </div>
      <div ref={body} role="rowgroup" className="relative mt-1" style={{ height: virt.getTotalSize() }}>
        {virt.getVirtualItems().map(({ index: i, start }) => {
          const t = tracks[i]!;
          return (
            <Row
              key={`${t.id}-${i}`}
              top={start - offset}
              t={t}
              i={i}
              grid={grid}
              number={albumNumbers ? (t.trackNo ?? i + 1) : i + 1}
              selected={selected.has(t.id)}
              isCurrent={current === t.id}
              playing={playing}
              showAlbum={showAlbum}
              showAdded={!!showAdded}
              showCover={showCover}
              onClick={click}
              onPlay={playFrom}
              menu={<TrackMenu tracks={selected.has(t.id) && picked.length > 1 ? picked : [t]} playlist={playlist} />}
              drag={
                playlist?.onReorder
                  ? {
                      onStart: () => setDragFrom(i),
                      onOver: (after) => setDropAt(after ? i + 1 : i),
                      onEnd: () => {
                        if (dropAt != null) drop(dropAt);
                        setDragFrom(null);
                        setDropAt(null);
                      },
                      line: dropAt === i ? "top" : dropAt === i + 1 && i === tracks.length - 1 ? "bottom" : null,
                    }
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}

const ROW_H = 56;

interface RowProps {
  /** Pixels from the top of the list (virtual rows are positioned absolutely). */
  top: number;
  t: Track;
  i: number;
  grid: string;
  number: number;
  selected: boolean;
  isCurrent: boolean;
  playing: boolean;
  showAlbum: boolean;
  showAdded: boolean;
  showCover: boolean;
  onClick: (e: React.MouseEvent, i: number) => void;
  onPlay: (i: number) => void;
  menu: ReactNode;
  drag?: { onStart: () => void; onOver: (after: boolean) => void; onEnd: () => void; line: "top" | "bottom" | null };
}

const Row = memo(function Row({
  top,
  t,
  i,
  grid,
  number,
  selected,
  isCurrent,
  playing,
  showAlbum,
  showAdded,
  showCover,
  onClick,
  onPlay,
  menu,
  drag,
}: RowProps) {
  const key = albumKey(t);
  return (
    <div
      role="row"
      aria-rowindex={i + 2}
      aria-selected={selected}
      style={{ transform: `translateY(${top}px)` }}
      className={cn(
        grid,
        "group absolute inset-x-0 top-0 h-14 cursor-default rounded-md select-none",
        selected ? "bg-accent-soft" : "hover:bg-surface-2",
        drag?.line === "top" && "before:absolute before:inset-x-2 before:-top-px before:h-0.5 before:bg-accent",
        drag?.line === "bottom" && "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-accent",
      )}
      onClick={(e) => onClick(e, i)}
      onDoubleClick={() => onPlay(i)}
      draggable={!!drag}
      onDragStart={drag?.onStart}
      onDragOver={
        drag &&
        ((e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          drag.onOver(e.clientY > r.top + r.height / 2);
        })
      }
      onDragEnd={drag?.onEnd}
    >
      <span role="gridcell" className="relative flex justify-end text-[13px] text-faint tabular">
        <span className={cn("group-hover:invisible", isCurrent && "invisible")}>{number}</span>
        <button
          className={cn(
            "absolute inset-y-0 right-0 hidden items-center text-fg group-hover:flex",
            isCurrent && !playing && "flex",
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (isCurrent) usePlayer.getState().toggle();
            else onPlay(i);
          }}
          aria-label={isCurrent && playing ? "Pause" : `Play ${t.title}`}
        >
          <Play className="size-4 fill-current" />
        </button>
        {isCurrent && playing && <Bars className="absolute top-1/2 right-0 -translate-y-1/2 group-hover:hidden" />}
      </span>
      <span role="gridcell" className="flex min-w-0 items-center gap-3">
        {showCover && <Cover src={t.cover} className="size-10" />}
        <span className="min-w-0">
          <span className={cn("block truncate font-medium", isCurrent && "text-accent")} title={t.title}>
            {t.title}
          </span>
          <span className="block truncate text-[13px] text-muted">
            {t.artists.map((a, k) => (
              <span key={a}>
                {k > 0 && ", "}
                <Link
                  to="/music/artist/$key"
                  params={{ key: artistKey(a) }}
                  className="hover:text-fg hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {a}
                </Link>
              </span>
            ))}
          </span>
        </span>
      </span>
      {showAlbum && (
        <span role="gridcell" className="truncate text-[13px] text-muted">
          {t.album && key ? (
            <Link
              to="/music/album/$key"
              params={{ key }}
              className="hover:text-fg hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {t.album}
            </Link>
          ) : (
            "—"
          )}
        </span>
      )}
      {showAlbum && showAdded && (
        <span role="gridcell" className="truncate text-[13px] text-muted">
          {formatRelative(t.addedAt)}
        </span>
      )}
      <span role="gridcell">
        <LikeButton
          track={t}
          className={cn(!t.liked && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
        />
      </span>
      <span role="gridcell" className="text-right text-[13px] text-muted tabular">
        {formatDuration(t.duration)}
      </span>
      <span
        role="gridcell"
        className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
      >
        {menu}
      </span>
    </div>
  );
});

/** Small animated "now playing" bars. */
export function Bars({ className }: { className?: string }) {
  return (
    <span className={cn("flex h-3.5 items-end gap-[2px]", className)} aria-label="Playing">
      {[0, 1, 2].map((k) => (
        <span
          key={k}
          className="w-[3px] animate-[eq_0.9s_ease-in-out_infinite] rounded-sm bg-accent motion-reduce:animate-none"
          style={{ animationDelay: `${k * 0.15}s`, height: "60%" }}
        />
      ))}
    </span>
  );
}

export function LikeButton({
  track,
  className,
  size = "sm",
}: {
  track: Track;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <button
      className={cn(
        "grid place-items-center rounded transition-colors",
        track.liked ? "text-accent" : "text-faint hover:text-fg",
        size === "md" ? "size-9" : "size-7",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        setLiked([track], !track.liked);
      }}
      aria-label={track.liked ? `Remove ${track.title} from Liked Songs` : `Like ${track.title}`}
      aria-pressed={track.liked}
    >
      <Heart className={cn(size === "md" ? "size-5" : "size-4", track.liked && "fill-current")} />
    </button>
  );
}

// ---------------------------------------------------------------- menus

const itemCls =
  "flex h-8 cursor-default items-center gap-2.5 rounded px-2.5 text-[13px] outline-none select-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-muted";
const contentCls = "z-50 min-w-[200px] rounded-lg border border-line bg-surface-1 p-1 shadow-(--shadow-float)";

export function TrackMenu({
  tracks,
  playlist,
  trigger,
}: {
  tracks: Track[];
  playlist?: TrackTableProps["playlist"];
  trigger?: ReactNode;
}) {
  const navigate = useNavigate();
  const one = tracks.length === 1 ? tracks[0]! : null;
  const allLiked = tracks.every((t) => t.liked);
  const key = one ? albumKey(one) : null;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        {trigger ?? (
          <button
            className="grid size-7 place-items-center rounded text-muted hover:bg-surface-3 hover:text-fg"
            aria-label="More"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={contentCls} onClick={(e) => e.stopPropagation()}>
          <DropdownMenu.Item className={itemCls} onSelect={() => usePlayer.getState().playNext(tracks)}>
            <ListStart /> Play next
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemCls} onSelect={() => usePlayer.getState().addToQueue(tracks)}>
            <ListEnd /> Add to queue
          </DropdownMenu.Item>
          <AddToPlaylistSub tracks={tracks} />
          <DropdownMenu.Item className={itemCls} onSelect={() => setLiked(tracks, !allLiked)}>
            <Heart /> {allLiked ? "Remove from Liked Songs" : "Add to Liked Songs"}
          </DropdownMenu.Item>
          {one && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              {key && (
                <DropdownMenu.Item
                  className={itemCls}
                  onSelect={() => navigate({ to: "/music/album/$key", params: { key } })}
                >
                  <Disc3 /> Go to album
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item
                className={itemCls}
                onSelect={() =>
                  navigate({ to: "/music/artist/$key", params: { key: artistKey(one.artists[0] ?? one.artist) } })
                }
              >
                <User /> Go to artist
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={itemCls}
                onSelect={() => api.revealTrack(one.id).catch((e) => toast.error(errorMessage(e)))}
              >
                <FolderOpen /> Show in folder
              </DropdownMenu.Item>
            </>
          )}
          {playlist && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Item
                className={cn(itemCls, "text-danger [&_svg]:text-danger")}
                onSelect={() => playlist.onRemove(tracks)}
              >
                <Trash2 /> Remove from this playlist
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function AddToPlaylistSub({ tracks }: { tracks: Track[] }) {
  const lists = usePlaylists();
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={itemCls}>
        <ListPlus /> Add to playlist
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={6} className={cn(contentCls, "max-h-[60vh] overflow-y-auto")}>
          <DropdownMenu.Item
            className={itemCls}
            onSelect={() => createPlaylist(nextPlaylistName(lists.data ?? []), tracks)}
          >
            <Plus /> New playlist
          </DropdownMenu.Item>
          {!!lists.data?.length && <DropdownMenu.Separator className="my-1 h-px bg-line" />}
          {lists.data?.map((p) => (
            <DropdownMenu.Item key={p.id} className={itemCls} onSelect={() => addToPlaylist(p.id, p.name, tracks)}>
              <span className="truncate">{p.name}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

function BatchBar({
  tracks,
  context,
  playlist,
  onClear,
}: {
  tracks: Track[];
  context: QueueContext;
  playlist?: TrackTableProps["playlist"];
  onClear: () => void;
}) {
  const btn =
    "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium hover:bg-surface-3 [&_svg]:size-4";
  return (
    <div
      className="sticky top-0 z-10 mb-2 flex items-center gap-1 rounded-lg border border-line bg-surface-2 px-2 py-1.5 shadow-(--shadow-float)"
      role="toolbar"
      aria-label="Selected songs"
    >
      <span className="px-2 text-[13px] font-semibold tabular">{tracks.length} selected</span>
      <button className={btn} onClick={() => usePlayer.getState().playList(tracks, 0, context)}>
        <Play /> Play
      </button>
      <button className={btn} onClick={() => usePlayer.getState().addToQueue(tracks)}>
        <ListEnd /> Add to queue
      </button>
      <TrackMenu
        tracks={tracks}
        playlist={playlist}
        trigger={
          <button className={btn}>
            <MoreHorizontal /> More
          </button>
        }
      />
      <button className={cn(btn, "ml-auto")} onClick={onClear} aria-label="Clear selection">
        <X />
      </button>
    </div>
  );
}
