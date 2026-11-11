import { useRef } from "react";
import { Outlet } from "@tanstack/react-router";
import { Tooltip } from "radix-ui";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { ActivitySheet } from "./ActivitySheet";
import { CommandPalette } from "./CommandPalette";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useThemeSync } from "../hooks/useSettings";
import { SetupGate } from "./SetupScreen";

export function AppShell() {
  const linkRef = useRef<HTMLInputElement>(null);
  useGlobalShortcuts(linkRef);
  useThemeSync();

  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={200}>
      <div className="relative flex h-full flex-col">
        <TitleBar linkRef={linkRef} />
        <div className="flex min-h-0 flex-1">
          <SetupGate>
            <Sidebar />
            <main id="main" className="min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[1200px] px-8 pt-7 pb-16">
                <Outlet />
              </div>
            </main>
          </SetupGate>
        </div>
        <ActivitySheet />
        <CommandPalette />
      </div>
    </Tooltip.Provider>
  );
}
