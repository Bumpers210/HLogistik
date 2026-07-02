# HLogistik Rules Overview

Stand: 2026-07-02 11:23:22 +02:00

## Regelorte

Die fachlichen Serverregeln liegen in `server/rules/`:

- `permission-rules.mjs`: bekannte Benutzergruppen und Rollenmatrix fuer schreibende Serveraktionen.
- `article-rules.mjs`: erlaubte Gebindearten, Standard-Gebinde und Gebindemengen-Regeln.
- `warehouse-rules.mjs`: bekannte Lager `SSI`/`SI`, Default-Lager und Artikel-Datenbankdateien.
- `storage-bin-rules.mjs`: SSI-Stellplatznormalisierung, inklusive H/R-Regeln, H3-O-Y-Direktplaetzen und Regalbereichslogik.
- `storage-hu-rules.mjs`: SSI-HU-Prefix `34006381000`, Suffixlaenge `7`, Gesamtlange und serverseitige HU-Helfer fuer Einlagerungsauftraege.
- `order-rules.mjs`: Nach-Lagerplatz-/Kunden-Normalisierung, `9021-0OUT` gewinnt als Kunde sobald irgendeine Position diesen Nach-Lagerplatz enthaelt, `9021-0OUT -> SSI`-Auftragsnummer, Kundengruppen-Key, Bestellhinweis-Regeln, Auftrags-Fingerprint, Grenzwerte fuer manuelle Einlagerungs-Mehrfachanlage und manueller Positionspraefix `M`.
- `export-rules.mjs`: reine Export-Vollstaendigkeitsregel, ob relevante Positionen abgehakt sind.

Weitere regelnahe Listen:

- `shared/app-pages.mjs`: bekannte App- und Navigationsseiten fuer Node-seitige Nutzung.
- `server/config/static-files.mjs`: erlaubte statische Serverdateien und Cache-Header-Regeln.
- `server/reports.mjs`: Buchungsexport-Spalten, Zeitraumvalidierung, read-only Mapping aus `lagerbewegung` sowie Zuordnung von `bestandsbuchung_fehler` zur Auftragsreferenz fuer den Artikelstamm-Excel-Export.
- `server/original-archive.mjs`: sichere Originaldatei-Archivierung nach erfolgreichem PDF-Export, inklusive Importordner-Schutz, Archivkollisionen und Rename-/Copy-Fallback.
- `service-worker.js`: klassische Browser-App-Shell-Liste fuer Offline-Cache. Diese Liste bleibt wegen alter Tablet-/Service-Worker-Kompatibilitaet manuell synchronisiert.
- `order-hint-rules.js`: klassisches Browser-/Test-Helferskript fuer Bestellhinweis-Erkennung und Anhaengen an die importierte Auftragsnummer.
- `shared/storage-hu-rules.js`: klassisches Browser-Regelskript fuer SSI-HU-Prefix, Suffixlaenge, Gesamtlange und HU-Helfer in Desktop und Tablet.
- `shared/manual-storage-rules.js`: klassisches Browser-Regelskript fuer manuelle Einlagerungsanzahl und Positionspraefix `M` in Desktop und Tablet.

## Bewusst nicht extern konfigurierbar

- Regeln mit Regex, Normalisierung, Fehlerbehandlung oder Reihenfolge bleiben JS/MJS-Code.
- SSI-Stellplatznormalisierung ist keine JSON-Konfiguration, sondern getestete Logik.
- Exportlogik fuer Bestandsbuchungsfehler bleibt unveraendert: CR-002 ist bewusst aktiv.
- SQLite-Reparatur, echte Authentifizierung und produktive Datenmigrationen gehoeren nicht zu diesen Regeldateien.
- Browser-Duplikate fuer HU- und manuelle Einlagerungs-Konstanten sind in klassische `shared/*.js`-Skripte gebuendelt, damit `tablet-legacy.js` ohne ES-Module lauffaehig bleibt.
- Browser-/Tablet-Storage-Keys bleiben bewusst in den jeweiligen Laufzeitdateien, weil sie Offline-Datenkompatibilitaet und bestehende LocalStorage-Namen sichern.
- Tablet-Ausstiegsregeln fuer manuelle Einlagerung nutzen bestehende Felder (`manualStorageDraft`, `localDraft`, `acceptedBy`, `exportedAt`) und fuehren keine neuen Statuswerte ein.
- Bestellhinweis-Erkennung bleibt klassisches JavaScript statt JSON, weil Labelsuche, Normalisierung, Kandidaten-Ablehnung und Doppelanhang-Logik Reihenfolge und Regex benoetigen.
- Manuelle Einlagerungs-Stueckzahl wird weiterhin in den bestehenden Positionsfeldern gespeichert: `actualQty` ist die Stueckzahl, `targetQty` bleibt fuer manuelle Positionen leer. Neue manuelle Stellplaetze starten leer und werden nicht aus dem Artikelstamm vorbelegt.
- Originaldatei-Archivierung ist bewusst serverseitige Pfadlogik und keine Browserregel: Der Browser liefert nur Dateinamen, der Server loest diese ausschliesslich im konfigurierten Importordner auf.
- Kommissionier-PDF-Import nutzt fuer Von-Lagerplaetze bewusst keine SSI-Stellplatznormalisierung und keinen Bestands-Stellplatzabgleich. Der Von-Lagerplatz kommt aus dem gewaehlten OCR-Tabellenkandidaten; erlaubt sind nur trimmen, Whitespace entfernen und Bindestriche vereinheitlichen. Die Kandidatenbewertung in `app.js` waehlt zwischen Skalen/Rotationen, ist aber keine Stellplatzvalidierung und darf keine Stellplatzwerte korrigieren.
- Ladelisten duerfen aus OCR-Nebenkandidaten angehaengt werden. Dabei werden nur Ladelistenpositionen uebernommen; normale Auftragspositionen, Mengen, HU und Stellplaetze bleiben aus dem gewaehlten Hauptkandidaten.

## Regeln aendern

Neue oder geaenderte Regeln zuerst im passenden `server/rules/*` Modul anpassen. Bestehende Kompatibilitaets-Exports in `server/helpers.mjs` nur erhalten oder gezielt erweitern, wenn bestehende Imports sie brauchen.

Bei neuen App-Seiten immer beide Listen pruefen:

- `shared/app-pages.mjs`
- `service-worker.js`

Bei neuen statischen Dateien zusaetzlich `server/config/static-files.mjs` aktualisieren.

Bei Aenderungen an SSI-HU-Regeln `server/rules/storage-hu-rules.mjs`, `shared/storage-hu-rules.js`, `index.html`, `tablet.html`, `service-worker.js`, `manifest.webmanifest` und `server/config/static-files.mjs` gemeinsam pruefen.

Bei Aenderungen an manueller Einlagerungsanzahl oder Positionspraefix `server/rules/order-rules.mjs`, `shared/manual-storage-rules.js`, `index.html`, `tablet.html`, `service-worker.js`, `manifest.webmanifest` und `server/config/static-files.mjs` gemeinsam pruefen.

Bei Aenderungen an der Bestellhinweis-Erkennung `order-hint-rules.js`, `index.html`, `service-worker.js`, `manifest.webmanifest` und die Parser-Fixtures in `scripts/qa-api-matrix.mjs` gemeinsam pruefen.

Bei Aenderungen an Originaldatei-Archivierung `server/original-archive.mjs`, `server/orders.mjs`, `server.mjs`, `app.js` und die Archiv-Fixtures in `scripts/qa-api-matrix.mjs` gemeinsam pruefen. Aktive Konfiguration:

- `HLOGISTIK_IMPORT_DIR` oder `import-path.txt`; Fallback: Exportordner.
- `HLOGISTIK_ARCHIVE_DIR`; Fallback: `<Importordner>/Archiv`. `archive-path.txt` ist als lokale Pfaddatei ignoriert, wird im aktuellen Serverstand aber nicht gelesen.
- `HLOGISTIK_EXPORT_DIR`, `EXPORT_DIR` oder `export-path.txt`; Fallback: `./Exporte`.

Bei Aenderungen am Artikelstamm-Buchungsexport `server/reports.mjs`, `server.mjs`, `artikel.html`, `artikel.js` und `scripts/qa-api-matrix.mjs` gemeinsam pruefen. Die Server-Regelquelle fuer Zeitraum, Spalten und Fehlerlog-Auftragszuordnung ist `server/reports.mjs`; die echte XLSX-Erzeugung bleibt im Browser ueber die vorhandene `xlsx.full.min.js`.

Bei Aenderungen am Kommissionier-PDF-Import `app.js`, `index.html`, `service-worker.js`, `manifest.webmanifest` und die Parser-Fixtures in `scripts/qa-api-matrix.mjs` gemeinsam pruefen. Wichtig: Von-Lagerplaetze im PDF-Import duerfen nicht ueber `server/rules/storage-bin-rules.mjs` oder Bestandsdaten korrigiert werden. Die OCR-Kandidatenbewertung darf nur entscheiden, welcher komplette Kandidat importiert wird.

## Pflicht-Tests nach Regelaenderungen

- `npm.cmd run lint`
- `node --check server.mjs`
- `node --check` fuer geaenderte `server/**/*.mjs`, `shared/*.mjs` und `scripts/*.mjs`
- PowerShell-QA-Matrix mit `$env:QA_BASE_URL = "http://127.0.0.1:4175"` und `npm.cmd run test:qa` gegen eine isolierte QA-Kopie

Manuell pruefen:

- Artikelvalidierung und Gebindemengen
- SSI-Wareneingang und SSI-Warenausgang mit Stellplatznormalisierung
- Rollenfehler bei Mutationen
- bekannte Unterseiten und Service-Worker-Fallback
- Export-Sperre bei offenen Positionen
- Manuelle Einlagerung: `Anzahl Positionen` 1, >1 und >100; mehrere gleiche Artikelnummern; Sollmenge leer.
- Manuelle Einlagerung: neue Stellplaetze leer, Stueckzahl positiv-ganzzahlig, mehrere gleiche Artikelnummern mit unterschiedlichen Stellplaetzen.
- Artikelstamm-Buchungsexport: gueltiger Zeitraum, leerer Zeitraum, ungueltiger Zeitraum, Spaltenreihenfolge, `EIN`/`AUS`, Rollenfehler, Buchungsfehler aus `bestandsbuchung_fehler` mit Auftragsreferenz und read-only Wiederholaufruf.
- Tablet manuelle Einlagerung: online verlassen/loeschen, offline verlassen/abbrechen und leere Offline-Auswahl nach Abbruch.
- PDF-/Textimport: `Bestellhinweis: Service Ecke`, mehrzeiliger Hinweis, kein Hinweis, Doppelanhang und Positionsparsing.
- PDF-/Textimport: `9021-0OUT` als Nach-Lagerplatz an beliebiger Position setzt den Kunden auf `9021-0OUT`; abweichende Nach-Lagerplaetze stehen als Zusatzbemerkung.
- PDF-/OCR-Import: Ladeliste aus Nebenkandidaten wird angehaengt, ohne normale Auftragspositionen aus Nebenkandidaten zu mischen.
- Kommissionier-PDF-Import: OCR-only, Kandidatenbewertung fuer Skala/Rotation, Von-Lagerplatz aus korrekter Tabellenspalte, Rohwert gleich finaler Von-Lagerplatz, keine `O/0`-, `S/5`- oder SSI-Regelkorrektur.
- CR-002 bleibt unveraendert aktiv
