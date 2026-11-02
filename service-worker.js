// 改共用 JS 時，這裡和各網頁 <script src="gordix-*.js?v=N"> 的版本號一起加 1，
// 避免瀏覽器拿到「新網頁＋快取裡的舊共用檔」而整頁出錯。
const CACHE_NAME = 'gordix-studio-v24';
const ASSETS = [
  './index.html',
  './CNC.html',
  './draw.html',
  './Gcodetrans.html',
  './table_conf.html',
  './stock.html',
  './vc.html',
  './params.html',
  './gordix-table.js',
  './gordix-workspace.js',
  './gordix-import.js',
  './gordix-cam.js',
  './gordix-route.js',
  './gordix-project.js',
  './gordix-recovered.js',
  './gordix-recover-import.js',
  './gordix-gcode-preview.js',
  './gordix-regions.js',
  './gordix-objects.js',
  './gordix-preview.js',
  './gordix-materials.js',
  './gordix-sim.js',
  './gordix-vcarve.js',
  './gordix-calc.js',
  './gordix-ui.css',
  './gordix-ui.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './vendor/tailwindcss.js',
  './vendor/three-0.128.0.min.js',
  './vendor/OrbitControls-0.128.0.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Install Service Worker and cache all assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // cache: 'reload' 跳過瀏覽器的 HTTP 快取，裝進離線快取的一定是伺服器上的最新版
      return cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))).catch(err => {
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
    // 同網站的檔案一律向伺服器確認是否有新版（沒變只回 304，很快），不直接用瀏覽器快取裡可能過期的舊檔
    // （頁面導覽的 request 不能帶 init 重建，所以同網站一律用網址重新抓）
    (new URL(e.request.url).origin === self.location.origin ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request)).then((networkResponse) => {
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
