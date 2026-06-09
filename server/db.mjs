import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { normalizeWarehouse } from "./helpers.mjs";

let _db = null;
const _articleDbs = new Map();

export function configure(filePath) {
  if (_db) return _db;
  _db = new DatabaseSync(filePath);
  return _db;
}

export function getDb() {
  if (!_db) throw new Error("Datenbank nicht initialisiert. configure() muss zuerst aufgerufen werden.");
  return _db;
}

export function configureArticleDatabases(dataDir) {
  for (const warehouse of ["SSI", "SI"]) {
    if (_articleDbs.has(warehouse)) continue;
    const fileName = warehouse === "SSI" ? "artikel-ssi.sqlite" : "artikel-si.sqlite";
    _articleDbs.set(warehouse, new DatabaseSync(path.join(dataDir, fileName)));
  }
}

export function getArticleDb(warehouse = "SSI") {
  const normalized = normalizeWarehouse(warehouse);
  const db = _articleDbs.get(normalized);
  if (!db) throw new Error("Artikel-Datenbanken nicht initialisiert. configureArticleDatabases() muss zuerst aufgerufen werden.");
  return db;
}

export function initializeDatabase() {
  const db = getDb();
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS artikel (
      id TEXT PRIMARY KEY,
      materialnummer TEXT NOT NULL UNIQUE,
      materialbezeichnung TEXT NOT NULL,
      gebinde_art TEXT NOT NULL DEFAULT 'STK',
      menge_pro_karton INTEGER NOT NULL,
      menge_pro_palette INTEGER NOT NULL,
      barcode TEXT,
      lagerplatz TEXT,
      artikelgruppe TEXT,
      bemerkung TEXT,
      aktiv INTEGER NOT NULL DEFAULT 1,
      erstellt_am TEXT NOT NULL,
      geaendert_am TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artikel_suche
      ON artikel(materialnummer, materialbezeichnung, barcode);

    CREATE TABLE IF NOT EXISTS lagerbestand (
      id TEXT PRIMARY KEY,
      lager TEXT NOT NULL DEFAULT 'SSI',
      artikel_id TEXT NOT NULL,
      materialnummer TEXT NOT NULL,
      lagerplatz TEXT NOT NULL,
      le_nummer TEXT NOT NULL,
      menge_stueck INTEGER NOT NULL DEFAULT 0,
      paletten INTEGER NOT NULL DEFAULT 1,
      aktualisiert_am TEXT NOT NULL,
      UNIQUE(lager, materialnummer, lagerplatz, le_nummer)
    );
    CREATE TABLE IF NOT EXISTS lagerbewegung (
      id TEXT PRIMARY KEY,
      lager TEXT NOT NULL DEFAULT 'SSI',
      artikel_id TEXT NOT NULL,
      materialnummer TEXT NOT NULL,
      bewegungsart TEXT NOT NULL,
      menge_stueck INTEGER NOT NULL,
      paletten INTEGER NOT NULL DEFAULT 0,
      lagerplatz TEXT NOT NULL,
      le_nummer TEXT NOT NULL,
      referenz TEXT,
      erstellt_am TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bestandsbuchung_fehler (
      id TEXT PRIMARY KEY,
      lager TEXT NOT NULL DEFAULT 'SSI',
      auftrag_id TEXT NOT NULL DEFAULT '',
      auftragsnummer TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      lagerauftrag TEXT NOT NULL DEFAULT '',
      materialnummer TEXT NOT NULL DEFAULT '',
      lagerplatz TEXT NOT NULL DEFAULT '',
      le_nummer TEXT NOT NULL DEFAULT '',
      menge TEXT NOT NULL DEFAULT '',
      fehler TEXT NOT NULL DEFAULT '',
      exportiert_pdf_datei TEXT NOT NULL DEFAULT '',
      erstellt_am TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bestandsbuchung_fehler_auftrag
      ON bestandsbuchung_fehler(auftrag_id, erstellt_am);
    CREATE INDEX IF NOT EXISTS idx_bestandsbuchung_fehler_material
      ON bestandsbuchung_fehler(lager, materialnummer, erstellt_am);
    CREATE TABLE IF NOT EXISTS auftraege (
      id TEXT PRIMARY KEY,
      auftragsnummer TEXT NOT NULL DEFAULT '',
      kundenname TEXT NOT NULL DEFAULT '',
      auftragsdatum TEXT NOT NULL DEFAULT '',
      auftragszeit TEXT NOT NULL DEFAULT '',
      euro_paletten TEXT NOT NULL DEFAULT '',
      stellplaetze TEXT NOT NULL DEFAULT '',
      auftrags_notiz TEXT NOT NULL DEFAULT '',
      rohtext TEXT NOT NULL DEFAULT '',
      collapse_done INTEGER NOT NULL DEFAULT 1,
      auftrags_typ TEXT NOT NULL DEFAULT 'picking',
      erstellt_von TEXT NOT NULL DEFAULT '',
      zuletzt_bearbeitet_von TEXT NOT NULL DEFAULT '',
      aktiver_benutzer TEXT NOT NULL DEFAULT '',
      aktiver_benutzer_am TEXT NOT NULL DEFAULT '',
      abgeschlossen_von TEXT NOT NULL DEFAULT '',
      abgeschlossen_am TEXT NOT NULL DEFAULT '',
      exportiert_am TEXT NOT NULL DEFAULT '',
      exportiert_pdf_datei TEXT NOT NULL DEFAULT '',
      exportiert_pdf_pfad TEXT NOT NULL DEFAULT '',
      positionen TEXT NOT NULL DEFAULT '[]',
      erstellt_am TEXT NOT NULL DEFAULT '',
      aktualisiert_am TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_auftraege_aktualisiert
      ON auftraege(aktualisiert_am, exportiert_am);
  `);

  ensureArticleColumn("gebinde_art", "TEXT NOT NULL DEFAULT 'STK'");
  ensureOrderColumn("auftragszeit", "TEXT NOT NULL DEFAULT ''");
  migrateStorageWarehouseTables();
}

export function initializeArticleDatabases() {
  for (const warehouse of ["SSI", "SI"]) {
    initializeArticleDatabase(getArticleDb(warehouse));
  }
}

function initializeArticleDatabase(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS artikel (
      id TEXT PRIMARY KEY,
      materialnummer TEXT NOT NULL UNIQUE,
      materialbezeichnung TEXT NOT NULL,
      gebinde_art TEXT NOT NULL DEFAULT 'STK',
      menge_pro_karton INTEGER NOT NULL,
      menge_pro_palette INTEGER NOT NULL,
      barcode TEXT,
      lagerplatz TEXT,
      artikelgruppe TEXT,
      bemerkung TEXT,
      aktiv INTEGER NOT NULL DEFAULT 1,
      erstellt_am TEXT NOT NULL,
      geaendert_am TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artikel_suche
      ON artikel(materialnummer, materialbezeichnung, barcode);
  `);
  ensureColumn(db, "artikel", "gebinde_art", "TEXT NOT NULL DEFAULT 'STK'");
}

export function ensureArticleColumn(name, definition) {
  return ensureColumn(getDb(), "artikel", name, definition);
}

export function ensureOrderColumn(name, definition) {
  return ensureColumn(getDb(), "auftraege", name, definition);
}

function ensureColumn(db, tableName, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((col) => col.name);
  if (columns.includes(name)) return false;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`);
  return true;
}

function migrateStorageWarehouseTables() {
  migrateLagerbestandTable();
  ensureColumn(getDb(), "lagerbestand", "paletten", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(getDb(), "lagerbewegung", "lager", "TEXT NOT NULL DEFAULT 'SSI'");
  ensureColumn(getDb(), "lagerbewegung", "paletten", "INTEGER NOT NULL DEFAULT 0");
  getDb().exec(`
    CREATE INDEX IF NOT EXISTS idx_lagerbestand_lager_artikel
      ON lagerbestand(lager, materialnummer, lagerplatz, le_nummer);
    CREATE INDEX IF NOT EXISTS idx_lagerbewegung_lager_artikel
      ON lagerbewegung(lager, materialnummer, erstellt_am);
  `);
}

function migrateLagerbestandTable() {
  const db = getDb();
  const createSql = String(
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'lagerbestand'").get()?.sql || ""
  ).toLowerCase();
  const columns = db.prepare("PRAGMA table_info(lagerbestand)").all().map((col) => col.name);
  const hasWarehouseColumn = columns.includes("lager");
  const hasWarehouseUnique = createSql.includes("unique(lager, materialnummer, lagerplatz, le_nummer)");
  if (hasWarehouseColumn && hasWarehouseUnique) return;

  db.exec("BEGIN");
  try {
    db.exec("ALTER TABLE lagerbestand RENAME TO lagerbestand_alt");
    db.exec(`
      CREATE TABLE lagerbestand (
        id TEXT PRIMARY KEY,
        lager TEXT NOT NULL DEFAULT 'SSI',
        artikel_id TEXT NOT NULL,
        materialnummer TEXT NOT NULL,
        lagerplatz TEXT NOT NULL,
        le_nummer TEXT NOT NULL,
        menge_stueck INTEGER NOT NULL DEFAULT 0,
        paletten INTEGER NOT NULL DEFAULT 1,
        aktualisiert_am TEXT NOT NULL,
        UNIQUE(lager, materialnummer, lagerplatz, le_nummer)
      );
    `);
    const lagerSelect = hasWarehouseColumn ? "COALESCE(lager, 'SSI')" : "'SSI'";
    const palettenSelect = columns.includes("paletten")
      ? "COALESCE(paletten, CASE WHEN menge_stueck > 0 THEN 1 ELSE 0 END)"
      : "CASE WHEN menge_stueck > 0 THEN 1 ELSE 0 END";
    db.exec(`
      INSERT INTO lagerbestand (id, lager, artikel_id, materialnummer, lagerplatz, le_nummer, menge_stueck, paletten, aktualisiert_am)
      SELECT id, ${lagerSelect}, artikel_id, materialnummer, lagerplatz, le_nummer, menge_stueck, ${palettenSelect}, aktualisiert_am
      FROM lagerbestand_alt;
      DROP TABLE lagerbestand_alt;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
