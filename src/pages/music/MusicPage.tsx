import { useMemo, useState } from "react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import { ArrowDownUp, FolderSearch, Heart, Loader2, Music2, Play, RefreshCw, Search, Shuffle } from "lucide-react";
import { useLibrary } from "../../hooks/useLibrary";
import { filterTracks, formatTotal, sortTracks, type Album, type Artist, type SongSort } from "../../lib/library";
import { api } from "../../lib/ipc";
import { usePlayer } from "../../stores/player";
import { PageHeader } from "../../components/ui/PageHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { Cover } from "../../components/music/Cover";
import { TrackTable } from "../../components/music/TrackTable";
import { cn } from "../../lib/cn";

const route = getRouteApi("/music");
export const MUSIC_TABS = ["songs", "albums", "artists", "liked"] as const;
export type MusicTab = (typeof MUSIC_TABS)[number];
const TAB_LABELS: Record<MusicTab, string> = { songs: "Songs", albums: "Albums", artists: "Artists", liked: "Liked" };
const SORTS: { value: SongSort; label: string }[] = [
  { value: "added", label: "Recently added" },
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "album", label: "Album" },
  { value: "duration", label: "Length" },
];

export function MusicPage() {
  const search = route.useSearch();
  const q = search.q ?? "";
  const tab = search.tab ?? "songs";
  const navigate = useNavigate();
  const lib = useLibrary();
  const [sort, setSort] = useState<SongSort>("added");

  const filtered = useMemo(() => filterTracks(lib.tracks, q), [lib.tracks, q]);
  const songs = useMemo(() => sortTracks(filtered, sort), [filtered, sort]);
  const liked = useMemo(() => songs.filter((t) => t.liked), [songs]);
  const ql = q.toLowerCase();
  const albums = useMemo(
    () => (q ? lib.albums.filter((a) => `${a.title} ${a.artist}`.toLowerCase().includes(ql)) : lib.albums),
    [lib.albums, q, ql],
  );
  const artists = useMemo(
    () => (q ? lib.artists.filter((a) => a.name.toLowerCase().includes(ql)) : lib.artists),
    [lib.artists, q, ql],
  );

  const setSearch = (patch: { q?: string; tab?: MusicTab }) => {
    const next = { q, tab, ...patch };
    navigate({
      to: "/music",
      search: { q: next.q || undefined, tab: next.tab === "songs" ? undefined : next.tab },
      replace: true,
    });
  };
  const listFor = tab === "liked" ? liked : songs;

  const empty = lib.isSuccess && lib.tracks.length === 0;
  return (
    <>
      <PageHeader
        title="Music"
        subtitle={
          lib.scanning ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Looking for songs in your folders…{" "}
              {lib.tracks.length} so far
            </span>
          ) : lib.tracks.length ? (
            [
              plural(lib.tracks.length, "song"),
              plural(lib.albums.length, "album"),
              formatTotal(lib.tracks.reduce((s, t) => s + t.duration, 0)),
            ].join(" · ")
          ) : (
            "Your songs, albums, artists and playlists"
          )
        }
        actions={
          <IconButton label="Scan folders again" onClick={() => api.libraryRescan()}>
            <RefreshCw />
          </IconButton>
        }
      />

      {empty ? (
        <EmptyState
          icon={Music2}
          title="Your library is empty"
          action={
            <div className="flex gap-2">
              <Link to="/link" search={{ url: "" }}>
                <Button variant="primary">Import from Spotify</Button>
              </Link>
              <Link to="/settings" search={{ section: "music" }}>
                <Button icon={<FolderSearch />}>Add a music folder</Button>
              </Link>
            </div>
          }
        >
          Songs you download as audio, import from Spotify, or keep in your library folders show up here.
        </EmptyState>
      ) : (
        <Tabs.Root value={tab} onValueChange={(v) => setSearch({ tab: v as MusicTab })}>
          <div className="mb-3 flex items-end gap-4 border-b border-line">
            <Tabs.List className="flex gap-6" aria-label="Library">
              {MUSIC_TABS.map((t) => (
                <Tabs.Trigger
                  key={t}
                  value={t}
                  className="-mb-px border-b-2 border-transparent pb-2.5 font-medium text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg"
                >
                  {TAB_LABELS[t]}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <div className="mb-2 ml-auto flex items-center gap-2">
              <label className="flex h-8 w-60 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 focus-within:border-muted">
                <Search className="size-3.5 text-faint" aria-hidden />
                <input
                  value={q}
                  onChange={(e) => setSearch({ q: e.target.value })}
                  placeholder={`Filter ${TAB_LABELS[tab].toLowerCase()}`}
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
                  aria-label="Filter"
                />
              </label>
              {(tab === "songs" || tab === "liked") && (
                <label className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 text-[13px]">
                  <ArrowDownUp className="size-3.5 text-faint" aria-hidden />
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SongSort)}
                    className="bg-transparent outline-none"
                    aria-label="Sort by"
                  >
                    {SORTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(tab === "songs" || tab === "liked") && (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Play className="fill-current" />}
                    disabled={!listFor.length}
                    onClick={() => usePlayer.getState().playList(listFor, 0, ctx(tab), { shuffle: false })}
                  >
                    Play
                  </Button>
                  <IconButton
                    label="Shuffle play"
                    size="sm"
                    disabled={!listFor.length}
                    onClick={() => usePlayer.getState().playList(listFor, 0, ctx(tab), { shuffle: true })}
                  >
                    <Shuffle />
                  </IconButton>
                </>
              )}
            </div>
          </div>

          <Tabs.Content value="songs" className="outline-none">
            <TrackTable tracks={songs} context={ctx("songs")} showAdded empty={<NoMatch q={q} />} />
          </Tabs.Content>
          <Tabs.Content value="albums" className="outline-none">
            {albums.length ? <AlbumGrid albums={albums} /> : <NoMatch q={q} what="albums" />}
          </Tabs.Content>
          <Tabs.Content value="artists" className="outline-none">
            {artists.length ? <ArtistGrid artists={artists} /> : <NoMatch q={q} what="artists" />}
          </Tabs.Content>
          <Tabs.Content value="liked" className="outline-none">
            <TrackTable
              tracks={liked}
              context={ctx("liked")}
              showAdded
              empty={
                q ? (
                  <NoMatch q={q} />
                ) : (
                  <EmptyState icon={Heart} title="No liked songs yet">
                    Tap the heart next to any song, or press L while it plays.
                  </EmptyState>
                )
              }
            />
          </Tabs.Content>
        </Tabs.Root>
      )}
    </>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const ctx = (tab: MusicTab) =>
  tab === "liked" ? { label: "Liked Songs", href: "/music?tab=liked" } : { label: "Songs", href: "/music" };

function NoMatch({ q, what = "songs" }: { q: string; what?: string }) {
  return (
    <EmptyState icon={Search} title={q ? `No ${what} match "${q}"` : `No ${what} yet`}>
      {q ? "Try fewer words." : what === "albums" ? "Songs with an album tag are grouped here." : ""}
    </EmptyState>
  );
}

export function AlbumGrid({ albums, className }: { albums: Album[]; className?: string }) {
  return (
    <ul className={cn("grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-5 gap-y-6", className)}>
      {albums.map((a) => (
        <li key={a.key} className="group">
          <Link to="/music/album/$key" params={{ key: a.key }} className="block outline-none">
            <span className="relative block">
              <Cover src={a.cover} kind="album" className="aspect-square w-full rounded-lg" />
              <button
                className="absolute right-2 bottom-2 grid size-11 translate-y-1 place-items-center rounded-full bg-accent text-on-accent opacity-0 shadow-(--shadow-float) transition group-hover:translate-y-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Play ${a.title}`}
                onClick={(e) => {
                  e.preventDefault();
                  usePlayer
                    .getState()
                    .playList(
                      a.tracks,
                      0,
                      { label: a.title, href: `/music/album/${encodeURIComponent(a.key)}` },
                      { shuffle: false },
                    );
                }}
              >
                <Play className="size-5 fill-current" />
              </button>
            </span>
            <span className="mt-2.5 block truncate font-medium group-hover:underline">{a.title}</span>
            <span className="block truncate text-[13px] text-muted">
              {[a.artist, a.year].filter(Boolean).join(" · ")}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ArtistGrid({ artists }: { artists: Artist[] }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-6">
      {artists.map((a) => (
        <li key={a.key} className="group text-center">
          <Link to="/music/artist/$key" params={{ key: a.key }} className="block outline-none">
            <Cover src={a.cover} kind="artist" round className="mx-auto aspect-square w-full" />
            <span className="mt-2.5 block truncate font-medium group-hover:underline">{a.name}</span>
            <span className="block text-[13px] text-muted">
              {a.tracks.length} song{a.tracks.length === 1 ? "" : "s"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
