import { useCallback, useEffect, useRef, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Slider } from "radix-ui";
import { Play, RefreshCw, Scissors } from "lucide-react";
import type { Probe } from "../../lib/ipc";
import { stem, folderOf } from "../../lib/tools";
import { formatDuration } from "../../lib/format";
import { errorMessage } from "../../hooks/useSettings";
import { toast } from "../../stores/toasts";
import { pauseMusic } from "../../player/engine";
import { Segmented } from "../../components/ui/Segmented";
import { Button } from "../../components/ui/Button";
import { Kbd } from "../../components/ui/IconButton";
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

const route = getRouteApi("/tools/trim");

/** "1:02.5" with tenths, for precise in/out points. */
function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** Load a file passed in the URL (from Videos → Open in Tools), else let the user pick. */
export function useSingleFile(fromUrl: string | undefined, onLoad: (p: Probe) => void) {
  const [file, setFile] = useState<Probe | null>(null);
  const load = useCallback(
    async (paths: string[]) => {
      const [p] = await probeFiles(paths.slice(0, 1));
      if (p) {
        setFile(p);
        onLoad(p);
      }
    },
    [onLoad],
  );
  const loaded = useRef(false);
  useEffect(() => {
    if (fromUrl && !loaded.current) {
      loaded.current = true;
      void load([fromUrl]);
    }
  }, [fromUrl, load]);
  const over = useFileDrop((p) => void load(p));
  const pick = () =>
    pickFiles(false)
      .then(load)
      .catch((e) => toast.error(errorMessage(e)));
  return { file, over, pick };
}

export function TrimTool() {
  const { file: fromUrl } = route.useSearch();
  const info = useToolsInfo();
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [precise, setPrecise] = useState(false);
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const media = useRef<HTMLMediaElement | null>(null);
  const setMedia = (el: HTMLMediaElement | null) => {
    media.current = el;
  };
  const [now, setNow] = useState(0);
  const stopAt = useRef<number | null>(null);

  const onLoad = useCallback((p: Probe) => {
    setRange([0, p.duration]);
    setName(`${stem(p.path)} (trimmed)`);
    setDir(folderOf(p.path));
  }, []);
  const { file, over, pick } = useSingleFile(fromUrl, onLoad);

  const [start, end] = range;
  const len = Math.max(0, end - start);

  // [ and ] set the in/out points at the playhead; Space plays the selection.
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const t = media.current?.currentTime ?? 0;
      if (e.key === "[") setRange(([, b]) => [Math.min(t, b - 0.1), b]);
      else if (e.key === "]") setRange(([a]) => [a, Math.max(t, a + 0.1)]);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file]);

  function playSelection() {
    const v = media.current;
    if (!v) return;
    pauseMusic();
    v.currentTime = start;
    stopAt.current = end;
    void v.play();
  }

  return (
    <ToolPage icon={Scissors} title="Trim" description="Keep only the part you need.">
      {!file ? (
        <Panel step={1} title="Choose a video or song">
          <DropZone over={over} onPick={pick} hint="Pick a file, or drop it on the window." />
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
          {file.video ? (
            <video
              ref={setMedia}
              src={convertFileSrc(file.path)}
              controls
              className="aspect-video max-h-[42vh] w-full rounded-md bg-black object-contain"
              onPlay={pauseMusic}
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setNow(t);
                if (stopAt.current != null && t >= stopAt.current) {
                  e.currentTarget.pause();
                  stopAt.current = null;
                }
              }}
            />
          ) : (
            <audio
              ref={setMedia}
              src={convertFileSrc(file.path)}
              controls
              className="w-full"
              onPlay={pauseMusic}
              onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
            />
          )}

          <div className="mt-5">
            <Slider.Root
              className="relative flex h-8 touch-none items-center select-none"
              value={range}
              min={0}
              max={file.duration}
              step={0.1}
              minStepsBetweenThumbs={1}
              onValueChange={(v) => setRange([v[0] ?? 0, v[1] ?? file.duration])}
              aria-label="Part to keep"
            >
              <Slider.Track className="relative h-2.5 grow overflow-hidden rounded-full bg-surface-3">
                <Slider.Range className="absolute h-full bg-accent" />
              </Slider.Track>
              <span
                className="pointer-events-none absolute top-0 h-8 w-0.5 bg-fg/70"
                style={{ left: `${(now / Math.max(file.duration, 0.1)) * 100}%` }}
                aria-hidden
              />
              {["Start", "End"].map((l) => (
                <Slider.Thumb
                  key={l}
                  aria-label={l}
                  className="block h-7 w-3.5 rounded-sm border-2 border-accent bg-surface-1 shadow focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                />
              ))}
            </Slider.Root>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
              <span>
                Start <span className="font-medium tabular">{fmt(start)}</span>
              </span>
              <span>
                End <span className="font-medium tabular">{fmt(end)}</span>
              </span>
              <span className="text-muted">
                Keeping <span className="font-medium text-fg tabular">{formatDuration(len)}</span> of{" "}
                {formatDuration(file.duration)}
              </span>
              <Button size="sm" icon={<Play />} onClick={playSelection} className="ml-auto">
                Play selection
              </Button>
            </div>
            <p className="mt-2 text-[12.5px] text-faint">
              <Kbd>[</Kbd> / <Kbd>]</Kbd> set start / end at the playhead · arrow keys nudge a selected handle by 0.1 s
            </p>
          </div>
        </Panel>
      )}

      {file && (
        <Panel step={2} title="How to cut">
          <Segmented<"fast" | "precise">
            label="Cut mode"
            value={precise ? "precise" : "fast"}
            onChange={(v) => setPrecise(v === "precise")}
            options={[
              { value: "fast" as const, label: "Fast cut" },
              ...(file.video ? [{ value: "precise" as const, label: "Precise" }] : []),
            ]}
          />
          <p className="mt-2 text-[13px] text-muted">
            {precise
              ? `Cuts exactly on the frame you picked. Re-encodes the video${info.data ? ` (${info.data.using})` : ""}, so it takes a little longer.`
              : file.video
                ? "Instant and no quality loss. Video cuts land on the nearest keyframe, so the start may move by a second or two."
                : "Instant and exact for audio, no quality loss."}
          </p>
        </Panel>
      )}

      {file && (
        <ExportBar
          name={name}
          onName={setName}
          dir={dir || info.data?.videoDir || ""}
          onDir={setDir}
          ext={precise && file.video ? "mp4" : (file.path.split(".").pop() ?? "mkv").toLowerCase()}
          disabled={len < 0.1 ? "Pick a part to keep." : null}
          build={() => ({
            tool: "trim",
            input: file.path,
            start,
            end,
            precise: precise && !!file.video,
            outputDir: dir || info.data?.videoDir || "",
            name,
          })}
        />
      )}
    </ToolPage>
  );
}
