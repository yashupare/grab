import { ArrowDownToLine, Clapperboard, House, Music2, Settings, Wrench, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: "/" | "/activity" | "/music" | "/videos" | "/tools" | "/settings";
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

/** Primary navigation. Order matches Ctrl+1…5. */
export const NAV: NavItem[] = [
  { to: "/", label: "Home", icon: House, shortcut: "Ctrl 1" },
  { to: "/activity", label: "Activity", icon: ArrowDownToLine, shortcut: "Ctrl 2" },
  { to: "/music", label: "Music", icon: Music2, shortcut: "Ctrl 3" },
  { to: "/videos", label: "Videos", icon: Clapperboard, shortcut: "Ctrl 4" },
  { to: "/tools", label: "Tools", icon: Wrench, shortcut: "Ctrl 5" },
];

export const SETTINGS_NAV: NavItem = { to: "/settings", label: "Settings", icon: Settings, shortcut: "Ctrl ," };
