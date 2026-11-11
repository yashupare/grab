import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownToLine, X } from "lucide-react";
import { useUi } from "../stores/ui";
import { IconButton } from "../components/ui/IconButton";
import { EmptyState } from "../components/ui/EmptyState";

/** Quick view of downloads and exports. Slides over the content without pushing it (PLAN §3). */
export function ActivitySheet() {
  const { activityOpen, setActivityOpen } = useUi();
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
          className="absolute top-11 right-0 bottom-0 z-30 flex w-[360px] flex-col border-l border-line bg-surface-1 shadow-(--shadow-float)"
        >
          <div className="flex h-14 items-center justify-between border-b border-line px-4">
            <h2 className="font-semibold">Activity</h2>
            <div className="flex items-center gap-1">
              <Link to="/activity" onClick={() => setActivityOpen(false)} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-fg">
                Open full page
              </Link>
              <IconButton label="Close" shortcut="Esc" size="sm" onClick={() => setActivityOpen(false)}>
                <X />
              </IconButton>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <EmptyState icon={ArrowDownToLine} title="Nothing here yet">
              Downloads, Spotify imports and exports show up here while they run.
            </EmptyState>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
