import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip } from "radix-ui";
import { cn } from "../../lib/cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: used as the accessible name and the tooltip. */
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: "sm" | "md";
  children: ReactNode;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, size = "md", className, children, tooltipSide = "bottom", ...rest },
  ref,
) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          ref={ref}
          aria-label={label}
          className={cn(
            "inline-flex items-center justify-center rounded-md text-muted transition-colors duration-150",
            "hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40",
            size === "md" ? "size-9 [&_svg]:size-[18px]" : "size-7 [&_svg]:size-4",
            active && "text-accent hover:text-accent",
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={tooltipSide}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-md bg-surface-3 px-2.5 py-1.5 text-xs text-fg shadow-(--shadow-float)"
        >
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
});

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "rounded border border-line bg-surface-2 px-1.5 py-px font-sans text-[11px] font-medium text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
