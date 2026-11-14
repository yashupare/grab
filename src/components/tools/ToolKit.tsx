/** Building blocks every tool shares: Add (pick or drop files) → Adjust → Export. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, FilePlus2, FolderOpen, Upload, type LucideIcon } from "lucide-react";
import { api, type ExportRequest, type Probe } from "../../lib/ipc";
import { AUDIO_EXTS, VIDEO_EXTS } from "../../lib/tools";
import { errorMessage } from "../../hooks/useSettings";
import { toast } from "../../stores/toasts";
import { useUi } from "../../stores/ui";
import { Button } from "../ui/Button";
import { cn } from "../../lib/cn";

export function useToolsInfo() {
  return useQuery({ queryKey: ["tools-info"], queryFn: api.toolsInfo, staleTime: 60_000 });
}

export async function pickFiles(multiple: boolean, audio = true): Promise<string[]> {
  const chosen = await openDialog({
    multiple,
    title: multiple ? "Add files" : "Choose a file",
    filters: [
      { name: audio ? "Video and audio" : "Video", extensions: audio ? [...VIDEO_EXTS, ...AUDIO_EXTS] : VIDEO_EXTS },
    ],
  });
  if (!chosen) return [];
  return Array.isArray(chosen) ? chosen : [chosen];
}

/** Files dropped anywhere on the window while this tool is open. */
export function useFileDrop(onPaths: (paths: string[]) => void) {
  const [over, setOver] = useState(false);
  const cb = useRef(onPaths);
  useEffect(() => {
    cb.current = onPaths;
  });
  useEffect(() => {
    if (!isTauri()) return;
    const sub = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "enter" || e.payload.type === "over") setOver(true);
      else if (e.payload.type === "leave") setOver(false);
      else if (e.payload.type === "drop") {
        setOver(false);
        if (e.payload.paths.length) cb.current(e.payload.paths);
      }
    });
    return () => {
      sub.then((un) => un());
    };
  }, []);
  return over;
}

/** Read picked/dropped files; unreadable ones are reported and skipped. */
export async function probeFiles(paths: string[]): Promise<Probe[]> {
  const out: Probe[] = [];
  for (const p of paths) {
    try {
      out.push(...(await api.mediaProbe([p])));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  return out;
}

export function ToolPage({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link
          to="/tools"
          className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          aria-label="All tools"
        >
          <ArrowLeft className="size-[18px]" />
        </Link>
        <div className="grid size-10 place-items-center rounded-md bg-accent-soft text-accent">
          <Icon className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
          <p className="text-muted">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

export function Panel({
  step,
  title,
  children,
  className,
  aside,
}: {
  step: number;
  title: string;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border border-line bg-surface-1", className)}>
      <header className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <span className="grid size-6 place-items-center rounded-full bg-surface-3 text-[12px] font-semibold text-muted tabular">
          {step}
        </span>
        <h2 className="font-semibold">{title}</h2>
        <span className="ml-auto">{aside}</span>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Big empty-state target: click to pick, or drop files on the window. */
export function DropZone({
  multiple,
  over,
  onPick,
  hint,
}: {
  multiple?: boolean;
  over: boolean;
  onPick: () => void;
  hint: string;
}) {
  return (
    <button
      onClick={onPick}
      className={cn(
        "flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
        over ? "border-accent bg-accent-soft" : "border-line hover:border-muted hover:bg-surface-2",
      )}
    >
      {over ? <Upload className="size-7 text-accent" /> : <FilePlus2 className="size-7 text-faint" />}
      <span className="font-semibold">{over ? "Drop to add" : multiple ? "Add videos" : "Choose a file"}</span>
      <span className="text-[13px] text-muted">{hint}</span>
    </button>
  );
}

/** Name, folder, format and the Export button. */
export function ExportBar({
  name,
  onName,
  dir,
  onDir,
  ext,
  note,
  disabled,
  build,
  onDone,
}: {
  name: string;
  onName: (v: string) => void;
  dir: string;
  onDir: (v: string) => void;
  /** Shown after the name, e.g. "mp4". */
  ext: string;
  note?: ReactNode;
  disabled?: string | null;
  build: () => ExportRequest;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const exportNow = useCallback(async () => {
    setBusy(true);
    try {
      await api.exportStart(build());
      toast.success("Exporting… you can keep working.", {
        label: "Show",
        run: () => useUi.getState().setActivityOpen(true),
      });
      onDone?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [build, onDone]);

  async function chooseDir() {
    const chosen = await openDialog({ directory: true, defaultPath: dir, title: "Save in" });
    if (typeof chosen === "string") onDir(chosen);
  }

  return (
    <section className="sticky bottom-0 rounded-lg border border-line bg-surface-1 shadow-(--shadow-float)">
      <div className="flex flex-wrap items-end gap-4 px-5 py-4">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-[12px] font-medium text-muted">File name</span>
          <span className="flex h-9 items-center rounded-md border border-line bg-surface-2 pr-2.5 focus-within:border-muted">
            <input
              value={name}
              onChange={(e) => onName(e.target.value)}
              className="min-w-0 flex-1 bg-transparent px-2.5 outline-none"
              aria-label="File name"
            />
            <span className="text-[13px] text-faint">.{ext}</span>
          </span>
        </label>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[12px] font-medium text-muted">Save in</span>
          <span className="flex h-9 items-center gap-1 rounded-md border border-line bg-surface-2 pl-2.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-muted" title={dir}>
              {dir}
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon={<FolderOpen />}
              onClick={() => chooseDir().catch((e) => toast.error(errorMessage(e)))}
            >
              Change
            </Button>
          </span>
        </div>
        <Button variant="primary" size="lg" loading={busy} disabled={!!disabled || !name.trim()} onClick={exportNow}>
          Export
        </Button>
      </div>
      {(disabled || note) && (
        <p className={cn("border-t border-line px-5 py-2.5 text-[13px]", disabled ? "text-warning" : "text-muted")}>
          {disabled ?? note}
        </p>
      )}
    </section>
  );
}
