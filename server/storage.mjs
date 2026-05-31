import { getDb } from "./db.mjs";
import { createStorageId, createStorageMovementId, readInteger, normalizeSearch, httpError, withLineContext } from "./helpers.mjs";
import { readArticlesSync, findArticleByCode } from "./articles.mjs";

// ── Locations ─────────────────────────────────────────────────────────────────

export function readStorageLocations({ query = "", materialnummer = "" } = {}) {
  const rows = getDb()
    .prepare(
      `SELECT lagerbestand.id, lagerbestand.materialnummer, artikel.materialbezeichnung,
              lagerbestand.lagerplatz, lagerbestand.le_nummer, lagerbestand.menge_stueck,
              lagerbestand.aktualisiert_am
       FROM lagerbestand
       LEFT JOIN artikel ON artikel.id = lagerbestand.artikel_id
       WHERE lagerbestand.menge_stueck > 0
       ORDER BY lagerbestand.lagerplatz COLLATE NOCASE, lagerbestand.materialnummer COLLATE NOCASE, lagerbestand.le_nummer COLLATE NOCASE`
    )
    .all()
    .map(storageLocationFromRow);

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

export function readStorageMovements({ query = "", limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number.isInteger(limit) && limit > 0 ? limit : 100, 1), 500);
  const rows = getDb()
    .prepare(
      `SELECT lagerbewegung.id, lagerbewegung.materialnummer, artikel.materialbezeichnung,
              lagerbewegung.bewegungsart, lagerbewegung.menge_stueck, lagerbewegung.lagerplatz,
              lagerbewegung.le_nummer, lagerbewegung.referenz, lagerbewegung.erstellt_am
       FROM lagerbewegung
       LEFT JOIN artikel ON artikel.id = lagerbewegung.artikel_id
       ORDER BY lagerbewegung.erstellt_am DESC
       LIMIT ?`
    )
    .all(safeLimit)
    .map(storageMovementFromRow);

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

export function bookStorageReceipt(receipt) {
  const result = bookStorageReceipts([receipt]);
  return { movement: result.movements[0], location: result.locations[0] };
}

export function bookStorageReceipts(receipts) {
  if (!Array.isArray(receipts) || !receipts.length)
    throw httpError(400, "Mindestens eine Buchungszeile ist erforderlich");

  const articles = readArticlesSync();
  const db = getDb();
  const results = [];

  db.exec("BEGIN");
  try {
    receipts.forEach((receipt, index) => {
      try {
        const normalized = normalizeStorageReceipt(receipt);
        const article = findArticleByCode(articles, normalized.materialnummer);
        if (!article) throw httpError(400, "Artikelnummer ist nicht im Artikelstamm vorhanden");
        results.push(applyStorageReceipt(normalized, article, new Date().toISOString()));
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

function applyStorageReceipt(normalized, article, now) {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, menge_stueck FROM lagerbestand
       WHERE materialnummer = ? AND lagerplatz = ? AND le_nummer = ?`
    )
    .get(article.materialnummer, normalized.lagerplatz, normalized.leNummer);

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
      `INSERT INTO lagerbestand (id, artikel_id, materialnummer, lagerplatz, le_nummer, menge_stueck, aktualisiert_am)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(bestandId, article.id, article.materialnummer, normalized.lagerplatz, normalized.leNummer, normalized.mengeStueck, now);
  }

  db.prepare(
    `INSERT INTO lagerbewegung (id, artikel_id, materialnummer, bewegungsart, menge_stueck, lagerplatz, le_nummer, referenz, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bewegungId,
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
      `SELECT lagerbestand.id, lagerbestand.materialnummer, artikel.materialbezeichnung,
              lagerbestand.lagerplatz, lagerbestand.le_nummer, lagerbestand.menge_stueck, lagerbestand.aktualisiert_am
       FROM lagerbestand LEFT JOIN artikel ON artikel.id = lagerbestand.artikel_id WHERE lagerbestand.id = ?`
    )
    .get(bestandId);

  return {
    movement: {
      id: bewegungId,
      bewegungsart: "Wareneingang",
      materialnummer: article.materialnummer,
      mengeStueck: normalized.mengeStueck,
      lagerplatz: normalized.lagerplatz,
      leNummer: normalized.leNummer,
      referenz: normalized.referenz,
      erstelltAm: now,
    },
    location: storageLocationFromRow(location),
  };
}

// ── Issues ────────────────────────────────────────────────────────────────────

export function bookStorageIssue(issue) {
  const result = bookStorageIssues([issue]);
  return { movement: result.movements[0], location: result.locations[0] };
}

export function bookStorageIssues(issues) {
  if (!Array.isArray(issues) || !issues.length)
    throw httpError(400, "Mindestens eine Buchungszeile ist erforderlich");

  const articles = readArticlesSync();
  const db = getDb();
  const results = [];

  db.exec("BEGIN");
  try {
    issues.forEach((issue, index) => {
      try {
        const normalized = normalizeStorageIssue(issue);
        const article = findArticleByCode(articles, normalized.materialnummer);
        if (!article) throw httpError(400, "Artikelnummer oder Barcode ist nicht im Artikelstamm vorhanden");
        results.push(applyStorageIssue(normalized, article, new Date().toISOString()));
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

function applyStorageIssue(normalized, article, now) {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, menge_stueck FROM lagerbestand
       WHERE materialnummer = ? AND lagerplatz = ? AND le_nummer = ?`
    )
    .get(article.materialnummer, normalized.lagerplatz, normalized.leNummer);

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
    `INSERT INTO lagerbewegung (id, artikel_id, materialnummer, bewegungsart, menge_stueck, lagerplatz, le_nummer, referenz, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bewegungId,
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
      `SELECT lagerbestand.id, lagerbestand.materialnummer, artikel.materialbezeichnung,
              lagerbestand.lagerplatz, lagerbestand.le_nummer, lagerbestand.menge_stueck, lagerbestand.aktualisiert_am
       FROM lagerbestand LEFT JOIN artikel ON artikel.id = lagerbestand.artikel_id WHERE lagerbestand.id = ?`
    )
    .get(existing.id);

  return {
    movement: {
      id: bewegungId,
      bewegungsart: "Warenausgang",
      materialnummer: article.materialnummer,
      mengeStueck: normalized.mengeStueck,
      lagerplatz: normalized.lagerplatz,
      leNummer: normalized.leNummer,
      referenz: normalized.referenz,
      erstelltAm: now,
    },
    location: storageLocationFromRow(location),
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
  if (!normalized.leNummer) throw httpError(400, "LE-Nummer fehlt");
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
  if (!normalized.leNummer) throw httpError(400, "LE-Nummer/HU fehlt");
  if (!Number.isInteger(normalized.mengeStueck) || normalized.mengeStueck <= 0)
    throw httpError(400, "Stückzahl muss größer 0 sein");
  return normalized;
}

// ── Row mapping ───────────────────────────────────────────────────────────────

function storageLocationFromRow(row) {
  return {
    id: String(row.id || ""),
    materialnummer: String(row.materialnummer || ""),
    materialbezeichnung: String(row.materialbezeichnung || ""),
    lagerplatz: String(row.lagerplatz || ""),
    leNummer: String(row.le_nummer || ""),
    mengeStueck: Number(row.menge_stueck || 0),
    aktualisiertAm: String(row.aktualisiert_am || ""),
  };
}

function storageMovementFromRow(row) {
  return {
    id: String(row.id || ""),
    materialnummer: String(row.materialnummer || ""),
    materialbezeichnung: String(row.materialbezeichnung || ""),
    bewegungsart: String(row.bewegungsart || ""),
    mengeStueck: Number(row.menge_stueck || 0),
    lagerplatz: String(row.lagerplatz || ""),
    leNummer: String(row.le_nummer || ""),
    referenz: String(row.referenz || ""),
    erstelltAm: String(row.erstellt_am || ""),
  };
}
