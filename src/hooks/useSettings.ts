import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isAppError, type Settings } from "../lib/ipc";
import { useUi } from "../stores/ui";

const KEY = ["settings"] as const;

export function useSettings() {
  return useQuery({ queryKey: KEY, queryFn: api.getSettings, staleTime: Infinity });
}

/** Optimistic: the UI updates immediately and rolls back if Rust rejects the change. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.updateSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<Settings>(KEY);
      if (previous) qc.setQueryData<Settings>(KEY, { ...previous, ...patch });
      return { previous };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEY, ctx.previous);
    },
    onSuccess: (saved) => qc.setQueryData(KEY, saved),
  });
}

export function errorMessage(e: unknown) {
  return isAppError(e) ? e.message : e instanceof Error ? e.message : String(e);
}

/** The database is the source of truth for the theme; localStorage only paints the first frame. */
export function useThemeSync() {
  const { data } = useSettings();
  useEffect(() => {
    if (data && useUi.getState().theme !== data.theme) useUi.getState().setTheme(data.theme);
  }, [data]);
}
