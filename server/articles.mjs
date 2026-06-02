import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { getArticleDb, getDb } from "./db.mjs";
import { createArticleId, readInteger, readBoolean, normalizeSearch, csvCell } from "./helpers.mjs";

// ── Read / write ──────────────────────────────────────────────────────────────

export async function readArticles(warehouse = "SSI") {
  return getArticleDb(warehouse)
    .prepare(
      `SELECT id, materialnummer, materialbezeichnung, gebinde_art, menge_pro_karton,
              menge_pro_palette, barcode, lagerplatz, artikelgruppe, bemerkung,
              aktiv, erstellt_am, geaendert_am FROM artikel`
    )
    .all()
    .map(articleFromRow);
}

export function readArticlesSync(warehouse = "SSI") {
  return getArticleDb(warehouse)
    .prepare(
      `SELECT id, materialnummer, materialbezeichnung, gebinde_art, menge_pro_karton,
              menge_pro_palette, barcode, lagerplatz, artikelgruppe, bemerkung,
              aktiv, erstellt_am, geaendert_am FROM artikel`
    )
    .all()
    .map(articleFromRow);
}

export async function writeArticles(articles, warehouse = "SSI") {
  const db = getArticleDb(warehouse);
  const insert = db.prepare(
    `INSERT INTO artikel (id, materialnummer, materialbezeichnung, gebinde_art, menge_pro_karton,
       menge_pro_palette, barcode, lagerplatz, artikelgruppe, bemerkung, aktiv, erstellt_am, geaendert_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM artikel").run();
    sortArticles(articles).forEach((article) => {
      insert.run(
        article.id,
        article.materialnummer,
        article.materialbezeichnung,
        article.gebindeArt,
        article.mengeProKarton,
        article.mengeProPalette,
        article.barcode,
        article.lagerplatz,
        article.artikelgruppe,
        article.bemerkung,
        article.aktiv ? 1 : 0,
        article.erstelltAm,
        article.geaendertAm
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function findArticle(id, warehouse = "SSI") {
  const row = getArticleDb(warehouse)
    .prepare(
      `SELECT id, materialnummer, materialbezeichnung, gebinde_art, menge_pro_karton,
              menge_pro_palette, barcode, lagerplatz, artikelgruppe, bemerkung,
              aktiv, erstellt_am, geaendert_am FROM artikel WHERE id = ?`
    )
    .get(id);
  return row ? articleFromRow(row) : null;
}

// ── Import / export ───────────────────────────────────────────────────────────

export async function importArticles(incoming, warehouse = "SSI") {
  const articles = await readArticles(warehouse);
  const byMaterialnummer = new Map(articles.map((article, index) => [article.materialnummer, { article, index }]));
  let created = 0;
  let updated = 0;
  const errors = [];

  incoming.forEach((entry, index) => {
    try {
      const article = normalizeArticle(entry);
      validateArticle(article);
      const existing = byMaterialnummer.get(article.materialnummer);
      if (existing) {
        const merged = normalizeArticle({
          ...existing.article,
          ...article,
          id: existing.article.id,
          erstelltAm: existing.article.erstelltAm,
          geaendertAm: new Date().toISOString(),
        });
        articles[existing.index] = merged;
        byMaterialnummer.set(merged.materialnummer, { article: merged, index: existing.index });
        updated += 1;
        return;
      }
      article.id = createArticleId();
      article.erstelltAm = new Date().toISOString();
      article.geaendertAm = article.erstelltAm;
      articles.push(article);
      byMaterialnummer.set(article.materialnummer, { article, index: articles.length - 1 });
      created += 1;
    } catch (error) {
      errors.push({ row: index + 1, error: error.message || "Ungültiger Artikel" });
    }
  });

  if (created || updated) await writeArticles(sortArticles(articles), warehouse);
  return { created, updated, errors };
}

export async function deleteArticle(id, warehouse = "SSI") {
  const articles = await readArticles(warehouse);
  const index = articles.findIndex((article) => article.id === id);
  if (index < 0) return null;

  const [deleted] = articles.splice(index, 1);
  await writeArticles(articles, warehouse);
  return deleted;
}

export async function migrateMainArticlesToWarehouse(warehouse = "SSI") {
  const count = getArticleDb(warehouse).prepare("SELECT COUNT(*) AS count FROM artikel").get().count;
  if (count > 0) return;

  try {
    const rows = getDb()
      .prepare(
        `SELECT id, materialnummer, materialbezeichnung, gebinde_art, menge_pro_karton,
                menge_pro_palette, barcode, lagerplatz, artikelgruppe, bemerkung,
                aktiv, erstellt_am, geaendert_am FROM artikel`
      )
      .all();
    if (rows.length) await writeArticles(rows.map(articleFromRow), warehouse);
  } catch {
    // Legacy main database may not have a compatible article table; ignore it.
  }
}

export async function migrateLegacyArticles(legacyArticlesFile, warehouse = "SSI") {
  if (!existsSync(legacyArticlesFile)) return;
  const count = getArticleDb(warehouse).prepare("SELECT COUNT(*) AS count FROM artikel").get().count;
  if (count > 0) return;

  try {
    const legacy = JSON.parse(await readFile(legacyArticlesFile, "utf8"));
    if (Array.isArray(legacy) && legacy.length) await importArticles(legacy, warehouse);
  } catch {
    // A broken legacy import file should not block the server start.
  }
}

export function articlesToCsv(articles) {
  const header = [
    "Materialnummer",
    "Materialbezeichnung",
    "Gebinde",
    "Menge pro KRT",
    "Menge pro Palette",
    "Barcode",
    "Lagerplatz",
    "Artikelgruppe",
    "Bemerkung",
    "Aktiv",
  ];
  const rows = sortArticles(articles).map((article) => [
    article.materialnummer,
    article.materialbezeichnung,
    article.gebindeArt,
    article.gebindeArt === "KRT" ? article.mengeProKarton : "",
    article.mengeProPalette,
    article.barcode,
    article.lagerplatz,
    article.artikelgruppe,
    article.bemerkung,
    article.aktiv ? "1" : "0",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
}

// ── Search / lookup ───────────────────────────────────────────────────────────

export function searchArticles(articles, query, includeInactive = false) {
  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  return sortArticles(articles)
    .filter((article) => includeInactive || article.aktiv)
    .filter((article) => {
      if (!terms.length) return true;
      const haystack = normalizeSearch(
        [article.materialnummer, article.materialbezeichnung, article.gebindeArt, article.barcode, article.lagerplatz, article.artikelgruppe].join(" ")
      );
      return terms.every((term) => haystack.includes(term));
    });
}

export function findArticleByCode(articles, code) {
  const needle = String(code || "").trim().toLowerCase();
  if (!needle) return null;
  return (
    articles.find(
      (article) =>
        article.aktiv &&
        (article.materialnummer.toLowerCase() === needle || String(article.barcode || "").toLowerCase() === needle)
    ) || null
  );
}

export function calculatePackaging(article, quantity) {
  const mengeStueck = readInteger(quantity);
  if (!Number.isInteger(mengeStueck) || mengeStueck < 0) throw new Error("Menge muss eine Zahl ab 0 sein");
  return {
    mengeStueck,
    kartons: article.mengeProKarton > 0 ? mengeStueck / article.mengeProKarton : 0,
    paletten: article.mengeProPalette > 0 ? mengeStueck / article.mengeProPalette : 0,
    volleKartons: article.mengeProKarton > 0 ? Math.floor(mengeStueck / article.mengeProKarton) : 0,
    restStueckNachKartons: article.mengeProKarton > 0 ? mengeStueck % article.mengeProKarton : mengeStueck,
    vollePaletten: article.mengeProPalette > 0 ? Math.floor(mengeStueck / article.mengeProPalette) : 0,
    restStueckNachPaletten: article.mengeProPalette > 0 ? mengeStueck % article.mengeProPalette : mengeStueck,
  };
}

// ── Normalization / validation ────────────────────────────────────────────────

export function normalizeArticle(article) {
  const gebindeArt = normalizeGebindeArt(article.gebindeArt ?? article.gebinde_art ?? article.Gebinde ?? article.Gebindeart);
  const mengeProKarton = readInteger(
    article.mengeProKarton ?? article.menge_pro_karton ?? article["Menge pro KRT"] ?? article["Menge pro Karton"]
  );
  const mengeProPalette = readInteger(article.mengeProPalette ?? article.menge_pro_palette ?? article["Menge pro Palette"]);

  return {
    id: String(article.id || ""),
    materialnummer: String(article.materialnummer ?? article.materialNumber ?? article.Materialnummer ?? "").trim(),
    materialbezeichnung: String(article.materialbezeichnung ?? article.materialDescription ?? article.Materialbezeichnung ?? "").trim(),
    gebindeArt,
    mengeProKarton: gebindeArt === "KRT" ? mengeProKarton : 0,
    mengeProPalette,
    barcode: String(article.barcode ?? article.Barcode ?? "").trim(),
    lagerplatz: String(article.lagerplatz ?? article.Lagerplatz ?? "").trim(),
    artikelgruppe: String(article.artikelgruppe ?? article.Artikelgruppe ?? "").trim(),
    bemerkung: String(article.bemerkung ?? article.Bemerkung ?? "").trim(),
    aktiv: readBoolean(article.aktiv ?? article.Aktiv, true),
    erstelltAm: String(article.erstelltAm ?? article.erstellt_am ?? article.createdAt ?? ""),
    geaendertAm: String(article.geaendertAm ?? article.geaendert_am ?? article.updatedAt ?? ""),
  };
}

export function validateArticle(article) {
  if (!article.materialnummer) throw new Error("Materialnummer fehlt");
  if (!article.materialbezeichnung) throw new Error("Materialbezeichnung fehlt");
  if (!["C1", "C2", "A1", "KRT", "STK"].includes(article.gebindeArt)) throw new Error("Gebindeart ist ungültig");
  if (article.gebindeArt === "KRT" && (!Number.isInteger(article.mengeProKarton) || article.mengeProKarton <= 0))
    throw new Error("Menge pro KRT muss größer 0 sein");
  if (!Number.isInteger(article.mengeProPalette) || article.mengeProPalette <= 0)
    throw new Error("Menge pro Palette muss größer 0 sein");
}

export function articleSummary(article) {
  return {
    id: article.id,
    materialnummer: article.materialnummer,
    materialbezeichnung: article.materialbezeichnung,
    gebindeArt: article.gebindeArt,
    mengeProKarton: article.mengeProKarton,
    mengeProPalette: article.mengeProPalette,
    barcode: article.barcode,
    lagerplatz: article.lagerplatz,
    artikelgruppe: article.artikelgruppe,
    bemerkung: article.bemerkung,
    aktiv: article.aktiv,
    erstelltAm: article.erstelltAm,
    geaendertAm: article.geaendertAm,
  };
}

export function articleFromRow(row) {
  return {
    id: String(row.id || ""),
    materialnummer: String(row.materialnummer || ""),
    materialbezeichnung: String(row.materialbezeichnung || ""),
    gebindeArt: normalizeGebindeArt(row.gebinde_art),
    mengeProKarton: Number(row.menge_pro_karton || 0),
    mengeProPalette: Number(row.menge_pro_palette || 0),
    barcode: String(row.barcode || ""),
    lagerplatz: String(row.lagerplatz || ""),
    artikelgruppe: String(row.artikelgruppe || ""),
    bemerkung: String(row.bemerkung || ""),
    aktiv: Boolean(row.aktiv),
    erstelltAm: String(row.erstellt_am || ""),
    geaendertAm: String(row.geaendert_am || ""),
  };
}

export function sortArticles(articles) {
  return [...articles].sort((a, b) =>
    String(a.materialnummer).localeCompare(String(b.materialnummer), "de", { numeric: true })
  );
}

function normalizeGebindeArt(value) {
  const text = String(value || "STK").trim().toUpperCase();
  return ["C1", "C2", "A1", "KRT", "STK"].includes(text) ? text : "STK";
}

