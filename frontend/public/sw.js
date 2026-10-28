/* Axtra service worker — minimal offline shell + installability.
   No caching of dynamic data; only the basic shell. */

const CACHE = "axtra-shell-v1";
const SHELL = ["/", "/chat", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api-proxy") || url.pathname.startsWith("/api")) return;

  // Static assets: cache-first. Navigations: network-first with offline fallback.
  if (url.pathname.startsWith("/_next/static")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          caches
            .match(request)
            .then((cached) => cached ?? caches.match("/chat") ?? caches.match("/"))
      )
    );
  }
});

/* Push notifications (Phase 4 placeholder).
self.addEventListener("push", (event) => {
  if (!event.data) return;
  event.waitUntil(
    self.registration.showNotification("Axtra", {
      body: event.data.text(),
      icon: "/icon.svg",
    })
  );
});
*/
