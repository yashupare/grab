# M7 · Watch Together: plan

> Status: **planned, not built**. Research and tests: 2026-11-14.
> Decisions: the **host streams** their file to friends · **2–6 people** per room ·
> **anyone can control playback once the host allows it** · runs on a **free** server tier ·
> **friends can join from a browser** (no install needed; hosting needs Grab).

## 1. What it is

The host opens a video in Grab and clicks **Watch together**. Grab gives them a short room code.
Up to five friends join with the code and watch the host's video live, in sync, with chat and
reactions. Friends don't need the file. Anyone the host allows can pause, play and seek for
everyone.

## 2. What we tested on this PC (Grab dev build, WebView2)

A 1080p test movie (H.264 + AAC, 30 fps, 6 Mbps) played in Grab's player, captured with
`video.captureStream()`, sent over a real `RTCPeerConnection` to a second connection, measured on
arrival:

| Check | Result |
|---|---|
| Video arrives (the reported Chromium "captureStream sends no data" bug, issue 1156408) | **Works.** 1920×1080 at 30 fps, ~3.9–4.9 Mbps (VP8), 294/295 frames decoded in 12 s, no quality limit hit |
| Audio arrives | **Works.** Recording of the received audio: RMS 0.088, same as the host's own track (0.088) |
| Host's volume leaks into what friends hear (reported for older Chromium) | **No.** Captured audio RMS 0.091 at host volume ≈0 and 0.089 at 100% |
| Capturing Grab's local files | **Blocked by default** ("cross-origin data"): files are served from `asset.localhost`. **Fix:** set `crossOrigin = "anonymous"` on the host's `<video>` (tested; works) |
| Stats quirk | `audioLevel` / `totalAudioEnergy` read 0 in WebView2 unless audio is really played out; don't use them for "is sound flowing" checks |

**Conclusion:** the simplest approach (capture the playing `<video>` and send it over WebRTC)
works in Grab today. No custom encoder, no ffmpeg streaming, no Web Audio workaround needed.

## 3. Architecture

```
Host's Grab                          Cloudflare (free tier)                       Friends' Grab
┌──────────────────────┐   WebRTC    ┌───────────────────────────┐   WebRTC     ┌──────────────┐
│ <video> local file   │──(1 upload)─▶│ Realtime SFU              │──(1 per friend)▶ live video  │
│ captureStream()      │             │ copies the stream to each │              │ + controls   │
└──────────┬───────────┘             └───────────────────────────┘              └──────┬───────┘
           │      WebSocket          ┌───────────────────────────┐   WebSocket         │
           └────────────────────────▶│ Worker + Durable Object   │◀────────────────────┘
                                     │ one per room: members,    │
                                     │ permissions, chat, play/  │
                                     │ pause/seek, SFU sessions  │
                                     └───────────────────────────┘
```

### Why an SFU and not direct host-to-friend (mesh)

In a mesh the host uploads one copy **per friend**: at 1080p (≈4–5 Mbps measured) five friends
need **20–25 Mbps of upload**, more than many home connections have, and quality would drop for
everyone. With an SFU (Selective Forwarding Unit) the host uploads **once** and Cloudflare copies
it to each friend. Cloudflare doesn't charge for traffic sent to it, only for traffic it sends out.

### Free-tier budget

| Service | Free allowance | Our use |
|---|---|---|
| Cloudflare Realtime SFU + TURN | **1,000 GB/month** out of Cloudflare (shared by SFU and TURN), then $0.05/GB | 1080p ≈ 4 Mbps ≈ 1.8 GB/hour per friend. A 2-hour movie with 5 friends ≈ **18 GB** → **~55 movie nights a month**; at 720p (≈2.5 Mbps) ≈ 11 GB → ~90 |
| Workers + Durable Objects (room server) | 100,000 requests/day; WebSocket messages count; hibernating rooms cost no duration | Join, chat and control messages: a few thousand per movie night |
| STUN (`stun.cloudflare.com`) | Free, unlimited | Connection setup |

### Room server (Cloudflare Worker + one Durable Object per room)

- **Rooms:** 6-character codes without look-alike letters (e.g. `K7Q-2MX`), max 6 people, closed
  when the host leaves (after a 2-minute grace period for reconnects). No accounts: everyone picks
  a display name.
- **SFU sessions:** the Worker holds the Cloudflare Realtime app secret. It creates the host's
  session (publishes the video and audio tracks) and each friend's session (pulls those tracks).
  The SFU has no "room" concept; the Durable Object is the room.
- **Messages it relays:** join/leave, member list, permissions, chat, reactions, and playback
  control (`play`, `pause`, `seek`) with who asked.
- **Abuse limits:** the server is public (the app is open source), so: max 6 per room, a cap on
  open rooms and rooms per IP per hour, idle rooms closed, and a kill switch.

### Host (Grab)

- **Watch together** button in the video player and in the Videos grid's ⋯ menu.
- **Capture:** `video.crossOrigin = "anonymous"`, then `captureStream()` for one video and one
  audio track. The host hears the movie normally; their volume doesn't affect friends.
- **Quality:** Auto (from WebRTC's upload estimate), 1080p, 720p or 480p. Default 720p30
  (≈2.5 Mbps), which most uploads handle and which stretches the free tier.
- **The host's player is the clock.** Approved controls are applied to the host's `<video>`, and
  the live stream carries the result to everyone. No drift correction is needed: everyone watches
  the same stream, about 0.3–1 s behind the host.
- **Keep the PC awake** while hosting (Windows `SetThreadExecutionState`), and warn when a laptop
  is on battery.

### Friends

- **Join:** open the invite link (`https://<server>/w/K7Q2MX`) in any browser, or type the code
  on Grab's Home or link box. Grab users can also open `grab://watch/K7Q2MX`.
- **Player:** full-window live video with their own volume, mute and full screen. The controls
  are the same as Grab's player, greyed out until the host allows control.
- **Overlay messages** like "Paused by Riya" and "Riya jumped to 1:02:10".

### Permissions (who controls playback)

- Default: **only the host** controls.
- The host can allow control **per person** (a toggle next to each name) or **for everyone**.
- The host can turn it off for anyone at any time. The Durable Object enforces this, so a
  modified client can't bypass it.
- **Ask mode (optional):** a friend without permission can press **Ask**, and the host sees
  "Riya wants to pause · Allow / Not now".
- Allowed controls: play, pause, seek. Only the host can change the video, quality or end the room.

### Chat and reactions

- Text chat in a side panel that also works in full screen.
- Emoji reactions that float over the video for everyone.
- Voice: not in v1. People use a call or Discord alongside; it could come later as audio tracks
  on the same SFU.

## 4. Things to handle

| Topic | Plan |
|---|---|
| **Subtitles** | `captureStream()` sends picture only, not subtitle tracks. The host sends the current subtitle cue over the room channel and friends render it (phase 4) |
| **Privacy** | No accounts; codes expire; the room server sees names, chat and controls. Video passes through Cloudflare's SFU, which can technically access it. Optional later: end-to-end encryption with WebRTC encoded transforms (supported in Chromium) |
| **Weak networks** | WebRTC adapts bitrate per friend; the SFU reaches friends behind strict routers through Cloudflare TURN (same free allowance) |
| **Host disconnects** | Room pauses with "Waiting for the host…"; the host rejoins with the same room for 2 minutes |
| **Legal** | Private, invite-only, max 6, no public room list. The UI says "Only share videos you have the right to share." Streaming a file to others can count as distribution; this is the user's responsibility, as with screen sharing in Discord or Zoom |

## 5. Phases

| Phase | Scope | Done when |
|---|---|---|
| **7a · Rooms** | Worker + Durable Object, room codes, join/leave, member list, chat; setup guide for the Cloudflare account | Two Grab windows (or Grab + test page) join one room and chat |
| **7b · Streaming** | Host publishes to the SFU, friends pull; quality picker; keep-awake | Host + 2 friends on different networks watch 30 min at 720p, under 1 s behind the host |
| **7c · Control** | Permissions (per person / everyone / ask), play/pause/seek from friends, overlays, reactions | A permitted friend pauses and seeks for everyone; a friend without permission can't; host revokes mid-movie |
| **7d · Polish** | Reconnects, host-left handling, subtitles, `grab://` join links, usage readout (GB this month) | A Wi-Fi drop recovers by itself; subtitles show for friends |

## 6. Open questions

1. ~~Do friends need Grab installed?~~ **Decided: no.** A small web page (served by the same
   Worker) lets friends join from any browser, including phones. Grab joins rooms too, and is
   needed to host.
2. **Cloudflare account:** you need a free Cloudflare account to deploy the room server. Check
   whether Realtime asks for a payment method. If it does, set a spending alert so the free
   1,000 GB can't silently become a bill.
3. **Where the server code lives:** a `server/` folder in this repo (deployed with `wrangler`), so
   anyone can run their own.

## 7. Sources

- Cloudflare Realtime pricing (SFU + TURN, 1,000 GB free, egress only): https://developers.cloudflare.com/realtime/sfu/pricing and https://www.cloudflare.com/plans/
- Cloudflare TURN FAQ: https://developers.cloudflare.com/realtime/turn/faq/
- Cloudflare Realtime sessions and tracks (no rooms; app tracks membership): https://developers.cloudflare.com/realtime/sfu/sessions-tracks/ and https://developers.cloudflare.com/realtime/sfu/concepts/architecture/
- Durable Objects pricing (free plan limits, hibernation): https://developers.cloudflare.com/durable-objects/platform/pricing
- `HTMLMediaElement.captureStream()`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream
- All the ways to send a video file over WebRTC (webrtcHacks, Feb 2024): https://webrtchacks.com/all-the-ways-to-send-a-video-file-over-webrtc/
- Chromium issue 1156408 reports (captureStream over a peer connection sends no data): https://gist.github.com/guest271314/01382c060755d06ff40658046cc7d23f
- Mesh vs SFU bandwidth: https://antmedia.io/webrtc-network-topology/
- Jellyfin SyncPlay (group wait/ready model): https://eb48e63b.jellyfin-org.pages.dev/developers/docs/api/syncplay
- Syncplay (how sync-based watch parties correct drift): https://syncplay.pl/about/syncplay/
