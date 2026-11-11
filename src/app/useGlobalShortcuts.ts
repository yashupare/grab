import { useEffect, type RefObject } from "react";
import { useNavigate } from "@tanstack/react-router";
import { NAV } from "./nav";
import { useUi } from "../stores/ui";
import { detectLink } from "../lib/links";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.closest("input, textarea, select, [contenteditable='true']") !== null);

/** App-wide keyboard shortcuts (PLAN §6.1) and "paste a link anywhere". */
export function useGlobalShortcuts(linkRef: RefObject<HTMLInputElement | null>) {
  const navigate = useNavigate();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
