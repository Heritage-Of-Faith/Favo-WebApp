// FAVO service worker — owner: Nikao (task N5 / Phase 3)
// DEFENSIVE BY DESIGN. This is a payments + POS app on one origin, so the SW
// must NEVER intercept auth, payments, SSE, server actions, POS, or admin.
//
// Strategy:
//   - navigations  → network-first, fall back to cache, then /offline.html
//   - static assets → cache-first (images, icons, fonts, /_next/static)
//   - everything else → passthrough (no interception)
//   - bypassed entirely: non-GET, cross-origin, /api/*, /pos/*, /admin/*

const VERSION = "favo-v1";
const CACHE = `favo-static-${VERSION}`;
const PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/brand/logo-monogram.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Hard bypasses — let the network handle these untouched.
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/pos") ||
    url.pathname.startsWith("/admin")
  ) {
    return;
  }

  // Page navigations: always try network first (fresh content), fall back to
  // cache, then a branded offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/offline.html"))
      )
    );
    return;
  }

  // Static assets: cache-first, populate cache on first fetch.
  const isStatic =
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/images") ||
    url.pathname.startsWith("/icons") ||
    url.pathname.startsWith("/brand");

  if (isStatic) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((resp) => {
            if (resp.ok) {
              const copy = resp.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return resp;
          })
      )
    );
    return;
  }

  // Everything else: do not intercept.
});
