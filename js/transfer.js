/**
 * PeerDrop — File Transfer Engine (PeerJS)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sends / receives chunked files over a PeerJS DataConnection.
 *
 * Protocol (all messages are JSON strings — no binary ambiguity):
 *   files-info     → [{id, name, size, type}]  — file manifest
 *   file-start     → {fileId, name, size, type, totalChunks}
 *   chunk          → {fileId, chunkIndex, totalChunks, data: "<base64>"}
 *   file-done      → {fileId}
 *   transfer-done  → {}
 *   cancel         → {}
 */

class FileTransfer {

  /** @param {PeerJS.DataConnection} conn */
  constructor(conn) {
    this.conn = conn;
    this.cancelled = false;

    // ── Sender state ──────────────────────────────────────────────
    /** @type {Array<{id:string, file:File, name:string, size:number, type:string}>} */
    this.sendQueue = [];

    // ── Receiver state ────────────────────────────────────────────
    this._rx = {
      files: [],
      currentFile: null,    // {id, name, size, type, totalChunks, chunks:[], receivedBytes}
      totalSize: 0,
      totalReceived: 0,
      startedAt: 0,
    };

    // ── Speed ─────────────────────────────────────────────────────
    this._speedSamples = [];

    // ── Event system ──────────────────────────────────────────────
    /** @type {Object<string, Function[]>} */
    this._events = {};

    // ── Wire up incoming data ─────────────────────────────────────
    this.conn.on('data', (raw) => {
      try {
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        this._handle(msg);
      } catch (err) {
        console.warn('[Transfer] unparseable message', err);
      }
    });
  }

  // ═════════════════════════════════════════════════════════════════
  //  Sender API
  // ═════════════════════════════════════════════════════════════════

  /**
   * Queue files for sending.  Call before `start()`.
   * @param {File[]} fileList
   * @returns {{id:string, name:string, size:number}[]}
   */
  addFiles(fileList) {
    this.sendQueue = Array.from(fileList).map((f) => ({
      id: uid(),
      file: f,
      name: f.name,
      size: f.size,
      type: f.type || 'application/octet-stream',
    }));
    return this.sendQueue.map(({ id, name, size }) => ({ id, name, size }));
  }

  /**
   * Begin transferring all queued files.
   * Resolves when done (or cancelled).
   */
  async start() {
    if (this.sendQueue.length === 0) return;

    this.cancelled = false;
    this._speedSamples = [];

    const manifest = this.sendQueue.map((f) => ({
      id: f.id, name: f.name, size: f.size, type: f.type,
    }));
    this._send({ type: 'files-info', files: manifest });
    this._emit('files-info', manifest);

    for (const f of this.sendQueue) {
      if (this.cancelled) break;
      await this._sendFile(f);
    }

    if (!this.cancelled) {
      this._send({ type: 'transfer-done' });
      this._emit('complete');
    }
  }

  /** Cancel mid-transfer. */
  cancel() {
    this.cancelled = true;
    try { this.conn.send(JSON.stringify({ type: 'cancel' })); } catch { /* */ }
    this._emit('cancelled');
  }

  /** Tear down. */
  destroy() {
    this._events = {};
  }

  // ═════════════════════════════════════════════════════════════════
  //  Sender internals
  // ═════════════════════════════════════════════════════════════════

  /**
   * Stream one file in 16 KB base64 chunks.
   * @returns {Promise<void>}
   */
  _sendFile(fileInfo) {
    return new Promise((resolve) => {
      const { file, id, name, size } = fileInfo;
      const CHUNK = 16 * 1024;
      const totalChunks = Math.ceil(size / CHUNK);
      let idx = 0;
      let fileBytes = 0;
      const startedAt = performance.now();

      this._send({ type: 'file-start', fileId: id, name, size, type: fileInfo.type, totalChunks });
      this._emit('file-start', { fileId: id, fileName: name, fileSize: size });

      const next = () => {
        if (this.cancelled || idx >= totalChunks) {
          if (idx >= totalChunks) {
            this._send({ type: 'file-done', fileId: id });
            this._emit('file-sent', { fileId: id, fileName: name });
          }
          resolve();
          return;
        }

        const start = idx * CHUNK;
        const end = Math.min(start + CHUNK, size);
        const reader = new FileReader();

        reader.onload = (e) => {
          const buf = e.target.result;         // ArrayBuffer
          const bytes = new Uint8Array(buf);
          const binary = String.fromCharCode(...bytes);
          const b64 = btoa(binary);

          this._send({ type: 'chunk', fileId: id, chunkIndex: idx, totalChunks, data: b64 });

          idx++;
          fileBytes += bytes.length;

          // Progress
          const elapsed = (performance.now() - startedAt) / 1000;
          const speed = elapsed > 0 ? fileBytes / elapsed : 0;
          const totalBytes = this.sendQueue.reduce((s, f) => s + f.size, 0);
          const sentBefore = this.sendQueue
            .slice(0, this.sendQueue.indexOf(fileInfo))
            .reduce((s, f) => s + f.size, 0);

          this._emit('progress', {
            fileId: id,
            fileName: name,
            fileBytes,
            fileSize: size,
            fileProgress: (fileBytes / size) * 100,
            totalProgress: totalBytes > 0 ? ((sentBefore + fileBytes) / totalBytes) * 100 : 0,
            speed,
            totalSent: sentBefore + fileBytes,
            totalBytes,
          });

          // Backpressure — if PeerJS's internal buffer is full, wait
          if (this.conn.dataChannel && this.conn.dataChannel.bufferedAmount > 512 * 1024) {
            const handler = () => {
              this.conn.dataChannel.removeEventListener('bufferedamountlow', handler);
              setTimeout(next, 0);
            };
            this.conn.dataChannel.addEventListener('bufferedamountlow', handler);
          } else {
            setTimeout(next, 0);
          }
        };

        reader.readAsArrayBuffer(file.slice(start, end));
      };

      next();
    });
  }

  // ═════════════════════════════════════════════════════════════════
  //  Message dispatcher (sender & receiver)
  // ═════════════════════════════════════════════════════════════════

  /** @param {object} msg */
  _handle(msg) {
    switch (msg.type) {

      // ─── Receiver messages ─────────────────────────────────────
      case 'files-info':
        this._rx.files = msg.files;
        this._rx.totalSize = msg.files.reduce((s, f) => s + f.size, 0);
        this._emit('files-info', msg.files);
        break;

      case 'file-start':
        this._rx.currentFile = {
          id: msg.fileId,
          name: msg.name,
          size: msg.size,
          type: msg.type || 'application/octet-stream',
          totalChunks: msg.totalChunks,
          chunks: [],
          receivedBytes: 0,
        };
        this._rx.startedAt = performance.now();
        this._emit('file-start', msg);
        break;

      case 'chunk': {
        const f = this._rx.currentFile;
        if (!f || f.id !== msg.fileId) break;

        // Decode base64
        const binary = atob(msg.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        f.chunks.push(bytes);
        f.receivedBytes += bytes.length;

        const fileProgress = (f.receivedBytes / f.size) * 100;
        const totalProgress = this._rx.totalSize > 0
          ? ((this._rx.totalReceived + f.receivedBytes) / this._rx.totalSize) * 100
          : fileProgress;
        const elapsed = (performance.now() - this._rx.startedAt) / 1000;
        const speed = elapsed > 0 ? f.receivedBytes / elapsed : 0;

        this._emit('progress', {
          fileId: msg.fileId,
          fileName: f.name,
          fileBytes: f.receivedBytes,
          fileSize: f.size,
          fileProgress,
          totalProgress,
          speed,
        });
        break;
      }

      case 'file-done': {
        const file = this._rx.currentFile;
        if (!file || file.id !== msg.fileId) break;

        // Concatenate all chunks into one Blob
        const blob = new Blob(file.chunks, { type: file.type });
        this._rx.totalReceived += file.size;

        this._emit('file-received', {
          fileId: msg.fileId,
          name: file.name,
          size: file.size,
          type: file.type,
          blob,
        });

        this._rx.currentFile = null;
        break;
      }

      case 'transfer-done':
        this._emit('complete');
        break;

      case 'cancel':
        this.cancelled = true;
        this._emit('cancelled');
        break;
    }
  }

  // ═════════════════════════════════════════════════════════════════
  //  Helpers
  // ═════════════════════════════════════════════════════════════════

  _send(obj) {
    try { this.conn.send(JSON.stringify(obj)); } catch { /* */ }
  }

  // ═════════════════════════════════════════════════════════════════
  //  Event system
  // ═════════════════════════════════════════════════════════════════

  on(event, cb) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(cb);
    return () => { this._events[event] = this._events[event].filter((c) => c !== cb); };
  }

  _emit(event, data) {
    const cbs = this._events[event];
    if (cbs) cbs.forEach((cb) => cb(data));
  }
}
