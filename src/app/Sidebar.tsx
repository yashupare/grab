import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { Tooltip } from "radix-ui";
import { NAV, SETTINGS_NAV, type NavItem } from "./nav";
import { useUi } from "../stores/ui";
import { cn } from "../lib/cn";
import { IconButton } from "../components/ui/IconButton";

/** True below 1100px window width, where the sidebar collapses to an icon rail automatically. */
function useNarrow() {
  const query = "(max-width: 1099px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

function NavLink({ item, collapsed, badge }: { item: NavItem; collapsed: boolean; badge?: number }) {
  const Icon = item.icon;
  const link = (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === "/" }}
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-md px-2.5 font-medium text-muted transition-colors",
        "hover:bg-surface-2 hover:text-fg",
        "data-[status=active]:bg-surface-2 data-[status=active]:text-fg",
        collapsed && "justify-center px-0",
      )}
    >
      <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-accent opacity-0 group-data-[status=active]:opacity-100" />
      <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!!badge && (
        <span
          className={cn(
            "ml-auto rounded-full bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-on-accent tabular",
            collapsed && "absolute top-1 right-1 ml-0",
          )}
        >
          {badge}
        </span>
      )}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" sideOffset={8} className="z-50 rounded-md bg-surface-3 px-2.5 py-1.5 text-xs text-fg shadow-(--shadow-float)">
          {item.label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUi();
  const narrow = useNarrow();
  const collapsed = sidebarCollapsed || narrow;

  return (
    <nav
      aria-label="Main"
      className={cn(
        "flex shrink-0 flex-col border-r border-line bg-surface-1 py-3 transition-[width] duration-200 ease-(--ease-soft)",
        collapsed ? "w-[72px] px-3" : "w-[232px] px-3",
      )}
    >
      <div className="flex flex-col gap-0.5">
        {NAV.map((item) => (
          <NavLink key={item.to} item={item} collapsed={collapsed} />
        ))}
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        {!collapsed && (
          <div className="mb-1 flex items-center justify-between pr-1 pl-2.5">
            <span className="text-[12px] font-medium tracking-[0.06em] text-faint uppercase">Playlists</span>
            <IconButton label="New playlist" size="sm" disabled>
              <Plus />
            </IconButton>
          </div>
        )}
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          <NavLink item={{ to: "/music", label: "Liked Songs", icon: Heart }} collapsed={collapsed} />
        </div>
      </div>

      <div className="flex flex-col gap-0.5 border-t border-line pt-3">
        <NavLink item={SETTINGS_NAV} collapsed={collapsed} />
        {!narrow && (
          <button
            onClick={toggleSidebar}
            className={cn(
              "flex h-9 items-center gap-3 rounded-md px-2.5 text-faint transition-colors hover:bg-surface-2 hover:text-fg",
              collapsed && "justify-center px-0",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="size-5" strokeWidth={1.75} /> : <PanelLeftClose className="size-5" strokeWidth={1.75} />}
            {!collapsed && <span className="text-[13px]">Collapse</span>}
          </button>
        )}
      </div>
    </nav>
  );
}
