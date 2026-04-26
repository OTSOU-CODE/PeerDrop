/**
 * PeerDrop — app.js (Mesh Room Architecture)
 * Hybrid Star-Mesh: Host relays signaling, peers transfer files directly.
 */
'use strict';

const CHUNK_SIZE = 64 * 1024;

// ── DOM Helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => { const e = $(id); if (e) { e.hidden = false; e.style.display = ''; } };
const hide = id => { const e = $(id); if (e) e.hidden = true; };
const fmt = b => {
  if (!b) return '0 B';
  const k = 1024, u = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(2) + ' ' + u[i];
};
const mimeEmoji = t => {
  if (!t) return '📁';
  if (t.startsWith('image/')) return '🖼️';
  if (t.startsWith('video/')) return '🎬';
  if (t.startsWith('audio/')) return '🎵';
  if (t.includes('zip')||t.includes('rar')) return '📦';
  return '📄';
};

// ── UI Enhancements ──────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = $('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span style="font-size:1.2rem">${type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️'}</span> <div>${message}</div>`;
  container.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 400);
  }, 4000);
}

function updatePulse(state) {
  const pcd = $('peer-count-display');
  if (!pcd) return;
  if (state === 'connecting') pcd.innerHTML = '<span class="status-pulse connecting"></span>Connecting...';
  else if (state === 'offline') pcd.innerHTML = '<span class="status-pulse offline"></span>Offline';
  else pcd.innerHTML = `<span class="status-pulse"></span>${state}`;
}

function getAvatarParams(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (Math.abs(hash) * 2) % 360;
  return { letter: id.charAt(0).toUpperCase(), bg: `linear-gradient(135deg, hsl(${hue1}, 80%, 60%), hsl(${hue2}, 80%, 40%))` };
}

// ── Audio Synthesizer ────────────────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  if (type === 'pop') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(600, now); osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
    gain.gain.setValueAtTime(0.3, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now); osc.stop(now + 0.1);
  } else if (type === 'whoosh') {
    osc.type = 'triangle'; osc.frequency.setValueAtTime(150, now); osc.frequency.linearRampToValueAtTime(400, now + 0.2);
    gain.gain.setValueAtTime(0.1, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  } else if (type === 'chime') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(800, now); osc.frequency.exponentialRampToValueAtTime(1200, now + 0.3);
    gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc.start(now); osc.stop(now + 0.5);
  } else if (type === 'error') {
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, now); osc.frequency.exponentialRampToValueAtTime(100, now + 0.15);
    gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.start(now); osc.stop(now + 0.15);
  }
}

// ── Attention Stealer ────────────────────────────────────────────────────────
let originalTitle = document.title;
let alertInterval = null;
let isAlerting = false;
function flashTabTitle(msg) {
  if (!document.hidden) return;
  if (isAlerting) clearInterval(alertInterval);
  isAlerting = true;
  let toggle = false;
  alertInterval = setInterval(() => {
    document.title = toggle ? `(1) ${msg}` : originalTitle;
    toggle = !toggle;
  }, 1000);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isAlerting) {
    clearInterval(alertInterval);
    document.title = originalTitle;
    isAlerting = false;
  }
});

// ── State ────────────────────────────────────────────────────────────────────
const MY_ID = Array.from(crypto.getRandomValues(new Uint8Array(6)))
  .map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

const savedName = localStorage.getItem('peerdrop_name');
let MY_NAME = savedName || 'Guest_' + Math.floor(Math.random() * 1000);

const nameInput = $('input-display-name');
if (nameInput) {
  nameInput.value = savedName || '';
  nameInput.addEventListener('input', e => {
    MY_NAME = e.target.value.trim() || 'Guest_' + Math.floor(Math.random() * 1000);
    localStorage.setItem('peerdrop_name', MY_NAME);
  });
}

const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  }
};

let peer = null;
let role = null; // 'host' or 'guest'
let hostConn = null; 
let guestConns = new Map(); // id -> DataConnection (host only)

let roomMembers = new Map(); // id -> { name }

let mySharedFiles = new Map(); // fileId -> File object
let allKnownFiles = new Map(); // fileId -> { id, name, size, mime, ownerId }
let chatHistory = []; // Array of { type: 'chat', text, senderId, time }

// Streaming download: maps fileId -> FileSystemWritableFileStream
// When File System Access API is available, we write each chunk directly to disk.
const fileWritableStreams = new Map();

let localStream = null;
let activeCalls = new Map();
let typingTimer = null;

// ── Background Particles ─────────────────────────────────────────────────────
window.triggerParticleBurst = () => {};
(function initParticles() {
  const c = $('particles');
  if (!c) return;
  const ctx = c.getContext('2d');
  let W, H;
  const resize = () => { W = c.width = innerWidth; H = c.height = innerHeight; };
  resize(); window.addEventListener('resize', resize);
  
  const pts = [];
  let isAnimating = false;

  window.triggerParticleBurst = (x, y) => {
    for(let i=0; i<30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4 + 1;
      pts.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        r: Math.random() * 2 + 1.5, a: 1.0, decay: Math.random() * 0.02 + 0.01
      });
    }
    if (!isAnimating) {
      isAnimating = true;
      frame();
    }
  };

  function frame() {
    ctx.clearRect(0,0,W,H);
    if (pts.length === 0) {
      isAnimating = false;
      return;
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(14, 165, 233,${p.a})`; ctx.fill();
      p.x+=p.vx; p.y+=p.vy;
      if (p.decay) {
        p.a -= p.decay;
        if (p.a <= 0) { pts.splice(i, 1); }
      }
    }
    requestAnimationFrame(frame);
  }
})();

// ── Notifications & Clipboard ────────────────────────────────────────────────
let notificationsEnabled = false;
if ("Notification" in window) {
  if (Notification.permission === "granted") notificationsEnabled = true;
}
const notifBtn = $('notif-btn');
if (notifBtn) {
  notifBtn.addEventListener('click', () => {
    if ("Notification" in window) {
      Notification.requestPermission().then(p => {
        if (p === "granted") {
          notificationsEnabled = true;
          notifBtn.textContent = '🔔';
          showToast("Desktop notifications enabled!", "success");
        }
      });
    }
  });
}
function notify(title, body) {
  flashTabTitle(title);
  if (notificationsEnabled && document.hidden) {
    new Notification(title, { body });
  }
}

window.addEventListener('paste', e => {
  if (role !== 'host' && (!hostConn || !hostConn.open)) return;
  if (e.clipboardData.files && e.clipboardData.files.length > 0) {
    e.preventDefault();
    handleFilesSelected(Array.from(e.clipboardData.files));
  }
});

// ── Init UI ──────────────────────────────────────────────────────────────────
function validateName() {
  const inputName = $('input-display-name');
  if (inputName) {
    const val = inputName.value.trim();
    if (!val) {
      inputName.classList.remove('error-shake');
      void inputName.offsetWidth;
      inputName.classList.add('error-shake');
      showToast("Please enter your display name.", "error");
      playSound('error');
      return false;
    }
    MY_NAME = val;
    localStorage.setItem('peerdrop_name', MY_NAME);
  }
  return true;
}

$('btn-create-room').addEventListener('click', () => {
  if (validateName()) initPeer(true, MY_ID);
});

$('btn-join-room').addEventListener('click', () => {
  if (!validateName()) return;
  const code = $('input-join-code').value.toUpperCase().trim();
  if (code.length >= 4) {
    $('join-error').hidden = true;
    initPeer(false, code);
  }
});

// Auto-join if hash is present
const hashId = window.location.hash.replace('#', '').toUpperCase().trim();
if (hashId.length >= 4) {
  const hasName = localStorage.getItem('peerdrop_name');
  if (hasName && hasName.trim().length > 0) {
    initPeer(false, hashId);
  } else {
    $('input-join-code').value = hashId;
    show('home-view');
    hide('room-view');
  }
} else {
  show('home-view');
  hide('room-view');
}

$('btn-leave-room').addEventListener('click', () => {
  window.location.hash = '';
  window.location.reload();
});

// File Protocol Warning
if (window.location.protocol === 'file:') {
  const warn = document.createElement('div');
  warn.style = "background: #ef4444; color: white; text-align: center; padding: 10px; font-weight: bold; position: fixed; top: 0; left: 0; right: 0; z-index: 9999;";
  warn.innerHTML = "⚠️ You are opening this file directly from your hard drive (file://). Browsers block WebRTC connections this way! <br/> Please push to GitHub Pages or use a local HTTP server.";
  document.body.appendChild(warn);
}

$('btn-copy-link').addEventListener('click', () => {
  const url = `${location.origin}${location.pathname}#${$('room-code-display').textContent}`;
  navigator.clipboard.writeText(url).then(() => {
    $('btn-copy-link').textContent = 'Copied!';
    setTimeout(() => { $('btn-copy-link').textContent = 'Copy Link'; }, 2000);
  });
});

// ── Input & Drop Zone ────────────────────────────────────────────────────────
const roomView = $('room-view');
const fileInput = $('room-file-input');
const chatInput = $('chat-input');

// Global drop zone for the room
roomView.addEventListener('dragover', e => { e.preventDefault(); roomView.classList.add('drag-active'); });
roomView.addEventListener('dragleave', () => { roomView.classList.remove('drag-active'); });
roomView.addEventListener('drop', e => {
  e.preventDefault();
  roomView.classList.remove('drag-active');
  if (e.dataTransfer.files.length > 0) handleFilesSelected(e.dataTransfer.files);
});

$('btn-attach').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  if (e.target.files.length > 0) handleFilesSelected(e.target.files);
  fileInput.value = '';
});

// Chat sending
$('btn-send-chat').addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', e => { 
  if (e.key === 'Enter') sendChatMessage(); 
  else handleTyping();
});

function handleTyping() {
  const msg = { type: 'typing', senderId: MY_ID };
  if (role === 'host') broadcast(msg);
  else if (hostConn && hostConn.open) hostConn.send(msg);
}

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text) {
    chatInput.classList.remove('error-shake');
    void chatInput.offsetWidth;
    chatInput.classList.add('error-shake');
    playSound('error');
    return;
  }
  chatInput.value = '';
  playSound('pop');

  const msg = { type: 'chat', text, senderId: MY_ID, senderName: MY_NAME, time: Date.now() };
  if (role === 'host') {
    chatHistory.push(msg);
    addChatToFeed(msg);
    broadcast(msg);
  } else {
    if (hostConn && hostConn.open) {
      chatInput.value = '';
      addChatToFeed(msg); // Show locally
      hostConn.send(msg); // Send to host
    } else {
      showToast("Not connected to the room yet!", "error");
    }
  }
}

// ── Screen Sharing ───────────────────────────────────────────────────────────
$('btn-share-screen').addEventListener('click', async () => {
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      addVideoStream(MY_ID, localStream, true);

      // Call everyone we know
      if (role === 'host') {
        for (const [guestId, _] of guestConns) {
          const call = peer.call(guestId, localStream);
          handleCall(call);
        }
      } else if (hostConn && hostConn.open) {
        const call = peer.call(hostConn.peer, localStream);
        handleCall(call);
      }
      
      localStream.getVideoTracks()[0].onended = () => stopScreenShare();
      $('btn-share-screen').style.color = '#ef4444';
    } catch (err) {
      console.error("Screen share failed", err);
    }
  } else {
    stopScreenShare();
  }
});

function stopScreenShare() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  removeVideoStream(MY_ID);
  for (const [id, call] of activeCalls) call.close();
  activeCalls.clear();
  $('btn-share-screen').style.color = '';
}

function handleCall(call) {
  const isVideoFile = call.metadata && call.metadata.type === 'video_stream';
  activeCalls.set(call.peer, call);
  call.on('stream', remoteStream => {
    addVideoStream(call.peer, remoteStream, false, isVideoFile);
  });
  call.on('close', () => {
    removeVideoStream(call.peer);
    activeCalls.delete(call.peer);
  });
}

function addVideoStream(peerId, stream, isLocal, isVideoFile = false) {
  const container = $('file-feed');
  let video = $(`video-${peerId}`);
  if (!video) {
    const wrap = document.createElement('div');
    wrap.id = `video-wrap-${peerId}`;
    wrap.style = "position:relative; margin-bottom: 15px; border-radius: 12px; overflow: hidden; border: 1px solid var(--accent-dim); background: #000;";
    
    video = document.createElement('video');
    video.id = `video-${peerId}`;
    video.style = "width: 100%; display: block;";
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true;
    else if (isVideoFile) video.controls = true; // Let them control volume if streaming a file
    
    const label = document.createElement('div');
    label.style = "position: absolute; bottom: 8px; left: 8px; background: rgba(0,0,0,0.6); padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; color: #fff;";
    const mem = roomMembers.get(peerId);
    const name = mem ? mem.name : peerId;
    label.textContent = isLocal ? "Your Screen" : (isVideoFile ? `Watching with ${name}` : `${name}'s Screen`);

    wrap.appendChild(video);
    wrap.appendChild(label);
    container.insertBefore(wrap, container.firstChild);
    hide('empty-feed-msg');
  }
  video.srcObject = stream;
  video.play().catch(e => console.error("Video play error:", e));
}

function removeVideoStream(peerId) {
  const wrap = $(`video-wrap-${peerId}`);
  if (wrap) wrap.remove();
}

// ── PeerJS Setup ─────────────────────────────────────────────────────────────
function initPeer(isCreatingHost, targetHostId) {
  $('btn-create-room').textContent = 'Starting...';
  $('btn-join-room').textContent = 'Joining...';

  // If I am host, I use my generated MY_ID. If I am guest, I use a random internal ID.
  peer = new Peer(isCreatingHost ? MY_ID : null, PEER_CONFIG);

  peer.on('open', id => {
    hide('home-view');
    show('room-view');
    
    if (isCreatingHost) {
      role = 'host';
      $('room-code-display').textContent = id;
      roomMembers.set(MY_ID, { name: MY_NAME });
      renderUserList();
      updateParticipantCount();
    } else {
      role = 'guest';
      $('room-code-display').textContent = targetHostId;
      connectToHost(targetHostId);
    }
  });

  // Listen for incoming connections
  peer.on('connection', conn => {
    // Is it a direct file transfer connection?
    if (conn.metadata && conn.metadata.transferFileId) {
      handleIncomingFileTransfer(conn, conn.metadata.transferFileId);
      return;
    }

    // Otherwise, it's a control connection
    if (role === 'host') {
      setupHostControlConnection(conn);
    }
  });

  peer.on('call', call => {
    if (localStream) {
      call.answer(localStream);
    } else {
      call.answer(); 
    }
    handleCall(call);
  });

  peer.on('error', err => {
    console.error('[PeerJS Error]', err);
    if (role === null) {
      // Failed during connect
      $('btn-create-room').textContent = '+ Create Room';
      $('btn-join-room').textContent = 'Join';
      $('join-error').hidden = false;
      $('join-error').textContent = 'Could not connect to network or room.';
      showToast("Connection failed", "error");
    } else {
      showToast(err.message || "Network Error", "error");
    }
  });
}

// ── Host Logic ───────────────────────────────────────────────────────────────
function setupHostControlConnection(conn) {
  conn.on('open', () => {
    guestConns.set(conn.peer, conn);
    // Note: We don't send room_state here anymore.
    // We wait for the 'hello' message from the guest first.
  });

  conn.on('data', data => {
    if (data.type === 'hello') {
      roomMembers.set(conn.peer, { name: data.name });
      updateParticipantCount();
      renderUserList();
      
      // Broadcast new member to everyone
      broadcast({ type: 'member_joined', member: { id: conn.peer, name: data.name } }, conn.peer);
      
      // Send current room state to new guest
      conn.send({
        type: 'room_state',
        files: Array.from(allKnownFiles.values()),
        chat: chatHistory,
        members: Array.from(roomMembers.entries()).map(([id, val]) => ({id, name: val.name}))
      });
      
      showToast(`${data.name} joined the room.`, "info");
      playSound('chime');
    }
    else if (data.type === 'chat') {
      chatHistory.push(data);
      addChatToFeed(data);
      broadcast(data, conn.peer);
    }
    else if (data.type === 'typing') {
      showTypingIndicator(data.senderId);
      broadcast(data, conn.peer);
    }
    else if (data.type === 'announce') {
      // Save it locally
      allKnownFiles.set(data.file.id, data.file);
      addFileToFeed(data.file);
      // Broadcast to all other guests
      broadcast({ type: 'announce', file: data.file }, conn.peer);
    }
    else if (data.type === 'request_download') {
      // Guest A wants a file.
      const file = allKnownFiles.get(data.fileId);
      if (!file) return;

      if (file.ownerId === MY_ID) {
        // I own the file, initiate transfer directly
        initiateFileTransfer(data.requesterId, file.id);
      } else {
        // Someone else owns it, tell them to send it to the requester
        const ownerConn = guestConns.get(file.ownerId);
        if (ownerConn) {
          ownerConn.send({
            type: 'peer_wants_file',
            fileId: file.id,
            requesterId: data.requesterId
          });
        }
      }
    }
    else if (data.type === 'request_stream') {
      // Guest A wants to stream a video file.
      const file = allKnownFiles.get(data.fileId);
      if (!file) return;

      if (file.ownerId === MY_ID) {
        initiateVideoStreaming(data.requesterId, file.id);
      } else {
        const ownerConn = guestConns.get(file.ownerId);
        if (ownerConn) {
          ownerConn.send({
            type: 'peer_wants_stream',
            fileId: file.id,
            requesterId: data.requesterId
          });
        }
      }
    }
  });

  conn.on('close', () => {
    guestConns.delete(conn.peer);
    const leftMem = roomMembers.get(conn.peer);
    if (leftMem) {
      roomMembers.delete(conn.peer);
      broadcast({ type: 'member_left', id: conn.peer });
      renderUserList();
      showToast(`${leftMem.name} left the room.`, "info");
    }
    updateParticipantCount();
  });
}

function broadcast(msg, excludePeerId = null) {
  for (const [id, c] of guestConns) {
    if (id !== excludePeerId && c.open) {
      c.send(msg);
    }
  }
}

function updateParticipantCount() {
  const count = guestConns.size + 1;
  updatePulse(`${count} participant${count > 1 ? 's' : ''}`);
}

// ── Guest Logic ──────────────────────────────────────────────────────────────
function connectToHost(hostId) {
  hostConn = peer.connect(hostId, { reliable: true });
  
  hostConn.on('open', () => {
    updatePulse('Connected to room');
    showToast("Joined room successfully", "success");
    playSound('chime');
    hostConn.send({ type: 'hello', name: MY_NAME });
  });

  hostConn.on('data', data => {
    if (data.type === 'room_state') {
      data.files.forEach(f => {
        allKnownFiles.set(f.id, f);
        addFileToFeed(f);
      });
      if (data.chat) data.chat.forEach(addChatToFeed);
      
      roomMembers.clear();
      data.members.forEach(m => roomMembers.set(m.id, { name: m.name }));
      renderUserList();
    }
    else if (data.type === 'member_joined') {
      roomMembers.set(data.member.id, { name: data.member.name });
      renderUserList();
      if (data.member.id !== MY_ID) {
        showToast(`${data.member.name} joined the room.`, "info");
        playSound('pop');
      }
    }
    else if (data.type === 'member_left') {
      const mem = roomMembers.get(data.id);
      if (mem) showToast(`${mem.name} left the room.`, "info");
      roomMembers.delete(data.id);
      renderUserList();
    }
    else if (data.type === 'chat') {
      addChatToFeed(data);
    }
    else if (data.type === 'typing') {
      showTypingIndicator(data.senderId);
    }
    else if (data.type === 'announce') {
      allKnownFiles.set(data.file.id, data.file);
      addFileToFeed(data.file);
    }
    else if (data.type === 'peer_wants_file') {
      // The host says someone wants a file I own.
      initiateFileTransfer(data.requesterId, data.fileId);
    }
    else if (data.type === 'peer_wants_stream') {
      // The host says someone wants to stream my video file.
      initiateVideoStreaming(data.requesterId, data.fileId);
    }
  });

  hostConn.on('close', () => {
    updatePulse('offline');
    showToast("Room host disconnected.", "error");
    setTimeout(() => {
      window.location.hash = '';
      window.location.reload();
    }, 2000);
  });
}

// ── Sharing Files ────────────────────────────────────────────────────────────
function handleFilesSelected(files) {
  for (const file of files) {
    playSound('whoosh');
    const fileId = 'f_' + Math.random().toString(36).substr(2, 9);
    mySharedFiles.set(fileId, file);

    const fileMeta = {
      id: fileId,
      name: file.name,
      size: file.size,
      mime: file.type,
      ownerId: peer.id
    };

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_W = 150;
          const scale = Math.min(MAX_W / img.width, 1);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          fileMeta.thumbnail = canvas.toDataURL('image/jpeg', 0.5);
          finishFileAnnounce(fileId, fileMeta);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    } else {
      finishFileAnnounce(fileId, fileMeta);
    }
  }
}

function finishFileAnnounce(fileId, fileMeta) {
    allKnownFiles.set(fileId, fileMeta);
    addFileToFeed(fileMeta);

    // Announce to network
    const msg = { type: 'announce', file: fileMeta };
    if (role === 'host') {
      broadcast(msg);
    } else {
      if (hostConn && hostConn.open) {
        hostConn.send(msg);
      } else {
        showToast("Not connected! Cannot share file.", "error");
      }
    }
}

// ── Feed UI ──────────────────────────────────────────────────────────────────
function addFileToFeed(fileMeta) {
  hide('empty-feed-msg');
  
  const feed = $('file-feed');
  const isMine = fileMeta.ownerId === peer.id;
  const av = getAvatarParams(fileMeta.ownerId);

  if (!isMine) notify("New File Shared", fileMeta.name);

  const div = document.createElement('div');
  div.className = 'file-chip';
  div.style.background = isMine ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.04)';
  div.style.border = isMine ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(255,255,255,0.07)';

  const inner = `
    <div class="avatar" style="background: ${av.bg}">${av.letter}</div>
    <div class="file-chip-info">
      <p class="file-chip-name">${fileMeta.name}</p>
      <p class="file-chip-size">${fmt(fileMeta.size)} ${isMine ? '· Shared by you' : ''}</p>
      
      ${fileMeta.thumbnail ? `<div style="margin-top:10px; border-radius:8px; overflow:hidden; border:1px solid rgba(59,130,246,0.2);"><img src="${fileMeta.thumbnail}" style="max-width:100%; display:block;" /></div>` : ''}
      
      <!-- Progress Bar (Hidden by default) -->
      <div id="prog-wrap-${fileMeta.id}" style="display:none; margin-top:8px;">
        <div class="progress-track">
          <div id="prog-fill-${fileMeta.id}" class="progress-fill"></div>
        </div>
        <p style="font-size:0.7rem; color:#a855f7; margin-top:4px;" id="prog-txt-${fileMeta.id}">0%</p>
      </div>
      
      <div style="display: flex; gap: 8px; margin-top: 10px; flex-shrink: 0;">
        ${!isMine && fileMeta.mime && fileMeta.mime.startsWith('video/') 
          ? `<button id="btn-stream-${fileMeta.id}" class="btn-primary" style="padding: 8px 16px; font-size: 0.8rem; background: #a855f7;">▶ Stream</button>` 
          : ''}
        ${isMine 
        ? `<button id="btn-ul-${fileMeta.id}" disabled class="btn-primary btn-ghost-sm">Shared</button>`
        : `<button id="btn-dl-${fileMeta.id}" class="btn-primary btn-dl" style="padding: 8px 16px; font-size: 0.8rem;">↓ Download</button>`
        }
      </div>
    </div>
  `;

  div.innerHTML = inner;
  
  // Prepend so newest is at the top
  feed.insertBefore(div, feed.firstChild);

  if (!isMine) {
    const btnStream = div.querySelector(`#btn-stream-${fileMeta.id}`);
    if (btnStream) {
      btnStream.addEventListener('click', () => {
        btnStream.disabled = true;
        btnStream.textContent = 'Buffering...';
        setTimeout(() => { btnStream.disabled = false; btnStream.textContent = '▶ Stream'; }, 5000);
        
        const msg = { type: 'request_stream', fileId: fileMeta.id, requesterId: peer.id };
        if (role === 'host') {
          const ownerConn = guestConns.get(fileMeta.ownerId);
          if (ownerConn) ownerConn.send({ type: 'peer_wants_stream', fileId: fileMeta.id, requesterId: peer.id });
        } else {
          hostConn.send(msg);
        }
      });
    }

    const btn = div.querySelector(`#btn-dl-${fileMeta.id}`);
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;

        // ── File System Access API: write chunks directly to disk as they arrive
        if ('showSaveFilePicker' in window) {
          try {
            const ext = fileMeta.name.includes('.') ? fileMeta.name.split('.').pop() : '';
            const fileHandle = await window.showSaveFilePicker({
              suggestedName: fileMeta.name,
              types: [{ description: 'File', accept: { [fileMeta.mime || 'application/octet-stream']: ext ? [`.${ext}`] : [] } }]
            });
            const writable = await fileHandle.createWritable();
            fileWritableStreams.set(fileMeta.id, writable);
            btn.textContent = 'Starting...';
          } catch (err) {
            btn.disabled = false;
            btn.textContent = '↓ Download';
            if (err.name !== 'AbortError') showToast('Could not open save dialog.', 'error');
            return;
          }
        } else {
          // Fallback: will buffer in memory as before
          btn.textContent = 'Requesting...';
        }

        // Request the file from the network
        const msg = { type: 'request_download', fileId: fileMeta.id, requesterId: peer.id };
        if (role === 'host') {
          const ownerConn = guestConns.get(fileMeta.ownerId);
          if (ownerConn) ownerConn.send({ type: 'peer_wants_file', fileId: fileMeta.id, requesterId: peer.id });
        } else {
          hostConn.send(msg);
        }
      });
    }
  }
}

// ── Chat UI ──────────────────────────────────────────────────────────────────
function showTypingIndicator(id) {
  const ind = $('typing-indicator');
  ind.textContent = `${id} is typing...`;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { ind.textContent = ''; }, 2000);
}

function parseMarkdown(text) {
  let h = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Links
  h = h.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color:var(--accent);text-decoration:underline;">$1</a>');
  // Bold
  h = h.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  h = h.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Code block
  h = h.replace(/```([\s\S]*?)```/g, '<pre style="background:rgba(0,0,0,0.3);padding:8px;border-radius:6px;margin:4px 0;font-family:\'JetBrains Mono\',monospace;"><code>$1</code></pre>');
  // Inline code
  h = h.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.3);padding:2px 4px;border-radius:4px;font-family:\'JetBrains Mono\',monospace;">$1</code>');
  return h;
}

function addChatToFeed(msg) {
  hide('empty-feed-msg');
  const feed = $('file-feed');
  const isMine = msg.senderId === MY_ID;
  
  // Use senderName for UI, fallback to senderId if missing
  const displayName = msg.senderName || msg.senderId;
  const av = getAvatarParams(displayName);

  if (!isMine) {
    notify(`New message from ${displayName}`, msg.text);
    playSound('pop');
  }

  const div = document.createElement('div');
  div.style.display = 'flex';
  div.style.flexDirection = isMine ? 'row-reverse' : 'row';
  div.style.alignItems = 'flex-end';
  div.style.gap = '8px';
  div.style.marginBottom = '12px';

  const timeStr = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const inner = `
    <div class="avatar" style="background: ${av.bg}; width: 28px; height: 28px; font-size: 0.6rem;">${av.letter}</div>
    <div style="display:flex; flex-direction:column; align-items:${isMine ? 'flex-end' : 'flex-start'}; max-width:80%;">
      <span style="font-size: 0.65rem; color: rgba(255,255,255,0.3); margin-bottom: 4px; padding: 0 4px;">
        ${isMine ? 'You' : displayName} · ${timeStr}
      </span>
      <div style="background: ${isMine ? 'var(--accent)' : 'rgba(255,255,255,0.07)'}; 
                  color: #fff; padding: 10px 14px; border-radius: 14px; 
                  ${isMine ? 'border-bottom-right-radius: 4px;' : 'border-bottom-left-radius: 4px;'} 
                  word-wrap: break-word; font-size: 0.95rem; line-height: 1.4;">
        ${parseMarkdown(msg.text)}
      </div>
    </div>
  `;
  div.innerHTML = inner;
  
  // Append chat (unlike files which are prepended)
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

// ── Direct File Transfer (Sender Side) ───────────────────────────────────────
function initiateFileTransfer(targetPeerId, fileId) {
  const file = mySharedFiles.get(fileId);
  if (!file) return;

  // Open a dedicated connection just for this file transfer
  const xferConn = peer.connect(targetPeerId, {
    reliable: true,
    metadata: { transferFileId: fileId }
  });

  xferConn.on('open', () => {
    let offset = 0;
    
    function sendNextChunk() {
      if (offset >= file.size) {
        // Done
        setTimeout(() => xferConn.close(), 500);
        return;
      }

      // Check buffer to prevent WebRTC overflow (pause if > 8MB buffered)
      if (xferConn.dataChannel && xferConn.dataChannel.bufferedAmount > 8 * 1024 * 1024) {
        setTimeout(sendNextChunk, 50);
        return;
      }
      
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();
      reader.onload = e => {
        xferConn.send(e.target.result);
        offset += e.target.result.byteLength;
        
        // Update UI progress for uploader
        const pct = Math.round(offset / file.size * 100);
        const btn = $(`btn-ul-${fileId}`);
        if (btn) {
          if (!btn.classList.contains('downloading') && pct < 100) {
            btn.classList.add('downloading');
            btn.textContent = '';
            btn.style.borderColor = 'transparent';
          }
          btn.setAttribute('data-pct', pct);
          btn.style.background = `conic-gradient(#f59e0b ${pct}%, transparent ${pct}%)`;
          if (pct === 100) {
            btn.classList.remove('downloading');
            btn.classList.add('done');
            btn.innerHTML = '';
            btn.style.background = '#10b981';
          }
        }

        sendNextChunk();
      };
      reader.readAsArrayBuffer(slice);
    }

    sendNextChunk();
  });
}

// ── Direct Video Streaming (Sender Side) ─────────────────────────────────────
function initiateVideoStreaming(targetPeerId, fileId) {
  const file = mySharedFiles.get(fileId);
  if (!file) return;

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true; // MUST be muted for autoplay capture
  video.play().catch(e => console.error("Stream video play error", e));
  
  video.onplay = () => {
    let stream;
    if (video.captureStream) {
      stream = video.captureStream();
    } else if (video.mozCaptureStream) {
      stream = video.mozCaptureStream();
    }
    
    if (stream) {
      const call = peer.call(targetPeerId, stream, { metadata: { type: 'video_stream', fileId: file.id } });
      
      video.onended = () => {
        call.close();
        URL.revokeObjectURL(url);
      };
      
      call.on('close', () => {
        video.pause();
        URL.revokeObjectURL(url);
      });
    }
  };
}

// ── Direct File Transfer (Receiver Side) ─────────────────────────────────────
function handleIncomingFileTransfer(conn, fileId) {
  const fileMeta = allKnownFiles.get(fileId);
  if (!fileMeta) { conn.close(); return; }

  const btn = $(`btn-dl-${fileId}`);

  // Check if we have a streaming writable (File System Access API path)
  const writableStream = fileWritableStreams.get(fileId) || null;
  
  // For streaming writes, chain promises so disk writes are sequential
  let writeChain = Promise.resolve();
  
  // Fallback: in-memory chunks array
  let chunks = writableStream ? null : [];
  let receivedBytes = 0;

  if (btn) {
    btn.classList.add('downloading');
    btn.textContent = '';
    btn.style.borderColor = 'transparent';
  }

  conn.on('data', data => {
    receivedBytes += data.byteLength;

    const pct = Math.round(receivedBytes / fileMeta.size * 100);
    if (btn) {
      btn.setAttribute('data-pct', pct);
      btn.style.background = `conic-gradient(var(--accent) ${pct}%, transparent ${pct}%)`;
    }

    if (writableStream) {
      // ✔ Stream write: chain the write promise to guarantee sequential order
      writeChain = writeChain.then(() => writableStream.write(data));
    } else {
      // Fallback: buffer in memory
      chunks.push(data);
    }

    if (receivedBytes >= fileMeta.size) {
      // All chunks received — finalize
      if (writableStream) {
        // Wait for all pending writes, then close the stream (file is fully saved)
        writeChain.then(() => {
          writableStream.close();
          fileWritableStreams.delete(fileId);

          if (btn) {
            btn.classList.remove('downloading');
            btn.classList.add('done');
            btn.innerHTML = '';
            btn.style.background = '#10b981';
          }
          playSound('chime');
          const rect = btn ? btn.getBoundingClientRect() : { left: window.innerWidth/2, top: window.innerHeight/2, width: 0, height: 0 };
          window.triggerParticleBurst(rect.left + rect.width/2, rect.top + rect.height/2);
          showToast(`✅ ${fileMeta.name} saved to disk!`, 'success');
        }).catch(err => {
          showToast('Error writing file to disk.', 'error');
        });
      } else {
        // Fallback: build Blob and trigger browser download
        if (btn) {
          btn.classList.remove('downloading');
          btn.classList.add('done');
          btn.innerHTML = '';
        }
        playSound('chime');
        const rect = btn ? btn.getBoundingClientRect() : { left: window.innerWidth/2, top: window.innerHeight/2, width: 0, height: 0 };
        window.triggerParticleBurst(rect.left + rect.width/2, rect.top + rect.height/2);

        const blob = new Blob(chunks, { type: fileMeta.mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileMeta.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
      conn.close();
    }
  });

  conn.on('close', () => {
    if (receivedBytes < fileMeta.size) {
      // Transfer was cut short — abort the stream if open
      if (writableStream) {
        writableStream.abort().catch(() => {});
        fileWritableStreams.delete(fileId);
      }
      if (btn) {
        btn.classList.remove('downloading');
        btn.textContent = 'Retry';
        btn.disabled = false;
        btn.style.background = '';
        btn.removeAttribute('data-pct');
      }
    }
  });
}

function renderUserList() {
  const list = $('user-list');
  if (!list) return;
  list.innerHTML = '';
  
  roomMembers.forEach((data, id) => {
    const isMe = id === MY_ID;
    const av = getAvatarParams(data.name || id);
    const div = document.createElement('div');
    div.className = 'file-chip';
    div.style.padding = '8px 12px';
    div.style.gap = '12px';
    div.style.alignItems = 'center';
    
    div.innerHTML = `
      <div class="avatar" style="background: ${av.bg}; width: 30px; height: 30px; font-size: 0.75rem;">${av.letter}</div>
      <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <span style="font-weight: 600; font-size: 0.9rem;">${data.name}</span>
        ${isMe ? '<span style="font-size: 0.7rem; color: var(--accent); margin-left: 5px;">(You)</span>' : ''}
        ${role === 'host' && id === MY_ID ? '<span style="font-size: 0.7rem; color: #10b981; margin-left: 5px;">(Host)</span>' : ''}
      </div>
    `;
    list.appendChild(div);
  });
}
