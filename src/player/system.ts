/** Connects the player to Windows: the media overlay / media keys / tray menu send commands here,
 *  and the overlay and tray tooltip are told what's playing. */
import { useEffect } from "react";
import { api, type PlayerCommand } from "../lib/ipc";
import { currentTrack, usePlayer } from "../stores/player";

export function runCommand(c: PlayerCommand) {
  const p = usePlayer.getState();
  switch (c.action) {
    case "toggle":
      return p.toggle();
    case "play":
      return p.index >= 0 && !p.playing ? p.toggle() : undefined;
    case "pause":
      return p.pause();
    case "next":
      return p.next();
    case "previous":
      return p.prev();
    case "stop":
      p.pause();
      return p.seek(0);
    case "seekTo":
      return p.seek(Math.max(0, Math.min(c.position, p.duration || c.position)));
    case "seekBy":
      return p.seek(Math.max(0, Math.min(p.position + c.offset, p.duration || p.position + c.offset)));
  }
}

/** Mount once (app shell). */
export function useSystemMedia() {
  useEffect(() => {
    const sub = api.onPlayerCommand(runCommand);
    let lastKey = "";
    let lastPos = 0;
    const report = () => {
      const s = usePlayer.getState();
      const t = currentTrack(s);
      // Send on song/play-state changes, or a jump in position (seek): not every time tick.
      const key = t ? `${t.id}|${s.playing}|${s.duration > 0}` : "none";
      const jumped = Math.abs(s.position - lastPos) > 3;
      lastPos = s.position;
      if (key === lastKey && !jumped) return;
      lastKey = key;
      api
        .mediaUpdate(
          t
            ? {
                title: t.title,
                artist: t.artist,
                album: t.album,
                cover: t.cover && !t.cover.startsWith("http") ? t.cover : null,
                playing: s.playing,
                position: s.position,
                duration: s.duration || t.duration,
              }
            : null,
        )
        .catch(() => {});
    };
    report();
    const unsub = usePlayer.subscribe(report);
    return () => {
      unsub();
      sub.then((un) => un());
    };
  }, []);
}
