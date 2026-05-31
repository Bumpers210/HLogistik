import { DatabaseSync } from "node:sqlite";

let _db = null;

export function configure(filePath) {
  if (_db) return _db;
  _db = new DatabaseSync(filePath);
  return _db;
}

export function getDb() {
  if (!_db) throw new Error("Datenbank nicht initialisiert. configure() muss zuerst aufgerufen werden.");
  return _db;
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
      artikel_id TEXT NOT NULL,
      materialnummer TEXT NOT NULL,
      lagerplatz TEXT NOT NULL,
      le_nummer TEXT NOT NULL,
      menge_stueck INTEGER NOT NULL DEFAULT 0,
      aktualisiert_am TEXT NOT NULL,
      UNIQUE(materialnummer, lagerplatz, le_nummer)
    );
    CREATE INDEX IF NOT EXISTS idx_lagerbestand_artikel
      ON lagerbestand(materialnummer, lagerplatz, le_nummer);

    CREATE TABLE IF NOT EXISTS lagerbewegung (
      id TEXT PRIMARY KEY,
      artikel_id TEXT NOT NULL,
      materialnummer TEXT NOT NULL,
      bewegungsart TEXT NOT NULL,
      menge_stueck INTEGER NOT NULL,
      lagerplatz TEXT NOT NULL,
      le_nummer TEXT NOT NULL,
      referenz TEXT,
      erstellt_am TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lagerbewegung_artikel
      ON lagerbewegung(materialnummer, erstellt_am);

    CREATE TABLE IF NOT EXISTS auftraege (
      id TEXT PRIMARY KEY,
      auftragsnummer TEXT NOT NULL DEFAULT '',
      kundenname TEXT NOT NULL DEFAULT '',
      auftragsdatum TEXT NOT NULL DEFAULT '',
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
}

export function ensureArticleColumn(name, definition) {
  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(artikel)").all().map((col) => col.name);
  if (columns.includes(name)) return false;
  db.exec(`ALTER TABLE artikel ADD COLUMN ${name} ${definition}`);
  return true;
}
