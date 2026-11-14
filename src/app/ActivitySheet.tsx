import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownToLine, X } from "lucide-react";
import { useUi } from "../stores/ui";
import { IconButton } from "../components/ui/IconButton";
import { JobList, useFilteredJobs } from "../components/JobList";

/** Quick view of downloads. Slides over the content without pushing it (PLAN §3). */
export function ActivitySheet() {
  const { activityOpen, setActivityOpen } = useUi();
  const recentDone = useFilteredJobs("done").length;
  return (
    <AnimatePresence>
      {activityOpen && (
        <motion.aside
          key="activity"
          aria-label="Activity"
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          className="absolute top-11 right-0 bottom-0 z-30 flex w-[380px] flex-col border-l border-line bg-surface-1 shadow-(--shadow-float)"
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
            <h2 className="font-semibold">Activity</h2>
            <div className="flex items-center gap-1">
              <Link
                to="/activity"
                onClick={() => setActivityOpen(false)}
                className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-fg"
              >
                Open full page
              </Link>
              <IconButton label="Close" shortcut="Esc" size="sm" onClick={() => setActivityOpen(false)}>
                <X />
              </IconButton>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <JobList
              filter="active"
              compact
              empty={{ icon: ArrowDownToLine, title: "Nothing in progress", text: "Paste a link anywhere to download, or export something from Tools." }}
            />
            {recentDone > 0 && (
              <>
                <h3 className="mt-4 mb-1 px-2 text-[12px] font-medium tracking-[0.06em] text-faint uppercase">Recently finished</h3>
                <JobList filter="done" compact limit={8} empty={{ icon: ArrowDownToLine, title: "", text: "" }} />
              </>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
