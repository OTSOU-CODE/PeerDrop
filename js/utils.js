/**
 * PeerDrop — Utility helpers
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Format a byte count into a human-readable string (e.g. "4.2 MB"). */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / Math.pow(1024, i);
  return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
}

/** Format a transfer speed. */
function formatSpeed(bytesPerSec) {
  return formatBytes(bytesPerSec) + '/s';
}

/** Format seconds as a human ETA string. */
function formatETA(seconds) {
  if (!seconds || !isFinite(seconds)) return '—';
  if (seconds < 10) return '< 10s';
  if (seconds < 60) return Math.round(seconds) + 's';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Return a short unique id (~11 chars, url-safe). */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Safely get the type of a value. */
function typeOf(v) {
  return Object.prototype.toString.call(v).slice(8, -1).toLowerCase();
}

/**
 * Pick an emoji icon for a file based on its MIME type and name.
 */
function fileIcon(file) {
  if (file.type?.startsWith('image/')) return '🖼️';
  if (file.type?.startsWith('video/')) return '🎬';
  if (file.type?.startsWith('audio/')) return '🎵';
  if (file.type?.startsWith('text/'))  return '📄';
  if (file.type?.includes('pdf'))       return '📕';
  if (/zip|rar|7z|tar|gz|bz2/.test(file.type || '')) return '📦';
  const ext = (file.name || '').split('.').pop()?.toLowerCase();
  const map = {
    exe: '⚙️', dmg: '💿', apk: '📱',
    js: '💻', ts: '💻', py: '🐍', rb: '💎', go: '🔵', rs: '🦀',
    html: '🌐', css: '🎨', json: '📋', xml: '📋', yml: '📋', yaml: '📋',
    md: '📝', doc: '📝', docx: '📝',
    xls: '📊', xlsx: '📊', csv: '📊',
    ppt: '📽️', pptx: '📽️',
    mp3: '🎵', wav: '🎵', flac: '🎵',
    mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
  };
  return map[ext] || '📎';
}

/**
 * Show a toast notification in the toast container.
 * @param {'info' | 'success' | 'error'} level
 */
function showToast(message, level = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${level}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
