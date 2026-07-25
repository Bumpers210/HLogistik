import { getDb } from "./db.mjs";
import { httpError, normalizeWarehouse } from "./helpers.mjs";
import { readArticlesSync } from "./articles.mjs";
import { normalizeOptionalWarehouse } from "./rules/warehouse-rules.mjs";

// ── Auswertungen / Reporting ────────────────────────────────────────────────
// Alle Berichte sind read-only und basieren auf dem Bewegungs-Ledger
// (lagerbewegung), dem aktuellen Bestand (lagerbestand) sowie dem
// Buchungsfehler-Log (bestandsbuchung_fehler). Mengen sind Stückzahlen.
// "Aktueller Bestand" und "Artikelanzahl" sind Momentaufnahmen (nicht
// zeitraumgebunden); alle übrigen Kennzahlen sind auf den Zeitraum gefiltert.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const BOOKING_EXPORT_COLUMNS = Object.freeze([
  "Buchungsrichtung",
  "Datum/Uhrzeit",
  "Lager",
  "Stellplatz",
  "HU/LE-Nummer",
  "Menge",
  "Referenz",
]);

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Liefert lexikografisch vergleichbare Grenzen für erstellt_am (ISO-UTC).
// Ungültige/leere Werte -> Fallback letzte 90 Tage. Vertauschte Werte werden getauscht.
export function dateBounds(from, to) {
  const today = new Date().toISOString().slice(0, 10);
  const validTo = DATE_RE.test(String(to || "")) ? String(to) : today;
  const validFrom = DATE_RE.test(String(from || "")) ? String(from) : addDays(validTo, -90);
  const fromDate = validFrom <= validTo ? validFrom : validTo;
  const toDate = validFrom <= validTo ? validTo : validFrom;
  return { fromDate, toDate, toExclusiveDate: addDays(toDate, 1) };
}

export function bookingExportDateBounds(from, to) {
  const fromDate = String(from || "").trim();
  const toDate = String(to || "").trim();
  if (!isValidIsoDate(fromDate) || !isValidIsoDate(toDate)) {
    throw httpError(400, "Zeitraum ist ungueltig. Bitte Von und Bis als Datum waehlen.");
  }
  if (fromDate > toDate) {
    throw httpError(400, "Zeitraum ist ungueltig. Von darf nicht nach Bis liegen.");
  }
  return { fromDate, toDate, toExclusiveDate: addDays(toDate, 1) };
}

function isValidIsoDate(value) {
  if (!DATE_RE.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function articleNameMap(warehouse) {
  return new Map(readArticlesSync(warehouse).map((article) => [article.materialnummer, article]));
}

// ── 1. Artikelbewegungen ──────────────────────────────────────────────────────
// Pro Artikel: Entnahmen (Σ Warenausgang), Zugänge (Σ Wareneingang), aktueller Bestand.

export function readBookingExport({ warehouse = "", from = "", to = "" } = {}) {
  const warehouseFilter = normalizeOptionalWarehouse(warehouse);
  const { fromDate, toDate, toExclusiveDate } = bookingExportDateBounds(from, to);
  const movementBaseSql = `SELECT bewegungsart, erstellt_am, lager, lagerplatz, le_nummer, menge_stueck, referenz, materialnummer, umlagerung_id, id
       FROM lagerbewegung
       WHERE erstellt_am >= ? AND erstellt_am < ?`;
  const orderSql = ` ORDER BY erstellt_am ASC, lager ASC, lagerplatz COLLATE NOCASE ASC,
              COALESCE(referenz, '') COLLATE NOCASE ASC, id ASC`;
  const movementRows = warehouseFilter
    ? getDb().prepare(`${movementBaseSql} AND lager = ?${orderSql}`).all(fromDate, toExclusiveDate, warehouseFilter)
    : getDb().prepare(`${movementBaseSql}${orderSql}`).all(fromDate, toExclusiveDate);
  const errorRows = readBookingExportErrorRows({ warehouseFilter, fromDate, toExclusiveDate });
  const items = [
    ...movementRows.map((row) => bookingExportSortRow(bookingExportRow(row), row, 0)),
    ...errorRows.map((row) => bookingExportSortRow(bookingExportErrorRow(row), row, 1))
  ]
    .sort(compareBookingExportRows)
    .map(({ item }) => item);

  return {
    from: fromDate,
    to: toDate,
    warehouse: warehouseFilter,
    fileName: `buchungen-${fromDate}-bis-${toDate}.xlsx`,
    columns: BOOKING_EXPORT_COLUMNS,
    items,
  };
}

function readBookingExportErrorRows({ warehouseFilter, fromDate, toExclusiveDate }) {
  const baseSql = `SELECT fehler.id, fehler.lager, fehler.auftrag_id,
              COALESCE(NULLIF(fehler.auftragsnummer, ''), NULLIF(auftraege.auftragsnummer, '')) AS auftragsnummer,
              fehler.position, fehler.lagerauftrag, fehler.materialnummer,
              fehler.lagerplatz, fehler.le_nummer, fehler.menge, fehler.fehler,
              fehler.exportiert_pdf_datei, fehler.erstellt_am
       FROM bestandsbuchung_fehler AS fehler
       LEFT JOIN auftraege ON auftraege.id = fehler.auftrag_id
       WHERE fehler.erstellt_am >= ? AND fehler.erstellt_am < ?`;
  const orderSql = ` ORDER BY fehler.erstellt_am ASC, fehler.lager ASC, fehler.lagerplatz COLLATE NOCASE ASC,
              COALESCE(NULLIF(fehler.auftragsnummer, ''), NULLIF(auftraege.auftragsnummer, ''), '') COLLATE NOCASE ASC,
              fehler.position ASC, fehler.id ASC`;
  return warehouseFilter
    ? getDb().prepare(`${baseSql} AND fehler.lager = ?${orderSql}`).all(fromDate, toExclusiveDate, warehouseFilter)
    : getDb().prepare(`${baseSql}${orderSql}`).all(fromDate, toExclusiveDate);
}

function bookingExportRow(row) {
  return {
    buchungsrichtung: bookingDirection(row.bewegungsart),
    datumUhrzeit: String(row.erstellt_am || ""),
    lager: String(row.lager || ""),
    stellplatz: String(row.lagerplatz || ""),
    huLeNummer: String(row.le_nummer || ""),
    menge: Number(row.menge_stueck || 0),
    referenz: bookingMovementReference(row),
  };
}

function bookingMovementReference(row) {
  const transferId = String(row.umlagerung_id || "").trim();
  const reference = String(row.referenz || "").trim();
  if (transferId) return `Umlagerung ${transferId}${reference ? ` - ${reference}` : ""}`;
  return reference || String(row.materialnummer || "");
}

function bookingExportErrorRow(row) {
  return {
    buchungsrichtung: "AUS",
    datumUhrzeit: String(row.erstellt_am || ""),
    lager: String(row.lager || ""),
    stellplatz: String(row.lagerplatz || ""),
    huLeNummer: String(row.le_nummer || ""),
    menge: bookingExportQuantity(row.menge),
    referenz: bookingErrorReference(row),
  };
}

function bookingExportQuantity(value) {
  const number = Number(String(value || "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function bookingErrorReference(row) {
  const orderNumber = String(row.auftragsnummer || "").trim();
  if (orderNumber) return `Kommissionierung ${orderNumber}`;
  const orderId = String(row.auftrag_id || "").trim();
  if (orderId) return `Kommissionierung ${orderId}`;
  return String(row.exportiert_pdf_datei || row.materialnummer || "");
}

function bookingExportSortRow(item, row, sourceOrder) {
  return {
    item,
    erstelltAm: String(row.erstellt_am || ""),
    lager: String(row.lager || ""),
    lagerplatz: String(row.lagerplatz || ""),
    referenz: item.referenz,
    sourceOrder,
    id: String(row.id || "")
  };
}

function compareBookingExportRows(a, b) {
  return a.erstelltAm.localeCompare(b.erstelltAm)
    || a.lager.localeCompare(b.lager)
    || a.lagerplatz.localeCompare(b.lagerplatz)
    || a.referenz.localeCompare(b.referenz)
    || a.sourceOrder - b.sourceOrder
    || a.id.localeCompare(b.id);
}

function bookingDirection(value) {
  const text = String(value || "").trim();
  if (text === "Wareneingang") return "EIN";
  if (text === "Warenausgang") return "AUS";
  if (text === "Umlagerung-Ausgang") return "UML-AUS";
  if (text === "Umlagerung-Eingang") return "UML-EIN";
  return "";
}

export function readArticleMovements({ warehouse = "SSI", from = "", to = "" } = {}) {
  const lager = normalizeWarehouse(warehouse);
  const { fromDate, toDate, toExclusiveDate } = dateBounds(from, to);
  const names = articleNameMap(lager);

  const movements = getDb()
    .prepare(
      `SELECT materialnummer,
              SUM(CASE WHEN bewegungsart = 'Warenausgang' THEN menge_stueck ELSE 0 END) AS entnahmen,
              SUM(CASE WHEN bewegungsart = 'Wareneingang' THEN menge_stueck ELSE 0 END) AS zugaenge
       FROM lagerbewegung
       WHERE lager = ? AND erstellt_am >= ? AND erstellt_am < ?
       GROUP BY materialnummer`
    )
    .all(lager, fromDate, toExclusiveDate);

  const stock = getDb()
    .prepare(
      `SELECT materialnummer, SUM(menge_stueck) AS bestand
       FROM lagerbestand WHERE lager = ? GROUP BY materialnummer`
    )
    .all(lager);

  const byMaterial = new Map();
  const ensure = (materialnummer) => {
    if (!byMaterial.has(materialnummer)) {
      byMaterial.set(materialnummer, {
        materialnummer,
        materialbezeichnung: names.get(materialnummer)?.materialbezeichnung || "",
        entnahmen: 0,
        zugaenge: 0,
        bestand: 0,
      });
    }
    return byMaterial.get(materialnummer);
  };

  movements.forEach((row) => {
    const entry = ensure(String(row.materialnummer || ""));
    entry.entnahmen = Number(row.entnahmen || 0);
    entry.zugaenge = Number(row.zugaenge || 0);
  });
  stock.forEach((row) => {
    ensure(String(row.materialnummer || "")).bestand = Number(row.bestand || 0);
  });

  const items = [...byMaterial.values()].sort(
    (a, b) =>
      b.entnahmen + b.zugaenge - (a.entnahmen + a.zugaenge) ||
      a.materialnummer.localeCompare(b.materialnummer)
  );
  return { from: fromDate, to: toDate, items };
}

// ── 2. Top-Artikel (am häufigsten kommissioniert) ──────────────────────────────
// Aus Warenausgang mit Referenz "Kommissionierung {Auftragsnr}".

export function readTopArticles({ warehouse = "SSI", from = "", to = "", limit = 50 } = {}) {
  const lager = normalizeWarehouse(warehouse);
  const { fromDate, toDate, toExclusiveDate } = dateBounds(from, to);
  const safeLimit = Math.min(Math.max(Number.isInteger(limit) && limit > 0 ? limit : 50, 1), 500);
  const names = articleNameMap(lager);

  const rows = getDb()
    .prepare(
      `SELECT materialnummer,
              COUNT(DISTINCT referenz) AS anzahlAuftraege,
              SUM(menge_stueck) AS gesamtmenge
       FROM lagerbewegung
       WHERE lager = ? AND bewegungsart = 'Warenausgang'
         AND referenz LIKE 'Kommissionierung%'
         AND erstellt_am >= ? AND erstellt_am < ?
       GROUP BY materialnummer
       ORDER BY anzahlAuftraege DESC, gesamtmenge DESC
       LIMIT ?`
    )
    .all(lager, fromDate, toExclusiveDate, safeLimit);

  const items = rows.map((row, index) => ({
    rang: index + 1,
    materialnummer: String(row.materialnummer || ""),
    materialbezeichnung: names.get(String(row.materialnummer || ""))?.materialbezeichnung || "",
    anzahlAuftraege: Number(row.anzahlAuftraege || 0),
    gesamtmenge: Number(row.gesamtmenge || 0),
  }));
  return { from: fromDate, to: toDate, items };
}

// ── 3. Langsame Artikel (Ladenhüter) ───────────────────────────────────────────
// Alle aktiven Stammartikel, sortiert nach Entnahmen aufsteigend (nie/selten bewegte zuerst).

export function readSlowArticles({ warehouse = "SSI", from = "", to = "" } = {}) {
  const lager = normalizeWarehouse(warehouse);
  const { fromDate, toDate, toExclusiveDate } = dateBounds(from, to);

  const issues = getDb()
    .prepare(
      `SELECT materialnummer, SUM(menge_stueck) AS entnahmen
       FROM lagerbewegung
       WHERE lager = ? AND bewegungsart = 'Warenausgang' AND erstellt_am >= ? AND erstellt_am < ?
       GROUP BY materialnummer`
    )
    .all(lager, fromDate, toExclusiveDate);
  const entnahmenByMaterial = new Map(issues.map((row) => [String(row.materialnummer || ""), Number(row.entnahmen || 0)]));

  // Letzte Bewegung jeglicher Art (gesamter Verlauf, nicht zeitraumgebunden).
  const lastMoves = getDb()
    .prepare(
      `SELECT materialnummer, MAX(erstellt_am) AS letzteBewegung
       FROM lagerbewegung WHERE lager = ? GROUP BY materialnummer`
    )
    .all(lager);
  const lastMoveByMaterial = new Map(lastMoves.map((row) => [String(row.materialnummer || ""), String(row.letzteBewegung || "")]));

  const stock = getDb()
    .prepare(
      `SELECT materialnummer, SUM(menge_stueck) AS bestand
       FROM lagerbestand WHERE lager = ? GROUP BY materialnummer`
    )
    .all(lager);
  const bestandByMaterial = new Map(stock.map((row) => [String(row.materialnummer || ""), Number(row.bestand || 0)]));

  const items = readArticlesSync(lager)
    .filter((article) => article.aktiv)
    .map((article) => ({
      materialnummer: article.materialnummer,
      materialbezeichnung: article.materialbezeichnung || "",
      entnahmen: entnahmenByMaterial.get(article.materialnummer) || 0,
      letzteBewegung: lastMoveByMaterial.get(article.materialnummer) || "",
      bestand: bestandByMaterial.get(article.materialnummer) || 0,
    }))
    .sort(
      (a, b) =>
        a.entnahmen - b.entnahmen ||
        a.letzteBewegung.localeCompare(b.letzteBewegung) ||
        a.materialnummer.localeCompare(b.materialnummer)
    );
  return { from: fromDate, to: toDate, items };
}

// ── 4. Lagerplatz-Auswertung ────────────────────────────────────────────────────
// Pro Lagerplatz: Entnahmen (Σ Warenausgang), Artikelanzahl (aktuell), Fehlmengen (Anzahl Fehlerlog-Einträge).

export function readLocationUsage({ warehouse = "SSI", from = "", to = "" } = {}) {
  const lager = normalizeWarehouse(warehouse);
  const { fromDate, toDate, toExclusiveDate } = dateBounds(from, to);

  const issues = getDb()
    .prepare(
      `SELECT lagerplatz, SUM(menge_stueck) AS entnahmen
       FROM lagerbewegung
       WHERE lager = ? AND bewegungsart = 'Warenausgang' AND erstellt_am >= ? AND erstellt_am < ?
       GROUP BY lagerplatz`
    )
    .all(lager, fromDate, toExclusiveDate);

  const errors = getDb()
    .prepare(
      `SELECT lagerplatz, COUNT(*) AS fehlmengen
       FROM bestandsbuchung_fehler
       WHERE lager = ? AND erstellt_am >= ? AND erstellt_am < ?
       GROUP BY lagerplatz`
    )
    .all(lager, fromDate, toExclusiveDate);

  const stock = getDb()
    .prepare(
      `SELECT lagerplatz, COUNT(DISTINCT materialnummer) AS artikelanzahl
       FROM lagerbestand
       WHERE lager = ? AND menge_stueck > 0
       GROUP BY lagerplatz`
    )
    .all(lager);

  const byLocation = new Map();
  const ensure = (lagerplatz) => {
    if (!byLocation.has(lagerplatz)) {
      byLocation.set(lagerplatz, { lagerplatz, entnahmen: 0, artikelanzahl: 0, fehlmengen: 0 });
    }
    return byLocation.get(lagerplatz);
  };

  issues.forEach((row) => {
    const key = String(row.lagerplatz || "").trim();
    if (key) ensure(key).entnahmen = Number(row.entnahmen || 0);
  });
  errors.forEach((row) => {
    const key = String(row.lagerplatz || "").trim();
    if (key) ensure(key).fehlmengen = Number(row.fehlmengen || 0);
  });
  stock.forEach((row) => {
    const key = String(row.lagerplatz || "").trim();
    if (key) ensure(key).artikelanzahl = Number(row.artikelanzahl || 0);
  });

  const items = [...byLocation.values()].sort(
    (a, b) => b.entnahmen - a.entnahmen || a.lagerplatz.localeCompare(b.lagerplatz)
  );
  return { from: fromDate, to: toDate, items };
}
