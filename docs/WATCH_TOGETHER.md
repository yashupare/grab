# M7 · Watch Together: plan

> Status: **planned, not built**. Research (two rounds) and tests on this PC: 2026-11-14.
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
| **Movie-grade sound** (round 2) | WebRTC's default is voice-call audio: **33 kbps, mono** (left and right identical). With Opus `stereo=1; sprop-stereo=1; maxaveragebitrate=128000` and DTX off in the SDP: **129 kbps, true stereo** (left and right carry different tones). Chromium honours it; we must set it |

**Conclusion:** the simplest approach (capture the playing `<video>` and send it over WebRTC)
works in Grab today. No custom encoder, no ffmpeg streaming, no Web Audio workaround needed.

## 3. Technology choice (checked in two research rounds)

| Option | Free allowance | Verdict |
|---|---|---|
| **Cloudflare Realtime SFU** + Worker/Durable Object | 1,000 GB/month egress (SFU + TURN), 100k Worker requests/day | **Chosen.** Biggest managed free tier, global network, simulcast and every modern codec, no server to run, end-to-end encryption proven on it (Cloudflare's own Orange Meets) |
| Direct host → friends (mesh, no relay) | Unlimited (no server) | Host upload multiplies by the number of friends: 5 friends at 1080p need 20–25 Mbps up. Rejected |
| LiveKit Cloud (Build plan) | ~50 GB and ~5,000 participant-minutes/month (third-party figures) | ~8 movie nights a month. Too small |
| Self-hosted LiveKit on Oracle Cloud Always Free | 10 TB/month egress | Most bandwidth, but needs a card to sign up, a server to maintain, Oracle reclaims idle VMs, ARM support unverified. Possible later "run your own" option |
| Media over QUIC (MoQ) via Cloudflare's relay | Free during beta | The likely successor to WebRTC for this, but the spec is still an IETF draft and the relay is beta (launched July 2026). Revisit in a year |

## 4. Architecture

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

### Why an SFU (relay) and not direct host-to-friend (mesh)

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
- **Simulcast:** the host sends the video at 2–3 qualities at once (e.g. 720p ≈ 2.5 Mbps +
  360p ≈ 0.5 Mbps; 1080p as an extra layer when the upload allows). Cloudflare picks the best
  layer for **each** friend from their bandwidth, so one friend on weak Wi-Fi gets 360p instead of
  dragging everyone down. Without simulcast a single stream can't adapt per friend. Cloudflare sets
  it up from the host's SDP; the extra layers cost the host ~20–30% more upload.
- **Quality setting:** Auto (default, from WebRTC's upload estimate), or cap at 1080p / 720p / 480p.
- **Sound:** Opus stereo at 128 kbps with DTX off (measured above), instead of WebRTC's 33 kbps
  mono voice default.
- **Codec:** VP8 measured fine at 1080p30 on this PC (software encoder, no CPU limit hit). VP9/AV1
  save 30–50% bandwidth but cost more CPU; test on a mid-range laptop in 7b before switching.
  Movies use `contentHint = "motion"` and keep frame rate over resolution when squeezed.
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

### Together features

Compared with Teleparty, Rave, Kast, Discord and Watch2Gether (round 2), people expect:
no-signup invite links, chat, reactions, voice, and joining from a phone. For 2–6 friends:

| Feature | Phase | Notes |
|---|---|---|
| Invite link + room code, no accounts | 7a | Browser join (phones too) |
| Text chat, works in full screen | 7a | |
| Emoji reactions floating over the video | 7c | |
| **Ready check**: "Start in 3…2…1" once everyone is ready | 7c | Common complaint: someone isn't back yet |
| **Voice chat** (optional, mic off by default) | 7e | Rave, Kast and Discord have it. Cheap on the same SFU (~32 kbps per speaker). The movie **ducks** (lowers) while someone talks |
| **Up next** queue: the host lines up the next episode or film | 7e | |
| Video chat bubbles (webcams) | Later | Teleparty premium has it; costs bandwidth; not for v1 |

## 5. Things to handle

| Topic | Plan |
|---|---|
| **Subtitles** | `captureStream()` sends picture only, not subtitle tracks. The host sends the current subtitle cue over the room channel and friends render it (phase 4) |
| **Privacy** | No accounts; codes expire; the room server sees names, chat and controls. Video passes through Cloudflare's SFU, which only forwards it but could technically access it. **Later: end-to-end encryption** with SFrame (RFC 9605) via Chromium's encoded-transform API. Cloudflare's own Orange Meets already does E2EE over this SFU (MLS keys), so it's proven to work |
| **Weak networks** | Simulcast lets the SFU give each friend the layer their connection handles; friends behind strict routers connect through Cloudflare TURN (same free allowance) |
| **Host disconnects** | Room pauses with "Waiting for the host…"; the host rejoins with the same room for 2 minutes |
| **Legal** | Private, invite-only, max 6, no public room list. The UI says "Only share videos you have the right to share." Streaming a file to others can count as distribution; this is the user's responsibility, as with screen sharing in Discord or Zoom |

## 6. Phases

| Phase | Scope | Done when |
|---|---|---|
| **7a · Rooms** | Worker + Durable Object, room codes, join/leave, member list, chat; setup guide for the Cloudflare account | Two Grab windows (or Grab + test page) join one room and chat |
| **7b · Streaming** | Host publishes to the SFU, friends pull; simulcast; stereo 128 kbps sound; quality setting; keep-awake; CPU test on a mid-range laptop | Host + 2 friends on different networks (one on a phone hotspot) watch 30 min, under 1 s behind the host; the hotspot friend drops to a lower layer without affecting the other |
| **7c · Control** | Permissions (per person / everyone / ask), play/pause/seek from friends, overlays, reactions, ready check | A permitted friend pauses and seeks for everyone; a friend without permission can't; host revokes mid-movie |
| **7d · Polish** | Reconnects, host-left handling, subtitles, `grab://` join links, usage readout (GB this month) | A Wi-Fi drop recovers by itself; subtitles show for friends |
| **7e · Voice & queue** | Optional voice chat with movie ducking, Up next queue | Four people talk while the movie plays and dips under their voices; the next episode starts by itself |
| Later | End-to-end encryption (SFrame), webcam bubbles, self-host option (LiveKit on Oracle), MoQ when it's standard | |

## 7. Open questions

1. ~~Do friends need Grab installed?~~ **Decided: no.** A small web page (served by the same
   Worker) lets friends join from any browser, including phones. Grab joins rooms too, and is
   needed to host.
2. **Cloudflare account:** you need a free Cloudflare account to deploy the room server. Check
   whether Realtime asks for a payment method. If it does, set a spending alert so the free
   1,000 GB can't silently become a bill.
3. **Where the server code lives:** a `server/` folder in this repo (deployed with `wrangler`), so
   anyone can run their own.

## 8. Sources

- Cloudflare Realtime pricing (SFU + TURN, 1,000 GB free, egress only): https://developers.cloudflare.com/realtime/sfu/pricing and https://www.cloudflare.com/plans/
- Cloudflare TURN FAQ: https://developers.cloudflare.com/realtime/turn/faq/
- Cloudflare Realtime sessions and tracks (no rooms; app tracks membership): https://developers.cloudflare.com/realtime/sfu/sessions-tracks/ and https://developers.cloudflare.com/realtime/sfu/concepts/architecture/
- Durable Objects pricing (free plan limits, hibernation): https://developers.cloudflare.com/durable-objects/platform/pricing
- Cloudflare Realtime simulcast and supported codecs: https://developers.cloudflare.com/realtime/sfu/simulcast/ and https://developers.cloudflare.com/realtime/sfu/limits/
- Cloudflare end-to-end encryption guide (encoded transforms, beta): https://docs.realtime.cloudflare.com/guides/capabilities/misc/end-to-end-encryption
- SFrame, RFC 9605: https://www.rfc-editor.org/rfc/rfc9605
- LiveKit Cloud free plan (third-party summaries): https://micdrop.dev/blog/livekit-pricing
- Oracle Cloud Free Tier (10 TB egress): https://www.oracle.com/cloud/free/ and https://selfhost.it.com/blog/oci-free-tier-breakdown
- Media over QUIC status 2026: https://www.forasoft.com/blog/article/media-over-quic-moq-streaming-2026
- Watch party app comparison 2026: https://syncup.tv/blog/best-watch-party-apps-2026
- Opus stereo / high-bitrate SDP parameters: https://www.rfc-editor.org/rfc/rfc7587 and https://getstream.io/resources/projects/webrtc/advanced/dtx/
- `HTMLMediaElement.captureStream()`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream
- All the ways to send a video file over WebRTC (webrtcHacks, Feb 2024): https://webrtchacks.com/all-the-ways-to-send-a-video-file-over-webrtc/
- Chromium issue 1156408 reports (captureStream over a peer connection sends no data): https://gist.github.com/guest271314/01382c060755d06ff40658046cc7d23f
- Mesh vs SFU bandwidth: https://antmedia.io/webrtc-network-topology/
- Jellyfin SyncPlay (group wait/ready model): https://eb48e63b.jellyfin-org.pages.dev/developers/docs/api/syncplay
- Syncplay (how sync-based watch parties correct drift): https://syncplay.pl/about/syncplay/
