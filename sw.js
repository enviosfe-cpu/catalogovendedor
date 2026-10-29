/**
 * Distribuciones Castro Preventa - Service Worker for 100% Offline App
 * Modo Offline Total: Shell + datos + CDNs + fotos vistas en caché local.
 * Carga instantánea sin esperas de red en cada apertura.
 */
const CACHE_NAME = 'castro-preventa-v3.0';
const ASSETS_TO_CACHE = [
  './index.html',
  './styles.css',
  './app.js',
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

  // Fotos de productos: cache-first
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

  // CDNs externos (Tailwind, FontAwesome, Fuentes): Cache-first
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

  // Navegación, scripts locales y estilos: Cache-first con actualización en background
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // En background actualizamos el asset si hay red sin demorar la app
        fetch(req).then((netRes) => {
          if (netRes && netRes.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, netRes));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((netRes) => {
        if (netRes && netRes.status === 200) {
          const copy = netRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return netRes;
      }).catch(() => {
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return caches.match(req, { ignoreSearch: true });
      });
    })
  );
});
