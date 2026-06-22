import { APP_PAGE_PATHS } from "../../shared/app-pages.mjs";

export const PUBLIC_STATIC_FILES = new Set([
  ...APP_PAGE_PATHS,
  "/recover-order.html",
  "/app.js",
  "/shared-ui.js",
  "/artikel.js",
  "/xlsx.full.min.js",
  "/lager.js",
  "/auswertungen.js",
  "/tablet.js",
  "/tablet-legacy.js",
  "/styles.css",
  "/tablet.css",
  "/manifest.webmanifest",
  "/service-worker.js",
  "/app-icon.svg",
  "/offline-store.js",
  "/pdf.min.js",
  "/pdf.worker.min.js",
  "/kommissionier-app-screenshot.png",
  "/muster-kommissionierauftrag.pdf",
]);

const NO_STORE_STATIC_EXTENSIONS = new Set([".html", ".js", ".css", ".webmanifest"]);

export function isPublicStaticFile(requestPath) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  return PUBLIC_STATIC_FILES.has(normalizedPath);
}

export function staticCacheHeaders(requestPath) {
  const ext = fileExtension(requestPath);
  if (requestPath === "/service-worker.js" || NO_STORE_STATIC_EXTENSIONS.has(ext)) {
    return {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    };
  }
  return { "Cache-Control": "public, max-age=3600" };
}

function fileExtension(requestPath) {
  const text = String(requestPath || "");
  const dotIndex = text.lastIndexOf(".");
  return dotIndex >= 0 ? text.slice(dotIndex).toLowerCase() : "";
}

