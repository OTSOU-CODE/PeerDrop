const MAP = new Map();

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
  if (event.data.type === 'PING') {
    event.ports[0].postMessage({ type: 'PONG' });
  } else if (event.data.type === 'START_DOWNLOAD') {
    MAP.set(event.data.url, event.data.port);
  }
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.includes('/--peerdrop-download--/')) {
    const port = MAP.get(event.request.url);
    if (!port) {
      event.respondWith(new Response('Download session not found or expired.', { status: 404 }));
      return;
    }

    const filename = decodeURIComponent(url.searchParams.get('filename') || 'download');
    const size = url.searchParams.get('size');
    
    const headers = new Headers({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(filename)
    });
    
    if (size) {
      headers.set('Content-Length', size);
    }

    const stream = new ReadableStream({
      start(controller) {
        port.onmessage = e => {
          if (e.data === 'DONE') {
            controller.close();
            MAP.delete(event.request.url);
            port.close();
          } else if (e.data === 'ABORT') {
            controller.error('Aborted by sender');
            MAP.delete(event.request.url);
            port.close();
          } else {
            controller.enqueue(e.data);
          }
        };
      },
      cancel() {
        port.postMessage('CANCEL');
        MAP.delete(event.request.url);
        port.close();
      }
    });

    event.respondWith(new Response(stream, { headers }));
  }
});
