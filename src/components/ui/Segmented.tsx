import { ToggleGroup } from "radix-ui";
import type { LucideIcon } from "lucide-react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  title?: string;
}

/** Single-choice pill group (theme, format, quality…). Keyboard: arrows move, Space selects. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className="inline-flex shrink-0 rounded-md border border-line bg-surface-2 p-0.5"
    >
      {options.map(({ value: v, label: l, icon: Icon, title }) => (
        <ToggleGroup.Item
          key={v}
          value={v}
          title={title}
          className="inline-flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium text-muted transition-colors hover:text-fg data-[state=on]:bg-surface-1 data-[state=on]:text-fg data-[state=on]:shadow-sm"
        >
          {Icon && <Icon className="size-3.5" aria-hidden />}
          {l}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
