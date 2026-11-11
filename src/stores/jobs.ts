import { useEffect } from "react";
import { create } from "zustand";
import { api, type Job, type JobProgress } from "../lib/ipc";

interface JobsState {
  jobs: Record<string, Job>;
  /** Live progress for running jobs (not persisted). */
  live: Record<string, JobProgress>;
  loaded: boolean;
  setAll: (jobs: Job[]) => void;
  upsert: (job: Job) => void;
  progress: (p: JobProgress) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

export const useJobs = create<JobsState>()((set) => ({
  jobs: {},
  live: {},
  loaded: false,
  setAll: (jobs) => set({ jobs: Object.fromEntries(jobs.map((j) => [j.id, j])), loaded: true }),
  upsert: (job) =>
    set((s) => {
      const live = { ...s.live };
      if (job.status !== "running") delete live[job.id];
      return { jobs: { ...s.jobs, [job.id]: job }, live };
    }),
  progress: (p) => set((s) => ({ live: { ...s.live, [p.id]: p } })),
  remove: (id) =>
    set((s) => {
      const jobs = { ...s.jobs };
      const live = { ...s.live };
      delete jobs[id];
      delete live[id];
      return { jobs, live };
    }),
  clearFinished: () =>
    set((s) => ({
      jobs: Object.fromEntries(Object.entries(s.jobs).filter(([, j]) => j.status !== "done" && j.status !== "cancelled")),
    })),
}));

export const isActive = (j: Job) => j.status === "running" || j.status === "queued" || j.status === "paused";

/** Newest first. */
export function sortJobs(jobs: Job[]) {
  return [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Load the queue once and keep it in sync with the Rust side. Mount once, in the app shell. */
export function useJobsSync() {
  useEffect(() => {
    const s = useJobs.getState();
    const subs = [
      api.onJobUpdated(s.upsert),
      api.onJobProgress(s.progress),
      api.onJobRemoved(s.remove),
      api.onJobsCleared(s.clearFinished),
    ];
    api.listJobs().then(s.setAll).catch(() => s.setAll([]));
    return () => {
      subs.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, []);
}
