<div align="center">

# ⬡ PeerDrop

**Serverless P2P file sharing, video streaming & chat — in your browser.**

No sign-up, no servers, no limits.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

## What is PeerDrop?

PeerDrop lets you share files, stream video, and chat with anyone using just a 6-character room code. Everything happens directly between browsers via WebRTC — your data never touches a server.

## Quick Start

1. Open the app (host it or use GitHub Pages)
2. Enter a display name
3. Click **+ Create Room** — share the code or invite link
4. Others click **Join** and enter the code

That's it. Drop files, paste images, or type messages.

### Run Locally

```bash
git clone <repo>
cd PeerDrop
python -m http.server 8080
# or: npx serve .
```

Open `http://localhost:8080`. Never open `index.html` directly (`file://` blocks WebRTC).

## Features

- **File sharing** — drag, paste, or attach. No size limit. Direct P2P.
- **Video streaming** — click ▶ to stream without downloading.
- **Screen sharing** — broadcast your screen live.
- **Chat** — Markdown supported, typing indicators, relative timestamps.
- **End-to-end encryption** — AES-256-GCM, key derived from the room code.
- **Host migration** — if the host leaves, another peer takes over automatically.
- **Persistent history** — last 50 chat messages and file list survive refresh.
- **Dark/light theme** — toggle in the room header.
- **PWA** — installable on mobile and desktop.

## How it works

A Hybrid Star-Mesh model:
- **Host** relays signaling (chat, member updates, file announcements) via PeerJS
- **File transfers and video streams** go direct peer-to-peer — the host is never a bottleneck
- **TURN fallback** for strict NATs via Metered.ca relays

## Privacy

- No accounts, no tracking, no cloud
- Data flows directly between browsers
- Room disappears when everyone leaves
- Your name stays in your browser's localStorage

## License

MIT
