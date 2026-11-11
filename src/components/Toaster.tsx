import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useToasts } from "../stores/toasts";
import { cn } from "../lib/cn";

/** Bottom-left toasts (PLAN §6.2). Errors stay longer. */
export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-5 left-5 z-50 flex w-[380px] flex-col gap-2" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = t.kind === "success" ? CheckCircle2 : t.kind === "error" ? XCircle : Info;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              className="pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-surface-2 py-3 pr-2 pl-4 shadow-(--shadow-float)"
            >
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  t.kind === "success" ? "text-success" : t.kind === "error" ? "text-danger" : "text-muted",
                )}
                aria-hidden
              />
              <p className="flex-1 text-[13.5px]">{t.message}</p>
              {t.action && (
                <button
                  className="shrink-0 rounded-md px-2 py-0.5 text-[13px] font-medium text-accent hover:bg-surface-3"
                  onClick={() => {
                    t.action?.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button className="shrink-0 rounded p-1 text-faint hover:text-fg" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                <X className="size-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
