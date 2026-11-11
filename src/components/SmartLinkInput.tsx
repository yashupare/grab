import { forwardRef, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Disc3, Globe, Link2, ListVideo, Search, SquarePlay, UserRound } from "lucide-react";
import { detectLink, LINK_LABELS, type LinkKind } from "../lib/links";
import { cn } from "../lib/cn";
import { Kbd } from "./ui/IconButton";

const KIND_ICON: Record<LinkKind, typeof Link2> = {
  "youtube-video": SquarePlay,
  "youtube-playlist": ListVideo,
  "youtube-channel": UserRound,
  "spotify-track": Disc3,
  "spotify-album": Disc3,
  "spotify-playlist": Disc3,
  web: Globe,
  search: Search,
};

interface Props {
  variant: "bar" | "hero";
  autoFocus?: boolean;
  className?: string;
}

/** The universal input: paste any link (opens the right page) or type to search the library. */
export const SmartLinkInput = forwardRef<HTMLInputElement, Props>(function SmartLinkInput(
  { variant, autoFocus, className },
  ref,
) {
  const [value, setValue] = useState("");
  const navigate = useNavigate();
  const detected = useMemo(() => detectLink(value), [value]);
  const hasText = value.trim().length > 0;
  const Icon = hasText ? KIND_ICON[detected.kind] : Link2;

  function go(text = value) {
    const d = detectLink(text);
    if (!d.text) return;
    if (d.kind === "search") navigate({ to: "/music", search: { q: d.text } });
    else navigate({ to: "/link", search: { url: d.url ?? d.text } });
    setValue("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") go();
    if (e.key === "Escape") {
      setValue("");
      e.currentTarget.blur();
    }
  }

  const hero = variant === "hero";
  return (
    <div
      className={cn(
        "group flex items-center border border-line bg-surface-2 transition-colors focus-within:border-muted",
        hero ? "h-16 gap-3 rounded-lg bg-surface-1 px-5 shadow-sm focus-within:border-accent" : "h-8 gap-2 rounded-md px-2.5",
        className,
      )}
    >
      <Icon
        className={cn(
          "shrink-0 transition-colors",
          hero ? "size-5" : "size-4",
          hasText && detected.kind !== "search" ? "text-accent" : "text-faint",
        )}
        aria-hidden
      />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          // Pasting a link into an empty box opens it straight away.
          const pasted = e.clipboardData.getData("text");
          if (!value && detectLink(pasted).kind !== "search") {
            e.preventDefault();
            go(pasted);
          }
        }}
        autoFocus={autoFocus}
        spellCheck={false}
        placeholder={hero ? "Paste a YouTube, Spotify or other link…" : "Paste a link or search your library…"}
        aria-label="Paste a link or search"
        className={cn(
          "min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-faint",
          hero ? "text-base" : "text-[13px]",
        )}
      />
      {hasText ? (
        <span
          className={cn(
            "shrink-0 rounded-full bg-accent-soft font-medium text-accent",
            hero ? "px-2.5 py-1 text-xs" : "px-2 py-px text-[11px]",
          )}
        >
          {LINK_LABELS[detected.kind]}
        </span>
      ) : (
        !hero && <Kbd className="hidden shrink-0 sm:inline">Ctrl K</Kbd>
      )}
      {hero && (
        <button
          onClick={() => go()}
          disabled={!hasText}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-accent px-4 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          Go <ArrowRight className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
});
