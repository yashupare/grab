/** Works out what the user pasted into the smart box. Pure function, no I/O. */

export type LinkKind =
  | "youtube-video"
  | "youtube-playlist"
  | "youtube-channel"
  | "spotify-track"
  | "spotify-album"
  | "spotify-playlist"
  | "web" // any other http(s) link: yt-dlp may still support it
  | "search"; // not a link: search the library

export interface DetectedLink {
  kind: LinkKind;
  /** Normalised URL (absent for "search"). */
  url?: string;
  /** Platform id (video id, playlist id, Spotify id) when known. */
  id?: string;
  /** The original text, trimmed. */
  text: string;
}

const YT_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com"]);

function parseUrl(text: string): URL | null {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const u = new URL(candidate);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u;
  } catch {
    return null;
  }
}

export function detectLink(input: string): DetectedLink {
  const text = input.trim();
  if (!text || /\s/.test(text)) return { kind: "search", text };

  const u = parseUrl(text);
  if (!u) return { kind: "search", text };
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  if (YT_HOSTS.has(host)) {
    const list = u.searchParams.get("list");
    let videoId: string | null = null;
    if (host === "youtu.be") videoId = u.pathname.slice(1).split("/")[0] || null;
    else if (u.pathname === "/watch") videoId = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/);
      if (m) videoId = m[1] ?? null;
    }
    // A watch link inside a playlist is treated as the single video; a bare /playlist link is the list.
    if (videoId) return { kind: "youtube-video", url: u.toString(), id: videoId, text };
    if (list) return { kind: "youtube-playlist", url: u.toString(), id: list, text };
    if (/^\/(@[\w.-]+|channel\/|c\/|user\/)/.test(u.pathname)) return { kind: "youtube-channel", url: u.toString(), text };
    return { kind: "web", url: u.toString(), text };
  }

  if (host === "open.spotify.com") {
    const m = u.pathname.match(/^\/(?:intl-[\w-]+\/)?(track|album|playlist)\/([A-Za-z0-9]+)/);
    if (m) {
      const kind = `spotify-${m[1]}` as LinkKind;
      return { kind, url: `https://open.spotify.com/${m[1]}/${m[2]}`, id: m[2], text };
    }
  }

  return { kind: "web", url: u.toString(), text };
}

export const LINK_LABELS: Record<LinkKind, string> = {
  "youtube-video": "YouTube video",
  "youtube-playlist": "YouTube playlist",
  "youtube-channel": "YouTube channel",
  "spotify-track": "Spotify song",
  "spotify-album": "Spotify album",
  "spotify-playlist": "Spotify playlist",
  web: "Link",
  search: "Search",
};
