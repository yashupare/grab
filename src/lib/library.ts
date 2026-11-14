/** Albums, artists, filtering and sorting, all derived from the flat song list. Pure functions. */
import type { Track } from "./ipc";

export interface Album {
  /** Stable id for URLs: album artist + album title, lower-cased. */
  key: string;
  title: string;
  artist: string;
  year: number | null;
  cover: string | null;
  tracks: Track[];
  duration: number;
  /** Newest song's added date (for "Recently added"). */
  addedAt: string;
}

export interface Artist {
  key: string;
  name: string;
  tracks: Track[];
  albums: Album[];
  cover: string | null;
}

export const albumArtist = (t: Track) => t.albumArtist ?? t.artists[0] ?? t.artist;

export function albumKey(t: Track): string | null {
  if (!t.album) return null;
  return `${albumArtist(t).toLowerCase()}•${t.album.toLowerCase()}`;
}

export const artistKey = (name: string) => name.toLowerCase();

/** Disc, then track number, then title. */
export function albumOrder(a: Track, b: Track) {
  return (
    (a.discNo ?? 1) - (b.discNo ?? 1) || (a.trackNo ?? 9999) - (b.trackNo ?? 9999) || a.title.localeCompare(b.title)
  );
}

export function buildAlbums(tracks: Track[]): Album[] {
  const map = new Map<string, Album>();
  for (const t of tracks) {
    const key = albumKey(t);
    if (!key) continue;
    let a = map.get(key);
    if (!a) {
      a = {
        key,
        title: t.album!,
        artist: albumArtist(t),
        year: t.year,
        cover: null,
        tracks: [],
        duration: 0,
        addedAt: t.addedAt,
      };
      map.set(key, a);
    }
    a.tracks.push(t);
    a.duration += t.duration;
    a.year ??= t.year;
    a.cover ??= t.cover;
    if (t.addedAt > a.addedAt) a.addedAt = t.addedAt;
  }
  for (const a of map.values()) a.tracks.sort(albumOrder);
  return [...map.values()].sort((x, y) => y.addedAt.localeCompare(x.addedAt));
}

export function buildArtists(tracks: Track[], albums: Album[] = buildAlbums(tracks)): Artist[] {
  const map = new Map<string, Artist>();
  for (const t of tracks) {
    for (const name of t.artists.length ? t.artists : [t.artist]) {
      const key = artistKey(name);
      let a = map.get(key);
      if (!a) {
        a = { key, name, tracks: [], albums: [], cover: null };
        map.set(key, a);
      }
      a.tracks.push(t);
      a.cover ??= t.cover;
    }
  }
  for (const al of albums) map.get(artistKey(al.artist))?.albums.push(al);
  return [...map.values()].sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
}

/** Every word must appear in the title, artist or album. */
export function filterTracks(tracks: Track[], query: string): Track[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return tracks;
  return tracks.filter((t) => {
    const hay = `${t.title} ${t.artist} ${t.album ?? ""} ${t.albumArtist ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export type SongSort = "added" | "title" | "artist" | "album" | "duration";

export function sortTracks(tracks: Track[], by: SongSort, desc = false): Track[] {
  const cmp: Record<SongSort, (a: Track, b: Track) => number> = {
    added: (a, b) => b.addedAt.localeCompare(a.addedAt) || b.id - a.id,
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    artist: (a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" }) || albumOrder(a, b),
    album: (a, b) =>
      (a.album ?? "￿").localeCompare(b.album ?? "￿", undefined, { sensitivity: "base" }) || albumOrder(a, b),
    duration: (a, b) => a.duration - b.duration,
  };
  const out = [...tracks].sort(cmp[by]);
  return desc ? out.reverse() : out;
}

/** "1 h 7 min" / "42 min". */
export function formatTotal(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
