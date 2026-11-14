import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Clapperboard, GripVertical, Layers, Plus, X, Zap } from "lucide-react";
import { api, type MergeSize, type Probe } from "../../lib/ipc";
import { canFastJoin, encodeEstimate, joinDifference, stem } from "../../lib/tools";
import { formatBytes, formatDuration } from "../../lib/format";
import { errorMessage } from "../../hooks/useSettings";
import { toast } from "../../stores/toasts";
import { Segmented } from "../../components/ui/Segmented";
import { Button } from "../../components/ui/Button";
import {
  DropZone,
  ExportBar,
  Panel,
  pickFiles,
  probeFiles,
  ToolPage,
  useFileDrop,
  useToolsInfo,
} from "../../components/tools/ToolKit";
import { cn } from "../../lib/cn";

function Thumb({ clip }: { clip: Probe }) {
  const q = useQuery({
    queryKey: ["thumb", clip.path],
    queryFn: () => api.mediaThumbnail(clip.path, Math.min(1, clip.duration / 2)),
    enabled: !!clip.video,
    staleTime: Infinity,
    retry: false,
  });
  return (
    <span className="grid h-[54px] w-24 shrink-0 place-items-center overflow-hidden rounded bg-surface-3 text-faint">
      {q.data ? (
        <img src={convertFileSrc(q.data)} alt="" className="size-full object-cover" />
      ) : (
        <Clapperboard className="size-5" />
      )}
    </span>
  );
}

export function MergeTool() {
  const info = useToolsInfo();
  const [clips, setClips] = useState<Probe[]>([]);
  const [size, setSize] = useState<MergeSize>("first");
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const [drag, setDrag] = useState<number | null>(null);

  const add = useCallback(async (paths: string[]) => {
    const probes = await probeFiles(paths);
    if (!probes.length) return;
    setClips((c) => {
      if (!c.length) setName(`${stem(probes[0]!.path)} (merged)`);
      return [...c, ...probes];
    });
  }, []);
  const over = useFileDrop((p) => void add(p));
  const pick = () =>
    pickFiles(true)
      .then(add)
      .catch((e) => toast.error(errorMessage(e)));

  const fast = canFastJoin(clips, size);
  const total = clips.reduce((s, c) => s + c.duration, 0);
  const reason =
    clips.length > 1
      ? clips
          .slice(1)
          .map((c) => joinDifference(clips[0]!, c))
          .find(Boolean)
      : null;
  const outDir = dir || info.data?.videoDir || "";

  function move(from: number, to: number) {
    setClips((c) => {
      const n = [...c];
      const [x] = n.splice(from, 1);
      n.splice(to, 0, x!);
      return n;
    });
  }

  return (
    <ToolPage icon={Layers} title="Merge" description="Join several clips into one video.">
      <Panel
        step={1}
        title="Add clips"
        aside={
          clips.length > 0 && (
            <Button size="sm" icon={<Plus />} onClick={pick}>
              Add more
            </Button>
          )
        }
      >
        {clips.length === 0 ? (
          <DropZone
            multiple
            over={over}
            onPick={pick}
            hint="Pick two or more videos, or drop them on the window. Drag to change the order."
          />
        ) : (
          <ol
            className={cn("flex flex-col gap-1.5 rounded-md", over && "ring-2 ring-accent")}
            aria-label="Clips in order"
          >
            {clips.map((c, i) => (
              <li
                key={`${c.path}-${i}`}
                draggable
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (drag !== null && drag !== i) {
                    move(drag, i);
                    setDrag(i);
                  }
                }}
                onDragEnd={() => setDrag(null)}
                className={cn(
                  "group flex items-center gap-3 rounded-md border border-line bg-surface-2 p-2 pr-3",
                  drag === i && "opacity-50",
                )}
              >
                <GripVertical className="size-4 cursor-grab text-faint" aria-hidden />
                <span className="w-5 text-center text-[13px] text-faint tabular">{i + 1}</span>
                <Thumb clip={c} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium" title={c.path}>
                    {c.name}
                  </span>
                  <span className="block text-[13px] text-muted">
                    {[
                      formatDuration(c.duration),
                      c.video ? `${c.video.width}×${c.video.height}` : "audio only",
                      c.video?.codec.toUpperCase(),
                      formatBytes(c.size),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <button
                  className="grid size-8 place-items-center rounded text-muted hover:bg-surface-3 hover:text-fg"
                  onClick={() => setClips((x) => x.filter((_, k) => k !== i))}
                  aria-label={`Remove ${c.name}`}
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel step={2} title="Output">
        <div className="flex flex-wrap items-center gap-4">
          <Segmented<MergeSize>
            label="Output size"
            value={size}
            onChange={setSize}
            options={[
              { value: "first", label: "Match first clip" },
              { value: "p1080", label: "1080p" },
              { value: "p720", label: "720p" },
            ]}
          />
          {clips.length > 1 && (
            <p className="flex items-center gap-1.5 text-[13px] text-muted">
              {fast ? (
                <>
                  <Zap className="size-4 text-success" aria-hidden /> Fast join: the clips match, so nothing is
                  re-encoded. Takes seconds, no quality loss.
                </>
              ) : (
                <>
                  Will re-encode ({reason ?? "a new size was picked"}):{" "}
                  {encodeEstimate(
                    total,
                    (info.data?.hardware.length ?? 0) > 0 && info.data?.using !== "Software (x264)",
                  )}
                  {info.data && ` with ${info.data.using}`}.
                </>
              )}
            </p>
          )}
        </div>
      </Panel>

      <ExportBar
        name={name}
        onName={setName}
        dir={outDir}
        onDir={setDir}
        ext={
          fast
            ? clips[0]?.video
              ? ["h264", "hevc", "av1"].includes(clips[0].video.codec)
                ? "mp4"
                : "mkv"
              : "m4a"
            : clips.some((c) => c.video)
              ? "mp4"
              : "m4a"
        }
        note={clips.length > 1 ? `${clips.length} clips · ${formatDuration(total)} in total` : undefined}
        disabled={clips.length < 2 ? "Add at least two clips." : null}
        build={() => ({ tool: "merge", inputs: clips.map((c) => c.path), size, outputDir: outDir, name })}
      />
    </ToolPage>
  );
}
