/**
 * PeerDrop — app.js
 * Pure WebRTC P2P file transfer via PeerJS.
 * No server. Files go directly device-to-device.
 */
'use strict';

const CHUNK_SIZE = 64 * 1024; // 64 KB chunks

// ── ID generation (6 uppercase alphanumeric chars) ────────────────────────────
const MY_ID = Array.from(crypto.getRandomValues(new Uint8Array(6)))
  .map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

// ── Detect receiver mode: URL hash = #PEERID ─────────────────────────────────
const hashId = window.location.hash.replace('#', '').toUpperCase().trim();
const isReceiver = hashId.length >= 4;

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => { const el = $(id); if (el) el.hidden = false; };
const hide = id => { const el = $(id); if (el) el.hidden = true; };
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
  if (t.includes('pdf')) return '📄';
  if (t.includes('zip')||t.includes('rar')) return '📦';
  if (t.includes('text')||t.includes('json')) return '📝';
  return '📁';
};

// ── PeerJS config (public cloud + Google STUN) ────────────────────────────────
const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  }
};

// ── Init particles ────────────────────────────────────────────────────────────
(function initParticles() {
  const c = document.getElementById('particles');
  if (!c) return;
  const ctx = c.getContext('2d');
  let W, H;
  const resize = () => { W = c.width = innerWidth; H = c.height = innerHeight; };
  resize(); window.addEventListener('resize', resize);
  const pts = Array.from({length:55}, () => ({
    x:Math.random()*innerWidth, y:Math.random()*innerHeight,
    r:Math.random()*1.4+0.4, vx:(Math.random()-.5)*.25, vy:(Math.random()-.5)*.25,
    a:Math.random()*.4+.07
  }));
  (function frame() {
    ctx.clearRect(0,0,W,H);
    pts.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(168,85,247,${p.a})`; ctx.fill();
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0)p.x=W; if(p.x>W)p.x=0;
      if(p.y<0)p.y=H; if(p.y>H)p.y=0;
    });
    requestAnimationFrame(frame);
  })();
})();

// ═══════════════════════════════════════════════════════════════════════════════
isReceiver ? startReceiver() : startSender();
// ═══════════════════════════════════════════════════════════════════════════════

// ═════════════════════════ SENDER ════════════════════════════════════════════
function startSender() {
  show('sender-view');

  const myCodeEl       = $('my-code');
  const statusBadge    = $('peer-status');
  const statusLabel    = $('status-label');
  const shareUrlRow    = $('share-url-row');
  const shareUrlInput  = $('share-url-input');
  const copyLinkBtn    = $('copy-link-btn');
  const qrWrap         = $('qr-wrap');
  const qrImg          = $('qr-img');
  const dropZone       = $('drop-zone');
  const fileInput      = $('file-input');
  const waitingState   = $('waiting-state');
  const sendingState   = $('sending-state');
  const sendDoneState  = $('send-done-state');
  const codeInline     = $('code-inline');

  let selectedFile = null;
  let activeConn   = null;

  // ── Create peer ──────────────────────────────────────────────────────────────
  const peer = new Peer(MY_ID, PEER_CONFIG);

  peer.on('open', id => {
    myCodeEl.textContent = id;
    statusBadge.className = 'status-badge status--ready';
    statusLabel.textContent = 'Ready';
    codeInline.textContent = id;

    // Build share link (only useful when served via HTTP)
    const proto = location.protocol;
    if (proto === 'http:' || proto === 'https:') {
      const shareUrl = `${location.origin}${location.pathname}#${id}`;
      shareUrlInput.value = shareUrl;
      shareUrlRow.hidden  = false;
      qrImg.src = `https://chart.googleapis.com/chart?chs=140x140&cht=qr&chl=${encodeURIComponent(shareUrl)}&chld=M|1`;
      qrWrap.hidden = false;
    }
  });

  peer.on('error', err => {
    statusBadge.className = 'status-badge status--error';
    statusLabel.textContent = 'Error: ' + err.type;
    console.error('[PeerDrop Sender]', err);
  });

  // ── Listen for incoming connections ─────────────────────────────────────────
  peer.on('connection', conn => {
    activeConn = conn;
    conn.on('open', () => {
      if (selectedFile) {
        sendFile(conn, selectedFile);
      }
      // else: wait for user to pick a file
    });
    conn.on('error', e => console.error('Connection error', e));
  });

  // ── Copy link ────────────────────────────────────────────────────────────────
  copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareUrlInput.value).then(() => {
      copyLinkBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyLinkBtn.textContent = 'Copy Link'; }, 2200);
    });
  });

  // ── Drop zone ────────────────────────────────────────────────────────────────
  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) onFileSelected(f);
  });
  dropZone.addEventListener('click',   () => fileInput.click());
  dropZone.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') fileInput.click(); });
  fileInput.addEventListener('change', e => { if (e.target.files[0]) onFileSelected(e.target.files[0]); });

  function onFileSelected(file) {
    selectedFile = file;
    $('send-icon').textContent  = mimeEmoji(file.type);
    $('send-name').textContent  = file.name;
    $('send-size').textContent  = fmt(file.size);
    $('sending-icon').textContent = mimeEmoji(file.type);
    $('sending-name').textContent = file.name;
    $('sending-size').textContent = fmt(file.size);

    // Show waiting state
    dropZone.hidden      = true;
    waitingState.hidden  = false;
    sendingState.hidden  = true;
    sendDoneState.hidden = true;

    // If receiver already connected, send immediately
    if (activeConn && activeConn.open) sendFile(activeConn, file);
  }

  // ── Send file ────────────────────────────────────────────────────────────────
  function sendFile(conn, file) {
    waitingState.hidden  = true;
    sendingState.hidden  = false;
    sendDoneState.hidden = true;

    // Send metadata
    conn.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size, mime: file.type }));

    let offset     = 0;
    let speedBytes = 0;
    const fill     = $('send-fill');
    const pctEl    = $('send-pct');
    const track    = $('send-track');
    const speedEl  = $('send-speed');

    const speedTimer = setInterval(() => {
      speedEl.textContent = `↑ ${(speedBytes/1024/1024).toFixed(2)} MB/s`;
      speedBytes = 0;
    }, 1000);

    function sendNextChunk() {
      if (offset >= file.size) {
        conn.send(JSON.stringify({ type: 'done' }));
        clearInterval(speedTimer);
        fill.style.width = '100%';
        pctEl.textContent = '100%';
        sendingState.hidden  = true;
        sendDoneState.hidden = false;
        return;
      }
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();
      reader.onload = e => {
        conn.send(e.target.result);
        const sent = e.target.result.byteLength;
        offset     += sent;
        speedBytes += sent;
        const pct = Math.min(100, Math.round(offset / file.size * 100));
        fill.style.width = pct + '%';
        pctEl.textContent = pct + '%';
        track.setAttribute('aria-valuenow', pct);
        sendNextChunk();
      };
      reader.readAsArrayBuffer(slice);
    }

    sendNextChunk();
  }

  // ── Send another ─────────────────────────────────────────────────────────────
  $('send-another-btn').addEventListener('click', () => {
    selectedFile = null;
    fileInput.value = '';
    dropZone.hidden = false;
    waitingState.hidden  = true;
    sendingState.hidden  = true;
    sendDoneState.hidden = true;
  });

  // ── Switch to Receive Mode ───────────────────────────────────────────────────
  const goReceiveBtn = $('go-to-receive-btn');
  if (goReceiveBtn) {
    goReceiveBtn.addEventListener('click', () => {
      // Clean up sender peer
      if (peer) peer.destroy();
      hide('sender-view');
      startReceiver();
    });
  }
}

// ═════════════════════════ RECEIVER ══════════════════════════════════════════
function startReceiver() {
  show('receiver-view');

  const codeInput     = $('recv-code-input');
  const connectBtn    = $('recv-connect-btn');
  const connectErr    = $('recv-connect-err');
  const enterSection  = $('recv-enter-section');
  const fileSection   = $('recv-file-section');
  const backBtn       = $('back-to-send');

  let savedBlob     = null;
  let savedFileName = '';

  // ── Create our peer (no custom ID — server assigns one) ──────────────────────
  const peer = new Peer(PEER_CONFIG);

  // ── If hash present, pre-fill code and auto-connect ──────────────────────────
  if (hashId) {
    codeInput.value = hashId;
    peer.on('open', () => connectToSender(hashId));
  }

  // ── Manual connect ────────────────────────────────────────────────────────────
  connectBtn.addEventListener('click', () => {
    const code = codeInput.value.toUpperCase().trim();
    if (!code) return;
    connectToSender(code);
  });
  codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') connectBtn.click(); });

  // ── Back button ───────────────────────────────────────────────────────────────
  backBtn.addEventListener('click', e => {
    e.preventDefault();
    window.location.hash = '';
    window.location.reload();
  });

  // ── Save button ───────────────────────────────────────────────────────────────
  $('recv-save-btn').addEventListener('click', () => {
    if (!savedBlob) return;
    const url = URL.createObjectURL(savedBlob);
    const a   = document.createElement('a');
    a.href = url; a.download = savedFileName;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  });

  $('recv-retry-btn').addEventListener('click', () => {
    window.location.hash = '';
    window.location.reload();
  });

  // ── Connect to sender ─────────────────────────────────────────────────────────
  function connectToSender(senderId) {
    connectErr.hidden   = true;
    enterSection.hidden = true;
    fileSection.hidden  = false;
    show('recv-connecting');
    hide('recv-waiting-file');
    hide('recv-receiving');
    hide('recv-done');
    hide('recv-error-state');

    const conn = peer.connect(senderId, { reliable: true });
    let chunks    = [];
    let received  = 0;
    let fileMeta  = null;
    let speedBytes = 0;

    const speedTimer = setInterval(() => {
      $('recv-speed').textContent = `↓ ${(speedBytes/1024/1024).toFixed(2)} MB/s`;
      speedBytes = 0;
    }, 1000);

    const timeout = setTimeout(() => {
      if (!conn.open) {
        clearInterval(speedTimer);
        hide('recv-connecting');
        $('recv-error-msg').textContent = 'Could not connect. Make sure the sender is still on the page.';
        show('recv-error-state');
      }
    }, 25000);

    conn.on('open', () => {
      clearTimeout(timeout);
      hide('recv-connecting');
      show('recv-waiting-file');
    });

    conn.on('data', data => {
      if (typeof data === 'string') {
        const msg = JSON.parse(data);

        if (msg.type === 'meta') {
          fileMeta = msg;
          hide('recv-waiting-file');
          show('recv-receiving');
          $('recv-icon').textContent     = mimeEmoji(msg.mime);
          $('recv-name').textContent     = msg.name;
          $('recv-size-info').textContent = fmt(msg.size);
          chunks   = [];
          received = 0;
        }

        if (msg.type === 'done') {
          clearInterval(speedTimer);
          const blob = new Blob(chunks, { type: fileMeta.mime || 'application/octet-stream' });
          savedBlob     = blob;
          savedFileName = fileMeta.name;
          hide('recv-receiving');
          show('recv-done');
          $('recv-done-name').textContent = fileMeta.name + ' · ' + fmt(fileMeta.size);
          // Auto-trigger save
          $('recv-save-btn').click();
        }
      } else {
        // ArrayBuffer chunk
        chunks.push(data);
        received   += data.byteLength;
        speedBytes += data.byteLength;
        if (fileMeta && fileMeta.size) {
          const pct = Math.min(100, Math.round(received / fileMeta.size * 100));
          $('recv-fill').style.width = pct + '%';
          $('recv-pct').textContent  = pct + '%';
          $('recv-track').setAttribute('aria-valuenow', pct);
        }
      }
    });

    conn.on('error', err => {
      clearInterval(speedTimer);
      clearTimeout(timeout);
      hide('recv-connecting');
      hide('recv-waiting-file');
      hide('recv-receiving');
      $('recv-error-msg').textContent = 'Connection error: ' + err.message;
      show('recv-error-state');
    });

    peer.on('error', err => {
      clearInterval(speedTimer);
      clearTimeout(timeout);
      if (err.type === 'peer-unavailable') {
        hide('recv-connecting');
        $('recv-error-msg').textContent = 'Sender not found. Check the code and try again.';
        show('recv-error-state');
      }
    });
  }
}
