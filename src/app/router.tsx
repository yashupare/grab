import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppShell } from "./AppShell";
import { HomePage } from "../pages/HomePage";
import { LinkPage } from "../pages/LinkPage";
import { ActivityPage, MusicPage, NotFoundPage, ToolsPage, VideosPage } from "../pages/PlaceholderPages";
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
    validateSearch: (s: Record<string, unknown>) => ({ q: str(s.q) }),
    component: MusicPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/videos", component: VideosPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/tools", component: ToolsPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    validateSearch: (s: Record<string, unknown>): { section?: SettingsSection } =>
      (SETTINGS_SECTIONS as readonly string[]).includes(str(s.section)) ? { section: s.section as SettingsSection } : {},
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
