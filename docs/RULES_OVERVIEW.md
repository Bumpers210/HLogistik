# HLogistik Rules Overview

Stand: 2026-07-24 10:16:32 +02:00

## Regelorte

Die fachlichen Serverregeln liegen in `server/rules/`:

- `permission-rules.mjs`: bekannte Benutzergruppen und Rollenmatrix fuer schreibende Serveraktionen.
- `article-rules.mjs`: erlaubte Gebindearten, Standard-Gebinde und Gebindemengen-Regeln.
- `warehouse-rules.mjs`: bekannte Lager `SSI`/`SI`, Default-Lager und Artikel-Datenbankdateien.
- `storage-bin-rules.mjs`: SSI-Stellplatznormalisierung, inklusive H/R-Regeln, H3-O-Y-Direktplaetzen und Regalbereichslogik.
- `hall-plan-rules.mjs`: lesende Hallenplanstruktur fuer SSI-Blockplaetze sowie die H1-Regalreihen `AA` bis `AT` mit Ebenen `A` bis `D` und drei Positionen je Bucht.
- `storage-hu-rules.mjs`: SSI-HU-Prefix `34006381000`, Suffixlaenge `7`, Gesamtlange und serverseitige HU-Helfer fuer Einlagerungsauftraege.
- `order-rules.mjs`: Nach-Lagerplatz-/Kunden-Normalisierung, `9021-0OUT` gewinnt als Kunde sobald irgendeine Position diesen Nach-Lagerplatz enthaelt, `9021-0OUT -> SSI`-Auftragsnummer, Kundengruppen-Key, Bestellhinweis-Regeln, Auftrags-Fingerprint, Grenzwerte fuer manuelle Einlagerungs-Mehrfachanlage und manueller Positionspraefix `M`.
- `export-rules.mjs`: reine Export-Vollstaendigkeitsregel, ob relevante Positionen abgehakt sind.

Weitere regelnahe Listen:

- `shared/app-pages.mjs`: bekannte App- und Navigationsseiten fuer Node-seitige Nutzung.
- `server/config/static-files.mjs`: erlaubte statische Serverdateien und Cache-Header-Regeln.
- `server/reports.mjs`: Buchungsexport-Spalten, Zeitraumvalidierung, read-only Mapping aus `lagerbewegung` sowie Zuordnung von `bestandsbuchung_fehler` zur Auftragsreferenz fuer den Artikelstamm-Excel-Export.
- `server/storage.mjs`: atomare Umlagerung vollstaendiger Bestandszeilen innerhalb eines Lagers mit Idempotenz, Quellsnapshot-Pruefung und unveraenderten Material-Gesamtsummen sowie rein lesende Blockplatz- und Regalplatzuebersichten aus positiven Bestandszeilen beider Lager `SSI` und `SI`; die Regalansicht liefert 546 Plaetze je H1-Ebene.
- `tablet-transfer.js`: einziger Browser-Controller fuer den in `tablet.html` integrierten Umlagerungsbereich mit Online-/IndexedDB-Suche, Scanner/Kamera, expliziter Buchungsbestaetigung, konkreten Offline-Speicherdiagnosen und lokalen Offline-Entwuerfen ohne Offlinebuchung.
- `server/original-archive.mjs`: sichere Originaldatei-Archivierung nach erfolgreichem PDF-Export, inklusive Importordner-Schutz, Archivkollisionen und Rename-/Copy-Fallback.
- `service-worker.js`: klassische Browser-App-Shell-Liste fuer Offline-Cache. Diese Liste bleibt wegen alter Tablet-/Service-Worker-Kompatibilitaet manuell synchronisiert.
- `order-hint-rules.js`: klassisches Browser-/Test-Helferskript fuer Bestellhinweis-Erkennung und Anhaengen an die importierte Auftragsnummer.
- `app-import-line-helpers.js`: klassisches Browser-Helferskript fuer reine Import-/Zeilennormalisierung, Mengen-/Einheitenlesung und automatische Positionsnotizen.
- `app-import-diagnostics.js`: klassisches Browser-Helferskript fuer Import-/OCR-Diagnoseausgaben, Kandidaten-Diagnoseformatierung und Positionsdiagnose ohne DOM-, OCR- oder State-Seiteneffekte.
- `app-state-helpers.js`: klassisches Browser-Helferskript fuer kleine reine Line-/State-Helfer wie Positionssortierung und Mengenabweichung.
- `app-ui-helpers.js`: klassisches Browser-Helferskript fuer kleine reine UI-String-/SVG-Helfer wie Barcode-SVG und HTML-/SVG-Escaping.
- `shared/storage-bin-rules.js`: klassisches Browser-Regelskript fuer regelbasierte Von-Lagerplatz-Review-Diagnose im Kommissionierimport, gespiegelt aus der Stellplatz-Regelbasis ohne DOM-, Fetch- oder Storage-Zugriffe.
- `shared/storage-hu-rules.js`: klassisches Browser-Regelskript fuer SSI-HU-Prefix, Suffixlaenge, Gesamtlange und HU-Helfer in Desktop und Tablet.
- `shared/manual-storage-rules.js`: klassisches Browser-Regelskript fuer manuelle Einlagerungsanzahl und Positionspraefix `M` in Desktop und Tablet.

## Bewusst nicht extern konfigurierbar

- Regeln mit Regex, Normalisierung, Fehlerbehandlung oder Reihenfolge bleiben JS/MJS-Code.
- SSI-Stellplatznormalisierung ist keine JSON-Konfiguration, sondern getestete Logik.
- Exportlogik fuer Bestandsbuchungsfehler bleibt unveraendert: CR-002 ist bewusst aktiv.
- SQLite-Reparatur, echte Authentifizierung und produktive Datenmigrationen gehoeren nicht zu diesen Regeldateien.
- Browser-Duplikate fuer HU- und manuelle Einlagerungs-Konstanten sind in klassische `shared/*.js`-Skripte gebuendelt, damit `tablet-legacy.js` ohne ES-Module lauffaehig bleibt.
- Reine Desktop-Import-Zeilenhelfer liegen in `app-import-line-helpers.js`; `app.js` behaelt Kompatibilitaets-Wrapper, damit bestehende Aufrufe und der QA-Harness stabil bleiben.
- Reine Import-Diagnosehelfer liegen in `app-import-diagnostics.js`; fachliche Parser, OCR-Kandidatenauswahl und Import-State-Mutation bleiben bewusst in `app.js`.
- Kleine reine Line-/State-Helfer liegen in `app-state-helpers.js`; `render()`, `updateCounts()`, Exportpfade und State-Mutation bleiben bewusst in `app.js`.
- Kleine reine UI-String-/SVG-Helfer liegen in `app-ui-helpers.js`; `render()`, `renderLoadingSlipLine()`, DOM-Erzeugung und Ladelisten-Rendering bleiben bewusst in `app.js`.
- Browser-/Tablet-Storage-Keys bleiben bewusst in den jeweiligen Laufzeitdateien, weil sie Offline-Datenkompatibilitaet und bestehende LocalStorage-Namen sichern.
- Tablet-Ausstiegsregeln fuer manuelle Einlagerung nutzen bestehende Felder (`manualStorageDraft`, `localDraft`, `acceptedBy`, `exportedAt`) und fuehren keine neuen Statuswerte ein.
- Bestellhinweis-Erkennung bleibt klassisches JavaScript statt JSON, weil Labelsuche, Normalisierung, Kandidaten-Ablehnung und Doppelanhang-Logik Reihenfolge und Regex benoetigen.
- Manuelle Einlagerungs-Stueckzahl bleibt in den bestehenden Positionsfeldern: `targetQty` speichert die Anfangsmenge als unveraenderliche Soll-Basis, `actualQty` die aktuelle Ist-Menge. Nur eine spaetere Ist-Abweichung gilt als Aenderung; neue manuelle Stellplaetze starten weiterhin leer und werden nicht aus dem Artikelstamm vorbelegt.
- Die automatische A1-Auftragsnotiz wird aus strukturierten `autoPositionNotes.package`-Werten normaler Kommissionierpositionen berechnet, als `autoOrderNotes.packageA1` getrennt von der manuellen `orderNote` gespeichert und in UI sowie PDF separat ausgegeben. Ladelistenpositionen zaehlen nicht.
- Originaldatei-Archivierung ist bewusst serverseitige Pfadlogik und keine Browserregel: Der Browser liefert nur Dateinamen, der Server loest diese ausschliesslich im konfigurierten Importordner auf.
- Kommissionier-PDF-Import nutzt die Stellplatz-Regelbasis nur fuer Review-/Diagnoseentscheidungen. Der Von-Lagerplatz kommt aus dem gewaehlten OCR-Tabellenkandidaten; erlaubt sind nur trimmen, Whitespace entfernen und Bindestriche vereinheitlichen. Im eng begrenzten SI-/Bestellschein-Kontext darf ein fehlender oder formal auffaelliger Von-Lagerplatz anhand Artikel und LE/HU aus genau einem eindeutigen Systemtreffer ergaenzt werden; SSI-Lageraufgaben erhalten weiterhin keine allgemeine Bestands-Stellplatzkorrektur.
- Ladelisten duerfen aus OCR-Nebenkandidaten angehaengt werden. Dabei werden nur Ladelistenpositionen uebernommen; normale Auftragspositionen, Mengen, HU und Stellplaetze bleiben aus dem gewaehlten Hauptkandidaten.
- Umlagerungen verschieben immer eine vollstaendige Bestandszeile innerhalb desselben Lagers. Menge, Paletten und HU/LE kommen ausschliesslich aus dem erneut geprueften Quellbestand; Teilmengen, Lagerwechsel und HU-/LE-Aenderungen sind nicht erlaubt.
- Eine Umlagerung erzeugt genau zwei korrelierte Bewegungen `Umlagerung-Ausgang` und `Umlagerung-Eingang`. Sie erscheinen im Buchungsexport als `UML-AUS` und `UML-EIN`, zaehlen aber nicht als normaler Zu- oder Abgang.
- Umlagerungsentwuerfe bleiben als kleine, ungepruefte Quellsnapshots lokal im Store `transfer-drafts`. Sie werden nie in die bestehende Offline-Sync-Queue gestellt. Daneben wird je Lager ausschliesslich die minimale Projektion aller positiven Bestandszeilen in den Stores `transfer-stock-rows` und `transfer-stock-snapshots` persistiert. Bewegungen und Verlaeufe bleiben online. Eine neue Snapshot-Generation wird in einer gemeinsamen Transaktion mit ihren Metadaten aktiviert; unterbrochene Aktualisierungen lassen die vorherige Generation aktiv. Die Offline-Suche liest den aktiven Store direkt und stellt alle Treffer ohne Gesamtlimit in 20er-Seiten bereit; nur die aktuelle Seite liegt im Arbeitsspeicher und im DOM. Der aktive Entwurf wird beim Wiederverbinden beziehungsweise Oeffnen anhand der Bestands-ID online validiert; bis dahin und bei Konflikten bleibt die Buchung gesperrt.
- Der Offline-Store bleibt fuer das Legacy-Tablet ES5-parsebar. IndexedDB darf ueber den Standardnamen oder den alten WebKit-Namen bereitgestellt werden; `getAll()` und `DOMStringList.contains()` sind keine Voraussetzung. Fehlende Snapshot-Stores oder -Indizes werden ausschliesslich per Versionsupgrade angelegt, ohne andere Stores zu loeschen oder zu leeren. Ein fehlgeschlagener `readwrite`-Start darf nach Neuvalidierung genau einmal wiederholt werden. Danach entscheidet eine echte Schreib-/Leseprobe ueber das Transfer-Backend. Nur bei deren Fehlschlag darf die isolierte WebSQL-Datenbank fuer Snapshot und ungepruefte Umlagerungsentwuerfe verwendet werden; Auftraege und Sync-Queue bleiben IndexedDB. IndexedDB und WebSQL schreiben seitenweise, aktivieren ausschliesslich vollstaendige Generationen und suchen ohne Gesamtlimit mit `LIMIT`/`OFFSET` beziehungsweise Cursor-Seiten. Diagnosen enthalten Backend und nativen Fehler. Der Bestands-Snapshot hat keinen LocalStorage-Fallback.

## Regeln aendern

Neue oder geaenderte Regeln zuerst im passenden `server/rules/*` Modul anpassen. Bestehende Kompatibilitaets-Exports in `server/helpers.mjs` nur erhalten oder gezielt erweitern, wenn bestehende Imports sie brauchen.

Bei neuen App-Seiten immer beide Listen pruefen:

- `shared/app-pages.mjs`
- `service-worker.js`

Bei neuen statischen Dateien zusaetzlich `server/config/static-files.mjs` aktualisieren.

Bei Aenderungen an SSI-HU-Regeln `server/rules/storage-hu-rules.mjs`, `shared/storage-hu-rules.js`, `index.html`, `tablet.html`, `service-worker.js`, `manifest.webmanifest` und `server/config/static-files.mjs` gemeinsam pruefen.

Bei Aenderungen an manueller Einlagerungsanzahl oder Positionspraefix `server/rules/order-rules.mjs`, `shared/manual-storage-rules.js`, `index.html`, `tablet.html`, `service-worker.js`, `manifest.webmanifest` und `server/config/static-files.mjs` gemeinsam pruefen.

Bei Aenderungen an der Bestellhinweis-Erkennung `order-hint-rules.js`, `index.html`, `service-worker.js`, `manifest.webmanifest` und die Parser-Fixtures in `scripts/qa-api-matrix.mjs` gemeinsam pruefen.

Bei Aenderungen an reinen Import-Zeilenhelfern `app-import-line-helpers.js`, `app.js`, `index.html`, `service-worker.js`, `manifest.webmanifest`, `server/config/static-files.mjs` und den VM-Harness in `scripts/qa-api-matrix.mjs` gemeinsam pruefen.

Bei Aenderungen an Import-Diagnosehelfern `app-import-diagnostics.js`, `app.js`, `index.html`, `service-worker.js`, `manifest.webmanifest`, `server/config/static-files.mjs` und den VM-Harness in `scripts/qa-api-matrix.mjs` gemeinsam pruefen.

Bei Aenderungen an State-/Line-Helfern `app-state-helpers.js`, `app.js`, `index.html`, `service-worker.js`, `manifest.webmanifest`, `server/config/static-files.mjs` und den VM-Harness in `scripts/qa-api-matrix.mjs` gemeinsam pruefen.

Bei Aenderungen an UI-String-/SVG-Helfern `app-ui-helpers.js`, `app.js`, `index.html`, `service-worker.js`, `manifest.webmanifest`, `server/config/static-files.mjs` und den VM-Harness in `scripts/qa-api-matrix.mjs` gemeinsam pruefen.

Bei Aenderungen an Originaldatei-Archivierung `server/original-archive.mjs`, `server/orders.mjs`, `server.mjs`, `app.js` und die Archiv-Fixtures in `scripts/qa-api-matrix.mjs` gemeinsam pruefen. Aktive Konfiguration:

- `HLOGISTIK_IMPORT_DIR` oder `import-path.txt`; Fallback: Exportordner.
- `HLOGISTIK_ARCHIVE_DIR`; Fallback: `<Importordner>/Archiv`. `archive-path.txt` ist als lokale Pfaddatei ignoriert, wird im aktuellen Serverstand aber nicht gelesen.
- `HLOGISTIK_EXPORT_DIR`, `EXPORT_DIR` oder `export-path.txt`; Fallback: `./Exporte`.

Bei Aenderungen am Artikelstamm-Buchungsexport `server/reports.mjs`, `server.mjs`, `artikel.html`, `artikel.js` und `scripts/qa-api-matrix.mjs` gemeinsam pruefen. Die Server-Regelquelle fuer Zeitraum, Spalten und Fehlerlog-Auftragszuordnung ist `server/reports.mjs`; die echte XLSX-Erzeugung bleibt im Browser ueber die vorhandene `xlsx.full.min.js`.

Bei Aenderungen an Umlagerungen `server/db.mjs`, `server/storage.mjs`, `server.mjs`, `server/reports.mjs`, `server/rules/permission-rules.mjs`, `tablet.html`, `tablet-transfer.js`, `tablet.js`, `tablet-legacy.js`, `offline-store.js`, Navigation, statische Allowlist, Service Worker, Manifest und die Transfer-Fixtures in `scripts/qa-api-matrix.mjs` gemeinsam pruefen. Es gibt bewusst keine eigenstaendige `umlagerungen.html` und keine zweite Browser-Fachlogik.

Bei Aenderungen am Kommissionier-PDF-Import `app.js`, `app-import-diagnostics.js`, `shared/storage-bin-rules.js`, `index.html`, `service-worker.js`, `manifest.webmanifest`, `server/config/static-files.mjs` und die Parser-Fixtures in `scripts/qa-api-matrix.mjs` gemeinsam pruefen. Wichtig: Von-Lagerplaetze im PDF-Import duerfen nicht pauschal ueber OCR-Zeichenersatz, SSI-Normalisierung oder Bestandsdaten korrigiert werden. Die OCR-Kandidatenbewertung darf nur entscheiden, welcher komplette Kandidat importiert wird; der SI-LE/HU-Systemfill bleibt auf eindeutige SI-/Bestellschein-Treffer beschraenkt.

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
- Kommissionier-PDF-Import: OCR-only, Kandidatenbewertung fuer Skala/Rotation, Von-Lagerplatz aus korrekter Tabellenspalte, regelbasierte Review-Diagnose, keine `O/0`-, `S/5`- oder pauschale SSI-Regelkorrektur; SI-Bestellschein-Systemfill nur bei eindeutigem Artikel- und LE/HU-Treffer.
- CR-002 bleibt unveraendert aktiv
