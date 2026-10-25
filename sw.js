'use strict';
/* Service worker: (1) shows push notifications even when the app is closed, (2) lets the app open with no network. */
const CACHE = 'ks-shell-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* app files: network first (so a new deploy shows up at once), saved copy when there is no network */
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;           // the API on Render is never touched here
  e.respondWith(netFirst(r, u));
});
async function netFirst(req, u) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 6000))]);
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      cache.keys().then(async ks => {                       // keep one copy per file (drop older ?v= versions)
        await Promise.all(ks.filter(k => new URL(k.url).pathname === u.pathname && k.url !== req.url).map(k => cache.delete(k)));
        await cache.put(req, copy);
      }).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' ? (await cache.match('index.html', { ignoreSearch: true })) || (await cache.match('./')) : null);
    if (hit) return hit;
    throw err;
  }
}

/* push: the server sends { title, body, tag, url, kind, ts } */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'KS', body: e.data ? e.data.text() : '' }; }
  const call = d.kind === 'call';
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'KS', {
      body: d.body || '',
      tag: d.tag || 'ks',
      renotify: true,
      icon: 'icon-192.png',
      badge: 'badge-72.png',
      timestamp: d.ts || Date.now(),
      requireInteraction: call,                              // an incoming call stays on screen until you tap it
      vibrate: call ? [500, 250, 500, 250, 500, 250, 500] : [200, 100, 200],
      data: { url: d.url || './', kind: d.kind || '', callId: d.callId || '' }
    });
    const cl = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    cl.forEach(c => c.postMessage({ type: 'push', kind: d.kind || '', callId: d.callId || '' }));   // an open app reacts at once
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const cl = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cl) {
      if (c.url.startsWith(self.registration.scope)) {
        try { await c.focus(); } catch (x) {}
        c.postMessage({ type: 'nav', url, kind: (e.notification.data || {}).kind || '' });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
