'use strict';

import {
  $, show, hide, escapeHTML,
  CHUNK_SIZE, STREAM_QUALITIES,
  audioCtx, setAudioCtx,
  MY_ID, setMY_ID, MY_NAME, PEER_CONFIG,
  peer, setPeer, role, setRole,
  hostConn, setHostConn, guestConns, roomMembers,
  mySharedFiles, allKnownFiles, chatHistory,
  localStream, setLocalStream, activeCalls,
  typingTimer, setTypingTimer, leaveInProgress, setLeaveInProgress,
  pendingDownloads, activeStreams, avatarCache, broadcast
} from './state.js';
import {
  showLoading, hideLoading, showDragOverlay, hideDragOverlay,
  showToast, setConnBar, notify, renderUserList
} from './ui.js';
import { playSound } from './audio.js';
import { dbSet } from './db.js';
import { deriveKey } from './crypto.js';
import { addChatToFeed, showTypingIndicator } from './chat.js';
import {
  addFileToFeed, addSystemMessage,
  handleIncomingFileTransfer,
  initiateFileTransfer, initiateVideoStreaming,
  addVideoStream, removeVideoStream
} from './files.js';

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

function updateParticipantCount() {
  const count = guestConns.size + 1;
  updatePulse(`${count} participant${count > 1 ? 's' : ''}`);
}

function setupHostControlConnection(conn) {
  conn.on('open', () => {
    guestConns.set(conn.peer, conn);
  });

  conn.on('data', data => {
    if (data.type === 'hello') {
      if (!checkRateLimit(conn.peer)) { conn.close(); return; }
      roomMembers.set(conn.peer, { name: data.name });
      updateParticipantCount();
      renderUserList();

      broadcast({ type: 'member_joined', member: { id: conn.peer, name: data.name } }, conn.peer);

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
      addChatToFeed(data).then(plaintext => {
        const plainMsg = { ...data, text: plaintext };
        chatHistory.push(plainMsg);
        if (chatHistory.length > 100) chatHistory.shift();
        dbSet('chatHistory', chatHistory.slice(-50));
      });
      broadcast(data, conn.peer);
    }
    else if (data.type === 'typing') {
      showTypingIndicator(data.senderId);
      broadcast(data, conn.peer);
    }
    else if (data.type === 'announce') {
      allKnownFiles.set(data.file.id, data.file);
      addFileToFeed(data.file);
      broadcast({ type: 'announce', file: data.file }, conn.peer);
    }
    else if (data.type === 'request_download') {
      const file = allKnownFiles.get(data.fileId);
      if (!file) return;

      if (file.ownerId === MY_ID) {
        initiateFileTransfer(data.requesterId, file.id);
      } else {
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
    }
    else if (data.type === 'request_stream') {
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

function connectToHost(hostId) {
  if (!hostId || hostId.length < 4) {
    showToast("Invalid room code.", "error");
    return;
  }

  setHostConn(peer.connect(hostId, { reliable: true }));
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
      initiateFileTransfer(data.requesterId, data.fileId);
    }
    else if (data.type === 'peer_wants_stream') {
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
    showToast("Host disconnected. Attempting migration...", "info");
    setRole(null);
    const hostId = window.location.hash.replace('#', '').toUpperCase().trim();
    if (!hostId || hostId.length < 4) { window.location.reload(); return; }
    const members = Array.from(roomMembers.keys()).filter(id => id !== MY_ID);
    const shouldBecomeHost = members.every(id => MY_ID < id);
    const backoff = Math.random() * 2000;
    setTimeout(() => {
      if (leaveInProgress) return;
      if (shouldBecomeHost) {
        attemptBecomeHost(hostId);
      } else {
        attemptReconnectAsGuest(hostId);
      }
    }, backoff);
  });
}

function attemptBecomeHost(hostId) {
  if (leaveInProgress) return;
  showToast("Taking over as host...", "info");
  setRole('host');
  setMY_ID(hostId);
  setPeer(new Peer(hostId, PEER_CONFIG));
  const p = peer;
  p.on('open', () => {
    showToast("You are now the room host!", "success");
    updatePulse('Connected (host)');
    setConnBar('ok', 'Hosting');
    guestConns.clear();
    const rcd = $('room-code-display');
    if (rcd) rcd.textContent = hostId;
    p.on('connection', conn => {
      if (conn.metadata && conn.metadata.transferFileId) {
        handleIncomingFileTransfer(conn, conn.metadata.transferFileId);
        return;
      }
      setupHostControlConnection(conn);
    });
    p.on('call', call => {
      try { call.answer(); handleCall(call); } catch (_) {}
    });
  });
  p.on('error', () => {
    showToast("Host takeover failed. Another peer may have claimed it.", "error");
    attemptReconnectAsGuest(hostId);
  });
}

function attemptReconnectAsGuest(hostId) {
  if (leaveInProgress) return;
  showToast("Reconnecting to new host...", "info");
  setRole(null);
  const delay = 1000 + Math.random() * 3000;
  setTimeout(() => {
    if (leaveInProgress) return;
    connectToHost(hostId);
  }, delay);
}

function cleanupPeerResources() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    setLocalStream(null);
  }
  for (const [, call] of activeCalls) try { call.close(); } catch (_) {}
  activeCalls.clear();
  stopHeartbeat();
  if (hostConn) { try { hostConn.close(); } catch (_) {} setHostConn(null); }
  for (const [, conn] of guestConns) { try { conn.close(); } catch (_) {} }
  guestConns.clear();
  if (peer) { try { peer.destroy(); } catch (_) {} setPeer(null); }
  for (const [, data] of activeStreams) { try { data.port.postMessage('ABORT'); } catch (_) {} }
  activeStreams.clear();
  mySharedFiles.clear();
  allKnownFiles.clear();
  chatHistory.length = 0;
  for (const [, pending] of pendingDownloads) clearTimeout(pending.timeoutTimer);
  pendingDownloads.clear();
  roomMembers.clear();
  avatarCache.clear();
  if (typingTimer) { clearTimeout(typingTimer); setTypingTimer(null); }
  if (audioCtx) { try { audioCtx.close(); } catch (_) {} setAudioCtx(null); }
  hideLoading(); hideDragOverlay();
  setRole(null);
  setLeaveInProgress(true);
  import('./db.js').then(m => { m.dbDel('chatHistory'); m.dbDel('files'); });
}

function stopScreenShare() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    setLocalStream(null);
  }
  removeVideoStream(MY_ID);
  for (const [, call] of activeCalls) try { call.close(); } catch (_) {}
  activeCalls.clear();
  const bss = $('btn-share-screen');
  if (bss) bss.style.color = '';
}

function initPeer(isCreatingHost, targetHostId) {
  if (peer) { try { peer.destroy(); } catch (_) {} setPeer(null); }
  setLeaveInProgress(false);

  $('btn-create-room').textContent = isCreatingHost ? 'Starting...' : 'Starting...';
  $('btn-join-room').textContent = isCreatingHost ? 'Join' : 'Joining...';

  showLoading(isCreatingHost ? 'Creating room...' : 'Joining room...');

  setPeer(new Peer(isCreatingHost ? MY_ID : null, PEER_CONFIG));

  peer.on('open', id => {
    hideLoading();
    deriveKey(isCreatingHost ? id : targetHostId).catch(() => {});
    const oldId = MY_ID;
    setMY_ID(id);

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
    chatHistory.forEach(addChatToFeed);
    allKnownFiles.forEach(addFileToFeed);
    setTimeout(() => { const ci = $('chat-input'); if (ci) ci.focus(); }, 300);

    if (isCreatingHost) {
      setRole('host');
      startHeartbeat();
      const rcd = $('room-code-display');
      if (rcd) rcd.textContent = id;
      roomMembers.set(MY_ID, { name: MY_NAME });
      renderUserList();
      updateParticipantCount();
    } else {
      setRole('guest');
      const rcd = $('room-code-display');
      if (rcd) rcd.textContent = targetHostId;
      connectToHost(targetHostId);
    }
  });

  peer.on('connection', conn => {
    if (conn.metadata && conn.metadata.transferFileId) {
      handleIncomingFileTransfer(conn, conn.metadata.transferFileId);
      return;
    }

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

export {
  initPeer, connectToHost, setupHostControlConnection,
  updateParticipantCount, updatePulse,
  cleanupPeerResources, handleCall,
  startHeartbeat, stopHeartbeat,
  checkRateLimit, joinAttempts,
  stopScreenShare
};
