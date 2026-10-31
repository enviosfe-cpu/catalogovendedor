/**
 * Distribuciones Castro Preventa - Service Worker for 100% Offline App
 * Modo Offline Total: Shell + datos + CDNs + fotos vistas en caché local.
 * Carga instantánea y siempre actualizada al tener red.
 */
const CACHE_NAME = 'castro-preventa-v6.3';
const ASSETS_TO_CACHE = [
  './index.html',
  './styles.css?v=6.3',
  './html5-qrcode.min.js',
  './bundle_data.js?v=6.3',
  './app.js?v=6.3',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];
const OFFLINE_LOGO = './logo.png';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) => cache.add(url).catch(() => null))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Purgando caché obsoleta:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1. Fotos de productos: Cache-first para ahorrar datos móviles
  if (req.destination === 'image') {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        }).catch(() => caches.match(OFFLINE_LOGO));
      })
    );
    return;
  }

  // 2. CDNs externos (Tailwind, FontAwesome, Fuentes): Cache-first
  if (url.origin.includes('cdn.tailwindcss.com') ||
      url.origin.includes('cdnjs.cloudflare.com') ||
      url.origin.includes('fonts.googleapis.com') ||
      url.origin.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        }).catch(() => null);
      })
    );
    return;
  }

  // 3. Peticiones a Google Script o APIs: NO pasar por Service Worker (que vaya directo a la red)
  if (url.origin.includes('script.google.com') || url.origin.includes('google.com')) {
    return;
  }

  // 4. Archivos locales de la app (HTML, JS, CSS): Network-first con fallback a caché
  // Esto garantiza que tras cambios y recargas (F5 / CTRL+F5) siempre se obtenga la versión más reciente si hay red,
  // y si no hay red (offline total), cargue sin problemas desde la caché.
  event.respondWith(
    fetch(req).then((netRes) => {
      if (netRes && netRes.status === 200) {
        const copy = netRes.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return netRes;
    }).catch(() => {
      return caches.match(req, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return null;
      });
    })
  );
});
