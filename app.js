/**
 * PeerDrop — app.js (Mesh Room Architecture)
 * Hybrid Star-Mesh: Host relays signaling, peers transfer files directly.
 */
'use strict';

// ── Service Worker & Streams ───────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
let activeStreams = new Map();

// ── Font Loading (prevent FOUC) ──────────────────────────────────────────────
document.fonts?.ready.then(() => { document.body.classList.add('fonts-loaded'); });

const CHUNK_SIZE = 256 * 1024;
const STREAM_QUALITIES = {
  auto:  { label: 'Auto', w: 0, h: 0, fps: 30 },
  high:  { label: '720p', w: 1280, h: 720, fps: 30 },
  medium:{ label: '480p', w: 854, h: 480, fps: 24 },
  low:   { label: '360p', w: 640, h: 360, fps: 24 }
};

// ── DOM Helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => { const e = $(id); if (e) { e.hidden = false; e.style.display = ''; } };
const hide = id => { const e = $(id); if (e) e.hidden = true; };
const triggerInputShake = inputElement => {
  if (!inputElement) return;
  inputElement.classList.remove('error-shake');
  void inputElement.offsetWidth;
  inputElement.classList.add('error-shake');
};
const escapeHTML = str => {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
};
const fmt = b => {
  if (!b) return '0 B';
  const k = 1024, u = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(2) + ' ' + u[i];
};
const fmtSpeed = bps => {
  if (bps > 1024 * 1024) return (bps / (1024 * 1024)).toFixed(1) + ' MB/s';
  if (bps > 1024) return (bps / 1024).toFixed(0) + ' KB/s';
  return bps + ' B/s';
};
const fmtEta = secs => {
  if (!isFinite(secs) || secs > 3600) return '';
  if (secs >= 60) return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s left`;
  return `${Math.round(secs)}s left`;
};
const mimeEmoji = t => {
  if (!t) return '📁';
  if (t.startsWith('image/')) return '🖼️';
  if (t.startsWith('video/')) return '🎬';
  if (t.startsWith('audio/')) return '🎵';
  if (t.includes('zip')||t.includes('rar')) return '📦';
  return '📄';
};
const mimeIcon = t => {
  if (!t) return { emoji: '📁', bg: 'rgba(255,255,255,0.04)' };
  if (t.startsWith('image/')) return { emoji: '🖼️', bg: 'rgba(99,102,241,0.12)' };
  if (t.startsWith('video/')) return { emoji: '🎬', bg: 'rgba(168,85,247,0.12)' };
  if (t.startsWith('audio/')) return { emoji: '🎵', bg: 'rgba(16,185,129,0.12)' };
  if (t.includes('zip')||t.includes('rar')||t.includes('tar')||t.includes('gz')) return { emoji: '📦', bg: 'rgba(245,158,11,0.12)' };
  if (t.includes('pdf')) return { emoji: '📕', bg: 'rgba(239,68,68,0.12)' };
  if (t.includes('text')||t.includes('json')||t.includes('javascript')) return { emoji: '📝', bg: 'rgba(6,182,212,0.12)' };
  return { emoji: '📄', bg: 'rgba(255,255,255,0.04)' };
};

// ── Connection Bar ─────────────────────────────────────────────────────────
function setConnBar(state, text) {
  const bar = $('conn-bar');
  if (!bar) return;
  bar.className = 'room-enter room-enter-n1';
  if (state === 'weak') bar.classList.add('weak');
  else if (state === 'error') bar.classList.add('error');
  const txt = bar.querySelector('#conn-bar-text');
  if (txt) txt.textContent = text || 'Connected';
}

// ── Ripple Effect ──────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-primary');
  if (!btn || btn.disabled) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'btn-ripple';
  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
});

// ── Loading / Drag Overlays ─────────────────────────────────────────────────
function showLoading(text = 'Connecting to room...') {
  const overlay = $('loading-overlay');
  if (!overlay) return;
  const txt = overlay.querySelector('.loading-text');
  if (txt) txt.textContent = text;
  overlay.classList.add('show');
}
function hideLoading() {
  const overlay = $('loading-overlay');
  if (overlay) overlay.classList.remove('show');
}
function showDragOverlay() {
  const overlay = $('drag-overlay');
  if (overlay) overlay.classList.add('show');
}
function hideDragOverlay() {
  const overlay = $('drag-overlay');
  if (overlay) overlay.classList.remove('show');
}

// ── System Message ──────────────────────────────────────────────────────────
function addSystemMessage(text, emoji = '📌') {
  hide('empty-feed-msg');
  const feed = $('file-feed');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = 'system-msg feed-item';
  const inner = document.createElement('div');
  inner.className = 'system-msg-inner';
  inner.textContent = emoji + ' ' + text;
  div.appendChild(inner);
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

// ── Scroll-to-bottom ────────────────────────────────────────────────────────
const scrollBtn = $('scroll-bottom-btn');
if (scrollBtn) {
  scrollBtn.addEventListener('click', () => {
    const feed = $('file-feed');
    if (feed) { feed.scrollTop = feed.scrollHeight; }
  });
}
// Feed scroll listener (delegated)
document.addEventListener('scroll', e => {
  if (e.target.id !== 'file-feed') return;
  const btn = $('scroll-bottom-btn');
  if (!btn) return;
  const threshold = 120;
  const isNearBottom = e.target.scrollHeight - e.target.scrollTop - e.target.clientHeight < threshold;
  btn.classList.toggle('show', !isNearBottom);
}, true);

// ── UI Enhancements ──────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = $('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const emojiMap = { error: '❌', success: '✅', info: 'ℹ️' };
  const emojiSpan = document.createElement('span');
  emojiSpan.className = 'toast-emoji';
  emojiSpan.textContent = emojiMap[type] || 'ℹ️';
  t.appendChild(emojiSpan);
  t.appendChild(document.createTextNode(' '));
  const msgDiv = document.createElement('div');
  msgDiv.textContent = message;
  t.appendChild(msgDiv);
  container.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 500);
  }, 4000);
}

function updatePulse(state) {
  const pcd = $('peer-count-display');
  if (!pcd) return;
  pcd.textContent = '';
  const dot = document.createElement('span');
  dot.className = 'status-pulse' + (state === 'connecting' ? ' connecting' : state === 'offline' ? ' offline' : '');
  pcd.appendChild(dot);
  const label = document.createElement('span');
  label.textContent = state === 'connecting' ? 'Connecting...' : state === 'offline' ? 'Offline' : String(state);
  pcd.appendChild(label);
}

const avatarCache = new Map();
function getAvatarParams(id) {
  if (avatarCache.has(id)) return avatarCache.get(id);
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (Math.abs(hash) * 2) % 360;
  const params = { letter: id.charAt(0).toUpperCase(), bg: `linear-gradient(135deg, hsl(${hue1}, 80%, 60%), hsl(${hue2}, 80%, 40%))` };
  avatarCache.set(id, params);
  return params;
}

// ── Audio Synthesizer ────────────────────────────────────────────────────────
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return; }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}
function playSound(type) {
  initAudio();
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
const savedName = localStorage.getItem('peerdrop_name');
let MY_ID = Array.from(crypto.getRandomValues(new Uint8Array(6)))
  .map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
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
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
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

let localStream = null;
let activeCalls = new Map();
let typingTimer = null;
let leaveInProgress = false;
let pendingDownloads = new Map(); // fileId -> { timeoutTimer, resolve, reject, btn }

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
  notifBtn.setAttribute('aria-pressed', 'false');
  const toggleNotif = () => {
    if (!("Notification" in window)) { showToast('Notifications not supported.', 'error'); return; }
    if (Notification.permission === 'granted') {
      notificationsEnabled = !notificationsEnabled;
      notifBtn.textContent = notificationsEnabled ? '🔔' : '🔕';
      notifBtn.setAttribute('aria-pressed', String(notificationsEnabled));
      showToast(notificationsEnabled ? 'Notifications enabled!' : 'Notifications muted.', 'info');
      return;
    }
    Notification.requestPermission().then(p => {
      if (p === 'granted') {
        notificationsEnabled = true;
        notifBtn.textContent = '🔔';
        notifBtn.setAttribute('aria-pressed', 'true');
        showToast('Desktop notifications enabled!', 'success');
      }
    });
  };
  notifBtn.addEventListener('click', toggleNotif);
  notifBtn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNotif(); } });
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
      triggerInputShake(inputName);
      showToast("Please enter your display name.", "error");
      playSound('error');
      return false;
    }
    MY_NAME = val;
    localStorage.setItem('peerdrop_name', MY_NAME);
  }
  return true;
}

$('btn-create-room')?.addEventListener('click', () => {
  if (validateName()) initPeer(true, MY_ID);
});

$('btn-join-room')?.addEventListener('click', () => {
  if (!validateName()) return;
  const code = $('input-join-code')?.value.toUpperCase().trim();
  if (code && code.length >= 4) {
    const joinErr = $('join-error');
    if (joinErr) joinErr.hidden = true;
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

function cleanupPeerResources() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  for (const [, call] of activeCalls) try { call.close(); } catch (_) {}
  activeCalls.clear();
  if (hostConn) { try { hostConn.close(); } catch (_) {} hostConn = null; }
  for (const [, conn] of guestConns) { try { conn.close(); } catch (_) {} }
  guestConns.clear();
  if (peer) { try { peer.destroy(); } catch (_) {} peer = null; }
  for (const [, data] of activeStreams) { try { data.port.postMessage('ABORT'); } catch (_) {} }
  activeStreams.clear();
  mySharedFiles.clear();
  allKnownFiles.clear();
  chatHistory.length = 0;
  for (const [, pending] of pendingDownloads) clearTimeout(pending.timeoutTimer);
  pendingDownloads.clear();
  roomMembers.clear();
  avatarCache.clear();
  if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
  if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
  hideLoading(); hideDragOverlay();
  role = null;
  leaveInProgress = true;
}

$('btn-leave-room')?.addEventListener('click', () => {
  cleanupPeerResources();
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

$('btn-copy-link')?.addEventListener('click', () => {
  const rcd = $('room-code-display');
  if (!rcd) return;
  const url = `${location.origin}${location.pathname}#${rcd.textContent}`;
  navigator.clipboard.writeText(url).then(() => {
    const bcl = $('btn-copy-link');
    if (bcl) { bcl.textContent = 'Copied!'; setTimeout(() => { bcl.textContent = 'Copy Link'; }, 2000); }
  }).catch(() => showToast("Failed to copy link", "error"));
});

// ── Input & Drop Zone ────────────────────────────────────────────────────────
const roomView = $('room-view');
const fileInput = $('room-file-input');
const chatInput = $('chat-input');

// Hide drag overlay when files leave the browser
document.addEventListener('dragend', () => hideDragOverlay());
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget || e.relatedTarget === document.documentElement) hideDragOverlay();
});

// Global drop zone for the room
roomView.addEventListener('dragover', e => { e.preventDefault(); roomView.classList.add('drag-active'); showDragOverlay(); });
roomView.addEventListener('dragleave', e => {
  if (e.relatedTarget && roomView.contains(e.relatedTarget)) return;
  roomView.classList.remove('drag-active'); hideDragOverlay();
});
roomView.addEventListener('drop', e => {
  e.preventDefault();
  roomView.classList.remove('drag-active'); hideDragOverlay();
  if (e.dataTransfer.files.length > 0) handleFilesSelected(e.dataTransfer.files);
});

$('btn-attach')?.addEventListener('click', () => { if (fileInput) fileInput.click(); });
if (fileInput) {
  fileInput.addEventListener('change', e => {
    if (e.target.files.length > 0) handleFilesSelected(e.target.files);
    fileInput.value = '';
  });
}

// Chat sending
$('btn-send-chat')?.addEventListener('click', sendChatMessage);
if (chatInput) {
  chatInput.addEventListener('keydown', e => { 
    if (e.key === 'Enter') sendChatMessage(); 
    else handleTyping();
  });
}

function handleTyping() {
  if (!chatInput) return;
  const msg = { type: 'typing', senderId: MY_ID };
  if (role === 'host') broadcast(msg);
  else if (hostConn && hostConn.open) hostConn.send(msg);
}

function sendChatMessage() {
  if (!chatInput) return;
  const text = chatInput.value.trim();
  if (!text) {
    triggerInputShake(chatInput);
    playSound('error');
    return;
  }

  if (role !== 'host' && (!hostConn || !hostConn.open)) {
    showToast("Not connected to the room yet!", "error");
    triggerInputShake(chatInput);
    return;
  }

  chatInput.value = '';
  playSound('pop');

  const msg = { type: 'chat', text, senderId: MY_ID, senderName: MY_NAME, time: Date.now() };
  chatHistory.push(msg);
  if (chatHistory.length > 100) chatHistory.shift();
  addChatToFeed(msg);

  if (role === 'host') {
    broadcast(msg);
  } else {
    hostConn.send(msg);
  }
}

// ── Screen Sharing ───────────────────────────────────────────────────────────
const btnShareScreen = $('btn-share-screen');
if (btnShareScreen) {
  btnShareScreen.addEventListener('click', async () => {
    if (!localStream) {
      try {
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        addVideoStream(MY_ID, localStream, true);

        if (role === 'host') {
          for (const [guestId] of guestConns) {
            try {
              const call = peer.call(guestId, localStream);
              if (call) handleCall(call);
            } catch (_) {}
          }
        } else if (hostConn && hostConn.open) {
          try {
            const call = peer.call(hostConn.peer, localStream);
            if (call) handleCall(call);
          } catch (_) {}
        }
        
        localStream.getVideoTracks()[0].onended = () => stopScreenShare();
        btnShareScreen.style.color = '#ef4444';
      } catch (err) {
        showToast("Screen share cancelled or failed.", "error");
      }
    } else {
      stopScreenShare();
    }
  });
} else {
  console.warn('Screen share button not found');
}

function stopScreenShare() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  removeVideoStream(MY_ID);
  for (const [, call] of activeCalls) try { call.close(); } catch (_) {}
  activeCalls.clear();
  const bss = $('btn-share-screen');
  if (bss) bss.style.color = '';
}

function handleCall(call) {
  const isVideoFile = call.metadata?.type === 'video_stream';
  activeCalls.set(call.peer, call);
  call.on('stream', remoteStream => {
    if (remoteStream && remoteStream.active !== false) {
      addVideoStream(call.peer, remoteStream, false, isVideoFile);
    }
  });
  call.on('close', () => {
    removeVideoStream(call.peer);
    activeCalls.delete(call.peer);
  });
  call.on('error', err => {
    console.error('Call error:', err);
    removeVideoStream(call.peer);
    activeCalls.delete(call.peer);
  });
}

function addVideoStream(peerId, stream, isLocal, isVideoFile = false) {
  const container = $('file-feed');
  if (!container) return;
  let video = $(`video-${peerId}`);
  if (!video) {
    const wrap = document.createElement('div');
    wrap.id = `video-wrap-${peerId}`;
    wrap.className = 'video-wrap';
    
    video = document.createElement('video');
    video.id = `video-${peerId}`;
    video.autoplay = true;
    video.playsInline = true;
    video.style.width = '100%';
    video.style.display = 'block';
    if (isLocal) video.muted = true;
    else if (isVideoFile) video.controls = true;
    
    const label = document.createElement('div');
    label.className = 'video-label';
    const mem = roomMembers.get(peerId);
    const name = mem ? mem.name : peerId.substring(0, 8);
    label.textContent = isLocal ? 'Your Screen' : (isVideoFile ? `Stream: ${name}` : `${name}'s Screen`);

    // Stream controls for non-local streams
    if (!isLocal) {
      const controls = document.createElement('div');
      controls.style.cssText = 'position:absolute;top:8px;right:8px;display:flex;gap:6px;opacity:0;transition:opacity .3s ease';
      wrap.addEventListener('mouseenter', () => controls.style.opacity = '1');
      wrap.addEventListener('mouseleave', () => { if (!document.pictureInPictureElement) controls.style.opacity = '0'; });
      
      const makeBtn = (icon, title, fn) => {
        const b = document.createElement('button');
        b.textContent = icon;
        b.title = title;
        b.style.cssText = 'width:30px;height:30px;border:none;border-radius:6px;background:rgba(0,0,0,0.6);color:#fff;cursor:pointer;font-size:.85rem;transition:all .2s;backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,0.08)';
        b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,0.15)');
        b.addEventListener('mouseleave', () => b.style.background = 'rgba(0,0,0,0.6)');
        b.addEventListener('click', fn);
        return b;
      };

      // PiP button
      if ('pictureInPictureEnabled' in document) {
        const pipBtn = makeBtn('⊞', 'Picture-in-Picture', async () => {
          try {
            if (document.pictureInPictureElement) {
              await document.exitPictureInPicture();
            } else {
              await video.requestPictureInPicture();
            }
          } catch (_) {}
        });
        controls.appendChild(pipBtn);
      }

      // Fullscreen button
      const fsBtn = makeBtn('⛶', 'Fullscreen', () => {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          wrap.requestFullscreen().catch(() => {});
        }
      });
      controls.appendChild(fsBtn);

      // Stop button (video streams only, not screen shares)
      if (isVideoFile) {
        const stopBtn = makeBtn('⏹', 'Stop Stream', () => {
          const call = activeCalls.get(peerId);
          if (call) { try { call.close(); } catch(_) {} activeCalls.delete(peerId); }
          removeVideoStream(peerId);
        });
        stopBtn.style.color = '#ef4444';
        controls.appendChild(stopBtn);
      }

      wrap.appendChild(controls);
    }

    wrap.appendChild(video);
    wrap.appendChild(label);
    container.insertBefore(wrap, container.firstChild);
    hide('empty-feed-msg');
  }
  video.srcObject = stream;
  video.play().catch(() => {});
}

function removeVideoStream(peerId) {
  const wrap = $(`video-wrap-${peerId}`);
  if (wrap) {
    const video = wrap.querySelector('video');
    if (video && video.srcObject) {
      try { video.srcObject.getTracks().forEach(t => t.stop()); } catch (_) {}
      video.srcObject = null;
    }
    wrap.remove();
  }
}

// ── PeerJS Setup ─────────────────────────────────────────────────────────────
function initPeer(isCreatingHost, targetHostId) {
  if (peer) { try { peer.destroy(); } catch (_) {} peer = null; }
  leaveInProgress = false;

  $('btn-create-room').textContent = 'Starting...';
  $('btn-join-room').textContent = 'Joining...';

  showLoading(isCreatingHost ? 'Creating room...' : 'Joining room...');

  peer = new Peer(isCreatingHost ? MY_ID : null, PEER_CONFIG);

  peer.on('open', id => {
    hideLoading();
    const oldId = MY_ID;
    MY_ID = id;

    // Update ownerId for files I own if my peer ID changed
    if (oldId !== id) {
      for (const [fid, meta] of allKnownFiles) {
        if (meta.ownerId === oldId || meta.ownerId === id || mySharedFiles.has(fid)) {
          meta.ownerId = id;
        }
      }
      for (const [fid] of mySharedFiles) {
        const meta = allKnownFiles.get(fid);
        if (meta) meta.ownerId = id;
      }
    }

    hide('home-view');
    show('room-view');
    setTimeout(() => { const ci = $('chat-input'); if (ci) ci.focus(); }, 300);
    
    if (isCreatingHost) {
      role = 'host';
      startHeartbeat();
      const rcd = $('room-code-display');
      if (rcd) rcd.textContent = id;
      roomMembers.set(MY_ID, { name: MY_NAME });
      renderUserList();
      updateParticipantCount();
    } else {
      role = 'guest';
      const rcd = $('room-code-display');
      if (rcd) rcd.textContent = targetHostId;
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
    try {
      if (localStream) {
        call.answer(localStream);
      } else {
        call.answer();
      }
      handleCall(call);
    } catch (err) {
      console.error('Call handling error:', err);
    }
  });

  peer.on('error', err => {
    hideLoading();
    if (role === null) {
      const bcr = $('btn-create-room');
      if (bcr) bcr.textContent = '+ Create Room';
      const bjr = $('btn-join-room');
      if (bjr) bjr.textContent = 'Join';
      const je = $('join-error');
      if (je) { je.hidden = false; je.textContent = 'Could not connect to network or room.'; }
      showToast("Connection failed", "error");
    } else {
      showToast(err.message || "Network Error", "error");
    }
  });
}

// ── Rate Limiter ──────────────────────────────────────────────────────────
const joinAttempts = new Map();
function checkRateLimit(peerId) {
  const now = Date.now();
  const attempts = joinAttempts.get(peerId) || [];
  const recent = attempts.filter(t => now - t < 30000);
  if (recent.length >= 5) return false;
  recent.push(now);
  joinAttempts.set(peerId, recent);
  return true;
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
      if (!checkRateLimit(conn.peer)) { conn.close(); return; }
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
      
      addSystemMessage(`${data.name} joined the room`, '👋');
      showToast(`${escapeHTML(data.name)} joined the room.`, "info");
      playSound('chime');
    }
    else if (data.type === 'chat') {
      chatHistory.push(data);
      if (chatHistory.length > 100) chatHistory.shift();
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
    else if (data.type === 'pong') {
      // heartbeat response — no action needed, connection is alive
    }
    else if (data.type === 'request_stream') {
      // Guest A wants to stream a video file.
      const file = allKnownFiles.get(data.fileId);
      if (!file) return;

      if (file.ownerId === MY_ID) {
        initiateVideoStreaming(data.requesterId, file.id, data.quality || 'auto');
      } else {
        const ownerConn = guestConns.get(file.ownerId);
        if (ownerConn) {
          ownerConn.send({
            type: 'peer_wants_stream',
            fileId: file.id,
            requesterId: data.requesterId,
            quality: data.quality || 'auto'
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
      addSystemMessage(`${leftMem.name} left the room`, '👋');
      showToast(`${escapeHTML(leftMem.name)} left the room.`, "info");
    }
    updateParticipantCount();
  });
}

// ── Heartbeat ─────────────────────────────────────────────────────────────
let heartbeatTimer = null;
function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    for (const [id, c] of guestConns) {
      if (c.open) { try { c.send({ type: 'ping' }); } catch (_) {} }
    }
  }, 10000);
}
function stopHeartbeat() { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } }

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
  if (!hostId || hostId.length < 4) {
    showToast("Invalid room code.", "error");
    return;
  }

  hostConn = peer.connect(hostId, { reliable: true });
  if (!hostConn) {
    showToast("Failed to create connection.", "error");
    return;
  }

  const connectTimer = setTimeout(() => {
    if (hostConn && !hostConn.open) {
      try { hostConn.close(); } catch (_) {}
      showToast("Connection timed out. Check the room code.", "error");
      updatePulse('offline');
      $('btn-join-room').textContent = 'Join';
    }
  }, 10000);
  
  hostConn.on('open', () => {
    clearTimeout(connectTimer);
    updatePulse('Connected to room');
    setConnBar('ok', 'Connected');
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
        addSystemMessage(`${data.member.name} joined the room`, '👋');
        showToast(`${escapeHTML(data.member.name)} joined the room.`, "info");
        playSound('pop');
      }
    }
    else if (data.type === 'member_left') {
      const mem = roomMembers.get(data.id);
      if (mem) {
        addSystemMessage(`${mem.name} left the room`, '👋');
        showToast(`${escapeHTML(mem.name)} left the room.`, "info");
      }
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
    else if (data.type === 'ping') {
      try { hostConn.send({ type: 'pong' }); } catch (_) {}
    }
    else if (data.type === 'peer_wants_file') {
      // The host says someone wants a file I own.
      initiateFileTransfer(data.requesterId, data.fileId);
    }
    else if (data.type === 'peer_wants_stream') {
      // The host says someone wants to stream my video file.
      initiateVideoStreaming(data.requesterId, data.fileId, data.quality || 'auto');
    }
  });

  hostConn.on('error', err => {
    showToast("Connection to room failed: " + (err.message || "Network error"), "error");
    updatePulse('offline');
    setConnBar('error', 'Connection lost');
  });

  hostConn.on('close', () => {
    if (leaveInProgress) return;
    updatePulse('offline');
    setConnBar('error', 'Disconnected');
    showToast("Room host disconnected.", "error");
    setTimeout(() => {
      if (leaveInProgress) return;
      window.location.hash = '';
      window.location.reload();
    }, 2000);
  });
}

// ── Sharing Files ────────────────────────────────────────────────────────────
function handleFilesSelected(files) {
  if (!peer) { showToast("Not connected to any room.", "error"); return; }

  for (const file of files) {
    if (file.size > 2 * 1024 * 1024 * 1024) {
      showToast(`${escapeHTML(file.name)} is too large (max 2GB).`, 'error');
      continue;
    }

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

    if (file.type.startsWith('image/') && file.size < 10 * 1024 * 1024) {
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
        img.onerror = () => finishFileAnnounce(fileId, fileMeta);
        img.src = e.target.result;
      };
      reader.onerror = () => finishFileAnnounce(fileId, fileMeta);
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
  const isMine = peer && fileMeta.ownerId === peer.id;
  const av = getAvatarParams(fileMeta.ownerId);
  const owner = roomMembers.get(fileMeta.ownerId);
  const ownerName = owner ? owner.name : (isMine ? MY_NAME : 'Someone');

  if (!isMine) notify("New File Shared", fileMeta.name);

  // System message announcing the share
  addSystemMessage(`${mimeEmoji(fileMeta.mime)} ${fileMeta.name} shared by ${ownerName}`, '');

  const div = document.createElement('div');
  div.className = 'file-chip feed-item' + (isMine ? ' mine' : '');

  div.innerHTML = getFileChipHTML(fileMeta, isMine, av);

  const context = { peer, role, guestConns, hostConn };
  attachFileChipEvents(div, fileMeta, isMine, context);

  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

function getFileChipHTML(fileMeta, isMine, av) {
  const icon = mimeIcon(fileMeta.mime);
  return `
    <div class="file-type-icon" style="background:${icon.bg}">${icon.emoji}</div>
    <div class="file-chip-info">
      <p class="file-chip-name">${escapeHTML(fileMeta.name)}</p>
      <p class="file-chip-size">${fmt(fileMeta.size)}</p>
      
      ${fileMeta.thumbnail && fileMeta.thumbnail.startsWith('data:image/') ? `<div class="thumbnail-wrap"><img src="${escapeHTML(fileMeta.thumbnail)}" alt="" /></div>` : ''}
      
      <div id="prog-wrap-${fileMeta.id}" style="display:none; margin-top:10px;">
        <div class="progress-track">
          <div id="prog-fill-${fileMeta.id}" class="progress-fill"></div>
        </div>
        <div class="progress-info">
          <span id="prog-pct-${fileMeta.id}" class="progress-pct">0%</span>
          <span id="prog-speed-${fileMeta.id}" class="progress-speed"></span>
          <span id="prog-eta-${fileMeta.id}" class="progress-eta"></span>
        </div>
      </div>
      
      <div style="display: flex; gap: 6px; margin-top: 10px; flex-shrink: 0; flex-wrap: wrap;">
        ${!isMine && fileMeta.mime && fileMeta.mime.startsWith('video/') 
          ? `<button id="btn-stream-${fileMeta.id}" class="btn-primary stream-btn btn-sm" style="padding:8px 14px!important">▶ Stream</button>
             <select id="stream-quality-${fileMeta.id}" class="glass-input" style="width:auto;padding:6px 8px;font-size:.72rem;cursor:pointer;flex:0;min-width:65px">
               ${Object.entries(STREAM_QUALITIES).map(([k,v]) => `<option value="${k}" ${k==='auto'?'selected':''}>${v.label}</option>`).join('')}
             </select>` 
          : ''}
        ${isMine 
        ? `<button id="btn-ul-${fileMeta.id}" disabled class="btn-primary btn-ghost-sm">Shared</button>`
        : `<button id="btn-dl-${fileMeta.id}" class="btn-primary btn-dl btn-sm">↓ Download</button>`
        }
      </div>
    </div>
  `;
}

function attachFileChipEvents(div, fileMeta, isMine, context) {
  if (isMine) return;

  const { peer, role, guestConns, hostConn } = context;

  const btnStream = div.querySelector(`#btn-stream-${fileMeta.id}`);
  const qualitySelect = div.querySelector(`#stream-quality-${fileMeta.id}`);
  if (btnStream) {
    btnStream.addEventListener('click', () => {
      const quality = qualitySelect ? qualitySelect.value : 'auto';
      btnStream.disabled = true;
      btnStream.textContent = 'Buffering…';
      if (qualitySelect) qualitySelect.disabled = true;
      setTimeout(() => { btnStream.disabled = false; btnStream.textContent = '▶ Stream'; if (qualitySelect) qualitySelect.disabled = false; }, 8000);

      const msg = { type: 'request_stream', fileId: fileMeta.id, requesterId: peer.id, quality };
      if (role === 'host') {
        const ownerConn = guestConns.get(fileMeta.ownerId);
        if (ownerConn) ownerConn.send({ type: 'peer_wants_stream', fileId: fileMeta.id, requesterId: peer.id, quality });
      } else {
        hostConn.send(msg);
      }
    });
  }

  const btn = div.querySelector(`#btn-dl-${fileMeta.id}`);
  if (btn) {
    btn.addEventListener('click', async () => {
      if (pendingDownloads.has(fileMeta.id)) {
        showToast('Already downloading this file.', 'info');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Requesting…';

      const timeoutTimer = setTimeout(() => {
        pendingDownloads.delete(fileMeta.id);
        btn.disabled = false;
        btn.textContent = '↓ Download';
        showToast('Transfer request timed out. The file owner may be offline.', 'error');
      }, 30000);

      pendingDownloads.set(fileMeta.id, { timeoutTimer, btn });

      const msg = { type: 'request_download', fileId: fileMeta.id, requesterId: peer.id };
      if (role === 'host') {
        const file = allKnownFiles.get(fileMeta.id);
        if (file) {
          if (file.ownerId === MY_ID) {
            showToast('You cannot download your own file.', 'info');
            clearTimeout(timeoutTimer);
            pendingDownloads.delete(fileMeta.id);
            btn.disabled = false;
            btn.textContent = '↓ Download';
          } else {
            const ownerConn = guestConns.get(file.ownerId);
            if (ownerConn) {
              ownerConn.send({ type: 'peer_wants_file', fileId: file.id, requesterId: peer.id });
            } else {
              showToast('File owner is no longer connected.', 'error');
              clearTimeout(timeoutTimer);
              pendingDownloads.delete(fileMeta.id);
              btn.disabled = false;
              btn.textContent = '↓ Download';
            }
          }
        }
      } else {
        hostConn.send(msg);
      }
    });
  }
}

// ── Chat UI ──────────────────────────────────────────────────────────────────
function showTypingIndicator(id) {
  const ind = $('typing-indicator');
  const name = roomMembers.get(id)?.name || id;
  ind.textContent = `${name} is typing...`;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { ind.textContent = ''; }, 2000);
}

function renderMarkdownToDOM(text) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const escaped = escapeHTML(text);
  let i = 0;
  function flush(buf) { if (buf.length) { frag.appendChild(document.createTextNode(buf.join(''))); buf.length = 0; } }
  function build(buf) {
    const stack = [[frag, buf]];
    while (stack.length) {
      const [parent, arr] = stack.pop();
      let j = 0;
      let textBuf = [];
      while (j < arr.length) {
        const item = arr[j];
        if (typeof item === 'string') { textBuf.push(item); j++; continue; }
        flush(textBuf);
        const el = item.el;
        if (item.children) stack.push([el, item.children]);
        parent.appendChild(el);
        j++;
      }
      flush(textBuf);
      parent.normalize();
    }
  }

  let buf = [];
  while (i < escaped.length) {
    if (escaped[i] === '*' && escaped[i+1] === '*') {
      const end = escaped.indexOf('**', i+2);
      if (end !== -1) {
        flush(buf);
        const strong = document.createElement('strong');
        strong.textContent = escaped.slice(i+2, end);
        frag.appendChild(strong);
        i = end + 2; continue;
      }
    }
    if (escaped[i] === '*' && escaped[i+1] !== '*') {
      const end = escaped.indexOf('*', i+1);
      if (end !== -1) {
        flush(buf);
        const em = document.createElement('em');
        em.textContent = escaped.slice(i+1, end);
        frag.appendChild(em);
        i = end + 1; continue;
      }
    }
    if (escaped[i] === '`' && escaped[i+1] === '`' && escaped[i+2] === '`') {
      const end = escaped.indexOf('```', i+3);
      if (end !== -1) {
        flush(buf);
        const pre = document.createElement('pre');
        pre.style.cssText = 'background:rgba(0,0,0,0.3);padding:8px;border-radius:6px;margin:4px 0;font-family:\'JetBrains Mono\',monospace';
        const code = document.createElement('code');
        code.style.cssText = "font-family:'JetBrains Mono',monospace";
        code.textContent = escaped.slice(i+3, end);
        pre.appendChild(code);
        frag.appendChild(pre);
        i = end + 3; continue;
      }
    }
    if (escaped[i] === '`') {
      const end = escaped.indexOf('`', i+1);
      if (end !== -1) {
        flush(buf);
        const code = document.createElement('code');
        code.style.cssText = "background:rgba(0,0,0,0.3);padding:2px 4px;border-radius:4px;font-family:'JetBrains Mono',monospace";
        code.textContent = escaped.slice(i+1, end);
        frag.appendChild(code);
        i = end + 1; continue;
      }
    }
    const urlMatch = escaped.slice(i).match(/^(https?:\/\/[^\s<]+)/);
    if (urlMatch) {
      flush(buf);
      const a = document.createElement('a');
      a.href = urlMatch[0].replace(/&amp;/g, '&');
      a.target = '_blank'; a.rel = 'noopener';
      a.style.cssText = 'color:var(--accent);text-decoration:underline';
      a.textContent = urlMatch[0];
      frag.appendChild(a);
      i += urlMatch[0].length; continue;
    }
    buf.push(escaped[i]);
    i++;
  }
  flush(buf);
  return frag;
}

function addChatToFeed(msg) {
  hide('empty-feed-msg');
  const feed = $('file-feed');
  const isMine = msg.senderId === MY_ID;
  const displayName = msg.senderName || msg.senderId;
  const av = getAvatarParams(msg.senderId);

  if (!isMine) {
    notify(`New message from ${escapeHTML(displayName)}`, msg.text);
    playSound('pop');
  }

  const div = document.createElement('div');
  div.className = 'feed-item';
  div.style.cssText = 'display:flex;flex-direction:' + (isMine ? 'row-reverse' : 'row') + ';align-items:flex-end;gap:8px;margin-bottom:14px';

  const timeStr = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.style.cssText = 'background:' + av.bg + ';width:28px;height:28px;font-size:.6rem';
  avatar.textContent = av.letter;
  div.appendChild(avatar);

  const msgCol = document.createElement('div');
  msgCol.style.cssText = 'display:flex;flex-direction:column;align-items:' + (isMine ? 'flex-end' : 'flex-start') + ';max-width:80%';

  const meta = document.createElement('span');
  meta.className = 'chat-meta';
  const metaName = document.createElement('span');
  metaName.className = 'chat-meta-name';
  metaName.textContent = isMine ? 'You' : displayName;
  meta.appendChild(metaName);
  meta.appendChild(document.createTextNode(' · ' + timeStr));
  msgCol.appendChild(meta);

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble ' + (isMine ? 'chat-bubble-own' : 'chat-bubble-other');
  bubble.style.cssText = 'color:#fff;padding:10px 14px;border-radius:14px;word-wrap:break-word;font-size:.95rem;line-height:1.5';
  bubble.appendChild(renderMarkdownToDOM(msg.text));
  msgCol.appendChild(bubble);
  div.appendChild(msgCol);
  
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

// ── Direct File Transfer (Sender Side) ───────────────────────────────────────
function initiateFileTransfer(targetPeerId, fileId) {
  const file = mySharedFiles.get(fileId);
  if (!file) return;

  // Open a dedicated connection just for this file transfer
  let xferConn;
  const resetUploadBtn = () => {
    const btn = $(`btn-ul-${fileId}`);
    if (btn) { btn.classList.remove('downloading', 'done'); btn.textContent = 'Upload'; btn.disabled = false; }
    const chipEl = btn?.closest('.file-chip');
    if (chipEl) chipEl.classList.remove('downloading-glow');
  };

  let aborted = false;

  try {
    xferConn = peer.connect(targetPeerId, {
      reliable: true,
      metadata: { transferFileId: fileId }
    });
  } catch (err) {
    showToast("Failed to create upload connection.", "error");
    resetUploadBtn();
    return;
  }

  xferConn.on('error', () => { aborted = true; resetUploadBtn(); });
  xferConn.on('close', () => { if (aborted) resetUploadBtn(); });

  xferConn.on('open', () => {
    let offset = 0;
    const btn = $(`btn-ul-${fileId}`);

    if (xferConn.dataChannel) {
      xferConn.dataChannel.bufferedAmountLowThreshold = 1024 * 1024;
      xferConn.dataChannel.onbufferedamountlow = sendNextChunk;
    }
    
    function sendNextChunk() {
      if (aborted || !xferConn.open) return;

      if (offset >= file.size) {
        setTimeout(() => xferConn.close(), 500);
        return;
      }

      if (xferConn.dataChannel && xferConn.dataChannel.bufferedAmount > 8 * 1024 * 1024) {
        return;
      }
      
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();
      reader.onload = e => {
        if (aborted) return;
        try {
          xferConn.send(e.target.result);
        } catch {
          aborted = true;
          showToast('Upload failed.', 'error');
          resetUploadBtn();
          return;
        }
        offset += e.target.result.byteLength;
        
        const pct = Math.round(offset / file.size * 100);
        const chipEl = btn?.closest('.file-chip');
        if (btn) {
          if (!btn.classList.contains('downloading') && pct < 100) {
            btn.classList.add('downloading');
            if (chipEl) chipEl.classList.add('downloading-glow');
          }
          btn.textContent = `${pct}%`;
          if (pct === 100) {
            btn.classList.remove('downloading');
            btn.classList.add('done');
            btn.textContent = '✅';
            if (chipEl) chipEl.classList.remove('downloading-glow');
          }
        }

        requestAnimationFrame(sendNextChunk);
      };
      reader.onerror = () => { aborted = true; showToast('File read error.', 'error'); resetUploadBtn(); };
      reader.readAsArrayBuffer(slice);
    }

    sendNextChunk();
  });
}

// ── Direct Video Streaming (Sender Side) ─────────────────────────────────────
function initiateVideoStreaming(targetPeerId, fileId, quality = 'auto') {
  const file = mySharedFiles.get(fileId);
  if (!file) {
    showToast('File no longer available for streaming.', 'error');
    return;
  }

  // Check browser support for video capture
  const hasCaptureStream = typeof HTMLVideoElement !== 'undefined' &&
    (!!HTMLVideoElement.prototype.captureStream || !!HTMLVideoElement.prototype.mozCaptureStream);
  if (!hasCaptureStream) {
    showToast('Video streaming not supported in this browser.', 'error');
    return;
  }

  const useCanvas = quality !== 'auto' && (typeof HTMLCanvasElement.prototype.captureStream === 'function');
  const q = STREAM_QUALITIES[quality] || STREAM_QUALITIES.auto;

  showToast(`Streaming ${quality === 'auto' ? '' : q.label}...`, 'info');

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.onerror = () => {
    showToast('Cannot play this video format.', 'error');
    URL.revokeObjectURL(url);
  };

  video.play().catch(() => {
    showToast('Failed to play video for streaming.', 'error');
    URL.revokeObjectURL(url);
  });
  
  video.onplay = () => {
    try {
      let sourceStream;
      const qualityLabel = quality === 'auto' ? 'original' : q.label;

      if (useCanvas) {
        // Canvas downscale for custom resolution
        const canvas = document.createElement('canvas');
        canvas.width = q.w;
        canvas.height = q.h;
        const ctx = canvas.getContext('2d');
        const draw = () => {
          if (video.paused || video.ended) return;
          ctx.drawImage(video, 0, 0, q.w, q.h);
          requestAnimationFrame(draw);
        };
        // Wait a frame for video metadata then start drawing
        video.onseeked = () => { draw(); video.onseeked = null; };
        setTimeout(() => draw(), 100);
        sourceStream = canvas.captureStream(q.fps);
        if (!sourceStream || !sourceStream.active) { useCanvas = false; }
      }

      if (!useCanvas) {
        sourceStream = video.captureStream ? video.captureStream(q.fps) : video.mozCaptureStream(q.fps);
      }

      if (!sourceStream || !sourceStream.active) {
        showToast('Failed to capture video stream.', 'error');
        URL.revokeObjectURL(url);
        return;
      }

      const call = peer.call(targetPeerId, sourceStream, { 
        metadata: { type: 'video_stream', fileId: file.id } 
      });
      
      if (!call) {
        showToast('Failed to initiate video call.', 'error');
        URL.revokeObjectURL(url);
        return;
      }
      
      // Track canvas cleanup
      let canvasCleanup = null;
      if (useCanvas) {
        canvasCleanup = () => { try { sourceStream.getTracks().forEach(t => t.stop()); } catch(_) {} };
      }
      
      video.onended = () => {
        try { call.close(); } catch (_) {}
        if (canvasCleanup) canvasCleanup();
        URL.revokeObjectURL(url);
      };
      
      call.on('close', () => {
        try { video.pause(); } catch (_) {}
        if (canvasCleanup) canvasCleanup();
        URL.revokeObjectURL(url);
        video.srcObject = null;
      });

      call.on('error', () => {
        if (canvasCleanup) canvasCleanup();
        URL.revokeObjectURL(url);
      });
    } catch (err) {
      showToast('Video streaming error: ' + err.message, 'error');
      URL.revokeObjectURL(url);
    }
  };
}

// ── Direct File Transfer (Receiver Side) ─────────────────────────────────────
function handleIncomingFileTransfer(conn, fileId) {
  const fileMeta = allKnownFiles.get(fileId);
  if (!fileMeta) { conn.close(); return; }

  const btn      = $(`btn-dl-${fileId}`);
  const chipEl   = btn?.closest('.file-chip');
  const progWrap = $(`prog-wrap-${fileId}`);
  const progFill = $(`prog-fill-${fileId}`);
  const progPct  = $(`prog-pct-${fileId}`);
  const progSpd  = $(`prog-speed-${fileId}`);
  const progEta  = $(`prog-eta-${fileId}`);
  if (chipEl) chipEl.classList.add('downloading-glow');

  // Clear pending download timer and prevent timeout from firing
  const pending = pendingDownloads.get(fileId);
  if (pending) {
    clearTimeout(pending.timeoutTimer);
    pendingDownloads.delete(fileId);
  }

  let chunks = [];
  let receivedBytes = 0;
  let processingChunk = false;
  let dataQueue = [];
  const startTime = Date.now();

  // ─ Show progress UI ─
  if (btn) {
    btn.textContent = 'Downloading…';
    btn.classList.add('downloading');
    btn.disabled = true;
  }
  if (progWrap) progWrap.style.display = 'block';

  let writeError = null;
  let pendingUIUpdate = null;

  const scheduleUIUpdate = () => {
    if (pendingUIUpdate) return;
    pendingUIUpdate = requestAnimationFrame(() => {
      pendingUIUpdate = null;
      const pct      = Math.round(receivedBytes / fileMeta.size * 100);
      const elapsed  = (Date.now() - startTime) / 1000;
      const speedBps = elapsed > 0 ? receivedBytes / elapsed : 0;
      const etaSecs  = speedBps > 0 ? (fileMeta.size - receivedBytes) / speedBps : Infinity;

      if (progFill) progFill.style.width = pct + '%';
      if (progPct)  progPct.textContent  = pct + '%';
      if (progSpd)  progSpd.textContent  = fmtSpeed(speedBps);
      if (progEta)  progEta.textContent  = fmtEta(etaSecs);
      if (btn) btn.textContent = `${pct}%`;
    });
  };

  const processChunk = async (data) => {
    if (writeError) return;
    
    let buf = data;
    if (buf instanceof Blob) buf = await buf.arrayBuffer();
    else if (!(buf instanceof Uint8Array)) buf = new Uint8Array(buf);
    
    chunks.push(buf);
    if (chunks.length > 500) {
      showToast('Memory threshold reached. Saving partial file.', 'error');
      writeError = true;
      conn.close();
      return;
    }

    if (dataQueue.length === 0 && receivedBytes >= fileMeta.size) {
      if (pendingUIUpdate) { cancelAnimationFrame(pendingUIUpdate); pendingUIUpdate = null; }
      const elapsedFinal = (Date.now() - startTime) / 1000;
      const finalSpeedBps = elapsedFinal > 0 ? receivedBytes / elapsedFinal : 0;

      if (chipEl) chipEl.classList.remove('downloading-glow');
      if (progFill) progFill.style.width = '100%';
      if (progPct)  progPct.textContent  = '100%';
      if (progSpd)  progSpd.textContent  = fmtSpeed(finalSpeedBps);
      if (progEta)  progEta.textContent  = 'Done!';
      if (btn) {
        btn.textContent = '✅ Saved';
        btn.classList.remove('downloading');
        btn.classList.add('done');
        btn.disabled = false;
      }
      playSound('chime');
      const rect = btn ? btn.getBoundingClientRect() : { left: window.innerWidth/2, top: window.innerHeight/2, width: 0, height: 0 };
      triggerParticleBurst(rect.left + rect.width/2, rect.top + rect.height/2);

      // Trigger file download
      const blob = new Blob(chunks);
      chunks.length = 0;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileMeta.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2000);
      addSystemMessage(`${fileMeta.name} downloaded successfully`, '✅');
      showToast(`✅ ${escapeHTML(fileMeta.name)} downloaded!`, 'success');
    }
  };

  const processQueue = async () => {
    if (processingChunk || dataQueue.length === 0) return;
    processingChunk = true;
    while (dataQueue.length > 0 && !writeError) {
      const data = dataQueue.shift();

      const chunkBytes = (data instanceof Blob) ? data.size : data.byteLength;
      receivedBytes += chunkBytes;
      scheduleUIUpdate();

      try {
        await processChunk(data);
      } catch (err) {
        writeError = err;
        conn.close();
        break;
      }
    }
    processingChunk = false;
    if (dataQueue.length > 0 && !writeError) processQueue();
  };

  conn.on('data', data => {
    if (writeError) return;
    dataQueue.push(data);
    if (!processingChunk) processQueue();
  });

  conn.on('close', () => {
    if (pendingUIUpdate) { cancelAnimationFrame(pendingUIUpdate); pendingUIUpdate = null; }
    if (receivedBytes < fileMeta.size && receivedBytes > 0) {
      if (progWrap) progWrap.style.display = 'none';
      if (btn) {
        btn.classList.remove('downloading', 'done');
        btn.textContent = '↓ Download';
        btn.disabled = false;
      }
      showToast('Download failed - connection closed.', 'error');
    }
  });
}

function renderUserList() {
  const list = $('user-list');
  if (!list) return;
  list.innerHTML = '';
  
  roomMembers.forEach((data, id) => {
    const isMe = id === MY_ID;
    const av = getAvatarParams(id);
    const div = document.createElement('div');
    div.className = 'participant-row';
    
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    div.appendChild(dot);
    const avEl = document.createElement('div');
    avEl.className = 'avatar';
    avEl.style.cssText = 'background:' + av.bg + ';width:30px;height:30px;font-size:.7rem';
    avEl.textContent = av.letter;
    div.appendChild(avEl);
    const nameWrap = document.createElement('div');
    nameWrap.style.cssText = 'flex:1;min-width:0';
    const nameEl = document.createElement('div');
    nameEl.className = 'participant-name';
    nameEl.textContent = data.name;
    nameWrap.appendChild(nameEl);
    div.appendChild(nameWrap);
    if (isMe) {
      const tag = document.createElement('span');
      tag.className = 'participant-tag you';
      tag.textContent = 'You';
      div.appendChild(tag);
    }
    if (role === 'host' && id === MY_ID) {
      const tag = document.createElement('span');
      tag.className = 'participant-tag host';
      tag.textContent = 'Host';
      div.appendChild(tag);
    }
    list.appendChild(div);
  });
}
