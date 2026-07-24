import { getDb } from "./db.mjs";
import { createHash } from "node:crypto";
import { createStorageId, createStorageMovementId, readInteger, normalizeSearch, normalizeWarehouse, normalizeSsiStorageBin, httpError, withLineContext } from "./helpers.mjs";
import { readArticlesSync, findArticleByCode } from "./articles.mjs";

// ── Locations ─────────────────────────────────────────────────────────────────

export function readStorageLocations({ query = "", materialnummer = "", locationId = "", limit = 0, warehouse = "SSI" } = {}) {
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
  const locationFilter = String(locationId || "").trim();
  const terms = normalizeSearch(query).split(" ").filter(Boolean);

  const filtered = rows.filter((row) => {
    if (locationFilter && row.id !== locationFilter) return false;
    if (materialFilter && row.materialnummer.toLowerCase() !== materialFilter) return false;
    if (!terms.length) return true;
    const haystack = normalizeSearch([row.id, row.artikelId, row.materialnummer, row.barcode, row.materialbezeichnung, row.lagerplatz, row.leNummer].join(" "));
    return terms.every((term) => haystack.includes(term));
  });
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 0;
  return safeLimit ? filtered.slice(0, safeLimit) : filtered;
}

export function readStorageLocationSnapshot({ warehouse = "SSI", offset = 0, limit = 0 } = {}) {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  const capturedAt = new Date().toISOString();
  const allRows = readStorageLocations({ warehouse: normalizedWarehouse }).map((row) => ({
    id: row.id,
    lager: row.lager,
    artikelId: row.artikelId,
    materialnummer: row.materialnummer,
    barcode: row.barcode,
    lagerplatz: row.lagerplatz,
    leNummer: row.leNummer,
    mengeStueck: row.mengeStueck,
    paletten: row.paletten,
    aktualisiertAm: row.aktualisiertAm,
  }));
  const snapshotKey = createHash("sha256").update(JSON.stringify(allRows)).digest("hex");
  const safeOffset = Math.max(0, Number.isInteger(offset) ? offset : 0);
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 0;
  const rows = safeLimit ? allRows.slice(safeOffset, safeOffset + safeLimit) : allRows;
  return {
    warehouse: normalizedWarehouse,
    capturedAt,
    rowCount: allRows.length,
    snapshotKey,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeLimit ? safeOffset + rows.length < allRows.length : false,
    rows,
  };
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
              lagerbewegung.le_nummer, lagerbewegung.referenz, lagerbewegung.umlagerung_id, lagerbewegung.erstellt_am
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
      [row.materialnummer, row.materialbezeichnung, row.bewegungsart, row.lagerplatz, row.leNummer, row.referenz, row.umlagerungId].join(" ")
    );
    return terms.every((term) => haystack.includes(term));
  });
}

// ── Transfers ────────────────────────────────────────────────────────────────

export function readStorageTransfers({ query = "", limit = 100, warehouse = "SSI" } = {}) {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  const articles = readArticlesSync(normalizedWarehouse);
  const articleInfo = new Map(articles.map((article) => [article.materialnummer, article]));
  const safeLimit = Math.min(Math.max(Number.isInteger(limit) && limit > 0 ? limit : 100, 1), 500);
  const rows = getDb()
    .prepare(
      `SELECT id, lager, artikel_id, materialnummer, quell_bestand_id, quell_lagerplatz, quell_le_nummer,
              ziel_bestand_id, ziel_lagerplatz, ziel_le_nummer, menge_stueck, paletten, referenz,
              gebucht_von, quell_aktualisiert_am, erstellt_am
       FROM umlagerung
       WHERE lager = ?
       ORDER BY erstellt_am DESC, id DESC
       LIMIT ?`
    )
    .all(normalizedWarehouse, safeLimit)
    .map((row) => storageTransferFromRow(row, articleInfo));

  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((row) => {
    const haystack = normalizeSearch([
      row.id,
      row.materialnummer,
      row.materialbezeichnung,
      row.quellLagerplatz,
      row.zielLagerplatz,
      row.leNummer,
      row.referenz,
      row.gebuchtVon,
    ].join(" "));
    return terms.every((term) => haystack.includes(term));
  });
}

export function bookStorageTransfer(transfer, warehouse = "SSI") {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  const normalized = normalizeStorageTransfer(transfer, normalizedWarehouse);
  const articles = readArticlesSync(normalizedWarehouse);
  const articleInfo = new Map(articles.map((article) => [article.materialnummer, article]));
  const db = getDb();

  db.exec("BEGIN IMMEDIATE");
  try {
    const existingTransfer = readStorageTransferRow(normalized.id);
    if (existingTransfer) {
      ensureMatchingTransferReplay(existingTransfer, normalized);
      const result = storageTransferResult(existingTransfer, articleInfo, true);
      db.exec("COMMIT");
      return result;
    }

    const source = db
      .prepare(
        `SELECT id, lager, artikel_id, materialnummer, lagerplatz, le_nummer, menge_stueck, paletten, aktualisiert_am
         FROM lagerbestand WHERE id = ? AND lager = ?`
      )
      .get(normalized.sourceLocationId, normalizedWarehouse);
    if (!source || Number(source.menge_stueck || 0) <= 0) {
      throw httpError(409, "Der Quellbestand ist nicht mehr vorhanden oder bereits leer");
    }
    if (
      Number(source.menge_stueck) !== normalized.expectedQuantity ||
      String(source.aktualisiert_am || "") !== normalized.expectedUpdatedAt
    ) {
      throw httpError(409, "Der Quellbestand wurde zwischenzeitlich geaendert. Bitte Bestand neu laden");
    }

    const article = articleInfo.get(String(source.materialnummer || ""));
    if (!article) throw httpError(400, "Artikelnummer ist nicht im Artikelstamm vorhanden");
    const targetBin = normalizeTransferTargetBin(normalized.targetBin, normalizedWarehouse);
    const sourceBin = String(source.lagerplatz || "");
    const handlingUnit = String(source.le_nummer || "");
    if (sourceBin === targetBin) {
      throw httpError(400, "Quell- und Zielstellplatz muessen unterschiedlich sein");
    }

    const totalsBefore = readMaterialStorageTotals(normalizedWarehouse, article.materialnummer);
    const target = db
      .prepare(
        `SELECT id, lager, artikel_id, materialnummer, lagerplatz, le_nummer, menge_stueck, paletten, aktualisiert_am
         FROM lagerbestand
         WHERE lager = ? AND materialnummer = ? AND lagerplatz = ? AND le_nummer = ?`
      )
      .get(normalizedWarehouse, article.materialnummer, targetBin, handlingUnit);
    const now = new Date().toISOString();
    const targetId = String(target?.id || createStorageId());
    const quantity = Number(source.menge_stueck || 0);
    const pallets = Math.max(0, Number(source.paletten || 0));

    db.prepare("UPDATE lagerbestand SET menge_stueck = 0, paletten = 0, aktualisiert_am = ? WHERE id = ?")
      .run(now, source.id);
    if (target) {
      db.prepare(
        "UPDATE lagerbestand SET menge_stueck = menge_stueck + ?, paletten = paletten + ?, aktualisiert_am = ? WHERE id = ?"
      ).run(quantity, pallets, now, target.id);
    } else {
      db.prepare(
        `INSERT INTO lagerbestand
           (id, lager, artikel_id, materialnummer, lagerplatz, le_nummer, menge_stueck, paletten, aktualisiert_am)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(targetId, normalizedWarehouse, article.id, article.materialnummer, targetBin, handlingUnit, quantity, pallets, now);
    }

    db.prepare(
      `INSERT INTO umlagerung
         (id, lager, artikel_id, materialnummer, quell_bestand_id, quell_lagerplatz, quell_le_nummer,
          ziel_bestand_id, ziel_lagerplatz, ziel_le_nummer, menge_stueck, paletten, referenz,
          gebucht_von, quell_aktualisiert_am, erstellt_am)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      normalized.id,
      normalizedWarehouse,
      article.id,
      article.materialnummer,
      source.id,
      sourceBin,
      handlingUnit,
      targetId,
      targetBin,
      handlingUnit,
      quantity,
      pallets,
      normalized.reference,
      normalized.userName,
      normalized.expectedUpdatedAt,
      now
    );

    const movements = [
      insertTransferMovement({
        warehouse: normalizedWarehouse,
        article,
        type: "Umlagerung-Ausgang",
        quantity,
        pallets,
        bin: sourceBin,
        handlingUnit,
        reference: normalized.reference,
        transferId: normalized.id,
        createdAt: now,
      }),
      insertTransferMovement({
        warehouse: normalizedWarehouse,
        article,
        type: "Umlagerung-Eingang",
        quantity,
        pallets,
        bin: targetBin,
        handlingUnit,
        reference: normalized.reference,
        transferId: normalized.id,
        createdAt: now,
      }),
    ];

    const totalsAfter = readMaterialStorageTotals(normalizedWarehouse, article.materialnummer);
    if (totalsAfter.quantity !== totalsBefore.quantity || totalsAfter.pallets !== totalsBefore.pallets) {
      throw httpError(500, "Umlagerung verletzt die Bestandsinvariante");
    }

    const created = readStorageTransferRow(normalized.id);
    const result = storageTransferResult(created, articleInfo, false, movements);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
        const normalized = normalizeStorageReceipt(receipt, normalizedWarehouse);
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
    if (line?.lineType === "loading-slip") return;

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
        const normalized = normalizeStorageIssue(issue, normalizedWarehouse);
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
  if (!material) return { stockDeleted: 0, movementsDeleted: 0, transfersDeleted: 0 };

  const db = getDb();
  db.exec("BEGIN");
  try {
    const stockDeleted = db
      .prepare("DELETE FROM lagerbestand WHERE lager = ? AND materialnummer = ?")
      .run(normalizedWarehouse, material).changes;
    const movementsDeleted = db
      .prepare("DELETE FROM lagerbewegung WHERE lager = ? AND materialnummer = ?")
      .run(normalizedWarehouse, material).changes;
    const transfersDeleted = db
      .prepare("DELETE FROM umlagerung WHERE lager = ? AND materialnummer = ?")
      .run(normalizedWarehouse, material).changes;
    db.exec("COMMIT");
    return { stockDeleted, movementsDeleted, transfersDeleted };
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

function normalizeStorageReceipt(receipt, warehouse = "SSI") {
  const rawLagerplatz = String(receipt.lagerplatz ?? receipt.storageBin ?? "").trim();
  const normalizedLagerplatz = normalizeWarehouse(warehouse) === "SSI"
    ? normalizeSsiStorageBin(rawLagerplatz)
    : rawLagerplatz.toUpperCase();
  if (rawLagerplatz && !normalizedLagerplatz) {
    throw httpError(400, `Stellplatz "${rawLagerplatz}" ist fuer SSI nicht bekannt`);
  }
  const normalized = {
    materialnummer: String(receipt.materialnummer ?? receipt.artikelnummer ?? receipt.articleNumber ?? "").trim(),
    lagerplatz: normalizedLagerplatz || "",
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

function normalizeStorageIssue(issue, warehouse = "SSI") {
  const rawLagerplatz = String(issue.lagerplatz ?? issue.storageBin ?? "").trim();
  const normalizedLagerplatz = normalizeWarehouse(warehouse) === "SSI"
    ? normalizeSsiStorageBin(rawLagerplatz)
    : rawLagerplatz.toUpperCase();
  if (rawLagerplatz && !normalizedLagerplatz) {
    throw httpError(400, `Stellplatz "${rawLagerplatz}" ist fuer SSI nicht bekannt`);
  }
  const normalized = {
    materialnummer: String(
      issue.materialnummer ?? issue.artikelnummer ?? issue.barcode ?? issue.articleNumber ?? ""
    ).trim(),
    lagerplatz: normalizedLagerplatz || "",
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

function normalizeStorageTransfer(transfer, warehouse = "SSI") {
  const source = transfer && typeof transfer === "object" && !Array.isArray(transfer) ? transfer : {};
  const id = String(source.id || source.transferId || "").trim();
  const sourceLocationId = String(source.sourceLocationId || source.quellBestandId || "").trim();
  const expectedQuantity = readInteger(source.expectedQuantity ?? source.erwarteteMenge);
  const expectedUpdatedAt = String(source.expectedUpdatedAt || source.quellAktualisiertAm || "").trim();
  const targetBin = normalizeTransferTargetBin(source.targetBin ?? source.zielLagerplatz, warehouse);
  const reference = String(source.reference ?? source.referenz ?? "").trim();
  const userName = String(source.userName ?? source.mitarbeiter ?? "").trim();

  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(id)) throw httpError(400, "Umlagerungs-ID ist ungueltig");
  if (!sourceLocationId) throw httpError(400, "Quellbestand fehlt");
  if (!Number.isInteger(expectedQuantity) || expectedQuantity <= 0) throw httpError(400, "Erwartete Stueckzahl ist ungueltig");
  if (!expectedUpdatedAt) throw httpError(400, "Quell-Zeitstempel fehlt");
  if (!userName) throw httpError(400, "Mitarbeiter fehlt");
  if (reference.length > 500) throw httpError(400, "Referenz darf maximal 500 Zeichen enthalten");

  return { id, warehouse: normalizeWarehouse(warehouse), sourceLocationId, expectedQuantity, expectedUpdatedAt, targetBin, reference, userName };
}

function normalizeTransferTargetBin(value, warehouse) {
  const raw = String(value || "").trim();
  const normalized = normalizeWarehouse(warehouse) === "SSI" ? normalizeSsiStorageBin(raw) : raw.toUpperCase();
  if (raw && !normalized) throw httpError(400, `Zielstellplatz "${raw}" ist fuer SSI nicht bekannt`);
  if (!normalized) throw httpError(400, "Zielstellplatz fehlt");
  return normalized;
}

function readStorageTransferRow(id) {
  return getDb()
    .prepare(
      `SELECT id, lager, artikel_id, materialnummer, quell_bestand_id, quell_lagerplatz, quell_le_nummer,
              ziel_bestand_id, ziel_lagerplatz, ziel_le_nummer, menge_stueck, paletten, referenz,
              gebucht_von, quell_aktualisiert_am, erstellt_am
       FROM umlagerung WHERE id = ?`
    )
    .get(id);
}

function ensureMatchingTransferReplay(existing, normalized) {
  const matches =
    String(existing.lager || "") === normalized.warehouse &&
    String(existing.quell_bestand_id || "") === normalized.sourceLocationId &&
    Number(existing.menge_stueck || 0) === normalized.expectedQuantity &&
    String(existing.quell_aktualisiert_am || "") === normalized.expectedUpdatedAt &&
    String(existing.ziel_lagerplatz || "") === normalized.targetBin &&
    String(existing.referenz || "") === normalized.reference &&
    String(existing.gebucht_von || "") === normalized.userName;
  if (!matches) throw httpError(409, "Umlagerungs-ID wurde bereits mit anderen Daten verwendet");
}

function readMaterialStorageTotals(warehouse, materialnummer) {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(menge_stueck), 0) AS menge, COALESCE(SUM(paletten), 0) AS paletten
       FROM lagerbestand WHERE lager = ? AND materialnummer = ?`
    )
    .get(warehouse, materialnummer);
  return { quantity: Number(row?.menge || 0), pallets: Number(row?.paletten || 0) };
}

function insertTransferMovement({ warehouse, article, type, quantity, pallets, bin, handlingUnit, reference, transferId, createdAt }) {
  const id = createStorageMovementId();
  getDb().prepare(
    `INSERT INTO lagerbewegung
       (id, lager, artikel_id, materialnummer, bewegungsart, menge_stueck, paletten, lagerplatz,
        le_nummer, referenz, umlagerung_id, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, warehouse, article.id, article.materialnummer, type, quantity, pallets, bin, handlingUnit, reference, transferId, createdAt);
  return {
    id,
    lager: warehouse,
    materialnummer: article.materialnummer,
    materialbezeichnung: article.materialbezeichnung || "",
    bewegungsart: type,
    mengeStueck: quantity,
    paletten: pallets,
    lagerplatz: bin,
    leNummer: handlingUnit,
    referenz: reference,
    umlagerungId: transferId,
    erstelltAm: createdAt,
  };
}

function storageTransferResult(row, articleInfo, replayed, movements = null) {
  const db = getDb();
  const source = db
    .prepare(
      `SELECT id, lager, materialnummer, lagerplatz, le_nummer, menge_stueck, paletten, aktualisiert_am
       FROM lagerbestand WHERE id = ?`
    )
    .get(row.quell_bestand_id);
  const target = db
    .prepare(
      `SELECT id, lager, materialnummer, lagerplatz, le_nummer, menge_stueck, paletten, aktualisiert_am
       FROM lagerbestand WHERE id = ?`
    )
    .get(row.ziel_bestand_id);
  const storedMovements = movements || db
    .prepare(
      `SELECT id, lager, materialnummer, bewegungsart, menge_stueck, paletten, lagerplatz,
              le_nummer, referenz, umlagerung_id, erstellt_am
       FROM lagerbewegung WHERE umlagerung_id = ? ORDER BY erstellt_am, id`
    )
    .all(row.id)
    .map((movement) => storageMovementFromRow(movement, articleInfo));
  return {
    transfer: storageTransferFromRow(row, articleInfo),
    sourceLocation: source ? storageLocationFromRow(source, articleInfo) : null,
    targetLocation: target ? storageLocationFromRow(target, articleInfo) : null,
    movements: storedMovements,
    replayed,
  };
}

function storageLocationFromRow(row, articleInfo = new Map()) {
  const article = articleInfo.get(String(row.materialnummer || "")) || {};
  return {
    id: String(row.id || ""),
    lager: normalizeWarehouse(row.lager),
    artikelId: String(article.id || ""),
    materialnummer: String(row.materialnummer || ""),
    barcode: String(article.barcode || ""),
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
    umlagerungId: String(row.umlagerung_id || ""),
    erstelltAm: String(row.erstellt_am || ""),
  };
}

function storageTransferFromRow(row, articleInfo = new Map()) {
  const article = articleInfo.get(String(row.materialnummer || "")) || {};
  return {
    id: String(row.id || ""),
    lager: normalizeWarehouse(row.lager),
    materialnummer: String(row.materialnummer || ""),
    materialbezeichnung: String(article.materialbezeichnung || ""),
    quellBestandId: String(row.quell_bestand_id || ""),
    quellLagerplatz: String(row.quell_lagerplatz || ""),
    zielBestandId: String(row.ziel_bestand_id || ""),
    zielLagerplatz: String(row.ziel_lagerplatz || ""),
    leNummer: String(row.quell_le_nummer || row.ziel_le_nummer || ""),
    mengeStueck: Number(row.menge_stueck || 0),
    paletten: Math.max(0, Number(row.paletten || 0)),
    referenz: String(row.referenz || ""),
    gebuchtVon: String(row.gebucht_von || ""),
    quellAktualisiertAm: String(row.quell_aktualisiert_am || ""),
    erstelltAm: String(row.erstellt_am || ""),
  };
}
