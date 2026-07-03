# Phase 2E: Plan fuer Picking-Parser-Extract

Stand: 2026-07-03

## Kurzfazit

Ein Extract der Picking-Parser ist deutlich riskanter als die bisherigen Helper-Extracts aus Phase 2B bis 2D-2. Die Parser bestimmen Positionen, Mengen, Kunde, Nach-Lagerplatz, Zusatzbemerkungen, Ladelistenzeilen sowie rohe und finale Von-Lagerplatz-Werte. Deshalb wird in Phase 2E zuerst nur geplant. Es wird kein Code verschoben und keine Import-, OCR-, Export-, Tablet-, Offline- oder DB-Logik geaendert.

## Zielbild

- Spaetere neue klassische Browser-Datei: `app-picking-parser.js`.
- Spaeterer Namespace: `window.HLogistikPickingParser`.
- Keine ES-Module, damit die bestehende `defer`-Einbindung und aeltere Browser-/Tablet-Kompatibilitaet nicht beruehrt werden.
- `app.js` behaelt fuer alle bestehenden Funktionsnamen duenne Wrapper, damit interne Aufrufe und der QA-Harness stabil bleiben.
- `app-picking-parser.js` wuerde vor `app.js` in `index.html` geladen.
- Bei einer spaeteren Umsetzung muessten `server/config/static-files.mjs`, `service-worker.js`, `manifest.webmanifest` und `scripts/qa-api-matrix.mjs` synchron aktualisiert werden.

## Kandidaten fuer spaetere Auslagerung

Diese Funktionen sind Kandidaten fuer einen spaeteren Extract, aber nicht alle im selben Schritt:

- `parseOrderText`
- `appendOrderHintFromText`
- `appendLoadingSlipLines`
- `appendLoadingSlipLinesToParsed`
- `collectLoadingSlipLinesFromOcrCandidates`
- `parseLoadingSlipLines`
- `validatePickingImport`
- `collectBestellscheinRows`
- `parseBestellscheinRow`
- `parseBestellscheinRowStrict`
- `parseBestellscheinRowFallback`
- `parseWarehouseLine`
- `parseWarehouseLineByColumns`
- `parseWarehouseLineWithoutBin`
- `parseWarehouseLineLoose`
- `bestellscheinCustomerName`
- reine Zielkunden-/Nach-Lagerplatz-Helfer nur, wenn sie keine Zustandsaenderung ausloesen.

## Vorerst nicht auslagern

Diese Bereiche bleiben vorerst in `app.js`, weil sie OCR, UI, Status, Serverzugriffe oder Ablaufsteuerung koppeln:

- `handlePdfUpload`
- `chooseBestImportText`
- `buildPickingImportCandidate`
- `readPickingPdfWithOcrCandidate`
- `readPickingPdfOcrCandidateSet`
- `readLoadingSlipOcrFallbackIfNeeded`
- `buildPickingOcrCandidate`
- `scorePickingOcrCandidate`
- `importText`
- `applyStorageBinsFromArticleStock`
- `render`
- `renderLoadingSlipLine`
- Export-, Speicher-, Server-, Offline- und DB-Ablaufe.

## Abhaengigkeitskarte

| Funktion | Liest / nutzt | Ruft auf | Factory noetig | Window-Helper | State / Elements | DOM / OCR / Canvas / Server / Storage | Risiko |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `parseOrderText` | Importtext, viele Parser-Helfer, Dokumenttyp-Erkennung | `appendOrderHintFromText`, `parseLoadingSlipLines`, Warehouse-/Bestellschein-Parser, Zielkunden-Helfer, `appendLoadingSlipLines` | ja, `createLine` | indirekt `HLogistikOrderHintRules`, Import-Line-Helper | nein | nein | hoch; zuletzt auslagern |
| `appendOrderHintFromText` | Auftragsnummer, Text | `extractOrderHint`, `appendOrderHintToOrderNumber` | nein | `HLogistikOrderHintRules` | nein | nein | niedrig |
| `appendLoadingSlipLines` | Positions- und Ladelistenarrays | Deduplizierung nach Barcode | nein | nein | nein | nein | niedrig |
| `appendLoadingSlipLinesToParsed` | Parsed-Objekt mit `lines` | `appendLoadingSlipLines` | nein | nein | nein | nein | niedrig |
| `collectLoadingSlipLinesFromOcrCandidates` | OCR-Kandidaten-Textdaten | `parseLoadingSlipLines`, `auditLoadingSlipImport` | indirekt ueber Ladelistenparser | nein | nein | kein eigener OCR-Zugriff | mittel |
| `parseLoadingSlipLines` | Textzeilen | Ladelistenblock-/Zeilenparser | indirekt, weil Ergebniszeilen `createLine` brauchen | Import-Line-Helper ueber Notiz-Helfer | nein | nein | mittel |
| `validatePickingImport` | Rohtext, Parsed-Ergebnis | Ladelisten-, Bestellschein-, Warehouse- und HU-Pruefhelfer | nein | Import-Line-Helper fuer Mengenwerte | nein | nein | mittel |
| `collectBestellscheinRows` | Textzeilen | Bestellschein-Zeilenparser, Mengen-/Token-Helfer | nein | Import-Line-Helper indirekt | nein | nein | mittel |
| `parseBestellscheinRowStrict` | Bestellschein-Zeile | HU-, Lagerplatz-, Mengen- und Einheiten-Helfer | nein | Import-Line-Helper | nein | nein | mittel |
| `parseBestellscheinRow` | Bestellschein-Zeile | HU-, Lagerplatz-, Mengen- und Einheiten-Helfer | nein | Import-Line-Helper | nein | nein | mittel |
| `parseBestellscheinRowFallback` | Bestellschein-Zeile, optionale Menge | Fallback-Helfer fuer HU, Lagerplatz, Menge, Einheit | nein | Import-Line-Helper | nein | nein | mittel |
| `parseWarehouseLine` | Lageraufgabe-Zeile | Spalten-, Ohne-Lagerplatz- und Loose-Parser | nein | Import-Line-Helper | nein | nein | hoch |
| `parseWarehouseLineByColumns` | Lageraufgabe-Zeile | Token-, HU-, Lagerplatz-, Produkt- und Mengen-Helfer | nein | Import-Line-Helper | nein | nein | hoch |
| `parseWarehouseLineWithoutBin` | Lageraufgabe-Zeile ohne sicheren Lagerplatz | Produkt-, Mengen- und Zusatzbemerkungs-Helfer | nein | Import-Line-Helper | nein | nein | hoch; Von-Lagerplatz darf nicht verfremdet werden |
| `parseWarehouseLineLoose` | unsichere Lageraufgabe-Zeile | loose Produkt-/Mengen-/Lagerplatz-Helfer | nein | Import-Line-Helper | nein | nein | hoch; groesste Importregressionsgefahr |
| `bestellscheinCustomerName` | Text, expliziter Kunde | `cleanCustomerName`, Dokumenttyp-Erkennung | nein | nein | nein | nein | niedrig bis mittel |
| reine Zielkunden-Helfer | Nach-Lagerplatz-Werte | Normalisierung, Kundengruppen-Fallbacks, Notiz-Helfer | nein | Import-Line-Helper fuer Notizen moeglich | nein, sofern nur reine Helfer | nein | mittel |

Nicht reine Zielkundenfunktionen wie `applyDefaultDestinationCustomer` und `applyCustomerOrderNumberRule` duerfen nicht in den Parser-Extract, weil sie `state` und `elements` veraendern.

## Empfohlene Extraktionsreihenfolge

### Phase 2E-1: Ladelisten-Helfer

Ziel: Nur `appendLoadingSlipLines`, `appendLoadingSlipLinesToParsed`, `collectLoadingSlipLinesFromOcrCandidates` und `parseLoadingSlipLines` mit ihren zwingend benoetigten internen Ladelisten-Helfern auslagern.

Abhaengigkeiten: `createLine` muss als Factory oder Wrapper-Abhaengigkeit stabil bleiben. Audit-Helfer fuer Ladelisten muessen gemeinsam betrachtet werden, damit die Ladelistenanzeige unveraendert bleibt.

Risiko: mittel. Abbruch, wenn Ladelistenzeilen fehlen, doppelt auftauchen, andere Positionsnummern erhalten oder Zusatzbemerkungen abweichen.

### Phase 2E-2: Bestellschein-Zeilenparser

Ziel: `collectBestellscheinRows`, `parseBestellscheinRow`, `parseBestellscheinRowStrict`, `parseBestellscheinRowFallback` und `bestellscheinCustomerName` auslagern.

Abhaengigkeiten: Mengen-/Einheiten-Wrapper aus `app-import-line-helpers.js`, HU-/Lagerplatz-Helfer und Dokumenttyp-Erkennung.

Risiko: mittel bis hoch. Abbruch, wenn SI-Bestellscheine weniger Positionen liefern, Mengen veraendert werden oder Kundenname/Nach-Lagerplatz abweichen.

### Phase 2E-3: Lageraufgabe-Zeilenparser

Ziel: `parseWarehouseLine`, `parseWarehouseLineByColumns`, `parseWarehouseLineWithoutBin`, `parseWarehouseLineLoose` und direkte reine Unterhelfer auslagern.

Abhaengigkeiten: Produkt-, HU-, Lagerplatz-, Zielkunden-, Mengen- und Zusatzbemerkungs-Helfer.

Risiko: hoch. Dieser Schritt darf erst nach stabilen Realtests erfolgen, weil falsche Von-Lagerplaetze zuletzt ein produktives Problem waren. Eingelesene Von-Lagerplaetze duerfen nicht durch Stellplatzvalidierung oder Bestandsdaten korrigiert werden.

### Phase 2E-4: `parseOrderText` zuletzt

Ziel: Erst wenn 2E-1 bis 2E-3 stabil sind, `parseOrderText` als Orchestrator in den Parser-Namespace verschieben.

Abhaengigkeiten: alle vorherigen Parser, `createLine`-Factory, Order-Hint-Regeln, Kundengruppen-Regeln, Ladelistenanhaenge.

Risiko: hoch. Abbruch, wenn irgendein Dokumenttyp, Positionen, Mengen, Kunde, Nach-Lagerplatz, Ladelisten oder Zusatzbemerkungen abweichen.

## Schutzregeln fuer eine spaetere Umsetzung

- Keine Verhaltensaenderung.
- `app.js` behaelt Wrapper mit den bisherigen Funktionsnamen.
- Keine Aenderung an OCR-DPI, Rotation, Kandidatenauswahl oder Import-Hauptpipeline.
- Keine neue Stellplatzvalidierung im PDF-/OCR-Import.
- Keine Aenderung an Mengenlogik.
- Keine Aenderung an Export-, Speicher-, Server-, Tablet-, Offline- oder DB-Ablaufen.
- Keine Aenderung an LocalStorage-/Offline-Keys.
- CR-002 bleibt unveraendert.

## Testplan fuer spaetere Phase-2E-Umsetzungen

Nach jedem einzelnen Extract:

- `npm.cmd run check:precommit`
- isolierte QA-Kopie auf Port `4175`
- `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa`
- Desktop-Smoke `/`
- Kommissionier-PDF-Import-Smoke
- SI-Bestellschein-Smoke
- SSI-Lageraufgabe-Smoke
- Ladelistenfall pruefen
- Nach-Lagerplatz `9021-0OUT` pruefen
- rohe und finale Von-Lagerplatz-Werte unveraendert pruefen
- Export-Sperre bei offenen Positionen pruefen
- CR-002 bewusst unveraendert pruefen.

## Abbruchkriterien

Eine spaetere Umsetzung ist sofort abzubrechen, wenn:

- eine Position fehlt oder zusaetzlich entsteht.
- eine Menge geaendert wird.
- Kunde, Kundengruppe oder Nach-Lagerplatz abweichen.
- Zusatzbemerkungen anders kombiniert werden.
- Ladelistenzeilen fehlen, doppelt sind oder anders angezeigt werden.
- rohe oder finale Von-Lagerplatz-Werte veraendert werden.
- der QA-Harness `app.js` nicht mehr laden kann.
- Wrapper-Funktionsnamen brechen.
- der Parser DOM-, OCR-, Canvas-, Server-, Storage- oder State-Mutation benoetigt.

## Empfehlung

Phase 2E sollte nicht als grosser Parser-Extract umgesetzt werden. Der kleinste sinnvolle naechste Codeschritt waere Phase 2E-1 mit ausschliesslich Ladelisten-Helfern.

Erlaubter spaeterer Maximal-Scope fuer 2E-1:

- `app-picking-parser.js`
- `app.js`
- `index.html`
- `service-worker.js`
- `manifest.webmanifest`
- `server/config/static-files.mjs`
- `scripts/qa-api-matrix.mjs`
- begleitende Dokumentation.

Tabu fuer 2E-1:

- OCR-Hauptpipeline
- Bestellschein-Parser
- Lageraufgabe-Parser
- Exportlogik
- Tablet-/Offline-Code
- Server-API
- Datenbanklogik
- CR-002.
