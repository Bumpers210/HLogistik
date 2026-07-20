import ExcelJS from "exceljs";

import { readInteger } from "./helpers.mjs";
import { normalizeWarehouse } from "./rules/warehouse-rules.mjs";
import { isIncompleteSsiStorageHandlingUnit } from "./rules/storage-hu-rules.mjs";

export const ORDER_EXCEL_SHEET_NAME = "Buchungen";
export const ORDER_EXCEL_HEADERS = Object.freeze([
  "Ein/Aus",
  "Datum/Uhrzeit",
  "Artikelnummer",
  "Stellplatz",
  "LE",
  "Menge",
]);

export async function exportOrderExcel(order, filePath, options = {}) {
  const rows = orderExcelRows(order, options);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HLogistik";
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(ORDER_EXCEL_SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.columns = [
    { header: ORDER_EXCEL_HEADERS[0], key: "direction", width: 10 },
    { header: ORDER_EXCEL_HEADERS[1], key: "exportedAt", width: 22, style: { numFmt: "dd.mm.yyyy hh:mm:ss" } },
    { header: ORDER_EXCEL_HEADERS[2], key: "product", width: 18, style: { numFmt: "@" } },
    { header: ORDER_EXCEL_HEADERS[3], key: "bin", width: 22, style: { numFmt: "@" } },
    { header: ORDER_EXCEL_HEADERS[4], key: "handlingUnit", width: 24, style: { numFmt: "@" } },
    { header: ORDER_EXCEL_HEADERS[5], key: "quantity", width: 12 },
  ];

  worksheet.getRow(1).font = { bold: true };
  rows.forEach((row) => {
    const added = worksheet.addRow(row);
    added.getCell("product").numFmt = "@";
    added.getCell("bin").numFmt = "@";
    added.getCell("handlingUnit").numFmt = "@";
    added.getCell("exportedAt").numFmt = "dd.mm.yyyy hh:mm:ss";
  });

  await workbook.xlsx.writeFile(filePath);
  return { rows: rows.length };
}

export function orderExcelRows(order, options = {}) {
  const isStorage = (order?.orderType || "picking") === "storage";
  const exportedAt = excelExportDate(options.exportedAt);
  const warehouse = normalizeWarehouse(options.warehouse || order?.orderWarehouse);
  const includeHandlingUnit = warehouse === "SI";
  return bookableOrderLines(order)
    .map((line, index) => {
      const quantity = orderLineQuantity(line, { isStorage });
      if (!Number.isInteger(quantity) || quantity <= 0) {
        const position = line?.warehouseOrder || line?.position || index + 1;
        throw new Error(`Excel-Export fehlgeschlagen: Pos. ${position}: Menge fehlt oder ist ungueltig.`);
      }
      return {
        direction: isStorage ? "Ein" : "Aus",
        exportedAt,
        product: String(line?.product || "").trim(),
        bin: orderLineBin(line, { isStorage }),
        handlingUnit: includeHandlingUnit ? String(line?.fromHandlingUnit || "").trim() : "",
        quantity,
      };
    });
}

export function bookableOrderLines(order) {
  const isStorage = (order?.orderType || "picking") === "storage";
  return (Array.isArray(order?.lines) ? order.lines : [])
    .filter((line) => line?.lineType !== "loading-slip")
    .filter((line) => !(isStorage && isEmptyManualStorageLine(line)))
    .filter((line) => !(isStorage && line?.missing === true));
}

function excelExportDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error("Excel-Export fehlgeschlagen: Exportzeitpunkt ist ungueltig.");
  }
  return date;
}

function orderLineBin(line, { isStorage }) {
  if (isStorage) return String(line?.fromBin || "").trim();
  return String(line?.fromBin || "").trim();
}

function orderLineQuantity(line, { isStorage }) {
  if (isStorage) return readInteger(storageLineQuantity(line));
  const quantitySource = line?.actualQty !== undefined && line?.actualQty !== null && String(line.actualQty).trim() !== ""
    ? line.actualQty
    : line?.targetQty;
  return readPickingQuantity(quantitySource);
}

function storageLineQuantity(line) {
  const actual = String(line?.actualQty ?? "").trim();
  return actual ? line.actualQty : line?.targetQty;
}

function readPickingQuantity(value) {
  const text = String(value ?? "").trim();
  const multiplier = text.replace(/\s+/g, "").match(/^(\d+)x([\d.,]+)$/i);
  if (multiplier) return readInteger(multiplier[1]) * readInteger(multiplier[2]);
  return readInteger(text);
}

function isEmptyManualStorageLine(line) {
  if (line?.manual !== true) return false;
  const handlingUnit = isIncompleteSsiStorageHandlingUnit(line.fromHandlingUnit) ? "" : line.fromHandlingUnit;
  return [
    line.product,
    line.description,
    line.actualQty,
    handlingUnit,
    line.fromBin,
    line.positionNote,
  ].every((value) => !String(value ?? "").trim());
}
