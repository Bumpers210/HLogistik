import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { getDb } from "./db.mjs";
import { createId } from "./helpers.mjs";

// ── SQLite CRUD ───────────────────────────────────────────────────────────────

export function readOrders() {
  return getDb()
    .prepare(
      `SELECT id, auftragsnummer, kundenname, auftragsdatum, euro_paletten, stellplaetze,
              auftrags_notiz, rohtext, collapse_done, auftrags_typ, erstellt_von,
              zuletzt_bearbeitet_von, aktiver_benutzer, aktiver_benutzer_am,
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
      `SELECT id, auftragsnummer, kundenname, auftragsdatum, euro_paletten, stellplaetze,
              auftrags_notiz, rohtext, collapse_done, auftrags_typ, erstellt_von,
              zuletzt_bearbeitet_von, aktiver_benutzer, aktiver_benutzer_am,
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
         (id, auftragsnummer, kundenname, auftragsdatum, euro_paletten, stellplaetze,
          auftrags_notiz, rohtext, collapse_done, auftrags_typ, erstellt_von,
          zuletzt_bearbeitet_von, aktiver_benutzer, aktiver_benutzer_am,
          abgeschlossen_von, abgeschlossen_am, exportiert_am, exportiert_pdf_datei,
          exportiert_pdf_pfad, positionen, erstellt_am, aktualisiert_am)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         auftragsnummer = excluded.auftragsnummer,
         kundenname = excluded.kundenname,
         auftragsdatum = excluded.auftragsdatum,
         euro_paletten = excluded.euro_paletten,
         stellplaetze = excluded.stellplaetze,
         auftrags_notiz = excluded.auftrags_notiz,
         rohtext = excluded.rohtext,
         collapse_done = excluded.collapse_done,
         auftrags_typ = excluded.auftrags_typ,
         erstellt_von = excluded.erstellt_von,
         zuletzt_bearbeitet_von = excluded.zuletzt_bearbeitet_von,
         aktiver_benutzer = excluded.aktiver_benutzer,
         aktiver_benutzer_am = excluded.aktiver_benutzer_am,
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
      order.orderDate,
      order.euroPallets,
      order.storageSpaces,
      order.orderNote,
      order.rawText,
      order.collapseDone ? 1 : 0,
      order.orderType,
      order.createdBy,
      order.lastEditedBy,
      order.activeUser,
      order.activeUserAt,
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
    updatedAt: order.updatedAt || "",
  };
}

export function orderSummary(order) {
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
    orderDate: String(row.auftragsdatum || ""),
    euroPallets: String(row.euro_paletten || ""),
    storageSpaces: String(row.stellplaetze || ""),
    orderNote: String(row.auftrags_notiz || ""),
    rawText: String(row.rohtext || ""),
    collapseDone: Boolean(row.collapse_done),
    orderType: String(row.auftrags_typ || "picking"),
    createdBy: String(row.erstellt_von || ""),
    lastEditedBy: String(row.zuletzt_bearbeitet_von || ""),
    activeUser: String(row.aktiver_benutzer || ""),
    activeUserAt: String(row.aktiver_benutzer_am || ""),
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
