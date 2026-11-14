/**
 * Plays the music. Two <audio> "decks" so one song can fade into the next (crossfade); the store
 * says what should play, the engine makes it so and reports time back.
 *
 * Audio runs in the WebView: it plays every format Grab saves (Opus, M4A, MP3) plus FLAC/WAV,
 * and keeps playing while the window is hidden in the tray.
 */
import { useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { currentTrack, registerSeek, usePlayer } from "../stores/player";
import { nextIndex } from "../lib/queue";
import { toast } from "../stores/toasts";
import type { Track } from "../lib/ipc";

const decks: [HTMLAudioElement, HTMLAudioElement] = [new Audio(), new Audio()];
decks.forEach((d) => (d.preload = "auto"));
let active = 0;
/** 0–1 per deck, multiplied with the user's volume (crossfade ramps). */
const gain = [1, 1];
let fading: { timer: number; from: number } | null = null;
let loadedId: number | null = null;
let failures = 0;

const deck = () => decks[active]!;
const other = () => decks[1 - active]!;

function applyVolume() {
  const s = usePlayer.getState();
  const v = s.muted ? 0 : s.volume;
  // Perceived loudness is roughly logarithmic: square the slider for a smoother feel.
  decks.forEach((d, i) => (d.volume = Math.min(1, v * v * gain[i]!)));
}

function stopFade() {
  if (!fading) return;
  window.clearInterval(fading.timer);
  decks[fading.from]!.pause();
  gain[fading.from] = 1;
  fading = null;
}

function load(track: Track | null, play: boolean, startAt: number) {
  stopFade();
  other().pause();
  const d = deck();
  if (!track) {
    d.pause();
    d.removeAttribute("src");
    loadedId = null;
    return;
  }
  gain[active] = 1;
  applyVolume();
  d.src = convertFileSrc(track.path);
  loadedId = track.id;
  if (startAt > 0) {
    d.addEventListener("loadedmetadata", () => (d.currentTime = Math.min(startAt, Math.max(0, d.duration - 1))), {
      once: true,
    });
  }
  if (play) d.play().catch(onPlayError);
}

function onPlayError(e: unknown) {
  if (e instanceof DOMException && e.name === "AbortError") return; // a newer load replaced it
  console.warn("play failed", e);
}

/** Start the next song on the other deck and ramp volumes over `seconds`. */
function startCrossfade(seconds: number) {
  const s = usePlayer.getState();
  const n = nextIndex(s, s.repeat, false);
  if (n === null || n === s.index) return;
  const next = s.queue[n];
  if (!next) return;
  const from = active;
  const to = 1 - active;
  const incoming = decks[to]!;
  gain[to] = 0;
  applyVolume();
  incoming.src = convertFileSrc(next.path);
  incoming.currentTime = 0;
  incoming.play().catch(onPlayError);
  active = to;
  loadedId = next.id;
  usePlayer.getState().advance(false);

  const started = performance.now();
  fading = {
    from,
    timer: window.setInterval(() => {
      const p = Math.min(1, (performance.now() - started) / (seconds * 1000));
      gain[from] = 1 - p;
      gain[to] = p;
      applyVolume();
      if (p >= 1) stopFade();
    }, 50),
  };
}

function wire(d: HTMLAudioElement, i: number) {
  let lastReport = 0;
  d.addEventListener("timeupdate", () => {
    if (i !== active) return;
    const s = usePlayer.getState();
    const now = performance.now();
    if (now - lastReport > 240) {
      lastReport = now;
      usePlayer.setState({ position: d.currentTime, duration: Number.isFinite(d.duration) ? d.duration : 0 });
    }
    const left = d.duration - d.currentTime;
    if (
      s.crossfade > 0 &&
      !fading &&
      s.repeat !== "one" &&
      Number.isFinite(left) &&
      left <= s.crossfade &&
      d.duration > s.crossfade * 2
    ) {
      startCrossfade(Math.min(s.crossfade, left));
    }
  });
  d.addEventListener("loadedmetadata", () => {
    if (i === active) usePlayer.setState({ duration: d.duration });
  });
  d.addEventListener("playing", () => {
    if (i === active) failures = 0;
  });
  d.addEventListener("ended", () => {
    if (i !== active) return;
    const s = usePlayer.getState();
    if (s.repeat === "one") {
      d.currentTime = 0;
      d.play().catch(onPlayError);
    } else s.advance(true);
  });
  d.addEventListener("error", () => {
    if (i !== active || !d.getAttribute("src")) return;
    const t = currentTrack(usePlayer.getState());
    toast.error(`Couldn't play "${t?.title ?? "this song"}". The file may have been moved or deleted.`);
    // Skip it, but don't spin through a whole queue of missing files.
    if (++failures < 3) usePlayer.getState().advance(true);
    else usePlayer.setState({ playing: false });
  });
}
decks.forEach(wire);

registerSeek((t) => {
  stopFade();
  const d = deck();
  if (Number.isFinite(t)) d.currentTime = Math.max(0, t);
});

/** Mount once (app shell). Follows the store: song changes, play/pause, volume. */
export function usePlayerEngine() {
  useEffect(() => {
    // Restore after a restart: load the remembered song paused at its position.
    const s0 = usePlayer.getState();
    load(currentTrack(s0), false, s0.startAt);

    const unsub = usePlayer.subscribe((s, prev) => {
      if (s.seq !== prev.seq) {
        const t = currentTrack(s);
        load(t, s.playing, s.startAt);
      } else if (currentTrack(s)?.id !== loadedId && !fading) {
        // Queue edited around the current song (removed, …): load what's current now.
        load(currentTrack(s), s.playing, 0);
      }
      if (s.playing !== prev.playing) {
        if (s.playing) {
          if (!deck().getAttribute("src")) load(currentTrack(s), true, s.position);
          else deck().play().catch(onPlayError);
          if (fading) decks[fading.from]!.play().catch(onPlayError);
        } else {
          decks.forEach((d) => d.pause());
        }
      }
      if (s.volume !== prev.volume || s.muted !== prev.muted) applyVolume();
    });
    applyVolume();
    return unsub;
  }, []);
}

/** Pause music when a video starts (Videos player). */
export const pauseMusic = () => usePlayer.getState().pause();
