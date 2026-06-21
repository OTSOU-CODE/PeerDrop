/**
 * PeerDrop — Main Application Controller
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure static web app using PeerJS for cloud-signaled WebRTC.
 * No server needed — works by just opening index.html!
 */

(function () {
  'use strict';

  // ═════════════════════════════════════════════════════════════════════
  //  State
  // ═════════════════════════════════════════════════════════════════════

  const state = {
    mode: null,            // 'send' | 'receive'
    /** @type {Peer|null} */
    peer: null,
    /** @type {PeerJS.DataConnection|null} */
    conn: null,
    myId: null,
    remoteId: null,
    /** @type {FileTransfer|null} */
    transfer: null,
    files: [],
    receivedBlobs: [],
    connected: false,
    transferring: false,
  };

  // ═════════════════════════════════════════════════════════════════════
  //  DOM shortcuts
  // ═════════════════════════════════════════════════════════════════════

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ═════════════════════════════════════════════════════════════════════
  //  Bootstrap
  // ═════════════════════════════════════════════════════════════════════

  function init() {
    // Check URL hash for incoming receive mode
    const hash = window.location.hash;
    if (hash.startsWith('#receive:')) {
      const remote = hash.split(':')[1];
      if (remote) {
        startReceiveMode(remote);
        return;
      }
    }

    // ── Bind UI ───────────────────────────────────────────────────

    // Mode cards
    $$('.js-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === 'send') startSendMode();
        else showLinkPrompt();
      });
    });

    // Theme
    $('#themeBtn').addEventListener('click', toggleTheme);

    // Drop zone
    const dz = $('#dropZone');
    const fi = $('#fileInput');
    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
    fi.addEventListener('change', () => { if (fi.files.length) handleFiles(fi.files); });

    // Buttons
    $('#copyBtn').addEventListener('click', copyLink);
    $('#cancelBtn').addEventListener('click', cancelTransfer);
    $('#newTransferBtn').addEventListener('click', resetApp);
    $('#joinBtn').addEventListener('click', () => {
      const val = $('#linkInput').value.trim();
      if (!val) return showToast('Paste a link first', 'error');
      // Extract peer ID from URL like http://...#receive:PEERID
      const m = val.match(/#receive:(.+)$/);
      if (m && m[1]) startReceiveMode(m[1]);
      else showToast('Invalid link format', 'error');
    });
    $('#linkInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#joinBtn').click();
    });

    showWelcome();
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Mode: Send
  // ═════════════════════════════════════════════════════════════════════

  function startSendMode() {
    state.mode = 'send';
    showView('send');
    setBadge('connecting', 'Creating Peer…');
    showToast('Creating your peer ID…', 'info');

    state.peer = new Peer();

    state.peer.on('open', (id) => {
      state.myId = id;
      setBadge('connected', 'Online');
      const url = linkForPeer(id);
      updateShareLink(url);
      // Re-show send view now that we have a peer
      showView('send');
    });

    state.peer.on('connection', (conn) => {
      // We already have a connection — reject extras
      if (state.conn) { conn.close(); return; }
      state.conn = conn;
      state.remoteId = conn.peer;

      conn.on('open', () => {
        state.connected = true;
        setBadge('connected', 'Connected');
        $('#sendStatus').textContent = '🔵 Peer connected! Starting transfer…';
        const dot = $('#sendStatus .pulse-dot');
        if (dot) dot.remove();

        // Auto-start if files are already selected
        if (state.files.length > 0) {
          beginSend();
        }
      });

      conn.on('close', () => onDisconnect());
      conn.on('error', (err) => {
        showToast(`Connection error: ${err.message}`, 'error');
      });
    });

    state.peer.on('error', (err) => {
      setBadge('disconnected', 'Error');
      showToast(`Peer error: ${err.message}`, 'error');
    });
  }

  function handleFiles(fileList) {
    state.files = Array.from(fileList);
    renderFileList(state.files, 'fileList');
    showSharePanel();

    // If already connected to a peer, start immediately
    if (state.connected && state.conn) {
      beginSend();
    }
  }

  function beginSend() {
    initTransfer();
    state.transfer.addFiles(state.files);
    state.transfer.start().catch((err) => {
      showToast(`Send failed: ${err.message}`, 'error');
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Mode: Receive
  // ═════════════════════════════════════════════════════════════════════

  function startReceiveMode(remotePeerId) {
    state.mode = 'receive';
    state.remoteId = remotePeerId;
    showView('receive');
    $('#receiveRoomInfo').textContent = `Connecting to peer…`;
    setBadge('connecting', 'Connecting…');

    state.peer = new Peer();

    state.peer.on('open', () => {
      setBadge('connected', 'Connected');
      // Strip query/hash from the URL to keep it clean
      try { history.replaceState(null, '', window.location.pathname); } catch { /* */ }

      state.conn = state.peer.connect(remotePeerId, { reliable: true });

      state.conn.on('open', () => {
        state.connected = true;
        $('#receiveRoomInfo').textContent = '✅ Connected! Waiting for files…';
        initTransfer();
      });

      state.conn.on('close', () => onDisconnect());
      state.conn.on('error', (err) => {
        showToast(`Connection error: ${err.message}`, 'error');
      });
    });

    state.peer.on('error', (err) => {
      setBadge('disconnected', 'Error');
      showToast(`Failed to connect: ${err.message}. Is the link still valid?`, 'error');
      $('#receiveRoomInfo').textContent = `❌ ${err.message}`;
    });
  }

  function showLinkPrompt() {
    showView('link-prompt');
    setTimeout(() => $('#linkInput').focus(), 200);
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Transfer orchestration
  // ═════════════════════════════════════════════════════════════════════

  function initTransfer() {
    if (state.transfer) state.transfer.destroy();
    state.transfer = new FileTransfer(state.conn);

    const isSender = state.mode === 'send';

    state.transfer.on('files-info', (files) => {
      state.files = files;
      renderFileList(files, 'receiveFilesPreview');
      $('#receiveFilesPreview').classList.remove('hidden');
    });

    state.transfer.on('file-start', (info) => {
      state.transferring = true;
      showView('transfer');
      $('#transferLabel').textContent = `${isSender ? 'Sending' : 'Receiving'} ${escHtml(info.fileName)}…`;
    });

    state.transfer.on('progress', (d) => updateUI(d, isSender));

    state.transfer.on('file-received', (d) => {
      state.receivedBlobs.push(d);
    });

    state.transfer.on('complete', () => {
      state.transferring = false;
      doneView(isSender);
    });

    state.transfer.on('cancelled', () => {
      state.transferring = false;
      showToast('Transfer cancelled', 'info');
      resetApp();
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  //  UI updates
  // ═════════════════════════════════════════════════════════════════════

  function updateUI(d, isSender) {
    const prefix = isSender ? 'Sending' : 'Receiving';
    $('#transferLabel').textContent = `${prefix} ${escHtml(d.fileName)}…`;
    $('#transferSpeed').textContent = formatSpeed(d.speed || 0);

    if (d.speed > 0) {
      const left = (d.totalBytes || d.fileSize) - (d.totalSent || d.fileBytes);
      $('#transferEta').textContent = `ETA: ${formatETA(left / d.speed)}`;
    }

    const pct = Math.min(d.totalProgress || d.fileProgress, 100);
    $('#overallBar').style.width = `${pct}%`;
    $('#overallPercent').textContent = `${Math.round(pct)}%`;

    const sent = d.totalSent || d.fileBytes || 0;
    const total = d.totalBytes || d.fileSize || 0;
    $('#overallBytes').textContent = `${formatBytes(sent)} / ${formatBytes(total)}`;

    // Per-file row
    const container = $('#filesProgress');
    let row = container.querySelector(`[data-fid="${d.fileId}"]`);
    if (!row) {
      row = document.createElement('div');
      row.className = 'file-row sending';
      row.dataset.fid = d.fileId;
      row.innerHTML = `
        <span class="file-icon">${fileIcon({ name: d.fileName, type: '' })}</span>
        <div class="file-progress-block">
          <div class="file-info">
            <div class="file-name">${escHtml(d.fileName)}</div>
            <div class="mini-track"><div class="mini-fill" style="width:0%"></div></div>
          </div>
          <span class="file-percent">0%</span>
          <span class="file-speed">0 B/s</span>
        </div>
      `;
      container.appendChild(row);
    }

    const fp = Math.min(d.fileProgress || 0, 100);
    row.querySelector('.mini-fill').style.width = `${fp}%`;
    row.querySelector('.file-percent').textContent = `${Math.round(fp)}%`;
    row.querySelector('.file-speed').textContent = formatSpeed(d.speed || 0);
  }

  function doneView(isSender) {
    showView('complete');
    const summary = $('#completeSummary');
    if (isSender) {
      const sz = state.files.reduce((s, f) => s + f.size, 0);
      summary.textContent = `Sent ${state.files.length} file(s) (${formatBytes(sz)}).`;
    } else {
      const sz = state.receivedBlobs.reduce((s, f) => s + f.size, 0);
      summary.textContent = `Received ${state.receivedBlobs.length} file(s) (${formatBytes(sz)}).`;
      renderDownloads();
    }
    showToast('✅ Transfer complete!', 'success');
  }

  function renderDownloads() {
    const container = $('#receivedFiles');
    container.innerHTML = '';
    state.receivedBlobs.forEach((f) => {
      const url = URL.createObjectURL(f.blob);
      const row = document.createElement('div');
      row.className = 'file-row completed';
      row.innerHTML = `
        <span class="file-icon">${fileIcon(f)}</span>
        <div class="file-info">
          <div class="file-name">${escHtml(f.name)}</div>
          <div class="file-meta">${formatBytes(f.size)}</div>
        </div>
        <button class="download-btn" data-url="${url}" data-name="${escHtml(f.name)}">⬇ Download</button>
      `;
      row.querySelector('.download-btn').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
      container.appendChild(row);
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Navigation
  // ═════════════════════════════════════════════════════════════════════

  function showView(name) {
    $$('.view').forEach((el) => el.classList.remove('active'));
    const el = document.getElementById(`view-${name}`);
    if (el) el.classList.add('active');
  }

  function showWelcome() {
    state.mode = null;
    state.connected = false;
    state.transferring = false;
    state.files = [];
    state.receivedBlobs = [];
    try { history.replaceState(null, '', window.location.pathname); } catch { /* */ }
    showView('welcome');
  }

  function resetApp() {
    if (state.transfer) { state.transfer.destroy(); state.transfer = null; }
    if (state.conn) { try { state.conn.close(); } catch { /* */ } state.conn = null; }
    if (state.peer) { state.peer.destroy(); state.peer = null; }
    state.myId = null;
    state.remoteId = null;

    $('#filesProgress').innerHTML = '';
    $('#fileList').innerHTML = '';
    $('#receivedFiles').innerHTML = '';
    $('#sharePanel').classList.add('hidden');
    $('#receiveFilesPreview').classList.add('hidden');
    $('#overallBar').style.width = '0%';
    setBadge('disconnected', 'Disconnected');
    showWelcome();
  }

  function cancelTransfer() {
    if (state.transfer) state.transfer.cancel();
    resetApp();
  }

  function onDisconnect() {
    state.connected = false;
    setBadge('disconnected', 'Disconnected');
    if (state.transferring) {
      showToast('Peer disconnected', 'error');
      cancelTransfer();
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Share link helpers
  // ═════════════════════════════════════════════════════════════════════

  function linkForPeer(peerId) {
    return `${window.location.origin}${window.location.pathname}#receive:${peerId}`;
  }

  function updateShareLink(url) {
    $('#shareLinkInput').value = url;
    const qr = $('#qrImage');
    qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
    qr.alt = `QR: ${url}`;
    qr.classList.remove('hidden');
    try { history.replaceState(null, '', url); } catch { /* */ }
  }

  async function copyLink() {
    const val = $('#shareLinkInput').value;
    try {
      await navigator.clipboard.writeText(val);
      showToast('Link copied!', 'success');
    } catch {
      $('#shareLinkInput').select();
      document.execCommand('copy');
      showToast('Link copied!', 'success');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Misc UI
  // ═════════════════════════════════════════════════════════════════════

  function setBadge(cls, label) {
    const b = $('#statusBadge');
    b.className = `status-badge ${cls}`;
    b.textContent = label;
  }

  function toggleTheme() {
    const h = document.documentElement;
    const next = h.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    h.setAttribute('data-theme', next);
    $('#themeBtn').textContent = next === 'dark' ? '🌙' : '☀️';
  }

  function renderFileList(files, containerId) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
    Array.from(files).forEach((f) => {
      c.appendChild(fileRowEl(f));
    });
  }

  function fileRowEl(f) {
    const div = document.createElement('div');
    div.className = 'file-row';
    div.innerHTML = `
      <span class="file-icon">${fileIcon(f)}</span>
      <div class="file-info">
        <div class="file-name">${escHtml(f.name)}</div>
        <div class="file-meta">${formatBytes(f.size)}</div>
      </div>`;
    return div;
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Start
  // ═════════════════════════════════════════════════════════════════════

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
