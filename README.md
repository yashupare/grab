# Grab

A Windows desktop app to download video and music, turn Spotify playlists into a local music
library, play it, and do quick video edits. Everything runs on your PC; nothing is uploaded.

- **Download** from YouTube and 1000+ sites: any quality up to 8K, audio only (Opus, M4A, MP3),
  playlists and channels, subtitles, chapters, SponsorBlock, part of a video.
- **Spotify → music library**: paste a song, album or playlist link; Grab finds each song on
  YouTube Music, lets you fix any wrong match, and saves it with the right title, artists, album
  and cover. Pasting the link again later downloads only the new songs.
- **Music player**: songs, albums, artists, playlists, liked songs, queue, crossfade, Now
  Playing, media keys and the Windows media overlay, keeps playing from the tray.
- **Videos**: library and player that remembers where you stopped.
- **Tools**: merge, trim, compress to a size (WhatsApp, Discord, email), convert or extract
  audio, using your graphics card when it can.

Only download what you have the right to. Grab doesn't bypass copy protection (DRM): Spotify's
own audio is never touched.

## Install

Download `Grab_x.y.z_x64-setup.exe` from [Releases](https://github.com/yashupare/grab/releases)
and run it. Windows 10/11 (64-bit). On first launch Grab downloads its tools (yt-dlp, FFmpeg,
aria2, Node) from their official sources and checks each against a pinned SHA-256. After that it
updates itself: Settings → Updates.

## Develop

Requirements: Node + pnpm, Rust (stable, MSVC), Visual Studio C++ Build Tools, WebView2.

```sh
pnpm install
pnpm app          # run the desktop app with hot reload
pnpm check        # typecheck + lint + frontend tests
cd src-tauri && cargo test   # Rust tests
```

Slow tests that use the network or real ffmpeg are opt-in:

```sh
cd src-tauri
cargo test live_tools -- --ignored --nocapture                  # every video tool, for real
GRAB_SPOTIFY=<playlist link> cargo test live_playlist -- --ignored --nocapture   # Spotify matching
```

See [docs/PLAN.md](docs/PLAN.md) for the product, design and build plan.

## Release

```sh
pnpm release version 0.2.0     # sets it in package.json, tauri.conf.json, Cargo.toml; commit
pnpm release build             # signed installer in src-tauri/target/release/bundle/nsis
pnpm release publish "What's new"   # GitHub release v0.2.0 with the installer + latest.json
```

Updates are signed. The private key lives outside the repo at `%USERPROFILE%\.tauri\grab.key`
(or `TAURI_SIGNING_PRIVATE_KEY`); installed copies only accept installers signed with it, so
back it up. The public key is in `src-tauri/tauri.conf.json`.

## Project layout

| Path | What |
|---|---|
| `src/app` | App shell: title bar, sidebar, activity panel, command palette, welcome and setup, router |
| `src/pages` | Pages (`music/`, `tools/`, link, videos, settings…) |
| `src/components` | UI pieces; `ui/` is the design system, `music/` and `tools/` per feature |
| `src/player` | Audio engine (two decks for crossfade) and Windows media integration |
| `src/lib` | Typed calls into Rust (`ipc.ts`) and pure, tested helpers |
| `src-tauri/src` | Rust core: jobs (download/export queue), yt-dlp, Spotify reader and matcher, music library, playlists, media tools (ffmpeg), tray and media keys, updater, database, settings |

## Rules

- Dependencies: pnpm refuses package versions younger than 7 days (`pnpm-workspace.yaml`);
  Rust crates are pinned the same way.
- Database: migrations in `src-tauri/src/db.rs` are append-only.
- Tools: only pin releases at least 7 days old, with checksums from the publisher.
