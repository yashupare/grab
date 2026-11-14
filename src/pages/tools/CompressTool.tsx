import { useCallback, useEffect, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, Shrink } from "lucide-react";
import { api, type Probe } from "../../lib/ipc";
import { COMPRESS_PRESETS, folderOf, QUALITY_LABELS, stem } from "../../lib/tools";
import { formatBytes, formatDuration } from "../../lib/format";
import { errorMessage } from "../../hooks/useSettings";
import { Button } from "../../components/ui/Button";
import { DropZone, ExportBar, Panel, ToolPage, useToolsInfo } from "../../components/tools/ToolKit";
import { useSingleFile } from "./TrimTool";
import { cn } from "../../lib/cn";

const route = getRouteApi("/tools/compress");

export function CompressTool() {
  const { file: fromUrl } = route.useSearch();
  const info = useToolsInfo();
  const [preset, setPreset] = useState<string>("whatsapp");
  const [custom, setCustom] = useState("50");
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const onLoad = useCallback((p: Probe) => {
    setName(`${stem(p.path)} (compressed)`);
    setDir(folderOf(p.path));
  }, []);
  const { file, over, pick } = useSingleFile(fromUrl, onLoad);

  const mb = preset === "custom" ? Number(custom) : (COMPRESS_PRESETS.find((p) => p.id === preset)?.mb ?? 16);
  const [debounced, setDebounced] = useState(mb);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(mb), 300);
    return () => clearTimeout(t);
  }, [mb]);
  const est = useQuery({
    queryKey: ["compress-estimate", file?.path, debounced],
    queryFn: () => api.compressEstimate(file!.path, debounced),
    enabled: !!file?.video && debounced > 0,
    retry: false,
  });

  const e = est.data;
  const problem = !file
    ? null
    : !file.video
      ? "Compress works on videos. For audio, use Convert."
      : !(mb >= 0.5)
        ? "Pick a size of at least 0.5 MB."
        : e?.tooSmall
          ? `This video is too long to fit in ${mb} MB. Trim it first, or pick a bigger size.`
          : e?.alreadySmaller
            ? `It's already ${formatBytes(file.size)}, under ${mb} MB. No need to compress.`
            : null;

  return (
    <ToolPage icon={Shrink} title="Compress" description="Shrink a video to a size, like 16 MB for WhatsApp.">
      {!file ? (
        <Panel step={1} title="Choose a video">
          <DropZone over={over} onPick={pick} hint="Pick a video, or drop it on the window." />
        </Panel>
      ) : (
        <Panel
          step={1}
          title={file.name}
          aside={
            <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={pick}>
              Choose another
            </Button>
          }
        >
          <p className="text-muted">
            {[
              formatBytes(file.size),
              formatDuration(file.duration),
              file.video ? `${file.video.width}×${file.video.height}` : "no video",
            ].join(" · ")}
          </p>
        </Panel>
      )}

      {file?.video && (
        <Panel step={2} title="Target size">
          <div
            role="radiogroup"
            aria-label="Target size"
            className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2"
          >
            {[...COMPRESS_PRESETS, { id: "custom", label: "Custom", mb: 0, note: "Your size" }].map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={preset === p.id}
                onClick={() => setPreset(p.id)}
                className={cn(
                  "rounded-md border px-3 py-2.5 text-left transition-colors",
                  preset === p.id ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2",
                )}
              >
                <span className="block font-semibold">{p.label}</span>
                <span className="block text-[13px] text-muted">{p.note}</span>
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <label className="mt-3 flex items-center gap-2">
              <input
                type="number"
                min={0.5}
                step={1}
                value={custom}
                onChange={(ev) => setCustom(ev.target.value)}
                className="h-9 w-28 rounded-md border border-line bg-surface-2 px-2.5 outline-none focus:border-muted"
                aria-label="Size in MB"
              />
              MB
            </label>
          )}
          {e && !problem && (
            <p className="mt-4 flex items-center gap-2 text-[13px] text-muted">
              <CheckCircle2
                className={cn("size-4", e.quality === "low" ? "text-warning" : "text-success")}
                aria-hidden
              />
              About {mb} MB ·{" "}
              {e.height < file.video.height ? `${e.height}p (from ${file.video.height}p)` : `${e.height}p`} ·{" "}
              <span className={cn("font-medium", e.quality === "low" ? "text-warning" : "text-fg")}>
                {QUALITY_LABELS[e.quality]}
              </span>{" "}
              · {formatBytes(file.size)} → {mb} MB ({Math.round((1 - (mb * 1e6) / file.size) * 100)}% smaller)
            </p>
          )}
          {est.isError && <p className="mt-4 text-[13px] text-danger">{errorMessage(est.error)}</p>}
        </Panel>
      )}

      {file && (
        <ExportBar
          name={name}
          onName={setName}
          dir={dir || info.data?.videoDir || ""}
          onDir={setDir}
          ext="mp4"
          note="Two passes for an exact size: takes about as long as the video itself, or less."
          disabled={problem}
          build={() => ({
            tool: "compress",
            input: file.path,
            targetMb: mb,
            outputDir: dir || info.data?.videoDir || "",
            name,
          })}
        />
      )}
    </ToolPage>
  );
}
