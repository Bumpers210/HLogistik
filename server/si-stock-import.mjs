import { getArticleDb, getDb } from "./db.mjs";
import { createArticleId, createStorageId, httpError } from "./helpers.mjs";

export const SI_STOCK_IMPORT_SHEET_NAME = "Bestandsdetail";
export const SI_STOCK_REPLACE_CONFIRMATION = "SI-BESTAND ERSETZEN";

const COLUMN_DEFINITIONS = Object.freeze({
  date: ["datum", "bestandsdatum", "stichtag", "stand datum", "buchungsdatum"],
  area: ["bereich", "lagerbereich", "lager", "lagerort", "werk", "mandant"],
  material: ["material", "materialnummer", "artikel", "artikelnummer", "mat nr"],
  description: ["materialbezeichnung", "artikelbezeichnung", "bezeichnung", "beschreibung", "materialtext"],
  quantity: ["menge", "bestand", "bestandsmenge", "verfugbarer bestand", "frei verwendbar", "stuck", "stuckzahl"],
  bin: ["lagerplatz", "stellplatz", "platz", "lagerort platz"],
  le: ["le", "le nummer", "le nr", "lagereinheit", "lagereinheit nummer", "handling unit", "hu"],
  pallets: ["paletten", "palette", "pal", "anzahl paletten"],
  unit: ["einheit", "mengeneinheit", "basismengeneinheit", "me"]
});

const REQUIRED_COLUMNS = Object.freeze(["date", "area", "material", "description", "quantity", "bin", "le"]);

export function previewSiStockImportRows(input = {}) {
  const sheetName = String(input.sheetName || "").trim();
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const fileName = String(input.fileName || "").trim();
  const warnings = [];
  const hardErrors = [];
  const ignoredRows = [];

  if (sheetName.toLocaleLowerCase("de") !== SI_STOCK_IMPORT_SHEET_NAME.toLocaleLowerCase("de")) {
    hardErrors.push(issue(0, "sheet", `Tabellenblatt ${SI_STOCK_IMPORT_SHEET_NAME} fehlt.`));
  }

  const header = findSiStockHeader(rows);
  if (header.index < 0 || header.missing.length) {
    hardErrors.push(issue(
      header.index < 0 ? 0 : header.index + 1,
      "columns",
      `Pflichtspalten fehlen: ${(header.missing.length ? header.missing : REQUIRED_COLUMNS).map(columnLabel).join(", ")}.`
    ));
  }

  const parsedRows = [];
  let nonEmptyDataRows = 0;
  if (header.index >= 0) {
    rows.slice(header.index + 1).forEach((row, offset) => {
      const rowNumber = header.index + offset + 2;
      const cells = Array.isArray(row) ? row : [];
      if (isEmptyRow(cells)) {
        ignoredRows.push({ rowNumber, reason: "Leerzeile" });
        return;
      }
      nonEmptyDataRows += 1;
      if (isSummaryRow(cells)) {
        ignoredRows.push({ rowNumber, reason: "Summen-/Pruefzeile" });
        return;
      }
      const validation = validateSiStockEntry(entryFromRow(cells, header.columns, rowNumber));
      warnings.push(...validation.warnings);
      if (validation.errors.length) {
        hardErrors.push(...validation.errors);
        return;
      }
      parsedRows.push(validation.entry);
    });
  }

  const duplicateResult = discardExactNonEmptyLeDuplicates(parsedRows);
  warnings.push(...duplicateResult.warnings);
  hardErrors.push(...duplicateResult.hardErrors);
  const mergeResult = mergeEmptyLeStockGroups(duplicateResult.rows);
  warnings.push(...mergeResult.warnings);
  hardErrors.push(...mergeResult.hardErrors);
  const articleResult = buildSiImportArticles(mergeResult.rows, fileName);
  hardErrors.push(...articleResult.hardErrors);

  const stockRows = mergeResult.rows;
  if (!stockRows.length && !hardErrors.length) {
    hardErrors.push(issue(0, "rows", "Keine importierbaren SI-Bestandszeilen gefunden."));
  }

  const counts = {
    worksheetRows: rows.length,
    nonEmptyDataRows,
    validSourceRows: parsedRows.length,
    importStockRows: stockRows.length,
    importArticles: articleResult.articles.length,
    ignoredRows: ignoredRows.length,
    warnings: warnings.length,
    hardErrors: hardErrors.length,
    discardedExactDuplicates: duplicateResult.discardedExactDuplicates.length,
    mergedEmptyLeGroups: mergeResult.mergedEmptyLeGroups.length
  };

  return {
    ok: hardErrors.length === 0 && stockRows.length > 0,
    fileName,
    sheetName,
    headerRow: header.index + 1,
    columns: header.columns,
    counts,
    warnings,
    hardErrors,
    ignoredRows,
    discardedExactDuplicates: duplicateResult.discardedExactDuplicates,
    mergedEmptyLeGroups: mergeResult.mergedEmptyLeGroups,
    articles: articleResult.articles,
    rows: stockRows,
    stockRows
  };
}

export function replaceSiStockImportRows(input = {}, options = {}) {
  const confirmation = String(options.confirmation ?? input.confirmation ?? "").trim();
  if (confirmation !== SI_STOCK_REPLACE_CONFIRMATION) {
    throw httpError(400, `Bestaetigung muss exakt ${SI_STOCK_REPLACE_CONFIRMATION} lauten.`);
  }

  const preview = previewSiStockImportRows(input);
  if (!preview.ok) {
    throw httpError(400, `SI-Bestandsersatz abgebrochen: ${preview.hardErrors[0]?.message || "Vorschau enthaelt Fehler."}`);
  }

  const db = getDb();
  const siArticleDb = getArticleDb("SI");
  const siArticleFile = articleDatabaseFile(siArticleDb);
  if (!siArticleFile) throw httpError(500, "SI-Artikel-Datenbankpfad konnte nicht ermittelt werden.");

  const alias = "si_import_articles";
  let attached = false;
  let transactionOpen = false;
  const articleIds = new Map(preview.articles.map((article) => [article.materialnummer, createArticleId()]));
  const now = new Date().toISOString();
  let before = null;
  let after = null;

  try {
    db.prepare(`ATTACH DATABASE ? AS ${alias}`).run(siArticleFile);
    attached = true;
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    db.exec(`
      CREATE TEMP TABLE si_import_article_stage AS SELECT * FROM ${alias}.artikel WHERE 0;
      CREATE TEMP TABLE si_import_stock_stage AS SELECT * FROM main.lagerbestand WHERE 0;
    `);

    const insertArticleStage = db.prepare(
      `INSERT INTO temp.si_import_article_stage
       (id, materialnummer, materialbezeichnung, gebinde_art, menge_pro_karton, menge_pro_palette,
        barcode, lagerplatz, artikelgruppe, bemerkung, aktiv, erstellt_am, geaendert_am)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    preview.articles.forEach((article) => {
      insertArticleStage.run(
        articleIds.get(article.materialnummer), article.materialnummer, article.materialbezeichnung,
        article.gebindeArt, article.mengeProKarton, article.mengeProPalette, article.barcode,
        article.lagerplatz, article.artikelgruppe, article.bemerkung, 1, now, now
      );
    });

    const insertStockStage = db.prepare(
      `INSERT INTO temp.si_import_stock_stage
       (id, lager, artikel_id, materialnummer, lagerplatz, le_nummer, menge_stueck, paletten, aktualisiert_am)
       VALUES (?, 'SI', ?, ?, ?, ?, ?, ?, ?)`
    );
    preview.stockRows.forEach((row) => {
      insertStockStage.run(
        createStorageId(), articleIds.get(row.materialnummer), row.materialnummer, row.lagerplatz,
        row.leNummer, row.mengeStueck, row.paletten, now
      );
    });

    assertCount(db, "temp.si_import_article_stage", preview.articles.length, "Artikel-Staging");
    assertCount(db, "temp.si_import_stock_stage", preview.stockRows.length, "Bestands-Staging");
    before = replacementCounts(db, alias);

    db.exec(`
      DELETE FROM ${alias}.artikel;
      DELETE FROM main.lagerbestand WHERE lager = 'SI';
      INSERT INTO ${alias}.artikel SELECT * FROM temp.si_import_article_stage;
      INSERT INTO main.lagerbestand SELECT * FROM temp.si_import_stock_stage;
    `);

    after = replacementCounts(db, alias);
    if (after.siArticles !== preview.articles.length || after.siStock !== preview.stockRows.length) {
      throw new Error("SI-Ersatzzaehlung stimmt nicht mit dem Staging ueberein.");
    }
    assertProtectedCounts(before, after);
    db.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try { db.exec("ROLLBACK"); } catch { /* Originalfehler bleibt massgeblich. */ }
    }
    if (error?.statusCode) throw error;
    throw httpError(500, `SI-Bestandsersatz wurde zurueckgerollt: ${error?.message || error}`);
  } finally {
    try { db.exec("DROP TABLE IF EXISTS temp.si_import_stock_stage; DROP TABLE IF EXISTS temp.si_import_article_stage;"); } catch { /* Temp-Schema endet spaetestens mit dem Prozess. */ }
    if (attached) {
      try { db.exec(`DETACH DATABASE ${alias}`); } catch { /* Kein Einfluss auf die abgeschlossene Transaktion. */ }
    }
  }

  return {
    ok: true,
    confirmation,
    counts: preview.counts,
    replaced: { articles: preview.articles.length, stockRows: preview.stockRows.length },
    before,
    after,
    warnings: preview.warnings,
    discardedExactDuplicates: preview.discardedExactDuplicates,
    mergedEmptyLeGroups: preview.mergedEmptyLeGroups
  };
}

export function detectSiStockColumns(headerRow) {
  const normalized = (Array.isArray(headerRow) ? headerRow : []).map(normalizeHeader);
  const columns = {};
  Object.entries(COLUMN_DEFINITIONS).forEach(([key, aliases]) => {
    columns[key] = normalized.findIndex((header) => aliases.includes(header));
  });
  const missing = REQUIRED_COLUMNS.filter((key) => columns[key] < 0);
  return { columns, missing, matched: Object.values(columns).filter((index) => index >= 0).length };
}

export function validateSiStockEntry(entry) {
  const errors = [];
  const warnings = [];
  if (!entry.bestandsdatum) errors.push(issue(entry.rowNumber, "date", "Bestandsdatum fehlt."));
  if (!isSiArea(entry.bereich)) errors.push(issue(entry.rowNumber, "area", "Bereich ist nicht eindeutig SI."));
  if (!entry.materialnummer) errors.push(issue(entry.rowNumber, "material", "Materialnummer fehlt."));
  if (!entry.materialbezeichnung) errors.push(issue(entry.rowNumber, "description", "Materialbezeichnung fehlt."));
  if (!Number.isInteger(entry.mengeStueck) || entry.mengeStueck <= 0) errors.push(issue(entry.rowNumber, "quantity", "Menge muss eine positive ganze Zahl sein."));
  if (!entry.lagerplatz) errors.push(issue(entry.rowNumber, "bin", "Lagerplatz fehlt."));
  if (!Number.isInteger(entry.paletten) || entry.paletten < 0) errors.push(issue(entry.rowNumber, "pallets", "Palettenzahl muss eine nichtnegative ganze Zahl sein."));
  if (!entry.leNummer) {
    warnings.push(issue(entry.rowNumber, "missing-le", "Lagereinheit fehlt; Zeile bleibt importierbar."));
  } else if (!/^\d+$/.test(entry.leNummer)) {
    warnings.push(issue(entry.rowNumber, "unusual-le", "Ungewoehnliche Lagereinheit bleibt unveraendert."));
  }
  return { entry, errors, warnings };
}

export function discardExactNonEmptyLeDuplicates(entries) {
  const rows = [];
  const discardedExactDuplicates = [];
  const hardErrors = [];
  const warnings = [];
  const exactByKey = new Map();
  const identityByKey = new Map();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry.leNummer) {
      rows.push(entry);
      return;
    }
    const identityKey = stockIdentityKey(entry);
    const exactKey = exactStockKey(entry);
    const exact = exactByKey.get(exactKey);
    if (exact) {
      const discarded = {
        rowNumber: entry.rowNumber,
        keptRowNumber: exact.rowNumber,
        materialnummer: entry.materialnummer,
        lagerplatz: entry.lagerplatz,
        leNummer: entry.leNummer
      };
      discardedExactDuplicates.push(discarded);
      warnings.push(issue(entry.rowNumber, "exact-duplicate", `Exakte LE-Dublette verworfen; Zeile ${exact.rowNumber} bleibt.`));
      return;
    }
    const identity = identityByKey.get(identityKey);
    if (identity) {
      hardErrors.push(issue(entry.rowNumber, "conflicting-le", `Widerspruechliche LE-Dublette zu Zeile ${identity.rowNumber}.`));
    } else {
      identityByKey.set(identityKey, entry);
    }
    exactByKey.set(exactKey, entry);
    rows.push(entry);
  });

  return { rows, discardedExactDuplicates, hardErrors, warnings };
}

export function mergeEmptyLeStockGroups(entries) {
  const output = [];
  const groups = new Map();
  const mergedEmptyLeGroups = [];
  const hardErrors = [];
  const warnings = [];

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (entry.leNummer) {
      output.push(entry);
      return;
    }
    const key = `${entry.materialnummer}\u0000${entry.lagerplatz}`;
    const group = groups.get(key);
    if (!group) {
      const copy = { ...entry, sourceRows: [entry.rowNumber] };
      groups.set(key, copy);
      output.push(copy);
      return;
    }
    if (emptyLeStructureKey(group) !== emptyLeStructureKey(entry)) {
      hardErrors.push(issue(entry.rowNumber, "conflicting-empty-le", `Leer-LE-Gruppe widerspricht Zeile ${group.rowNumber}.`));
      output.push(entry);
      return;
    }
    group.mengeStueck += entry.mengeStueck;
    group.paletten += entry.paletten;
    group.sourceRows.push(entry.rowNumber);
  });

  for (const group of groups.values()) {
    if (group.sourceRows.length < 2) continue;
    const detail = {
      materialnummer: group.materialnummer,
      lagerplatz: group.lagerplatz,
      sourceRows: group.sourceRows.slice(),
      mengeStueck: group.mengeStueck,
      paletten: group.paletten
    };
    mergedEmptyLeGroups.push(detail);
    warnings.push(issue(group.rowNumber, "merged-empty-le", `Leer-LE-Zeilen ${group.sourceRows.join(", ")} wurden zusammengefasst.`));
  }

  return { rows: output, mergedEmptyLeGroups, hardErrors, warnings };
}

export function normalizeLeText(value) {
  return String(value == null ? "" : value).trim();
}

export function normalizeSiStorageBin(value) {
  return String(value == null ? "" : value).trim().toUpperCase().replace(/\s+/g, " ");
}

function findSiStockHeader(rows) {
  let best = { index: -1, columns: {}, missing: REQUIRED_COLUMNS.slice(), matched: 0 };
  (Array.isArray(rows) ? rows : []).slice(0, 50).forEach((row, index) => {
    const detected = detectSiStockColumns(row);
    if (detected.matched > best.matched) best = { index, ...detected };
  });
  return best;
}

function entryFromRow(row, columns, rowNumber) {
  const quantity = positiveInteger(cell(row, columns.quantity));
  const rawPallets = columns.pallets >= 0 ? cell(row, columns.pallets) : "";
  const pallets = String(rawPallets).trim() === "" ? 1 : nonNegativeInteger(rawPallets);
  return {
    rowNumber,
    sourceRows: [rowNumber],
    bestandsdatum: String(cell(row, columns.date)).trim(),
    bereich: String(cell(row, columns.area)).trim(),
    materialnummer: String(cell(row, columns.material)).trim(),
    materialbezeichnung: String(cell(row, columns.description)).trim(),
    mengeStueck: quantity,
    lagerplatz: normalizeSiStorageBin(cell(row, columns.bin)),
    leNummer: normalizeLeText(cell(row, columns.le)),
    paletten: pallets,
    einheit: columns.unit >= 0 ? String(cell(row, columns.unit)).trim() : ""
  };
}

function buildSiImportArticles(stockRows, fileName) {
  const byMaterial = new Map();
  const hardErrors = [];
  (Array.isArray(stockRows) ? stockRows : []).forEach((row) => {
    const existing = byMaterial.get(row.materialnummer);
    if (existing && normalizeComparable(existing.materialbezeichnung) !== normalizeComparable(row.materialbezeichnung)) {
      hardErrors.push(issue(row.rowNumber, "article-conflict", `Material ${row.materialnummer} hat widerspruechliche Bezeichnungen.`));
      return;
    }
    if (!existing) byMaterial.set(row.materialnummer, row);
  });

  const articles = [...byMaterial.values()].map((row) => {
    const bins = [...new Set(stockRows.filter((entry) => entry.materialnummer === row.materialnummer).map((entry) => entry.lagerplatz))];
    return {
      materialnummer: row.materialnummer,
      materialbezeichnung: row.materialbezeichnung,
      gebindeArt: "STK",
      mengeProKarton: 0,
      mengeProPalette: 0,
      barcode: "",
      lagerplatz: bins.length === 1 ? bins[0] : "",
      artikelgruppe: "SI-Bestand",
      bemerkung: `Import ${fileName || SI_STOCK_IMPORT_SHEET_NAME}`,
      aktiv: true
    };
  });
  return { articles, hardErrors };
}

function replacementCounts(db, articleAlias) {
  return {
    siArticles: count(db, `${articleAlias}.artikel`),
    siStock: Number(db.prepare("SELECT COUNT(*) AS count FROM main.lagerbestand WHERE lager = 'SI'").get().count),
    ssiStock: Number(db.prepare("SELECT COUNT(*) AS count FROM main.lagerbestand WHERE lager = 'SSI'").get().count),
    orders: count(db, "main.auftraege"),
    movements: count(db, "main.lagerbewegung"),
    issueErrors: count(db, "main.bestandsbuchung_fehler"),
    ssiArticles: Number(getArticleDb("SSI").prepare("SELECT COUNT(*) AS count FROM artikel").get().count)
  };
}

function assertProtectedCounts(before, after) {
  for (const key of ["ssiStock", "orders", "movements", "issueErrors", "ssiArticles"]) {
    if (before[key] !== after[key]) throw new Error(`Geschuetzte Zaehlung ${key} hat sich geaendert.`);
  }
}

function assertCount(db, table, expected, label) {
  if (count(db, table) !== expected) throw new Error(`${label}-Zaehlung ist unvollstaendig.`);
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

function articleDatabaseFile(db) {
  return String(db.prepare("PRAGMA database_list").all().find((entry) => entry.name === "main")?.file || "");
}

function stockIdentityKey(entry) {
  return [entry.materialnummer, entry.lagerplatz, entry.leNummer].join("\u0000");
}

function exactStockKey(entry) {
  return JSON.stringify([
    entry.materialnummer, entry.materialbezeichnung, entry.mengeStueck, entry.lagerplatz,
    entry.leNummer, entry.paletten, entry.bestandsdatum, entry.bereich, entry.einheit
  ]);
}

function emptyLeStructureKey(entry) {
  return JSON.stringify([entry.materialbezeichnung, entry.bestandsdatum, normalizeComparable(entry.bereich), entry.einheit]);
}

function isSiArea(value) {
  const normalized = normalizeComparable(value).replace(/\s+/g, "");
  return Boolean(normalized && !normalized.includes("ssi") && (normalized === "si" || normalized.startsWith("si-") || normalized.startsWith("si/") || normalized.includes("schwaninternational")));
}

function positiveInteger(value) {
  const number = integerValue(value);
  return Number.isInteger(number) && number > 0 ? number : NaN;
}

function nonNegativeInteger(value) {
  const number = integerValue(value);
  return Number.isInteger(number) && number >= 0 ? number : NaN;
}

function integerValue(value) {
  if (typeof value === "number") return Number.isInteger(value) ? value : NaN;
  const text = String(value == null ? "" : value).trim().replace(/\s+/g, "");
  if (!text) return NaN;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, ""));
  return /^\d+$/.test(text) ? Number(text) : NaN;
}

function normalizeHeader(value) {
  return normalizeComparable(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeComparable(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isEmptyRow(row) {
  return !row.some((value) => String(value == null ? "" : value).trim());
}

function isSummaryRow(row) {
  const text = row.map((value) => String(value == null ? "" : value)).join(" ").trim();
  return /^(?:gesamt|summe|pruefung|kontrolle)\b/i.test(normalizeComparable(text));
}

function cell(row, index) {
  return index >= 0 ? row[index] ?? "" : "";
}

function issue(rowNumber, code, message) {
  return { rowNumber: Number(rowNumber || 0), code, message };
}

function columnLabel(key) {
  return ({
    date: "Datum",
    area: "Bereich",
    material: "Material",
    description: "Bezeichnung",
    quantity: "Menge",
    bin: "Lagerplatz",
    le: "LE"
  })[key] || key;
}
