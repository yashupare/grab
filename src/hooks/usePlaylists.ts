import { useQuery } from "@tanstack/react-query";
import { api, type Track } from "../lib/ipc";
import { queryClient } from "../lib/queryClient";
import { toast } from "../stores/toasts";
import { errorMessage } from "./useSettings";

export const PLAYLISTS_KEY = ["playlists"] as const;

export function usePlaylists() {
  return useQuery({ queryKey: PLAYLISTS_KEY, queryFn: api.playlists, staleTime: 60_000 });
}

export function usePlaylist(id: string) {
  return useQuery({ queryKey: ["playlist", id], queryFn: () => api.playlist(id), retry: false });
}

export function refreshPlaylists(id?: string) {
  queryClient.invalidateQueries({ queryKey: PLAYLISTS_KEY });
  if (id) queryClient.invalidateQueries({ queryKey: ["playlist", id] });
  else queryClient.invalidateQueries({ queryKey: ["playlist"] });
}

export async function addToPlaylist(id: string, name: string, tracks: Track[]) {
  try {
    const n = await api.playlistAdd(
      id,
      tracks.map((t) => t.id),
    );
    refreshPlaylists(id);
    const skipped = tracks.length - n;
    toast.success(
      n === 0
        ? `Already in ${name}`
        : `Added ${n} song${n === 1 ? "" : "s"} to ${name}${skipped ? ` (${skipped} already there)` : ""}`,
    );
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/** New playlist, optionally with songs. Returns its id. */
export async function createPlaylist(name: string, tracks: Track[] = []): Promise<string | null> {
  try {
    const id = await api.playlistCreate(
      name,
      tracks.map((t) => t.id),
    );
    refreshPlaylists();
    toast.success(
      tracks.length ? `Created ${name} with ${tracks.length} song${tracks.length === 1 ? "" : "s"}` : `Created ${name}`,
    );
    return id;
  } catch (e) {
    toast.error(errorMessage(e));
    return null;
  }
}

/** "New playlist 3" style default name. */
export function nextPlaylistName(existing: { name: string }[]) {
  const taken = new Set(existing.map((p) => p.name.toLowerCase()));
  for (let i = 1; ; i++) {
    const name = i === 1 ? "New playlist" : `New playlist ${i}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}
