import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { createPlaylist, nextPlaylistName, usePlaylists } from "../hooks/usePlaylists";
import { Mosaic } from "../components/music/Cover";
import { Heart, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { Tooltip } from "radix-ui";
import { NAV, SETTINGS_NAV, type NavItem } from "./nav";
import { useUi } from "../stores/ui";
import { useJobs } from "../stores/jobs";
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
        <Tooltip.Content
          side="right"
          sideOffset={8}
          className="z-50 rounded-md bg-surface-3 px-2.5 py-1.5 text-xs text-fg shadow-(--shadow-float)"
        >
          {item.label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Liked Songs and playlists: small art + name. */
function SideLink({
  label,
  art,
  collapsed,
  ...link
}: { label: string; art: React.ReactNode; collapsed: boolean } & (
  | { to: "/music"; search: { tab: "liked" }; params?: never }
  | { to: "/music/playlist/$id"; params: { id: string }; search?: never }
)) {
  const a = (
    <Link
      {...link}
      activeOptions={{ includeSearch: true }}
      className={cn(
        "flex h-10 items-center gap-2.5 rounded-md px-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg data-[status=active]:bg-surface-2 data-[status=active]:text-fg",
        collapsed && "justify-center px-0",
      )}
    >
      <span className="size-7 shrink-0 overflow-hidden rounded">{art}</span>
      {!collapsed && <span className="truncate text-[13.5px] font-medium">{label}</span>}
    </Link>
  );
  if (!collapsed) return a;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{a}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={8}
          className="z-50 rounded-md bg-surface-3 px-2.5 py-1.5 text-xs text-fg shadow-(--shadow-float)"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Sidebar() {
  const playlists = usePlaylists();
  const navigate = useNavigate();
  const { sidebarCollapsed, toggleSidebar } = useUi();
  const narrow = useNarrow();
  const collapsed = sidebarCollapsed || narrow;
  const activeCount = useJobs(
    (s) => Object.values(s.jobs).filter((j) => j.status === "running" || j.status === "queued").length,
  );

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
          <NavLink
            key={item.to}
            item={item}
            collapsed={collapsed}
            badge={item.to === "/activity" ? activeCount : undefined}
          />
        ))}
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        {!collapsed && (
          <div className="mb-1 flex items-center justify-between pr-1 pl-2.5">
            <span className="text-[12px] font-medium tracking-[0.06em] text-faint uppercase">Playlists</span>
            <IconButton
              label="New playlist"
              size="sm"
              onClick={async () => {
                const id = await createPlaylist(nextPlaylistName(playlists.data ?? []));
                if (id) navigate({ to: "/music/playlist/$id", params: { id } });
              }}
            >
              <Plus />
            </IconButton>
          </div>
        )}
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          <SideLink
            to="/music"
            search={{ tab: "liked" }}
            label="Liked Songs"
            collapsed={collapsed}
            art={
              <span className="grid size-full place-items-center bg-accent-soft text-accent">
                <Heart className="size-4 fill-current" />
              </span>
            }
          />
          {playlists.data?.map((p) => (
            <SideLink
              key={p.id}
              to="/music/playlist/$id"
              params={{ id: p.id }}
              label={p.name}
              collapsed={collapsed}
              art={<Mosaic covers={p.covers} className="size-full" />}
            />
          ))}
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
            {collapsed ? (
              <PanelLeftOpen className="size-5" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="size-5" strokeWidth={1.75} />
            )}
            {!collapsed && <span className="text-[13px]">Collapse</span>}
          </button>
        )}
      </div>
    </nav>
  );
}
