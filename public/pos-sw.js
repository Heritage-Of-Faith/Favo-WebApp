// FAVO POS service worker — owner: Mine (task M14 / Phase 3)
// Scoped to /pos/ only. Registered with { scope: "/pos/" } from
// POSServiceWorkerRegister; a root-level script may always claim a deeper
// scope, so no Service-Worker-Allowed header is required.
//
// Purpose: let the POS shell boot and read its static assets with no WAN, so a
// barista can keep taking orders during an outage (writes go to the IndexedDB
// outbox in the app layer — see src/hooks/useOfflineOutbox.ts, NOT here).
//
// DEFENSIVE BY DESIGN — like the customer SW (public/sw.js), this must NEVER
// intercept payments, auth, sync, SSE, or any non-GET request:
//   - /pos navigations        → network-first, fall back to last-good shell
//   - /_next/static + assets   → cache-first (populate on first fetch)
//   - everything else          → passthrough (no interception)
//   - bypassed entirely: non-GET, cross-origin, /api/* (incl. sync + SSE)
//
// It never touches Nikao's customer SW (different scope, different cache name).

const VERSION = "favo-pos-v1";
const CACHE = `favo-pos-${VERSION}`;
const SHELL = "/pos";
const PRECACHE = [
  "/pos",
  "/offline.html",
  "/manifest.webmanifest",
  "/brand/logo-monogram.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic — if one URL 404s the whole install fails, so keep the
      // precache list to things we know are served. Tolerate individual misses.
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("favo-pos-") && k !== CACHE)
            .map((k) => caches.delete(k))
        )
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
  // Never intercept the API: order writes, sync, auth, and the SSE order
  // stream all live under /api and must hit the network (or fail loudly).
  if (url.pathname.startsWith("/api")) return;

  const isPosNavigation =
    request.mode === "navigate" && url.pathname.startsWith("/pos");

  // POS page navigations: network-first for fresh content; on failure serve
  // the last-good cached version of this page, then the cached /pos shell,
  // then the branded offline page.
  if (isPosNavigation) {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return resp;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) =>
              cached ||
              caches.match(SHELL).then((shell) => shell || caches.match("/offline.html"))
          )
        )
    );
    return;
  }

  // Static assets: cache-first, populate on first fetch. These are content-
  // hashed by Next, so a cache hit is always safe to serve.
  const isStatic =
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/images") ||
    url.pathname.startsWith("/icons") ||
    url.pathname.startsWith("/brand") ||
    url.pathname.startsWith("/fonts");

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

// ── Push notifications ────────────────────────────────────────────────────────
// Staff alerts (low-stock, order flags) arrive here because this SW is scoped
// to /pos/ and staff devices register under the POS scope.

self.addEventListener("push", (event) => {
  let data = { title: "FAVO Café", body: "You have a new alert.", data: { url: "/pos/queue" } };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch { /* malformed payload — use defaults */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: data.data,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/pos/queue";
  const parsed = new URL(url, self.location.origin);
  const safeUrl =
    parsed.origin === self.location.origin && parsed.pathname.startsWith("/pos")
      ? parsed.href
      : new URL("/pos/queue", self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const existing = windowClients.find((c) => c.url === safeUrl && "focus" in c);
        if (existing) return existing.focus();
        return self.clients.openWindow(safeUrl);
      })
  );
});
