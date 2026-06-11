<div align="center">

# ⬡ **PeerDrop**

**Serverless P2P Sharing · Files · Video · Chat**

<pre style="background:#0a0a0f;color:#8183f4;padding:16px;border-radius:12px;border:1px solid #6366f1;font-size:13px;line-height:1.5">
                                   ╭─────────────────────╮
    ┌──────┐  ┌──────┐  ┌──────┐  │  Direct P2P        │
    │  🖥️  │  │  📱  │  │  💻  │  │  No Server         │
    └──┬───┘  └──┬───┘  └──┬───┘  │  No Sign-up        │
       ╲        ╱╲        ╱       │  E2E Encrypted     │
        ╲      ╱  ╲      ╱        ╰─────────────────────╯
         ╲    ╱    ╲    ╱
          ╲  ╱      ╲  ╱
         ──╲╱────────╲╱──
         🌐 WebRTC Mesh Network
</pre>

[![License](https://img.shields.io/badge/License-MIT-6366f1?style=flat-square)](LICENSE)
[![Stack](https://img.shields.io/badge/Stack-Vanilla_JS-07080b?style=flat-square)]()
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P-22c55e?style=flat-square)]()

</div>

---

## 📋 Overview

PeerDrop creates **private rooms** where people can share files, stream video, and chat — all directly between their browsers. There are no servers holding your data, no accounts to create, and no file size limits.

| Concept | How it works |
|---|---|
| **Room** | A 6-character code acts as both the address and encryption key |
| **Host** | The creator relays signaling (who joined, new files, chat) |
| **Guests** | Everyone else — connect to host, then transfer directly to each other |
| **File transfer** | Direct WebRTC data channel between sender & receiver |
| **Encryption** | AES-256-GCM derived from the room code (Web Crypto API) |

---

## 🚀 Quick Start

### First time

```bash
git clone <repo>
cd PeerDrop
python -m http.server 8080
```

Open **`http://localhost:8080`** in two browser tabs or on two devices.

### Create & Share

| Step | Action | Result |
|---|---|---|
| 1 | Enter a display name | Stored in localStorage |
| 2 | Click **+ Create Room** | You become the host — a 6-char code appears |
| 3 | Click **Copy Link** or share the code | Others can join with one click |
| 4 | Drop files or paste images | Announced to the room, P2P transfer starts |
| 5 | Click **Leave** when done | Room dissolves — nothing is stored |

### Join a Room

| Step | Action |
|---|---|
| 1 | Enter your name |
| 2 | Type the 6-character room code or open an invite link |
| 3 | Click **Join** — you'll see shared files, chat history, and members |

---

## ✨ Features

### 📁 File Sharing

| Aspect | Detail |
|---|---|
| **How** | Click 📎, drag & drop onto the page, or paste (CTRL+V) images |
| **Size** | Unlimited — files transfer directly via WebRTC data channels |
| **Progress** | Live speed (MB/s), percentage, and ETA for both sender & receiver |
| **Preview** | Click image, text, or PDF files to preview inline |
| **Downloads** | Streamed through a Service Worker — no memory overflow on large files |
| **Dedup** | Same filename + size from the same user is only announced once |

### 🎬 Video Streaming

Click the **▶ Stream** button on any shared video file. The video is streamed live via WebRTC `captureStream()` — no need to download the whole file first. Quality selection (360p / 480p / 720p / Auto) adapts to bandwidth.

### 🖥️ Screen Sharing

Click the **🖥️** button to broadcast your screen to the room. Uses `getDisplayMedia()` — useful for presentations, demos, or collaborative work.

### 💬 Chat

| Feature | Detail |
|---|---|
| **Markdown** | `**bold**`, `*italic*`, `` `code` ``, `[links](url)` |
| **Timestamps** | Relative — "just now", "3m ago", "yesterday" (no clock skew issues) |
| **Typing indicator** | Shows when someone is typing, auto-clears after 3s |
| **History** | Last 50 messages persist in IndexedDB across refreshes |

### 🔒 Encryption

Everything sent through the room is encrypted with **AES-256-GCM**:

```
Room Code "X7K9M2"
     ↓
PBKDF2 (100,000 iterations, SHA-256)
     ↓
256-bit AES-GCM Key
     ↓
Encrypts every file chunk & chat message before it leaves your browser
```

The room code is the shared secret — anyone with the code can decrypt. This means the host can relay messages without reading them (host only sees ciphertext).

### 👥 Host Migration

If the host disconnects, the remaining peers elect a new host:

1. Each peer compares their ID against everyone else's
2. The **lowest ID** (lexicographic) becomes the new host
3. Random backoff (0-2s) prevents multiple hosts forming
4. The new host creates a PeerJS instance with the same room code
5. Other peers reconnect automatically

### 🎨 UI Features

| Feature | Description |
|---|---|
| **Dark / Light theme** | Toggle in the room header — persisted in localStorage |
| **QR code** | Shows the room invite as a scannable QR code |
| **Particles** | Canvas particle burst animation when downloads complete |
| **Ambient orbs** | CSS animated gradient orbs in the background |
| **Drag overlay** | Visual feedback when dragging files over the room |
| **PWA** | Installable on mobile & desktop home screen |
| **Notifications** | Desktop notifications + tab title flashing when minimized |

---

## 🏗 Architecture

```
┌──────────────┐
│    HOST      │  ◄── Relays signaling (chat, members, file announcements)
│  (PeerJS)    │       Forwards ciphertext — cannot read content
└──────┬───────┘
      ╱│╲
  ┌──┐ ┌──┐ ┌──┐
  │G1│ │G2│ │G3│  ◄── Control connections to host (reliable data channels)
  └──┘ └──┘ └──┘
    ╲        ╱
     ╲      ╱       ◄── Direct P2P data channels for file transfers
      ╲    ╱           WebRTC media streams for video
       ╲  ╱
    Direct P2P
```

| Layer | Technology | Purpose |
|---|---|---|
| **Signaling** | PeerJS (0.peerjs.com) | ICE handshake, peer discovery |
| **Control** | Reliable DataChannels | Chat, member state, file metadata |
| **Data** | Unreliable DataChannels | Large file chunk transfer (SCTP flow control) |
| **Media** | WebRTC MediaStream | Video streaming, screen sharing |
| **Encryption** | Web Crypto API (AES-256-GCM) | End-to-end payload encryption |
| **Persistence** | IndexedDB | Chat history, file announcements |
| **Streaming** | Service Worker + ReadableStream | Download files without full memory buffering |

---

## 🛠 Tech Stack

| Component | What it does |
|---|---|
| **Vanilla JS (ES modules)** | All logic — 10 modules under `src/js/` |
| **PeerJS 1.5** | WebRTC signaling abstraction over PeerJS cloud broker |
| **Web Crypto API** | PBKDF2 key derivation + AES-256-GCM encrypt/decrypt |
| **Service Worker** | Intercepts download URLs, streams chunks via MessageChannel |
| **IndexedDB** | Persists chat history and file list across sessions |
| **Canvas API** | Particle burst effects on file completion |
| **Web Audio API** | Synthesized UI sounds (join, share, error, chime) |

---

## 🔐 Privacy & Security

| Concern | How PeerDrop handles it |
|---|---|
| **Data storage** | Nothing stored on servers — data flows browser-to-browser |
| **Encryption** | AES-256-GCM using room code as shared secret |
| **Signaling** | PeerJS broker only sees ICE handshake — never the payload |
| **TURN relays** | Metered.ca relays used only when direct P2P fails — encrypted payload |
| **Room lifetime** | Room disappears when the last person leaves |
| **Account** | No accounts, no email, no tracking |

---

## 📄 License

MIT — see [`LICENSE`](LICENSE).

---

<div align="center"><sub>Built with vanilla JavaScript · No frameworks · No telemetry · No servers</sub></div>
