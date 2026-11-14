import { useEffect, useRef, useState } from "react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { AlertTriangle, Disc3, ListMusic, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useLibrary } from "../../hooks/useLibrary";
import { refreshPlaylists, usePlaylist } from "../../hooks/usePlaylists";
import { errorMessage } from "../../hooks/useSettings";
import { formatTotal } from "../../lib/library";
import { api, type Track } from "../../lib/ipc";
import { queryClient } from "../../lib/queryClient";
import { toast } from "../../stores/toasts";
import { CollectionHero } from "../../components/music/CollectionHero";
import { Cover, Mosaic } from "../../components/music/Cover";
import { TrackTable } from "../../components/music/TrackTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { IconButton } from "../../components/ui/IconButton";
import { Button } from "../../components/ui/Button";
import { AlbumGrid } from "./MusicPage";

const songs = (n: number) => `${n} song${n === 1 ? "" : "s"}`;

function NotFound({ what }: { what: string }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title={`This ${what} isn't in your library`}
      action={
        <Link to="/music" search={{ q: "", tab: "songs" }}>
          <Button>Go to Music</Button>
        </Link>
      }
    >
      Its songs may have been moved or deleted.
    </EmptyState>
  );
}

const albumRoute = getRouteApi("/music/album/$key");

export function AlbumPage() {
  const { key } = albumRoute.useParams();
  const lib = useLibrary();
  const album = lib.albums.find((a) => a.key === key);
  if (!album) return lib.isPending || lib.scanning ? null : <NotFound what="album" />;
  const context = { label: album.title, href: `/music/album/${encodeURIComponent(album.key)}` };
  const artistKey = album.artist.toLowerCase();
  return (
    <div className="flex flex-col gap-6">
      <CollectionHero
        art={<Cover src={album.cover} kind="album" className="size-full rounded-none" />}
        kicker="Album"
        title={album.title}
        meta={
          <>
            <Link to="/music/artist/$key" params={{ key: artistKey }} className="font-medium text-fg hover:underline">
              {album.artist}
            </Link>
            {[album.year, songs(album.tracks.length), formatTotal(album.duration)]
              .filter(Boolean)
              .map((m) => ` · ${m}`)}
          </>
        }
        tracks={album.tracks}
        context={context}
      />
      <TrackTable tracks={album.tracks} context={context} albumNumbers showAlbum={false} showCover={false} />
    </div>
  );
}

const artistRoute = getRouteApi("/music/artist/$key");

export function ArtistPage() {
  const { key } = artistRoute.useParams();
  const lib = useLibrary();
  const artist = lib.artists.find((a) => a.key === key);
  if (!artist) return lib.isPending || lib.scanning ? null : <NotFound what="artist" />;
  const context = { label: artist.name, href: `/music/artist/${encodeURIComponent(artist.key)}` };
  return (
    <div className="flex flex-col gap-8">
      <CollectionHero
        art={<Cover src={artist.cover} kind="artist" className="size-full rounded-none" />}
        kicker="Artist"
        title={artist.name}
        meta={[
          songs(artist.tracks.length),
          artist.albums.length ? `${artist.albums.length} album${artist.albums.length === 1 ? "" : "s"}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        tracks={artist.tracks}
        context={context}
      />
      <section>
        <h2 className="mb-2 text-[18px] font-semibold">Songs</h2>
        <TrackTable tracks={artist.tracks} context={context} />
      </section>
      {artist.albums.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-[18px] font-semibold">
            <Disc3 className="size-5 text-faint" aria-hidden /> Albums
          </h2>
          <AlbumGrid albums={artist.albums} />
        </section>
      )}
    </div>
  );
}

const playlistRoute = getRouteApi("/music/playlist/$id");

export function PlaylistPage() {
  const { id } = playlistRoute.useParams();
  const navigate = useNavigate();
  const pl = usePlaylist(id);
  const [renaming, setRenaming] = useState(false);

  if (pl.isPending) return null;
  if (pl.isError || !pl.data) return <NotFound what="playlist" />;
  const p = pl.data;
  const context = { label: p.name, href: `/music/playlist/${encodeURIComponent(p.id)}` };

  // Update the list right away, then save.
  const optimistic = (tracks: Track[]) =>
    queryClient.setQueryData(["playlist", id], { ...p, tracks, count: tracks.length });
  const run = (fn: () => Promise<unknown>) =>
    fn()
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => refreshPlaylists(id));

  const remove = (tracks: Track[]) => {
    const ids = new Set(tracks.map((t) => t.id));
    optimistic(p.tracks.filter((t) => !ids.has(t.id)));
    run(() => api.playlistRemove(id, [...ids]));
    toast.info(`Removed ${songs(tracks.length)} from ${p.name}`);
  };
  const reorder = (ids: number[]) => {
    const byId = new Map(p.tracks.map((t) => [t.id, t]));
    optimistic(ids.map((i) => byId.get(i)!).filter(Boolean));
    run(() => api.playlistReorder(id, ids));
  };

  return (
    <div className="flex flex-col gap-6">
      <CollectionHero
        art={<Mosaic covers={p.covers} className="size-full rounded-none" />}
        kicker={p.source?.startsWith("spotify:") ? "Playlist · from Spotify" : "Playlist"}
        title={p.name}
        titleSlot={
          renaming ? (
            <RenameField
              initial={p.name}
              onDone={(name) => {
                setRenaming(false);
                if (name && name !== p.name) run(() => api.playlistRename(id, name));
              }}
            />
          ) : undefined
        }
        meta={
          <>
            {[songs(p.count), p.duration ? formatTotal(p.duration) : null].filter(Boolean).join(" · ")}
            {p.missing > 0 && (
              <span
                className="text-faint"
                title="Songs that are still downloading, or whose files were moved or deleted"
              >
                {" "}
                · {p.missing} not in library
              </span>
            )}
          </>
        }
        tracks={p.tracks}
        context={context}
        actions={
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <IconButton label="More">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={4}
                className="z-50 min-w-[180px] rounded-lg border border-line bg-surface-1 p-1 shadow-(--shadow-float)"
              >
                <DropdownMenu.Item
                  className="flex h-8 items-center gap-2.5 rounded px-2.5 text-[13px] outline-none data-[highlighted]:bg-surface-2 [&_svg]:size-4"
                  onSelect={() => setRenaming(true)}
                >
                  <Pencil /> Rename
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex h-8 items-center gap-2.5 rounded px-2.5 text-[13px] text-danger outline-none data-[highlighted]:bg-surface-2 [&_svg]:size-4"
                  onSelect={() => {
                    if (!window.confirm(`Delete the playlist "${p.name}"? The songs stay in your library.`)) return;
                    api
                      .playlistDelete(id)
                      .then(() => {
                        refreshPlaylists();
                        toast.info(`Deleted ${p.name}`);
                        navigate({ to: "/music", search: { q: "", tab: "songs" } });
                      })
                      .catch((e) => toast.error(errorMessage(e)));
                  }}
                >
                  <Trash2 /> Delete playlist
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        }
      />
      <TrackTable
        tracks={p.tracks}
        context={context}
        playlist={{ id, onRemove: remove, onReorder: reorder }}
        empty={
          <EmptyState icon={ListMusic} title="This playlist is empty">
            Add songs from any list with the ⋯ menu → Add to playlist.
          </EmptyState>
        }
      />
      {p.tracks.length > 1 && <p className="text-center text-[12.5px] text-faint">Drag songs to change the order.</p>}
    </div>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(value.trim() || null);
        if (e.key === "Escape") onDone(null);
      }}
      maxLength={120}
      aria-label="Playlist name"
      className="mt-1 w-full rounded-md border border-line bg-surface-2 px-2 text-[32px] leading-[44px] font-bold tracking-[-0.02em] outline-none focus:border-muted"
    />
  );
}
