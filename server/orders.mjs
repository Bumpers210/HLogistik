import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { getDb } from "./db.mjs";
import { createId } from "./helpers.mjs";
import { normalizeOptionalWarehouse } from "./rules/warehouse-rules.mjs";
import {
  firstDestinationName,
  normalizeCustomerGroupKey,
  normalizeDestinationName,
  orderNumberForCustomer,
} from "./rules/order-rules.mjs";

export { normalizeCustomerGroupKey } from "./rules/order-rules.mjs";

// ── SQLite CRUD ───────────────────────────────────────────────────────────────

export function readOrders() {
  return getDb()
    .prepare(
      `SELECT id, auftragsnummer, kundenname, kunden_gruppe, auftragsdatum, auftragszeit, euro_paletten, stellplaetze,
              auftrags_notiz, rohtext, collapse_done, auftrags_typ, auftrags_lager, erstellt_von,
              zuletzt_bearbeitet_von, aktiver_benutzer, aktiver_benutzer_am,
              uebernommen_von, uebernommen_am,
              abgeschlossen_von, abgeschlossen_am, exportiert_am, exportiert_pdf_datei,
              exportiert_pdf_pfad, positionen, erstellt_am, aktualisiert_am
       FROM auftraege`
    )
    .all()
    .map(orderFromRow);
}

export function findOrder(id) {
  const row = getDb()
    .prepare(
      `SELECT id, auftragsnummer, kundenname, kunden_gruppe, auftragsdatum, auftragszeit, euro_paletten, stellplaetze,
              auftrags_notiz, rohtext, collapse_done, auftrags_typ, auftrags_lager, erstellt_von,
              zuletzt_bearbeitet_von, aktiver_benutzer, aktiver_benutzer_am,
              uebernommen_von, uebernommen_am,
              abgeschlossen_von, abgeschlossen_am, exportiert_am, exportiert_pdf_datei,
              exportiert_pdf_pfad, positionen, erstellt_am, aktualisiert_am
       FROM auftraege WHERE id = ?`
    )
    .get(id);
  return row ? orderFromRow(row) : null;
}

export function upsertOrder(order) {
  getDb()
    .prepare(
      `INSERT INTO auftraege
         (id, auftragsnummer, kundenname, kunden_gruppe, auftragsdatum, auftragszeit, euro_paletten, stellplaetze,
         auftrags_notiz, rohtext, collapse_done, auftrags_typ, auftrags_lager, erstellt_von,
          zuletzt_bearbeitet_von, aktiver_benutzer, aktiver_benutzer_am,
          uebernommen_von, uebernommen_am,
          abgeschlossen_von, abgeschlossen_am, exportiert_am, exportiert_pdf_datei,
          exportiert_pdf_pfad, positionen, erstellt_am, aktualisiert_am)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         auftragsnummer = excluded.auftragsnummer,
         kundenname = excluded.kundenname,
         kunden_gruppe = excluded.kunden_gruppe,
         auftragsdatum = excluded.auftragsdatum,
         auftragszeit = excluded.auftragszeit,
         euro_paletten = excluded.euro_paletten,
         stellplaetze = excluded.stellplaetze,
         auftrags_notiz = excluded.auftrags_notiz,
         rohtext = excluded.rohtext,
         collapse_done = excluded.collapse_done,
         auftrags_typ = excluded.auftrags_typ,
         auftrags_lager = excluded.auftrags_lager,
         erstellt_von = excluded.erstellt_von,
         zuletzt_bearbeitet_von = excluded.zuletzt_bearbeitet_von,
         aktiver_benutzer = excluded.aktiver_benutzer,
         aktiver_benutzer_am = excluded.aktiver_benutzer_am,
         uebernommen_von = excluded.uebernommen_von,
         uebernommen_am = excluded.uebernommen_am,
         abgeschlossen_von = excluded.abgeschlossen_von,
         abgeschlossen_am = excluded.abgeschlossen_am,
         exportiert_am = excluded.exportiert_am,
         exportiert_pdf_datei = excluded.exportiert_pdf_datei,
         exportiert_pdf_pfad = excluded.exportiert_pdf_pfad,
         positionen = excluded.positionen,
         erstellt_am = excluded.erstellt_am,
         aktualisiert_am = excluded.aktualisiert_am`
    )
    .run(
      order.id,
      order.orderNumber,
      order.customerName,
      order.customerGroupKey,
      order.orderDate,
      order.orderTime,
      order.euroPallets,
      order.storageSpaces,
      order.orderNote,
      order.rawText,
      order.collapseDone ? 1 : 0,
      order.orderType,
      order.orderWarehouse,
      order.createdBy,
      order.lastEditedBy,
      order.activeUser,
      order.activeUserAt,
      order.acceptedBy,
      order.acceptedAt,
      order.completedBy,
      order.completedAt,
      order.exportedAt,
      order.exportedPdfFile,
      order.exportedPdfPath,
      JSON.stringify(Array.isArray(order.lines) ? order.lines : []),
      order.createdAt,
      order.updatedAt
    );
}

export function deleteOrder(id) {
  return getDb().prepare("DELETE FROM auftraege WHERE id = ?").run(id).changes > 0;
}

export function markOrderExported(id, exportResult) {
  const exportedAt = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE auftraege SET exportiert_am = ?, exportiert_pdf_datei = ?, exportiert_pdf_pfad = ?, aktualisiert_am = ?
       WHERE id = ?`
    )
    .run(exportedAt, exportResult.file || "", exportResult.path || "", exportedAt, id);
  return exportedAt;
}

export function findBlockingAcceptedOrder(userName, excludeId = "") {
  const userKey = userLookupKey(userName);
  if (!userKey) return null;

  return readOrders().find((order) => {
    if (excludeId && order.id === excludeId) return false;
    if (order.exportedAt) return false;
    return userLookupKey(order.acceptedBy) === userKey;
  }) || null;
}

// ── Migration from orders.json ────────────────────────────────────────────────

export async function migrateOrdersFromJson(ordersFile) {
  if (!existsSync(ordersFile)) return;
  const count = getDb().prepare("SELECT COUNT(*) AS count FROM auftraege").get().count;
  if (count > 0) return;

  try {
    const legacy = JSON.parse(await readFile(ordersFile, "utf8"));
    if (!Array.isArray(legacy) || !legacy.length) return;

    const db = getDb();
    db.exec("BEGIN");
    try {
      legacy.forEach((raw) => {
        const order = normalizeOrder(raw);
        if (!order.id) order.id = createId();
        upsertOrder(order);
      });
      db.exec("COMMIT");
      console.log(`${legacy.length} Aufträge aus orders.json migriert.`);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error("Migration von orders.json fehlgeschlagen:", error.message);
  }
}

// ── Normalization ─────────────────────────────────────────────────────────────

export function normalizeOrder(order) {
  const orderType = String(order.orderType || "picking");
  const orderWarehouse = normalizeOrderWarehouse(order.orderWarehouse || order.pickingWarehouse || order.detectedWarehouse);
  const lines = normalizeOrderLines(Array.isArray(order.lines) ? order.lines : []);
  const destinationCustomerName = orderType === "picking" ? firstDestinationName(lines) : "";
  const customerName = destinationCustomerName || String(order.customerName || "");
  const orderNumber = orderNumberForCustomer(order.orderNumber, customerName);
  const explicitGroupKey = normalizeCustomerGroupKey(order.customerGroupKey || order.customerKey);
  return {
    id: order.id || "",
    orderNumber,
    customerName,
    customerGroupKey: destinationCustomerName ? normalizeCustomerGroupKey(destinationCustomerName) : explicitGroupKey || normalizeCustomerGroupKey(customerName),
    orderDate: String(order.orderDate || new Date().toISOString().slice(0, 10)),
    orderTime: String(order.orderTime || ""),
    euroPallets: String(order.euroPallets || ""),
    storageSpaces: String(order.storageSpaces || ""),
    orderNote: String(order.orderNote || ""),
    rawText: String(order.rawText || ""),
    collapseDone: Boolean(order.collapseDone),
    lines,
    orderType,
    orderWarehouse,
    exportedAt: String(order.exportedAt || ""),
    exportedPdfFile: String(order.exportedPdfFile || ""),
    exportedPdfPath: String(order.exportedPdfPath || ""),
    createdBy: String(order.createdBy || ""),
    lastEditedBy: String(order.lastEditedBy || ""),
    activeUser: String(order.activeUser || ""),
    activeUserAt: String(order.activeUserAt || ""),
    acceptedBy: String(order.acceptedBy || ""),
    acceptedAt: String(order.acceptedAt || ""),
    completedBy: String(order.completedBy || ""),
    completedAt: String(order.completedAt || ""),
    createdAt: order.createdAt || "",
    updatedAt: order.updatedAt || "",
  };
}

export function orderSummary(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber || order.id,
    customerName: order.customerName || "",
    customerGroupKey: order.customerGroupKey || normalizeCustomerGroupKey(order.customerName),
    orderDate: order.orderDate || "",
    orderTime: order.orderTime || "",
    total: order.lines.length,
    picked: order.lines.filter((line) => line.picked).length,
    createdBy: order.createdBy || "",
    lastEditedBy: order.lastEditedBy || "",
    activeUser: order.activeUser || "",
    activeUserAt: order.activeUserAt || "",
    acceptedBy: order.acceptedBy || "",
    acceptedAt: order.acceptedAt || "",
    completedBy: order.completedBy || "",
    completedAt: order.completedAt || "",
    orderWarehouse: order.orderWarehouse || "",
    exportedAt: order.exportedAt || "",
    orderType: order.orderType || "picking",
    createdAt: order.createdAt || "",
    updatedAt: order.updatedAt || "",
  };
}

// ── Row mapping ───────────────────────────────────────────────────────────────

function orderFromRow(row) {
  let lines = [];
  try {
    lines = JSON.parse(row.positionen || "[]");
  } catch {
    lines = [];
  }
  return {
    id: String(row.id || ""),
    orderNumber: String(row.auftragsnummer || ""),
    customerName: String(row.kundenname || ""),
    customerGroupKey: String(row.kunden_gruppe || "") || normalizeCustomerGroupKey(row.kundenname),
    orderDate: String(row.auftragsdatum || ""),
    orderTime: String(row.auftragszeit || ""),
    euroPallets: String(row.euro_paletten || ""),
    storageSpaces: String(row.stellplaetze || ""),
    orderNote: String(row.auftrags_notiz || ""),
    rawText: String(row.rohtext || ""),
    collapseDone: Boolean(row.collapse_done),
    orderType: String(row.auftrags_typ || "picking"),
    orderWarehouse: normalizeOrderWarehouse(row.auftrags_lager),
    createdBy: String(row.erstellt_von || ""),
    lastEditedBy: String(row.zuletzt_bearbeitet_von || ""),
    activeUser: String(row.aktiver_benutzer || ""),
    activeUserAt: String(row.aktiver_benutzer_am || ""),
    acceptedBy: String(row.uebernommen_von || ""),
    acceptedAt: String(row.uebernommen_am || ""),
    completedBy: String(row.abgeschlossen_von || ""),
    completedAt: String(row.abgeschlossen_am || ""),
    exportedAt: String(row.exportiert_am || ""),
    exportedPdfFile: String(row.exportiert_pdf_datei || ""),
    exportedPdfPath: String(row.exportiert_pdf_pfad || ""),
    lines,
    createdAt: String(row.erstellt_am || ""),
    updatedAt: String(row.aktualisiert_am || ""),
  };
}

function normalizeOrderWarehouse(value) {
  return normalizeOptionalWarehouse(value);
}

function normalizeOrderLines(lines) {
  return lines.map((line) => {
    const normalizedToBin = normalizeDestinationName(line?.toBin);
    if (!normalizedToBin || normalizedToBin === line?.toBin) return line;
    return { ...line, toBin: normalizedToBin };
  });
}

function userLookupKey(value) {
  return String(value || "").trim().toLowerCase();
}
