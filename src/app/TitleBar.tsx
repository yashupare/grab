import { useEffect, useState, type RefObject } from "react";
import { useRouter } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, ChevronRight, Minus, PanelRight, Square, X } from "lucide-react";
import { SmartLinkInput } from "../components/SmartLinkInput";
import { IconButton } from "../components/ui/IconButton";
import { useUi } from "../stores/ui";
import { cn } from "../lib/cn";

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2 select-none" data-tauri-drag-region>
      <div className="grid size-6 place-items-center rounded-md bg-accent text-on-accent" aria-hidden>
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M6 19.5h12" />
        </svg>
      </div>
      {!compact && <span className="text-[15px] font-semibold tracking-[-0.02em]" data-tauri-drag-region>grab</span>}
    </div>
  );
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setMaximized);
    win.onResized(() => win.isMaximized().then(setMaximized)).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);
  const win = getCurrentWindow();
  const btn = "grid h-11 w-[46px] place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-fg [&_svg]:size-4";
  return (
    <div className="flex self-stretch">
      <button className={btn} aria-label="Minimise" onClick={() => win.minimize()}>
        <Minus strokeWidth={1.5} />
      </button>
      <button className={btn} aria-label={maximized ? "Restore" : "Maximise"} onClick={() => win.toggleMaximize()}>
        {maximized ? (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
            <rect x="3.5" y="5.5" width="7" height="7" rx="1" />
            <path d="M5.5 5.5V4.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
          </svg>
        ) : (
          <Square strokeWidth={1.5} className="!size-3.5" />
        )}
      </button>
      <button className={cn(btn, "hover:bg-[#c42b1c] hover:text-white")} aria-label="Close" onClick={() => win.close()}>
        <X strokeWidth={1.5} />
      </button>
    </div>
  );
}

export function TitleBar({ linkRef }: { linkRef: RefObject<HTMLInputElement | null> }) {
  const router = useRouter();
  const { activityOpen, setActivityOpen } = useUi();
  return (
    <div
      className="flex h-11 items-center gap-3 border-b border-line bg-surface-1 pl-4"
      data-tauri-drag-region
    >
      <Logo />
      <div className="ml-2 flex items-center gap-0.5">
        <IconButton label="Back" size="sm" onClick={() => router.history.back()}>
          <ChevronLeft />
        </IconButton>
        <IconButton label="Forward" size="sm" onClick={() => router.history.forward()}>
          <ChevronRight />
        </IconButton>
      </div>
      <div className="flex flex-1 justify-center" data-tauri-drag-region>
        <SmartLinkInput ref={linkRef} variant="bar" className="w-full max-w-[560px]" />
      </div>
      <IconButton
        label="Activity"
        shortcut="Ctrl J"
        size="sm"
        active={activityOpen}
        onClick={() => setActivityOpen(!activityOpen)}
      >
        <PanelRight />
      </IconButton>
      {isTauri() ? <WindowControls /> : <div className="w-3" />}
    </div>
  );
}
