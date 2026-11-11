import { getRouteApi, Link } from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import { ArrowDownToLine, Clapperboard, FileSearch, Layers, Music2, Repeat2, Scissors, Shrink, type LucideIcon } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";

function PageTabs({ tabs, children }: { tabs: string[]; children: (tab: string) => React.ReactNode }) {
  return (
    <Tabs.Root defaultValue={tabs[0]}>
      <Tabs.List className="mb-2 flex gap-6 border-b border-line" aria-label="Sections">
        {tabs.map((t) => (
          <Tabs.Trigger
            key={t}
            value={t}
            className="-mb-px border-b-2 border-transparent pb-2.5 font-medium text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg"
          >
            {t}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((t) => (
        <Tabs.Content key={t} value={t} className="outline-none">
          {children(t)}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

export function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity" subtitle="Downloads, imports and exports" />
      <PageTabs tabs={["In progress", "Completed", "Failed"]}>
        {(t) => (
          <EmptyState icon={ArrowDownToLine} title={t === "Failed" ? "No failed jobs" : "Nothing here yet"}>
            {t === "In progress" ? "Paste a link anywhere to start a download." : "Finished jobs will be listed here."}
          </EmptyState>
        )}
      </PageTabs>
    </>
  );
}

const musicRoute = getRouteApi("/music");

export function MusicPage() {
  const { q } = musicRoute.useSearch();
  return (
    <>
      <PageHeader title="Music" subtitle={q ? `Results for "${q}"` : "Your songs, albums, artists and playlists"} />
      <PageTabs tabs={["Songs", "Albums", "Artists", "Liked"]}>
        {() =>
          q ? (
            <EmptyState icon={FileSearch} title="No matches">
              The music library is built in M4.
            </EmptyState>
          ) : (
            <EmptyState
              icon={Music2}
              title="Your library is empty"
              action={
                <Link to="/link" search={{ url: "" }}>
                  <Button variant="primary">Import from Spotify</Button>
                </Link>
              }
            >
              Songs you save from Spotify or download as audio show up here.
            </EmptyState>
          )
        }
      </PageTabs>
    </>
  );
}

export function VideosPage() {
  return (
    <>
      <PageHeader title="Videos" subtitle="Everything you've downloaded" />
      <EmptyState icon={Clapperboard} title="No videos yet">
        Downloaded videos appear here, ready to play in the app.
      </EmptyState>
    </>
  );
}

const TOOLS: { name: string; description: string; icon: LucideIcon }[] = [
  { name: "Merge", description: "Join several clips into one video", icon: Layers },
  { name: "Trim", description: "Keep only the part you need", icon: Scissors },
  { name: "Compress", description: "Shrink to a size, like 25 MB for WhatsApp", icon: Shrink },
  { name: "Convert", description: "Change format or extract the audio", icon: Repeat2 },
];

export function ToolsPage() {
  return (
    <>
      <PageHeader title="Tools" subtitle="Edit videos without uploading anything" />
      <div className="grid grid-cols-2 gap-4">
        {TOOLS.map(({ name, description, icon: Icon }) => (
          <div key={name} className="flex items-start gap-4 rounded-lg border border-line bg-surface-1 p-5 opacity-80">
            <div className="grid size-11 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
              <Icon className="size-5" aria-hidden />
            </div>
            <div>
              <div className="flex items-center gap-2 font-semibold">
                {name}
                <span className="rounded-full bg-surface-3 px-2 py-px text-[11px] font-medium text-muted">Coming in M5</span>
              </div>
              <p className="mt-1 text-muted">{description}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function NotFoundPage() {
  return (
    <EmptyState
      icon={FileSearch}
      title="Page not found"
      action={
        <Link to="/">
          <Button>Go home</Button>
        </Link>
      }
    />
  );
}
