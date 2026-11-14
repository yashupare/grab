import { useCallback, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { RefreshCw, Repeat2 } from "lucide-react";
import type { ConvertTo, Probe } from "../../lib/ipc";
import { CONVERT_TARGETS, folderOf, isAudioTarget, stem } from "../../lib/tools";
import { formatBytes, formatDuration } from "../../lib/format";
import { Button } from "../../components/ui/Button";
import { DropZone, ExportBar, Panel, ToolPage, useToolsInfo } from "../../components/tools/ToolKit";
import { useSingleFile } from "./TrimTool";
import { cn } from "../../lib/cn";

const route = getRouteApi("/tools/convert");

const AUDIO_EXT: Record<string, string> = { aac: "m4a", opus: "opus", mp3: "mp3", vorbis: "ogg", flac: "flac" };

export function ConvertTool() {
  const { file: fromUrl } = route.useSearch();
  const info = useToolsInfo();
  const [to, setTo] = useState<ConvertTo>("mp4");
  const [name, setName] = useState("");
  const [dir, setDir] = useState<string | null>(null);
  const onLoad = useCallback((p: Probe) => {
    setName(stem(p.path));
    if (!p.video) setTo("mp3");
  }, []);
  const { file, over, pick } = useSingleFile(fromUrl, onLoad);

  // Audio lands in the music library (it shows up in Music); video next to the source.
  const defaultDir = file
    ? isAudioTarget(to)
      ? (info.data?.musicDir ?? folderOf(file.path))
      : folderOf(file.path)
    : "";
  const outDir = dir ?? defaultDir;
  const ext = to === "audio" ? (AUDIO_EXT[file?.audio?.codec ?? ""] ?? "m4a") : to;

  return (
    <ToolPage icon={Repeat2} title="Convert" description="Change the format, or take the audio out of a video.">
      {!file ? (
        <Panel step={1} title="Choose a file">
          <DropZone over={over} onPick={pick} hint="Pick a video or song, or drop it on the window." />
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
              file.video ? `${file.video.width}×${file.video.height} ${file.video.codec.toUpperCase()}` : null,
              file.audio ? `${file.audio.codec.toUpperCase()} audio` : "no audio",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </Panel>
      )}

      {file && (
        <Panel step={2} title="Convert to">
          <div role="radiogroup" aria-label="Format" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CONVERT_TARGETS.map((t) => {
              const unavailable = (t.video && !file.video) || (!t.video && !file.audio);
              return (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={to === t.id}
                  disabled={unavailable}
                  onClick={() => setTo(t.id)}
                  className={cn(
                    "rounded-md border px-3 py-2.5 text-left transition-colors disabled:opacity-40",
                    to === t.id ? "border-accent bg-accent-soft" : "border-line enabled:hover:bg-surface-2",
                  )}
                >
                  <span className="block font-semibold">{t.label}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{t.detail}</span>
                </button>
              );
            })}
          </div>
          {to === "gif" && file.duration > 30 && (
            <p className="mt-3 text-[13px] text-warning">
              GIFs of long videos get very large. Trim it to a few seconds first for a small file.
            </p>
          )}
        </Panel>
      )}

      {file && (
        <ExportBar
          name={name}
          onName={setName}
          dir={outDir}
          onDir={setDir}
          ext={ext}
          note={
            isAudioTarget(to) && dir === null
              ? "Audio is saved to your music folder, so it shows up in Music."
              : undefined
          }
          build={() => ({ tool: "convert", input: file.path, to, outputDir: outDir, name })}
        />
      )}
    </ToolPage>
  );
}
