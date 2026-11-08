/* Offline-Cache: erst das Netz fragen (mit kurzer Wartezeit), sonst aus dem Cache.
   So bekommt man online immer die aktuelle Version und offline die zuletzt geladene. */
const CACHE = 'standkasse-v4';
const FILES = ['./', 'index.html', 'style.css?v=4', 'app.js?v=4', 'icon.svg?v=4', 'vendor/qrcode.js', 'vendor/jsQR.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const WAIT_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
    const timeout = new Promise(res => setTimeout(() => res(null), WAIT_MS));
    try {
      const r = await Promise.race([net, timeout]);
      if (r) return r;
    } catch (err) { /* offline */ }
    const hit = await c.match(e.request);
    if (hit) return hit;
    try { return await net; } catch (err) { return new Response('Offline', { status: 503 }); }
  })());
});
