# HLogistik Fix Log

Stand: 2026-06-22 13:35:44 +02:00

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
