# APP_JS Phase 2 Split Plan

Stand: 2026-07-03 07:20:23 +02:00

## Kurzfazit

`app.js` ist aktuell der zentrale Browser-Einstiegspunkt fuer die Desktop-Kommissionierung und enthaelt Bootstrap, PDF-/OCR-Import, Parsing, UI-Rendering, State-Synchronisierung, Serverkommunikation, Offline-Queue, Auftragsverwaltung und Exportablaeufe in einer Datei. Eine Zerlegung ist sinnvoll, muss aber konservativ erfolgen, weil viele Funktionen direkt ueber globale Variablen (`state`, `elements`, `currentUser`, `currentMode`) gekoppelt sind und die QA-Matrix einzelne Funktionen aus `app.js` in einer VM testet.

Phase 2 sollte deshalb nicht mit der PDF-/OCR-Hauptpipeline beginnen. Der risikoaermste erste Schritt ist ein kleiner Extract reiner Import-Zeilen- und Normalisierungshelfer in ein klassisches Browser-Skript, das vor `app.js` geladen wird.

CR-002 bleibt unveraendert: Der Kommissionierexport darf trotz Bestandsbuchungsfehlern weiter abschliessen.

## 1. Aktueller Befund zu `app.js`

### Grobe Funktionsbereiche

- Bootstrap und DOM-Bindung: `bindElements`, `bindEvents`, `configurePdfJs`, `registerServiceWorker`, `loadCurrentMode`, `loadCurrentUser`, `applyWarehouseSelection`.
- PDF-/OCR-Import: `handlePdfUpload`, `handleImageUpload`, `readPdfPages`, `chooseBestImportText`, `readPdfWithOcr`, `createOcrWorker`, `readPickingPdfWithOcrCandidate`, `readPickingPdfOcrCandidateSet`, `readLoadingSlipOcrFallbackIfNeeded`.
- Import-Kandidatenauswahl und Diagnostik: `buildPickingImportCandidate`, `chooseBestPickingImportCandidate`, `scorePickingImportCandidate`, `buildPickingOcrCandidate`, `scorePickingOcrCandidate`, `pickingImportDiagnostics`, `buildPickingImportLineDiagnostics`.
- Text- und Positionsparser: `parseOrderText`, `appendOrderHintFromText`, `appendLoadingSlipLines`, `collectLoadingSlipLinesFromOcrCandidates`, `parseLoadingSlipLines`, `validatePickingImport`, `collectBestellscheinRows`, `parseWarehouseLine`, `parseWarehouseLineByColumns`, `parseWarehouseLineWithoutBin`.
- Einlagerungsparser: `importStorageText`, `parseStorageSlipText`, `collectStoragePageRows`, `parseStoragePageLine`, `parseStorageLine`.
- Zielkunde und Nach-Lagerplatz: `findDestinationCustomer`, `normalizeDestinationValue`, `applyDestinationCustomerRule`, `destinationPattern`.
- Positions- und Notizhelfer: `createLine`, `normalizeAutoPositionNotes`, `setAutoPositionNote`, `combinedPositionNote`, `combineUniqueNoteParts`, `normalizeQuantity`, `normalizeUnit`, `parseImportQuantityValue`, `readPositiveQuantity`.
- UI-Rendering und DOM-Sync: `render`, `renderStorageLineActions`, `renderModeControls`, `syncFields`, `syncStateFromFields`, `syncLineFieldsFromDom`, `updateLine`.
- Manuelle Einlagerung: `addManualStorageLine`, `createManualStorageLine`, `nextManualStoragePosition`, `readManualStoragePositionCreateCount`, `readManualStoragePositionQuantity`, `manualStorageLinePreset`.
- Serverstatus, Auftragsliste und Offline-Queue: `initializeServer`, `startConnectionMonitor`, `setConnectionStatus`, `flushSyncQueue`, `loadOrderList`, `loadOrderListFromCache`, `cacheSyncedQueueOrder`.
- Auftrags- und Exportablaeufe: `loadOrder`, `saveOrderNow`, `releaseCurrentOrder`, `discardCurrentDraft`, `deleteCurrentOrder`, `currentOrderPayload`, `exportCsv`, `exportPdf`.

### Hauptverantwortlichkeiten

- `app.js` initialisiert die Desktopseite und haelt den gesamten Browserzustand.
- Die Datei liest PDFs/Bilder, fuehrt PDF.js und Tesseract aus, waehlt OCR-Kandidaten aus und parst Kommissionier- und Einlagerungsauftraege.
- Sie rendert alle Desktop-Positionen und synchronisiert DOM-Felder zurueck in `state`.
- Sie kommuniziert mit dem Server, verwaltet Offline-Zustaende und fuehrt Auftragsfreigabe, Speichern, Loeschen und Export aus.

### Staerkste Kopplungen

- Fast alle Workflows haengen an den globalen Objekten `state` und `elements`.
- `importText` und `importStorageText` verbinden Parsing, Lagererkennung, State-Mutation, Offline-Speicherung, Statusmeldungen und Rendering.
- `render` erzeugt DOM, bindet Eventhandler, ruft Formatierungs-/HU-/Einlagerungshelfer auf und veraendert damit indirekt State.
- Die QA-Matrix (`scripts/qa-api-matrix.mjs`) laedt `app.js` in einer VM und erwartet konkrete Funktionsnamen wie `__parseOrderText`, `__validatePickingImport`, `__importText`, `__buildPickingOcrCandidate` und `__state`.
- Neue Browser-Skripte muessen synchron in `index.html`, `server/config/static-files.mjs`, `service-worker.js` und bei Frontendaenderungen in Asset-/Cache-Versionen beruecksichtigt werden.

### Riskante Bereiche

- PDF-/OCR-Hauptpipeline: OCR-DPI, Rotation, Kandidatenauswahl, Ladelisten-Fallback und Diagnostik sind empfindlich und duerfen nicht als erster Extract verschoben werden.
- Stellplatzbehandlung im PDF-Import: Der Import darf Stellplaetze nicht durch SSI-Stellplatzvalidierung oder Lagerbestand korrigieren.
- `importText`: Aendert globalen Zustand, setzt Kunde/Auftragsnummer/Lager, ruft Validierung und Rendering auf.
- Export- und Speicherpfade: `exportPdf`, `saveOrderNow`, `releaseCurrentOrder`, Offline-Queue und CR-002 duerfen nicht nebenbei veraendert werden.
- UI-Rendering: Viele DOM-IDs aus `index.html` und Inline-Eventhandler-Strukturen sind direkt mit `app.js` gekoppelt.

## 2. Vorgeschlagene Zielstruktur

### Skriptform

Fuer Phase 2 werden weiterhin klassische Browser-Skripte empfohlen, keine ES-Module.

Begruendung:

- `index.html` nutzt aktuell `defer`-Skripte in definierter Reihenfolge.
- `tablet-legacy.js` und der Service Worker bleiben auf konservative Browser-Kompatibilitaet ausgelegt.
- Die bestehenden Shared-Skripte (`shared/storage-hu-rules.js`, `shared/manual-storage-rules.js`, `order-hint-rules.js`) verwenden `window.*`-Namespaces.
- Eine ES-Modul-Umstellung wuerde Ladeverhalten, Tests, Service-Worker-Cache und alte Geraete gleichzeitig betreffen.

### Sinnvolle kuenftige Dateien

- `app-import-line-helpers.js`
  - Reine Import- und Zeilen-Normalisierung ohne DOM, OCR und Serverzugriff.
  - Namespace: `window.HLogistikImportLineHelpers`.
- `app-picking-parser.js`
  - Kommissionier-Textparser, Bestellschein-Zeilenparser, Ladelisten-Textparser.
  - Namespace: `window.HLogistikPickingParser`.
- `app-storage-parser.js`
  - Einlagerungs-Textparser und Einlagerungsseiten-Zeilenparser.
  - Namespace: `window.HLogistikStorageParser`.
- `app-import-diagnostics.js`
  - Importdiagnostik, Zeilendiagnostik und reine Bewertungshelfer, soweit ohne OCR-/Canvas-Seiteneffekte moeglich.
  - Namespace: `window.HLogistikImportDiagnostics`.
- `app-state-helpers.js`
  - Kleine reine State-Helfer ohne Serverzugriff, z. B. Zaehler, Payload-Vorbereitung, Feldnormalisierung.
  - Namespace: `window.HLogistikStateHelpers`.
- `app-ui-helpers.js`
  - Kleine UI-Formatierungs- und DOM-Helfer, aber nicht `render` selbst.
  - Namespace: `window.HLogistikUiHelpers`.

### Noetige Einbindungen bei spaeterer Umsetzung

- `index.html`
  - Neue klassische Skripte muessen vor `app.js` eingebunden werden.
  - Reihenfolge muss Abhaengigkeiten abbilden: bestehende Shared-Regeln zuerst, neue Helper danach, `app.js` zuletzt.
- `server/config/static-files.mjs`
  - Neue Browserdateien muessen in die Static-Allowlist aufgenommen werden.
- `service-worker.js`
  - Neue Browserdateien muessen in `APP_SHELL` aufgenommen werden.
  - Bei Frontendaenderungen Cache-Version und Asset-Versionen bumpen.
- `manifest.webmanifest`
  - Bei Frontendaenderungen Version synchron zum Service Worker halten.
- `scripts/qa-api-matrix.mjs`
  - Der VM-Harness muss neue Skripte vor `app.js` laden.
  - Exponierte Testfunktionen muessen entweder weiter aus `app.js` kommen oder gezielt aus dem neuen Namespace gelesen werden.

## 3. Empfohlene Extraktionsreihenfolge

### Schritt 2B: Kleinster sicherer erster Extract

Extract reiner Import-Zeilen- und Normalisierungshelfer nach `app-import-line-helpers.js`.

Ziel:

- Erste Entlastung von `app.js`, ohne OCR, DOM, Server, Offline-Queue oder Exportpfade zu beruehren.

Betroffene Funktionen:

- `normalizeQuantity`
- `normalizeUnit`
- `isUnitToken`
- `parseImportQuantityValue`
- `readPositiveQuantity`
- `combineUniqueNoteParts`
- `normalizeAutoPositionNotes`
- `autoPositionNoteValues`
- `setAutoPositionNote`
- `combinedPositionNote`

Neue Datei:

- `app-import-line-helpers.js`

Abhaengigkeiten:

- Keine DOM-Abhaengigkeit.
- Keine Server-Abhaengigkeit.
- Bestehende Funktionen in `app.js` koennen zunaechst als duenne Wrapper bestehen bleiben, damit die QA-Matrix und interne Aufrufe stabil bleiben.

Risiko:

- Niedrig bis mittel. Die Funktionen sind klein, werden aber an vielen Parser- und Render-Stellen verwendet.

Benoetigte Tests:

- `npm.cmd run check:precommit`
- QA-Kopie auf Port 4175
- `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa`
- Desktop-Smoke Import mit Kommissionier-PDF
- Smoke, dass Zusatzbemerkungen und Ladelisten weiterhin identisch angezeigt werden

Abbruchkriterien:

- Eine Menge, Einheit, Zusatzbemerkung oder Ladelistenzeile wird nach dem Extract anders importiert.
- Die QA-Matrix kann `app.js` nicht mehr im VM-Harness laden.
- Alte Browser melden Syntaxfehler durch moderne Syntax.

### Schritt 2C: Naechster Extract

Extract reiner Import-/OCR-Diagnosehelfer nach `app-import-diagnostics.js`.

Ziel:

- Diagnoseformatierung aus `app.js` loesen, ohne Parser, OCR-Hauptpipeline, Kandidatenauswahl oder Import-State-Mutation zu verschieben.

Betroffene Funktionen:

- `pickingImportDiagnostics`
- `logPickingImportDiagnostics`
- `pickingImportNoLinesMessage`
- `buildPickingImportLineDiagnostics`
- `pickingImportBinDiagnosticReason`
- `logPickingImportLineDiagnostics`
- `pickingOcrCandidateDiagnostic`

Neue Datei:

- `app-import-diagnostics.js`

Abhaengigkeiten:

- `app-import-line-helpers.js`
- uebergebene Parser-/Audit-Helfer aus `app.js`
- `console` fuer die bisherigen Diagnoseausgaben

Risiko:

- Niedrig bis mittel. Die Funktionen formatieren Diagnosewerte und Konsolenausgaben, duerfen aber keine Feldwerte, Scores oder Kandidaten veraendern.

Benoetigte Tests:

- QA-Matrix inklusive Importdiagnose, Positionsdiagnose, Ladelisten-Diagnose und Roh-/Final-Stellplatzdiagnose.
- Browser-Smoke Desktop.
- Pruefung, dass `PDF-Import Diagnose` und `PDF-Import Positionsdiagnose` weiterhin erscheinen.

Abbruchkriterien:

- QA-Harness kann `app.js` nicht mehr laden.
- Diagnosefelder fehlen oder enthalten andere Werte.
- OCR-Kandidatenbewertung, Importpositionen, Mengen, Nach-Lagerplatz oder Ladelisten aendern sich.

### Schritt 2D: Spaeterer Extract

Extract der reinen Kommissionier-Textparser nach `app-picking-parser.js`.

Ziel:

- `parseOrderText` und eng verwandte reine Parser aus `app.js` loesen, ohne OCR-Auswahl oder State-Mutation zu verschieben.

Betroffene Funktionen:

- `parseOrderText`
- `appendOrderHintFromText`
- `appendLoadingSlipLines`
- `collectLoadingSlipLinesFromOcrCandidates`
- `parseLoadingSlipLines`
- `validatePickingImport`
- `collectBestellscheinRows`
- `parseBestellscheinRow`
- `parseWarehouseLine`
- `parseWarehouseLineByColumns`
- `parseWarehouseLineWithoutBin`
- `bestellscheinCustomerName`
- `findDestinationCustomer`
- `normalizeDestinationValue`
- `normalizeDestinationCustomerValue`
- `applyDestinationCustomerRule`
- `destinationPattern`

Neue Datei:

- `app-picking-parser.js`

Abhaengigkeiten:

- `order-hint-rules.js`
- `shared/storage-hu-rules.js`
- `app-import-line-helpers.js`
- `app-import-diagnostics.js`
- `createLine` oder ein injizierter Line-Factory-Wrapper

Risiko:

- Mittel bis hoch. Dieser Bereich ist fachlich wichtig und wird durch OCR-Sonderfaelle, Bestellhinweis, Ladeliste und Nach-Lagerplatz-Regeln beeinflusst.

Benoetigte Tests:

- QA-Matrix inklusive SI-Bestellschein, SSI-Auftrag, Ansbach/Insel-Faelle, Ladelistenanhaengung und Bestellhinweis.
- Browser-Smoke Desktop mit echtem PDF-Import.
- Pruefung, dass keine Stellplatzvalidierung im PDF-Import eingefuehrt wurde.

Abbruchkriterien:

- Positionen werden nicht mehr importiert.
- Nach-Lagerplatz, Kunde, Bestellhinweis oder Ladeliste weichen ab.
- Mengen werden durch den Extract neu angepasst oder anders korrigiert.

### Schritt 2E: Kleiner State-/Line-Extract

Extract kleiner reiner Line-/State-Helfer nach `app-state-helpers.js`.

Ziel:

- UI-/State-Grenze vorbereiten, ohne `render()`, `updateCounts()`, Exportpfade, Parser oder Import-State-Mutation zu verschieben.

Betroffene Funktionen:

- `compareStorageBins`
- `getPickingLines`
- `isQuantityChanged`

Neue Datei:

- `app-state-helpers.js`

Abhaengigkeiten:

- Nur uebergebene Parameter.
- Keine DOM-, Server-, Storage-, OCR-, Canvas-, Export- oder globale State-Mutation.

Risiko:

- Niedrig bis mittel. Die Funktionen sind klein, beeinflussen aber Positionssortierung und die Zaehler fuer korrigierte Mengen.

Benoetigte Tests:

- QA-Matrix inklusive Kommissionier-PDF-Import-Smokes.
- Browser-Smoke Desktop fuer `/`.
- Pruefung, dass Positionssortierung und erledigt/offen/korrigiert-Zaehler unveraendert bleiben.

Abbruchkriterien:

- Positionssortierung aendert sich.
- Erledigt/offen/korrigiert-Zaehler aendern sich.
- Importpositionen, Mengen, Nach-Lagerplatz oder Ladelisten aendern sich.

### Schritt 2F: Spaeterer Extract

Extract der Einlagerungsparser.

Ziel:

- Einlagerungs-Textparser von UI-/State-Code trennen.

Betroffene Funktionen:

- `parseStorageSlipText`
- `collectStoragePageRows`
- `parseStoragePageLine`
- `parseStorageLine`
- `storageLooksLikeMaterial`
- `storageLooksLikeBin`
- `storageLooksLikeHu`
- `storageLooksLikeQuantity`
- `pendingLineCount`
- `completedLineCount`
- `correctedLineCount`
- `currentOrderPayload` nur spaeter und nur mit unveraendertem Output

Neue Dateien:

- `app-storage-parser.js`

Abhaengigkeiten:

- `shared/storage-hu-rules.js`
- `shared/manual-storage-rules.js`
- `app-state-helpers.js`
- bestehende Server-/Browser-Regeln fuer HU nur lesend

Risiko:

- Mittel. Manuelle Einlagerung, HU-Pflicht nur bei Kunde SSI und bearbeitbare HU/LE-Felder duerfen nicht beeinflusst werden.

Benoetigte Tests:

- QA-Matrix fuer manuelle Einlagerung und Storage-Import.
- Tablet-Smoke fuer manuelle Einlagerung.
- Desktop-Smoke fuer bearbeitbare HU/LE-Felder vor Freigabe.

Abbruchkriterien:

- HU-Pflicht greift bei Nicht-SSI-Kunden.
- HU/LE-Felder werden vor Freigabe nicht mehr bearbeitbar.
- Manuelle Einlagerungspositionen oder Mengen unterscheiden sich.

### Schritt 2G: Bewusst noch nicht anfassen

In dieser Phase nicht extrahieren:

- PDF-/OCR-Hauptpipeline: `handlePdfUpload`, `readPdfWithOcr`, `readPickingPdfWithOcrCandidate`, `readPickingPdfOcrCandidateSet`, `readLoadingSlipOcrFallbackIfNeeded`, `buildPickingOcrCandidate`, OCR-Worker- und Canvas-Funktionen.
- Haupt-State-Mutation: `importText`, `importStorageText`, `clearCurrentOrder`, `loadState`, `saveState`.
- Haupt-UI-Rendering: `render`, `renderStorageLineActions`, `renderModeControls`, `syncFields`, `syncLineFieldsFromDom`, `updateLine`.
- Server-/Offline-/Auftragsablaeufe: `initializeServer`, `flushSyncQueue`, `loadOrderList`, `loadOrder`, `saveOrderNow`, `releaseCurrentOrder`, `discardCurrentDraft`, `deleteCurrentOrder`.
- Exportablaeufe: `exportPdf`, `exportCsv` und CR-002-relevante Pfade.

## 4. Bereiche, die vorerst in `app.js` bleiben sollen

- PDF-/OCR-Hauptpipeline und OCR-Kandidatensteuerung.
- Importzustandsaenderung in `importText` und `importStorageText`.
- UI-Rendering mit direktem DOM-Zugriff.
- Export-, Speicher-, Freigabe-, Loesch- und Offline-Ablaufe.
- Alles, was direkt von `state`, `elements`, aktiven Timern oder Serverstatus abhaengt.
- Service-Worker-Registrierung und Asset-Versionierung.

## 5. Schutzregeln fuer Phase 2

- Keine Verhaltensaenderung, nur mechanische Auslagerung.
- Keine Mischung mit `tablet.js` oder `tablet-legacy.js`.
- Keine Aenderung an CR-002.
- Keine Stellplatzvalidierung oder Stellplatznormalisierung im PDF-Import einfuehren.
- Keine Aenderung an Offline-/LocalStorage-/IndexedDB-Keys.
- Keine Aenderung an PDF-/OCR-DPI, Rotation, Kandidatenauswahl oder Mengenlogik.
- Keine DB-, Server-API- oder Exportformat-Aenderung.
- Neue Browser-Skripte muessen klassisches JavaScript bleiben und vor `app.js` geladen werden.
- Bei jeder Frontendaenderung Service-Worker, Static-Allowlist und Asset-Versionen konsistent halten.

## 6. Testplan fuer spaetere Phase-2-Umsetzungen

Pflichtchecks:

- `npm.cmd run check:precommit`
- `npm.cmd run lint`
- `npm.cmd run check:syntax`
- `git diff --check`
- `git diff --cached --check`

QA-Umgebung:

- Isolierte QA-Kopie auf Port 4175 starten.
- `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa`
- Keine Tests gegen den Live-Server auf Port 4174 schreiben lassen.
- Keine QA-PDF/XLSX/CSV/HTML-Artefakte zuruecklassen.

Manuelle Smokes:

- Desktop-Browser-Smoke fuer `/`.
- Kommissionier-PDF-Import-Smoke mit SI-Bestellschein und SSI-Auftrag.
- Smoke fuer Bestellhinweis an Auftragsnummer.
- Smoke fuer Ladelistenanhaengung.
- Smoke fuer Nach-Lagerplatz/Kunde `9021-0OUT`.
- Service-Worker-/Asset-Smoke nach Cache-Bump.
- Export-Sperre bei offenen Positionen.
- CR-002 unveraendert: Bestandsbuchungsfehler blockieren den Kommissionierexport weiterhin nicht.

## 7. Klare Empfehlung fuer Phase 2B

Als erster einzelner Extract wird `app-import-line-helpers.js` empfohlen.

Er darf beruehren:

- `app.js`
- `index.html`
- `server/config/static-files.mjs`
- `service-worker.js`
- `manifest.webmanifest`
- `scripts/qa-api-matrix.mjs`
- passende Dokumentation wie `docs/FIX_LOG.md` und `docs/RULES_OVERVIEW.md`

Er darf nicht beruehren:

- `tablet.js`
- `tablet-legacy.js`
- `server.mjs`
- Datenbankdateien oder Migrationen
- Exportlogik
- Offline-Queue-Ablauflogik
- PDF-/OCR-Hauptpipeline
- OCR-DPI, OCR-Kandidatenauswahl oder Mengenlogik
- CR-002-relevante Exportentscheidung

Der Extract sollte mit Wrappern in `app.js` beginnen. Dadurch bleiben bestehende interne Aufrufe und der QA-Harness stabil, waehrend die eigentliche Implementierung in `window.HLogistikImportLineHelpers` liegt.
