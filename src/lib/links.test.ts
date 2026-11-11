import { describe, expect, it } from "vitest";
import { detectLink } from "./links";

describe("detectLink", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube-video", "dQw4w9WgXcQ"],
    ["youtube.com/watch?v=dQw4w9WgXcQ&t=42", "youtube-video", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "youtube-video", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/abcdEFGh123", "youtube-video", "abcdEFGh123"],
    ["https://music.youtube.com/watch?v=WNxAvQNsJuM", "youtube-video", "WNxAvQNsJuM"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123", "youtube-video", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/playlist?list=PLabc_123", "youtube-playlist", "PLabc_123"],
    ["https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x", "spotify-playlist", "37i9dQZF1DXcBWIGoYBM5M"],
    ["https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy", "spotify-album", "4aawyAB9vmqN3uQ7FjRGTy"],
    ["open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT", "spotify-track", "4cOdK2wGLETKBW3PvgPWqT"],
  ])("%s → %s", (input, kind, id) => {
    const r = detectLink(input);
    expect(r.kind).toBe(kind);
    expect(r.id).toBe(id);
  });

  it("recognises channels", () => {
    expect(detectLink("https://www.youtube.com/@SomeChannel").kind).toBe("youtube-channel");
  });

  it("treats other sites as generic web links", () => {
    expect(detectLink("https://vimeo.com/123456").kind).toBe("web");
  });

  it.each(["daft punk", "", "   ", "not-a-url", "ftp://example.com/x"])("'%s' is a search", (input) => {
    expect(detectLink(input).kind).toBe("search");
  });

  it("normalises Spotify URLs (drops tracking params and locale)", () => {
    expect(detectLink("https://open.spotify.com/intl-fr/track/abc123?si=zzz").url).toBe(
      "https://open.spotify.com/track/abc123",
    );
  });
});
