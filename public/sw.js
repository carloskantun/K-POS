// Service worker: guarda la app en el dispositivo para abrirla sin internet.
// Cambia VERSION en cada despliegue para que los dispositivos tomen la nueva versión.
const VERSION = 'kpos-v2';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/css/app.css', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
  '/js/app.js', '/js/db.js', '/js/store.js', '/js/sync.js', '/js/ui.js', '/js/orders.js',
  '/js/auth.js', '/js/modifiers.js', '/js/printer.js', '/js/shared/csv.js',
  '/js/shared/schema.js', '/js/shared/util.js', '/js/shared/presets.js', '/js/shared/report.js',
  '/js/views/setup.js', '/js/views/login.js', '/js/views/pos.js', '/js/views/tables.js', '/js/views/kitchen.js',
  '/js/views/inventory.js', '/js/views/cash.js', '/js/views/reports.js', '/js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    // La app siempre abre, con o sin red.
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  // Primero caché (rápido y offline); en segundo plano se actualiza.
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(e.request);
    const net = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
