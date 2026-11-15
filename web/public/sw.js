// Offline shell: cache the app files; data always comes fresh from the network.
// Team logos never change mid-season, so once one has been seen it's served from the device straight away.
const C = 'board-v2', LOGOS = 'logos-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(C).then((c) => c.addAll(['/', '/icon.svg']))); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C && k !== LOGOS).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname === 'a.espncdn.com' && /teamlogos/.test(u.href)) {
    e.respondWith(caches.open(LOGOS).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }))));
    return;
  }
  if (u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('/'))));
});
