import { QueryClient } from "@tanstack/react-query";

/** One client for the app, importable outside React (e.g. to refresh after a job event). */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});
