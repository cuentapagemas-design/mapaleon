/* Service worker de León TOP 20 — caché básica offline del app shell.
   Sube CACHE_VERSION cuando cambien los assets para forzar actualización. */
'use strict';

const CACHE = 'leon-top20-v6';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './config.js',
  './cloud.js',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './data/tapeo.json',
  './data/comida.json',
  './data/visitar.json',
  './data/ads.json',
  './data/descuentos.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // /data/*.json: network-first (rankings/anuncios frescos), con fallback a caché.
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Resto (app shell, mismo origen): cache-first con relleno desde red.
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req)
        .then((res) => {
          if (url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached)
    )
  );
});
