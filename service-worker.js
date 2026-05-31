const CACHE_NAME = "hlogistik-offline-v11";
const APP_SHELL = [
  "/",
  "/index.html",
  "/tablet.html",
  "/artikel.html",
  "/lager.html",
  "/app.js",
  "/tablet.js",
  "/artikel.js",
  "/lager.js",
  "/styles.css",
  "/tablet.css",
  "/manifest.webmanifest",
  "/app-icon.svg",
  "/pdf.min.js",
  "/pdf.worker.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/exports/")) return;

  if (request.mode === "navigate") {
    if (url.pathname === "/tablet.html") {
      event.respondWith(fetch(request).catch(() => caches.match("/tablet.html")));
      return;
    }
    event.respondWith(fetch(request).catch(() => caches.match("/index.html")));
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
