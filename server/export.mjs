import { execFile } from "node:child_process";
import { copyFile, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { escapeHtml, formatDate, sanitizeFileName, sanitizeFileNamePart, absoluteUrl } from "./helpers.mjs";
import { exportOrderExcel } from "./order-excel-export.mjs";

export async function exportPdf(order, exportDir, tempDir, origin = "", copyDir = "", options = {}) {
  const discard = options?.discard === true;
  const preserveTempArtifacts = options?.preserveTempArtifacts === true;
  const fileBase = pdfFileBase(order);
  const htmlPath = path.join(tempDir, `${fileBase}.html`);
  const pdfFileName = `${fileBase}.pdf`;
  const xlsxFileName = `${fileBase}.xlsx`;
  const tempPdfPath = path.join(tempDir, pdfFileName);
  const tempXlsxPath = path.join(tempDir, xlsxFileName);
  const pdfPath = path.join(exportDir, pdfFileName);
  const xlsxPath = path.join(exportDir, xlsxFileName);
  const exportedAt = options?.exportedAt || new Date().toISOString();
  await mkdir(tempDir, { recursive: true });
  if (!discard) await mkdir(exportDir, { recursive: true });

  try {
    await writeFile(htmlPath, printableHtml(order, pdfFileName), "utf8");

    const browser = findBrowser();
    if (!browser) {
      throw new Error("Kein Edge/Chrome gefunden. Bitte Microsoft Edge oder Chrome installieren.");
    }

    await run(browser, ["--headless", "--disable-gpu", `--print-to-pdf=${tempPdfPath}`, pathToFileURL(htmlPath).href]);
    await assertExportArtifactCreated(tempPdfPath, "PDF");
    await exportOrderExcel(order, tempXlsxPath, { exportedAt, warehouse: options?.warehouse });
    await assertExportArtifactCreated(tempXlsxPath, "Excel-Datei");

    let copyPath = "";
    let xlsxCopyPath = "";
    if (!discard) {
      await copyFile(tempPdfPath, pdfPath);
      await copyFile(tempXlsxPath, xlsxPath);
      await assertExportArtifactCreated(pdfPath, "PDF");
      await assertExportArtifactCreated(xlsxPath, "Excel-Datei");
      copyPath = await copyExportArtifactToFolder(pdfPath, copyDir, pdfFileName);
      xlsxCopyPath = await copyExportArtifactToFolder(xlsxPath, copyDir, xlsxFileName);
      if (copyPath) await assertExportArtifactCreated(copyPath, "PDF");
      if (xlsxCopyPath) await assertExportArtifactCreated(xlsxCopyPath, "Excel-Datei");
    }

    return {
      file: pdfFileName,
      path: discard ? "" : pdfPath,
      copyPath,
      url: discard ? "" : absoluteUrl(origin, `/exports/${encodeURIComponent(pdfFileName)}`),
      xlsxFile: xlsxFileName,
      xlsxPath: discard ? "" : xlsxPath,
      xlsxCopyPath,
      xlsxUrl: discard ? "" : absoluteUrl(origin, `/exports/${encodeURIComponent(xlsxFileName)}`),
      artifactExportedAt: exportedAt,
      ...(discard ? { discarded: true } : {})
    };
  } finally {
    if (!preserveTempArtifacts) {
      await safeUnlink(htmlPath);
      await safeUnlink(tempPdfPath);
      await safeUnlink(tempXlsxPath);
    }
  }
}

async function assertExportArtifactCreated(filePath, label) {
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} wurde nicht erstellt. Auftrag wurde nicht als exportiert markiert.`);
    }
    throw error;
  }
  if (!fileStats.isFile() || fileStats.size <= 0) {
    throw new Error(`${label} wurde leer erstellt. Auftrag wurde nicht als exportiert markiert.`);
  }
}

async function copyExportArtifactToFolder(sourcePath, copyDir, fileName) {
  if (!copyDir) return "";
  const targetPath = path.join(copyDir, fileName);
  if (path.resolve(sourcePath).toLowerCase() === path.resolve(targetPath).toLowerCase()) return "";
  await mkdir(copyDir, { recursive: true });
  await copyFile(sourcePath, targetPath);
  return targetPath;
}

async function safeUnlink(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function printableHtml(order, fileName) {
  const isStorage = (order.orderType || "picking") === "storage";
  const normalLines = order.lines.filter((line) => line.lineType !== "loading-slip");
  const picked = normalLines.filter((line) => line.picked || isMissingStorageLine(line)).length;
  const changed = normalLines.filter(isChangedLine).length;
  const rows = normalLines
    .map(
      (line) => isStorage ? `
    <tr${lineRowClass(line, isStorage)}>
      <td>${escapeHtml(line.warehouseOrder)}</td>
      <td>${escapeHtml(line.product)}</td>
      <td>${escapeHtml(line.fromHandlingUnit)}</td>
      <td class="num">${escapeHtml(line.targetQty)}</td>
      <td class="num">${escapeHtml(line.actualQty)}</td>
      <td>${escapeHtml(line.fromBin)}</td>
    </tr>` : `
    <tr${lineRowClass(line, isStorage)}>
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
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(fileName)}</title>
    <style>
      @page { size: A4 ${isStorage ? "portrait" : "landscape"}; margin: ${isStorage ? "10mm" : "12mm"}; }
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
      .storage-table { width: 100%; }
      .storage-table th, .storage-table td { padding: 5px 4px; }
      .storage-table th, .storage-table td { font-size: 13px; }
      .storage-table .manual-line:not(.changed-qty):not(.missing-line) td { background: #fff; }
      .storage-table .changed-qty td:nth-child(5) { border: 2px solid #111; }
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
        <p><strong>Erledigt:</strong> ${picked}/${normalLines.length}</p>
        <p><strong>Abgeschlossen:</strong> ${escapeHtml(order.completedBy || "-")}</p>
        <p><strong>Dateiname:</strong> ${escapeHtml(fileName)}</p>
      </div>
    </header>
    <section class="meta">
      <p><strong>Europaletten:</strong> ${escapeHtml(order.euroPallets || "0")}</p>
      <p><strong>Stellplätze:</strong> ${escapeHtml(order.storageSpaces || "0")}</p>
      <p><strong>Korrigiert:</strong> ${changed}</p>
    </section>
    <section class="note"><strong>Notiz:</strong> ${escapeHtml(combinedOrderNote(order) || "-")}</section>
    <table class="${isStorage ? "storage-table" : ""}">
      <thead>
        ${isStorage ? `
        <tr>
          <th style="width:7%;">Pos.</th>
          <th style="width:24%;">Artikelnummer</th>
          <th style="width:20%;">HU / LE</th>
          <th style="width:12%;">Soll</th>
          <th style="width:12%;">Ist</th>
          <th style="width:25%;">Einlagerplatz</th>
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
      <tbody>${rows || `<tr><td colspan="${isStorage ? 6 : 11}">Keine Positionen vorhanden.</td></tr>`}</tbody>
    </table>
  </body>
</html>`;
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

function lineRowClass(line, isStorage = false) {
  const classes = [];
  if (isStorage && line?.manual === true) classes.push("manual-line");
  if (isQuantityChanged(line)) classes.push("changed-qty");
  if (isMissingStorageLine(line)) classes.push("missing-line");
  return classes.length ? ` class="${classes.join(" ")}"` : "";
}

function combinedPositionNote(line) {
  return combineUniqueNoteParts([line?.positionNote, ...autoPositionNoteValues(line)]);
}

function combinedOrderNote(order) {
  const packageA1 = packageA1Total(order?.lines);
  return combineUniqueNoteParts([
    order?.orderNote,
    packageA1 > 0 ? `${packageA1} A1` : "",
  ]).replaceAll("; ", " - ");
}

function packageA1Total(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((total, line) => {
    if (!line || line.lineType === "loading-slip") return total;
    const match = String(line.autoPositionNotes?.package || "").trim().match(/^([1-9]\d*)A1$/);
    if (!match) return total;
    const count = Number(match[1]);
    const nextTotal = total + count;
    return Number.isSafeInteger(count) && Number.isSafeInteger(nextTotal) ? nextTotal : total;
  }, 0);
}

function autoPositionNoteValues(line) {
  const notes = line?.autoPositionNotes && typeof line.autoPositionNotes === "object" ? line.autoPositionNotes : {};
  return [
    notes.destination,
    notes.quantity,
    notes.quantityCorrection,
    notes.storagePallet,
    notes.loadingSlip,
    notes.sourceBinSystem,
    notes.package,
  ]
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
