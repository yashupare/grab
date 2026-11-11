# Grab

Personal Windows desktop app: download video and music, import Spotify playlists as a local
music library, play it, and do simple video edits (merge, trim, compress, convert).

Built with Tauri 2 (Rust) + React + TypeScript. See [docs/PLAN.md](docs/PLAN.md) for the full
product, design and build plan.

## Develop

Requirements: Node + pnpm, Rust (stable, MSVC), Visual Studio C++ Build Tools, WebView2.

```sh
pnpm install
pnpm app          # run the desktop app with hot reload
pnpm check        # typecheck + lint + frontend tests
cd src-tauri && cargo test   # Rust tests
```

On first launch the app downloads its external tools (yt-dlp, FFmpeg, aria2, Node) from their
official sources and verifies each against a pinned SHA-256 (`src-tauri/src/toolmgr.rs`).

## Project layout

| Path | What |
|---|---|
| `src/app` | App shell: title bar, sidebar, activity panel, command palette, setup screen, router |
| `src/pages` | One file per page |
| `src/components/ui` | Design-system components |
| `src/styles/tokens.css` | Colour tokens (dark/light) |
| `src/lib/ipc.ts` | Typed calls into Rust |
| `src-tauri/src` | Rust core: database, settings, logging, tool manager, commands |

## Rules

- Dependencies: pnpm refuses package versions younger than 7 days (`pnpm-workspace.yaml`).
- Database: migrations in `src-tauri/src/db.rs` are append-only.
- Tools: only pin releases at least 7 days old, with checksums from the publisher.
