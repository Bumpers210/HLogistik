# Import Accuracy Diagnosis Plan

Stand: 2026-07-06

## 1. Kurzfazit

Die aktuelle QA-Matrix ist grün, weil sie wichtige bekannte Parserpfade, Schutzregeln und Regressionen synthetisch abdeckt. Reale Kommissionier-PDFs können trotzdem Fehler erzeugen, weil OCR-Ergebnisse nicht nur aus einzelnen Werten bestehen, sondern aus kompletten Kandidaten mit Seiten, Rotationen, Skalen, Rohzeilen und heuristisch erkannten Tabellenfeldern. Ein Kandidat kann insgesamt ausreichend gut wirken, obwohl einzelne Positionen eine falsche Feldzuordnung enthalten.

Die gemeldeten realen Fehler passen zu genau dieser Lücke: falsche Von-Lagerplätze, Produktbeschreibung am falschen Artikel, fehlende Mengen und nicht angehängte Ladelisten sind keine einfachen Einzelregeln, sondern Hinweise auf unsichere Zeilensegmentierung, Spaltenzuordnung oder Kandidatenauswahl.

Deshalb sollte zuerst die Diagnose verbessert werden. Eine direkte Reparatur der Importlogik wäre riskant, weil sie ohne klare Rohdaten schnell neue stille Korrekturen erzeugen könnte. Besonders wichtig bleibt: Der PDF-Import darf keine automatische Stellplatzkorrektur, keine SSI-Stellplatznormalisierung und keine O/0-, S/5- oder I/1-Korrektur für Von-Lagerplätze einführen.

## 2. Fehlerklassen

| Fehlerklasse | Wahrscheinliches Muster | Risiko |
| --- | --- | --- |
| Falscher Von-Lagerplatz | OCR liest die falsche Spalte, verschiebt Tokens oder übernimmt einen plausibel wirkenden, aber falschen Rohwert. | Falsche Auslagerung aus Lagerplatz, Datenintegrität im Betrieb gefährdet. |
| Produktbeschreibung an falscher Artikelnummer | Tabellenzeile wird mit Folgezeile zusammengezogen oder Beschreibung aus einem Nachbarartikel übernommen. | Artikel wirkt korrekt, aber Beschreibung führt Bediener in die Irre. |
| Fehlende Mengen | OCR erkennt Menge/Einheit nicht, Menge landet in Beschreibung oder wird durch Splitlogik verloren. | Auftrag wird unvollständig oder mit Warnung importiert; Export muss blockiert bleiben. |
| Nicht angehängte Ladelisten | Ladelistenmarker, Barcode oder Position wird in einem Nebenkandidaten nicht erkannt oder der Fallback läuft nicht. | Zusatzpositionen fehlen trotz vorhandener Ladeliste. |
| Falsch akzeptierter OCR-Kandidat | Gesamt-Score ist hoch genug, obwohl einzelne Positionen unsicher sind. | Import wirkt erfolgreich, enthält aber Positionsfehler. |
| Unvollständig erkannte Tabellenzeilen | Erwartete Zeilenzahl aus OCR-Rohtext und importierte Positionszahl weichen ab. | Fehlende Positionen bleiben nur sichtbar, wenn Diagnose und Validierung greifen. |

## 3. Ursachenanalyse im bestehenden Code

### OCR-Kandidatenauswahl

Die Kommissionier-Pipeline liegt weiter in `app.js`:

- `chooseBestImportText` akzeptiert zuerst geeigneten PDF-Text, sonst OCR.
- `readPickingPdfWithOcrCandidate` prüft Basis-/präzise Kandidaten und bei Bedarf Rotationen.
- `readPickingPdfOcrCandidateSet` baut Kandidaten pro Skala, DPI und Rotation.
- `buildPickingOcrCandidate` parst den Kandidatentext und berechnet Metriken.
- `scorePickingOcrCandidate` bewertet Tabellenqualität, Pflichtfelder, erwartete Zeilen, fehlende Von-Lagerplätze und verdächtige Quellfelder.

Die Bewertung ist kandidatenbezogen. Sie erkennt bereits `discardedRows`, `missingFromBinCount` und `suspiciousSourceFieldCount`, kann aber noch nicht detailliert genug erklären, welche Rohzeilen zu welcher finalen Position geführt haben und mit welcher Feldsicherheit einzelne Werte erkannt wurden.

### Tabellenzeilen-Splitting

Die Lageraufgabe-Parser in `app.js` nutzen mehrere Pfade:

- `collectWarehouseRows`
- `collectStackedWarehouseRows`
- `collectSplitWarehouseRows`
- `parseWarehouseLine`
- `parseWarehouseLineByColumns`
- `parseWarehouseLineWithoutBin`
- `parseWarehouseLineLoose`

Diese Mehrfachstrategie ist robust gegen unterschiedliche OCR-Layouts, kann aber bei realen Scans Fehlzuordnungen erzeugen, wenn eine Zeile zusammengezogen, getrennt oder spaltenweise verrutscht ist. Besonders riskant sind Fälle, in denen ein Fallback noch genug Werte findet, aber die Feldherkunft unklar ist.

### Zuordnung von Artikel, Menge, Beschreibung und Nach-Lagerplatz

Die Zuordnung hängt an Token-Positionen, Mengen-/Einheitenmustern und Zielplatzextraktion:

- `parseProductTokens`
- `findProductQuantityMatch`
- `parseQuantityToken`
- `parseQuantityWithUnitToken`
- `extractDestinationBin`
- `cleanProductDescription`

Wenn OCR Menge oder Einheit schwach erkennt, kann die Beschreibung zu lang werden oder eine Nachbarinformation aufnehmen. Wenn der Nach-Lagerplatz spät im Text erkannt wird, kann er korrekt als Ziel gelten, während Beschreibung oder Menge davor bereits verschoben sind.

### Ladelisten-Erkennung

Die Ladelistenlogik liegt nach Phase 2E-1 in `app-picking-parser.js`:

- `collectLoadingSlipLinesFromOcrCandidates`
- `parseLoadingSlipLines`
- `auditLoadingSlipImport`
- `parseLoadingSlipBlock`
- `loadingSlipBlocksFrom`
- `parseStackedLoadingSlipRow`
- `parseCompactLoadingSlipRow`

`readLoadingSlipOcrFallbackIfNeeded` in `app.js` kann zusätzliche Rotationen nur für Ladelisten prüfen. Das ist sinnvoll, aber die Diagnose sollte genauer zeigen, ob eine Ladeliste vermutet wurde, welcher Kandidat sie enthielt, warum sie nicht geparst wurde und ob ein Barcode oder eine Position fehlte.

### Importdiagnose

`app-import-diagnostics.js` enthält bereits:

- gewählten Kandidaten
- OCR-Kandidaten
- Skalen, DPI und Rotation
- Ladelisten-Zähler
- Qualitäts-Score und Mindestscore
- Roh-/Final-Von-Lagerplatz pro importierter Position

Die aktuelle Diagnose ist gut für Kandidatenübersicht und Stellplatz-Rohwertkontrolle. Für die gemeldeten Realfehler fehlen aber noch positionsbezogene Diagnosefelder: Rohzeilen, Spaltenherkunft, Feldsicherheit, Parserpfad und Grund, warum eine Position als vollständig akzeptiert wurde.

### QA-Fixtures

`scripts/qa-api-matrix.mjs` deckt viele bekannte Fälle ab:

- SI-Bestellschein ohne Von-Lagerplatz
- Ladeliste aus Nebenkandidat
- fehlender oder verwirrter Von-Lagerplatz
- Ansbach-/Insel-Zielplatzkürzung
- Roh-/Final-Von-Lagerplatzdiagnose
- keine SSI-Stellplatzregel im App-Importpfad
- Export-Sperre und CR-002

Die Lücke liegt bei realitätsnahen Negativ-Fixtures: verschobene Beschreibung, fehlende Mengen in einzelnen Positionen, Ladeliste erkannt aber nicht angehängt und Kandidat mit insgesamt gutem Score, aber unsicheren Einzelpositionen.

### Akzeptanzkriterien für Importkandidaten

Aktuell verhindern `validatePickingImport`, `isAcceptedPickingImportCandidate`, `isAcceptedPdfTextImportCandidate`, `isAcceptedSiBestellscheinImportCandidate` und `isUsablePickingOcrSelection` bereits viele schwache Imports. Die Akzeptanz ist aber noch nicht streng genug positionsbezogen. Ein Kandidat kann importierbar sein, wenn Zeilenanzahl und Score passen, obwohl einzelne Positionsfelder aus unklaren Rohsegmenten stammen.

## 4. Diagnoseverbesserung planen

Die nächste technische Änderung sollte keine Importwerte ändern, sondern zusätzliche nicht-persistente Diagnose ausgeben. Sinnvolle Felder:

| Diagnosefeld | Zweck |
| --- | --- |
| `selectedCandidate` mit Seite, Rotation, Skala, DPI | Sichtbar machen, welcher OCR-Lauf importiert wurde. |
| `rejectedCandidates` / `ocrCandidates` mit Score und Ablehnungsgrund | Erklären, warum bessere oder alternative Kandidaten verworfen wurden. |
| `candidatePages` mit Rohzeilenzahl je Seite | Seiten erkennen, die ungewöhnlich wenig Text liefern. |
| `positionRawLines` | Rohzeilen pro finaler Position anzeigen. |
| `positionParserPath` | Zeigen, ob `parseWarehouseLine`, `parseWarehouseLineByColumns`, `parseWarehouseLineWithoutBin`, `parseWarehouseLineLoose` oder Bestellschein-Parser genutzt wurde. |
| `positionColumns` | Erkannte Spalten je Position: Auftrag, HU/LE, Von-Lagerplatz, Produkt, Menge, Einheit, Beschreibung, Nach-Lagerplatz. |
| `fieldConfidence` | Grobe Sicherheit je Feld: sicher, abgeleitet, fallback, fehlt, verdächtig. |
| `missingRequiredFields` | Produkt, Menge, Einheit, Von-Lagerplatz oder Nach-Lagerplatz je Dokumenttyp. |
| `expectedRows` vs. `importedRows` | Erwartete Tabellenzeilen und importierte Positionsanzahl vergleichen. |
| `loadingSlipDetected` | Ladeliste im Rohtext oder Nebenkandidaten erkannt. |
| `loadingSlipExpectedButNotAttached` | Vermutete Ladeliste ohne erzeugte Ladelistenposition. |
| `acceptanceReason` | Warum Kandidat akzeptiert wurde: PDF-Text, SI-Bestellschein, OCR-Score, Fast-Accept, stabiler Upright-Kandidat. |
| `abortReason` | Warum Import abgebrochen wurde: zu niedrige Qualität, fehlende Positionen, Mengen fehlen, Ladelistenfehler. |

Diese Diagnose sollte nur in der Browser-Konsole und optional im Importstatus sichtbar sein. Sie darf nicht in Aufträgen, Datenbank, Exporten oder LocalStorage persistiert werden.

## 5. Sicherheitsregeln für spätere Umsetzung

Für spätere Codeänderungen sollten folgende Regeln gelten:

- Import abbrechen oder als prüfbedürftig markieren, wenn bei einer normalen Position Mengen fehlen.
- Warnen oder abbrechen, wenn Artikelnummer und Beschreibung nur über Fallback oder lose Zeilenkombination erkannt wurden.
- Warnen, wenn erwartete Tabellenzeilen und importierte Positionsanzahl abweichen.
- Ladeliste separat suchen und bei Verdacht eine Warnung anzeigen, wenn kein Barcode/keine Position angehängt wurde.
- Keine automatische Stellplatzkorrektur einbauen.
- Keine O/0-, S/5-, I/1- oder SSI-Stellplatznormalisierung für Von-Lagerplatz im PDF-Import.
- Bestandsdaten nur als Warnsignal verwenden, nicht als Quelle für Von-Lagerplatz.
- Keine stillen Feldkorrekturen. Jede spätere Feldänderung muss sichtbar, testbar und fachlich freigegeben sein.
- Bei unsicherem Kandidaten lieber Import abbrechen als einen scheinbar plausiblen Auftrag erzeugen.
- CR-002 bleibt exportseitig unverändert und darf nicht als Import-Akzeptanzregel missbraucht werden.

## 6. Teststrategie

Neue Tests sollten gezielt die realen Fehlerklassen abdecken:

- Fixture mit fehlender Menge in einer Position.
- Fixture mit Menge, die in Beschreibung oder Nachbarfeld verrutscht.
- Fixture mit verschobener Produktbeschreibung bei falscher Artikelnummer.
- Fixture mit falschem oder unsicherem Von-Lagerplatz als Rohwert, der unverändert bleibt, aber markiert wird.
- Fixture mit erkannter Ladeliste, deren Barcode nicht eindeutig gelesen wird.
- Fixture mit erkannter Ladeliste, die nicht angehängt werden darf und eine Diagnose auslöst.
- Fixture mit erwarteter Zeilenzahl ungleich importierter Zeilenzahl.
- Fixture mit mehreren OCR-Kandidaten, bei denen der höhere Score eine unsichere Einzelposition enthält.
- Regression: bestehende funktionierende Lageraufgabe- und SI-Bestellschein-Fixtures bleiben unverändert.
- Regression: Ladelisten aus Nebenkandidaten werden weiterhin nicht doppelt angehängt.
- Regression: Rohwert und finaler Von-Lagerplatz bleiben gleich, solange keine ausdrücklich freigegebene Importregel anderes verlangt.
- Regression: CR-002 bleibt unverändert.

Für automatisierte Tests reicht zunächst der VM-Harness in `scripts/qa-api-matrix.mjs`. Echte PDFs sollten nur lokal und nicht versioniert genutzt werden. Versionierbar sind nur anonymisierte oder synthetische Rohtext-Fixtures.

## 7. Benötigte Echtdaten

Für eine sichere spätere Reparatur werden konkrete Beispiele benötigt:

- Die problematische PDF-Datei als lokale, nicht versionierte Testgrundlage.
- Erwartete korrekte Positionen als manuelle Liste:
  - Positionsnummer
  - Auftrags-/Lageraufgabennummer
  - HU/LE
  - Von-Lagerplatz
  - Artikelnummer
  - Produktbeschreibung
  - Menge
  - Einheit
  - Nach-Lagerplatz
  - Zusatzbemerkung
- Markierung, welche Positionen falsch importiert wurden.
- Hinweis, ob eine Ladeliste vorhanden war und welche Ladelistenposition erwartet wurde.
- Optional ein Screenshot des PDF-Ausschnitts mit den betroffenen Zeilen.
- Browser-Konsole mit `PDF-Import Diagnose` und `PDF-Import Positionsdiagnose`, falls verfügbar.

Echte PDFs, Betriebsdaten, Kundennamen, Auftragsnummern und Exportdateien dürfen nicht committed werden. Für Git dürfen nur anonymisierte oder synthetische Fixtures entstehen.

## 8. Empfohlene nächste Umsetzungsschritte

1. Diagnoseausgabe verbessern.
   - Nur nicht-persistente Felder ergänzen.
   - Fokus auf Rohzeilen, Parserpfad, Spaltenherkunft, Feldsicherheit und Akzeptanzgrund.
2. Problemauftrag lokal prüfen.
   - Echte PDF lokal importieren.
   - Diagnoseausgabe mit erwarteten manuellen Werten abgleichen.
3. Anonymisierte Regression-Fixture erstellen.
   - Aus dem Problemfall einen synthetischen Rohtext ohne Kundendaten ableiten.
   - Erwartete Felder explizit im Test prüfen.
4. Strengere Import-Akzeptanzkriterien planen und einzeln umsetzen.
   - Erst nach Diagnose und Fixture.
   - Nicht mehrere Parserpfade gleichzeitig ändern.
5. Ladelisten-Sonderdiagnose ergänzen.
   - Erkannte Ladelistenblöcke, Barcode-Erkennung, angehängte Positionen und Ablehnungsgründe sichtbar machen.
6. Erst danach Parser-/OCR-Anpassungen.
   - Keine Stellplatzkorrektur.
   - Keine stille Mengen- oder Beschreibungskorrektur.
   - Jede Änderung mit Alt/Neu-Vergleich und echtem Realtest absichern.

## 9. Klare Empfehlung

Sofort sollte keine Importlogik repariert werden. Der kleinste vertretbare spätere Code-Schritt ist eine reine Diagnoseerweiterung ohne Änderung an importierten Feldwerten.

Maximal betroffene Dateien für diesen ersten technischen Folgeschritt:

- `app-import-diagnostics.js`
- `app.js`
- `scripts/qa-api-matrix.mjs`
- `docs/RULES_OVERVIEW.md`
- `docs/ROBUSTNESS_AUDIT.md`
- `docs/FIX_LOG.md`

Nur falls neue statische Frontenddateien entstehen, zusätzlich:

- `index.html`
- `service-worker.js`
- `manifest.webmanifest`
- `server/config/static-files.mjs`

Tabu für den ersten Folgeschritt:

- `server.mjs`
- `server/**/*.mjs`, sofern keine reine Dokumentations-/Testdiagnose nötig ist
- `tablet.js`
- `tablet-legacy.js`
- Offline-/LocalStorage-/IndexedDB-Logik
- Exportlogik
- Datenbankdateien und Migrationen
- automatische SQLite-Reparatur
- Stellplatznormalisierung im PDF-Import
- CR-002

Freigabeempfehlung: Erst Diagnoseausgabe umsetzen, danach mit einem echten Problemauftrag und einer anonymisierten Fixture entscheiden, ob Parserpfade, Score-Regeln oder Ladelisten-Heuristiken angepasst werden dürfen.
