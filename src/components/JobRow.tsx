import { memo, type ReactNode } from "react";
import { AudioLines, Clapperboard, FolderOpen, Pause, Play, RotateCw, Trash2, X } from "lucide-react";
import { api, type Job, type JobProgress } from "../lib/ipc";
import { formatBytes, formatEta, formatRelative, formatSpeed } from "../lib/format";
import { errorMessage } from "../hooks/useSettings";
import { toast } from "../stores/toasts";
import { IconButton } from "./ui/IconButton";
import { cn } from "../lib/cn";

const STEP_LABELS: Record<string, string> = {
  Merger: "Merging video and audio",
  ExtractAudio: "Converting audio",
  FFmpegExtractAudio: "Converting audio",
  EmbedThumbnail: "Adding cover art",
  ThumbnailsConvertor: "Preparing cover art",
  FFmpegMetadata: "Adding details",
  Metadata: "Adding details",
  EmbedSubtitle: "Adding subtitles",
  MoveFiles: "Saving",
};

function statusLine(job: Job, live: JobProgress | undefined): { text: string; tone?: "danger" | "success" } {
  switch (job.status) {
    case "queued":
      return { text: "Waiting" };
    case "paused":
      return { text: `Paused${job.progress > 0 ? ` · ${Math.floor(job.progress * 100)}%` : ""}` };
    case "cancelled":
      return { text: "Cancelled" };
    case "failed":
      return { text: job.error ?? "Failed", tone: "danger" };
    case "done":
      return { text: [formatBytes(job.fileSize), `saved ${formatRelative(job.finishedAt)}`].filter(Boolean).join(" · ") };
    case "running": {
      if (!live) return { text: "Starting…" };
      if (live.stage === "processing") return { text: `${STEP_LABELS[live.step ?? ""] ?? "Finishing"}…` };
      const what = job.kind === "audio" ? "Audio" : live.part >= 2 ? "Audio" : "Video";
      return {
        text: [`${what} · ${Math.floor(live.fraction * 100)}%`, formatSpeed(live.speed), formatEta(live.eta)].filter(Boolean).join(" · "),
      };
    }
  }
}

function act(fn: () => Promise<unknown>) {
  return () => {
    fn().catch((e) => toast.error(errorMessage(e)));
  };
}

export const JobRow = memo(function JobRow({ job, live, compact }: { job: Job; live?: JobProgress; compact?: boolean }) {
  const { text, tone } = statusLine(job, live);
  const fraction = job.status === "running" ? (live?.stage === "processing" ? 1 : (live?.fraction ?? 0)) : job.progress;
  const showBar = job.status === "running" || job.status === "paused";
  const Fallback = job.kind === "audio" ? AudioLines : Clapperboard;

  const actions: ReactNode[] = [];
  if (job.status === "running" || job.status === "queued") {
    actions.push(
      <IconButton key="p" size="sm" label="Pause" onClick={act(() => api.pauseJob(job.id))}>
        <Pause />
      </IconButton>,
      <IconButton key="c" size="sm" label="Cancel" onClick={act(() => api.cancelJob(job.id))}>
        <X />
      </IconButton>,
    );
  } else if (job.status === "paused") {
    actions.push(
      <IconButton key="r" size="sm" label="Resume" onClick={act(() => api.resumeJob(job.id))}>
        <Play />
      </IconButton>,
      <IconButton key="c" size="sm" label="Cancel" onClick={act(() => api.cancelJob(job.id))}>
        <X />
      </IconButton>,
    );
  } else if (job.status === "failed" || job.status === "cancelled") {
    actions.push(
      <IconButton key="r" size="sm" label="Try again" onClick={act(() => api.resumeJob(job.id))}>
        <RotateCw />
      </IconButton>,
      <IconButton key="d" size="sm" label="Remove from list" onClick={act(() => api.removeJob(job.id))}>
        <Trash2 />
      </IconButton>,
    );
  } else if (job.status === "done") {
    actions.push(
      <IconButton key="o" size="sm" label="Open" onClick={act(() => api.openJobFile(job.id))}>
        <Play />
      </IconButton>,
      <IconButton key="f" size="sm" label="Show in folder" onClick={act(() => api.revealJobFile(job.id))}>
        <FolderOpen />
      </IconButton>,
      <IconButton key="d" size="sm" label="Remove from list (keeps the file)" onClick={act(() => api.removeJob(job.id))}>
        <Trash2 />
      </IconButton>,
    );
  }

  return (
    <div className={cn("group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-2", compact ? "" : "px-3")}>
      <div className={cn("relative shrink-0 overflow-hidden rounded-md bg-surface-3", compact ? "h-10 w-[71px]" : "h-12 w-[85px]")}>
        {job.thumbnail ? (
          <img src={job.thumbnail} alt="" loading="lazy" className="size-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <Fallback className="absolute inset-0 m-auto size-5 text-faint" aria-hidden />
        )}
        {job.kind === "audio" && job.thumbnail && (
          <span className="absolute right-1 bottom-1 rounded bg-black/70 p-0.5 text-white">
            <AudioLines className="size-3" aria-hidden />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={job.title}>
          {job.title}
        </div>
        <div className={cn("truncate text-[12.5px] tabular", tone === "danger" ? "text-danger" : "text-muted")} title={text}>
          {text}
        </div>
        {showBar && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                job.status === "paused" ? "bg-faint" : "bg-accent",
                job.status === "running" && live?.stage === "processing" && "animate-pulse",
              )}
              style={{ width: `${Math.max(2, fraction * 100)}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {actions}
      </div>
    </div>
  );
});
