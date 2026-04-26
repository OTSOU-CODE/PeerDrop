# PeerDrop - Future Improvements & Roadmap

Here are several powerful improvements we can build into PeerDrop to take it from a solid P2P app to a professional-grade product. Since we are using modern Vanilla Web technologies, all of these are completely possible without needing a backend server!

## 1. 🛡️ End-to-End Encryption (E2EE)

Although the files are sent Peer-to-Peer, adding a layer of AES-GCM encryption using the built-in **Web Crypto API** would ensure that nobody—not even someone sniffing the Wi-Fi network—could ever intercept the files. We could generate an encryption key from the Room ID and seamlessly encrypt/decrypt the chunks during transmission.

## 2. ⏸️ Pausing and Resuming Large Files

Right now, if the internet drops for a second during a 2GB file transfer, the transfer fails and you have to start over. We could implement **Chunk Checkpointing**, where the receiver tells the sender exactly which bytes it successfully downloaded. If the connection drops, you simply click "Resume" and it picks up exactly where it left off.

## 3. 🖼️ Image and Video Previews

If someone drops a JPG or MP4, instead of showing a generic file chip, we could use JavaScript's `FileReader` to instantly generate a small, compressed thumbnail and display it directly in the chat feed like WhatsApp or iMessage.

## 5. 📁 Drag & Drop Folder Support

Instead of just sending individual files, we could use the new **File System Access API** to allow users to drag an entire folder onto the screen. The app would recursively read all the files, compress them into a `.zip` in the browser's memory, and send the whole folder at once.

## 8. 🔔 OS-Level Desktop Notifications

If you are doing other work in another tab, you might miss a file or chat. We can use the **Web Notifications API** to pop up a native Windows/Mac notification whenever someone joins the room or sends a message, so you never miss a transfer.

## 9. 📱 PWA (Progressive Web App) Installation

By adding a simple `manifest.json` and a Service Worker, we can make PeerDrop "installable" directly from the browser. Users could add it to their Windows taskbar or phone home screen, making it feel and act exactly like a native app.

## 10. 🖥️ Screen Sharing & Broadcasting

We can use the `getDisplayMedia()` API to add a "Share Screen" button. Instead of just sending files, the host or guest could broadcast their screen live to everyone else in the room in high quality, using the same WebRTC data connection.

## 11. ▶️ Direct Streaming (Play Without Downloading)

Instead of forcing the user to download an audio or video file before playing it, we can pipe the incoming data chunks directly into a `<video>` or `<audio>` HTML tag. This would allow users to instantly stream and watch a movie directly from the sender's hard drive without having to download it first.

## 12. 📋 Smart Clipboard Integration

If a user hits `CTRL + V` in the app, we can intercept the clipboard. If it's a screenshot, we send it as an image file automatically. If it's code, we send it formatted beautifully in a chat bubble with syntax highlighting.

## 13. 🧑‍🎨 Collaborative Whiteboard

We can add a toggle to open a shared HTML `<canvas>` overlay. Whenever anyone clicks and drags their mouse to draw, we send the coordinates over the WebRTC data channel. This turns the room into a live collaborative drawing board for sketches and diagrams.

## 14. 💾 Offline Persistence via IndexedDB

Currently, if you accidentally refresh the page, your chat history and file list are gone. By saving the room state and file chunks into the browser's native **IndexedDB**, you could close your laptop, open it an hour later, and immediately resume seeding files to the room.

## 17. 🎛️ Bandwidth Throttling Controls

When sending massive 50GB files, it might completely saturate the sender's home internet. We could add a slider that limits the chunk sending rate to exactly 5MB/s or 10MB/s, giving the user total control over their network usage.

## 18. 📝 Real-Time Code/Text Editor

Similar to Google Docs, we could embed a simple text editor box where multiple people in the room can type simultaneously. We'd synchronize their keystrokes instantly over the peer-to-peer connection for live pair-programming or taking meeting notes.
