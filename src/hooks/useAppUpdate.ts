import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api, type AppUpdate } from "../lib/ipc";
import { queryClient } from "../lib/queryClient";
import { toast } from "../stores/toasts";
import { errorMessage } from "./useSettings";

const KEY = ["app-update"] as const;

/** The update found by the last check (daily background check or "Check now"). */
export function useAppUpdate() {
  return useQuery<AppUpdate | null>({
    queryKey: KEY,
    queryFn: () => null,
    staleTime: Infinity,
    enabled: false,
    initialData: null,
  });
}

export function useCheckForUpdate() {
  return useMutation({
    mutationFn: api.appUpdateCheck,
    onSuccess: (u) => {
      queryClient.setQueryData(KEY, u);
      if (!u) toast.success("Grab is up to date.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Download progress while installing (0–1, or null before it starts). */
export function useInstallUpdate() {
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => {
    const sub = api.onAppUpdateProgress((p) => setProgress(p.total ? p.received / p.total : null));
    return () => {
      sub.then((un) => un());
    };
  }, []);
  const install = useMutation({
    mutationFn: api.appUpdateInstall,
    onMutate: () => setProgress(0),
    onError: (e) => {
      setProgress(null);
      toast.error(errorMessage(e));
    },
  });
  return { install, progress };
}

/** Mount once: the daily check found something. */
export function useAppUpdateSync() {
  const navigate = useNavigate();
  useEffect(() => {
    const sub = api.onAppUpdateAvailable((u) => {
      queryClient.setQueryData(KEY, u);
      toast.info(`Grab ${u.version} is available.`, {
        label: "See update",
        run: () => navigate({ to: "/settings", search: { section: "updates" } }),
      });
    });
    return () => {
      sub.then((un) => un());
    };
  }, [navigate]);
}
