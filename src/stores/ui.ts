import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePref = "system" | "dark" | "light";

interface UiState {
  theme: ThemePref;
  sidebarCollapsed: boolean;
  activityOpen: boolean;
  paletteOpen: boolean;
  setTheme: (t: ThemePref) => void;
  toggleSidebar: () => void;
  setActivityOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
}

/** UI preferences. Persisted locally for now; moves to the SQLite settings store in M0b. */
export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: "system",
      sidebarCollapsed: false,
      activityOpen: false,
      paletteOpen: false,
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setActivityOpen: (activityOpen) => set({ activityOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    }),
    {
      name: "grab.ui",
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);

/** Reflect the theme preference on <html>. "system" removes the attribute so CSS follows Windows. */
export function applyTheme(theme: ThemePref) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}
