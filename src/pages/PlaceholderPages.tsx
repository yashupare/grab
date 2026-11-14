import { Link } from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import { ArrowDownToLine, CheckCircle2, FileSearch, Layers, Repeat2, Scissors, Shrink } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { JobList } from "../components/JobList";
import { api } from "../lib/ipc";
import { toast } from "../stores/toasts";
import { errorMessage } from "../hooks/useSettings";

/** Tab ids end up in id/aria-controls attributes, which can't contain spaces. */
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function PageTabs({ tabs, children }: { tabs: string[]; children: (tab: string) => React.ReactNode }) {
  return (
    <Tabs.Root defaultValue={slug(tabs[0] ?? "")}>
      <Tabs.List className="mb-2 flex gap-6 border-b border-line" aria-label="Sections">
        {tabs.map((t) => (
          <Tabs.Trigger
            key={t}
            value={slug(t)}
            className="-mb-px border-b-2 border-transparent pb-2.5 font-medium text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg"
          >
            {t}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((t) => (
        <Tabs.Content key={t} value={slug(t)} className="outline-none">
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
                  title: "Nothing in progress",
                  text: "Paste a link anywhere to download, or export something from Tools.",
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

const TOOLS = [
  { to: "/tools/merge", name: "Merge", description: "Join several clips into one video", icon: Layers },
  { to: "/tools/trim", name: "Trim", description: "Keep only the part you need", icon: Scissors },
  { to: "/tools/compress", name: "Compress", description: "Shrink to a size, like 16 MB for WhatsApp", icon: Shrink },
  { to: "/tools/convert", name: "Convert", description: "Change format or extract the audio", icon: Repeat2 },
] as const;

export function ToolsPage() {
  return (
    <>
      <PageHeader title="Tools" subtitle="Edit videos on this PC. Nothing is uploaded." />
      <div className="grid grid-cols-2 gap-4">
        {TOOLS.map(({ to, name, description, icon: Icon }) => (
          <Link
            key={name}
            to={to}
            className="group flex items-start gap-4 rounded-lg border border-line bg-surface-1 p-5 transition-colors hover:border-muted hover:bg-surface-2"
          >
            <div className="grid size-11 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
              <Icon className="size-5" aria-hidden />
            </div>
            <div>
              <div className="font-semibold group-hover:underline">{name}</div>
              <p className="mt-1 text-muted">{description}</p>
            </div>
          </Link>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-faint">
        Tip: drop files anywhere on the window once a tool is open. Exports run in Activity, so you can keep working.
      </p>
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
