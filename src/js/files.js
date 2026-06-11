'use strict';

import {
  $, hide, show, escapeHTML, sanitizeFilename, fmt, fmtSpeed, fmtEta,
  mimeEmoji, mimeIcon, getAvatarParams,
  CHUNK_SIZE, STREAM_QUALITIES,
  peer, role, hostConn, guestConns, roomMembers,
  allKnownFiles, mySharedFiles, pendingDownloads,
  MY_ID, MY_NAME, activeCalls, localStream, activeStreams,
  avatarCache, broadcast
} from './state.js';
import { showToast, showDragOverlay, hideDragOverlay, notify } from './ui.js';
import { dbSet } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { playSound } from './audio.js';

function addSystemMessage(text, emoji = '📌') {
  hide('empty-feed-msg');
  const feed = $('file-feed');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = 'system-msg feed-item';
  div.dataset.type = 'system';
  const inner = document.createElement('div');
  inner.className = 'system-msg-inner';
  inner.textContent = emoji + ' ' + text;
  div.appendChild(inner);
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

function buildFileChip(fileMeta, isMine, av, div) {
  const icon = mimeIcon(fileMeta.mime);
  const iconEl = document.createElement('div');
  iconEl.className = 'file-type-icon'; iconEl.style.background = icon.bg;
  iconEl.textContent = icon.emoji;
  div.appendChild(iconEl);

  const info = document.createElement('div');
  info.className = 'file-chip-info';

  const nameP = document.createElement('p');
  nameP.className = 'file-chip-name'; nameP.textContent = fileMeta.name;
  info.appendChild(nameP);

  const sizeP = document.createElement('p');
  sizeP.className = 'file-chip-size'; sizeP.textContent = fmt(fileMeta.size);
  info.appendChild(sizeP);

  if (fileMeta.thumbnail && fileMeta.thumbnail.startsWith('data:image/')) {
    const twrap = document.createElement('div');
    twrap.className = 'thumbnail-wrap';
    const timg = document.createElement('img');
    timg.src = fileMeta.thumbnail; timg.alt = '';
    twrap.appendChild(timg);
    info.appendChild(twrap);
  }

  const pw = document.createElement('div');
  pw.id = 'prog-wrap-' + fileMeta.id;
  pw.style.cssText = 'display:none;margin-top:10px';
  const pt = document.createElement('div');
  pt.className = 'progress-track';
  const pf = document.createElement('div');
  pf.id = 'prog-fill-' + fileMeta.id; pf.className = 'progress-fill';
  pt.appendChild(pf); pw.appendChild(pt);
  const pi = document.createElement('div');
  pi.className = 'progress-info';
  const pp = document.createElement('span');
  pp.id = 'prog-pct-' + fileMeta.id; pp.className = 'progress-pct'; pp.textContent = '0%';
  const ps = document.createElement('span');
  ps.id = 'prog-speed-' + fileMeta.id; ps.className = 'progress-speed';
  const pe = document.createElement('span');
  pe.id = 'prog-eta-' + fileMeta.id; pe.className = 'progress-eta';
  pi.append(pp, ps, pe); pw.appendChild(pi); info.appendChild(pw);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:6px;margin-top:10px;flex-shrink:0;flex-wrap:wrap';
  if (!isMine && fileMeta.mime && fileMeta.mime.startsWith('video/')) {
    const sb = document.createElement('button');
    sb.id = 'btn-stream-' + fileMeta.id; sb.className = 'btn-primary stream-btn btn-sm';
    sb.style.cssText = 'padding:8px 14px!important'; sb.textContent = '▶ Stream';
    btnRow.appendChild(sb);
    const sel = document.createElement('select');
    sel.id = 'stream-quality-' + fileMeta.id; sel.className = 'glass-input';
    sel.style.cssText = 'width:auto;padding:6px 8px;font-size:.72rem;cursor:pointer;flex:0;min-width:65px';
    for (const [k, v] of Object.entries(STREAM_QUALITIES)) {
      const opt = document.createElement('option'); opt.value = k; opt.textContent = v.label;
      if (k === 'auto') opt.selected = true;
      sel.appendChild(opt);
    }
    btnRow.appendChild(sel);
  }
  if (isMine) {
    const ub = document.createElement('button');
    ub.id = 'btn-ul-' + fileMeta.id; ub.disabled = true;
    ub.className = 'btn-primary btn-ghost-sm'; ub.textContent = 'Shared';
    btnRow.appendChild(ub);
  } else {
    const db = document.createElement('button');
    db.id = 'btn-dl-' + fileMeta.id; db.className = 'btn-primary btn-dl btn-sm';
    db.textContent = '↓ Download';
    btnRow.appendChild(db);
  }
  info.appendChild(btnRow);
  div.appendChild(info);
}

function showFilePreview(fileMeta) {
  const overlay = $('preview-overlay'); const body = $('preview-body');
  if (!overlay || !body) return;
  body.textContent = '';
  const label = document.createElement('div'); label.className = 'preview-label'; label.textContent = escapeHTML(fileMeta.name);
  body.appendChild(label);
  const mime = (fileMeta.mime || '').toLowerCase();
  if (mime.startsWith('image/')) {
    const img = document.createElement('img'); img.src = fileMeta.thumbnail || ''; img.alt = fileMeta.name;
    if (!img.src) { img.style.display = 'none'; showToast('Preview not available for this image.', 'info'); }
    body.appendChild(img);
  } else if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript')) {
    const pre = document.createElement('pre'); pre.textContent = 'Loading preview...';
    body.appendChild(pre);
    const f = allKnownFiles.get(fileMeta.id);
    if (f && f.ownerId === MY_ID) {
      const blob = mySharedFiles.get(fileMeta.id);
      if (blob) blob.text().then(t => { pre.textContent = t; });
    }
  } else if (mime.includes('pdf')) {
    const f = allKnownFiles.get(fileMeta.id);
    if (f && f.ownerId === MY_ID) {
      const blob = mySharedFiles.get(fileMeta.id);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const ifr = document.createElement('iframe'); ifr.src = url;
        body.appendChild(ifr);
      }
    } else {
      showToast('PDF preview only available for files you own.', 'info');
    }
  }
  overlay.hidden = false;
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
      if (btn.textContent === 'Cancel') return;
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

function addFileToFeed(fileMeta) {
  hide('empty-feed-msg');

  const feed = $('file-feed');
  const isMine = peer && fileMeta.ownerId === peer.id;
  const av = getAvatarParams(fileMeta.ownerId);
  const owner = roomMembers.get(fileMeta.ownerId);
  const ownerName = owner ? owner.name : (isMine ? MY_NAME : 'Someone');

  if (!isMine) notify("New File Shared", fileMeta.name);

  addSystemMessage(`${mimeEmoji(fileMeta.mime)} ${fileMeta.name} shared by ${ownerName}`, '');

  const div = document.createElement('div');
  div.className = 'file-chip feed-item' + (isMine ? ' mine' : '');
  div.dataset.type = 'file';

  buildFileChip(fileMeta, isMine, av, div);

  const context = { peer, role, guestConns, hostConn };
  attachFileChipEvents(div, fileMeta, isMine, context);
  const mime = (fileMeta.mime || '').toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('pdf')) {
    div.style.cursor = 'pointer';
    div.addEventListener('click', e => { if (!e.target.closest('button,select')) showFilePreview(fileMeta); });
  }

  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

function finishFileAnnounce(fileId, fileMeta) {
    for (const [, f] of allKnownFiles) {
      if (f.name === fileMeta.name && f.size === fileMeta.size) {
        showToast('File already shared: ' + fileMeta.name, 'info');
        return;
      }
    }
    allKnownFiles.set(fileId, fileMeta);
    dbSet('files', Array.from(allKnownFiles.entries()));
    addFileToFeed(fileMeta);

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

function handleDrop(e) {
  e.preventDefault();
  const roomView = $('room-view');
  if (roomView) roomView.classList.remove('drag-active');
  hideDragOverlay();
  if (e.dataTransfer.files.length > 0) handleFilesSelected(e.dataTransfer.files);
}

function handlePaste(e) {
  if (role !== 'host' && (!hostConn || !hostConn.open)) {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      showToast('Join a room first to share files', 'info');
    }
    return;
  }
  if (e.clipboardData.files && e.clipboardData.files.length > 0) {
    e.preventDefault();
    handleFilesSelected(Array.from(e.clipboardData.files));
  }
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

    if (!isLocal) {
      const controls = document.createElement('div');
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      controls.style.cssText = 'position:absolute;top:8px;right:8px;display:flex;gap:6px;opacity:' + (isTouch ? '0.7' : '0') + ';transition:opacity .3s ease';
      wrap.addEventListener('mouseenter', () => controls.style.opacity = '1');
      wrap.addEventListener('mouseleave', () => { if (!document.pictureInPictureElement) controls.style.opacity = isTouch ? '0.7' : '0'; });
      if (isTouch) {
        controls.addEventListener('click', () => {
          controls.style.opacity = controls.style.opacity === '0.7' ? '1' : '0.7';
        });
      }

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

      const fsBtn = makeBtn('⛶', 'Fullscreen', () => {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          wrap.requestFullscreen().catch(() => {});
        }
      });
      controls.appendChild(fsBtn);

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

function initiateFileTransfer(targetPeerId, fileId) {
  const file = mySharedFiles.get(fileId);
  if (!file) return;

  let xferConn;
  const resetUploadBtn = () => {
    const btn = $(`btn-ul-${fileId}`);
    if (btn) { btn.classList.remove('downloading', 'done'); btn.textContent = 'Upload'; btn.disabled = false; }
    const chipEl = btn?.closest('.file-chip');
    if (chipEl) chipEl.classList.remove('downloading-glow');
  };

  let aborted = false;
  let xferComplete = false;

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
  xferConn.on('close', () => {
    if (aborted) { resetUploadBtn(); return; }
    if (!xferComplete) {
      aborted = true;
      resetUploadBtn();
    }
  });

  xferConn.on('open', () => {
    let offset = 0, ulStart = Date.now();
    const btn = $(`btn-ul-${fileId}`);
    const pctEl = document.createElement('span');
    pctEl.style.cssText = 'font-size:.6rem;color:var(--text-muted);display:block;margin-top:2px';
    if (btn && btn.parentNode) btn.parentNode.appendChild(pctEl);

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
      reader.onload = async e => {
        if (aborted) return;
        try {
          const encrypted = await encrypt(e.target.result);
          xferConn.send(encrypted);
        } catch {
          aborted = true;
          showToast('Upload failed.', 'error');
          resetUploadBtn();
          return;
        }
        offset += e.target.result.byteLength;

        const elapsed = (Date.now() - ulStart) / 1000;
        const speed = elapsed > 0 ? offset / elapsed : 0;
        const etaSecs = speed > 0 ? (file.size - offset) / speed : 0;
        const pct = Math.round(offset / file.size * 100);
        const chipEl = btn?.closest('.file-chip');
        if (btn) {
          if (!btn.classList.contains('downloading') && pct < 100) {
            btn.classList.add('downloading');
            if (chipEl) chipEl.classList.add('downloading-glow');
          }
          btn.textContent = `${pct}%`;
          if (pctEl) pctEl.textContent = fmtSpeed(speed) + (etaSecs > 0 && etaSecs < 3600 ? ' · ' + fmtEta(etaSecs) : '');
          if (pct === 100) {
            btn.classList.remove('downloading');
            btn.classList.add('done');
            btn.textContent = '✅';
            if (chipEl) chipEl.classList.remove('downloading-glow');
            if (pctEl) pctEl.textContent = '';
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

function initiateVideoStreaming(targetPeerId, fileId, quality = 'auto') {
  const file = mySharedFiles.get(fileId);
  if (!file) {
    showToast('File no longer available for streaming.', 'error');
    return;
  }

  const hasCaptureStream = typeof HTMLVideoElement !== 'undefined' &&
    (!!HTMLVideoElement.prototype.captureStream || !!HTMLVideoElement.prototype.mozCaptureStream);
  if (!hasCaptureStream) {
    showToast('Video streaming not supported in this browser.', 'error');
    return;
  }

  let useCanvas = quality !== 'auto' && (typeof HTMLCanvasElement.prototype.captureStream === 'function');
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
        const canvas = document.createElement('canvas');
        canvas.width = q.w;
        canvas.height = q.h;
        const ctx = canvas.getContext('2d');
        const draw = () => {
          if (video.paused || video.ended) return;
          ctx.drawImage(video, 0, 0, q.w, q.h);
          requestAnimationFrame(draw);
        };
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

  if (btn) {
    btn.textContent = 'Cancel';
    btn.classList.add('downloading');
    btn.disabled = false;
    const cancelTransfer = () => {
      if (cancelled) return;
      cancelled = true;
      if (swPort) { try { swPort.postMessage('ABORT'); } catch(_) {} swPort = null; }
      try { conn.close(); } catch(_) {}
      btn.textContent = '↓ Download';
      btn.classList.remove('downloading', 'done');
      btn.disabled = false;
      btn.removeEventListener('click', cancelTransfer);
      if (chipEl) chipEl.classList.remove('downloading-glow');
      if (progWrap) progWrap.style.display = 'none';
      if (pendingUIUpdate) { cancelAnimationFrame(pendingUIUpdate); pendingUIUpdate = null; }
      showToast('Download cancelled.', 'info');
    };
    btn.addEventListener('click', cancelTransfer);
  }
  if (progWrap) progWrap.style.display = 'block';

  let cancelled = false;
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

  let swPort = null;
  const dlUrl = '/--peerdrop-download--/' + fileId + '?filename=' + encodeURIComponent(fileMeta.name) + '&size=' + fileMeta.size;
  if (navigator.serviceWorker.controller) {
    const mc = new MessageChannel();
    navigator.serviceWorker.controller.postMessage({ type: 'START_DOWNLOAD', url: dlUrl, port: mc.port2 }, [mc.port2]);
    swPort = mc.port1;
  }

  const processChunk = async (data) => {
    if (writeError || cancelled) return;

    let buf = data;
    if (buf instanceof Blob) buf = await buf.arrayBuffer();
    else if (!(buf instanceof Uint8Array)) buf = new Uint8Array(buf);
    try { buf = await decrypt(buf); } catch (e) { console.warn('decrypt failed:', e); }

    if (swPort) { swPort.postMessage(buf); } else { chunks.push(buf); }

    if (dataQueue.length === 0 && receivedBytes >= fileMeta.size) {
      if (swPort) { try { swPort.postMessage('DONE'); } catch(_) {} swPort = null; }
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
      window.triggerParticleBurst(rect.left + rect.width/2, rect.top + rect.height/2);

      if (swPort) {
        const ifr = document.createElement('iframe');
        ifr.style.display = 'none'; ifr.src = dlUrl;
        document.body.appendChild(ifr);
        setTimeout(() => ifr.remove(), 5000);
      } else {
        const blob = new Blob(chunks);
        chunks.length = 0;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = sanitizeFilename(fileMeta.name);
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
      }
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

  const MAX_QUEUE = 50;
  conn.on('data', data => {
    if (writeError) return;
    if (dataQueue.length > MAX_QUEUE) return;
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

export {
  addFileToFeed, attachFileChipEvents,
  handleFilesSelected, handleDrop, handlePaste,
  initiateFileTransfer, initiateVideoStreaming,
  handleIncomingFileTransfer, addSystemMessage,
  addVideoStream, removeVideoStream, showFilePreview
};
