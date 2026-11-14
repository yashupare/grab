import { describe, expect, it } from "vitest";
import type { Track } from "./ipc";
import { buildAlbums, buildArtists, filterTracks, sortTracks } from "./library";

let n = 0;
const track = (p: Partial<Track>): Track => ({
  id: ++n,
  path: `C:/m/${n}.opus`,
  title: `Song ${n}`,
  artist: "A",
  artists: ["A"],
  album: null,
  albumArtist: null,
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 100,
  format: "opus",
  cover: null,
  addedAt: "2026-11-01T00:00:00Z",
  liked: false,
  ...p,
});

const songs = [
  track({
    title: "Global Warming",
    artist: "Pitbull, Sensato",
    artists: ["Pitbull", "Sensato"],
    album: "Global Warming",
    albumArtist: "Pitbull",
    trackNo: 1,
    cover: "c1",
  }),
  track({
    title: "International Love",
    artist: "Pitbull, Chris Brown",
    artists: ["Pitbull", "Chris Brown"],
    album: "Global Warming",
    albumArtist: "Pitbull",
    trackNo: 18,
    addedAt: "2026-11-05T00:00:00Z",
  }),
  track({
    title: "Feel This Moment",
    artist: "Pitbull, Christina Aguilera",
    artists: ["Pitbull", "Christina Aguilera"],
    album: "Global Warming",
    albumArtist: "Pitbull",
    trackNo: 3,
  }),
  track({ title: "Loose single", artist: "Chris Brown", artists: ["Chris Brown"] }),
  track({
    title: "Other album song",
    artist: "Adele",
    artists: ["Adele"],
    album: "25",
    trackNo: 2,
    discNo: 1,
    year: 2015,
  }),
];

describe("library", () => {
  it("groups albums by album artist and orders tracks", () => {
    const albums = buildAlbums(songs);
    expect(albums.map((a) => a.title)).toEqual(["Global Warming", "25"]); // newest first
    const gw = albums[0]!;
    expect(gw.artist).toBe("Pitbull");
    expect(gw.tracks.map((t) => t.trackNo)).toEqual([1, 3, 18]);
    expect(gw.cover).toBe("c1");
    expect(gw.duration).toBe(300);
  });

  it("lists every credited artist, with their albums", () => {
    const artists = buildArtists(songs);
    expect(artists.map((a) => a.name)).toEqual(["Adele", "Chris Brown", "Christina Aguilera", "Pitbull", "Sensato"]);
    const chris = artists.find((a) => a.name === "Chris Brown")!;
    expect(chris.tracks.map((t) => t.title)).toEqual(["International Love", "Loose single"]);
    expect(artists.find((a) => a.name === "Pitbull")!.albums.map((a) => a.title)).toEqual(["Global Warming"]);
  });

  it("filters on all words across title, artist and album", () => {
    expect(filterTracks(songs, "pitbull love").map((t) => t.title)).toEqual(["International Love"]);
    expect(filterTracks(songs, "GLOBAL").length).toBe(3);
    expect(filterTracks(songs, "  ").length).toBe(5);
  });

  it("sorts", () => {
    expect(sortTracks(songs, "added")[0]!.title).toBe("International Love");
    expect(sortTracks(songs, "title").map((t) => t.title)[0]).toBe("Feel This Moment");
    expect(sortTracks(songs, "album").at(-1)!.title).toBe("Loose single"); // no album last
  });
});
