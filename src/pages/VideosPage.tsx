import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clapperboard, Play, Search } from "lucide-react";
import { api, type VideoItem } from "../lib/ipc";
import { formatBytes, formatDuration, formatRelative } from "../lib/format";
import { errorMessage } from "../hooks/useSettings";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Segmented } from "../components/ui/Segmented";
import { Button } from "../components/ui/Button";

type Sort = "newest" | "oldest" | "title";

/** Watched fraction (0–1), or null if never played. Near the end counts as watched. */
export function watchedFraction(v: Pick<VideoItem, "position" | "duration">): number | null {
  if (v.position == null || !v.duration) return null;
  return Math.min(1, v.position / v.duration);
}

export function VideosPage() {
  const videos = useQuery({ queryKey: ["videos"], queryFn: api.videoLibrary });
  const [sort, setSort] = useState<Sort>("newest");
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const items = (videos.data ?? []).filter((v) => !q.trim() || v.title.toLowerCase().includes(q.trim().toLowerCase()));
    const by = {
      newest: (a: VideoItem, b: VideoItem) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""),
      oldest: (a: VideoItem, b: VideoItem) => (a.finishedAt ?? "").localeCompare(b.finishedAt ?? ""),
      title: (a: VideoItem, b: VideoItem) => a.title.localeCompare(b.title),
    }[sort];
    return [...items].sort(by);
  }, [videos.data, sort, q]);

  const total = videos.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Videos"
        subtitle={total ? `${total} video${total === 1 ? "" : "s"} downloaded` : "Everything you've downloaded"}
        actions={
          total > 0 && (
            <>
              <label className="flex h-9 w-56 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 focus-within:border-muted">
                <Search className="size-3.5 text-faint" aria-hidden />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search videos"
                  aria-label="Search videos"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
                />
              </label>
              <Segmented<Sort>
                label="Sort"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "newest", label: "Newest" },
                  { value: "oldest", label: "Oldest" },
                  { value: "title", label: "A–Z" },
                ]}
              />
            </>
          )
        }
      />

      {videos.isPending && (
        <div className="grid animate-pulse grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i}>
              <div className="aspect-video rounded-lg bg-surface-2" />
              <div className="mt-3 h-4 w-4/5 rounded bg-surface-2" />
            </div>
          ))}
        </div>
      )}
      {videos.isError && <p className="text-danger">{errorMessage(videos.error)}</p>}
      {videos.data && total === 0 && (
        <EmptyState
          icon={Clapperboard}
          title="No videos yet"
          action={
            <Link to="/link" search={{ url: "" }}>
              <Button variant="primary">Download a video</Button>
            </Link>
          }
        >
          Downloaded videos appear here, ready to play in the app.
        </EmptyState>
      )}
      {videos.data && total > 0 && list.length === 0 && <EmptyState icon={Search} title={`No videos match "${q}"`} />}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-5 gap-y-7">
        {list.map((v) => {
          const watched = watchedFraction(v);
          return (
            <Link key={v.jobId} to="/videos/$id" params={{ id: v.jobId }} className="group block rounded-lg outline-offset-4">
              <div className="relative aspect-video overflow-hidden rounded-lg bg-surface-2">
                {v.thumbnail ? (
                  <img
                    src={v.thumbnail}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <Clapperboard className="absolute inset-0 m-auto size-8 text-faint" aria-hidden />
                )}
                <div className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/30">
                  <span className="grid size-12 scale-90 place-items-center rounded-full bg-white/90 text-black opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100">
                    <Play className="ml-0.5 size-5 fill-current" aria-hidden />
                  </span>
                </div>
                {v.duration != null && (
                  <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-[12px] font-medium text-white tabular">
                    {formatDuration(v.duration)}
                  </span>
                )}
                {watched != null && watched > 0.02 && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
                    <div className="h-full bg-accent" style={{ width: `${watched * 100}%` }} />
                  </div>
                )}
              </div>
              <div className="mt-2.5 line-clamp-2 font-medium leading-snug" title={v.title}>
                {v.title}
              </div>
              <div className="mt-1 text-[12.5px] text-muted">
                {[formatBytes(v.size), formatRelative(v.finishedAt), watched != null && watched >= 0.95 ? "Watched" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
