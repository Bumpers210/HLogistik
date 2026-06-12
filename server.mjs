import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configure as configureDb, configureArticleDatabases, getArticleDb, getDb, initializeArticleDatabases, initializeDatabase } from "./server/db.mjs";
import {
  sendJson,
  sendText,
  sendCsv,
  sendFile,
  readBody,
  safeResolve,
  readInteger,
  normalizeWarehouse,
  normalizeSsiStorageBin,
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
  readArticleMovements,
  readTopArticles,
  readSlowArticles,
  readLocationUsage,
} from "./server/reports.mjs";
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
  "/auswertungen.html",
  "/tablet.html",
  "/app.js",
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

  // Auswertungen / Reports (read-only)
  if (pathname === "/api/storage/reports/article-movements" && request.method === "GET") {
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    sendJson(response, 200, { ok: true, ...readArticleMovements({ warehouse, from, to }) });
    return;
  }
  if (pathname === "/api/storage/reports/top-articles" && request.method === "GET") {
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const limit = readInteger(url.searchParams.get("limit") || 50);
    sendJson(response, 200, { ok: true, ...readTopArticles({ warehouse, from, to, limit }) });
    return;
  }
  if (pathname === "/api/storage/reports/slow-articles" && request.method === "GET") {
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    sendJson(response, 200, { ok: true, ...readSlowArticles({ warehouse, from, to }) });
    return;
  }
  if (pathname === "/api/storage/reports/location-usage" && request.method === "GET") {
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    sendJson(response, 200, { ok: true, ...readLocationUsage({ warehouse, from, to }) });
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
    sendJson(response, 200, { ok: true, ...(await importArticles(incoming, warehouse, { skipExisting: Boolean(body.skipExisting) })) });
    return;
  }

  // Articles — export CSV
  if (pathname === "/api/articles/export" && request.method === "GET") {
    const articles = await readArticles(warehouse);
    sendCsv(response, 200, `artikelstamm-${warehouse}.csv`, articlesToCsv(articles));
    return;
  }

  // Articles reset: delete article master, stock, movement and error-log data; keep orders.
  if (pathname === "/api/articles/reset" && request.method === "POST") {
    requireGroup(request, ["buero", "verwaltung"]);
    const body = await readBody(request, maxBodyBytes);
    requireArticleDeletePassword(body.password);
    sendJson(response, 200, { ok: true, ...resetArticleMasterData() });
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

  if (pathname === "/api/orders/next-storage-number" && request.method === "GET") {
    sendJson(response, 200, { ok: true, orderNumber: nextStorageOrderNumber() });
    return;
  }

  // Orders — create
  if (pathname === "/api/orders" && request.method === "POST") {
    const body = await readBody(request, maxBodyBytes);
    const order = normalizeOrder(body.order || body);
    assignStorageOrderBasics(order);
    if (!order.lines.length) {
      sendJson(response, 400, { ok: false, error: "Leere Auftraege ohne Positionen werden nicht gespeichert" });
      return;
    }
    const lineValidation = validateOrderLines(order);
    if (lineValidation) {
      sendJson(response, 400, { ok: false, error: lineValidation });
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

  const acceptOrderMatch = pathname.match(/^\/api\/orders\/([^/]+)\/accept$/);
  if (acceptOrderMatch && request.method === "POST") {
    requireGroup(request, ["tablet"]);
    const body = await readBody(request, maxBodyBytes);
    const order = findOrder(acceptOrderMatch[1]);
    if (!order) return sendJson(response, 404, { ok: false, error: "Auftrag nicht gefunden" });
    const userName = requestExplicitOrderUserName(body);
    if (!userName) return sendJson(response, 400, { ok: false, error: "Mitarbeiter fehlt" });
    const result = acceptTabletOrderGroup(order, userName);
    if (result.blocked) return sendAcceptedOrderBlock(response, result.blocked);
    sendJson(response, 200, {
      ok: true,
      order: result.order,
      acceptedOrders: result.acceptedOrders.map(orderSummary),
      acceptedCount: result.acceptedOrders.length,
      customerName: result.customerName || ""
    });
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
    assignStorageOrderBasics(order, existing);
    if (!order.lines.length) {
      sendJson(response, 400, { ok: false, error: "Leere Auftraege ohne Positionen werden nicht gespeichert" });
      return;
    }
    const lineValidation = validateOrderLines(order);
    if (lineValidation) {
      sendJson(response, 400, { ok: false, error: lineValidation });
      return;
    }
    preserveClosedOrderStatus(order, existing);
    preserveAcceptedOrderStatus(order, existing);
    if (existing.id && isTabletRequest(request)) {
      const tabletBlocked = tabletMutationBlocker(existing, requestOrderUserName(body, order));
      if (tabletBlocked) return sendAcceptedOrderBlock(response, tabletBlocked);
    }
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
    requireGroup(request, ["buero", "lager", "tablet", "verwaltung"]);
    const existing = findOrder(orderMatch[1]);
    if (!existing) return sendJson(response, 404, { ok: false, error: "Auftrag nicht gefunden" });
    if (existing.exportedAt) {
      return sendJson(response, 409, { ok: false, error: "Abgeschlossene Auftraege koennen nicht geloescht werden." });
    }
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
    const orderType = order.orderType || "picking";
    const stockWarehouse = orderType === "storage" ? "SSI" : pickingOrderWarehouse(order, warehouse);
    if (orderType === "storage") {
      assignStorageOrderBasics(order, savedOrder);
      normalizeStorageOrderBinsForExport(order);
    }
    preserveAcceptedOrderStatus(order, savedOrder || {});
    if (savedOrder?.id && isTabletRequest(request)) {
      const tabletBlocked = tabletMutationBlocker(savedOrder, requestOrderUserName(body, order));
      if (tabletBlocked) return sendAcceptedOrderBlock(response, tabletBlocked);
    }
    const lineValidation = validateOrderLines(order, { forExport: true });
    if (lineValidation) {
      sendJson(response, 400, { ok: false, error: lineValidation });
      return;
    }
    if (orderType === "storage") upsertOrder(order);
    const storageArticles = orderType === "storage" && !savedOrder?.exportedAt
      ? await ensureStorageOrderArticles(order, stockWarehouse)
      : { created: [], updated: [] };
    const result = await exportPdf(order, exportDir, tempDir, requestOrigin(request), defaultExportDir);
    const stockIssue = orderType === "picking" && !savedOrder?.exportedAt
      ? bookPickingOrderIssues(order, stockWarehouse)
      : { booked: 0, errors: [] };
    const stockReceipt = orderType === "storage" && !savedOrder?.exportedAt
      ? bookStorageOrderReceipts(order, stockWarehouse)
      : { booked: 0, movements: [], locations: [] };
    const stockIssueErrorLog = logPickingIssueErrors(order, stockIssue, result, stockWarehouse);
    const exportedAt = markOrderExported(order.id, result);
    sendJson(response, 200, { ok: true, exportedAt, stockWarehouse, stockIssue, stockReceipt, storageArticles, stockIssueErrorLog, ...result });
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

function validateOrderLines(order, { forExport = false } = {}) {
  const conflicts = duplicateHandlingUnitConflicts(order.lines);
  if (conflicts.length) {
    return `LE/HU muss einmalig sein: ${conflicts
      .slice(0, 3)
      .map((conflict) => `LE/HU ${conflict.value} mehrfach (${formatHandlingUnitPositions(conflict.positions)})`)
      .join("; ")}`;
  }

  if (forExport && (order.orderType || "picking") === "storage") {
    return validateStorageOrderForExport(order);
  }

  return "";
}

function validateStorageOrderForExport(order) {
  const lines = storageOrderLines(order);
  if (!lines.length) return "Einlagerung hat keine Positionen.";

  const errors = [];
  lines.forEach((line, index) => {
    const position = line.warehouseOrder || index + 1;
    const materialnummer = String(line.product || "").trim();
    const description = String(line.description || "").trim();
    const lagerplatz = String(line.fromBin || "").trim();
    const mengeStueck = readInteger(storageLineQuantity(line));

    if (!line.picked) errors.push(`Pos. ${position}: nicht erledigt`);
    if (!materialnummer) errors.push(`Pos. ${position}: Artikelnummer fehlt`);
    if (!description) errors.push(`Pos. ${position}: Artikelbezeichnung fehlt`);
    if (!lagerplatz) errors.push(`Pos. ${position}: Stellplatz fehlt`);
    if (!Number.isInteger(mengeStueck) || mengeStueck <= 0) errors.push(`Pos. ${position}: Menge fehlt oder ist ungueltig`);
  });

  if (!errors.length) return "";
  return `Einlagerung unvollstaendig: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? "; weitere Fehler vorhanden" : ""}`;
}

function storageOrderLines(order) {
  return (Array.isArray(order?.lines) ? order.lines : [])
    .filter((line) => line?.lineType !== "loading-slip" && !isEmptyManualStorageLine(line));
}

function isEmptyManualStorageLine(line) {
  if (line?.manual !== true) return false;
  return [
    line.product,
    line.description,
    line.targetQty,
    line.actualQty,
    line.fromHandlingUnit,
    line.fromBin,
    line.positionNote
  ].every((value) => !String(value ?? "").trim());
}

function storageLineQuantity(line) {
  const actual = String(line?.actualQty ?? "").trim();
  return actual ? line.actualQty : line?.targetQty;
}

function normalizeStorageOrderBinsForExport(order) {
  const errors = [];
  order.lines = (Array.isArray(order.lines) ? order.lines : []).map((line, index) => {
    if (line?.lineType === "loading-slip" || isEmptyManualStorageLine(line)) return line;
    const rawBin = String(line?.fromBin || "").trim();
    if (!rawBin) return line;
    const normalizedBin = normalizeSsiStorageBin(rawBin);
    const position = line.warehouseOrder || index + 1;
    if (!normalizedBin) {
      errors.push(`Pos. ${position}: Stellplatz "${rawBin}" ist nicht bekannt`);
      return { ...line, fromBin: rawBin.toUpperCase() };
    }
    return { ...line, fromBin: normalizedBin };
  });
  if (errors.length) {
    throw httpError(400, `Einlagerung unvollstaendig: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? "; weitere Fehler vorhanden" : ""}`);
  }
}

async function ensureStorageOrderArticles(order, warehouse = "SSI") {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  const articles = await readArticles(normalizedWarehouse);
  const byMaterial = new Map(articles.map((article, index) => [String(article.materialnummer || "").trim(), { article, index }]));
  const created = [];
  const updated = [];
  const now = new Date().toISOString();

  for (const line of storageOrderLines(order)) {
    const materialnummer = String(line.product || "").trim();
    if (!materialnummer) continue;
    const values = storageArticleValues(line);
    const existing = byMaterial.get(materialnummer);
    if (existing) {
      const nextArticle = mergeStorageArticle(existing.article, values, now);
      if (!articleChanged(existing.article, nextArticle)) continue;
      validateArticle(nextArticle);
      articles[existing.index] = nextArticle;
      byMaterial.set(materialnummer, { article: nextArticle, index: existing.index });
      updated.push(articleSummary(nextArticle));
      continue;
    }

    const article = normalizeArticle({
      id: createArticleId(),
      materialnummer,
      materialbezeichnung: values.materialbezeichnung,
      gebindeArt: values.gebindeArt,
      mengeProKarton: values.mengeProKarton,
      mengeProPalette: values.mengeProPalette,
      lagerplatz: values.lagerplatz,
      bemerkung: "Automatisch aus Einlagerung angelegt",
      aktiv: true,
      erstelltAm: now,
      geaendertAm: now
    });
    validateArticle(article);
    articles.push(article);
    byMaterial.set(materialnummer, { article, index: articles.length - 1 });
    created.push(articleSummary(article));
  }

  if (created.length || updated.length) await writeArticles(articles, normalizedWarehouse);
  return { created, updated };
}

function storageArticleValues(line) {
  const quantity = readInteger(storageLineQuantity(line));
  const text = `${line.palletInfo || ""} ${line.positionNote || ""}`.toUpperCase();
  const gebindeArt = /\bKAR\.?\b|\bKARTON/.test(text)
    ? "KRT"
    : /\bC\s*1\b/.test(text)
      ? "C1"
      : /\bC\s*2\b/.test(text)
        ? "C2"
        : "STK";
  return {
    materialbezeichnung: String(line.description || "").trim(),
    gebindeArt,
    mengeProKarton: gebindeArt === "KRT" ? quantity : 0,
    mengeProPalette: gebindeArt === "KRT" ? 0 : quantity,
    lagerplatz: String(line.fromBin || "").trim()
  };
}

function mergeStorageArticle(article, values, now) {
  const nextArticle = normalizeArticle({
    ...article,
    materialbezeichnung: article.materialbezeichnung || values.materialbezeichnung,
    gebindeArt: article.gebindeArt || values.gebindeArt,
    mengeProKarton: Number(article.mengeProKarton || 0) > 0 ? article.mengeProKarton : values.mengeProKarton,
    mengeProPalette: Number(article.mengeProPalette || 0) > 0 ? article.mengeProPalette : values.mengeProPalette,
    lagerplatz: article.lagerplatz || values.lagerplatz,
    aktiv: true,
    geaendertAm: now
  });
  return nextArticle;
}

function articleChanged(left, right) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function bookStorageOrderReceipts(order, warehouse = "SSI") {
  const orderNumber = order.orderNumber || order.id || "";
  const receipts = storageOrderLines(order).map((line, index) => ({
    materialnummer: String(line.product || "").trim(),
    lagerplatz: String(line.fromBin || "").trim(),
    leNummer: String(line.fromHandlingUnit || "").trim(),
    mengeStueck: readInteger(storageLineQuantity(line)),
    paletten: 1,
    referenz: `Einlagerung ${orderNumber}`.trim(),
    position: line.warehouseOrder || index + 1
  }));
  const result = bookStorageReceipts(receipts, warehouse);
  return {
    booked: result.movements.length,
    movements: result.movements,
    locations: result.locations
  };
}

function assignStorageOrderBasics(order, existing = {}) {
  if ((order.orderType || "picking") !== "storage") return;
  order.orderNumber = String(order.orderNumber || existing.orderNumber || nextStorageOrderNumber()).trim();
  order.customerName = "SSI";
  order.orderWarehouse = "SSI";
}

function nextStorageOrderNumber() {
  const numbers = readOrders()
    .filter((order) => (order.orderType || "picking") === "storage")
    .map((order) => Number(String(order.orderNumber || "").trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return String((numbers.length ? Math.max(...numbers) : 0) + 1);
}

function duplicateHandlingUnitConflicts(lines) {
  const byHandlingUnit = new Map();

  (Array.isArray(lines) ? lines : []).forEach((line, index) => {
    const rawValue = String(line?.fromHandlingUnit || "").trim();
    const key = normalizeHandlingUnitLookup(rawValue);
    if (!key) return;

    const entry = byHandlingUnit.get(key) || { value: rawValue, positions: [] };
    if (!entry.value && rawValue) entry.value = rawValue;
    entry.positions.push(index + 1);
    byHandlingUnit.set(key, entry);
  });

  return [...byHandlingUnit.values()].filter((entry) => entry.positions.length > 1);
}

function normalizeHandlingUnitLookup(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function formatHandlingUnitPositions(positions) {
  return positions.map((position) => `Pos. ${position}`).join(", ");
}

function findDuplicateOrder(order, excludeId = "") {
  const orderNumber = String(order.orderNumber || "").trim().toLowerCase();
  const checkOrderNumber = orderNumber && !isReusableOrderNumber(orderNumber);
  const orderType = String(order.orderType || "picking").trim().toLowerCase();
  if (orderType === "storage") return null;
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
  return String(orderNumber || "").trim().toLowerCase().startsWith("ssi");
}

function isOpenOrder(order) {
  return !order.exportedAt;
}

function isStaleClosedOrderWrite(incoming, existing) {
  if (!existing || !existing.id || isOpenOrder(existing)) return false;

  const reopensExported = Boolean(existing.exportedAt && !incoming.exportedAt);
  return reopensExported;
}

function preserveClosedOrderStatus(order, existing) {
  if (!existing || !existing.id) return;

  if (existing.exportedAt && !order.exportedAt) {
    order.exportedAt = existing.exportedAt;
    order.exportedPdfFile = existing.exportedPdfFile || order.exportedPdfFile;
    order.exportedPdfPath = existing.exportedPdfPath || order.exportedPdfPath;
  }
}

function preserveAcceptedOrderStatus(order, existing) {
  if (!existing || !existing.id || !existing.acceptedBy) return;
  order.acceptedBy = existing.acceptedBy;
  order.acceptedAt = existing.acceptedAt || order.acceptedAt;
}

function requestOrderUserName(body, order = {}) {
  return String(
    body.userName ||
    body.user ||
    body.employee ||
    order.lastEditedBy ||
    order.activeUser ||
    order.completedBy ||
    ""
  ).trim();
}

function requestExplicitOrderUserName(body) {
  return String(body.userName || body.user || body.employee || "").trim();
}

function acceptTabletOrderGroup(order, userName) {
  const targetBlocked = acceptTargetBlocker(order, userName);
  if (targetBlocked) return { blocked: targetBlocked };

  const acceptedGroup = tabletAcceptanceGroup(order, userName);
  const groupIds = new Set(acceptedGroup.map((entry) => entry.id));
  const blockingOrder = readOrders().find((entry) => (
    !entry.exportedAt &&
    sameUser(entry.acceptedBy, userName) &&
    !groupIds.has(entry.id)
  ));
  if (blockingOrder) {
    return {
      blocked: {
        status: 409,
        message: `Erst Auftrag ${orderLabel(blockingOrder)} abschliessen: PDF auf dem Server erzeugen.`,
        order: blockingOrder
      }
    };
  }

  const now = new Date().toISOString();
  const acceptedOrders = acceptedGroup.map((entry) => {
    applyOrderAcceptance(entry, userName, now);
    entry.updatedAt = now;
    upsertOrder(entry);
    return entry;
  });

  return {
    order: acceptedOrders.find((entry) => entry.id === order.id) || order,
    acceptedOrders,
    customerName: acceptanceCustomerName(order)
  };
}

function acceptTargetBlocker(order, userName) {
  const user = String(userName || "").trim();
  if (!user) {
    return { status: 400, message: "Mitarbeiter fehlt" };
  }
  if (order?.exportedAt) {
    return {
      status: 409,
      message: `Auftrag ${orderLabel(order)} ist bereits abgeschlossen.`,
      order
    };
  }

  const acceptedBy = String(order?.acceptedBy || "").trim();
  if (acceptedBy && !sameUser(acceptedBy, user)) {
    return {
      status: 409,
      message: `Auftrag ${orderLabel(order)} ist bereits von ${acceptedBy} uebernommen.`,
      order
    };
  }

  return null;
}

function tabletAcceptanceGroup(order, userName) {
  if (isSsiOrder(order)) return [order];

  const customerName = acceptanceCustomerName(order);
  if (!customerName) return [order];

  const byId = new Map([[order.id, order]]);
  readOrders()
    .filter((entry) => (
      entry.id &&
      !entry.exportedAt &&
      !isSsiOrder(entry) &&
      acceptanceCustomerName(entry) === customerName &&
      (!entry.acceptedBy || sameUser(entry.acceptedBy, userName))
    ))
    .forEach((entry) => byId.set(entry.id, entry));

  return [...byId.values()];
}

function tabletMutationBlocker(order, userName) {
  const user = String(userName || "").trim();
  if (!user) return { status: 400, message: "Mitarbeiter fehlt" };
  if (order?.exportedAt) return null;

  const acceptedBy = String(order?.acceptedBy || "").trim();
  if (!acceptedBy) {
    return {
      status: 409,
      message: `Auftrag ${orderLabel(order)} zuerst am Tablet uebernehmen.`,
      order
    };
  }
  if (!sameUser(acceptedBy, user)) {
    return {
      status: 409,
      message: `Auftrag ${orderLabel(order)} ist bereits von ${acceptedBy} uebernommen.`,
      order
    };
  }
  return null;
}

function applyOrderAcceptance(order, userName, timestamp = new Date().toISOString()) {
  const user = String(userName || "").trim();
  if (!user || order.exportedAt) return;
  order.acceptedBy = order.acceptedBy || user;
  order.acceptedAt = order.acceptedAt || timestamp;
  order.activeUser = user;
  order.activeUserAt = timestamp;
  order.lastEditedBy = user;
  order.createdBy = order.createdBy || user;
}

function sendAcceptedOrderBlock(response, blocked) {
  sendJson(response, blocked.status || 409, {
    ok: false,
    error: blocked.message,
    blockingOrder: blocked.order ? orderSummary(blocked.order) : null
  });
}

function sameUser(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function isTabletRequest(request) {
  return String(request.headers["x-user-group"] || "").trim().toLowerCase() === "tablet";
}

function isSsiOrder(order) {
  return String(order?.orderNumber || "").trim().toLowerCase().startsWith("ssi");
}

function acceptanceCustomerName(order) {
  return String(order?.customerName || "").trim();
}

function orderLabel(order) {
  return [order?.orderNumber, order?.customerName]
    .filter(Boolean)
    .join(" - ") || order?.id || "ohne Nummer";
}

function requestWarehouse(request, url) {
  return normalizeWarehouse(request.headers["x-warehouse"] || url.searchParams.get("warehouse") || url.searchParams.get("lager"));
}

function pickingOrderWarehouse(order, fallbackWarehouse = "SSI") {
  const value = String(order?.orderWarehouse || order?.pickingWarehouse || order?.detectedWarehouse || "").trim().toUpperCase();
  return value === "SSI" || value === "SI" ? normalizeWarehouse(value) : normalizeWarehouse(fallbackWarehouse);
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

function resetArticleMasterData() {
  const before = articleMasterCounts();
  const backupDir = backupArticleMasterData();

  for (const warehouse of ["SSI", "SI"]) {
    const db = getArticleDb(warehouse);
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM artikel").run();
      db.exec("COMMIT");
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM lagerbestand").run();
    db.prepare("DELETE FROM lagerbewegung").run();
    db.prepare("DELETE FROM bestandsbuchung_fehler").run();
    db.exec("COMMIT");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    backupDir,
    before,
    after: articleMasterCounts()
  };
}

function backupArticleMasterData() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const backupDir = path.join(dataDir, `artikel-reset-backup-${timestamp}`);
  mkdirSync(backupDir, { recursive: true });

  [
    "artikel-ssi.sqlite",
    "artikel-ssi.sqlite-wal",
    "artikel-ssi.sqlite-shm",
    "artikel-si.sqlite",
    "artikel-si.sqlite-wal",
    "artikel-si.sqlite-shm",
    "logistik.sqlite",
    "logistik.sqlite-wal",
    "logistik.sqlite-shm"
  ].forEach((fileName) => {
    const source = path.join(dataDir, fileName);
    if (existsSync(source)) copyFileSync(source, path.join(backupDir, fileName));
  });

  return backupDir;
}

function articleMasterCounts() {
  return {
    artikelSsi: countRows(getArticleDb("SSI"), "artikel"),
    artikelSi: countRows(getArticleDb("SI"), "artikel"),
    lagerbestand: countRows(getDb(), "lagerbestand"),
    lagerbewegung: countRows(getDb(), "lagerbewegung"),
    bestandsbuchungFehler: countRows(getDb(), "bestandsbuchung_fehler"),
    auftraege: countRows(getDb(), "auftraege")
  };
}

function countRows(db, tableName) {
  try {
    return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
  } catch {
    return 0;
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
