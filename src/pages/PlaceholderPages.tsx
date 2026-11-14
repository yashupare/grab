import { Link } from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import {
  ArrowDownToLine,
  CheckCircle2,
  FileSearch,
  Layers,
  Repeat2,
  Scissors,
  Shrink,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { JobList } from "../components/JobList";
import { api } from "../lib/ipc";
import { toast } from "../stores/toasts";
import { errorMessage } from "../hooks/useSettings";

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
  const clear = () =>
    api
      .clearFinishedJobs()
      .then((n) =>
        toast.info(n ? `Cleared ${n} finished item${n === 1 ? "" : "s"}. Files are kept.` : "Nothing to clear."),
      )
      .catch((e) => toast.error(errorMessage(e)));
  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Downloads, imports and exports"
        actions={
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear finished
          </Button>
        }
      />
      <PageTabs tabs={["In progress", "Completed", "Failed"]}>
        {(t) => (
          <div className="pt-2">
            {t === "In progress" && (
              <JobList
                filter="active"
                empty={{
                  icon: ArrowDownToLine,
                  title: "Nothing downloading",
                  text: "Paste a link anywhere to start a download.",
                }}
              />
            )}
            {t === "Completed" && (
              <JobList
                filter="done"
                empty={{
                  icon: CheckCircle2,
                  title: "Nothing finished yet",
                  text: "Finished downloads are listed here.",
                }}
              />
            )}
            {t === "Failed" && (
              <JobList
                filter="failed"
                empty={{
                  icon: CheckCircle2,
                  title: "No problems",
                  text: "Failed or cancelled downloads show up here.",
                }}
              />
            )}
          </div>
        )}
      </PageTabs>
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
                <span className="rounded-full bg-surface-3 px-2 py-px text-[11px] font-medium text-muted">
                  Coming in M5
                </span>
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
