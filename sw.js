const DOWNLOAD_SESSIONS = new Map();
const SESSION_TIMEOUT = 5 * 60 * 1000;

function cleanupSession(url) {
  const session = DOWNLOAD_SESSIONS.get(url);
  if (session) {
    if (session.port) session.port.close();
    if (session.timeout) clearTimeout(session.timeout);
    DOWNLOAD_SESSIONS.delete(url);
  }
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [url, session] of DOWNLOAD_SESSIONS.entries()) {
    if (now - session.createdAt > SESSION_TIMEOUT) {
      cleanupSession(url);
    }
  }
}

setInterval(cleanupExpiredSessions, 60000);

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
  try {
    if (event.data?.type === 'PING') {
      event.ports[0].postMessage({ type: 'PONG' });
    } else if (event.data?.type === 'START_DOWNLOAD') {
      const { url, port } = event.data;
      if (!url || !port) return;
      
      const existing = DOWNLOAD_SESSIONS.get(url);
      if (existing) cleanupSession(url);
      
      DOWNLOAD_SESSIONS.set(url, {
        port,
        createdAt: Date.now(),
        timeout: setTimeout(() => cleanupSession(url), SESSION_TIMEOUT)
      });
    }
  } catch (err) {
    console.error('[SW] Message handler error:', err);
  }
});

self.addEventListener('fetch', event => {
  try {
    const url = new URL(event.request.url);
    if (!url.pathname.includes('/--peerdrop-download--/')) return;

    const session = DOWNLOAD_SESSIONS.get(event.request.url);
    if (!session?.port) {
      event.respondWith(new Response('Download session not found or expired.', { 
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      }));
      return;
    }

    const filename = decodeURIComponent(url.searchParams.get('filename') || 'download');
    const size = url.searchParams.get('size');
    
    const headers = new Headers({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    });
    
    if (size) headers.set('Content-Length', size);

    const stream = new ReadableStream({
      start(controller) {
        const { port } = session;
        
        port.onmessage = e => {
          try {
            if (e.data === 'DONE') {
              controller.close();
              cleanupSession(event.request.url);
            } else if (e.data === 'ABORT') {
              controller.error('Aborted by sender');
              cleanupSession(event.request.url);
            } else if (e.data instanceof Uint8Array) {
              controller.enqueue(e.data);
            }
          } catch (err) {
            controller.error(err);
            cleanupSession(event.request.url);
          }
        };
        
        port.onmessageerror = () => {
          controller.error('Port message error');
          cleanupSession(event.request.url);
        };
      },
      cancel(reason) {
        try {
          session.port.postMessage('CANCEL');
        } catch (_) {}
        cleanupSession(event.request.url);
      }
    });

    event.respondWith(new Response(stream, { headers }));
  } catch (err) {
    console.error('[SW] Fetch handler error:', err);
    event.respondWith(new Response('Internal server error', { status: 500 }));
  }
});