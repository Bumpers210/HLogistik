import { execFile } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { escapeHtml, formatDate, sanitizeFileName, sanitizeFileNamePart, absoluteUrl } from "./helpers.mjs";

export async function exportPdf(order, exportDir, tempDir, origin = "", copyDir = "") {
  const fileBase = pdfFileBase(order);
  const htmlPath = path.join(tempDir, `${fileBase}.html`);
  const pdfPath = path.join(exportDir, `${fileBase}.pdf`);
  await writeFile(htmlPath, printableHtml(order, `${fileBase}.pdf`), "utf8");

  const browser = findBrowser();
  if (!browser) {
    throw new Error("Kein Edge/Chrome gefunden. Bitte Microsoft Edge oder Chrome installieren.");
  }

  await run(browser, ["--headless", "--disable-gpu", `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href]);
  const copyPath = await copyPdfToExportFolder(pdfPath, copyDir, `${fileBase}.pdf`);

  return {
    file: `${fileBase}.pdf`,
    path: pdfPath,
    copyPath,
    url: absoluteUrl(origin, `/exports/${encodeURIComponent(`${fileBase}.pdf`)}`),
  };
}

async function copyPdfToExportFolder(sourcePath, copyDir, fileName) {
  if (!copyDir) return "";
  const targetPath = path.join(copyDir, fileName);
  if (path.resolve(sourcePath).toLowerCase() === path.resolve(targetPath).toLowerCase()) return "";
  await mkdir(copyDir, { recursive: true });
  await copyFile(sourcePath, targetPath);
  return targetPath;
}

function printableHtml(order, fileName) {
  const isStorage = (order.orderType || "picking") === "storage";
  const picked = order.lines.filter((line) => line.picked || isMissingStorageLine(line)).length;
  const changed = order.lines.filter(isChangedLine).length;
  const normalLines = order.lines.filter((line) => line.lineType !== "loading-slip");
  const loadingSlipLines = order.lines.filter((line) => line.lineType === "loading-slip");
  const rows = normalLines
    .map(
      (line) => isStorage ? `
    <tr${lineRowClass(line)}>
      <td>${escapeHtml(storageLineStatus(line))}</td>
      <td>${escapeHtml(line.warehouseOrder)}</td>
      <td>${escapeHtml(line.fromHandlingUnit)}</td>
      <td>${escapeHtml(line.fromBin)}</td>
      <td>${escapeHtml(line.product)}</td>
      <td class="num">${escapeHtml(line.targetQty)}</td>
      <td class="num">${escapeHtml(line.actualQty)}</td>
      <td>${escapeHtml(line.unit)}</td>
      <td>${escapeHtml(line.description)}</td>
      <td>${escapeHtml(storageLineNote(line))}</td>
    </tr>` : `
    <tr${lineRowClass(line)}>
      <td>${escapeHtml(line.picked ? "ja" : "nein")}</td>
      <td>${escapeHtml(line.warehouseOrder)}</td>
      <td>${escapeHtml(line.fromHandlingUnit)}</td>
      <td>${escapeHtml(combinedPositionNote(line))}</td>
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
  const loadingSlipRows = loadingSlipLines.map((line) => `
    <section class="loading-slip">
      <div class="loading-slip-check">${escapeHtml(line.picked ? "ja" : "nein")}</div>
      <div class="loading-slip-barcode">${code128Svg(line.barcode || "")}</div>
      <div><strong>Artikelnummer</strong><span>${escapeHtml(line.product)}</span></div>
      <div><strong>Produktbeschreibung</strong><span>${escapeHtml(line.description)}</span></div>
      <div><strong>Soll</strong><span>${escapeHtml(line.targetQty)} ${escapeHtml(line.unit)}</span></div>
      <div class="loading-slip-note"><strong>Zusatzbemerkung</strong><span>${escapeHtml(combinedPositionNote(line) || "-")}</span></div>
    </section>`).join("");

  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(fileName)}</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #111; font-family: Arial, Helvetica, sans-serif; font-size: 12px; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #111; }
      h1 { margin: 0 0 6px; font-size: 24px; }
      p { margin: 0 0 4px; }
      .meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 18px; margin-bottom: 10px; font-size: 12px; }
      .note { min-height: 28px; margin-bottom: 10px; padding: 6px; border: 1px solid #777; }
      table { width: calc(100% - 20mm); border-collapse: collapse; table-layout: fixed; }
      th, td { padding: 4px 3px; border: 1px solid #555; vertical-align: top; overflow-wrap: anywhere; }
      th { background: #e8eee9; text-align: left; font-size: 11px; }
      td { font-size: 11px; }
      .num { text-align: right; }
      .changed-qty td { background: #fff3bf; font-weight: 700; }
      .missing-line td { background: #ffe2d6; color: #7b1f0f; font-weight: 700; }
      .changed-qty td:nth-child(8) { border: 2px solid #111; }
      .storage-table .changed-qty td:nth-child(7) { border: 2px solid #111; }
      .loading-slip { display: grid; grid-template-columns: 18mm 64mm 28mm 1fr 26mm; gap: 4px; margin-top: 10px; padding: 6px; border: 2px solid #111; break-inside: avoid; }
      .loading-slip > div { border: 1px solid #777; padding: 4px; min-height: 34px; }
      .loading-slip strong { display: block; margin-bottom: 3px; color: #555; font-size: 10px; }
      .loading-slip span { font-size: 13px; font-weight: 700; }
      .loading-slip-barcode { padding: 2px !important; background: #fff; }
      .loading-slip-check { display: grid; place-items: center; font-weight: 700; }
      .loading-slip-note { grid-column: 2 / -1; }
      .code128 { display: block; width: 100%; height: 16mm; }
      .code128 text { fill: #111; font: 700 9px Arial, Helvetica, sans-serif; letter-spacing: 0; }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>${escapeHtml(isStorage ? "Einlagerabschluss" : "Kommissionierabschluss")}</h1>
        <p><strong>Auftrag:</strong> ${escapeHtml(order.orderNumber || "-")}</p>
        <p><strong>Kunde:</strong> ${escapeHtml(order.customerName || "-")}</p>
        <p><strong>Bearbeiter:</strong> ${escapeHtml(order.lastEditedBy || "-")}</p>
      </div>
      <div>
        <p><strong>Datum:</strong> ${escapeHtml(formatDate(order.orderDate))}</p>
        <p><strong>Uhrzeit:</strong> ${escapeHtml(order.orderTime || "-")}</p>
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
    <table class="${isStorage ? "storage-table" : ""}">
      <thead>
        ${isStorage ? `
        <tr>
          <th style="width:5%;">OK</th>
          <th style="width:6%;">Pos.</th>
          <th style="width:10%;">HU</th>
          <th style="width:12%;">Stellplatz</th>
          <th style="width:10%;">Material</th>
          <th style="width:5%;">Soll</th>
          <th style="width:7%;">Ist</th>
          <th style="width:11%;">Einh.</th>
          <th style="width:24%;">Artikelbezeichnung</th>
          <th style="width:10%;">Bemerkung</th>
        </tr>` : `
        <tr>
          <th style="width:4%;">OK</th>
          <th style="width:8%;">Lagerauftrag</th>
          <th style="width:8%;">Von-HU</th>
          <th style="width:13%;">Bemerkung</th>
          <th style="width:9%;">Lagerplatz</th>
          <th style="width:7%;">Produkt</th>
          <th style="width:4%;">Soll</th>
          <th style="width:5%;">Ist</th>
          <th style="width:8%;">Einh.</th>
          <th style="width:23%;">Beschreibung</th>
          <th style="width:11%;">Nach-Lagerplatz</th>
        </tr>`}
      </thead>
      <tbody>${rows || `<tr><td colspan="${isStorage ? 10 : 11}">Keine Positionen vorhanden.</td></tr>`}</tbody>
    </table>
    ${isStorage ? "" : loadingSlipRows}
  </body>
</html>`;
}

function code128Svg(value) {
  const barcode = String(value || "").trim();
  if (!barcode) return `<span>Kein Barcode</span>`;

  const patterns = [
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
    "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
    "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
    "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
    "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
    "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
    "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
    "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
    "114131", "311141", "411131", "211412", "211214", "211232", "2331112"
  ];
  const codes = [104];
  for (const char of barcode) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) continue;
    codes.push(code - 32);
  }
  if (codes.length === 1) return `<span>Barcode ungueltig</span>`;

  const checksum = codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103;
  codes.push(checksum, 106);

  let x = 10;
  let bars = "";
  codes.forEach((code) => {
    const pattern = patterns[code];
    if (!pattern) return;
    [...pattern].forEach((widthText, index) => {
      const width = Number(widthText);
      if (index % 2 === 0) bars += `<rect x="${x}" y="0" width="${width}" height="44"></rect>`;
      x += width;
    });
  });

  const width = x + 10;
  return `<svg class="code128" viewBox="0 0 ${width} 58" role="img" aria-label="Barcode ${escapeHtml(barcode)}">
    <g fill="#111">${bars}</g>
    <text x="${width / 2}" y="56" text-anchor="middle">${escapeHtml(barcode)}</text>
  </svg>`;
}

function isQuantityChanged(line) {
  return String(line?.actualQty || "").trim() !== String(line?.targetQty || "").trim();
}

function isMissingStorageLine(line) {
  return line?.missing === true;
}

function isChangedLine(line) {
  return isQuantityChanged(line) || isMissingStorageLine(line);
}

function lineRowClass(line) {
  const classes = [];
  if (isQuantityChanged(line)) classes.push("changed-qty");
  if (isMissingStorageLine(line)) classes.push("missing-line");
  return classes.length ? ` class="${classes.join(" ")}"` : "";
}

function storageLineStatus(line) {
  if (isMissingStorageLine(line)) return "FEHLT";
  return line?.picked ? "ja" : "nein";
}

function storageLineNote(line) {
  if (!isMissingStorageLine(line)) return combinedPositionNote(line);
  const parts = ["nicht geliefert"];
  if (line?.missingBy) parts.push(`markiert von ${line.missingBy}`);
  const note = combinedPositionNote(line);
  if (note) parts.push(note);
  return parts.join(" - ");
}

function combinedPositionNote(line) {
  return combineUniqueNoteParts([line?.positionNote, ...autoPositionNoteValues(line)]);
}

function autoPositionNoteValues(line) {
  const notes = line?.autoPositionNotes && typeof line.autoPositionNotes === "object" ? line.autoPositionNotes : {};
  return [notes.destination, notes.quantity, notes.storagePallet, notes.loadingSlip]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function combineUniqueNoteParts(parts) {
  const seen = new Set();
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .filter((part) => {
      const key = part.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("; ");
}

function pdfFileBase(order) {
  const orderNumber = sanitizeFileNamePart(order.orderNumber || order.id || "auftrag");
  const customer = sanitizeFileNamePart(order.customerName || "kunde");
  const orderDate = sanitizeFileNamePart(order.orderDate || new Date().toISOString().slice(0, 10));
  const rawTime = String(order.orderTime || "").replace(":", "-").trim();
  const orderTime = rawTime ? sanitizeFileNamePart(rawTime) : "";
  return sanitizeFileName([orderNumber, customer, orderDate, orderTime].filter(Boolean).join("-"));
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
