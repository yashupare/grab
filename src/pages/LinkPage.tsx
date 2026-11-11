import { getRouteApi } from "@tanstack/react-router";
import { Construction, Link2 } from "lucide-react";
import { detectLink, LINK_LABELS } from "../lib/links";
import { EmptyState } from "../components/ui/EmptyState";
import { SmartLinkInput } from "../components/SmartLinkInput";

const route = getRouteApi("/link");

/** Placeholder until M1: shows that detection works and where the real page will go. */
export function LinkPage() {
  const { url } = route.useSearch();
  if (!url) {
    return (
      <div className="mx-auto max-w-[720px] pt-[8vh]">
        <EmptyState icon={Link2} title="Paste a link to get started">
          YouTube videos and playlists, Spotify songs, albums and playlists, and links from 1000+ other sites.
        </EmptyState>
        <SmartLinkInput variant="hero" autoFocus />
      </div>
    );
  }
  const d = detectLink(url);
  return (
    <div className="mx-auto max-w-[720px]">
      <div className="rounded-lg border border-line bg-surface-1 p-5">
        <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">{LINK_LABELS[d.kind]}</span>
        <p className="selectable mt-3 font-mono text-[13px] break-all text-muted">{d.url ?? d.text}</p>
      </div>
      <EmptyState icon={Construction} title="Downloading arrives in the next milestone">
        Link detection works. The preview, quality picker and download queue are built in M1.
      </EmptyState>
    </div>
  );
}
