/** Music player state: queue, current song, transport and volume. The audio itself is played by
 *  `player/engine.ts`, which follows this store. Persisted, so the queue survives a restart. */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Track } from "../lib/ipc";
import {
  append,
  insertNext,
  move,
  nextIndex,
  prevIndex,
  removeAt,
  shuffleOff,
  shuffleOn,
  shuffled,
  type Repeat,
} from "../lib/queue";

export interface QueueContext {
  /** "Global Warming", "Liked Songs", "Songs"… */
  label: string;
  /** Where "Playing from" links to. */
  href?: string;
}

interface PlayerState {
  queue: Track[];
  index: number;
  original: Track[] | null;
  context: QueueContext | null;
  shuffle: boolean;
  repeat: Repeat;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** Seconds of overlap between songs (Settings → Music). */
  crossfade: number;
  /** Bumped whenever the engine must load the current song from the start (or `startAt`). */
  seq: number;
  startAt: number;
  nowPlayingOpen: boolean;
  nowPlayingTab: "next" | "lyrics";

  playList: (tracks: Track[], start?: number, context?: QueueContext, opts?: { shuffle?: boolean }) => void;
  playNext: (tracks: Track[]) => void;
  addToQueue: (tracks: Track[]) => void;
  jump: (index: number) => void;
  toggle: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  /** Called by the engine when a song ends (or a crossfade starts); `load` false = engine already playing it. */
  advance: (load: boolean) => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  removeAt: (i: number) => void;
  move: (from: number, to: number) => void;
  clear: () => void;
  setNowPlaying: (open: boolean, tab?: "next" | "lyrics") => void;
}

/** The engine registers its seek so the store can call it without importing the engine. */
let seekImpl: (t: number) => void = () => {};
export const registerSeek = (fn: (t: number) => void) => {
  seekImpl = fn;
};

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => {
      const load = (patch: Partial<PlayerState>) =>
        set((s) => ({ ...patch, seq: s.seq + 1, startAt: 0, position: 0, playing: true }));
      const q = () => {
        const s = get();
        return { queue: s.queue, index: s.index, original: s.original };
      };
      return {
        queue: [],
        index: -1,
        original: null,
        context: null,
        shuffle: false,
        repeat: "off",
        playing: false,
        position: 0,
        duration: 0,
        volume: 0.8,
        muted: false,
        crossfade: 0,
        seq: 0,
        startAt: 0,
        nowPlayingOpen: false,
        nowPlayingTab: "next",

        playList: (tracks, start = 0, context, opts) => {
          if (!tracks.length) return;
          const shuffle = opts?.shuffle ?? get().shuffle;
          if (shuffle) {
            // Shuffle Play: random first song unless one was clicked.
            const s =
              opts?.shuffle && start === 0
                ? { queue: shuffled(tracks), index: 0, original: [...tracks] }
                : shuffleOn({ queue: tracks, index: start, original: null });
            load({ ...s, shuffle: true, context: context ?? null });
          } else {
            load({
              queue: [...tracks],
              index: Math.min(start, tracks.length - 1),
              original: null,
              context: context ?? null,
            });
          }
        },
        playNext: (tracks) => {
          if (get().index < 0) return get().playList(tracks);
          set(insertNext(q(), tracks));
        },
        addToQueue: (tracks) => {
          if (get().index < 0) return get().playList(tracks);
          set(append(q(), tracks));
        },
        jump: (index) => {
          if (index >= 0 && index < get().queue.length) load({ index });
        },
        toggle: () => {
          const s = get();
          if (s.index < 0) return;
          set({ playing: !s.playing });
        },
        pause: () => set({ playing: false }),
        next: () => {
          const s = get();
          const n = nextIndex(q(), s.repeat, true);
          if (n === null) set({ playing: false });
          else load({ index: n });
        },
        prev: () => {
          const s = get();
          const p = prevIndex(q(), s.repeat, s.position);
          if (p === s.index) {
            seekImpl(0);
            set({ position: 0 });
          } else load({ index: p });
        },
        advance: (shouldLoad) => {
          const s = get();
          const n = nextIndex(q(), s.repeat, false);
          // End of the queue: stop, ready to play the last song again from the start.
          if (n === null) return set({ playing: false, position: 0, startAt: 0, seq: s.seq + 1 });
          if (shouldLoad) load({ index: n });
          else set({ index: n, position: 0 });
        },
        seek: (t) => {
          seekImpl(t);
          set({ position: t });
        },
        setVolume: (v) => set({ volume: Math.min(1, Math.max(0, v)), muted: false }),
        toggleMute: () => set((s) => ({ muted: !s.muted })),
        toggleShuffle: () => {
          const s = get();
          set(s.shuffle ? { ...shuffleOff(q()), shuffle: false } : { ...shuffleOn(q()), shuffle: true });
        },
        cycleRepeat: () => set((s) => ({ repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off" })),
        removeAt: (i) => {
          const s = get();
          const wasCurrent = i === s.index;
          const r = removeAt(q(), i);
          if (wasCurrent && r.queue.length) load(r);
          else if (!r.queue.length) set({ ...r, index: -1, playing: false });
          else set(r);
        },
        move: (from, to) => set(move(q(), from, to)),
        clear: () =>
          set({ queue: [], index: -1, original: null, playing: false, context: null, position: 0, duration: 0 }),
        setNowPlaying: (open, tab) => set((s) => ({ nowPlayingOpen: open, nowPlayingTab: tab ?? s.nowPlayingTab })),
      };
    },
    {
      name: "grab.player",
      partialize: (s) => ({
        queue: s.queue,
        index: s.index,
        original: s.original,
        context: s.context,
        shuffle: s.shuffle,
        repeat: s.repeat,
        volume: s.volume,
        muted: s.muted,
        position: s.position,
      }),
      // After a restart: same song and spot, paused.
      onRehydrateStorage: () => (s) => {
        if (s) usePlayer.setState({ playing: false, startAt: s.position, seq: 1 });
      },
    },
  ),
);

export const currentTrack = (s: { queue: Track[]; index: number }) =>
  s.index >= 0 ? (s.queue[s.index] ?? null) : null;
