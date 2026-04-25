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

// ── State ────────────────────────────────────────────────────────────────────
const MY_ID = Array.from(crypto.getRandomValues(new Uint8Array(6)))
  .map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

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

let mySharedFiles = new Map(); // fileId -> File object
let allKnownFiles = new Map(); // fileId -> { id, name, size, mime, ownerId }

// ── Background Particles ─────────────────────────────────────────────────────
(function initParticles() {
  const c = $('particles');
  if (!c) return;
  const ctx = c.getContext('2d');
  let W, H;
  const resize = () => { W = c.width = innerWidth; H = c.height = innerHeight; };
  resize(); window.addEventListener('resize', resize);
  const pts = Array.from({length:50}, () => ({
    x:Math.random()*W, y:Math.random()*H, r:Math.random()*1.2+0.4,
    vx:(Math.random()-.5)*.2, vy:(Math.random()-.5)*.2, a:Math.random()*.4+.05
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

// ── Init UI ──────────────────────────────────────────────────────────────────
$('btn-create-room').addEventListener('click', () => initPeer(true, MY_ID));

$('btn-join-room').addEventListener('click', () => {
  const code = $('input-join-code').value.toUpperCase().trim();
  if (code.length >= 4) {
    $('join-error').hidden = true;
    initPeer(false, code);
  }
});

// Auto-join if hash is present
const hashId = window.location.hash.replace('#', '').toUpperCase().trim();
if (hashId.length >= 4) {
  initPeer(false, hashId);
} else {
  show('home-view');
  hide('room-view');
}

$('btn-leave-room').addEventListener('click', () => {
  window.location.hash = '';
  window.location.reload();
});

$('btn-copy-link').addEventListener('click', () => {
  const url = `${location.origin}${location.pathname}#${$('room-code-display').textContent}`;
  navigator.clipboard.writeText(url).then(() => {
    $('btn-copy-link').textContent = 'Copied!';
    setTimeout(() => { $('btn-copy-link').textContent = 'Copy Link'; }, 2000);
  });
});

// ── Drop Zone ────────────────────────────────────────────────────────────────
const dropZone = $('room-drop-zone');
const fileInput = $('room-file-input');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = '#0d9488'; dropZone.style.background = 'rgba(13,148,136,0.1)'; });
dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'rgba(255,255,255,0.15)'; dropZone.style.background = 'transparent'; });
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.style.borderColor = 'rgba(255,255,255,0.15)'; dropZone.style.background = 'transparent';
  if (e.dataTransfer.files.length > 0) handleFilesSelected(e.dataTransfer.files);
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  if (e.target.files.length > 0) handleFilesSelected(e.target.files);
  fileInput.value = '';
});

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

  peer.on('error', err => {
    console.error('[PeerJS Error]', err);
    if (role === null) {
      // Failed during connect
      $('btn-create-room').textContent = '+ Create Room';
      $('btn-join-room').textContent = 'Join';
      $('join-error').hidden = false;
      $('join-error').textContent = 'Could not connect to network or room.';
    }
  });
}

// ── Host Logic ───────────────────────────────────────────────────────────────
function setupHostControlConnection(conn) {
  conn.on('open', () => {
    guestConns.set(conn.peer, conn);
    updateParticipantCount();
    
    // Send current room state to new guest
    conn.send({
      type: 'room_state',
      files: Array.from(allKnownFiles.values())
    });
  });

  conn.on('data', data => {
    if (data.type === 'announce') {
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
  });

  conn.on('close', () => {
    guestConns.delete(conn.peer);
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
  $('peer-count-display').textContent = `${count} participant${count > 1 ? 's' : ''}`;
}

// ── Guest Logic ──────────────────────────────────────────────────────────────
function connectToHost(hostId) {
  hostConn = peer.connect(hostId, { reliable: true });
  
  hostConn.on('open', () => {
    $('peer-count-display').textContent = 'Connected to room';
  });

  hostConn.on('data', data => {
    if (data.type === 'room_state') {
      data.files.forEach(f => {
        allKnownFiles.set(f.id, f);
        addFileToFeed(f);
      });
    }
    else if (data.type === 'announce') {
      allKnownFiles.set(data.file.id, data.file);
      addFileToFeed(data.file);
    }
    else if (data.type === 'peer_wants_file') {
      // The host says someone wants a file I own.
      initiateFileTransfer(data.requesterId, data.fileId);
    }
  });

  hostConn.on('close', () => {
    alert('The room host disconnected. Room closed.');
    window.location.hash = '';
    window.location.reload();
  });
}

// ── Sharing Files ────────────────────────────────────────────────────────────
function handleFilesSelected(files) {
  for (const file of files) {
    const fileId = 'f_' + Math.random().toString(36).substr(2, 9);
    mySharedFiles.set(fileId, file);

    const fileMeta = {
      id: fileId,
      name: file.name,
      size: file.size,
      mime: file.type,
      ownerId: peer.id,
      isMine: true
    };

    allKnownFiles.set(fileId, fileMeta);
    addFileToFeed(fileMeta);

    // Announce to network
    const msg = { type: 'announce', file: fileMeta };
    if (role === 'host') {
      broadcast(msg);
    } else {
      hostConn.send(msg);
    }
  }
}

// ── Feed UI ──────────────────────────────────────────────────────────────────
function addFileToFeed(fileMeta) {
  hide('empty-feed-msg');
  
  const feed = $('file-feed');
  const isMine = fileMeta.ownerId === peer.id || fileMeta.isMine;

  const div = document.createElement('div');
  div.className = 'file-chip';
  div.style.background = isMine ? 'rgba(13,148,136,0.1)' : 'rgba(255,255,255,0.04)';
  div.style.border = isMine ? '1px solid rgba(13,148,136,0.3)' : '1px solid rgba(255,255,255,0.07)';

  const inner = `
    <span class="file-emoji">${mimeEmoji(fileMeta.mime)}</span>
    <div class="file-chip-info">
      <p class="file-chip-name">${fileMeta.name}</p>
      <p class="file-chip-size">${fmt(fileMeta.size)} ${isMine ? '· Shared by you' : ''}</p>
      
      <!-- Progress Bar (Hidden by default) -->
      <div id="prog-wrap-${fileMeta.id}" style="display:none; margin-top:8px;">
        <div class="progress-track">
          <div id="prog-fill-${fileMeta.id}" class="progress-fill"></div>
        </div>
        <p style="font-size:0.7rem; color:#a855f7; margin-top:4px;" id="prog-txt-${fileMeta.id}">0%</p>
      </div>
    </div>
    
    ${isMine ? 
      `<span style="font-size: 1.2rem;" title="You are hosting this file">🌐</span>` : 
      `<button id="btn-dl-${fileMeta.id}" class="btn-primary" style="padding: 8px 16px; font-size: 0.8rem;">↓ Download</button>`
    }
  `;

  div.innerHTML = inner;
  
  // Prepend so newest is at the top
  feed.insertBefore(div, feed.firstChild);

  if (!isMine) {
    const btn = div.querySelector(`#btn-dl-${fileMeta.id}`);
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Requesting...';
      
      // Tell the host we want this file
      const msg = { type: 'request_download', fileId: fileMeta.id, requesterId: peer.id };
      if (role === 'host') {
        // We are host, ask the guest directly
        const ownerConn = guestConns.get(fileMeta.ownerId);
        if (ownerConn) ownerConn.send({ type: 'peer_wants_file', fileId: fileMeta.id, requesterId: peer.id });
      } else {
        // Ask host to relay
        hostConn.send(msg);
      }
    });
  }
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
      
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();
      reader.onload = e => {
        xferConn.send(e.target.result);
        offset += e.target.result.byteLength;
        
        // Update UI progress for uploader
        const pct = Math.round(offset / file.size * 100);
        const pwrap = $(`prog-wrap-${fileId}`);
        if (pwrap) {
          pwrap.style.display = 'block';
          $(`prog-fill-${fileId}`).style.width = pct + '%';
          $(`prog-txt-${fileId}`).textContent = `Uploading... ${pct}%`;
          if (pct === 100) setTimeout(() => { pwrap.style.display = 'none'; }, 2000);
        }

        // Slight timeout prevents buffer overflow on fast local networks
        setTimeout(sendNextChunk, 0);
      };
      reader.readAsArrayBuffer(slice);
    }

    sendNextChunk();
  });
}

// ── Direct File Transfer (Receiver Side) ─────────────────────────────────────
function handleIncomingFileTransfer(conn, fileId) {
  const fileMeta = allKnownFiles.get(fileId);
  if (!fileMeta) { conn.close(); return; }

  const btn = $(`btn-dl-${fileId}`);
  if (btn) btn.style.display = 'none';
  
  const pwrap = $(`prog-wrap-${fileId}`);
  if (pwrap) pwrap.style.display = 'block';

  let chunks = [];
  let receivedBytes = 0;

  conn.on('data', data => {
    chunks.push(data);
    receivedBytes += data.byteLength;

    const pct = Math.round(receivedBytes / fileMeta.size * 100);
    $(`prog-fill-${fileId}`).style.width = pct + '%';
    $(`prog-txt-${fileId}`).textContent = `Downloading... ${pct}%`;

    if (receivedBytes >= fileMeta.size) {
      // Done!
      $(`prog-txt-${fileId}`).textContent = `Done!`;
      $(`prog-txt-${fileId}`).style.color = '#0d9488';
      
      const blob = new Blob(chunks, { type: fileMeta.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileMeta.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      conn.close();
    }
  });

  conn.on('close', () => {
    if (receivedBytes < fileMeta.size) {
      if (btn) {
        btn.style.display = '';
        btn.textContent = 'Retry';
        btn.disabled = false;
      }
      $(`prog-txt-${fileId}`).textContent = `Transfer failed or interrupted.`;
      $(`prog-txt-${fileId}`).style.color = '#f87171';
    }
  });
}
