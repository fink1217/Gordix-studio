const CACHE_NAME = 'gordix-studio-v2';
const ASSETS = [
  './index.html',
  './CNC.html',
  './draw.html',
  './Gcodetrans.html',
  './table_conf.html',
  './vc.html',
  './params.html',
  './gordix-table.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Install Service Worker and cache all assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(err => {
        console.warn('Some assets failed to cache during install, continuing...', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate and clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 網路優先：有網路時一律拿最新版本並更新快取，離線時才用快取。
// （原本是先回快取，網站更新後第一次開啟會看到舊版，要重新整理第二次才是新版）
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseToCache));
      }
      return networkResponse;
    }).catch(() =>
      caches.match(e.request, { ignoreSearch: true }).then((cached) =>
        cached || new Response('Offline', { status: 503, statusText: 'Offline' }))
    )
  );
});
