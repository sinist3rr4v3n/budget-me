// ═══════════════════════════════════════════
//  Budget Me — Service Worker
//  Handles offline caching & background sync
// ═══════════════════════════════════════════

const CACHE_NAME = 'budgetme-v1';
const RUNTIME_CACHE = 'budgetme-runtime-v1';

// Files to cache immediately on install (app shell)
const PRECACHE_URLS = [
  './',
  './BudgetMe.html',
  // Google Fonts — cache the CSS; actual font files get cached at runtime
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap',
];

// ── INSTALL: pre-cache the app shell ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching app shell');
        // Add one by one so a single failure doesn't break the whole install
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(err => {
            console.warn('[SW] Failed to pre-cache:', url, err);
          }))
        );
      })
      .then(() => self.skipWaiting()) // Activate immediately
  );
});

// ── ACTIVATE: clean up old caches ─────────────────────────────
self.addEventListener('activate', event => {
  const validCaches = [CACHE_NAME, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys()
      .then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(name => !validCaches.includes(name))
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        )
      )
      .then(() => self.clients.claim()) // Take control of all open tabs
  );
});

// ── FETCH: cache-first for app shell, network-first for fonts ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and browser-extension requests
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') return;

  // ── Google Fonts: stale-while-revalidate ──
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // ── App HTML + same-origin assets: cache-first ──
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // ── Everything else: network-first with cache fallback ──
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// ═══════════════════════════════════════════
//  STRATEGIES
// ═══════════════════════════════════════════

/**
 * Cache-first: serve from cache, fall back to network, then cache the result.
 * Best for the app shell (HTML, icons) — guaranteed offline access.
 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline and not in cache — return a simple offline page
    return offlineFallback();
  }
}

/**
 * Network-first: try network, fall back to cache.
 * Good for dynamic content where freshness matters.
 */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback();
  }
}

/**
 * Stale-while-revalidate: serve cache immediately, update in background.
 * Perfect for fonts — fast load, stays fresh over time.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise;
}

/**
 * Minimal offline fallback page shown when nothing is cached.
 */
function offlineFallback() {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Budget Me — Offline</title>
  <style>
    body { background: #07070f; color: #ede8ff; font-family: system-ui, sans-serif;
           display: flex; align-items: center; justify-content: center;
           height: 100vh; margin: 0; flex-direction: column; gap: 16px; text-align: center; }
    .icon { font-size: 56px; }
    h1 { font-size: 22px; font-weight: 700; margin: 0; }
    p  { font-size: 14px; color: #7270a0; margin: 0; }
    button { margin-top: 8px; padding: 10px 24px; border-radius: 10px;
             background: linear-gradient(135deg,#7c5cfc,#9b6bff); color: #fff;
             border: none; font-size: 14px; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div class="icon">💰</div>
  <h1>You're offline</h1>
  <p>Budget Me couldn't load. Check your connection and try again.</p>
  <button onclick="location.reload()">Try Again</button>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
