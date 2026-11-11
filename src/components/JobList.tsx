import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "./ui/EmptyState";
import { JobRow } from "./JobRow";
import { sortJobs, useJobs } from "../stores/jobs";
import type { Job } from "../lib/ipc";

export type JobFilter = "active" | "done" | "failed" | "all";

const MATCH: Record<JobFilter, (j: Job) => boolean> = {
  active: (j) => j.status === "running" || j.status === "queued" || j.status === "paused",
  done: (j) => j.status === "done",
  failed: (j) => j.status === "failed" || j.status === "cancelled",
  all: () => true,
};

export function useFilteredJobs(filter: JobFilter) {
  const jobs = useJobs(useShallow((s) => Object.values(s.jobs)));
  return useMemo(() => {
    const list = sortJobs(jobs.filter(MATCH[filter]));
    // Running first, then queued, then paused; newest first within each.
    if (filter === "active") {
      const rank = { running: 0, queued: 1, paused: 2 } as Record<string, number>;
      list.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3));
    }
    return list;
  }, [jobs, filter]);
}

export function JobList({
  filter,
  compact,
  empty,
  limit,
}: {
  filter: JobFilter;
  compact?: boolean;
  empty: { icon: LucideIcon; title: string; text: string };
  limit?: number;
}) {
  const jobs = useFilteredJobs(filter);
  const live = useJobs((s) => s.live);
  if (jobs.length === 0)
    return (
      <EmptyState icon={empty.icon} title={empty.title}>
        {empty.text}
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-0.5">
      {jobs.slice(0, limit).map((j) => (
        <JobRow key={j.id} job={j} live={live[j.id]} compact={compact} />
      ))}
    </div>
  );
}
