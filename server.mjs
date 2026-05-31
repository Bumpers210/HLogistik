import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, "data");
const exportDir = path.join(root, "Exporte");
const tempDir = path.join(root, "tmp");
const ordersFile = path.join(dataDir, "orders.json");
const legacyArticlesFile = path.join(dataDir, "articles.json");
const databaseFile = path.join(dataDir, "logistik.sqlite");
const port = Number(globalThis.process?.env?.PORT || 4174);
const maxBodyBytes = 2 * 1024 * 1024;
const publicStaticFiles = new Set([
  "/",
  "/index.html",
  "/artikel.html",
  "/lager.html",
  "/tablet.html",
  "/app.js",
  "/artikel.js",
  "/lager.js",
  "/tablet.js",
  "/styles.css",
  "/tablet.css",
  "/manifest.webmanifest",
  "/app-icon.svg",
  "/pdf.min.js",
  "/pdf.worker.min.js",
  "/kommissionier-app-screenshot.png",
  "/muster-kommissionierauftrag.pdf"
]);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".json", "application/json; charset=utf-8"]
]);

await mkdir(dataDir, { recursive: true });
await mkdir(exportDir, { recursive: true });
await mkdir(tempDir, { recursive: true });
if (!existsSync(ordersFile)) await writeJson(ordersFile, []);

const db = new DatabaseSync(databaseFile);
initializeDatabase();
await migrateLegacyArticles();

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    console.error(error);
    const status = error.statusCode || 500;
    sendJson(response, status, { ok: false, error: status >= 500 ? "Serverfehler" : error.publicMessage || error.message || "Fehler" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Kommissionier-App laeuft auf http://localhost:${port}/`);
  for (const address of localAddresses()) {
    console.log(`Im Netzwerk: http://${address}:${port}/`);
  }
});

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  enforceSameOriginMutation(request);

  if (pathname === "/api/health") {
    sendJson(response, 200, { ok: true, host: hostname(), exportDir });
    return;
  }

  if (pathname === "/api/storage/locations" && request.method === "GET") {
    const query = url.searchParams.get("q") || "";
    const materialnummer = url.searchParams.get("materialnummer") || "";
    sendJson(response, 200, readStorageLocations({ query, materialnummer }));
    return;
  }

  if (pathname === "/api/storage/movements" && request.method === "GET") {
    const query = url.searchParams.get("q") || "";
    const limit = readInteger(url.searchParams.get("limit") || 100);
    sendJson(response, 200, readStorageMovements({ query, limit }));
    return;
  }

  if (pathname === "/api/storage/receipts" && request.method === "POST") {
    const body = await readBody(request);
    if (Array.isArray(body.receipts)) {
      const result = bookStorageReceipts(body.receipts);
      sendJson(response, 200, { ok: true, ...result });
      return;
    }
    const result = bookStorageReceipt(body.receipt || body);
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (pathname === "/api/storage/issues" && request.method === "POST") {
    const body = await readBody(request);
    if (Array.isArray(body.issues)) {
      const result = bookStorageIssues(body.issues);
      sendJson(response, 200, { ok: true, ...result });
      return;
    }
    const result = bookStorageIssue(body.issue || body);
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (pathname === "/api/articles" && request.method === "GET") {
    const articles = await readArticles();
    const query = url.searchParams.get("q") || "";
    const includeInactive = url.searchParams.get("includeInactive") === "1";
    sendJson(response, 200, searchArticles(articles, query, includeInactive).map(articleSummary));
    return;
  }

  if (pathname === "/api/articles" && request.method === "POST") {
    const body = await readBody(request);
    const articles = await readArticles();
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
    await writeArticles(articles);
    sendJson(response, 200, { ok: true, article });
    return;
  }

  if (pathname === "/api/articles/import" && request.method === "POST") {
    const body = await readBody(request);
    const incoming = Array.isArray(body.articles) ? body.articles : [];
    const result = await importArticles(incoming);
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (pathname === "/api/articles/export" && request.method === "GET") {
    const articles = await readArticles();
    sendCsv(response, 200, "artikelstamm.csv", articlesToCsv(articles));
    return;
  }

  const articleLookupMatch = pathname.match(/^\/api\/articles\/lookup\/([^/]+)$/);
  if (articleLookupMatch && request.method === "GET") {
    const code = articleLookupMatch[1];
    const article = findArticleByCode(await readArticles(), code);
    if (!article) return sendJson(response, 404, { ok: false, error: "Artikel nicht gefunden" });
    sendJson(response, 200, article);
    return;
  }

  if (pathname === "/api/articles/calculate-package" && request.method === "POST") {
    const body = await readBody(request);
    const articles = await readArticles();
    const article = findArticleByCode(articles, body.materialnummer || body.barcode || body.code);
    if (!article) return sendJson(response, 404, { ok: false, error: "Artikel nicht gefunden" });
    sendJson(response, 200, { ok: true, article: articleSummary(article), packaging: calculatePackaging(article, body.menge_stueck ?? body.mengeStueck ?? body.quantity) });
    return;
  }

  const articleMatch = pathname.match(/^\/api\/articles\/([^/]+)$/);
  if (articleMatch && request.method === "GET") {
    const article = await findArticle(articleMatch[1]);
    if (!article) return sendJson(response, 404, { ok: false, error: "Artikel nicht gefunden" });
    sendJson(response, 200, article);
    return;
  }

  if (articleMatch && request.method === "PUT") {
    const body = await readBody(request);
    const articles = await readArticles();
    const index = articles.findIndex((article) => article.id === articleMatch[1]);
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
    await writeArticles(articles);
    sendJson(response, 200, { ok: true, article });
    return;
  }

  if (articleMatch && request.method === "DELETE") {
    const articles = await readArticles();
    const index = articles.findIndex((article) => article.id === articleMatch[1]);
    if (index < 0) return sendJson(response, 404, { ok: false, error: "Artikel nicht gefunden" });
    articles[index] = normalizeArticle({ ...articles[index], aktiv: false, geaendertAm: new Date().toISOString() });
    await writeArticles(articles);
    sendJson(response, 200, { ok: true, article: articles[index] });
    return;
  }

  if (pathname === "/api/orders" && request.method === "GET") {
    const orders = await readOrders();
    sendJson(response, 200, orders
      .filter((order) => !order.exportedAt)
      .map(orderSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    return;
  }

  if (pathname === "/api/orders" && request.method === "POST") {
    const body = await readBody(request);
    const orders = await readOrders();
    const order = normalizeOrder(body.order || body);
    order.id = order.id || createId();
    order.createdAt = order.createdAt || new Date().toISOString();
    order.updatedAt = new Date().toISOString();
    orders.push(order);
    await writeOrders(orders);
    sendJson(response, 200, { ok: true, order: orderSummary(order) });
    return;
  }

  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && request.method === "GET") {
    const order = await findOrder(orderMatch[1]);
    if (!order) return sendJson(response, 404, { ok: false, error: "Auftrag nicht gefunden" });
    sendJson(response, 200, order);
    return;
  }

  if (orderMatch && request.method === "PUT") {
    const body = await readBody(request);
    const orders = await readOrders();
    const index = orders.findIndex((order) => order.id === orderMatch[1]);
    const previous = index >= 0 ? orders[index] : {};
    const order = normalizeOrder({ ...previous, ...(body.order || body), id: orderMatch[1] });
    order.createdAt = previous.createdAt || order.createdAt || new Date().toISOString();
    order.updatedAt = new Date().toISOString();
    if (index >= 0) orders[index] = order;
    else orders.push(order);
    await writeOrders(orders);
    sendJson(response, 200, { ok: true, order: orderSummary(order) });
    return;
  }

  if (orderMatch && request.method === "DELETE") {
    const orders = await readOrders();
    const index = orders.findIndex((order) => order.id === orderMatch[1]);
    if (index < 0) {
      sendJson(response, 404, { ok: false, error: "Auftrag nicht gefunden" });
      return;
    }

    orders.splice(index, 1);
    await writeOrders(orders);
    sendJson(response, 200, { ok: true });
    return;
  }

  const exportMatch = pathname.match(/^\/api\/orders\/([^/]+)\/export-pdf$/);
  if (exportMatch && request.method === "POST") {
    const body = await readBody(request);
    const savedOrder = await findOrder(exportMatch[1]);
    const order = normalizeOrder({ ...(savedOrder || {}), ...(body.order || {}) });
    order.id = exportMatch[1];
    const result = await exportPdf(order, requestOrigin(request));
    const exportedAt = await markOrderExported(order.id, result);
    sendJson(response, 200, { ok: true, exportedAt, ...result });
    return;
  }

  if (pathname.startsWith("/exports/")) {
    await sendExportFile(response, pathname);
    return;
  }

  await sendStatic(response, pathname === "/" ? "/index.html" : pathname);
}

async function exportPdf(order, origin = "") {
  const fileBase = pdfFileBase(order);
  const htmlPath = path.join(tempDir, `${fileBase}.html`);
  const pdfPath = path.join(exportDir, `${fileBase}.pdf`);
  await writeFile(htmlPath, printableHtml(order, `${fileBase}.pdf`), "utf8");

  const browser = findBrowser();
  if (!browser) {
    throw new Error("Kein Edge/Chrome gefunden. Bitte Microsoft Edge oder Chrome installieren.");
  }

  await run(browser, [
    "--headless",
    "--disable-gpu",
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href
  ]);

  return {
    file: `${fileBase}.pdf`,
    path: pdfPath,
    url: absoluteUrl(origin, `/exports/${encodeURIComponent(`${fileBase}.pdf`)}`)
  };
}

function initializeDatabase() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS artikel (
      id TEXT PRIMARY KEY,
      materialnummer TEXT NOT NULL UNIQUE,
      materialbezeichnung TEXT NOT NULL,
      gebinde_art TEXT NOT NULL DEFAULT 'STK',
      menge_pro_karton INTEGER NOT NULL,
      menge_pro_palette INTEGER NOT NULL,
      barcode TEXT,
      lagerplatz TEXT,
      artikelgruppe TEXT,
      bemerkung TEXT,
      aktiv INTEGER NOT NULL DEFAULT 1,
      erstellt_am TEXT NOT NULL,
      geaendert_am TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artikel_suche
      ON artikel(materialnummer, materialbezeichnung, barcode);

    CREATE TABLE IF NOT EXISTS lagerbestand (
      id TEXT PRIMARY KEY,
      artikel_id TEXT NOT NULL,
      materialnummer TEXT NOT NULL,
      lagerplatz TEXT NOT NULL,
      le_nummer TEXT NOT NULL,
      menge_stueck INTEGER NOT NULL DEFAULT 0,
      aktualisiert_am TEXT NOT NULL,
      UNIQUE(materialnummer, lagerplatz, le_nummer)
    );
    CREATE INDEX IF NOT EXISTS idx_lagerbestand_artikel
      ON lagerbestand(materialnummer, lagerplatz, le_nummer);

    CREATE TABLE IF NOT EXISTS lagerbewegung (
      id TEXT PRIMARY KEY,
      artikel_id TEXT NOT NULL,
      materialnummer TEXT NOT NULL,
      bewegungsart TEXT NOT NULL,
      menge_stueck INTEGER NOT NULL,
      lagerplatz TEXT NOT NULL,
      le_nummer TEXT NOT NULL,
      referenz TEXT,
      erstellt_am TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lagerbewegung_artikel
      ON lagerbewegung(materialnummer, erstellt_am);
  `);
  if (ensureArticleColumn("gebinde_art", "TEXT NOT NULL DEFAULT 'STK'")) {
    db.prepare("UPDATE artikel SET gebinde_art = 'KRT' WHERE menge_pro_karton > 0").run();
  }
}

function ensureArticleColumn(name, definition) {
  const columns = db.prepare("PRAGMA table_info(artikel)").all().map((column) => column.name);
  if (columns.includes(name)) return false;
  db.exec(`ALTER TABLE artikel ADD COLUMN ${name} ${definition}`);
  return true;
}

async function migrateLegacyArticles() {
  if (!existsSync(legacyArticlesFile)) return;
  const count = db.prepare("SELECT COUNT(*) AS count FROM artikel").get().count;
  if (count > 0) return;

  try {
    const legacy = JSON.parse(await readFile(legacyArticlesFile, "utf8"));
    if (Array.isArray(legacy) && legacy.length) await importArticles(legacy);
  } catch {
    // A broken legacy import file should not block the server start.
  }
}

function requestOrigin(request) {
  const host = request.headers.host || `localhost:${port}`;
  const protocol = request.headers["x-forwarded-proto"] || "http";
  return `${protocol}://${host}`;
}

function absoluteUrl(origin, pathname) {
  try {
    return new URL(pathname, origin).href;
  } catch {
    return pathname;
  }
}

function printableHtml(order, fileName) {
  const picked = order.lines.filter((line) => line.picked).length;
  const changed = order.lines.filter((line) => String(line.actualQty || "").trim() !== String(line.targetQty || "").trim()).length;
  const rows = order.lines.map((line) => `
    <tr>
      <td>${escapeHtml(line.picked ? "ja" : "nein")}</td>
      <td>${escapeHtml(line.warehouseOrder)}</td>
      <td>${escapeHtml(line.fromHandlingUnit)}</td>
      <td>${escapeHtml(line.positionNote)}</td>
      <td>${escapeHtml(line.fromBin)}</td>
      <td>${escapeHtml(line.product)}</td>
      <td class="num">${escapeHtml(line.targetQty)}</td>
      <td class="num">${escapeHtml(line.actualQty)}</td>
      <td>${escapeHtml(line.unit)}</td>
      <td>${escapeHtml(line.description)}</td>
      <td>${escapeHtml(line.toBin)}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(fileName)}</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #111; font-family: Arial, Helvetica, sans-serif; font-size: 10px; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #111; }
      h1 { margin: 0 0 6px; font-size: 20px; }
      p { margin: 0 0 4px; }
      .meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 18px; margin-bottom: 10px; font-size: 11px; }
      .note { min-height: 28px; margin-bottom: 10px; padding: 6px; border: 1px solid #777; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { padding: 4px 3px; border: 1px solid #555; vertical-align: top; overflow-wrap: anywhere; }
      th { background: #e8eee9; text-align: left; font-size: 9px; }
      td { font-size: 9px; }
      .num { text-align: right; }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>Kommissionierabschluss</h1>
        <p><strong>Auftrag:</strong> ${escapeHtml(order.orderNumber || "-")}</p>
        <p><strong>Kunde:</strong> ${escapeHtml(order.customerName || "-")}</p>
        <p><strong>Bearbeiter:</strong> ${escapeHtml(order.lastEditedBy || "-")}</p>
      </div>
      <div>
        <p><strong>Datum:</strong> ${escapeHtml(formatDate(order.orderDate))}</p>
        <p><strong>Erledigt:</strong> ${picked}/${order.lines.length}</p>
        <p><strong>Abgeschlossen:</strong> ${escapeHtml(order.completedBy || "-")}</p>
        <p><strong>Dateiname:</strong> ${escapeHtml(fileName)}</p>
      </div>
    </header>
    <section class="meta">
      <p><strong>Europaletten:</strong> ${escapeHtml(order.euroPallets || "0")}</p>
      <p><strong>Stellplätze:</strong> ${escapeHtml(order.storageSpaces || "0")}</p>
      <p><strong>Korrigiert:</strong> ${changed}</p>
    </section>
    <section class="note"><strong>Notiz:</strong> ${escapeHtml(order.orderNote || "-")}</section>
    <table>
      <thead>
        <tr>
          <th style="width:4%;">OK</th>
          <th style="width:8%;">Lagerauftrag</th>
          <th style="width:11%;">Von-HU</th>
          <th style="width:13%;">Bemerkung</th>
          <th style="width:9%;">Lagerplatz</th>
          <th style="width:7%;">Produkt</th>
          <th style="width:5%;">Soll</th>
          <th style="width:5%;">Ist</th>
          <th style="width:4%;">Einh.</th>
          <th style="width:23%;">Beschreibung</th>
          <th style="width:11%;">Nach-Lagerplatz</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="11">Keine Positionen vorhanden.</td></tr>`}</tbody>
    </table>
  </body>
</html>`;
}

async function readOrders() {
  return JSON.parse(await readFile(ordersFile, "utf8"));
}

async function writeOrders(orders) {
  await writeJson(ordersFile, orders);
}

async function findOrder(id) {
  const orders = await readOrders();
  return orders.find((order) => order.id === id);
}

async function readArticles() {
  return db.prepare(`
    SELECT
      id,
      materialnummer,
      materialbezeichnung,
      gebinde_art,
      menge_pro_karton,
      menge_pro_palette,
      barcode,
      lagerplatz,
      artikelgruppe,
      bemerkung,
      aktiv,
      erstellt_am,
      geaendert_am
    FROM artikel
  `).all().map(articleFromRow);
}

async function writeArticles(articles) {
  const insert = db.prepare(`
    INSERT INTO artikel (
      id,
      materialnummer,
      materialbezeichnung,
      gebinde_art,
      menge_pro_karton,
      menge_pro_palette,
      barcode,
      lagerplatz,
      artikelgruppe,
      bemerkung,
      aktiv,
      erstellt_am,
      geaendert_am
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM artikel").run();
    sortArticles(articles).forEach((article) => {
      insert.run(
        article.id,
        article.materialnummer,
        article.materialbezeichnung,
        article.gebindeArt,
        article.mengeProKarton,
        article.mengeProPalette,
        article.barcode,
        article.lagerplatz,
        article.artikelgruppe,
        article.bemerkung,
        article.aktiv ? 1 : 0,
        article.erstelltAm,
        article.geaendertAm
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function findArticle(id) {
  const row = db.prepare(`
    SELECT
      id,
      materialnummer,
      materialbezeichnung,
      gebinde_art,
      menge_pro_karton,
      menge_pro_palette,
      barcode,
      lagerplatz,
      artikelgruppe,
      bemerkung,
      aktiv,
      erstellt_am,
      geaendert_am
    FROM artikel
    WHERE id = ?
  `).get(id);
  return row ? articleFromRow(row) : null;
}

function readStorageLocations({ query = "", materialnummer = "" } = {}) {
  const rows = db.prepare(`
    SELECT
      lagerbestand.id,
      lagerbestand.materialnummer,
      artikel.materialbezeichnung,
      lagerbestand.lagerplatz,
      lagerbestand.le_nummer,
      lagerbestand.menge_stueck,
      lagerbestand.aktualisiert_am
    FROM lagerbestand
    LEFT JOIN artikel ON artikel.id = lagerbestand.artikel_id
    WHERE lagerbestand.menge_stueck > 0
    ORDER BY lagerbestand.lagerplatz COLLATE NOCASE, lagerbestand.materialnummer COLLATE NOCASE, lagerbestand.le_nummer COLLATE NOCASE
  `).all().map(storageLocationFromRow);

  const materialFilter = String(materialnummer || "").trim().toLowerCase();
  const terms = normalizeSearch(query).split(" ").filter(Boolean);

  return rows.filter((row) => {
    if (materialFilter && row.materialnummer.toLowerCase() !== materialFilter) return false;
    if (!terms.length) return true;
    const haystack = normalizeSearch([row.materialnummer, row.materialbezeichnung, row.lagerplatz, row.leNummer].join(" "));
    return terms.every((term) => haystack.includes(term));
  });
}

function readStorageMovements({ query = "", limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number.isInteger(limit) && limit > 0 ? limit : 100, 1), 500);
  const rows = db.prepare(`
    SELECT
      lagerbewegung.id,
      lagerbewegung.materialnummer,
      artikel.materialbezeichnung,
      lagerbewegung.bewegungsart,
      lagerbewegung.menge_stueck,
      lagerbewegung.lagerplatz,
      lagerbewegung.le_nummer,
      lagerbewegung.referenz,
      lagerbewegung.erstellt_am
    FROM lagerbewegung
    LEFT JOIN artikel ON artikel.id = lagerbewegung.artikel_id
    ORDER BY lagerbewegung.erstellt_am DESC
    LIMIT ?
  `).all(safeLimit).map(storageMovementFromRow);

  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((row) => {
    const haystack = normalizeSearch([
      row.materialnummer,
      row.materialbezeichnung,
      row.bewegungsart,
      row.lagerplatz,
      row.leNummer,
      row.referenz
    ].join(" "));
    return terms.every((term) => haystack.includes(term));
  });
}

function bookStorageReceipt(receipt) {
  const result = bookStorageReceipts([receipt]);
  return {
    movement: result.movements[0],
    location: result.locations[0]
  };
}

function bookStorageReceipts(receipts) {
  if (!Array.isArray(receipts) || !receipts.length) throw httpError(400, "Mindestens eine Buchungszeile ist erforderlich");

  const articles = readArticlesSync();
  const results = [];

  db.exec("BEGIN");
  try {
    receipts.forEach((receipt, index) => {
      try {
        const normalized = normalizeStorageReceipt(receipt);
        const article = findArticleByCode(articles, normalized.materialnummer);
        if (!article) throw httpError(400, "Artikelnummer ist nicht im Artikelstamm vorhanden");
        results.push(applyStorageReceipt(normalized, article, new Date().toISOString()));
      } catch (error) {
        throw withLineContext(error, index);
      }
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    movements: results.map((result) => result.movement),
    locations: results.map((result) => result.location)
  };
}

function applyStorageReceipt(normalized, article, now) {
  const existing = db.prepare(`
    SELECT id, menge_stueck
    FROM lagerbestand
    WHERE materialnummer = ? AND lagerplatz = ? AND le_nummer = ?
  `).get(article.materialnummer, normalized.lagerplatz, normalized.leNummer);

  const bestandId = existing?.id || createStorageId();
  const bewegungId = createStorageMovementId();

  if (existing) {
    db.prepare(`
      UPDATE lagerbestand
      SET menge_stueck = menge_stueck + ?, aktualisiert_am = ?
      WHERE id = ?
    `).run(normalized.mengeStueck, now, existing.id);
  } else {
    db.prepare(`
      INSERT INTO lagerbestand (
        id,
        artikel_id,
        materialnummer,
        lagerplatz,
        le_nummer,
        menge_stueck,
        aktualisiert_am
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(bestandId, article.id, article.materialnummer, normalized.lagerplatz, normalized.leNummer, normalized.mengeStueck, now);
  }

  db.prepare(`
    INSERT INTO lagerbewegung (
      id,
      artikel_id,
      materialnummer,
      bewegungsart,
      menge_stueck,
      lagerplatz,
      le_nummer,
      referenz,
      erstellt_am
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(bewegungId, article.id, article.materialnummer, "Wareneingang", normalized.mengeStueck, normalized.lagerplatz, normalized.leNummer, normalized.referenz, now);

  const location = db.prepare(`
    SELECT
      lagerbestand.id,
      lagerbestand.materialnummer,
      artikel.materialbezeichnung,
      lagerbestand.lagerplatz,
      lagerbestand.le_nummer,
      lagerbestand.menge_stueck,
      lagerbestand.aktualisiert_am
    FROM lagerbestand
    LEFT JOIN artikel ON artikel.id = lagerbestand.artikel_id
    WHERE lagerbestand.id = ?
  `).get(bestandId);

  return {
    movement: {
      id: bewegungId,
      bewegungsart: "Wareneingang",
      materialnummer: article.materialnummer,
      mengeStueck: normalized.mengeStueck,
      lagerplatz: normalized.lagerplatz,
      leNummer: normalized.leNummer,
      referenz: normalized.referenz,
      erstelltAm: now
    },
    location: storageLocationFromRow(location)
  };
}

function bookStorageIssue(issue) {
  const result = bookStorageIssues([issue]);
  return {
    movement: result.movements[0],
    location: result.locations[0]
  };
}

function bookStorageIssues(issues) {
  if (!Array.isArray(issues) || !issues.length) throw httpError(400, "Mindestens eine Buchungszeile ist erforderlich");

  const articles = readArticlesSync();
  const results = [];

  db.exec("BEGIN");
  try {
    issues.forEach((issue, index) => {
      try {
        const normalized = normalizeStorageIssue(issue);
        const article = findArticleByCode(articles, normalized.materialnummer);
        if (!article) throw httpError(400, "Artikelnummer oder Barcode ist nicht im Artikelstamm vorhanden");
        results.push(applyStorageIssue(normalized, article, new Date().toISOString()));
      } catch (error) {
        throw withLineContext(error, index);
      }
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    movements: results.map((result) => result.movement),
    locations: results.map((result) => result.location)
  };
}

function applyStorageIssue(normalized, article, now) {
  const existing = db.prepare(`
    SELECT id, menge_stueck
    FROM lagerbestand
    WHERE materialnummer = ? AND lagerplatz = ? AND le_nummer = ?
  `).get(article.materialnummer, normalized.lagerplatz, normalized.leNummer);

  if (!existing) throw httpError(400, "Kein Bestand für diese Kombination aus Artikel, Lagerplatz und LE/HU vorhanden");
  if (Number(existing.menge_stueck) < normalized.mengeStueck) {
    throw httpError(400, `Nicht genug Bestand vorhanden. Bestand: ${existing.menge_stueck} Stück`);
  }

  const bewegungId = createStorageMovementId();
  const restbestand = Number(existing.menge_stueck) - normalized.mengeStueck;

  db.prepare(`
    UPDATE lagerbestand
    SET menge_stueck = ?, aktualisiert_am = ?
    WHERE id = ?
  `).run(restbestand, now, existing.id);

  db.prepare(`
    INSERT INTO lagerbewegung (
      id,
      artikel_id,
      materialnummer,
      bewegungsart,
      menge_stueck,
      lagerplatz,
      le_nummer,
      referenz,
      erstellt_am
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(bewegungId, article.id, article.materialnummer, "Warenausgang", normalized.mengeStueck, normalized.lagerplatz, normalized.leNummer, normalized.referenz, now);

  const location = db.prepare(`
    SELECT
      lagerbestand.id,
      lagerbestand.materialnummer,
      artikel.materialbezeichnung,
      lagerbestand.lagerplatz,
      lagerbestand.le_nummer,
      lagerbestand.menge_stueck,
      lagerbestand.aktualisiert_am
    FROM lagerbestand
    LEFT JOIN artikel ON artikel.id = lagerbestand.artikel_id
    WHERE lagerbestand.id = ?
  `).get(existing.id);

  return {
    movement: {
      id: bewegungId,
      bewegungsart: "Warenausgang",
      materialnummer: article.materialnummer,
      mengeStueck: normalized.mengeStueck,
      lagerplatz: normalized.lagerplatz,
      leNummer: normalized.leNummer,
      referenz: normalized.referenz,
      erstelltAm: now
    },
    location: storageLocationFromRow(location)
  };
}

function readArticlesSync() {
  return db.prepare(`
    SELECT
      id,
      materialnummer,
      materialbezeichnung,
      gebinde_art,
      menge_pro_karton,
      menge_pro_palette,
      barcode,
      lagerplatz,
      artikelgruppe,
      bemerkung,
      aktiv,
      erstellt_am,
      geaendert_am
    FROM artikel
  `).all().map(articleFromRow);
}

async function importArticles(incoming) {
  const articles = await readArticles();
  const byMaterialnummer = new Map(articles.map((article, index) => [article.materialnummer, { article, index }]));
  let created = 0;
  let updated = 0;
  const errors = [];

  incoming.forEach((entry, index) => {
    try {
      const article = normalizeArticle(entry);
      validateArticle(article);
      const existing = byMaterialnummer.get(article.materialnummer);
      if (existing) {
        const merged = normalizeArticle({
          ...existing.article,
          ...article,
          id: existing.article.id,
          erstelltAm: existing.article.erstelltAm,
          geaendertAm: new Date().toISOString()
        });
        articles[existing.index] = merged;
        byMaterialnummer.set(merged.materialnummer, { article: merged, index: existing.index });
        updated += 1;
        return;
      }

      article.id = createArticleId();
      article.erstelltAm = new Date().toISOString();
      article.geaendertAm = article.erstelltAm;
      articles.push(article);
      byMaterialnummer.set(article.materialnummer, { article, index: articles.length - 1 });
      created += 1;
    } catch (error) {
      errors.push({ row: index + 1, error: error.message || "Ungültiger Artikel" });
    }
  });

  if (created || updated) await writeArticles(sortArticles(articles));
  return { created, updated, errors };
}

async function markOrderExported(id, exportResult) {
  const orders = await readOrders();
  const index = orders.findIndex((order) => order.id === id);
  if (index === -1) return "";
  const exportedAt = new Date().toISOString();

  orders[index] = normalizeOrder({
    ...orders[index],
    exportedAt,
    exportedPdfFile: exportResult.file || "",
    exportedPdfPath: exportResult.path || "",
    updatedAt: new Date().toISOString()
  });
  await writeOrders(orders);
  return exportedAt;
}

function normalizeOrder(order) {
  return {
    id: order.id || "",
    orderNumber: String(order.orderNumber || ""),
    customerName: String(order.customerName || ""),
    orderDate: String(order.orderDate || new Date().toISOString().slice(0, 10)),
    euroPallets: String(order.euroPallets || ""),
    storageSpaces: String(order.storageSpaces || ""),
    orderNote: String(order.orderNote || ""),
    rawText: String(order.rawText || ""),
    collapseDone: Boolean(order.collapseDone),
    lines: Array.isArray(order.lines) ? order.lines : [],
    orderType: String(order.orderType || "picking"),
    exportedAt: String(order.exportedAt || ""),
    exportedPdfFile: String(order.exportedPdfFile || ""),
    exportedPdfPath: String(order.exportedPdfPath || ""),
    createdBy: String(order.createdBy || ""),
    lastEditedBy: String(order.lastEditedBy || ""),
    activeUser: String(order.activeUser || ""),
    activeUserAt: String(order.activeUserAt || ""),
    completedBy: String(order.completedBy || ""),
    completedAt: String(order.completedAt || ""),
    createdAt: order.createdAt || "",
    updatedAt: order.updatedAt || ""
  };
}

function orderSummary(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber || order.id,
    customerName: order.customerName || "",
    orderDate: order.orderDate || "",
    total: order.lines.length,
    picked: order.lines.filter((line) => line.picked).length,
    createdBy: order.createdBy || "",
    lastEditedBy: order.lastEditedBy || "",
    activeUser: order.activeUser || "",
    activeUserAt: order.activeUserAt || "",
    completedBy: order.completedBy || "",
    completedAt: order.completedAt || "",
    exportedAt: order.exportedAt || "",
    orderType: order.orderType || "picking",
    updatedAt: order.updatedAt || ""
  };
}

function normalizeArticle(article) {
  const gebindeArt = normalizeGebindeArt(article.gebindeArt ?? article.gebinde_art ?? article.Gebinde ?? article.Gebindeart);
  const mengeProKarton = readInteger(article.mengeProKarton ?? article.menge_pro_karton ?? article["Menge pro KRT"] ?? article["Menge pro Karton"]);
  const mengeProPalette = readInteger(article.mengeProPalette ?? article.menge_pro_palette ?? article["Menge pro Palette"]);

  return {
    id: String(article.id || ""),
    materialnummer: String(article.materialnummer ?? article.materialNumber ?? article.Materialnummer ?? "").trim(),
    materialbezeichnung: String(article.materialbezeichnung ?? article.materialDescription ?? article.Materialbezeichnung ?? "").trim(),
    gebindeArt,
    mengeProKarton: gebindeArt === "KRT" ? mengeProKarton : 0,
    mengeProPalette,
    barcode: String(article.barcode ?? article.Barcode ?? "").trim(),
    lagerplatz: String(article.lagerplatz ?? article.Lagerplatz ?? "").trim(),
    artikelgruppe: String(article.artikelgruppe ?? article.Artikelgruppe ?? "").trim(),
    bemerkung: String(article.bemerkung ?? article.Bemerkung ?? "").trim(),
    aktiv: readBoolean(article.aktiv ?? article.Aktiv, true),
    erstelltAm: String(article.erstelltAm ?? article.erstellt_am ?? article.createdAt ?? ""),
    geaendertAm: String(article.geaendertAm ?? article.geaendert_am ?? article.updatedAt ?? "")
  };
}

function validateArticle(article) {
  if (!article.materialnummer) throw new Error("Materialnummer fehlt");
  if (!article.materialbezeichnung) throw new Error("Materialbezeichnung fehlt");
  if (!["C1", "C2", "KRT", "STK"].includes(article.gebindeArt)) throw new Error("Gebindeart ist ungültig");
  if (article.gebindeArt === "KRT" && (!Number.isInteger(article.mengeProKarton) || article.mengeProKarton <= 0)) throw new Error("Menge pro KRT muss größer 0 sein");
  if (!Number.isInteger(article.mengeProPalette) || article.mengeProPalette <= 0) throw new Error("Menge pro Palette muss größer 0 sein");
}

function articleSummary(article) {
  return {
    id: article.id,
    materialnummer: article.materialnummer,
    materialbezeichnung: article.materialbezeichnung,
    gebindeArt: article.gebindeArt,
    mengeProKarton: article.mengeProKarton,
    mengeProPalette: article.mengeProPalette,
    barcode: article.barcode,
    lagerplatz: article.lagerplatz,
    artikelgruppe: article.artikelgruppe,
    bemerkung: article.bemerkung,
    aktiv: article.aktiv,
    erstelltAm: article.erstelltAm,
    geaendertAm: article.geaendertAm
  };
}

function articleFromRow(row) {
  return {
    id: String(row.id || ""),
    materialnummer: String(row.materialnummer || ""),
    materialbezeichnung: String(row.materialbezeichnung || ""),
    gebindeArt: normalizeGebindeArt(row.gebinde_art),
    mengeProKarton: Number(row.menge_pro_karton || 0),
    mengeProPalette: Number(row.menge_pro_palette || 0),
    barcode: String(row.barcode || ""),
    lagerplatz: String(row.lagerplatz || ""),
    artikelgruppe: String(row.artikelgruppe || ""),
    bemerkung: String(row.bemerkung || ""),
    aktiv: Boolean(row.aktiv),
    erstelltAm: String(row.erstellt_am || ""),
    geaendertAm: String(row.geaendert_am || "")
  };
}

function normalizeStorageReceipt(receipt) {
  const normalized = {
    materialnummer: String(receipt.materialnummer ?? receipt.artikelnummer ?? receipt.articleNumber ?? "").trim(),
    lagerplatz: String(receipt.lagerplatz ?? receipt.storageBin ?? "").trim().toUpperCase(),
    leNummer: String(receipt.leNummer ?? receipt.le_nummer ?? receipt.LE ?? receipt.handlingUnit ?? "").trim(),
    mengeStueck: readInteger(receipt.mengeStueck ?? receipt.menge_stueck ?? receipt.stueckzahl ?? receipt.quantity),
    referenz: String(receipt.referenz ?? receipt.reference ?? "").trim()
  };

  if (!normalized.materialnummer) throw httpError(400, "Artikelnummer fehlt");
  if (!normalized.lagerplatz) throw httpError(400, "Lagerplatz fehlt");
  if (!normalized.leNummer) throw httpError(400, "LE-Nummer fehlt");
  if (!Number.isInteger(normalized.mengeStueck) || normalized.mengeStueck <= 0) throw httpError(400, "Stückzahl muss größer 0 sein");
  return normalized;
}

function normalizeStorageIssue(issue) {
  const normalized = {
    materialnummer: String(issue.materialnummer ?? issue.artikelnummer ?? issue.barcode ?? issue.articleNumber ?? "").trim(),
    lagerplatz: String(issue.lagerplatz ?? issue.storageBin ?? "").trim().toUpperCase(),
    leNummer: String(issue.leNummer ?? issue.le_nummer ?? issue.LE ?? issue.hu ?? issue.handlingUnit ?? "").trim(),
    mengeStueck: readInteger(issue.mengeStueck ?? issue.menge_stueck ?? issue.stueckzahl ?? issue.quantity),
    referenz: String(issue.referenz ?? issue.bemerkung ?? issue.reference ?? issue.note ?? "").trim()
  };

  if (!normalized.materialnummer) throw httpError(400, "Artikelnummer oder Barcode fehlt");
  if (!normalized.lagerplatz) throw httpError(400, "Lagerplatz fehlt");
  if (!normalized.leNummer) throw httpError(400, "LE-Nummer/HU fehlt");
  if (!Number.isInteger(normalized.mengeStueck) || normalized.mengeStueck <= 0) throw httpError(400, "Stückzahl muss größer 0 sein");
  return normalized;
}

function storageLocationFromRow(row) {
  return {
    id: String(row.id || ""),
    materialnummer: String(row.materialnummer || ""),
    materialbezeichnung: String(row.materialbezeichnung || ""),
    lagerplatz: String(row.lagerplatz || ""),
    leNummer: String(row.le_nummer || ""),
    mengeStueck: Number(row.menge_stueck || 0),
    aktualisiertAm: String(row.aktualisiert_am || "")
  };
}

function storageMovementFromRow(row) {
  return {
    id: String(row.id || ""),
    materialnummer: String(row.materialnummer || ""),
    materialbezeichnung: String(row.materialbezeichnung || ""),
    bewegungsart: String(row.bewegungsart || ""),
    mengeStueck: Number(row.menge_stueck || 0),
    lagerplatz: String(row.lagerplatz || ""),
    leNummer: String(row.le_nummer || ""),
    referenz: String(row.referenz || ""),
    erstelltAm: String(row.erstellt_am || "")
  };
}

function searchArticles(articles, query, includeInactive = false) {
  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  return sortArticles(articles)
    .filter((article) => includeInactive || article.aktiv)
    .filter((article) => {
      if (!terms.length) return true;
      const haystack = normalizeSearch([article.materialnummer, article.materialbezeichnung, article.gebindeArt, article.barcode, article.lagerplatz, article.artikelgruppe].join(" "));
      return terms.every((term) => haystack.includes(term));
    });
}

function findArticleByCode(articles, code) {
  const needle = String(code || "").trim().toLowerCase();
  if (!needle) return null;
  return articles.find((article) => article.aktiv && (
    article.materialnummer.toLowerCase() === needle ||
    String(article.barcode || "").toLowerCase() === needle
  )) || null;
}

function calculatePackaging(article, quantity) {
  const mengeStueck = readInteger(quantity);
  if (!Number.isInteger(mengeStueck) || mengeStueck < 0) throw new Error("Menge muss eine Zahl ab 0 sein");
  return {
    mengeStueck,
    kartons: article.mengeProKarton > 0 ? mengeStueck / article.mengeProKarton : 0,
    paletten: article.mengeProPalette > 0 ? mengeStueck / article.mengeProPalette : 0,
    volleKartons: article.mengeProKarton > 0 ? Math.floor(mengeStueck / article.mengeProKarton) : 0,
    restStueckNachKartons: article.mengeProKarton > 0 ? mengeStueck % article.mengeProKarton : mengeStueck,
    vollePaletten: article.mengeProPalette > 0 ? Math.floor(mengeStueck / article.mengeProPalette) : 0,
    restStueckNachPaletten: article.mengeProPalette > 0 ? mengeStueck % article.mengeProPalette : mengeStueck
  };
}

function articlesToCsv(articles) {
  const header = ["Materialnummer", "Materialbezeichnung", "Gebinde", "Menge pro KRT", "Menge pro Palette", "Barcode", "Lagerplatz", "Artikelgruppe", "Bemerkung", "Aktiv"];
  const rows = sortArticles(articles).map((article) => [
    article.materialnummer,
    article.materialbezeichnung,
    article.gebindeArt,
    article.gebindeArt === "KRT" ? article.mengeProKarton : "",
    article.mengeProPalette,
    article.barcode,
    article.lagerplatz,
    article.artikelgruppe,
    article.bemerkung,
    article.aktiv ? "1" : "0"
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
}

function sortArticles(articles) {
  return [...articles].sort((a, b) => String(a.materialnummer).localeCompare(String(b.materialnummer), "de", { numeric: true }));
}

function normalizeGebindeArt(value) {
  const text = String(value || "STK").trim().toUpperCase();
  return ["C1", "C2", "KRT", "STK"].includes(text) ? text : "STK";
}

function readInteger(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["0", "false", "nein", "no", "inaktiv"].includes(text)) return false;
  return true;
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (!/[;"\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

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

async function sendFile(response, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not file");
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw httpError(413, "Anfrage ist zu groß");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw httpError(400, "Ungültige JSON-Daten");
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

function sendText(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(value);
}

function sendCsv(response, status, fileName, value) {
  response.writeHead(status, {
    "Content-Type": "text/csv; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="${sanitizeFileName(fileName)}"`
  });
  response.end(value);
}

function safeResolve(baseDir, requestPath) {
  const base = path.resolve(baseDir);
  const relative = path.normalize(requestPath).replace(/^([/\\])+/, "");
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const resolved = path.resolve(base, relative);
  const relation = path.relative(base, resolved);
  if (relation.startsWith("..") || path.isAbsolute(relation)) return null;
  return resolved;
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

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}

function withLineContext(error, index) {
  const statusCode = error.statusCode || 400;
  const message = error.publicMessage || error.message || "Buchungszeile ist ungültig";
  return httpError(statusCode, `Zeile ${index + 1}: ${message}`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }
      resolve();
    });
  });
}

function findBrowser() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function localAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

function createId() {
  return `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createArticleId() {
  return `article-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createStorageId() {
  return `stock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createStorageMovementId() {
  return `move-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeFileName(value) {
  return String(value).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 140);
}

function pdfFileBase(order) {
  const orderNumber = sanitizeFileNamePart(order.orderNumber || order.id || "auftrag");
  const orderDate = sanitizeFileNamePart(order.orderDate || new Date().toISOString().slice(0, 10));
  return sanitizeFileName(`kommissionierung-${orderNumber}-${orderDate}`);
}

function sanitizeFileNamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "auftrag";
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
