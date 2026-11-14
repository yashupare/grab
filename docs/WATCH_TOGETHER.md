# M7 · Watch Together: complete plan

> **Status:** planned, not built. Research (two rounds) and tests on this PC: 2026-11-14.
> **Decisions:** the host streams their own file · 2–6 people per party · guests control playback
> when the host allows it · free server tier · guests can join from any browser, no install.

Contents: [1 Summary](#1-summary) · [2 Principles](#2-principles) · [3 Features](#3-features) ·
[4 Flows](#4-end-to-end-flows) · [5 UI/UX design](#5-uiux-design) · [6 Technology](#6-technology) ·
[7 Protocol and state](#7-protocol-and-state) · [8 Privacy, safety, legal](#8-privacy-safety-and-legal) ·
[9 Quality targets](#9-quality-targets) · [10 Testing](#10-testing) · [11 Phases](#11-phases) ·
[12 Risks](#12-risks) · [13 Research evidence](#13-research-evidence) · [14 Sources](#14-sources)

---

## 1. Summary

**Watch Together** lets someone play a video from their own PC and watch it live with up to five
friends who are somewhere else, as if they were on the same sofa.

- The **host** opens a video in Grab and clicks **Watch together**. Grab creates a **watch party**
  with an invite code like `K7Q-2MX` and a link.
- **Guests** open the link in any browser (Windows, Mac, Android, iPhone) or in Grab. They don't
  need the file, an account or an install.
- Everyone sees the same picture within about a second. Guests can pause, play and seek **when
  the host allows it**. There's chat, reactions, a ready check, optional voice chat and a queue
  for the next episode.

**Goals**

1. Feels like watching in one room: in sync, with good picture and stereo sound, and easy to talk.
2. Joining takes one click and a name, on any device.
3. The host stays in charge of who controls playback and who's in the party.
4. Free to run for a group of friends (Cloudflare's free tier), with no accounts.

**Not in scope (v1)**

- Public or discoverable parties, or more than 6 people.
- Streaming DRM services (Netflix etc.): impossible by design, and Grab never bypasses DRM.
- Recording parties.
- Webcam video bubbles (later, see [§11](#11-phases)).

---

## 2. Principles

These come from Grab's product principles ([PLAN.md §1](PLAN.md)), applied to parties:

1. **One click to join.** A link opens straight into the party. Name is the only field.
2. **The movie comes first.** The video fills the screen. Chat, people and controls stay out of
   the way and fade when nobody touches them.
3. **Always say who did what.** Every pause or jump shows who did it ("Paused by Riya"), so
   nobody is confused.
4. **The host is in control, never blocked.** Requests to the host are one tap to answer and never
   cover the movie for long.
5. **Explain, don't error.** A weak connection says "Your connection is slow, switched to SD", not
   a code.
6. **Private by default.** Invite-only, no accounts, nothing stored after the party ends.

---

## 3. Features

Priority: **P0** must have for the first release · **P1** should have · **P2** later.

### Party basics

| Feature | Priority | Phase |
|---|---|---|
| Start a party from any video (player, Videos grid ⋯ menu, command palette) | P0 | 7a |
| Invite code (`K7Q-2MX`), invite link, copy button, QR code for phones | P0 | 7a |
| Join from any browser (no install), or from Grab (code, link or `grab://` link) | P0 | 7a |
| Display name (remembered) and avatar colour, no accounts | P0 | 7a |
| Up to 6 people (host + 5 guests); "Party is full" message | P0 | 7a |
| People list with status: watching, buffering, away, reconnecting, connection quality | P0 | 7a |
| Host can remove a guest; removed guests can't rejoin that party | P0 | 7a |
| Host can lock the party (no new guests) | P1 | 7d |
| End party (host); leave party (guest); party recap ("Watched together · 1 h 52 min") | P0 | 7a |

### Watching

| Feature | Priority | Phase |
|---|---|---|
| Host streams the video live: one upload, relayed to each guest | P0 | 7b |
| Per-guest quality via simulcast: a slow guest gets SD without lowering anyone else | P0 | 7b |
| Movie-grade sound: Opus stereo 128 kbps (WebRTC's default is 33 kbps mono) | P0 | 7b |
| Guest's own volume, mute and full screen | P0 | 7b |
| Quality badge for guests (HD / SD / Auto) and a **Data saver** option for phones | P1 | 7b |
| Host upload health ("Streaming well · 3.1 Mbps") with automatic step-down | P0 | 7b |
| Keep the host's PC awake while hosting; warn on battery | P0 | 7b |
| Subtitles: host picks a track; guests see it and choose their own size | P1 | 7d |

### Control and permissions

| Feature | Priority | Phase |
|---|---|---|
| Party setting **Who can control**: *Only me* / *Everyone* / *Ask me* | P0 | 7c |
| Per-person **Can control playback** switch (overrides the party setting) | P0 | 7c |
| Guests with control: play, pause, seek (bar and ±10 s) | P0 | 7c |
| Guests without control: **Ask** sends a request; the host gets Allow once / Always allow / Not now | P0 | 7c |
| "Paused by Riya" / "Riya jumped to 1:02:10" notices for everyone | P0 | 7c |
| The server enforces permissions (a modified client can't bypass them) | P0 | 7c |

### Social

| Feature | Priority | Phase |
|---|---|---|
| Text chat (works in full screen as fading overlay messages) | P0 | 7a |
| Emoji reactions that float over the video (😂 😮 ❤️ 🔥 👏 😢, keys 1–6) | P0 | 7c |
| **Ready check**: everyone taps Ready, then "Starting in 3…2…1"; also after long pauses | P0 | 7c |
| **Voice chat** (optional, mic off by default, push-to-talk or open mic) | P1 | 7e |
| Movie **ducking**: the movie gets quieter while someone talks | P1 | 7e |
| **Up next** queue: host lines up videos; next one starts after a 10 s "Up next" card | P1 | 7e |
| Webcam bubbles | P2 | later |

### Reliability and settings

| Feature | Priority | Phase |
|---|---|---|
| Automatic reconnect for host and guests, with clear banners | P0 | 7d |
| Host drops: party pauses "Waiting for Yash…", ends after 2 minutes | P0 | 7d |
| Closing Grab while hosting asks first | P0 | 7b |
| Free-tier usage meter ("~240 GB of 1,000 GB used this month") and a hard stop before any charge | P0 | 7b |
| Settings → Watch together: name, colour, default quality, default control mode, voice keys, ducking, server address (advanced, self-host) | P1 | 7d |
| End-to-end encryption (SFrame) | P2 | later |

---

## 4. End-to-end flows

### 4.1 Host starts a party

1. In the video player (or Videos ⋯ menu, or Ctrl+K "Start watch party"), click **Watch together**.
2. **Start dialog** (one screen): party name (defaults to the video title), **Who can control**
   (default *Only me*), quality (default *Auto*). One button: **Start party**.
3. Grab creates the party and opens the **party screen** in **Lobby** state: the video's first frame,
   the invite card big and centred, and the people panel.
4. The host clicks **Copy invite** (or shows the QR code) and sends it in WhatsApp, Discord, etc.
   The invite message is pre-written: *"Join my watch party on Grab: https://…/w/K7Q2MX"*.

### 4.2 Guest joins from a browser

1. Opens the link → **Join page**: party name, host name, poster, who's there.
2. Types a name (remembered next time) → **Join party**. The click also unlocks sound, which
   browsers require.
3. Enters the party screen in the lobby (or straight into the movie if it's already playing,
   at the live position).
4. If the browser can't play it (very old browser), the page says which browsers work.

### 4.3 Guest joins from Grab

1. Pastes the link or code anywhere (the smart link box detects it), or opens a `grab://` link,
   or uses Home → **Join a watch party**.
2. Same join card (name prefilled) → party screen.

### 4.4 Ready check and start

1. In the lobby everyone sees **Ready?** with a big toggle. People rows show ✓ Ready.
2. The host clicks **Start**. If not everyone is ready: *"3 of 4 are ready. Start anyway?"*
3. A **3…2…1** countdown overlay plays for everyone (soft tick, respects reduced motion), then the
   movie starts.
4. After a pause longer than 2 minutes, the host can run **Ready check** again from the ⋯ menu.

### 4.5 Watching and controlling

- **Host** uses the normal controls. Everyone sees the result about 0.5–1 s later.
- **Guest with control** presses pause or seeks → the request goes to the server, which checks
  permission and passes it to the host's Grab, which applies it. Everyone sees *"Paused by Riya"*.
- **Guest without control** sees the controls in a muted style with a lock. Pressing one shows
  *"Only Yash can control playback · Ask"*. **Ask** sends a request; the host sees
  *"Riya wants to pause · Allow once · Always allow · Not now"* (auto-dismisses after 10 s as
  *Not now*). The guest sees *"Asked Yash…"* and then the answer.
- The host can change **Who can control** or anyone's switch at any time. Changes apply instantly and
  are announced: *"Yash let Riya control playback"*.

### 4.6 Chat, reactions, voice

- Chat in the side panel; in full screen, new messages appear bottom-left for 6 s, and **C** opens
  the chat overlay.
- Reactions from the reaction bar or keys 1–6 float up from the bottom-right with the sender's name.
- Voice: the mic button in the control bar (off by default). First use asks for microphone access
  and offers *Push to talk (hold V)* or *Open mic*. Speaking shows a ring around the avatar. The
  movie dips by 8 dB while anyone talks (adjustable, can be off).

### 4.7 Queue

- The host adds videos to **Up next** (side panel tab, or "Add to party queue" from Videos).
- When a video ends, an **Up next** card shows the next title with a 10 s countdown and **Play now /
  Cancel**. Guests see the same card.

### 4.8 Problems

| Situation | What people see |
|---|---|
| Guest's connection weakens | Their picture steps down to SD automatically; badge shows "SD · your connection". Nobody else is affected |
| Host's upload weakens | Host: "Your upload is struggling, streaming at 480p". Guests: quality steps down for all |
| Guest drops | Banner "Reconnecting…" for them; others see their row as *Reconnecting*. Back in a few seconds |
| Host drops | Everyone: "Waiting for Yash to reconnect…" with a 2-minute countdown; then "The party ended" |
| Party full | Join page: "This party is full (6 of 6)" |
| Wrong or expired code | "That party doesn't exist or has ended" |
| Removed by host | "You were removed from this party" |
| Free tier nearly used | Host when starting: "Watch Together has ~40 GB left this month (about 2 movies)". At the limit: "Watch Together is paused until 1 December to keep it free" |

### 4.9 Ending

- Host: **End party** (confirm: *"End the party for everyone?"*). Closing Grab while hosting asks
  the same.
- Guests: **Leave**. The host sees "Riya left".
- Everyone gets a **recap**: who watched, for how long, and for browser guests a quiet
  **Get Grab** link.

---

## 5. UI/UX design

### 5.1 Visual language

- Same system as the rest of Grab: **warm graphite + ember**, Inter, Lucide icons, 4 px grid,
  10/14/20 px radii, AA contrast (tokens in [PLAN.md §2](PLAN.md)).
- **Cinema mode:** the party screen is always dark, whatever the app theme, because video looks best
  on dark surroundings. It uses the dark tokens scoped to the party screen. Panels are
  `--surface-1`, the stage is a deeper `#0B0B0A`.
- **Overlays over video** sit on soft gradient scrims (black 0→60%) so text stays readable on any
  frame. Never pure-white boxes over the movie.
- **One accent:** ember is used only for the primary action, the progress bar, the live
  indicator and the active person. Status uses icon + text, never colour alone.
- **Avatars:** initials on one of 8 colours (picked from the name, all AA with white text), with a
  ring for speaking (ember), a dot for status.

### 5.2 Party screen (desktop, ≥ 1100 px)

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ ● LIVE  Movie night · Interstellar      (Y)(R)(A)+2   [ Invite ]   [⋯]   [ Leave/End ]    │ top bar 56px
├──────────────────────────────────────────────────────────────┬────────────────────────────┤
│                                                              │  Chat · People · Up next   │
│                                                              │ ────────────────────────── │
│                                                              │  Arjun joined              │
│                        VIDEO STAGE                           │  (R) Riya   this part!!    │
│                     (16:9, centred, dark)                    │  (Y) Yash   haha           │
│                                                              │                            │
│   "Paused by Riya" pill (top-centre, 2 s)                    │                            │
│                                                   😂 Riya ↑  │                            │
│                                                              │                            │
│ ▶  ⟲10  ⟳10  ━━━━━━━━━━●──────────── 1:02:10 / 2:49:00       │ ┌────────────────────────┐ │
│ 🔊━━━   CC   HD   🎤   😂😮❤️🔥👏😢             ⛶   ◧          │ │ Message…          ➤   │ │
└──────────────────────────────────────────────────────────────┴─┴────────────────────────┴─┘
                                                                 side panel 360px, collapsible (◧)
```

- **Top bar:** live dot + party name + video title; avatar stack (click → People tab);
  **Invite** (secondary); ⋯ menu (ready check, settings, lock party, copy link); **End party**
  (host, danger-ghost) or **Leave** (guest).
- **Control bar** (over the stage bottom, on a scrim): play/pause, ±10 s, seek bar with
  buffered/position and hover time, volume, CC, quality, mic, reactions, full screen, panel toggle.
  Auto-hides after 3 s without mouse movement while playing; always visible when paused.
- **Side panel** tabs with unread badges. Width 360 px; collapsing gives the stage the full width.
- **Notices** (top-centre pill, 2 s): who did what. Max one at a time; newer replaces older.
- **Host requests** (top-right toast, host only): *"Riya wants to pause"* + three buttons;
  10 s timeout with a thin progress line.

### 5.3 Full screen

- Stage only. Control bar and top bar appear on mouse move.
- Chat: the last 3 new messages fade in bottom-left for 6 s; **C** opens a translucent chat drawer
  on the right over the video.
- Reactions and notices work the same.

### 5.4 Lobby

```
┌──────────────────────────────────────────────────────────┬───────────────────────────┐
│                                                          │ People (3 of 6)           │
│        [ poster / first frame, dimmed ]                  │ (Y) Yash · host   ✓ Ready │
│                                                          │ (R) Riya          ✓ Ready │
│     Invite friends                                       │ (A) Arjun         ○       │
│     ┌──────────────────────────────┐                     │                           │
│     │  K7Q-2MX            [Copy]   │   [QR]              │                           │
│     │  grab.app/w/K7Q2MX  [Copy]   │                     │                           │
│     └──────────────────────────────┘                     │                           │
│                                                          │                           │
│     [ ✓ I'm ready ]        [ Start ▶ ] (host)            │                           │
└──────────────────────────────────────────────────────────┴───────────────────────────┘
```

### 5.5 Start dialog (host)

```
┌──────────────────────────────────────────────┐
│  Start a watch party                      ✕  │
│                                              │
│  Party name   [ Interstellar               ] │
│  Who can control playback                    │
│    (•) Only me   ( ) Everyone   ( ) Ask me   │
│  Quality      [ Auto (recommended)      ▾ ]  │
│  ⓘ Up to 5 friends can join. They watch      │
│    your video live; they don't need the file.│
│                                              │
│                 [ Cancel ]  [ Start party ]  │
└──────────────────────────────────────────────┘
```

### 5.6 Join page (browser and Grab)

```
┌───────────────────────────────────────┐
│              [ poster ]               │
│   Movie night                         │
│   Yash is hosting · 2 people watching │
│                                       │
│   Your name  [ Riya               ]   │
│   [        Join party        ]        │
│                                       │
│   Works in Chrome, Edge, Firefox,     │
│   Safari. Sound starts when you join. │
└───────────────────────────────────────┘
```
Centred card, 440 px wide, dark. Error states replace the button area with one sentence and a
single action.

### 5.7 People panel

Each row: avatar · name · role (Host / You) · status text with icon (Watching / Buffering / Away /
Reconnecting) · 3-bar connection quality · mic icon when talking. Host sees on hover a ⋯ menu:
**Can control playback** (switch) · **Remove from party**. The panel header has the
**Who can control** segmented control (host) or a read-only line (guests).

### 5.8 Up next panel

Thumbnail rows (16:9, 96 px) with title and length, drag handle (host), remove. **Add videos**
opens the Videos picker. The playing item is marked Now playing.

### 5.9 Phone layout (browser guests, < 720 px)

- Portrait: video at top (16:9), then tabs Chat · People below, control bar under the video with
  play/pause, seek, CC, reactions, more. Touch targets 44 px.
- Landscape: video full screen; tap shows controls; chat overlay like desktop full screen.
- **Data saver** in the quality menu (forces the SD layer).

### 5.10 Motion

| Element | Motion |
|---|---|
| Panels, drawers | 200 ms slide + fade, `cubic-bezier(.2,.8,.2,1)` |
| Notices, toasts | 160 ms fade + 4 px rise |
| Countdown 3-2-1 | 600 ms scale 0.9→1 + fade per number |
| Reactions | 2.4 s float up 120 px with slight sway, fade out |
| Speaking ring | 150 ms ease in/out on voice activity |
| Reduced motion | Reactions and countdown fade in place; no float, no scale |

### 5.11 Copy (tone)

Short, friendly, specific. Examples: *"Riya paused"*, *"Asked Yash to pause…"*, *"Your connection
is slow, switched to SD"*, *"Waiting for Yash to reconnect (1:42)…"*, *"The party ended. You
watched together for 1 h 52 min."* No error codes in the UI (they go to logs).

### 5.12 Keyboard

| Keys | Action |
|---|---|
| Space / K | Play/pause (or Ask, without control) |
| ← / → | Seek −/+10 s (with control) |
| F | Full screen |
| M | Mute the movie for yourself |
| C | Focus chat / open chat overlay |
| V (hold) | Push to talk |
| 1–6 | Reactions |
| Ctrl+Shift+I | Copy invite link |
| Esc | Leave full screen / close panel or dialog |

### 5.13 Accessibility

- WCAG 2.1 AA, verified with axe-core like the rest of Grab, in light and dark (party screen is dark).
- Notices ("Riya paused") are announced politely to screen readers; new chat messages are announced
  only when the chat panel is open, at most one per 3 s.
- Every icon control has a label and tooltip; the seek bar and volume are real sliders with values.
- Focus moves into dialogs and returns afterwards; the host request toast is reachable by keyboard
  (Ctrl+Shift+A answers *Allow once*).
- Captions follow the guest's size preference; text over video always has a scrim.
- Status never relies on colour alone (icon + text).

### 5.14 Settings → Watch together

Display name · avatar colour · default quality · default *Who can control* · voice (push-to-talk key,
open mic sensitivity, ducking level or off) · usage this month · advanced: server address (for
people running their own server).

---

## 6. Technology

### 6.1 Architecture

```
Host's Grab                          Cloudflare (free tier)                      Guests (browser or Grab)
┌──────────────────────┐   WebRTC    ┌───────────────────────────┐   WebRTC     ┌──────────────────┐
│ <video> local file   │─(1 upload,─▶│ Realtime SFU              │─(best layer ▶│ live video+audio │
│ captureStream()      │  simulcast) │ forwards to each guest    │  per guest)  │ chat, controls   │
└──────────┬───────────┘             └───────────────────────────┘              └────────┬─────────┘
           │      WebSocket          ┌───────────────────────────┐   WebSocket           │
           └────────────────────────▶│ Worker + Durable Object   │◀──────────────────────┘
                                     │ one per party: members,   │
                                     │ permissions, chat, control│
                                     │ SFU sessions, usage meter │
                                     │ + serves the join page    │
                                     └───────────────────────────┘
```

### 6.2 Technology choice

| Option | Free allowance | Verdict |
|---|---|---|
| **Cloudflare Realtime SFU** + Worker/Durable Object | 1,000 GB/month egress (SFU + TURN), 100k Worker requests/day | **Chosen.** Biggest managed free tier, global network, simulcast and every modern codec, nothing to run, E2EE proven on it (Cloudflare's own Orange Meets) |
| Direct host → guests (mesh) | Unlimited | Host upload × number of guests: 5 guests at 1080p need 20–25 Mbps up. Rejected |
| LiveKit Cloud (Build plan) | ~50 GB, ~5,000 participant-minutes/month | ~8 movie nights a month. Too small |
| Self-hosted LiveKit on Oracle Always Free | 10 TB/month egress | Needs a card, a server to maintain, idle VMs get reclaimed. Later "run your own" option |
| Media over QUIC via Cloudflare's relay | Free in beta | Successor to WebRTC for this, but the spec is an IETF draft and the relay is beta. Revisit in a year |

### 6.3 Free-tier budget

| Service | Free allowance | Use |
|---|---|---|
| Realtime SFU + TURN | 1,000 GB/month out of Cloudflare, then $0.05/GB | 720p ≈ 2.5 Mbps ≈ 1.1 GB/h per guest; 1080p ≈ 4 Mbps ≈ 1.8 GB/h. 2-hour movie, 5 guests: ~11 GB (720p) to ~18 GB (1080p) → **~55–90 movie nights a month** |
| Workers + Durable Objects | 100,000 requests/day; WebSocket messages count; hibernating parties cost no time | Join, chat, control, presence: a few thousand messages per movie night |
| Workers static assets (join page) | Free | The guest web app |
| STUN | Free, unlimited | Connection setup |

**Usage meter and hard stop:** guests report bytes received every minute; the Durable Object adds
them to a monthly counter. Hosts see it in Settings and when starting. At 950 GB new parties are
refused until the 1st, so the free tier can't turn into a bill.

### 6.4 Code layout

```
party/
  shared/     protocol types + party state machine (TypeScript, used by all three)
  server/     Cloudflare Worker + Durable Object "Party" (wrangler), serves web/ as static assets
  web/        browser guest app (Vite + React + Tailwind, reuses Grab's tokens and components)
src/party/    Grab's party screen, host media pipeline, join flow (desktop)
src-tauri/    keep-awake command, close-while-hosting guard, grab:// link handling
```

### 6.5 Host media pipeline (Grab)

1. Player `<video>` gets `crossOrigin = "anonymous"` (tested: required to capture Grab's local files).
2. `captureStream()` → one video track (`contentHint = "motion"`) + one audio track.
3. **Simulcast** encodings: `h` 1080p (only if upload allows) · `m` 720p ~2.5 Mbps · `l` 360p ~0.5 Mbps;
   `degradationPreference = "maintain-framerate"`.
4. **Audio** SDP: Opus `stereo=1; sprop-stereo=1; maxaveragebitrate=128000`, DTX off
   (tested: 129 kbps true stereo).
5. Push to the SFU through the Worker (which holds the app secret).
6. **Health:** read `outbound-rtp` stats every 2 s; show upload health; drop the top layer when
   `qualityLimitationReason` is `bandwidth` for 10 s.
7. **Keep awake:** Rust command using `SetThreadExecutionState` while hosting; battery warning.
8. **Codec:** VP8 to start (measured fine at 1080p30 here). Evaluate VP9 on a mid-range laptop in
   7b; switch only if CPU stays under budget ([§9](#9-quality-targets)).

### 6.6 Guest media

- Pull the host's tracks into a receive-only session (works in every modern browser including iOS
  Safari, since guests don't encode).
- `jitterBufferTarget` ≈ 400 ms: smoother playback for movies at a small latency cost.
- Data saver: request the `l` layer only.
- Report stats (bytes, layer, freezes) to the Durable Object each minute for status and usage.

### 6.7 Voice chat (7e)

- Each person with mic on publishes one Opus mono track (echo cancellation, noise suppression on)
  to the SFU; others pull it. ~32 kbps per speaker: negligible next to video.
- Voice activity (from audio level) drives speaking rings and **ducking**: the movie's playback
  gain dips 8 dB with a 150 ms attack and 600 ms release.

### 6.8 Subtitles (7d)

`captureStream()` sends picture only. The host's player tracks the active cue (embedded track or
.srt next to the file) and sends `{text, start, end}` over the party channel; guests render it
locally with their own size. Cues are timed to the host's media clock, so they stay in sync with
the stream.

---

## 7. Protocol and state

### 7.1 Who decides what

- **Server (Durable Object)** is the source of truth for **membership, roles, permissions, chat,
  queue** and the usage meter.
- **Host's Grab** is the source of truth for **playback** (it plays the file). The server forwards
  approved control requests to the host and broadcasts the host's resulting state.

### 7.2 Party state machine

```
lobby ──Start──▶ countdown ──3 s──▶ live(playing ⇄ paused) ──End──▶ ended
                                      │  ▲
                         host drops   ▼  │ host back (≤ 2 min)
                                  host-away ──2 min──▶ ended
```

Guest connection: `joining → connecting-media → watching ⇄ reconnecting → left | removed`.

### 7.3 Messages (WebSocket, JSON, versioned)

| Direction | Type | Fields |
|---|---|---|
| client → server | `hello` | `v`, `name`, `color`, `resumeToken?` |
| server → client | `welcome` | `you`, `party` snapshot (name, state, members, permissions, queue, playback, chat tail) |
| server → all | `member.joined` / `member.left` / `member.updated` | member (id, name, color, role, status, canControl, mic) |
| client → server | `control.request` | `action: play \| pause \| seek`, `position?` |
| server → host | `control.apply` | action, position, `by` |
| server → guest | `control.denied` / `control.asked` | reason |
| server → host | `control.ask` | `requestId`, `by`, action |
| host → server | `control.answer` | `requestId`, `allowOnce \| allowAlways \| deny` |
| host → server | `playback.state` | playing, position, rate, at (host clock), `by` |
| server → all | `playback.state` | (as above) → drives notices and guests' seek bar |
| client → server | `chat.send` / `reaction.send` | text (≤ 500 chars) / emoji |
| server → all | `chat.message` / `reaction` | id, from, text/emoji, at |
| host → server | `permissions.set` | mode (`host \| everyone \| ask`), per-member overrides |
| any → server | `ready.set` | ready |
| host → server | `party.start` / `party.end` / `party.lock` / `member.remove` | |
| client → server | `stats` | bytes, layer, freezes (every 60 s) |
| media | `sfu.offer` / `sfu.answer` / `sfu.tracks` | relayed to the Worker's SFU calls |

Rate limits per member: chat 5/10 s, reactions 10/10 s, control requests 3/5 s.

---

## 8. Privacy, safety and legal

- **No accounts.** A random member token (in browser storage) lets you reconnect; display names only.
- **Codes:** 6 characters from 31 unambiguous symbols (~887 million combinations), with join attempts
  rate-limited per IP; parties are invite-only and never listed.
- **Removal:** the host can remove anyone; their token is blocked for that party. **Lock** stops new joins.
- **Data kept:** nothing after a party ends (Durable Object state is deleted). Chat is never stored.
  Only the monthly usage number persists.
- **Media path:** video passes through Cloudflare's SFU, which forwards but could technically access
  it. **Later:** end-to-end encryption with SFrame (RFC 9605) via Chromium encoded transforms, as
  Cloudflare's Orange Meets already does over the same SFU.
- **Legal:** Grab streams only files on the host's PC, never DRM services. The start dialog says
  *"Only share videos you have the right to share."* Parties are private and capped at 6, similar
  to screen sharing on Discord or Zoom; what's shared is the host's responsibility.
- **Abuse of the public server** (the app is open source): max 6 per party, a cap on concurrent
  parties and new parties per IP per hour, idle parties closed after 10 minutes, kill switch,
  and the usage hard stop.

---

## 9. Quality targets

| Measure | Target |
|---|---|
| Click invite link → video playing (lobby skipped) | ≤ 5 s on broadband |
| Host → guest delay | ≤ 1 s (aim 0.5 s) |
| Guest pause → everyone paused | ≤ 1 s |
| Stalls at 720p on a stable 10 Mbps connection | < 1 per hour |
| Host CPU, 720p + 360p simulcast, 4-core laptop | ≤ 35% |
| Sound | 128 kbps stereo, no drift against picture (lip sync within 45 ms) |
| Reconnect after a 5 s network drop | Back automatically in ≤ 10 s |
| Accessibility | axe-core: 0 violations on every party screen state, light and dark |

---

## 10. Testing

- **Unit:** protocol types and the party state machine (`party/shared`), permission rules, rate
  limits, code generation (vitest).
- **Server:** Durable Object behaviour with Cloudflare's Workers test runner (join/leave, permissions,
  host-away timer, lock, remove, usage stop).
- **Media (automated):** Grab dev build hosts; two headless Chromium guests join through
  `wrangler dev` against the real SFU; assert frames decoded, stereo audio, layer switching under
  throttling, control round-trip time.
- **Manual matrix (each phase):** Windows host on Wi-Fi · Windows guest on another network ·
  Android Chrome on mobile data · iPhone Safari · a laptop on a phone hotspot (weak).
- **Accessibility:** axe-core on lobby, live, full screen, dialogs, phone layout; keyboard-only run.

---

## 11. Phases

| Phase | Scope | Done when |
|---|---|---|
| **7a · Parties** | `party/` scaffold; Worker + Durable Object; codes, invite link + QR; join page (web) and join flow (Grab); people list and status; chat; remove; end/leave; recap; Cloudflare setup guide | Grab + 2 browsers (one a phone) join with a link, chat, and the host removes one |
| **7b · Streaming** | Host pipeline (capture, simulcast, stereo audio), guest playback, quality badge, data saver, upload health, keep-awake, close guard, usage meter + hard stop | Host + 2 guests on different networks (one on a hotspot) watch 30 min within 1 s; the hotspot guest drops to SD without affecting the other; CPU within budget |
| **7c · Control and fun** | Who-can-control modes, per-person switches, Ask + host answers, notices, reactions, ready check + countdown, server-side enforcement | A permitted guest pauses and seeks for all; one without permission can only Ask; the host allows, then revokes mid-movie |
| **7d · Polish** | Reconnects, host-away flow, subtitles, lock party, `grab://` links, settings page, accessibility pass | A Wi-Fi drop recovers alone; subtitles show for guests; axe-core clean |
| **7e · Voice and queue** | Voice chat (push-to-talk / open mic), speaking rings, movie ducking, Up next queue with auto-advance | Four people talk while the movie dips under their voices; the next episode starts after the card |
| Later | End-to-end encryption, webcam bubbles, self-host (LiveKit on Oracle), Media over QUIC | |

Before 7a: you create a free Cloudflare account (I'll guide the rest); we check whether Realtime
asks for a card and set a spending alert if so.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Cloudflare changes the free tier | Usage meter + hard stop; server address is configurable; self-host path documented |
| Realtime needs a payment method | Spending alert + our hard stop at 950 GB |
| Host's upload too weak | Auto step-down, 480p cap option, clear message |
| Old/odd browsers | Join page checks WebRTC support and names working browsers |
| iOS Safari autoplay with sound | Join button click unlocks audio; "Tap for sound" fallback |
| WebView2 / Chromium behaviour changes | Media tests in CI-like script each release (§10) |
| Abuse of the public server | Limits in §8, kill switch |
| Legal | Private, small, no DRM, clear notice; host's responsibility |

---

## 13. Research evidence

### 13.1 Tests on this PC (Grab dev build, WebView2)

A 1080p test movie (H.264 + AAC, 30 fps) played in Grab's player, captured with `captureStream()`,
sent over a real `RTCPeerConnection`, measured on arrival:

| Check | Result |
|---|---|
| Video arrives (reported Chromium bug 1156408: "captureStream sends no data") | **Works.** 1920×1080 at 30 fps, ~3.9–4.9 Mbps (VP8), 294/295 frames decoded in 12 s, no quality limit hit |
| Audio arrives | **Works.** Received audio RMS 0.088 = host's own (0.088) |
| Host's volume leaks to guests (reported for older Chromium) | **No.** RMS 0.091 at host volume ≈0 and 0.089 at 100% |
| Capturing Grab's local files | Blocked by default ("cross-origin data"); **fixed** with `crossOrigin = "anonymous"` |
| Sound quality | Default **33 kbps mono**; with stereo/128 kbps SDP **129 kbps true stereo** |
| Stats quirk | `audioLevel` / `totalAudioEnergy` read 0 unless audio is played out; don't use them for "is sound flowing" |

### 13.2 What other apps do (2026 comparison)

Teleparty (sync for streaming sites, chat; video chat paid), Rave (phones, built-in voice), Kast
(large rooms, voice), Discord (voice, screen share hits DRM black screens), Watch2Gether (open web
video, mobile browser). Expectations taken into this plan: no-signup links, chat, reactions, voice,
phone joining. Our difference: the host's own files at full quality with permissions.

---

## 14. Sources

- Cloudflare Realtime pricing (SFU + TURN, 1,000 GB free, egress only): https://developers.cloudflare.com/realtime/sfu/pricing and https://www.cloudflare.com/plans/
- Cloudflare TURN FAQ: https://developers.cloudflare.com/realtime/turn/faq/
- Cloudflare Realtime sessions, tracks and architecture: https://developers.cloudflare.com/realtime/sfu/sessions-tracks/ and https://developers.cloudflare.com/realtime/sfu/concepts/architecture/
- Cloudflare Realtime simulcast and codecs: https://developers.cloudflare.com/realtime/sfu/simulcast/ and https://developers.cloudflare.com/realtime/sfu/limits/
- Cloudflare end-to-end encryption guide (encoded transforms, beta): https://docs.realtime.cloudflare.com/guides/capabilities/misc/end-to-end-encryption
- Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing
- `HTMLMediaElement.captureStream()`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream
- All the ways to send a video file over WebRTC (webrtcHacks, Feb 2024): https://webrtchacks.com/all-the-ways-to-send-a-video-file-over-webrtc/
- Chromium issue 1156408 reports: https://gist.github.com/guest271314/01382c060755d06ff40658046cc7d23f
- Mesh vs SFU bandwidth: https://antmedia.io/webrtc-network-topology/
- SFrame, RFC 9605: https://www.rfc-editor.org/rfc/rfc9605
- Opus RTP payload (stereo, bitrates), RFC 7587: https://www.rfc-editor.org/rfc/rfc7587 · DTX and music: https://getstream.io/resources/projects/webrtc/advanced/dtx/
- LiveKit Cloud free plan (third-party summary): https://micdrop.dev/blog/livekit-pricing
- Oracle Cloud Free Tier: https://www.oracle.com/cloud/free/ and https://selfhost.it.com/blog/oci-free-tier-breakdown
- Media over QUIC status 2026: https://www.forasoft.com/blog/article/media-over-quic-moq-streaming-2026
- Watch party apps 2026: https://syncup.tv/blog/best-watch-party-apps-2026
- Jellyfin SyncPlay: https://eb48e63b.jellyfin-org.pages.dev/developers/docs/api/syncplay · Syncplay: https://syncplay.pl/about/syncplay/
