# 📡 PeerDrop

**Peer-to-peer file sharing — fast, encrypted, no cloud, no limits.**

A pure static web app. Open it in a browser — no installation, no server, no sign-up.

---

## Features

| Feature | PeerDrop |
|---|---|
| **Architecture** | Pure P2P via WebRTC (PeerJS) — no cloud storage |
| **File size limit** | ✅ None — limited only by device memory |
| **Encryption** | ✅ End-to-end (WebRTC mandatory encryption) |
| **Server needed?** | ❌ Zero — PeerJS provides free cloud signaling |
| **Share method** | 🔗 Link + QR code |
| **Progress** | ✅ Real-time speed, ETA, per-file + overall |
| **Multiple files** | ✅ Batch send |
| **Dark / Light mode** | ✅ Toggle |
| **Receiver downloads** | ✅ Individual download buttons |
| **Registration** | ❌ Not required |
| **Cross-platform** | ✅ Any device with a browser |

---

## How to Use

### 🚀 Quick start — just open the file!

1. Open `public/index.html` in a browser (or deploy it anywhere — Netlify, GitHub Pages, etc.)
2. That's it — no setup, no server, no dependencies.

### Sender flow
1. Click **Send Files**
2. Drag & drop files or click to browse
3. Share the generated link (or scan the QR code) with the receiver
4. When the receiver opens the link, transfer starts automatically

### Receiver flow
1. Open the link the sender shared (or paste it into the "Receive" page)
2. Wait for the connection — files arrive automatically
3. Click **Download** on each received file

---

## Project Structure

```
PeerDrop/
├── public/
│   ├── index.html        # Single-page app (open this in a browser)
│   ├── style.css         # All styles (dark/light, responsive)
│   └── js/
│       ├── utils.js      # Formatters, icons, toasts
│       ├── transfer.js   # File chunking + base64 transfer protocol
│       └── app.js        # Main UI controller + PeerJS integration
└── README.md
```

---

## How It Works

1. **PeerJS** provides free cloud-based WebRTC signaling. When you share a file, PeerJS helps the two browsers find each other and establish a direct P2P connection.

2. **Once connected**, all data flows directly between browsers — PeerJS is no longer involved in the transfer.

3. **Files are split into 16 KB chunks**, encoded as base64, and sent over the PeerJS data connection. The receiver decodes and reassembles them into Blob objects.

4. **No data is ever stored on a server.** Everything stays between the two connected devices.

---

## Deploy anywhere

Since it's 100% static, you can host PeerDrop on:
- **GitHub Pages** — `git push` to `gh-pages` branch
- **Netlify** — drag & drop the `public/` folder
- **Vercel** — point it at the `public/` directory
- **Any web server** — copy the `public/` folder to your server's web root
- **Local** — just double-click `index.html` (or `python -m http.server 8080`)

## License

MIT
