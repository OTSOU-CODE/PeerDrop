'use strict';

let activeStreams = new Map();

const CHUNK_SIZE = 256 * 1024;
const STREAM_QUALITIES = {
  auto:  { label: 'Auto', w: 0, h: 0, fps: 30 },
  high:  { label: '720p', w: 1280, h: 720, fps: 30 },
  medium:{ label: '480p', w: 854, h: 480, fps: 24 },
  low:   { label: '360p', w: 640, h: 360, fps: 24 }
};

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

let audioCtx = null;
function setAudioCtx(v) { audioCtx = v; }

const savedName = localStorage.getItem('peerdrop_name');
let MY_ID = Array.from(crypto.getRandomValues(new Uint8Array(6)))
  .map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
let MY_NAME = savedName || 'Guest_' + Math.floor(Math.random() * 1000);

function setMY_NAME(v) { MY_NAME = v; }
function setMY_ID(v) { MY_ID = v; }

const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  }
};

let peer = null;
let role = null;
let hostConn = null;
let guestConns = new Map();
let roomMembers = new Map();
let mySharedFiles = new Map();
let allKnownFiles = new Map();
let chatHistory = [];
let localStream = null;
let activeCalls = new Map();
let typingTimer = null;
let leaveInProgress = false;
let pendingDownloads = new Map();

function setPeer(v) { peer = v; }
function setRole(v) { role = v; }
function setHostConn(v) { hostConn = v; }
function setLocalStream(v) { localStream = v; }
function setTypingTimer(v) { typingTimer = v; }
function setLeaveInProgress(v) { leaveInProgress = v; }

let notificationsEnabled = false;
if ("Notification" in window) {
  if (Notification.permission === "granted") notificationsEnabled = true;
}
function setNotificationsEnabled(v) { notificationsEnabled = v; }

function broadcast(msg, excludePeerId = null) {
  for (const [id, c] of guestConns) {
    if (id !== excludePeerId && c.open) {
      c.send(msg);
    }
  }
}

export {
  $, show, hide, triggerInputShake,
  escapeHTML, fmt, fmtSpeed, fmtEta, mimeEmoji, mimeIcon,
  getAvatarParams, avatarCache,
  CHUNK_SIZE, STREAM_QUALITIES,
  audioCtx, setAudioCtx, savedName,
  MY_ID, setMY_ID, MY_NAME, setMY_NAME, PEER_CONFIG,
  peer, setPeer, role, setRole, hostConn, setHostConn,
  guestConns, roomMembers,
  mySharedFiles, allKnownFiles, chatHistory,
  localStream, setLocalStream, activeCalls,
  typingTimer, setTypingTimer, leaveInProgress, setLeaveInProgress,
  pendingDownloads,
  activeStreams, notificationsEnabled, setNotificationsEnabled,
  broadcast
};
