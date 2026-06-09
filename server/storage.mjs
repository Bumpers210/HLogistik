import { getDb } from "./db.mjs";
import { createStorageId, createStorageMovementId, readInteger, normalizeSearch, normalizeWarehouse, httpError, withLineContext } from "./helpers.mjs";
import { readArticlesSync, findArticleByCode } from "./articles.mjs";

// ── Locations ─────────────────────────────────────────────────────────────────

export function readStorageLocations({ query = "", materialnummer = "", warehouse = "SSI" } = {}) {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  const articles = readArticlesSync(normalizedWarehouse);
  const articleInfo = new Map(articles.map((article) => [article.materialnummer, article]));
  const rows = getDb()
    .prepare(
      `SELECT lagerbestand.id, lagerbestand.lager, lagerbestand.materialnummer,
              lagerbestand.lagerplatz, lagerbestand.le_nummer, lagerbestand.menge_stueck,
              lagerbestand.paletten, lagerbestand.aktualisiert_am
       FROM lagerbestand
       WHERE lagerbestand.lager = ? AND lagerbestand.menge_stueck > 0
       ORDER BY lagerbestand.lagerplatz COLLATE NOCASE, lagerbestand.materialnummer COLLATE NOCASE, lagerbestand.le_nummer COLLATE NOCASE`
    )
    .all(normalizedWarehouse)
    .map((row) => storageLocationFromRow(row, articleInfo));

  const materialFilter = String(materialnummer || "").trim().toLowerCase();
  const terms = normalizeSearch(query).split(" ").filter(Boolean);

  return rows.filter((row) => {
    if (materialFilter && row.materialnummer.toLowerCase() !== materialFilter) return false;
    if (!terms.length) return true;
    const haystack = normalizeSearch([row.materialnummer, row.materialbezeichnung, row.lagerplatz, row.leNummer].join(" "));
    return terms.every((term) => haystack.includes(term));
  });
}

// ── Movements ─────────────────────────────────────────────────────────────────

export function readStorageMovements({ query = "", limit = 100, warehouse = "SSI" } = {}) {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  const articles = readArticlesSync(normalizedWarehouse);
  const articleInfo = new Map(articles.map((article) => [article.materialnummer, article]));
  const safeLimit = Math.min(Math.max(Number.isInteger(limit) && limit > 0 ? limit : 100, 1), 500);
  const rows = getDb()
    .prepare(
      `SELECT lagerbewegung.id, lagerbewegung.lager, lagerbewegung.materialnummer,
              lagerbewegung.bewegungsart, lagerbewegung.menge_stueck, lagerbewegung.paletten, lagerbewegung.lagerplatz,
              lagerbewegung.le_nummer, lagerbewegung.referenz, lagerbewegung.erstellt_am
       FROM lagerbewegung
       WHERE lagerbewegung.lager = ?
       ORDER BY lagerbewegung.erstellt_am DESC
       LIMIT ?`
    )
    .all(normalizedWarehouse, safeLimit)
    .map((row) => storageMovementFromRow(row, articleInfo));

  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((row) => {
    const haystack = normalizeSearch(
      [row.materialnummer, row.materialbezeichnung, row.bewegungsart, row.lagerplatz, row.leNummer, row.referenz].join(" ")
    );
    return terms.every((term) => haystack.includes(term));
  });
}

// ── Receipts ──────────────────────────────────────────────────────────────────

export function bookStorageReceipt(receipt, warehouse = "SSI") {
  const result = bookStorageReceipts([receipt], warehouse);
  return { movement: result.movements[0], location: result.locations[0] };
}

export function bookStorageReceipts(receipts, warehouse = "SSI") {
  if (!Array.isArray(receipts) || !receipts.length)
    throw httpError(400, "Mindestens eine Buchungszeile ist erforderlich");

  const normalizedWarehouse = normalizeWarehouse(warehouse);
  const articles = readArticlesSync(normalizedWarehouse);
  const db = getDb();
  const results = [];

  db.exec("BEGIN");
  try {
    receipts.forEach((receipt, index) => {
      try {
        const normalized = normalizeStorageReceipt(receipt);
        const article = findArticleByCode(articles, normalized.materialnummer);
        if (!article) throw httpError(400, "Artikelnummer ist nicht im Artikelstamm vorhanden");
        results.push(applyStorageReceipt(normalized, article, new Date().toISOString(), normalizedWarehouse));
      } catch (error) {
        throw withLineContext(error, index, storageReceiptContext(receipt));
      }
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    movements: results.map((r) => r.movement),
    locations: results.map((r) => r.location),
  };
}

function applyStorageReceipt(normalized, article, now, warehouse) {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, menge_stueck, paletten FROM lagerbestand
       WHERE lager = ? AND materialnummer = ? AND lagerplatz = ? AND le_nummer = ?`
    )
    .get(warehouse, article.materialnummer, normalized.lagerplatz, normalized.leNummer);

  const bestandId = existing?.id || createStorageId();
  const bewegungId = createStorageMovementId();

  if (existing) {
    db.prepare(`UPDATE lagerbestand SET menge_stueck = menge_stueck + ?, paletten = paletten + ?, aktualisiert_am = ? WHERE id = ?`).run(
      normalized.mengeStueck,
      normalized.paletten,
      now,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO lagerbestand (id, lager, artikel_id, materialnummer, lagerplatz, le_nummer, menge_stueck, paletten, aktualisiert_am)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      bestandId,
      warehouse,
      article.id,
      article.materialnummer,
      normalized.lagerplatz,
      normalized.leNummer,
      normalized.mengeStueck,
      normalized.paletten,
      now
    );
  }

  db.prepare(
    `INSERT INTO lagerbewegung (id, lager, artikel_id, materialnummer, bewegungsart, menge_stueck, paletten, lagerplatz, le_nummer, referenz, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bewegungId,
    warehouse,
    article.id,
    article.materialnummer,
    "Wareneingang",
    normalized.mengeStueck,
    normalized.paletten,
    normalized.lagerplatz,
    normalized.leNummer,
    normalized.referenz,
    now
  );

  const location = db
    .prepare(
      `SELECT lagerbestand.id, lagerbestand.lager, lagerbestand.materialnummer,
              lagerbestand.lagerplatz, lagerbestand.le_nummer, lagerbestand.menge_stueck,
              lagerbestand.paletten, lagerbestand.aktualisiert_am
       FROM lagerbestand WHERE lagerbestand.id = ?`
    )
    .get(bestandId);

  return {
    movement: {
      id: bewegungId,
      lager: warehouse,
      bewegungsart: "Wareneingang",
      materialnummer: article.materialnummer,
      mengeStueck: normalized.mengeStueck,
      paletten: normalized.paletten,
      lagerplatz: normalized.lagerplatz,
      leNummer: normalized.leNummer,
      referenz: normalized.referenz,
      erstelltAm: now,
    },
    location: storageLocationFromRow(location, new Map([[article.materialnummer, article]])),
  };
}

// ── Issues ────────────────────────────────────────────────────────────────────

export function bookStorageIssue(issue, warehouse = "SSI") {
  const result = bookStorageIssues([issue], warehouse);
  return { movement: result.movements[0], location: result.locations[0] };
}

export function bookPickingOrderIssues(order, warehouse = "SSI") {
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  const result = { booked: 0, errors: [] };

  lines.forEach((line, index) => {
    const materialnummer = String(line.product || "").trim();
    const lagerplatz = String(line.fromBin || "").trim();
    const quantitySource = line.actualQty !== undefined && line.actualQty !== null && String(line.actualQty).trim() !== ""
      ? line.actualQty
      : line.targetQty;
    const mengeStueck = readPickingQuantity(quantitySource);

    if (!materialnummer || !lagerplatz || mengeStueck <= 0) {
      result.errors.push(pickingIssueError(line, index, "Artikelnummer, Lagerplatz oder Menge fehlt"));
      return;
    }

    try {
      bookPickingIssueIgnoringHandlingUnit({
        materialnummer,
        lagerplatz,
        mengeStueck,
        referenz: `Kommissionierung ${order.orderNumber || order.id || ""}`.trim()
      }, warehouse);
      result.booked += 1;
    } catch (error) {
      result.errors.push(pickingIssueError(line, index, error.message || "Bestand konnte nicht abgebucht werden"));
    }
  });

  return result;
}

export function logPickingIssueErrors(order, stockIssue, exportResult = {}, warehouse = "SSI") {
  const errors = Array.isArray(stockIssue?.errors) ? stockIssue.errors : [];
  if (!errors.length) return [];

  const normalizedWarehouse = normalizeWarehouse(warehouse);
  const now = new Date().toISOString();
  const insert = getDb().prepare(
    `INSERT INTO bestandsbuchung_fehler
       (id, lager, auftrag_id, auftragsnummer, position, lagerauftrag, materialnummer, lagerplatz,
        le_nummer, menge, fehler, exportiert_pdf_datei, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  return errors.map((error) => {
    const entry = {
      id: createStorageMovementId(),
      lager: normalizedWarehouse,
      auftragId: String(order?.id || ""),
      auftragsnummer: String(order?.orderNumber || ""),
      position: Number(error.position || 0),
      lagerauftrag: String(error.warehouseOrder || ""),
      materialnummer: String(error.materialnummer || ""),
      lagerplatz: String(error.lagerplatz || ""),
      leNummer: String(error.leNummer || ""),
      menge: String(error.menge || ""),
      fehler: String(error.message || ""),
      exportiertPdfDatei: String(exportResult.file || ""),
      erstelltAm: now
    };

    insert.run(
      entry.id,
      entry.lager,
      entry.auftragId,
      entry.auftragsnummer,
      entry.position,
      entry.lagerauftrag,
      entry.materialnummer,
      entry.lagerplatz,
      entry.leNummer,
      entry.menge,
      entry.fehler,
      entry.exportiertPdfDatei,
      entry.erstelltAm
    );
    return entry;
  });
}

export function listPickingIssueErrorLog({ warehouse = "SSI", limit = 200, orderId = "", orderNumber = "" } = {}) {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  const where = ["lager = ?"];
  const params = [normalizedWarehouse];

  if (orderId) {
    where.push("auftrag_id = ?");
    params.push(String(orderId));
  }
  if (orderNumber) {
    where.push("auftragsnummer = ?");
    params.push(String(orderNumber));
  }

  return getDb()
    .prepare(
      `SELECT id, lager, auftrag_id, auftragsnummer, position, lagerauftrag, materialnummer,
              lagerplatz, le_nummer, menge, fehler, exportiert_pdf_datei, erstellt_am
       FROM bestandsbuchung_fehler
       WHERE ${where.join(" AND ")}
       ORDER BY erstellt_am DESC, position ASC
       LIMIT ?`
    )
    .all(...params, safeLimit)
    .map((row) => ({
      id: String(row.id || ""),
      lager: String(row.lager || ""),
      auftragId: String(row.auftrag_id || ""),
      auftragsnummer: String(row.auftragsnummer || ""),
      position: Number(row.position || 0),
      lagerauftrag: String(row.lagerauftrag || ""),
      materialnummer: String(row.materialnummer || ""),
      lagerplatz: String(row.lagerplatz || ""),
      leNummer: String(row.le_nummer || ""),
      menge: String(row.menge || ""),
      fehler: String(row.fehler || ""),
      exportiertPdfDatei: String(row.exportiert_pdf_datei || ""),
      erstelltAm: String(row.erstellt_am || "")
    }));
}

function bookPickingIssueIgnoringHandlingUnit(issue, warehouse = "SSI") {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  const articles = readArticlesSync(normalizedWarehouse);
  const article = findArticleByCode(articles, issue.materialnummer);
  if (!article) throw httpError(400, "Artikelnummer ist nicht im Artikelstamm vorhanden");

  const lagerplatz = String(issue.lagerplatz || "").trim().toUpperCase();
  const mengeStueck = readInteger(issue.mengeStueck);
  if (!lagerplatz) throw httpError(400, "Lagerplatz fehlt");
  if (!Number.isInteger(mengeStueck) || mengeStueck <= 0) throw httpError(400, "Stückzahl muss größer 0 sein");

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, le_nummer, menge_stueck, paletten FROM lagerbestand
       WHERE lager = ? AND materialnummer = ? AND lagerplatz = ? AND menge_stueck > 0
       ORDER BY le_nummer COLLATE NOCASE`
    )
    .all(normalizedWarehouse, article.materialnummer, lagerplatz);
  const available = rows.reduce((sum, row) => sum + Number(row.menge_stueck || 0), 0);
  if (available < mengeStueck) throw httpError(400, `Nicht genug Bestand vorhanden. Bestand: ${available} Stück`);

  let remaining = mengeStueck;
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    rows.forEach((row) => {
      if (remaining <= 0) return;
      const current = Number(row.menge_stueck || 0);
      const booked = Math.min(current, remaining);
      const rest = current - booked;
      remaining -= booked;

      const bookedPaletten = rest === 0 ? Number(row.paletten || 0) : 0;
      const restPaletten = rest === 0 ? 0 : Number(row.paletten || 0);
      db.prepare(`UPDATE lagerbestand SET menge_stueck = ?, paletten = ?, aktualisiert_am = ? WHERE id = ?`).run(
        rest,
        restPaletten,
        now,
        row.id
      );
      db.prepare(
        `INSERT INTO lagerbewegung (id, lager, artikel_id, materialnummer, bewegungsart, menge_stueck, paletten, lagerplatz, le_nummer, referenz, erstellt_am)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        createStorageMovementId(),
        normalizedWarehouse,
        article.id,
        article.materialnummer,
        "Warenausgang",
        booked,
        bookedPaletten,
        lagerplatz,
        String(row.le_nummer || ""),
        issue.referenz,
        now
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function pickingIssueError(line, index, message) {
  return {
    position: index + 1,
    warehouseOrder: String(line?.warehouseOrder || ""),
    materialnummer: String(line?.product || ""),
    lagerplatz: String(line?.fromBin || ""),
    leNummer: String(line?.fromHandlingUnit || ""),
    menge: String(line?.actualQty || line?.targetQty || ""),
    message
  };
}

function readPickingQuantity(value) {
  const text = String(value ?? "").trim();
  const multiplier = text.replace(/\s+/g, "").match(/^(\d+)x([\d.,]+)$/i);
  if (multiplier) return readInteger(multiplier[1]) * readInteger(multiplier[2]);
  return readInteger(text);
}

export function bookStorageIssues(issues, warehouse = "SSI") {
  if (!Array.isArray(issues) || !issues.length)
    throw httpError(400, "Mindestens eine Buchungszeile ist erforderlich");

  const normalizedWarehouse = normalizeWarehouse(warehouse);
  const articles = readArticlesSync(normalizedWarehouse);
  const db = getDb();
  const results = [];

  db.exec("BEGIN");
  try {
    issues.forEach((issue, index) => {
      try {
        const normalized = normalizeStorageIssue(issue);
        const article = findArticleByCode(articles, normalized.materialnummer);
        if (!article) throw httpError(400, "Artikelnummer oder Barcode ist nicht im Artikelstamm vorhanden");
        results.push(applyStorageIssue(normalized, article, new Date().toISOString(), normalizedWarehouse));
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
    movements: results.map((r) => r.movement),
    locations: results.map((r) => r.location),
  };
}

export function deleteStorageForMaterial(materialnummer, warehouse = "SSI") {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  const material = String(materialnummer || "").trim();
  if (!material) return { stockDeleted: 0, movementsDeleted: 0 };

  const db = getDb();
  db.exec("BEGIN");
  try {
    const stockDeleted = db
      .prepare("DELETE FROM lagerbestand WHERE lager = ? AND materialnummer = ?")
      .run(normalizedWarehouse, material).changes;
    const movementsDeleted = db
      .prepare("DELETE FROM lagerbewegung WHERE lager = ? AND materialnummer = ?")
      .run(normalizedWarehouse, material).changes;
    db.exec("COMMIT");
    return { stockDeleted, movementsDeleted };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyStorageIssue(normalized, article, now, warehouse) {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, menge_stueck, paletten FROM lagerbestand
       WHERE lager = ? AND materialnummer = ? AND lagerplatz = ? AND le_nummer = ?`
    )
    .get(warehouse, article.materialnummer, normalized.lagerplatz, normalized.leNummer);

  if (!existing) throw httpError(400, "Kein Bestand für diese Kombination aus Artikel, Lagerplatz und LE/HU vorhanden");
  if (Number(existing.menge_stueck) < normalized.mengeStueck) {
    throw httpError(400, `Nicht genug Bestand vorhanden. Bestand: ${existing.menge_stueck} Stück`);
  }

  const bewegungId = createStorageMovementId();
  const restbestand = Number(existing.menge_stueck) - normalized.mengeStueck;
  const bookedPaletten = restbestand === 0 ? Number(existing.paletten || 0) : 0;
  const restPaletten = restbestand === 0 ? 0 : Number(existing.paletten || 0);

  db.prepare(`UPDATE lagerbestand SET menge_stueck = ?, paletten = ?, aktualisiert_am = ? WHERE id = ?`).run(
    restbestand,
    restPaletten,
    now,
    existing.id
  );

  db.prepare(
    `INSERT INTO lagerbewegung (id, lager, artikel_id, materialnummer, bewegungsart, menge_stueck, paletten, lagerplatz, le_nummer, referenz, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bewegungId,
    warehouse,
    article.id,
    article.materialnummer,
    "Warenausgang",
    normalized.mengeStueck,
    bookedPaletten,
    normalized.lagerplatz,
    normalized.leNummer,
    normalized.referenz,
    now
  );

  const location = db
    .prepare(
      `SELECT lagerbestand.id, lagerbestand.lager, lagerbestand.materialnummer,
              lagerbestand.lagerplatz, lagerbestand.le_nummer, lagerbestand.menge_stueck,
              lagerbestand.paletten, lagerbestand.aktualisiert_am
       FROM lagerbestand WHERE lagerbestand.id = ?`
    )
    .get(existing.id);

  return {
    movement: {
      id: bewegungId,
      lager: warehouse,
      bewegungsart: "Warenausgang",
      materialnummer: article.materialnummer,
      mengeStueck: normalized.mengeStueck,
      paletten: bookedPaletten,
      lagerplatz: normalized.lagerplatz,
      leNummer: normalized.leNummer,
      referenz: normalized.referenz,
      erstelltAm: now,
    },
    location: storageLocationFromRow(location, new Map([[article.materialnummer, article]])),
  };
}

// ── Normalization ─────────────────────────────────────────────────────────────

function normalizeStorageReceipt(receipt) {
  const normalized = {
    materialnummer: String(receipt.materialnummer ?? receipt.artikelnummer ?? receipt.articleNumber ?? "").trim(),
    lagerplatz: String(receipt.lagerplatz ?? receipt.storageBin ?? "").trim().toUpperCase(),
    leNummer: String(receipt.leNummer ?? receipt.le_nummer ?? receipt.LE ?? receipt.handlingUnit ?? "").trim(),
    mengeStueck: readInteger(receipt.mengeStueck ?? receipt.menge_stueck ?? receipt.stueckzahl ?? receipt.quantity),
    paletten: readInteger(receipt.paletten ?? receipt.palettenAnzahl ?? receipt.pallets ?? receipt.palletCount),
    referenz: String(receipt.referenz ?? receipt.reference ?? "").trim(),
  };
  if (!normalized.materialnummer) throw httpError(400, "Artikelnummer fehlt");
  if (!normalized.lagerplatz) throw httpError(400, "Lagerplatz fehlt");
  if (!Number.isInteger(normalized.mengeStueck) || normalized.mengeStueck <= 0)
    throw httpError(400, "Stückzahl muss größer 0 sein");
  if (!Number.isInteger(normalized.paletten) || normalized.paletten <= 0) normalized.paletten = 1;
  return normalized;
}

function storageReceiptContext(receipt) {
  const parts = [];
  const file = String(receipt?.importFile || receipt?.datei || "").trim();
  const row = String(receipt?.importRow || receipt?.excelZeile || "").trim();
  const materialnummer = String(receipt?.materialnummer || receipt?.artikelnummer || receipt?.articleNumber || "").trim();
  const lagerplatz = String(receipt?.lagerplatz || receipt?.storageBin || "").trim();
  const leNummer = String(receipt?.leNummer || receipt?.le_nummer || receipt?.LE || receipt?.handlingUnit || "").trim();
  const menge = String(receipt?.mengeStueck || receipt?.menge_stueck || receipt?.stueckzahl || receipt?.quantity || "").trim();

  if (file) parts.push(`Datei ${file}`);
  if (row) parts.push(`Excel-Zeile ${row}`);
  if (materialnummer) parts.push(`Artikel ${materialnummer}`);
  if (lagerplatz) parts.push(`Lagerplatz ${lagerplatz}`);
  if (leNummer) parts.push(`HU ${leNummer}`);
  if (menge) parts.push(`Menge ${menge}`);
  return parts.join(", ");
}

function normalizeStorageIssue(issue) {
  const normalized = {
    materialnummer: String(
      issue.materialnummer ?? issue.artikelnummer ?? issue.barcode ?? issue.articleNumber ?? ""
    ).trim(),
    lagerplatz: String(issue.lagerplatz ?? issue.storageBin ?? "").trim().toUpperCase(),
    leNummer: String(issue.leNummer ?? issue.le_nummer ?? issue.LE ?? issue.hu ?? issue.handlingUnit ?? "").trim(),
    mengeStueck: readInteger(issue.mengeStueck ?? issue.menge_stueck ?? issue.stueckzahl ?? issue.quantity),
    referenz: String(issue.referenz ?? issue.bemerkung ?? issue.reference ?? issue.note ?? "").trim(),
  };
  if (!normalized.materialnummer) throw httpError(400, "Artikelnummer oder Barcode fehlt");
  if (!normalized.lagerplatz) throw httpError(400, "Lagerplatz fehlt");
  if (!Number.isInteger(normalized.mengeStueck) || normalized.mengeStueck <= 0)
    throw httpError(400, "Stückzahl muss größer 0 sein");
  return normalized;
}

// ── Row mapping ───────────────────────────────────────────────────────────────

function storageLocationFromRow(row, articleInfo = new Map()) {
  const article = articleInfo.get(String(row.materialnummer || "")) || {};
  return {
    id: String(row.id || ""),
    lager: normalizeWarehouse(row.lager),
    materialnummer: String(row.materialnummer || ""),
    materialbezeichnung: String(row.materialbezeichnung || article.materialbezeichnung || ""),
    mengeProPalette: Number(article.mengeProPalette || 0),
    lagerplatz: String(row.lagerplatz || ""),
    leNummer: String(row.le_nummer || ""),
    mengeStueck: Number(row.menge_stueck || 0),
    paletten: Math.max(0, Number(row.paletten || 0)),
    aktualisiertAm: String(row.aktualisiert_am || ""),
  };
}

function storageMovementFromRow(row, articleInfo = new Map()) {
  const article = articleInfo.get(String(row.materialnummer || "")) || {};
  return {
    id: String(row.id || ""),
    lager: normalizeWarehouse(row.lager),
    materialnummer: String(row.materialnummer || ""),
    materialbezeichnung: String(row.materialbezeichnung || article.materialbezeichnung || ""),
    bewegungsart: String(row.bewegungsart || ""),
    mengeStueck: Number(row.menge_stueck || 0),
    paletten: Math.max(0, Number(row.paletten || 0)),
    lagerplatz: String(row.lagerplatz || ""),
    leNummer: String(row.le_nummer || ""),
    referenz: String(row.referenz || ""),
    erstelltAm: String(row.erstellt_am || ""),
  };
}
