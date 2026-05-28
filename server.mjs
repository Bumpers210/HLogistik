import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, "data");
const exportDir = path.join(root, "Exporte");
const tempDir = path.join(root, "tmp");
const ordersFile = path.join(dataDir, "orders.json");
const port = Number(globalThis.process?.env?.PORT || 4174);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
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

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, error: error.message || "Serverfehler" });
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

  if (pathname === "/api/health") {
    sendJson(response, 200, { ok: true, host: hostname(), exportDir });
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

  const exportMatch = pathname.match(/^\/api\/orders\/([^/]+)\/export-pdf$/);
  if (exportMatch && request.method === "POST") {
    const body = await readBody(request);
    const savedOrder = await findOrder(exportMatch[1]);
    const order = normalizeOrder({ ...(savedOrder || {}), ...(body.order || {}) });
    order.id = exportMatch[1];
    const result = await exportPdf(order, requestOrigin(request));
    await markOrderExported(order.id, result);
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (pathname.startsWith("/exports/")) {
    await sendFile(response, path.join(exportDir, pathname.replace("/exports/", "")));
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
    "--no-sandbox",
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href
  ]);

  return {
    file: `${fileBase}.pdf`,
    path: pdfPath,
    url: absoluteUrl(origin, `/exports/${encodeURIComponent(`${fileBase}.pdf`)}`)
  };
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
      <p><strong>Stellplaetze:</strong> ${escapeHtml(order.storageSpaces || "0")}</p>
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

async function markOrderExported(id, exportResult) {
  const orders = await readOrders();
  const index = orders.findIndex((order) => order.id === id);
  if (index === -1) return;

  orders[index] = normalizeOrder({
    ...orders[index],
    exportedAt: new Date().toISOString(),
    exportedPdfFile: exportResult.file || "",
    exportedPdfPath: exportResult.path || "",
    updatedAt: new Date().toISOString()
  });
  await writeOrders(orders);
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
    updatedAt: order.updatedAt || ""
  };
}

async function sendStatic(response, requestPath) {
  const safe = path.normalize(requestPath).replace(/^([/\\])+/, "");
  const filePath = path.join(root, safe);
  if (!filePath.startsWith(root)) {
    sendText(response, 403, "Forbidden");
    return;
  }
  await sendFile(response, filePath);
}

async function sendFile(response, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not file");
    response.writeHead(200, { "Content-Type": mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendText(response, status, value) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(value);
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
