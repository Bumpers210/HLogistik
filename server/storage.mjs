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
              lagerbestand.aktualisiert_am
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
              lagerbewegung.bewegungsart, lagerbewegung.menge_stueck, lagerbewegung.lagerplatz,
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

function applyStorageReceipt(normalized, article, now, warehouse) {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, menge_stueck FROM lagerbestand
       WHERE lager = ? AND materialnummer = ? AND lagerplatz = ? AND le_nummer = ?`
    )
    .get(warehouse, article.materialnummer, normalized.lagerplatz, normalized.leNummer);

  const bestandId = existing?.id || createStorageId();
  const bewegungId = createStorageMovementId();

  if (existing) {
    db.prepare(`UPDATE lagerbestand SET menge_stueck = menge_stueck + ?, aktualisiert_am = ? WHERE id = ?`).run(
      normalized.mengeStueck,
      now,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO lagerbestand (id, lager, artikel_id, materialnummer, lagerplatz, le_nummer, menge_stueck, aktualisiert_am)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(bestandId, warehouse, article.id, article.materialnummer, normalized.lagerplatz, normalized.leNummer, normalized.mengeStueck, now);
  }

  db.prepare(
    `INSERT INTO lagerbewegung (id, lager, artikel_id, materialnummer, bewegungsart, menge_stueck, lagerplatz, le_nummer, referenz, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bewegungId,
    warehouse,
    article.id,
    article.materialnummer,
    "Wareneingang",
    normalized.mengeStueck,
    normalized.lagerplatz,
    normalized.leNummer,
    normalized.referenz,
    now
  );

  const location = db
    .prepare(
      `SELECT lagerbestand.id, lagerbestand.lager, lagerbestand.materialnummer,
              lagerbestand.lagerplatz, lagerbestand.le_nummer, lagerbestand.menge_stueck, lagerbestand.aktualisiert_am
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
      `SELECT id, menge_stueck FROM lagerbestand
       WHERE lager = ? AND materialnummer = ? AND lagerplatz = ? AND le_nummer = ?`
    )
    .get(warehouse, article.materialnummer, normalized.lagerplatz, normalized.leNummer);

  if (!existing) throw httpError(400, "Kein Bestand für diese Kombination aus Artikel, Lagerplatz und LE/HU vorhanden");
  if (Number(existing.menge_stueck) < normalized.mengeStueck) {
    throw httpError(400, `Nicht genug Bestand vorhanden. Bestand: ${existing.menge_stueck} Stück`);
  }

  const bewegungId = createStorageMovementId();
  const restbestand = Number(existing.menge_stueck) - normalized.mengeStueck;

  db.prepare(`UPDATE lagerbestand SET menge_stueck = ?, aktualisiert_am = ? WHERE id = ?`).run(
    restbestand,
    now,
    existing.id
  );

  db.prepare(
    `INSERT INTO lagerbewegung (id, lager, artikel_id, materialnummer, bewegungsart, menge_stueck, lagerplatz, le_nummer, referenz, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bewegungId,
    warehouse,
    article.id,
    article.materialnummer,
    "Warenausgang",
    normalized.mengeStueck,
    normalized.lagerplatz,
    normalized.leNummer,
    normalized.referenz,
    now
  );

  const location = db
    .prepare(
      `SELECT lagerbestand.id, lagerbestand.lager, lagerbestand.materialnummer,
              lagerbestand.lagerplatz, lagerbestand.le_nummer, lagerbestand.menge_stueck, lagerbestand.aktualisiert_am
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
    referenz: String(receipt.referenz ?? receipt.reference ?? "").trim(),
  };
  if (!normalized.materialnummer) throw httpError(400, "Artikelnummer fehlt");
  if (!normalized.lagerplatz) throw httpError(400, "Lagerplatz fehlt");
  if (!Number.isInteger(normalized.mengeStueck) || normalized.mengeStueck <= 0)
    throw httpError(400, "Stückzahl muss größer 0 sein");
  return normalized;
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
    lagerplatz: String(row.lagerplatz || ""),
    leNummer: String(row.le_nummer || ""),
    referenz: String(row.referenz || ""),
    erstelltAm: String(row.erstellt_am || ""),
  };
}
