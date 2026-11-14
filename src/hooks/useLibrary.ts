import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Track } from "../lib/ipc";
import { buildAlbums, buildArtists } from "../lib/library";
import { queryClient } from "../lib/queryClient";
import { toast } from "../stores/toasts";
import { errorMessage } from "./useSettings";

export const LIBRARY_KEY = ["library"] as const;

/** All songs, plus albums and artists derived from them. Refreshes while a scan is running. */
export function useLibrary() {
  const q = useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: api.libraryTracks,
    staleTime: Infinity,
    refetchInterval: (query) => (query.state.data?.scanning ? 1500 : false),
  });
  const tracks = useMemo(() => q.data?.tracks ?? [], [q.data]);
  const albums = useMemo(() => buildAlbums(tracks), [tracks]);
  const artists = useMemo(() => buildArtists(tracks, albums), [tracks, albums]);
  return { ...q, tracks, albums, artists, scanning: q.data?.scanning ?? false };
}

/** Mount once: refetch when the folder watcher finds changes. */
export function useLibrarySync() {
  useEffect(() => {
    const sub = api.onLibraryChanged(() => {
      queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });
      // Imported playlist songs appear as their downloads land.
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlist"] });
    });
    return () => {
      sub.then((un) => un());
    };
  }, []);
}

/** Like/unlike, updating the list right away. */
export async function setLiked(tracks: Track[], liked: boolean) {
  const ids = new Set(tracks.map((t) => t.id));
  const patch = (d: { tracks: Track[]; scanning: boolean } | undefined) =>
    d && { ...d, tracks: d.tracks.map((t) => (ids.has(t.id) ? { ...t, liked } : t)) };
  queryClient.setQueryData(LIBRARY_KEY, patch);
  try {
    await api.setLiked([...ids], liked);
  } catch (e) {
    toast.error(errorMessage(e));
    queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });
  }
}
