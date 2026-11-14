import { convertFileSrc } from "@tauri-apps/api/core";
import { Disc3, ListMusic, Music2, User } from "lucide-react";
import { cn } from "../../lib/cn";

const ICONS = { song: Music2, album: Disc3, artist: User, playlist: ListMusic };

/** Local cover image (a file path) or web image (https), with an icon when there's none. */
export function Cover({
  src,
  kind = "song",
  className,
  round,
}: {
  src: string | null | undefined;
  kind?: keyof typeof ICONS;
  className?: string;
  round?: boolean;
}) {
  const Icon = ICONS[kind];
  const url = src ? (src.startsWith("http") ? src : convertFileSrc(src)) : null;
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden bg-surface-3 text-faint",
        round ? "rounded-full" : "rounded",
        className,
      )}
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <Icon className="size-[40%]" strokeWidth={1.5} aria-hidden />
      )}
    </span>
  );
}

/** 2×2 mosaic of song covers (playlists). */
export function Mosaic({ covers, className }: { covers: string[]; className?: string }) {
  if (covers.length < 4) return <Cover src={covers[0]} kind="playlist" className={className} />;
  return (
    <span className={cn("grid shrink-0 grid-cols-2 overflow-hidden rounded", className)}>
      {covers.slice(0, 4).map((c) => (
        <img key={c} src={convertFileSrc(c)} alt="" loading="lazy" className="aspect-square size-full object-cover" />
      ))}
    </span>
  );
}
