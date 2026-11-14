import { useEffect, useRef, useState } from "react";
import { getRouteApi, Link, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { pauseMusic } from "../player/engine";
import { AlertTriangle, ArrowLeft, ExternalLink, FolderOpen, Scissors, Shrink, Repeat2 } from "lucide-react";
import { api } from "../lib/ipc";
import { formatBytes, formatDuration } from "../lib/format";
import { errorMessage } from "../hooks/useSettings";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { toast } from "../stores/toasts";

const route = getRouteApi("/videos/$id");

/** Resume unless they'd only have a few seconds left. */
export function resumeAt(position: number | null, duration: number): number {
  if (position == null || position < 5 || duration - position < 10) return 0;
  return position;
}

export function VideoPlayerPage() {
  const { id } = route.useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const videos = useQuery({ queryKey: ["videos"], queryFn: api.videoLibrary });
  const video = videos.data?.find((v) => v.jobId === id);
  const el = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const lastSaved = useRef(0);

  function save() {
    const v = el.current;
    if (!v || !video || !Number.isFinite(v.currentTime)) return;
    const duration = Number.isFinite(v.duration) ? v.duration : null;
    api.saveWatchPosition(video.jobId, v.currentTime, duration).catch(() => {});
    lastSaved.current = Date.now();
  }

  // Save where we stopped when leaving the page.
  useEffect(() => {
    const v = el.current;
    return () => {
      if (v && video && Number.isFinite(v.currentTime) && v.currentTime > 0) {
        api
          .saveWatchPosition(video.jobId, v.currentTime, Number.isFinite(v.duration) ? v.duration : null)
          .catch(() => {});
        qc.invalidateQueries({ queryKey: ["videos"] });
      }
    };
  }, [video, qc]);

  if (videos.isPending) return <div className="aspect-video animate-pulse rounded-xl bg-surface-2" />;
  if (!video) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Video not found"
        action={
          <Link to="/videos">
            <Button>Back to Videos</Button>
          </Link>
        }
      >
        It may have been moved or deleted.
      </EmptyState>
    );
  }

  const openExternally = () => api.openJobFile(video.jobId).catch((e) => toast.error(errorMessage(e)));

  return (
    <div className="mx-auto max-w-[1100px]">
      <button
        onClick={() => router.history.back()}
        className="mb-4 inline-flex items-center gap-1.5 text-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back
      </button>

      <div className="overflow-hidden rounded-xl bg-black shadow-(--shadow-float)">
        {failed ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-3 p-6 text-center text-white">
            <AlertTriangle className="size-8 text-warning" aria-hidden />
            <p className="font-medium">This file can't play inside Grab.</p>
            <p className="max-w-md text-[13px] text-white/70">
              Its format isn't supported by the built-in player. Your default video app can play it.
            </p>
            <Button variant="primary" icon={<ExternalLink />} onClick={openExternally}>
              Open in default player
            </Button>
          </div>
        ) : (
          <video
            ref={el}
            src={convertFileSrc(video.path)}
            controls
            autoPlay
            className="aspect-video w-full bg-black"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              const start = resumeAt(video.position, v.duration);
              if (start) v.currentTime = start;
            }}
            onTimeUpdate={() => {
              if (Date.now() - lastSaved.current > 5000) save();
            }}
            onPlay={pauseMusic}
            onPause={save}
            onEnded={save}
            onError={() => setFailed(true)}
          />
        )}
      </div>

      <div className="mt-5 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="selectable text-[20px] leading-[26px] font-semibold tracking-[-0.01em]">{video.title}</h1>
          <p className="mt-1 text-muted">
            {[formatDuration(video.duration), formatBytes(video.size)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {/* Open in Tools */}
          {(
            [
              ["/tools/trim", "Trim", Scissors],
              ["/tools/compress", "Compress", Shrink],
              ["/tools/convert", "Convert", Repeat2],
            ] as const
          ).map(([to, label, Icon]) => (
            <Link key={to} to={to} search={{ file: video.path }}>
              <Button variant="ghost" icon={<Icon />}>
                {label}
              </Button>
            </Link>
          ))}
          <Button
            icon={<FolderOpen />}
            onClick={() => api.revealJobFile(video.jobId).catch((e) => toast.error(errorMessage(e)))}
          >
            Show in folder
          </Button>
          <Button icon={<ExternalLink />} onClick={openExternally}>
            Open in default player
          </Button>
        </div>
      </div>
    </div>
  );
}
