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
import { useJobsSync } from "../stores/jobs";
import { Toaster } from "../components/Toaster";
import { PlayerBar } from "../components/music/PlayerBar";
import { NowPlaying } from "../components/music/NowPlaying";
import { usePlayerEngine } from "../player/engine";
import { useSystemMedia } from "../player/system";
import { useLibrarySync } from "../hooks/useLibrary";
import { usePlayer } from "../stores/player";
import { useSettings } from "../hooks/useSettings";
import { useEffect } from "react";

export function AppShell() {
  const linkRef = useRef<HTMLInputElement>(null);
  useGlobalShortcuts(linkRef);
  useThemeSync();
  useJobsSync();
  usePlayerEngine();
  useSystemMedia();
  useLibrarySync();
  const crossfade = useSettings().data?.crossfade ?? 0;
  useEffect(() => {
    usePlayer.setState({ crossfade });
  }, [crossfade]);

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
        <PlayerBar />
        <NowPlaying />
        <ActivitySheet />
        <CommandPalette />
        <Toaster />
      </div>
    </Tooltip.Provider>
  );
}
