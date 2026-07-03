# Phase 2E-2: Plan für Bestellschein-Zeilenparser

Stand: 2026-07-03

## Kurzfazit

Der Bestellschein-Zeilenparser ist riskanter als der abgeschlossene Ladelisten-Extract aus Phase 2E-1. Er beeinflusst direkt Positionen, Mengen, Einheiten, HU/LE-Werte und teilweise den Kundenpfad für SI-Bestellscheine. Deshalb wird hier nur geplant. Es wird kein Code verschoben, keine Parserlogik geändert und keine Import-, OCR-, Export-, Tablet-, Offline- oder DB-Logik berührt.

Phase 2E-1 ist stabil: zwei anonymisierte echte Rohtextaufträge mit Ladelistenmarker waren alt/neu exakt gleich, QA lief mit 112/112 grün, CR-002 blieb unverändert.

## Möglicher Minimal-Scope

Nicht alle ursprünglich genannten Funktionen müssen zwingend in einem Schritt verschoben werden.

Der kleinste vertretbare spätere Code-Extract wäre Phase 2E-2A:

- `parseBestellscheinRowStrict`
- `parseBestellscheinRow`
- `parseBestellscheinRowFallback`
- direkte interne reine Helfer:
  - `bestellscheinHeaderText`
  - `splitTrailingBestellscheinQuantity`
  - `normalizeBestellscheinText`
  - `cleanBestellscheinDescription`
  - `extractBestellscheinBin`
  - `extractBestellscheinFirstBarcode`
  - `isBestellscheinOrderColumnNumber`

Bewusst noch nicht im ersten Code-Schritt:

- `collectBestellscheinRows`
- `isBestellscheinRowStart`
- `extractLooseBestellscheinQuantities`
- `bestellscheinCustomerName`

Begründung: `collectBestellscheinRows` steuert Chunking, Fallback-Reihenfolge und lose Mengen. `bestellscheinCustomerName` berührt Kunden-/Dokumenttyperkennung. Diese beiden Bereiche sind fachlich riskanter als die reinen Row-Parser und sollten erst nach einem stabilen 2E-2A folgen.

## Abhängigkeiten

| Funktion | Nutzt / liest | `createLine` | Import-Line-Helper | HU-/Lagerplatz-Helfer | Dokumenttyp | Zielkunde / Nach-Lagerplatz | DOM/OCR/Canvas/Server/Storage/State | Isolierbar in `app-picking-parser.js` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `collectBestellscheinRows` | Textzeilen, `isBestellscheinRowStart`, Row-Parser, `extractLooseBestellscheinQuantities` | nein | indirekt über Row-Parser | indirekt über Row-Parser | ja, Marker `bestellschein|entnahmeanweisungen` | nein | nein | ja, aber erst 2E-2B |
| `parseBestellscheinRowStrict` | `normalizeBestellscheinText`, `bestellscheinHeaderText`, `cleanBestellscheinDescription`, `extractBestellscheinBin`, `extractBestellscheinFirstBarcode` | nein | `normalizeQuantity`, `normalizeUnit` | HU-Erkennung über `extractBestellscheinFirstBarcode`; Lagerplatz bleibt aktuell leer | nein | nein, `toBin` bleibt leer | nein | ja, empfohlen für 2E-2A |
| `parseBestellscheinRow` | gleiche Helfer wie Strict-Parser, engeres Produktformat | nein | `normalizeQuantity`, `normalizeUnit` | HU-Erkennung über `extractBestellscheinFirstBarcode`; Lagerplatz bleibt aktuell leer | nein | nein, `toBin` bleibt leer | nein | ja, empfohlen für 2E-2A |
| `parseBestellscheinRowFallback` | `normalizeBestellscheinText`, `bestellscheinHeaderText`, `splitTrailingBestellscheinQuantity`, `cleanBestellscheinDescription`, `extractBestellscheinFirstBarcode`, `extractBestellscheinBin` | nein | `normalizeQuantity`, `normalizeUnit` | HU-Erkennung; Lagerplatz bleibt aktuell leer | nein | nein, `toBin` bleibt leer | nein | ja, empfohlen für 2E-2A |
| `bestellscheinCustomerName` | `cleanCustomerName`, `isSiBestellscheinText` | nein | nein | nein | ja | ja, Kunde wird gesetzt | nein | technisch ja, fachlich später |

Zusätzliche Abhängigkeiten:

- `isLikelyHandlingUnit` wird auch in der OCR-HU-Verfeinerung außerhalb des Bestellschein-Row-Parsers genutzt. Es sollte in 2E-2A nicht verschoben werden, sondern als Dependency genutzt werden.
- `extractBestellscheinBin` liefert aktuell bewusst `""`. Diese Funktion darf in 2E-2A nicht fachlich erweitert werden.
- `toBin` bleibt in allen Bestellschein-Zeilenparsern `""`. Keine Nach-Lagerplatz-Logik in diesen Extract hineinziehen.
- `collectBestellscheinRows` wird auch vom Ladelistenparser aus Phase 2E-1 als Dependency genutzt. Ein späterer 2E-2B-Extract muss deshalb den Ladelistenfall erneut prüfen.

## Wrapper- und Namespace-Plan

- `app-picking-parser.js` bleibt eine klassische Browser-Datei per IIFE.
- Namespace bleibt `window.HLogistikPickingParser`.
- `app.js` behält alle bisherigen Funktionsnamen als dünne Wrapper.
- `parseOrderText` bleibt weiterhin in `app.js`.
- Lageraufgabe-Parser bleiben weiterhin in `app.js`.
- Import-/OCR-Hauptpipeline bleibt unverändert.
- Der spätere 2E-2A-Wrapper sollte Dependency-Funktionen übergeben:
  - `normalizeQuantity`
  - `normalizeUnit`
  - `isLikelyHandlingUnit`
- Keine neue Script-Datei ist nötig, weil `app-picking-parser.js` bereits existiert.
- Keine Service-Worker-/Manifest-Version in dieser Planungsphase. Bei späterer Code-Umsetzung wäre ein Asset-Bump nur nötig, wenn sich das Frontend-Asset ändert.

## Risikoanalyse

Besonders kritisch:

- Positionen dürfen sich nicht ändern.
- Mengen dürfen sich nicht ändern.
- Einheiten dürfen sich nicht ändern.
- Kunde darf sich nicht ändern.
- Nach-Lagerplatz darf sich nicht ändern.
- Zusatzbemerkungen dürfen sich nicht ändern.
- Von-Lagerplatz-Werte dürfen sich nicht ändern.
- Der Ladelisten-Extract aus 2E-1 darf nicht regressieren.
- CR-002 bleibt unverändert.

Fachliche Risiken:

- `parseBestellscheinRowStrict`, `parseBestellscheinRow` und `parseBestellscheinRowFallback` haben sehr ähnliche, aber nicht identische Regex-Pfade. Ein mechanischer Extract muss die Reihenfolge und Fallback-Logik erhalten.
- `extractBestellscheinFirstBarcode` filtert Produktnummern und Bestellspaltennummern. Kleine Änderungen können falsche HU/LE-Werte erzeugen.
- `normalizeBestellscheinText` enthält OCR-Korrekturen für Einheiten. Diese dürfen nicht erweitert oder entfernt werden.
- `bestellscheinCustomerName` setzt bei SI-Bestellschein den Kunden. Dieser Teil sollte nicht im ersten 2E-2A-Code-Schritt bewegt werden.

## Teststrategie für spätere Umsetzung

Nach einer späteren 2E-2A-Umsetzung:

- `npm.cmd run check:precommit`
- isolierte QA-Kopie auf Port `4175`
- `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa`
- SI-Bestellschein-Smoke
- Vergleich alt/neu mit anonymisiertem echtem Bestellschein-Rohtext, falls vorhanden
- Positionen, Mengen, Einheiten, Kunde, Nach-Lagerplatz und Zusatzbemerkungen alt/neu exakt vergleichen
- Ladelistenfall aus 2E-1 erneut prüfen
- Von-Lagerplatz-Werte unverändert bestätigen
- CR-002 unverändert bestätigen

Wenn kein echter Bestellschein-Rohtext lokal vorhanden ist, vor der Code-Umsetzung erst einen anonymisierten Fixture-Text aus einem kontrollierten Importlauf erzeugen und nur diesen für den Vergleich nutzen.

## Abbruchkriterien

Eine spätere Umsetzung ist sofort abzubrechen, wenn:

- Bestellschein-Positionen fehlen oder zusätzlich entstehen.
- Mengen oder Einheiten abweichen.
- Kunde oder Nach-Lagerplatz abweicht.
- Zusatzbemerkungen anders kombiniert werden.
- der Ladelistenfall aus 2E-1 regressiert.
- Von-Lagerplatz-Werte abweichen.
- Wrapper-Funktionsnamen brechen.
- `app.js` oder der QA-Harness nicht mehr geladen werden kann.
- der Extract DOM-, OCR-, Canvas-, Server-, Storage- oder State-Mutation benötigt.

## Empfehlung

Phase 2E-2 sollte nicht als kompletter Bestellschein-Parser-Extract freigegeben werden.

Empfohlen ist ein verkleinerter Code-Scope für Phase 2E-2A:

- nur `parseBestellscheinRowStrict`
- `parseBestellscheinRow`
- `parseBestellscheinRowFallback`
- direkte reine Row-Helfer

Nicht im ersten Schritt:

- `collectBestellscheinRows`
- `bestellscheinCustomerName`
- `parseOrderText`
- Lageraufgabe-Parser
- Import-/OCR-Hauptpipeline

Vor 2E-2A sollte ein echter oder realitätsnaher SI-Bestellschein-Rohtext für einen alt/neu-Vergleich bereitstehen. Wenn dieser Vergleich nicht möglich ist, Phase 2E-2 pausieren.
