# HLogistik Bug Report

Stand: 2026-06-22 08:38:48 +02:00

## Behobene Fehler

### QA-001 - P2 - Artikelvalidierung lieferte Serverfehler

Status: behoben

Reproduktion:

1. `POST /api/articles?warehouse=SSI`
2. Payload mit `gebindeArt = KRT` und `mengeProKarton = 0`
3. Ergebnis vor Fix: HTTP 500 `Serverfehler`

Fix:

`validateArticle()` wirft `httpError(400, ...)` fuer fachliche Eingabefehler.

Validierung:

`npm run test:qa` gegen isolierte Kopie: `article invalid quantity returns 400` bestanden.

### QA-002 - P1 - SSI-Warenausgang normalisierte Stellplaetze nicht wie Wareneingang

Status: behoben

Reproduktion:

1. Wareneingang SSI auf `002-H1-SQA`
2. Bestand wird auf bekannten Platz `002-H3-SQA` normalisiert.
3. Warenausgang mit demselben Eingabewert `002-H1-SQA`
4. Ergebnis vor Fix: kein Bestand gefunden bzw. Warenausgang blockiert

Fix:

`bookStorageIssues()` uebergibt den Lagerkontext an `normalizeStorageIssue()`. Fuer SSI wird `normalizeSsiStorageBin()` verwendet.

Validierung:

`npm run test:qa` gegen isolierte Kopie:

- `ssi receipt normalizes known bin` bestanden
- `ssi issue accepts same normalized bin as receipt` bestanden
- `ssi issue reduced normalized stock` bestanden

### QA-003 - P1 - Korrupte SQLite-Dateien verhinderten Serverstart ohne klare Betreiberdiagnose

Status: teilweise behoben

Reproduktion:

In einer isolierten Kopie wurden `logistik.sqlite`, `artikel-ssi.sqlite` und `artikel-si.sqlite` mit ungueltigem Inhalt ersetzt. Serverstart auf Port 4177 endet mit `ERR_SQLITE_ERROR: file is not a database`.

Fix:

Der Server faengt Startfehler ab und gibt eine klare Diagnose aus:

- HLogistik konnte nicht gestartet werden
- SQLite-Diagnose
- betroffene Datenbankpfade
- Hinweis, dass keine automatische Reparatur ausgefuehrt wurde
- Wiederherstellungsablauf aus Backup

Bewusst nicht umgesetzt:

Keine automatische Quarantaene, kein automatisches Verschieben und kein automatisches Restore. Das bleibt Betreiberentscheidung, damit produktive Daten nicht versehentlich ersetzt werden.

Validierung:

Korrupte-DB-Testkopie gestartet. Stderr enthielt alle erwarteten Diagnosehinweise.

### QA-004 - P2 - Service-Worker-Offline-Fallback fuer Desktop-Unterseiten war uneinheitlich

Status: behoben

Reproduktion:

Offline-Navigation behandelte `/tablet.html` speziell, bekannte Desktop-Unterseiten fielen aber auf `/index.html` zurueck.

Fix:

Der Service Worker nutzt jetzt bekannte Navigation-Fallbacks fuer:

- `/index.html`
- `/tablet.html`
- `/lager.html`
- `/artikel.html`
- `/auswertungen.html`

Cache-Version und Manifest-Version wurden auf `1.5.113` erhoeht.

Validierung:

`navigationFallbackPath()` wurde isoliert gegen bekannte und unbekannte Pfade geprueft. Browser-Smoke fuer Desktop und Tablet war fehlerfrei.

### QA-005 - P2 - Default-Passwort fuer Artikelstamm-Loeschung war stiller Fallback

Status: teilweise behoben

Beschreibung:

`ARTICLE_DELETE_PASSWORD` hat weiterhin einen Code-Fallback, damit bestehende lokale Installationen nicht hart brechen.

Fix:

Der Server gibt beim Start eine klare Warnung aus, wenn `ARTICLE_DELETE_PASSWORD` nicht gesetzt ist.

Bewusst nicht umgesetzt:

Der produktive Start wird ohne Umgebungsvariable noch nicht verhindert. Ob ein harter Startabbruch gewuenscht ist, bleibt Betreiberentscheidung.

## Bewusst nicht behoben

### CR-002 - P2 - Export schliesst Auftrag trotz Bestandsbuchungsfehlern

Status: bewusst unveraendert

Beschreibung:

Wenn beim Kommissionierexport Bestand nicht vollstaendig gebucht werden kann, wird der PDF-Export weiterhin abgeschlossen und der Buchungsfehler protokolliert.

Begruendung:

Das Verhalten ist aktuell bewusstes Uebergangsverhalten, weil Artikel und Bestaende noch nicht vollstaendig gepflegt sind.

## Neu abgesichert

### RISK-006 - API-Matrix war nicht versioniert

Status: behoben

Fix:

Die frische API-Matrix liegt jetzt als `scripts/qa-api-matrix.mjs` vor und ist ueber `npm run test:qa` ausfuehrbar. Das Skript schreibt Testdaten und ist deshalb gegen versehentliche Nutzung auf Port 4174 geschuetzt, solange `QA_ALLOW_LIVE=1` nicht bewusst gesetzt wird.
