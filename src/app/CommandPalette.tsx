import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useUpdateSettings } from "../hooks/useSettings";
import type { Theme } from "../lib/ipc";
import { useNavigate } from "@tanstack/react-router";
import { Dialog } from "radix-ui";
import { ArrowRight, Moon, PanelRight, Search, Sun, SunMoon } from "lucide-react";
import { NAV, SETTINGS_NAV } from "./nav";
import { useUi } from "../stores/ui";
import { detectLink, LINK_LABELS } from "../lib/links";
import { cn } from "../lib/cn";
import { Kbd } from "../components/ui/IconButton";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setTheme: setThemeLocal, setActivityOpen } = useUi();
  const { mutate: saveSettings } = useUpdateSettings();
  const setTheme = useCallback(
    (theme: Theme) => {
      setThemeLocal(theme);
      saveSettings({ theme });
    },
    [setThemeLocal, saveSettings],
  );
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const commands = useMemo<Command[]>(() => {
    const close = (fn: () => void) => () => {
      setPaletteOpen(false);
      fn();
    };
    const list: Command[] = [];
    const d = detectLink(query);
    if (d.kind !== "search") {
      list.push({ id: "open-link", label: `Open ${LINK_LABELS[d.kind].toLowerCase()}`, hint: d.url, icon: <ArrowRight />, run: close(() => navigate({ to: "/link", search: { url: d.url ?? d.text } })) });
    } else if (query.trim()) {
      list.push({ id: "search", label: `Search library for "${query.trim()}"`, icon: <Search />, run: close(() => navigate({ to: "/music", search: { q: query.trim() } })) });
    }
    for (const item of [...NAV, SETTINGS_NAV]) {
      const Icon = item.icon;
      list.push({ id: `nav-${item.to}`, label: `Go to ${item.label}`, hint: item.shortcut, icon: <Icon />, run: close(() => navigate({ to: item.to })) });
    }
    list.push(
      { id: "activity", label: "Show activity", hint: "Ctrl J", icon: <PanelRight />, run: close(() => setActivityOpen(true)) },
      { id: "theme-system", label: "Theme: follow Windows", icon: <SunMoon />, run: close(() => setTheme("system")) },
      { id: "theme-dark", label: "Theme: dark", icon: <Moon />, run: close(() => setTheme("dark")) },
      { id: "theme-light", label: "Theme: light", icon: <Sun />, run: close(() => setTheme("light")) },
    );
    const q = query.trim().toLowerCase();
    return d.kind !== "search" || !q ? list : list.filter((c, i) => i === 0 || c.label.toLowerCase().includes(q));
  }, [query, navigate, setPaletteOpen, setTheme, setActivityOpen]);

  const active = Math.min(index, commands.length - 1);

  return (
    <Dialog.Root
      open={paletteOpen}
      onOpenChange={(o) => {
        setPaletteOpen(o);
        if (!o) {
          setQuery("");
          setIndex(0);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-[14vh] left-1/2 z-50 w-[min(640px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface-1 shadow-(--shadow-float)"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 text-faint" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setIndex((i) => Math.min(i + 1, commands.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") commands[active]?.run();
              }}
              placeholder="Type a command, paste a link, or search…"
              className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={commands[active] ? `cmd-${commands[active].id}` : undefined}
            />
            <Kbd>Esc</Kbd>
          </div>
          <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
            {commands.map((c, i) => (
              <li
                key={c.id}
                id={`cmd-${c.id}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setIndex(i)}
                onClick={c.run}
                className={cn(
                  "flex h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-muted [&_svg]:size-4",
                  i === active && "bg-surface-2 text-fg",
                )}
              >
                {c.icon}
                <span className="flex-1 truncate">{c.label}</span>
                {c.hint && <span className="max-w-[45%] truncate text-xs text-faint">{c.hint}</span>}
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
