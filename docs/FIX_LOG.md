# HLogistik Fix Log

Stand: 2026-06-25 10:08:47 +02:00

## 2026-06-25 - PDF-Import OCR-Kandidatenbewertung

Backup:

- Code-Backup: `Backups/code-backup-ocr-candidate-import-20260625-153526/`

Ausgangsproblem:

Der Kommissionier-PDF-Import war nach mehreren OCR- und Stellplatzkorrektur-Laeufen instabil. Insbesondere durften Stellplaetze nicht mehr nachtraeglich durch Regeln, Fuzzy-Logik oder Bestandsdaten veraendert werden; gleichzeitig sollte die OCR-Auswahl belastbarer werden.

Umgesetzt:

- Kommissionier-PDFs nutzen jetzt eine eigene OCR-Kandidatenpipeline.
- Pro Kandidat werden komplette PDF-Texte aus einer OCR-Skala und Rotation gebildet; uebernommene Positionen stammen aus genau dem gewaehlten Kandidaten.
- Gepruefte Skalen: `6` mit DPI `1000` und `7.5` mit DPI `1600`.
- Gepruefte Rotationen: `0`, `90`, `180`, `270`.
- Score beruecksichtigt erkannte Lageraufgabe, HU, Von-Lagerplatz, Produkt, Menge, Nach-Lagerplatz, vollstaendige Pflichtfelder, verworfene Tabellenzeilen und verdaechtige Quellfelder.
- Zu schwache Kandidaten brechen den Import ab, bevor ein Auftrag angelegt oder veraendert wird.
- Stellplatzvalidierung, Stellplatzkorrektur, SSI-Regelabgleich, Fuzzy-Reparatur und Bestands-Stellplatzersatz bleiben im PDF-Importpfad deaktiviert.
- Importdiagnose enthaelt jetzt Kandidatenliste, gewaehlten Kandidaten, Score, Skalen, DPI, Rotation und weiterhin Roh-/Finalwert des Von-Lagerplatzes.
- Asset-Version `app.js?v=20260625-6`, Service-Worker-/Manifest-Version `1.5.144`.

Validierung:

- Baseline vor Aenderung: `npm.cmd run lint`, `node --check app.js scripts/qa-api-matrix.mjs service-worker.js server.mjs`, isolierte QA-Kopie `tmp/qa-ocr-candidate-baseline-20260625-153257/` mit 88/88 Checks.
- QA-Matrix um statische Regressionen fuer OCR-Kandidaten, Score-Regeln und Diagnosefelder erweitert.
- CR-002 bleibt unveraendert.

## 2026-06-25 - PDF-Import Roh-Stellplatzdiagnose abgesichert

Backup:

- Code-Backup: `Backups/code-backup-raw-bin-import-diagnostics-20260625-100633/`

Ausgangsproblem:

Nach dem PDF-Import-Fix musste zuerst geprueft werden, ob der Rohwert aus der Spalte `Von-Lagerplatz` korrekt gelesen wird, bevor weitere Stellplatzvalidierung oder Korrektur eingebaut wird.

Befund:

- Die Spaltenlogik liest den Rohwert `Von-Lagerplatz` fuer die Referenzzeilen korrekt.
- Produkt `1060610` mit HU `340063810002072174` ergibt `002-H3-SO4D1`.
- Produkt `1060610` mit HU `340063810002072181` ergibt `002-H3-SO4D1`.
- `9021-0OUT` bleibt `Nach-Lagerplatz`/`toBin` und wird nicht als `Von-Lagerplatz` uebernommen.
- Werte wie `002-H3-SOO4D1` entstehen in der geprueften Roh-Spaltenlogik nicht.

Umgesetzt:

- Keine neue Fuzzy- oder Stellplatzkorrektur eingebaut.
- Nicht-persistente Positionsdiagnose fuer PDF-Importe ergaenzt: Tabellenzeilenkennung, HU, Produkt, Roh-Stellplatz, finaler Stellplatz und Aenderungsgrund.
- QA-Matrix um Regressionstests fuer Roh-Stellplatz, Diagnose und Null-Positionen-Abbruch erweitert.
- Asset-Version `app.js?v=20260625-3`, Service-Worker-/Manifest-Version `1.5.141`.

Validierung:

- Baseline vor Aenderung: `npm.cmd run lint`, `node --check ...`, isolierte QA-Kopie `tmp/raw-bin-baseline-qa-20260625-100533/` mit 80/80 Checks.
- Direkter Parser-Harness bestaetigt `002-H3-SO4D1 -> 002-H3-SO4D1` fuer beide Referenz-HUs.
- `npm.cmd run lint`
- `node --check app.js scripts\qa-api-matrix.mjs service-worker.js server.mjs server\orders.mjs server\storage.mjs server\helpers.mjs server\rules\storage-bin-rules.mjs server\rules\warehouse-rules.mjs server\rules\order-rules.mjs order-hint-rules.js`
- Isolierte QA-Kopie `tmp/raw-bin-final-qa-20260625-100959/`: `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 83/83 Checks.
- CR-002 bleibt unveraendert.

## 2026-06-25 - PDF-Import Lageraufgabe-Scan wieder stabilisiert

Backup:

- Code-Backup: `Backups/code-backup-pdf-import-regression-20260625-095238/`

Ausgangsproblem:

Ein visuell lesbares Lageraufgaben-PDF wurde als nicht lesbar gemeldet. Zusaetzlich konnten bei fehlenden Positionen einzelne Metadaten im UI erscheinen, obwohl kein belastbarer Auftrag importiert war.

Ursache:

- Scan-/OCR-PDFs liefern keinen einfachen PDF-Text; der Import ist deshalb auf die OCR-Zeilenerkennung angewiesen.
- Die Lageraufgabe-Zeilenstarterkennung war bei 6 bis 9 Ziffern begrenzt und konnte laengere Lageraufgabe-Nummern wegfiltern.
- `importText()` pruefte den Fall "0 erkannte Positionen" erst nach dem Setzen von Auftragszustand.

Umgesetzt:

- Lageraufgabe-Zeilenstarterkennung und Splitter akzeptieren jetzt 6 bis 14 Ziffern.
- `importText()` bricht bei 0 erkannten Positionen vor jeder Zustandsaenderung mit Fehlerstatus ab.
- Der unsichere Text-Fallback fuer Kommissionierimporte ohne Positionen wurde entfernt.
- Bei Abbruch ohne Positionen wird eine nicht-persistente Browser-Konsolendiagnose mit Text-/Zeilen-/Tabellenzaehlern ausgegeben.
- Asset-Version `app.js?v=20260625-2`, Service-Worker-/Manifest-Version `1.5.140`.

Validierung:

- Direkter Parser-Harness fuer `Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz` mit `20260625080515 ... 938 ST ... 9021-0OUT` ergibt eine Position ohne Importfehler.
- Direkter Import-Harness: Text mit Auftragsnummer/Kunde, aber ohne Positionen, bricht mit Fehler ab und laesst `state.orderNumber`, `state.customerName` und `state.lines` unveraendert.
- QA-Matrix erweitert um Lageraufgabe-Tabelle mit langer Nummer.
- `npm.cmd run lint`
- `node --check app.js scripts\qa-api-matrix.mjs service-worker.js server.mjs server\orders.mjs server\storage.mjs server\helpers.mjs server\rules\storage-bin-rules.mjs server\rules\warehouse-rules.mjs server\rules\order-rules.mjs order-hint-rules.js`
- Isolierte QA-Kopie `tmp/pdf-import-regression-qa-20260625-095725/`: `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 80/80 Checks.
- Live-Asset-Smoke: `app.js?v=20260625-2` und Service-Worker-Cache `1.5.140` werden auf Port 4174 ausgeliefert.

## 2026-06-25 - Import liest Positionen trotz unklarem Lagerplatz

Backup:

- Code-Backup: `Backups/code-backup-import-no-lines-bin-fix-20260625-092252/`

Ausgangsproblem:

Nach der Entschaerfung der automatischen `Lagerplatz unklar`-Markierung konnten OCR-Lagerauftragzeilen ohne eindeutig erkannten Von-Lagerplatz als harte Importfehler wirken oder gar nicht mehr als Position gelesen werden.

Ursache:

- `validatePickingImport()` behandelte fehlenden Von-Lagerplatz bei Lagerauftrag-Texten als Importfehler.
- `parseHandlingUnitTokens()` zog 8-stellige HU-Werte mit nachfolgender 7-stelliger Artikelnummer zusammen.
- Der Splitter fuer zusammengeklebte Lagerauftragzeilen konnte dadurch eine HU als neue Lagerauftragsnummer interpretieren.

Umgesetzt:

- Fehlender Von-Lagerplatz blockiert den Import nicht mehr; die Position bleibt mit leerem, bearbeitbarem Lagerplatz erhalten.
- 8-stellige HU/LE-Werte werden nicht mehr mit der folgenden Artikelnummer zusammengezogen.
- Lagerauftrag-Splits werden nur noch akzeptiert, wenn alle Split-Teile selbst plausible Lagerauftragsteile sind.
- Neuer Parser-Fallback liest Lagerauftragzeilen ohne Von-Lagerplatz, aber mit Lagerauftrag, HU/LE, Artikel, Menge, Einheit und Zielplatz.
- Asset-Version `app.js?v=20260625-1`, Service-Worker-/Manifest-Version `1.5.139`.

Validierung:

- Direkter Parser-Harness: `80015595 30684317 1076846 ... 938 ST 9021-0OUT` ergibt eine Position mit Lagerauftrag `80015595`, HU `30684317`, Artikel `1076846`, Menge `938`, Ziel `9021-0OUT`, leerem Lagerplatz und ohne Warnung.
- `npm.cmd run lint`
- `node --check app.js scripts\qa-api-matrix.mjs service-worker.js`
- Isolierte QA-Kopie `tmp/import-bin-regression-qa-20260625-092821/`: `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 79/79 Checks.

## 2026-06-25 - Buchungsexport inklusive Buchungsfehler

Backup:

- Code-Backup: `Backups/code-backup-bookings-export-errors-20260625-080529/`

Ausgangsproblem:

Der Artikelstamm-Buchungsexport las nur erfolgreiche Bewegungen aus `lagerbewegung`. Fehlgeschlagene Bestandsbuchungen aus `bestandsbuchung_fehler` fehlten dadurch in der Excel-Datei.

Umgesetzt:

- `readBookingExport()` fuehrt erfolgreiche Buchungen und Buchungsfehler im gewaehlten Zeitraum zusammen.
- Buchungsfehler werden als Richtung `AUS` exportiert, weil das Fehlerlog aktuell fehlgeschlagene Auslagerungs-/Kommissionierbuchungen enthaelt.
- Die vorhandene Spaltenstruktur bleibt unveraendert.
- Die Spalte `Referenz` enthaelt auch bei Fehlerzeilen die zugehoerige Auftragsreferenz, z. B. `Kommissionierung <Auftragsnummer>`.
- Fehlerzeilen werden ueber `auftrag_id` bzw. gespeicherte `auftragsnummer` dem eigentlichen Auftrag zugeordnet; Fehlermeldungen werden nicht in `Referenz` geschrieben.
- Sortierung bleibt nach Datum/Uhrzeit, Lager, Stellplatz, Referenz und ID stabil.
- QA-Matrix prueft, dass ein CR-002-Bestandsbuchungsfehler im Buchungsexport auftaucht und als Auftragsreferenz ausgegeben wird.
- Isolierte QA-Kopie `tmp/bookings-export-errors-qa-20260625-080743/`: `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 78/78 Checks.

CR-002:

Unveraendert. Der Kommissionierexport trotz Bestandsbuchungsfehlern bleibt bewusst aktiv; die Fehler werden nun zusaetzlich im Buchungsexport sichtbar.

Nachkorrektur:

- Code-Backup: `Backups/code-backup-booking-error-reference-20260625-081353/`
- Fehlerzeilen schreiben keine Fehlermeldung mehr in die Spalte `Referenz`.
- Die Referenz wird aus dem zugeordneten Auftrag gebildet, bevorzugt `Kommissionierung <Auftragsnummer>`.
- Isolierte QA-Kopie `tmp/booking-error-reference-qa-20260625-081519/`: `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 78/78 Checks.

## 2026-06-25 - Artikelstamm Buchungsexport als Excel

Backup:

- Code-Backup: `Backups/code-backup-bookings-export-20260625-071714/`

Ausgangsproblem:

Im Artikelstamm gab es keinen direkten Export aller Lagerbuchungen eines frei waehlbaren Zeitraums. Bestehende Reports zeigten Bewegungen, erzeugten aber keinen gezielten Excel-Export mit den benoetigten Buchungsspalten.

Analyseergebnis:

- Buchungen liegen in der SQLite-Tabelle `lagerbewegung`.
- Verfuegbare Felder fuer den Export sind `bewegungsart`, `erstellt_am`, `lager`, `lagerplatz`, `le_nummer`, `menge_stueck` und `referenz`.
- `artikel.html` laedt bereits `xlsx.full.min.js`; deshalb kann der Browser eine echte `.xlsx` erzeugen, ohne neue Server-Dependency und ohne temporaere Serverdatei.

Umgesetzt:

- Neuer read-only Endpunkt `GET /api/articles/bookings/export?from=YYYY-MM-DD&to=YYYY-MM-DD`.
- Zeitraumparameter werden serverseitig validiert; `Bis` ist inklusiv und wird intern als kleiner Folgetag gefiltert.
- Rollenpruefung nutzt die bestehende Artikelstamm-Berechtigung.
- Artikelstamm hat neue Felder `Von`/`Bis` und den Button `Buchungen exportieren`.
- Der Browser erstellt mit SheetJS eine echte `.xlsx` mit Dateiname `buchungen-YYYY-MM-DD-bis-YYYY-MM-DD.xlsx`.
- Spaltenreihenfolge: `Buchungsrichtung`, `Datum/Uhrzeit`, `Lager`, `Stellplatz`, `HU/LE-Nummer`, `Menge`, `Referenz`.
- QA-Matrix prueft gueltigen Export, Spalten, `EIN`/`AUS`, Rollenfehler, ungueltigen Zeitraum und dass der Endpunkt beim erneuten Aufruf keine Daten veraendert.

CR-002:

Unveraendert. Der Kommissionierexport und das bewusste Uebergangsverhalten bei Bestandsbuchungsfehlern wurden nicht geaendert.

Pruefungen:

- Vor Umsetzung: `git status --short`, `npm.cmd run lint`, `node --check server.mjs server\reports.mjs server\storage.mjs server\articles.mjs artikel.js scripts\qa-api-matrix.mjs`.
- Nach Umsetzung: `node --check server.mjs server\reports.mjs artikel.js service-worker.js`.
- Direkter Funktionscheck `readBookingExport({ from: "2026-06-24", to: "2026-06-24" })`: 111 Buchungen, Spalten korrekt, ungueltiger Zeitraum liefert 400.
- Temporaerer Server auf Port `4175`: gueltiger Export 200, ungueltiger Zeitraum 400, fehlende Rolle 403.
- Isolierte QA-Kopie `tmp/bookings-export-qa-20260625-073122/`: `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 77/77 Checks.
- Live-Static-Smoke Port `4174`: `artikel.html` enthaelt den Button, `artikel.js` enthaelt XLSX-Exportlogik.

## 2026-06-23 - Tablet-Kommissionierexport ohne Reload

Backup:

- Code-Backup: `Backups/code-backup-tablet-export-20260623-085717/`
- Git-Status vor Umsetzung: `Backups/code-backup-tablet-export-20260623-085717/git-status-before.txt`
- Baseline-QA-Kopie: `tmp/tablet-export-baseline-qa-20260623-085601/` auf Port `4175`

Ursache:

- Der Tablet-Export wurde aus einem `saveOrder`-Callback gestartet, dessen async Exportpfad im modernen Tablet-Code nicht awaited wurde.
- Im Fehlerfall konnte ein lokaler Offline-Speicherfallback als erfolgreicher Save wirken und danach trotzdem den serverseitigen PDF-Export anstossen.
- Es gab keinen separaten Export-Guard gegen Doppelklicks und keinen frischen Server-Reload unmittelbar vor der PDF-Erzeugung.

Umgesetzt:

- Tablet-Modern und Tablet-Legacy erzwingen vor dem PDF-Export einen Online-Speicherlauf mit `allowOffline: false`.
- Vor dem Speichern wird die Sync-Queue angestossen; nach erfolgreichem Server-Save werden Queue-Eintraege fuer denselben Auftrag entfernt.
- Der aktuelle Auftrag wird direkt vor dem Export frisch vom Server geladen und erneut gegen offene Positionen/Einlagerungsvalidierung geprueft.
- Der Exportbutton hat einen Single-Flight-Guard (`exportingPdf`) und wird bei Erfolg oder Fehler wieder freigegeben.
- Offline- oder Serverfehler starten keinen PDF-Export und zeigen eine sichtbare Fehlermeldung.
- Service-Worker/Manifest auf `1.5.124` erhoeht; Tablet-Asset-Querystrings auf `20260623-4`.
- CR-002 wurde nicht geaendert.

Pruefungen:

- Baseline vor Umsetzung: `npm.cmd run lint`, `node --check tablet.js`, `tablet-legacy.js`, `server.mjs`, `scripts\qa-api-matrix.mjs`; `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 50/50 Checks.
- QA-Matrix erweitert um Tablet-Direktexport nach gespeichertem Serverzustand sowie statische Guard-Pruefung fuer Modern/Legacy.
- Nach Umsetzung: `npm.cmd run lint`, `node --check tablet.js`, `tablet-legacy.js`, `scripts\qa-api-matrix.mjs`, `service-worker.js`; `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 52/52 Checks.
- Browser-Smoke Tablet: Position bearbeitet, direkt ohne Reload exportiert; Server erzeugte PDF und Button wurde wieder freigegeben.
- Headless-Chrome-CDP-Smoke: offener Auftrag wird mit `Export gesperrt` blockiert; Button bleibt aktiv und Auftrag wird nicht exportiert.

## 2026-06-23 - PDF-Import Bestellhinweis an Auftragsnummer

Backup:

- Code-Backup: `Backups/code-backup-order-hint-import-20260623-082815/`
- Git-Status vor Umsetzung: `Backups/code-backup-order-hint-import-20260623-082815/git-status-before.txt`
- Baseline-QA-Kopie: `tmp/order-hint-import-baseline-qa-20260623-082742/` auf Port `4175`

Umgesetzt:

- Neues klassisches Helper-Skript `order-hint-rules.js` fuer `extractOrderHint`, `normalizeOrderHint` und `appendOrderHintToOrderNumber`.
- `parseOrderText()` haengt einen erkannten `Bestellhinweis` mit Bindestrich an die gedruckte Auftragsnummer an.
- Erkennung ist labelbasiert: Wert in derselben Zeile nach `Bestellhinweis:` oder in der direkt folgenden Zeile.
- Leere, technische oder tabellarische Kandidaten werden verworfen; Umlaute bleiben erhalten; problematische Datei-/Exportzeichen werden bereinigt; Laenge ist auf 80 Zeichen begrenzt.
- Doppelanhaenge werden verhindert, auch wenn die alte Nummernerkennung schon einen Teil des Suffixes gelesen hat.
- `order-hint-rules.js` wurde in statische Allowlist, `index.html` und Service Worker aufgenommen; Manifest/Service-Worker-Version auf `1.5.123`.
- CR-002 wurde nicht geaendert.

Pruefungen:

- Vor Umsetzung: `npm.cmd run lint`, `node --check app.js`, `server.mjs`, `scripts\qa-api-matrix.mjs`, `service-worker.js`; `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 42/42 Checks.
- QA-Matrix erweitert auf 50 Checks: einzeiliger Bestellhinweis, mehrzeiliger Bestellhinweis, ohne Hinweis, Doppelanhang, Header-Ablehnung, Positionsparsing, statische Auslieferung von `order-hint-rules.js` und CR-002.

## 2026-06-23 - Tablet manuelle Einlagerung verlassen/abbrechen/loeschen

Backup:

- Code-Backup: `Backups/code-backup-tablet-manual-storage-exit-20260623-075038/`
- Git-Status vor Umsetzung: `Backups/code-backup-tablet-manual-storage-exit-20260623-075038/git-status-before.txt`
- Finale QA-Kopie: `tmp/tablet-manual-storage-postfix-qa-20260623-081813/` auf Port `4175`

Umgesetzt:

- Tablet-Legacy und Tablet-Modern trennen jetzt drei Aktionen klarer:
  - `Einlagerung verlassen`: Auftrag bleibt bestehen bzw. lokal gespeichert.
  - `Einlagerung abbrechen`: nur fuer reine lokale manuelle Einlagerungen, entfernt Cache und Sync-Queue.
  - `Einlagerung loeschen`: fuer serverseitig angelegte offene manuelle Einlagerungen.
- Servergestuetzte manuelle Einlagerungen mit `local-storage-...`-ID werden nicht mehr falsch als reine Offline-Entwuerfe klassifiziert; entscheidend ist `localDraft === true`.
- Alte lokale IDs werden nach erfolgreicher Offline-Synchronisierung aus dem lokalen Cache entfernt.
- Leere Offline-Cache-Listen rendern die Auswahl jetzt neu, damit abgebrochene lokale Einlagerungen nicht als veralteter `[Cache]`-Eintrag sichtbar bleiben.
- Tablet-Danger-Aktionszeile optisch stabilisiert; `Einlagerung loeschen` als separate staerkere Aktion ergaenzt.
- Service-Worker/Manifest auf `1.5.122` erhoeht; Tablet-Asset-Querystrings auf `20260623-3`.
- CR-002 wurde nicht geaendert.

Pruefungen:

- Baseline vor Umsetzung: `npm.cmd run lint`, zentrale `node --check` Kommandos und `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 40/40 Checks.
- Nach Umsetzung: `npm.cmd run lint`, `node --check tablet-legacy.js`, `node --check tablet.js`, `node --check scripts\qa-api-matrix.mjs`, `node --check service-worker.js` erfolgreich.
- `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` gegen die finale QA-Kopie mit 42/42 Checks.
- Headless-Chrome-CDP-Smoke: online manuelle Einlagerung starten und loeschen; offline manuelle Einlagerung verlassen, erneut aus Cache laden und abbrechen; gelöschter lokaler Auftrag verschwindet aus der Auswahl.

## 2026-06-22 - Tablet Offline-Auftragsgruppen

Backup:

- Code-Backup: `Backups/code-backup-tablet-offline-group-20260622-131936/`
- Git-Status vor Umsetzung: `Backups/code-backup-tablet-offline-group-20260622-131936/git-status-before.txt`
- QA-Kopie: `tmp/tablet-offline-group-qa/` auf Port `4175`

Umgesetzt:

- `offline-store.js` auf DB-Version 2 erweitert und Store `order-groups` fuer gemeinsam uebernommene Tablet-Auftragsgruppen ergaenzt.
- Tablet-Modern und Tablet-Legacy speichern nach `Bearbeitung uebernehmen` alle `acceptedOrderDetails` als Vollauftraege pro `id` und zusaetzlich die gemeinsame Gruppe mit `groupId` und `orderIds`.
- Tablet-Auswahl zeigt die uebernommene Gruppe ueber den bestehenden Auftrags-Dropdown; ein kompakter Hinweis zeigt Anzahl und Kunde.
- Wechsel innerhalb derselben gespeicherten Gruppe bleibt erlaubt, auch wenn der Server nachtraeglich nicht erreichbar ist.
- Bei Listen-, Auftrags- oder Speichern-Fehlern nach Verbindungsverlust wird auf Offline-Cache bzw. Sync-Queue zurueckgefallen.
- Service-Worker/Manifest auf `1.5.118` erhoeht; Tablet-Querystring fuer `tablet-legacy.js` erhoeht.
- CR-002 wurde nicht geaendert.

Pruefungen:

- Vor Umsetzung: `npm.cmd run lint`, zentrale `node --check` Kommandos und `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 36/36 Checks.
- Nach Umsetzung: `node --check` fuer geaenderte JS-Dateien, `npm.cmd run lint`, `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 40/40 Checks.
- Browser-Smoke Tablet online: zwei Auftraege gleicher Kundengruppe wurden gemeinsam uebernommen und beide im Dropdown als `Von mir uebernommen` angezeigt.
- Browser-Smoke Tablet offline: QA-Server gestoppt, Wechsel zwischen den zwei uebernommenen Auftraegen lief aus Cache; Offline-Aenderung an Auftrag A blieb Auftrag A zugeordnet, Auftrag B blieb unveraendert.

## 2026-06-22 - SSI-Stellplatzregel AA-AT

Backup:

- Code-Backup: `Backups/code-backup-storage-bin-aa-at-20260622-131111/`
- SQLite-Snapshot: `data/sqlite-backup-before-storage-bin-aa-at-20260622-131111/`

Umgesetzt:

- SSI-Shelf-Ausnahme eingegrenzt: nur `AA...` bis `AT...` normalisieren nach `002-H1-SA...`.
- Alle anderen Werte mit erstem Buchstaben `A` bis `N` laufen ueber die allgemeine Regel nach `002-H4-S...`; `O` bis `Z` bleibt `002-H3-S...`.
- Regressionstest fuer `AU8A1 -> 002-H4-SAU8A1` ergaenzt.

## 2026-06-22 - SSI-Stellplatzregel A-Prefix

Backup:

- Code-Backup: `Backups/code-backup-storage-bin-a-prefix-20260622-130257/`
- SQLite-Snapshot: `data/sqlite-backup-before-storage-bin-a-prefix-20260622-130257/`

Umgesetzt:

- SSI-Shelf-Regel korrigiert: Werte von `AA...` bis `AT...` normalisieren nach `002-H1-SA...`.
- Werte mit erstem Buchstaben `A` bis `N`, sofern nicht `AA...` bis `AT...`, normalisieren nach `002-H4-S...`; `O` bis `Z` bleibt `002-H3-S...`.
- Regressionstests fuer `AA8C3 -> 002-H1-SAA8C3` und `AT8A1 -> 002-H1-SAT8A1` ergaenzt.
- Vorhandene falsch gebuchte SSI-Daten korrigiert: 5 Bestandszeilen, 5 Wareneingangsbewegungen und 2 SSI-Artikelstammplaetze von `002-H4-SA...` nach `002-H1-SA...`.

## 2026-06-22 - Manuelle Einlagerung Mehrfachpositionen

Backup:

- Code-Backup: `Backups/code-backup-manual-storage-multi-20260622-124520/`

Umgesetzt:

- Desktop- und Tablet-Einlagerung um `Material` und `Anzahl Positionen` erweitert.
- `Anzahl Positionen` hat Default `1`, akzeptiert nur positive ganze Zahlen und ist auf `100` begrenzt.
- Mehrere manuelle Positionen derselben Artikelnummer werden als getrennte Zeilen angelegt; HU, Stellplatz und Ist-Menge bleiben je Position einzeln zu erfassen.
- Soll-Stueckzahl wird bei manuellen Einlagerungszeilen nicht mehr angezeigt und nicht mehr zur Leerzeilen-/Exportlogik benoetigt.
- Server-Regel `MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX` in `server/rules/order-rules.mjs` ergaenzt und fuer manuelle Einlagerungen abgesichert.
- CR-002 wurde nicht geaendert.

Pruefungen:

- Baseline vor Umsetzung: `npm.cmd run lint`, zentrale `node --check` Kommandos und `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 26/26 Checks.
- QA-Matrix wurde um manuelle Einlagerungs-Mehrfachpositionen, fehlende Sollmenge, ungueltige Positionsanzahl und SSI-HU-Regel ergaenzt.

## 2026-06-22 - Regel-Refactoring

Backup:

- Code-Backup: `Backups/code-backup-rules-refactor-20260622-100729/`
- Git-Status vor Umsetzung: `Backups/code-backup-rules-refactor-20260622-100729/git-status-before.txt`
- QA-Kopie: `tmp/rules-refactor-qa/` auf Port `4175`

Umgesetzt:

- Rollenmatrix, statische Serverdateien, App-Seiten, Artikel-/Gebinderegeln, Lager-/SSI-Stellplatzregeln, einfache Auftrags-/Kundenregeln und Export-Vollstaendigkeitsregel in Regelmodule ausgelagert.
- `server/helpers.mjs` behaelt Kompatibilitaets-Exports fuer bestehende Imports.
- `service-worker.js` bleibt klassisches Script; App-Shell-Liste ist in `docs/RULES_OVERVIEW.md` als manuell synchronisiert dokumentiert.
- CR-002 wurde nicht geaendert.

Pruefungen:

- Baseline vor Refactoring: `npm.cmd run lint`, zentrale `node --check` Kommandos, `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 24/24 Checks.
- Nach Stage 1, Stage 2 und Stage 3 jeweils: Lint, Syntaxchecks und QA-Matrix mit 24/24 Checks.
- Finaler CR-002-Zusatzcheck gegen QA-Kopie: Export eines abgehakten Auftrags mit Bestandsbuchungsfehler blieb erlaubt (`ok: true`, `stockIssueErrors: 1`).

## Ausgangslage

Der aktuelle Arbeitsbaum wurde als Baseline verwendet. Bereits vorhandene uncommitted Aenderungen wurden nicht zurueckgesetzt. Die aktuellen Dokumente in `docs/` dienten als Arbeitsstand.

## Backup

Vor diesem Risiko-Lauf wurden folgende Sicherungen erstellt:

- Code-Backup: `Backups/code-backup-robustness-risk-fixes-20260622-083308/`
- Anzahl gesicherter Code-Dateien: 49
- SQLite-Snapshot: `data/sqlite-backup-before-risk-fixes-20260622-083308/`
- Gesicherte Datenbankdateien: `artikel-si.sqlite`, `artikel-ssi.sqlite`, `logistik.sqlite` inklusive WAL/SHM-Dateien sowie vorhandene SQLite-Sicherungsdatei

Vorheriger Audit-Backupstand bleibt bestehen:

- Code-Backup: `Backups/code-backup-audit-fixes-20260622-072101/`
- SQLite-Snapshot: `data/sqlite-backup-before-audit-fixes-20260622-072101/`

## Entscheidungen pro Risiko

### QA-003 / RISK-002

Entscheidung: teilweise direkt behebbar.

Umgesetzt: klare Startdiagnose und Wiederherstellungshinweis bei korrupten SQLite-Dateien.

Nicht umgesetzt: automatische Reparatur, Quarantaene oder Restore.

### QA-005 / RISK-003

Entscheidung: risikoarm direkt behebbar als Warnung.

Umgesetzt: Startwarnung, wenn `ARTICLE_DELETE_PASSWORD` nicht gesetzt ist.

Nicht umgesetzt: harter Startabbruch ohne gesetztes Passwort.

### QA-004 / RISK-004

Entscheidung: sicher direkt behebbar.

Umgesetzt: konsistenter Service-Worker-Fallback fuer bekannte Desktop-Unterseiten.

### RISK-006

Entscheidung: sicher direkt behebbar.

Umgesetzt: `scripts/qa-api-matrix.mjs` und `npm run test:qa`.

### RISK-007

Entscheidung: nur dokumentieren.

Umgesetzt: LAN-Schutzcharakter in Doku klar beschrieben. Keine echte Authentifizierung eingebaut.

## Durchgefuehrte Code-Aenderungen

### `server.mjs`

- Startup in `initializeApplication()` gekapselt.
- Startfehler werden mit klarer Diagnose ausgegeben.
- SQLite-Korruptionsfehler erhalten konkrete Wiederherstellungshinweise.
- `ARTICLE_DELETE_PASSWORD`-Fallback gibt Warnung aus.

### `service-worker.js`

- Cache-Version auf `1.5.113` erhoeht.
- Navigation-Fallback fuer bekannte App-Seiten vereinheitlicht.

### `manifest.webmanifest`

- Version auf `1.5.113` erhoeht.

### `package.json`

- `test:qa` Script ergaenzt.

### `scripts/qa-api-matrix.mjs`

- API-Matrix versioniert.
- Default-Ziel ist `http://127.0.0.1:4175`.
- Schutz gegen versehentliche Live-Schreibtests auf Port 4174.

## Ausgefuehrte Kommandos

- `npm.cmd run lint`
- `node --check server.mjs`
- `node --check service-worker.js`
- `node --check scripts/qa-api-matrix.mjs`
- `node --check` fuer zentrale Server-/Frontend-Dateien
- isolierter Serverstart auf Port 4175
- `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa`
- korrupte SQLite-Testkopie auf Port 4177
- isolierter Service-Worker-Fallback-Test per Node VM
- Browser-Smoke Desktop und Tablet gegen Port 4174

## Testergebnisse

- Baseline Lint: bestanden
- Baseline Syntaxchecks: bestanden
- Nach Fix Lint: bestanden
- Nach Fix Syntaxchecks: bestanden
- `npm run test:qa` gegen isolierte Kopie: 21/21 bestanden
- Korrupte SQLite-Dateien: klare Diagnose bestaetigt
- Service-Worker-Fallback: alle erwarteten Pfade bestanden
- Browser-Smoke: Desktop und Tablet ohne Konsolenfehler und ohne horizontalen Overflow

## Bewusst nicht geaendert

CR-002 wurde nicht behoben. Der Export darf weiterhin trotz Bestandsbuchungsfehlern abschliessen und den Fehler protokollieren.

## Offene Punkte

Siehe `docs/OPEN_RISKS.md`.

## 2026-06-23 - QA-Exportartefakte bereinigt

Ausgangsproblem:

Automatisierte QA-Laeufe riefen den echten PDF-Export-Endpunkt auf. Dadurch wurden Dateien wie `QA-ST-*.pdf`, `QA-MST-*.pdf`, `QA-CR002-*.pdf` und `QA-TABEXP-*.pdf` in den konfigurierten Exportordner geschrieben.

Analyseergebnis:

- `scripts/qa-api-matrix.mjs` nutzte fuer CR-002, Tablet-Direktexport und Einlagerabschluss dieselbe Exportroute wie produktive Benutzer.
- `server/export.mjs` schrieb immer ein HTML in `tmp/`, ein PDF in den Exportordner und kopierte das PDF zusaetzlich in `Exporte/`.
- Es gab keinen QA-/Discard-Modus und keine Artefaktpruefung nach dem Testlauf.

Umgesetzt:

- `server.mjs` akzeptiert `x-qa-discard-export: 1` nur fuer lokale Requests und QA-Auftraege mit `QA-` Kennung.
- `server/export.mjs` erzeugt im Discard-Modus das PDF nur im Tempordner, kopiert nichts und loescht HTML/PDF im `finally`.
- Normale Benutzerexporte ohne QA-Header schreiben weiterhin echte PDFs.
- `scripts/qa-api-matrix.mjs` nutzt den Discard-Modus fuer Exporttests und prueft danach, dass fuer den aktuellen Lauf keine `QA-*.pdf` oder `QA-*.html` in dauerhaften Exportzielen liegen.

CR-002:

Unveraendert. Der Test prueft weiterhin, dass der Kommissionierexport trotz Bestandsbuchungsfehlern fachlich erlaubt bleibt; nur das dauerhafte PDF-Artefakt wird im QA-Lauf verworfen.

## 2026-06-23 - Manuelle Einlagerungspositionen: Stellplatz leer, Stueckzahl explizit

Ausgangsproblem:

Beim manuellen Anlegen weiterer Einlagerungspositionen wurde der Stellplatz ueber den Artikelstamm-Lookup in neue Zeilen uebernommen. Dadurch starteten neue Positionen nicht leer und mehrere Positionen derselben Artikelnummer konnten unbeabsichtigt denselben Stellplatz erhalten.

Umgesetzt:

- Desktop und Tablet zeigen beim Anlegen manueller Positionen ein Feld `Stueckzahl`.
- Die eingegebene Stueckzahl wird in `actualQty` gespeichert; `targetQty` bleibt fuer manuelle Positionen leer.
- Neue manuelle Positionen starten immer mit leerem `fromBin`; der Artikelstamm-Lookup setzt nur noch Materialnummer und Artikelbezeichnung.
- Serverseitig werden manuelle Positionen mit Inhalt gegen positive ganzzahlige Stueckzahl validiert und liefern fachliche 400-Fehler.
- QA-Matrix um Client-/Serverchecks fuer leeren Stellplatz, Stueckzahl, leere Sollmenge und ungueltige Mengen erweitert.

CR-002:

Unveraendert. Der Kommissionierexport trotz Bestandsbuchungsfehlern bleibt bewusst aktiv.

## 2026-06-25 - PDF-Import: OCR-verwechselte SSI-Von-Lagerplaetze normalisieren

Ausgangsproblem:

Beim Auftrag `20260625125646.pdf` wurden einzelne SSI-Von-Lagerplaetze aus der OCR mit typischen Zeichenverwechslungen uebernommen, z. B. `002-H3-5010A2` statt `002-H3-SO10A2` und `002-H3-5Z2D1` statt `002-H3-SZ2D1`.

Analyseergebnis:

- Der Zielplatz `9021-00UT` wurde bereits korrekt zu `9021-0OUT` normalisiert.
- Die falschen Von-Lagerplaetze standen schon im importierten Rohtext; der nachgelagerte Bestandsabgleich hat sie nicht erzeugt.
- Die vorhandene Plausibilitaetspruefung erkannte solche Werte als auffaellig, durfte aber nach der letzten UI-Entschaerfung nicht mehr aggressiv mit `Lagerplatz unklar` markieren.

Umgesetzt:

- `app.js` normalisiert erkannte Stellplatz-Token jetzt direkt beim Extrahieren.
- In SSI-Regalfachcodes wird ein OCR-`5` am Codeanfang als `S` behandelt.
- Fuer `002-H3-S...` wird ein OCR-`0` direkt nach `S` als Bereichsbuchstabe `O` behandelt, wenn danach die Fachnummer folgt.
- Beispiele: `002-H3-5010A2 -> 002-H3-SO10A2`, `002-H3-5Z2D1 -> 002-H3-SZ2D1`.
- Asset-/Cache-Versionen wurden erhoeht.
- QA-Matrix um einen Regressionstest mit den betroffenen Mustern erweitert.

Hinweis:

Der bereits importierte Live-Auftrag wurde nicht automatisch veraendert. Fuer korrigierte Stellplaetze muss er neu importiert oder nach Freigabe gezielt korrigiert werden.

CR-002:

Unveraendert. Der Kommissionierexport trotz Bestandsbuchungsfehlern bleibt bewusst aktiv.

## 2026-06-25 - PDF-Import: OCR-only und keine Stellplatzkorrektur

Ausgangsproblem:

Nach den letzten Import-Reparaturen wurden Von-Lagerplaetze im Kommissionier-PDF-Import zu stark veraendert. Besonders problematisch waren Stellplatz-Plausibilitaet, praeziser Nachscan, OCR-Zeichenkorrektur und nachgelagerter Bestandsabgleich.

Analyseergebnis:

- Der Kommissionier-PDF-Pfad konnte bisher zwischen OCR und PDF-Textschicht waehlen.
- `refinePickingBinsWithPreciseScan` konnte auffaellige Von-Lagerplaetze durch einen spaeteren OCR-Kandidaten ersetzen.
- `normalizeExtractedWarehouseBin` korrigierte OCR-Zeichen wie `5 -> S` und `0 -> O` innerhalb von Stellplaetzen.
- `applyStorageBinsFromArticleStock` konnte den importierten Von-Lagerplatz aus dem Artikelbestand ersetzen.

Umgesetzt:

- Kommissionier-PDFs nutzen nur noch den hochaufloesenden OCR-Pfad mit `OCR_RENDER_SCALE = 6`, `OCR_RENDER_DPI = 1000`, Rotationen `0/90/180/270` und den bestehenden Praezisionswerten `OCR_PRECISE_RENDER_SCALE = 7.5`, `OCR_PRECISE_RENDER_DPI = 1600`.
- Die PDF-Textschicht und der einfache PDF-Text-Fallback werden fuer Kommissionier-PDFs nicht mehr als Importquelle verwendet.
- Der Stellplatz-Nachscan ist im Kandidatenbau deaktiviert.
- Von-Lagerplaetze werden beim Extrahieren nur noch technisch bereinigt: trimmen, Whitespace entfernen, Bindestriche vereinheitlichen.
- Keine automatische `O/0`-, `S/5`-, `I/1`- oder SSI-Regelkorrektur mehr fuer Von-Lagerplaetze.
- Der Bestandsabgleich darf importierte Von-Lagerplaetze nicht mehr ersetzen oder leer auffuellen.
- Importdiagnose und QA-Matrix wurden auf Rohwert gleich finalem Von-Lagerplatz erweitert.

Beispiel:

- `002-H3-SO4D1 -> 002-H3-SO4D1`
- `002-H3-5010A2 -> 002-H3-5010A2`
- `002-H3-5Z2D1 -> 002-H3-5Z2D1`

CR-002:

Unveraendert. Der Kommissionierexport trotz Bestandsbuchungsfehlern bleibt bewusst aktiv.

## 2026-06-24 - Originaldatei nach erfolgreichem PDF-Export archivieren

Ausgangsproblem:

Nach dem Import blieb die eingelesene Originaldatei im Eingangsordner liegen, auch wenn die neue Export-PDF erfolgreich erstellt wurde.

Analyseergebnis:

- Der Browser liefert beim Dateiimport nur den Dateinamen, nicht den vollstaendigen lokalen Pfad.
- Der Server kann die Originaldatei deshalb nur sicher ueber einen verwalteten Importordner aufloesen.
- Der eindeutige Erfolgspunkt ist nach erfolgreicher PDF-Erzeugung und `markOrderExported`.

Umgesetzt:

- Neue optionale Auftragsfelder fuer Originaldatei, Archivstatus und Archivfehler ergaenzt.
- `HLOGISTIK_IMPORT_DIR` bzw. `import-path.txt` konfiguriert den Importordner; Fallback ist der Exportordner.
- `HLOGISTIK_ARCHIVE_DIR` konfiguriert den Archivordner; Fallback ist `<Importordner>/Archiv`.
- Originaldateien werden erst nach erfolgreichem PDF-Export archiviert.
- Namenskollisionen im Archiv erzeugen eindeutige Dateinamen; vorhandene Archivdateien werden nicht ueberschrieben.
- Wenn die Archivierung fehlschlaegt, bleibt der PDF-Export erfolgreich, aber Fehler werden protokolliert und im Exportergebnis gemeldet.
- QA-Matrix prueft Erfolg, Validierungsfehler, Kollision, bereits archiviert, fehlende Datei, fehlende Metadaten, ungueltigen Dateinamen und Cleanup.

CR-002:

Unveraendert. Ein bewusst erfolgreicher Export trotz Bestandsbuchungsfehlern gilt weiterhin als erfolgreicher Export und kann die Originaldatei archivieren.

## 2026-06-23 - Tablet-PDF-Export loescht Auftrag erst nach PDF-Erfolg

Ausgangsproblem:

Auf dem Tablet konnte eine Einlagerung beim Abschluss serverseitig gespeichert und danach lokal aus dem aktuellen Ablauf entfernt werden, obwohl die PDF-Erstellung nicht erfolgreich abgeschlossen wurde.

Analyseergebnis:

- `tablet-legacy.js` und `tablet.js` entfernten lokale Sync-Mutationen bereits vor dem eigentlichen PDF-Exportaufruf.
- `server/export.mjs` verliess sich auf den erfolgreichen Browser-Prozess, pruefte aber nicht explizit, ob die PDF-Datei danach existiert und Inhalt hat.

Umgesetzt:

- Tablet raeumt lokale Auftrags-/Sync-Spuren erst nach einer bestaetigten Serverantwort `ok: true` vom PDF-Export auf.
- Der Server prueft nach dem Headless-Browser-Aufruf, dass die PDF-Datei existiert und nicht leer ist.
- Bei fehlender oder leerer PDF bricht der Export mit fachlicher Fehlermeldung ab; der Auftrag wird nicht als exportiert markiert.
- Service-Worker-/Manifest-Version und Tablet-Skriptversion wurden erhoeht.
- QA-Matrix prueft die Reihenfolge Tablet-PDF-vor-Aufraeumen und die serverseitige PDF-Dateipruefung.

CR-002:

Unveraendert. Der Kommissionierexport trotz Bestandsbuchungsfehlern bleibt bewusst aktiv.
