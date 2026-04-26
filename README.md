<div align="center">

```
  ⬡ PeerDrop
```

# PeerDrop

**Serverless. Instant. Private.**

A real-time peer-to-peer file sharing, video streaming, and chat platform that runs entirely in the browser — no server, no sign-up, no limits.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vanilla JS](https://img.shields.io/badge/Built%20With-Vanilla%20JS-f7df1e?logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![WebRTC](https://img.shields.io/badge/Powered%20By-WebRTC-orange)](https://webrtc.org/)
[![PeerJS](https://img.shields.io/badge/Signaling-PeerJS%201.5-blueviolet)](https://peerjs.com/)

[**→ Open PeerDrop**](https://otsou-code.github.io/PeerDrop) · [Report a Bug](https://github.com/OTSOU-CODE/PeerDrop/issues) · [Request Feature](https://github.com/OTSOU-CODE/PeerDrop/issues)

</div>

---

## ✨ What is PeerDrop?

PeerDrop creates instant, ephemeral sharing rooms in your browser. Once you generate a room code, every device that joins can share files, stream videos, and chat in real-time — directly device-to-device, with **zero data touching any third-party server**.

> Files go from your browser → directly to theirs. That's it.

---

## 🚀 Key Features

| Feature | Description |
|---|---|
| **🔗 P2P Architecture** | Hybrid Star-Mesh topology. Host relays signaling; file transfers are direct peer-to-peer via WebRTC DataChannels. |
| **📁 File Sharing** | Drop, paste (CTRL+V), or attach any file. Image thumbnails are auto-generated for previews. |
| **🎬 Live Video Streaming** | Stream video files directly to other peers without anyone downloading the file — powered by `captureStream()` and WebRTC media channels. |
| **🖥️ Screen Sharing** | Broadcast your screen live to everyone in the room with a single click. |
| **💬 Real-time Chat** | In-room text chat with Markdown support (bold, italic, inline code, code blocks, links). |
| **👥 Live Member Sidebar** | See every person in the room in real-time. Members are tagged with colorful auto-generated avatars derived from their names. |
| **🔒 Mandatory Identity** | Every user must set a Display Name before entering. Names persist via `localStorage`. |
| **🔔 Desktop Notifications** | Opt-in browser notifications for new files and messages when the tab is hidden. |
| **📣 Tab Alert System** | Browser tab title flashes with an unread indicator when a new message arrives. |
| **🔊 Audio Feedback** | A zero-dependency Web Audio API synthesizer provides subtle audio cues for joins, file shares, errors, and chat. |
| **⚡ Optimized Particles** | Canvas particle engine is event-driven — it sleeps when idle and fires a burst only on meaningful events (e.g., file completion). |
| **📋 Share Links** | One-click copy of a direct invite link (`?#ROOMCODE`). Recipients with a saved name auto-join; new users are prompted to register one first. |
| **📱 Fully Responsive** | Mobile-first layout that gracefully adapts from desktop grids to stacked mobile views. |
| **⚙️ PWA Ready** | Includes a `manifest.json` for "Add to Home Screen" support. |

---

## 🏗️ Architecture

PeerDrop uses a **Hybrid Star-Mesh** network model:

```
                  ┌──────────────┐
                  │     HOST     │  ◄── Holds signaling state
                  │   (Relays)   │      Broadcasts room_state
                  └──────┬───────┘
                  ╱      │      ╲
           Control  Control  Control
              │        │        │
         ┌────┴──┐  ┌──┴───┐  ┌──┴───┐
         │ GuestA│  │GuestB│  │GuestC│
         └───────┘  └──────┘  └──────┘
               ╲               ╱
                 ──Direct P2P──
              (File & Video Transfers)
```

- **Control connections** (`DataChannel`, reliable) flow through the Host for chat, file announcements, and member management.
- **Data transfers** (files, video streams) are routed **directly** between peers using dedicated P2P `DataChannel` and `MediaChannel` connections, so the Host is never a bottleneck.

---

## 📡 Protocol — Message Types

| `type` | Direction | Purpose |
|---|---|---|
| `hello` | Guest → Host | Registers display name on join |
| `room_state` | Host → Guest | Full sync of files, chat history, and member list |
| `member_joined` | Host → All Guests | Notifies room of a new participant |
| `member_left` | Host → All Guests | Notifies room of a departure |
| `announce` | Any → Host → All | Announces a newly shared file |
| `chat` | Any → Host → All | Broadcasts a chat message |
| `typing` | Any → Host → All | Typing indicator relay |
| `request_download` | Guest → Host | Requests a file transfer |
| `peer_wants_file` | Host → Owner | Instructs owner to initiate transfer |
| `request_stream` | Guest → Host | Requests a live video stream |
| `peer_wants_stream` | Host → Owner | Instructs owner to begin streaming |

---

## 🛠️ Tech Stack

This project is intentionally **zero-dependency** on the front-end build side. Everything runs natively in the browser.

| Technology | Role |
|---|---|
| **HTML5** | Semantic structure |
| **Vanilla CSS3** | Modular styles, CSS Variables, glassmorphism, animations |
| **Vanilla ES6+ JS** | All logic — no frameworks, no bundlers |
| **[PeerJS v1.5](https://peerjs.com/)** | WebRTC abstraction for signaling & connections |
| **Web Audio API** | Zero-dependency audio synthesizer for UI sounds |
| **Canvas API** | On-demand particle burst engine |
| **`HTMLMediaElement.captureStream()`** | Video file streaming over WebRTC |

---

## 🚦 Getting Started

### Option 1 — GitHub Pages (Recommended)

Just visit the live deployment link. No installation required.

### Option 2 — Run Locally

Because WebRTC requires a proper HTTP origin (not `file://`), you need a local server.

```bash
# Clone the repository
git clone https://github.com/OTSOU-CODE/PeerDrop.git
cd PeerDrop

# Serve with any static server, e.g. using Python:
python -m http.server 8080

# Or using Node.js:
npx serve .
```

Then open `http://localhost:8080` in two different browser tabs or devices on the same network.

> ⚠️ **Do NOT open `index.html` directly from your file system.** Browsers block WebRTC when using the `file://` protocol. Always use a local HTTP server.

---

## 📂 File Structure

```
PeerDrop/
│
├── index.html          # Main application shell & all views (Home + Room)
├── app.js              # Full application logic (P2P, UI, audio, particles)
├── style.css           # All styles (design tokens, components, animations)
├── manifest.json       # PWA manifest for home screen installation
├── improvement.md      # Dev roadmap and improvement log
└── README.md           # This file
```

---

## 📋 How to Use

1. **Enter your Display Name** — Required. Persists across sessions via `localStorage`.
2. **Create or Join a Room:**
   - Click **+ Create Room** to generate a unique 6-character room code.
   - Share the code or the auto-generated invite link with others.
   - Anyone with the link can paste the code and click **Join**.
3. **Share Files:**
   - Click the 📎 button, drag & drop files onto the page, or paste (`CTRL+V`) an image from clipboard.
   - All participants see the file immediately and can **↓ Download** it.
4. **Stream Video:**
   - When a video file is shared, a purple **▶ Stream** button appears for other users.
   - Click it to watch the video inline in the feed without downloading it.
5. **Share Your Screen:**
   - Click the 🖥️ button to broadcast your screen live to the room.
6. **Chat:**
   - Type in the message box and hit **Send**. Markdown is supported.
7. **Leave:**
   - Click the **Leave** button in the room header.

---

## ⚙️ Configuration

ICE servers can be updated in `app.js` under `PEER_CONFIG`:

```javascript
const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // Add a TURN server here for production NAT traversal:
      // {
      //   urls: 'turn:your.turn.server:3478',
      //   username: 'user',
      //   credential: 'password'
      // }
    ]
  }
};
```

---

## 🗺️ Roadmap

- [ ] **TURN Server Integration** — Reliable connections across strict NAT/firewalls
- [ ] **IndexedDB Persistence** — Retain file list and chat history across page refreshes
- [ ] **End-to-End Encryption** — E2EE via Web Crypto API (AES-GCM)
- [ ] **Audio Streaming** — Peer-to-peer music/audio file streaming (same as video)
- [ ] **Reaction Emojis** — React to shared files and messages
- [ ] **Multi-file Zip Download** — Batch-download all files in the room as a `.zip`
- [ ] **Room Passwords** — Optional password protection for private rooms

---

## 🔐 Privacy & Security

- **No accounts.** No email. No tracking.
- **No cloud storage.** Files never touch a server. Data flows directly between browsers.
- **Ephemeral rooms.** When all participants leave, the room ceases to exist.
- **Display names are local.** They are stored only in `localStorage` on your own device.

> Note: PeerJS's public signaling server is used for the initial WebRTC handshake only (exchanging ICE candidates). No file data ever passes through it. For full privacy, host your own PeerJS server.

---

## 🤝 Contributing

Contributions, bug reports, and feature suggestions are welcome!

1. Fork the repository: [github.com/OTSOU-CODE/PeerDrop](https://github.com/OTSOU-CODE/PeerDrop)
2. Create your feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m 'feat: add awesome feature'`
4. Push to the branch: `git push origin feature/your-feature-name`
5. Open a Pull Request

---

## 📜 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

---

<div align="center">

Built with ☕ and vanilla code. No frameworks were harmed in the making of this project.

**[⬡ PeerDrop](https://otsou-code.github.io/PeerDrop)**

</div>
