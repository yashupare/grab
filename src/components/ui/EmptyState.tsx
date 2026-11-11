import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

/** Icon + one-line explanation + one primary action. No illustrations (see PLAN §2.5). */
export function EmptyState({ icon: Icon, title, children, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-surface-2 text-muted">
        <Icon className="size-6" aria-hidden />
      </div>
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {children && <p className="max-w-sm text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
