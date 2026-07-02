# HLogistik Bug Report

Stand: 2026-07-02 08:10:00 +02:00

## Behobene Fehler

### QA-014 - P1 - Kunde 9021-0OUT wurde nicht immer aus Nach-Lagerplaetzen uebernommen

Status: behoben

Fix:

Beim Kommissionierimport und bei der serverseitigen Auftragsnormalisierung gewinnt `9021-0OUT` als Kunde, sobald irgendeine Position diesen Nach-Lagerplatz enthaelt. Abweichende Nach-Lagerplaetze werden positionsbezogen als Zusatzbemerkung gehalten. Die Auftragsnummer wird fuer diesen Kunden weiterhin `SSI`.

Validierung:

QA-Matrix prueft Parser- und Server-Fall mit `9021-0OUT` an spaeterer Position sowie das bisherige Fallback-Verhalten ohne `9021-0OUT`.

### QA-013 - P1 - Originaldatei blieb nach erfolgreichem PDF-Export im Importordner

Status: behoben

Fix:

Der Server loest importierte Originaldateien ausschliesslich ueber den konfigurierten Importordner auf und verschiebt sie erst nach erfolgreicher PDF-Erstellung und Exportstatus-Speicherung in den Archivordner. Bei Archivfehlern bleibt die PDF erhalten und der Fehler wird am Auftrag dokumentiert.

Validierung:

QA-Matrix prueft erfolgreiche Archivierung, Kollisionen, bereits archivierte Dateien, fehlende Dateien und ungueltige Dateinamen in temporaeren QA-Ordnern.

### QA-009 - P1 - Tablet-PDF-Export benoetigte teils Tab-Reload

Status: behoben

Reproduktion:

1. `/tablet.html` oeffnen.
2. Kommissionierauftrag uebernehmen.
3. Positionen bearbeiten bzw. abhaken.
4. Direkt `PDF exportieren` antippen.
5. Ergebnis vor Fix: Export konnte auf dem Tablet haengen bleiben; nach Tab-Reload funktionierte derselbe Export.

Fix:

Tablet-Modern und Tablet-Legacy starten den PDF-Export nicht mehr aus einem unkontrollierten Save-Callback. Vor dem Export wird online gespeichert, die Queue fuer denselben Auftrag bereinigt, der Auftrag frisch vom Server geladen und erst danach exportiert. Offline-Fallbacks starten keinen PDF-Export. Ein `exportingPdf`-Guard verhindert parallele Exporte und gibt den Button bei Fehlern wieder frei.

Validierung:

QA-Matrix prueft einen Tablet-Direktexport nach gespeicherter Positionsaenderung ohne Reload-Workaround sowie die statische Guard-/Online-Save-Pflicht in `tablet.js` und `tablet-legacy.js`.

### QA-008 - P2 - PDF-Import uebernahm gedruckten Bestellhinweis nicht in die Auftragsnummer

Status: behoben

Reproduktion:

1. PDF-/OCR-Text enthaelt `Bestellschein Nr.: 60126`.
2. Zusaetzlich ist `Bestellhinweis: Service Ecke` gedruckt.
3. Ergebnis vor Fix: importierte Auftragsnummer blieb `60126`.

Fix:

Der Import sucht labelbasiert nach `Bestellhinweis`, liest den Wert aus derselben oder direkt folgenden Zeile und haengt ihn normalisiert an die Auftragsnummer an. Beispiel: `60126` wird zu `60126-Service Ecke`.

Validierung:

QA-Matrix prueft einzeiligen und mehrzeiligen Hinweis, fehlenden Hinweis, Doppelanhang, Tabellenheader-Ablehnung und unveraendertes Positionsparsing.

### QA-006 - P1 - Tablet manuelle Einlagerung konnte in Fangzustand geraten

Status: behoben

Reproduktion:

1. `/tablet.html` oeffnen und in `Einlagerung` wechseln.
2. Manuelle Einlagerung starten.
3. Bei serverseitig angelegtem Auftrag war `Einlagerung verlassen` nicht sauber als nicht-destruktiver Ausstieg nutzbar; `Einlagerung abbrechen` und Loeschen waren fachlich vermischt.
4. Zusaetzlich konnten serverseitig gespeicherte Auftraege mit `local-storage-...`-ID faelschlich als reine Offline-Entwuerfe behandelt werden.

Fix:

Tablet unterscheidet jetzt `verlassen`, `abbrechen` und `loeschen`. Reine lokale Entwuerfe werden ueber `localDraft === true` erkannt, nicht ueber die Form der ID. Serverseitige offene manuelle Einlagerungen koennen ueber den separaten Loeschbutton entfernt werden.

Validierung:

- QA-Matrix: `tablet manual storage open order can be deleted` bestanden.
- Headless-Chrome-CDP-Smoke: Online-Einlagerung gestartet, `Einlagerung verlassen` sichtbar, `Einlagerung loeschen` aktiv, Auftrag nach Bestaetigung nicht mehr in der Auswahl.

### QA-007 - P2 - Abgebrochene lokale Tablet-Einlagerung blieb als Cache-Eintrag sichtbar

Status: behoben

Reproduktion:

1. Tablet-Seite online laden.
2. Server stoppen.
3. Manuelle Einlagerung offline starten.
4. `Einlagerung verlassen`, Auftrag aus Offline-Auswahl wieder laden.
5. `Einlagerung abbrechen`.
6. Ergebnis vor Fix: IndexedDB war leer, aber die alte Auswahl blieb als `[Cache]` sichtbar.

Fix:

`loadOrderListFromCache()` rendert bei leerem Offline-Cache jetzt explizit eine leere Offline-Auswahl und leert die gemerkten Listeneintraege.

Validierung:

Headless-Chrome-CDP-Smoke: Offline-Entwurf verlassen, aus Cache erneut laden, abbrechen; `OfflineStore` ist leer und die Auswahl zeigt nur `Einlagerung waehlen (Offline-Cache)`.

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

Aktueller Stand: Service Worker und Manifest stehen auf `1.5.151`.

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
