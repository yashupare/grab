import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppShell } from "./AppShell";
import { HomePage } from "../pages/HomePage";
import { LinkPage } from "../pages/LinkPage";
import { ActivityPage, NotFoundPage, ToolsPage } from "../pages/PlaceholderPages";
import { MUSIC_TABS, MusicPage, type MusicTab } from "../pages/music/MusicPage";
import { AlbumPage, ArtistPage, PlaylistPage } from "../pages/music/CollectionPages";
import { VideosPage } from "../pages/VideosPage";
import { MergeTool } from "../pages/tools/MergeTool";
import { TrimTool } from "../pages/tools/TrimTool";
import { CompressTool } from "../pages/tools/CompressTool";
import { ConvertTool } from "../pages/tools/ConvertTool";
import { VideoPlayerPage } from "../pages/VideoPlayerPage";
import { SETTINGS_SECTIONS, SettingsPage, type SettingsSection } from "../pages/SettingsPage";
import { ErrorPage } from "../pages/ErrorPage";

const str = (v: unknown) => (typeof v === "string" ? v : "");

const rootRoute = createRootRoute({ component: AppShell, notFoundComponent: NotFoundPage });

// Page crashes render inside the shell, so navigation keeps working.
const pageDefaults = { errorComponent: ErrorPage } as const;

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/link",
    validateSearch: (s: Record<string, unknown>) => ({ url: str(s.url) }),
    component: LinkPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/activity", component: ActivityPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/music",
    validateSearch: (s: Record<string, unknown>): { q?: string; tab?: MusicTab } => ({
      q: str(s.q) || undefined,
      tab: (MUSIC_TABS as readonly string[]).includes(str(s.tab)) ? (s.tab as MusicTab) : undefined,
    }),
    component: MusicPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/music/album/$key", component: AlbumPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/music/artist/$key", component: ArtistPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/music/playlist/$id", component: PlaylistPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/videos", component: VideosPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/videos/$id", component: VideoPlayerPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/tools", component: ToolsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/tools/merge", component: MergeTool }),
  ...(["trim", "compress", "convert"] as const).map((t) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: `/tools/${t}`,
      // ?file= opens a file right away (Videos → Open in Tools).
      validateSearch: (s: Record<string, unknown>): { file?: string } => (str(s.file) ? { file: str(s.file) } : {}),
      component: { trim: TrimTool, compress: CompressTool, convert: ConvertTool }[t],
    }),
  ),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    validateSearch: (s: Record<string, unknown>): { section?: SettingsSection } =>
      (SETTINGS_SECTIONS as readonly string[]).includes(str(s.section))
        ? { section: s.section as SettingsSection }
        : {},
    component: SettingsPage,
  }),
] as const;

export const router = createRouter({
  routeTree: rootRoute.addChildren(routes),
  defaultErrorComponent: pageDefaults.errorComponent,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
