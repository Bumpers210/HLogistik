import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configure as configureDb, configureArticleDatabases, initializeArticleDatabases, initializeDatabase } from "./server/db.mjs";
import {
  sendJson,
  sendText,
  sendCsv,
  sendFile,
  readBody,
  safeResolve,
  readInteger,
  normalizeWarehouse,
  httpError,
  createId,
  createArticleId,
} from "./server/helpers.mjs";
import {
  readArticles,
  writeArticles,
  findArticle,
  importArticles,
  migrateMainArticlesToWarehouse,
  migrateLegacyArticles,
  searchArticles,
  findArticleByCode,
  normalizeArticle,
  validateArticle,
  deleteArticle,
  articleSummary,
  articlesToCsv,
  calculatePackaging,
} from "./server/articles.mjs";
import {
  readStorageLocations,
  readStorageMovements,
  bookStorageReceipt,
  bookStorageReceipts,
  bookStorageIssue,
  bookStorageIssues,
  bookPickingOrderIssues,
  logPickingIssueErrors,
  listPickingIssueErrorLog,
  deleteStorageForMaterial,
} from "./server/storage.mjs";
import {
  readOrders,
  findOrder,
  upsertOrder,
  deleteOrder,
  markOrderExported,
  migrateOrdersFromJson,
  normalizeOrder,
  orderSummary,
} from "./server/orders.mjs";
import { exportPdf } from "./server/export.mjs";

// ── Paths & config ────────────────────────────────────────────────────────────

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, "data");
const defaultExportDir = path.join(root, "Exporte");
const exportDir = readExportDir();
const tempDir = path.join(root, "tmp");
const legacyOrdersFile = path.join(dataDir, "orders.json");
const legacyArticlesFile = path.join(dataDir, "articles.json");
const databaseFile = path.join(dataDir, "logistik.sqlite");
const port = Number(globalThis.process?.env?.PORT || 4174);
const localHostname = readLocalHostname();
const maxBodyBytes = 2 * 1024 * 1024;
const articleDeletePassword = String(globalThis.process?.env?.ARTICLE_DELETE_PASSWORD || "HLogistik2026!");

const publicStaticFiles = new Set([
  "/",
  "/index.html",
  "/artikel.html",
  "/lager.html",
  "/tablet.html",
  "/app.js",
  "/artikel.js",
  "/xlsx.full.min.js",
  "/lager.js",
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

// ── Startup ───────────────────────────────────────────────────────────────────

await mkdir(dataDir, { recursive: true });
await mkdir(defaultExportDir, { recursive: true });
await mkdir(exportDir, { recursive: true });
await mkdir(tempDir, { recursive: true });

configureDb(databaseFile);
initializeDatabase();
configureArticleDatabases(dataDir);
initializeArticleDatabases();
await migrateMainArticlesToWarehouse("SSI");
await migrateLegacyArticles(legacyArticlesFile, "SSI");
await migrateOrdersFromJson(legacyOrdersFile);

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    console.error(error);
    const status = error.statusCode || 500;
    sendJson(response, status, {
      ok: false,
      error: status >= 500 ? "Serverfehler" : error.publicMessage || error.message || "Fehler",
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Kommissionier-App laeuft auf http://localhost:${port}/`);
  if (localHostname) console.log(`Lokaler Name: http://${localHostname}:${port}/`);
  for (const address of localAddresses()) {
    console.log(`Im Netzwerk: http://${address}:${port}/`);
  }
});

// ── Routing ───────────────────────────────────────────────────────────────────

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const warehouse = requestWarehouse(request, url);
  enforceSameOriginMutation(request);

  // Health
  if (pathname === "/api/health") {
    sendJson(response, 200, { ok: true, host: hostname(), localHostname: localHostname || null, port, exportDir, warehouse, warehouses: ["SSI", "SI"], localAddresses: localAddresses() });
    return;
  }

  // Storage locations
  if (pathname === "/api/storage/locations" && request.method === "GET") {
    const query = url.searchParams.get("q") || "";
    const materialnummer = url.searchParams.get("materialnummer") || "";
    sendJson(response, 200, readStorageLocations({ query, materialnummer, warehouse }));
    return;
  }

  // Storage movements
  if (pathname === "/api/storage/movements" && request.method === "GET") {
    const query = url.searchParams.get("q") || "";
    const limit = readInteger(url.searchParams.get("limit") || 100);
    sendJson(response, 200, readStorageMovements({ query, limit, warehouse }));
    return;
  }

  // Stock issue error log
  if (pathname === "/api/storage/issue-errors" && request.method === "GET") {
    const limit = readInteger(url.searchParams.get("limit") || 200);
    const orderId = url.searchParams.get("orderId") || "";
    const orderNumber = url.searchParams.get("orderNumber") || "";
    sendJson(response, 200, listPickingIssueErrorLog({ warehouse, limit, orderId, orderNumber }));
    return;
  }

  // Storage receipts
  if (pathname === "/api/storage/receipts" && request.method === "POST") {
    requireGroup(request, ["buero", "tablet", "verwaltung"]);
    const body = await readBody(request, maxBodyBytes);
    if (Array.isArray(body.receipts)) {
      sendJson(response, 200, { ok: true, ...bookStorageReceipts(body.receipts, warehouse) });
      return;
    }
    sendJson(response, 200, { ok: true, ...bookStorageReceipt(body.receipt || body, warehouse) });
    return;
  }

  // Storage issues
  if (pathname === "/api/storage/issues" && request.method === "POST") {
    requireGroup(request, ["buero", "tablet", "verwaltung"]);
    const body = await readBody(request, maxBodyBytes);
    if (Array.isArray(body.issues)) {
      sendJson(response, 200, { ok: true, ...bookStorageIssues(body.issues, warehouse) });
      return;
    }
    sendJson(response, 200, { ok: true, ...bookStorageIssue(body.issue || body, warehouse) });
    return;
  }

  // Articles — list
  if (pathname === "/api/articles" && request.method === "GET") {
    const articles = await readArticles(warehouse);
    const query = url.searchParams.get("q") || "";
    const includeInactive = url.searchParams.get("includeInactive") === "1";
    sendJson(response, 200, searchArticles(articles, query, includeInactive).map(articleSummary));
    return;
  }

  // Articles — create
  if (pathname === "/api/articles" && request.method === "POST") {
    requireGroup(request, ["buero", "verwaltung"]);
    const body = await readBody(request, maxBodyBytes);
    const articles = await readArticles(warehouse);
    const article = normalizeArticle(body.article || body);
    validateArticle(article);
    article.id = article.id || createArticleId();
    article.erstelltAm = article.erstelltAm || new Date().toISOString();
    article.geaendertAm = new Date().toISOString();
    if (articles.some((entry) => entry.materialnummer === article.materialnummer)) {
      sendJson(response, 409, { ok: false, error: "Materialnummer ist bereits vorhanden" });
      return;
    }
    articles.push(article);
    await writeArticles(articles, warehouse);
    sendJson(response, 200, { ok: true, article });
    return;
  }

  // Articles — import
  if (pathname === "/api/articles/import" && request.method === "POST") {
    requireGroup(request, ["buero", "verwaltung"]);
    const body = await readBody(request, maxBodyBytes);
    const incoming = Array.isArray(body.articles) ? body.articles : [];
    sendJson(response, 200, { ok: true, ...(await importArticles(incoming, warehouse)) });
    return;
  }

  // Articles — export CSV
  if (pathname === "/api/articles/export" && request.method === "GET") {
    const articles = await readArticles(warehouse);
    sendCsv(response, 200, `artikelstamm-${warehouse}.csv`, articlesToCsv(articles));
    return;
  }

  // Articles — lookup by code
  const articleLookupMatch = pathname.match(/^\/api\/articles\/lookup\/([^/]+)$/);
  if (articleLookupMatch && request.method === "GET") {
    const article = findArticleByCode(await readArticles(warehouse), articleLookupMatch[1]);
    if (!article) return sendJson(response, 404, { ok: false, error: "Artikel nicht gefunden" });
    sendJson(response, 200, article);
    return;
  }

  // Articles — calculate packaging
  if (pathname === "/api/articles/calculate-package" && request.method === "POST") {
    const body = await readBody(request, maxBodyBytes);
    const article = findArticleByCode(await readArticles(warehouse), body.materialnummer || body.barcode || body.code);
    if (!article) return sendJson(response, 404, { ok: false, error: "Artikel nicht gefunden" });
    sendJson(response, 200, {
      ok: true,
      article: articleSummary(article),
      packaging: calculatePackaging(article, body.menge_stueck ?? body.mengeStueck ?? body.quantity),
    });
    return;
  }

  // Articles — single get / update / delete
  const articleMatch = pathname.match(/^\/api\/articles\/([^/]+)$/);
  if (articleMatch && request.method === "GET") {
    const article = await findArticle(articleMatch[1], warehouse);
    if (!article) return sendJson(response, 404, { ok: false, error: "Artikel nicht gefunden" });
    sendJson(response, 200, article);
    return;
  }

  if (articleMatch && request.method === "PUT") {
    requireGroup(request, ["buero", "verwaltung"]);
    const body = await readBody(request, maxBodyBytes);
    const articles = await readArticles(warehouse);
    const index = articles.findIndex((a) => a.id === articleMatch[1]);
    if (index < 0) return sendJson(response, 404, { ok: false, error: "Artikel nicht gefunden" });
    const article = normalizeArticle({ ...articles[index], ...(body.article || body), id: articleMatch[1] });
    validateArticle(article);
    if (articles.some((entry) => entry.id !== article.id && entry.materialnummer === article.materialnummer)) {
      sendJson(response, 409, { ok: false, error: "Materialnummer ist bereits vorhanden" });
      return;
    }
    article.erstelltAm = articles[index].erstelltAm || article.erstelltAm || new Date().toISOString();
    article.geaendertAm = new Date().toISOString();
    articles[index] = article;
    await writeArticles(articles, warehouse);
    sendJson(response, 200, { ok: true, article });
    return;
  }

  const articlePermanentDeleteMatch = pathname.match(/^\/api\/articles\/([^/]+)\/permanent$/);
  if (articlePermanentDeleteMatch && request.method === "DELETE") {
    requireGroup(request, ["buero", "verwaltung"]);
    const body = await readBody(request, maxBodyBytes);
    requireArticleDeletePassword(body.password);
    const article = await findArticle(articlePermanentDeleteMatch[1], warehouse);
    if (!article) return sendJson(response, 404, { ok: false, error: "Artikel nicht gefunden" });

    const storageDeleted = deleteStorageForMaterial(article.materialnummer, warehouse);
    const deletedArticle = await deleteArticle(article.id, warehouse);
    sendJson(response, 200, { ok: true, article: deletedArticle, ...storageDeleted });
    return;
  }

  if (articleMatch && request.method === "DELETE") {
    requireGroup(request, ["buero", "verwaltung"]);
    const articles = await readArticles(warehouse);
    const index = articles.findIndex((a) => a.id === articleMatch[1]);
    if (index < 0) return sendJson(response, 404, { ok: false, error: "Artikel nicht gefunden" });
    articles[index] = normalizeArticle({ ...articles[index], aktiv: false, geaendertAm: new Date().toISOString() });
    await writeArticles(articles, warehouse);
    sendJson(response, 200, { ok: true, article: articles[index] });
    return;
  }

  // Orders — list
  if (pathname === "/api/orders" && request.method === "GET") {
    const includeExported = url.searchParams.get("includeExported") === "1";
    const orders = readOrders()
      .filter((order) => includeExported || isOpenOrder(order))
      .map(orderSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    sendJson(response, 200, orders);
    return;
  }

  // Orders â€” duplicate check
  if (pathname === "/api/orders/duplicate-check" && request.method === "GET") {
    const probe = normalizeOrder({
      orderNumber: url.searchParams.get("orderNumber") || "",
      orderType: url.searchParams.get("orderType") || "picking",
      rawText: url.searchParams.get("fingerprint") || "",
    });
    const duplicate = findDuplicateOrder(probe);
    sendJson(response, 200, { ok: true, duplicate: Boolean(duplicate), order: duplicate ? orderSummary(duplicate) : null });
    return;
  }

  // Orders — create
  if (pathname === "/api/orders" && request.method === "POST") {
    const body = await readBody(request, maxBodyBytes);
    const order = normalizeOrder(body.order || body);
    if (!order.lines.length) {
      sendJson(response, 400, { ok: false, error: "Leere Auftraege ohne Positionen werden nicht gespeichert" });
      return;
    }
    const duplicate = findDuplicateOrder(order);
    if (duplicate) {
      sendJson(response, 409, { ok: false, error: `Auftrag ${duplicate.orderNumber || duplicate.id} wurde bereits eingelesen` });
      return;
    }
    order.id = order.id || createId();
    order.createdAt = order.createdAt || new Date().toISOString();
    order.updatedAt = new Date().toISOString();
    upsertOrder(order);
    sendJson(response, 200, { ok: true, order: orderSummary(order) });
    return;
  }

  // Orders — single get / update / delete
  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && request.method === "GET") {
    const order = findOrder(orderMatch[1]);
    if (!order) return sendJson(response, 404, { ok: false, error: "Auftrag nicht gefunden" });
    sendJson(response, 200, order);
    return;
  }

  if (orderMatch && request.method === "PUT") {
    const body = await readBody(request, maxBodyBytes);
    const existing = findOrder(orderMatch[1]) || {};
    const incoming = normalizeOrder({ ...(body.order || body), id: orderMatch[1] });
    if (isStaleClosedOrderWrite(incoming, existing)) {
      sendJson(response, 200, { ok: true, ignored: true, order: orderSummary(existing) });
      return;
    }
    const order = normalizeOrder({ ...existing, ...(body.order || body), id: orderMatch[1] });
    if (!order.lines.length) {
      sendJson(response, 400, { ok: false, error: "Leere Auftraege ohne Positionen werden nicht gespeichert" });
      return;
    }
    preserveClosedOrderStatus(order, existing);
    const duplicate = findDuplicateOrder(order, orderMatch[1]);
    if (duplicate) {
      sendJson(response, 409, { ok: false, error: `Auftrag ${duplicate.orderNumber || duplicate.id} wurde bereits eingelesen` });
      return;
    }
    order.createdAt = existing.createdAt || order.createdAt || new Date().toISOString();
    order.updatedAt = new Date().toISOString();
    upsertOrder(order);
    sendJson(response, 200, { ok: true, order: orderSummary(order) });
    return;
  }

  if (orderMatch && request.method === "DELETE") {
    requireGroup(request, ["buero", "verwaltung"]);
    const deleted = deleteOrder(orderMatch[1]);
    if (!deleted) return sendJson(response, 404, { ok: false, error: "Auftrag nicht gefunden" });
    sendJson(response, 200, { ok: true });
    return;
  }

  // Orders — export PDF
  const exportMatch = pathname.match(/^\/api\/orders\/([^/]+)\/export-pdf$/);
  if (exportMatch && request.method === "POST") {
    const body = await readBody(request, maxBodyBytes);
    const savedOrder = findOrder(exportMatch[1]);
    const order = normalizeOrder({ ...(savedOrder || {}), ...(body.order || {}) });
    order.id = exportMatch[1];
    const result = await exportPdf(order, exportDir, tempDir, requestOrigin(request), defaultExportDir);
    const stockIssue = (order.orderType || "picking") === "picking" && !savedOrder?.exportedAt
      ? bookPickingOrderIssues(order, warehouse)
      : { booked: 0, errors: [] };
    const stockIssueErrorLog = logPickingIssueErrors(order, stockIssue, result, warehouse);
    const exportedAt = markOrderExported(order.id, result);
    sendJson(response, 200, { ok: true, exportedAt, stockIssue, stockIssueErrorLog, ...result });
    return;
  }

  // Exported files
  if (pathname.startsWith("/exports/")) {
    await sendExportFile(response, pathname);
    return;
  }

  // Static files
  await sendStatic(response, pathname === "/" ? "/index.html" : pathname);
}

// ── Static file serving ───────────────────────────────────────────────────────

async function sendStatic(response, requestPath) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  if (!publicStaticFiles.has(normalizedPath)) {
    sendText(response, 404, "Not found");
    return;
  }
  const filePath = safeResolve(root, normalizedPath);
  if (!filePath) return sendText(response, 403, "Forbidden");
  await sendFile(response, filePath);
}

async function sendExportFile(response, requestPath) {
  const relativeName = requestPath.replace(/^\/exports\//, "");
  if (!/^[^/\\]+\.pdf$/i.test(relativeName)) {
    sendText(response, 404, "Not found");
    return;
  }
  const filePath = safeResolve(exportDir, `/${relativeName}`);
  if (!filePath) return sendText(response, 403, "Forbidden");
  await sendFile(response, filePath);
}

// ── Security helpers ──────────────────────────────────────────────────────────

function findDuplicateOrder(order, excludeId = "") {
  const orderNumber = String(order.orderNumber || "").trim().toLowerCase();
  const checkOrderNumber = orderNumber && !isReusableOrderNumber(orderNumber);
  const orderType = String(order.orderType || "picking").trim().toLowerCase();
  const fingerprint = orderFingerprint(order.rawText);
  if (!checkOrderNumber && !fingerprint) return null;

  return readOrders().find((entry) => {
    if (excludeId && entry.id === excludeId) return false;
    if (String(entry.orderType || "picking").trim().toLowerCase() !== orderType) return false;

    const entryOrderNumber = String(entry.orderNumber || "").trim().toLowerCase();
    if (checkOrderNumber && entryOrderNumber && entryOrderNumber === orderNumber) return true;

    const entryFingerprint = orderFingerprint(entry.rawText);
    return Boolean(fingerprint && entryFingerprint && entryFingerprint === fingerprint);
  }) || null;
}

function isReusableOrderNumber(orderNumber) {
  return String(orderNumber || "").trim().toLowerCase() === "ssi";
}

function isOpenOrder(order) {
  return !order.exportedAt && !order.completedAt;
}

function isStaleClosedOrderWrite(incoming, existing) {
  if (!existing || !existing.id || isOpenOrder(existing)) return false;

  const reopensCompleted = Boolean(existing.completedAt && !incoming.completedAt);
  const reopensExported = Boolean(existing.exportedAt && !incoming.exportedAt);
  return reopensCompleted || reopensExported;
}

function preserveClosedOrderStatus(order, existing) {
  if (!existing || !existing.id) return;

  if (existing.completedAt && !order.completedAt) {
    order.completedAt = existing.completedAt;
    order.completedBy = existing.completedBy || order.completedBy;
  }

  if (existing.exportedAt && !order.exportedAt) {
    order.exportedAt = existing.exportedAt;
    order.exportedPdfFile = existing.exportedPdfFile || order.exportedPdfFile;
    order.exportedPdfPath = existing.exportedPdfPath || order.exportedPdfPath;
  }
}

function requestWarehouse(request, url) {
  return normalizeWarehouse(request.headers["x-warehouse"] || url.searchParams.get("warehouse") || url.searchParams.get("lager"));
}

function orderFingerprint(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .slice(0, 2000);
}

function enforceSameOriginMutation(request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers.host || `localhost:${port}`;
  try {
    const originUrl = new URL(origin);
    if (originUrl.host === host) return;
  } catch {
    // Fall through to forbidden.
  }
  throw httpError(403, "Ungültiger Ursprung der Anfrage");
}

// Validates the X-User-Group header sent by the browser client for sensitive endpoints.
// This is a defense-in-depth measure for the LAN environment — it prevents accidental
// access from the wrong role but is not a substitute for a full authentication system.
function requireGroup(request, allowedGroups) {
  const group = String(request.headers["x-user-group"] || "").trim().toLowerCase();
  if (!allowedGroups.includes(group)) {
    throw httpError(403, "Keine Berechtigung für diese Aktion");
  }
}

function requireArticleDeletePassword(password) {
  if (String(password || "") !== articleDeletePassword) {
    throw httpError(403, "Passwort ist falsch");
  }
}

function requestOrigin(request) {
  const host = request.headers.host || `localhost:${port}`;
  const protocol = request.headers["x-forwarded-proto"] || "http";
  return `${protocol}://${host}`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function localAddresses() {
  function score(addr) {
    if (/^192\.168\./.test(addr)) return 0;
    if (/^10\./.test(addr)) return 1;
    return 2;
  }
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .sort((a, b) => score(a) - score(b));
}

function readLocalHostname() {
  const fromEnv = String(globalThis.process?.env?.LOCAL_HOSTNAME || "").trim();
  if (fromEnv) return sanitizeHostname(fromEnv);

  const configFile = path.join(root, "local-hostname.txt");
  if (!existsSync(configFile)) return "";

  const raw = readFileSync(configFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  return sanitizeHostname(raw || "");
}

function readExportDir() {
  const fromEnv = String(globalThis.process?.env?.HLOGISTIK_EXPORT_DIR || globalThis.process?.env?.EXPORT_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);

  const configFile = path.join(root, "export-path.txt");
  if (!existsSync(configFile)) return path.join(root, "Exporte");

  const raw = readFileSync(configFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  return raw ? path.resolve(raw) : path.join(root, "Exporte");
}

function sanitizeHostname(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "");
}
