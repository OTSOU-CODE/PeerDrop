<div align="center">

# ⬡ PeerDrop

**Serverless. Instant. Private.**

A real-time peer-to-peer file sharing, video streaming, and chat platform that runs entirely in the browser — no server, no sign-up, no limits.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vanilla JS](https://img.shields.io/badge/Built%20With-Vanilla%20JS-f7df1e?logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![WebRTC](https://img.shields.io/badge/Powered%20By-WebRTC-orange)](https://webrtc.org/)
[![PeerJS](https://img.shields.io/badge/Signaling-PeerJS%201.5-blueviolet)](https://peerjs.com/)
[![PWA](https://img.shields.io/badge/PWA-Ready-success)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)

[**→ Launch PeerDrop**](https://otsou-code.github.io/PeerDrop) · [Report Bug](https://github.com/OTSOU-CODE/PeerDrop/issues) · [Request Feature](https://github.com/OTSOU-CODE/PeerDrop/issues)

---

</div>

## Why PeerDrop?

| VS | PeerDrop | Cloud Services | Other P2P Tools |
|---|---|---|---|
| **Server needed?** | ❌ None | ✅ Yes (cloud) | ✅ Usually |
| **File size limit?** | ❌ None | ✅ 2-10GB | ✅ Varies |
| **Sign-up required?** | ❌ None | ✅ Required | ✅ Often |
| **Data touches server?** | ❌ Never | ✅ Always | ✅ Often |
| **Works offline?** | ⚠️ LAN only | ❌ No | ❌ No |

---

## Features

| Feature | Description |
|---|---|
| **🔗 P2P Architecture** | Hybrid Star-Mesh — host relays signaling, file transfers are direct peer-to-peer via WebRTC |
| **📁 File Sharing** | Drop, paste (CTRL+V), or attach any file. Image thumbnails auto-generated. No size limit. |
| **🎬 Video Streaming** | Stream videos directly without downloading — powered by `captureStream()` + WebRTC |
| **🖥️ Screen Sharing** | Broadcast your screen live to the room with one click |
| **💬 Real-time Chat** | Markdown support (bold, italic, code, links). Typing indicators. |
| **👥 Live Members** | Real-time sidebar with auto-generated color avatars |
| **📋 Share Links** | One-click invite link (`?#ROOMCODE`). Auto-join for returning users. |
| **🔔 Notifications** | Desktop notifications + tab title flashing when tab is hidden |
| **🔊 Audio Cues** | Subtle Web Audio API sounds for joins, shares, errors, and chat |
| **⚡ Particles** | Event-driven canvas particle bursts on file completions |
| **📱 Responsive** | Mobile-first layout adapts from desktop to phone |
| **⚙️ PWA** | Installable with `manifest.json` for home screen support |
| **🔒 Privacy** | No accounts, no tracking, no cloud — data never touches a server |

---

## Architecture

PeerDrop uses a **Hybrid Star-Mesh** model:

```
                  ┌──────────────┐
                  │     HOST     │  ◄── Signaling relay
                  │   (Relays)   │      room_state, chat, members
                  └──────┬───────┘
                  ╱      │      ╲
           Control  Control  Control
              │        │        │
         ┌────┴──┐  ┌──┴───┐  ┌──┴───┐
         │Guest A│  │Guest B│  │Guest C│
         └───────┘  └──────┘  └──────┘
               ╲               ╱
                 ──Direct P2P──
              (File & Video)
```

- **Control** — Chat, file announcements, member management flow through the Host via reliable DataChannels
- **Data** — File transfers and video streams go direct peer-to-peer (Host is never a bottleneck)

---

## Quick Start

### Browser

```
https://otsou-code.github.io/PeerDrop
```

### Local

```bash
git clone https://github.com/OTSOU-CODE/PeerDrop.git
cd PeerDrop

# Option A: Python
python -m http.server 8080

# Option B: Node
npx serve .

# Option C: VS Code Live Server
# Right-click index.html → Open with Live Server
```

Then open `http://localhost:8080` in two tabs or devices.

> ⚠️ **Never open `index.html` directly from the file system.** WebRTC is blocked under `file://`.

---

## Usage

1. **Enter your Display Name** — persists in `localStorage`
2. **Create or Join a Room** — 6-character code or invite link
3. **Share Files** — click 📎, drag & drop, or CTRL+V an image
4. **Stream Video** — click the purple **▶ Stream** button on shared videos
5. **Share Screen** — click 🖥️ to broadcast your screen live
6. **Chat** — Markdown supported: `**bold**`, `*italic*`, `` `code` ``, ``` ```code``` ```
7. **Leave** — click **Leave** in the room header

---

## Protocol — Message Types

| Type | Direction | Purpose |
|---|---|---|
| `hello` | Guest → Host | Register display name |
| `room_state` | Host → Guest | Sync files, chat history, members |
| `member_joined` | Host → All | New participant notification |
| `member_left` | Host → All | Departure notification |
| `announce` | Any → Host → All | File share announcement |
| `chat` | Any → Host → All | Chat message relay |
| `typing` | Any → Host → All | Typing indicator |
| `request_download` | Guest → Host | Request file transfer |
| `peer_wants_file` | Host → Owner | Instruct owner to send file |
| `request_stream` | Guest → Host | Request video stream |
| `peer_wants_stream` | Host → Owner | Instruct owner to start stream |

---

## Tech Stack

| Technology | Role |
|---|---|
| **HTML5** | Semantic structure |
| **Vanilla CSS3** | CSS Variables, glassmorphism, animations |
| **Vanilla ES6+ JS** | All logic — no frameworks, no bundlers |
| **[PeerJS](https://peerjs.com/)** | WebRTC signaling abstraction |
| **Web Audio API** | Audio synthesizer for UI sounds |
| **Canvas API** | Event-driven particle effects |
| **Service Worker** | PWA offline support |

---

## File Structure

```
PeerDrop/
├── index.html          # Application shell (Home + Room views)
├── app.js              # Core logic: P2P, UI, audio, particles (1438 lines)
├── style.css           # Design tokens, glassmorphism, animations
├── sw.js               # Service Worker for download streaming
├── manifest.json       # PWA manifest
└── README.md           # This file
```

---

## Configuration

ICE / STUN / TURN servers in `app.js`:

```javascript
const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // TURN for strict NAT:
      // { urls: 'turn:your.server:3478', username: 'user', credential: 'pass' }
    ]
  }
};
```

---

## Browser Support

| Browser | WebRTC | captureStream |
|---|---|---|
| Chrome 70+ | ✅ | ✅ |
| Firefox 70+ | ✅ | ✅ `mozCaptureStream` |
| Safari 14+ | ✅ | ⚠️ Limited |
| Edge 80+ | ✅ | ✅ |
| iOS Safari 14+ | ✅ | ❌ |

---

## Roadmap

- [ ] TURN server for strict NAT traversal
- [ ] IndexedDB persistence (files, chat history)
- [ ] End-to-end encryption (AES-GCM via Web Crypto API)
- [ ] Audio file streaming
- [ ] Emoji reactions on files / messages
- [ ] Multi-file ZIP download
- [ ] Optional room passwords

---

## Privacy

- **No accounts.** No email. No tracking.
- **No cloud storage.** Data flows directly between browsers.
- **Ephemeral rooms.** Room disappears when everyone leaves.
- **Names are local.** Stored only in your `localStorage`.

> PeerJS's public broker handles only the WebRTC handshake (ICE negotiation). No file data passes through it. For full privacy, self-host a PeerJS server.

---

## Contributing

1. Fork: [github.com/OTSOU-CODE/PeerDrop](https://github.com/OTSOU-CODE/PeerDrop)
2. Branch: `git checkout -b feature/your-idea`
3. Commit: `git commit -m 'feat: add awesome feature'`
4. Push: `git push origin feature/your-idea`
5. Open a PR

---

## License

MIT — see [`LICENSE`](LICENSE).

---

<div align="center">

Built with ☕ and vanilla code. No frameworks were harmed.

**[⬡ PeerDrop](https://otsou-code.github.io/PeerDrop)**

</div>
