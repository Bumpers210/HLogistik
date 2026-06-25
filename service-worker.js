// Bump CACHE_VERSION whenever static files change (keep in sync with "version" in manifest.webmanifest).
const CACHE_VERSION = "1.5.144";
const CACHE_NAME = `hlogistik-${CACHE_VERSION}`;

const APP_SHELL = [
  "/",
  "/index.html",
  "/tablet.html",
  "/artikel.html",
  "/lager.html",
  "/auswertungen.html",
  "/shared-ui.js",
  "/order-hint-rules.js",
  "/app.js",
  "/tablet.js",
  "/tablet-legacy.js",
  "/artikel.js",
  "/xlsx.full.min.js",
  "/lager.js",
  "/auswertungen.js",
  "/offline-store.js",
  "/styles.css",
  "/tablet.css",
  "/manifest.webmanifest",
  "/app-icon.svg",
  "/pdf.min.js",
  "/pdf.worker.min.js"
];

const NAVIGATION_FALLBACKS = new Set([
  "/",
  "/index.html",
  "/tablet.html",
  "/lager.html",
  "/artikel.html",
  "/auswertungen.html"
]);

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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/exports/")) return;

  if (request.mode === "navigate") {
    const fallbackPath = navigationFallbackPath(url.pathname);
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(fallbackPath, { ignoreSearch: true })
          .then((response) => response || caches.match("/index.html"))
      )
    );
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

function navigationFallbackPath(pathname) {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  return NAVIGATION_FALLBACKS.has(pathname) || NAVIGATION_FALLBACKS.has(normalized)
    ? normalized
    : "/index.html";
}
