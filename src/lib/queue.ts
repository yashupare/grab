/** Play-queue operations as pure functions: the player store calls these, tests cover them. */
import type { Track } from "./ipc";

export type Repeat = "off" | "all" | "one";

export interface QueueState {
  queue: Track[];
  /** Position of the current song in `queue`; -1 when nothing is loaded. */
  index: number;
  /** Order before shuffling, so turning shuffle off restores it. */
  original: Track[] | null;
}

/** Fisher–Yates on a copy. `random` is injectable for tests. */
export function shuffled<T>(items: T[], random = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Shuffle on: the current song stays put and becomes first; everything else is shuffled after it. */
export function shuffleOn(s: QueueState, random = Math.random): QueueState {
  if (s.index < 0) return { ...s, original: [...s.queue], queue: shuffled(s.queue, random) };
  const current = s.queue[s.index]!;
  const rest = s.queue.filter((_, i) => i !== s.index);
  return { queue: [current, ...shuffled(rest, random)], index: 0, original: [...s.queue] };
}

/** Shuffle off: back to the original order, still on the current song. Songs added while
 *  shuffled are kept (at the end). */
export function shuffleOff(s: QueueState): QueueState {
  if (!s.original) return s;
  const current = s.queue[s.index];
  const inOriginal = new Set(s.original.map((t) => t.id));
  const queue = [
    ...s.original.filter((t) => s.queue.some((q) => q.id === t.id)),
    ...s.queue.filter((t) => !inOriginal.has(t.id)),
  ];
  const index = current ? queue.findIndex((t) => t.id === current.id) : -1;
  return { queue, index, original: null };
}

/** Index after the current song ends or Next is pressed; null = stop. */
export function nextIndex(s: QueueState, repeat: Repeat, manual: boolean): number | null {
  if (s.queue.length === 0) return null;
  if (repeat === "one" && !manual) return s.index;
  if (s.index + 1 < s.queue.length) return s.index + 1;
  return repeat === "off" ? null : 0;
}

/** Previous: restart the song if more than 3 s in, otherwise go back one (wrapping with repeat all). */
export function prevIndex(s: QueueState, repeat: Repeat, position: number): number {
  if (position > 3) return s.index;
  if (s.index > 0) return s.index - 1;
  return repeat === "all" ? s.queue.length - 1 : 0;
}

/** "Play next": right after the current song. */
export function insertNext(s: QueueState, tracks: Track[]): QueueState {
  const at = s.index + 1;
  return {
    queue: [...s.queue.slice(0, at), ...tracks, ...s.queue.slice(at)],
    index: s.index,
    original: s.original ? [...s.original, ...tracks] : null,
  };
}

export function append(s: QueueState, tracks: Track[]): QueueState {
  return { queue: [...s.queue, ...tracks], index: s.index, original: s.original ? [...s.original, ...tracks] : null };
}

export function removeAt(s: QueueState, i: number): QueueState {
  if (i < 0 || i >= s.queue.length) return s;
  const removed = s.queue[i]!;
  const queue = s.queue.filter((_, k) => k !== i);
  const index = i < s.index ? s.index - 1 : i === s.index ? Math.min(s.index, queue.length - 1) : s.index;
  const original = s.original
    ? s.original.filter((t, k) => !(t.id === removed.id && k === s.original!.indexOf(removed)))
    : null;
  return { queue, index, original };
}

/** Drag-to-reorder in Up next. Keeps the current song current. */
export function move(s: QueueState, from: number, to: number): QueueState {
  if (from === to || from < 0 || to < 0 || from >= s.queue.length || to >= s.queue.length) return s;
  const queue = [...s.queue];
  const [item] = queue.splice(from, 1);
  queue.splice(to, 0, item!);
  let index = s.index;
  if (from === s.index) index = to;
  else if (from < s.index && to >= s.index) index--;
  else if (from > s.index && to <= s.index) index++;
  return { queue, index, original: s.original };
}
