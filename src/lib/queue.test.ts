import { describe, expect, it } from "vitest";
import type { Track } from "./ipc";
import {
  append,
  insertNext,
  move,
  nextIndex,
  prevIndex,
  removeAt,
  shuffleOff,
  shuffleOn,
  type QueueState,
} from "./queue";

const t = (id: number) => ({ id, title: `T${id}` }) as Track;
const ids = (s: QueueState) => s.queue.map((x) => x.id);
const base = (index = 1): QueueState => ({ queue: [1, 2, 3, 4, 5].map(t), index, original: null });
/** Deterministic "random": always picks the last remaining slot (= no movement in Fisher–Yates). */
const keep = () => 0.9999;

describe("queue", () => {
  it("next and previous follow repeat", () => {
    const end = base(4);
    expect(nextIndex(base(1), "off", false)).toBe(2);
    expect(nextIndex(end, "off", false)).toBeNull();
    expect(nextIndex(end, "all", false)).toBe(0);
    expect(nextIndex(base(2), "one", false)).toBe(2);
    expect(nextIndex(base(2), "one", true)).toBe(3); // Next button still moves on
    expect(prevIndex(base(2), "off", 10)).toBe(2); // restart the song
    expect(prevIndex(base(2), "off", 1)).toBe(1);
    expect(prevIndex(base(0), "all", 1)).toBe(4);
    expect(prevIndex(base(0), "off", 1)).toBe(0);
  });

  it("shuffle keeps the current song first and restores the order after", () => {
    const on = shuffleOn(base(2), Math.random);
    expect(on.index).toBe(0);
    expect(on.queue[0]!.id).toBe(3);
    expect([...ids(on)].sort()).toEqual([1, 2, 3, 4, 5]);
    const moved = { ...on, index: 2 }; // played on a bit
    const off = shuffleOff(moved);
    expect(ids(off)).toEqual([1, 2, 3, 4, 5]);
    expect(off.queue[off.index]!.id).toBe(moved.queue[2]!.id);
    expect(off.original).toBeNull();
  });

  it("songs added while shuffled survive turning shuffle off", () => {
    const on = append(shuffleOn(base(0), keep), [t(9)]);
    expect(ids(shuffleOff(on))).toEqual([1, 2, 3, 4, 5, 9]);
  });

  it("play next / add to queue", () => {
    expect(ids(insertNext(base(1), [t(8), t(9)]))).toEqual([1, 2, 8, 9, 3, 4, 5]);
    expect(ids(append(base(1), [t(8)]))).toEqual([1, 2, 3, 4, 5, 8]);
  });

  it("removing and moving keep the current song current", () => {
    expect(removeAt(base(2), 0)).toMatchObject({ index: 1 });
    expect(ids(removeAt(base(2), 4))).toEqual([1, 2, 3, 4]);
    expect(removeAt(base(4), 4).index).toBe(3);
    const m = move(base(2), 4, 0); // 5 to the front
    expect(ids(m)).toEqual([5, 1, 2, 3, 4]);
    expect(m.queue[m.index]!.id).toBe(3);
    const m2 = move(base(2), 2, 4); // the current song itself
    expect(m2.queue[m2.index]!.id).toBe(3);
    expect(m2.index).toBe(4);
  });
});
