import { useEffect, type RefObject } from "react";
import { useNavigate } from "@tanstack/react-router";
import { NAV } from "./nav";
import { useUi } from "../stores/ui";
import { detectLink } from "../lib/links";
import { currentTrack, usePlayer } from "../stores/player";
import { LIBRARY_KEY, setLiked } from "../hooks/useLibrary";
import { queryClient } from "../lib/queryClient";
import type { LibraryData } from "../lib/ipc";

/** Elements that handle Space/arrows themselves. */
const ownsKeys = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  el.closest("button, a, [role='slider'], [role='option'], [role='tab'], video, audio, [role='menuitem']") !== null;

/** Music player keys (PLAN §6.1). Returns true when handled. */
function playerKey(e: KeyboardEvent): boolean {
  const p = usePlayer.getState();
  const ctrl = e.ctrlKey || e.metaKey;
  const has = p.index >= 0;
  if (!has || e.altKey) return false;
  if (ctrl && e.key === "ArrowRight") p.next();
  else if (ctrl && e.key === "ArrowLeft") p.prev();
  else if (ctrl && e.key === "ArrowUp") p.setVolume(p.volume + 0.05);
  else if (ctrl && e.key === "ArrowDown") p.setVolume(p.volume - 0.05);
  else if (ctrl || isTyping(e.target)) return false;
  else if (e.key === " " && !ownsKeys(e.target)) p.toggle();
  else if (e.key === "ArrowRight" && p.nowPlayingOpen && !ownsKeys(e.target))
    p.seek(Math.min(p.position + 5, p.duration));
  else if (e.key === "ArrowLeft" && p.nowPlayingOpen && !ownsKeys(e.target)) p.seek(Math.max(p.position - 5, 0));
  else if (e.key.toLowerCase() === "m") p.toggleMute();
  else if (e.key.toLowerCase() === "f") p.setNowPlaying(!p.nowPlayingOpen);
  else if (e.key.toLowerCase() === "l") {
    const cur = currentTrack(p);
    const live = queryClient.getQueryData<LibraryData>(LIBRARY_KEY)?.tracks.find((t) => t.id === cur?.id) ?? cur;
    if (live) setLiked([live], !live.liked);
  } else return false;
  e.preventDefault();
  return true;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && el.closest("input, textarea, select, [contenteditable='true']") !== null;

/** App-wide keyboard shortcuts (PLAN §6.1) and "paste a link anywhere". */
export function useGlobalShortcuts(linkRef: RefObject<HTMLInputElement | null>) {
  const navigate = useNavigate();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (playerKey(e)) return;
      const ui = useUi.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
      } else if (ctrl && e.key.toLowerCase() === "l") {
        e.preventDefault();
        linkRef.current?.focus();
      } else if (ctrl && e.key.toLowerCase() === "j") {
        e.preventDefault();
        ui.setActivityOpen(!ui.activityOpen);
      } else if (ctrl && e.key === ",") {
        e.preventDefault();
        navigate({ to: "/settings" });
      } else if (ctrl && /^[1-5]$/.test(e.key)) {
        const item = NAV[Number(e.key) - 1];
        if (item) {
          e.preventDefault();
          navigate({ to: item.to });
        }
      } else if (e.key === "Escape" && ui.activityOpen && !ui.paletteOpen) {
        ui.setActivityOpen(false);
      }
    }

    function onPaste(e: ClipboardEvent) {
      if (isTyping(e.target)) return;
      const text = e.clipboardData?.getData("text") ?? "";
      const d = detectLink(text);
      if (d.kind === "search") return;
      e.preventDefault();
      navigate({ to: "/link", search: { url: d.url ?? d.text } });
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [navigate, linkRef]);
}
