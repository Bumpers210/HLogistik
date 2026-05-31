import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { escapeHtml, formatDate, sanitizeFileName, sanitizeFileNamePart, absoluteUrl } from "./helpers.mjs";

export async function exportPdf(order, exportDir, tempDir, origin = "") {
  const fileBase = pdfFileBase(order);
  const htmlPath = path.join(tempDir, `${fileBase}.html`);
  const pdfPath = path.join(exportDir, `${fileBase}.pdf`);
  await writeFile(htmlPath, printableHtml(order, `${fileBase}.pdf`), "utf8");

  const browser = findBrowser();
  if (!browser) {
    throw new Error("Kein Edge/Chrome gefunden. Bitte Microsoft Edge oder Chrome installieren.");
  }

  await run(browser, ["--headless", "--disable-gpu", `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href]);

  return {
    file: `${fileBase}.pdf`,
    path: pdfPath,
    url: absoluteUrl(origin, `/exports/${encodeURIComponent(`${fileBase}.pdf`)}`),
  };
}

function printableHtml(order, fileName) {
  const picked = order.lines.filter((line) => line.picked).length;
  const changed = order.lines.filter(
    (line) => String(line.actualQty || "").trim() !== String(line.targetQty || "").trim()
  ).length;
  const rows = order.lines
    .map(
      (line) => `
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
    </tr>`
    )
    .join("");

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

function pdfFileBase(order) {
  const orderNumber = sanitizeFileNamePart(order.orderNumber || order.id || "auftrag");
  const orderDate = sanitizeFileNamePart(order.orderDate || new Date().toISOString().slice(0, 10));
  return sanitizeFileName(`kommissionierung-${orderNumber}-${orderDate}`);
}

export function findBrowser() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return candidates.find((candidate) => existsSync(candidate));
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
