# HLogistik Rules Overview

Stand: 2026-06-22 12:45:20 +02:00

## Regelorte

Die fachlichen Serverregeln liegen in `server/rules/`:

- `permission-rules.mjs`: bekannte Benutzergruppen und Rollenmatrix fuer schreibende Serveraktionen.
- `article-rules.mjs`: erlaubte Gebindearten, Standard-Gebinde und Gebindemengen-Regeln.
- `warehouse-rules.mjs`: bekannte Lager `SSI`/`SI`, Default-Lager und Artikel-Datenbankdateien.
- `storage-bin-rules.mjs`: SSI-Stellplatznormalisierung, inklusive H/R-Regeln, H3-O-Y-Direktplaetzen und Regalbereichslogik.
- `order-rules.mjs`: Nach-Lagerplatz-/Kunden-Normalisierung, `9021-0OUT -> SSI`-Auftragsnummer, Kundengruppen-Key, Auftrags-Fingerprint und Grenzwerte fuer manuelle Einlagerungs-Mehrfachanlage.
- `export-rules.mjs`: reine Export-Vollstaendigkeitsregel, ob relevante Positionen abgehakt sind.

Weitere regelnahe Listen:

- `shared/app-pages.mjs`: bekannte App- und Navigationsseiten fuer Node-seitige Nutzung.
- `server/config/static-files.mjs`: erlaubte statische Serverdateien und Cache-Header-Regeln.
- `service-worker.js`: klassische Browser-App-Shell-Liste fuer Offline-Cache. Diese Liste bleibt wegen alter Tablet-/Service-Worker-Kompatibilitaet manuell synchronisiert.

## Bewusst nicht extern konfigurierbar

- Regeln mit Regex, Normalisierung, Fehlerbehandlung oder Reihenfolge bleiben JS/MJS-Code.
- SSI-Stellplatznormalisierung ist keine JSON-Konfiguration, sondern getestete Logik.
- Exportlogik fuer Bestandsbuchungsfehler bleibt unveraendert: CR-002 ist bewusst aktiv.
- SQLite-Reparatur, echte Authentifizierung und produktive Datenmigrationen gehoeren nicht zu diesen Regeldateien.
- Browser-Duplikate fuer HU-/Tablet-Legacy-Konstanten bleiben vorerst bestehen und werden nicht ueber ES-Module geladen.
- Der Browser spiegelt den Grenzwert fuer `Anzahl Positionen` bewusst als klassisches Script-Konstantenpaar, damit `tablet-legacy.js` ohne ES-Module lauffaehig bleibt. Fuehrende Regelquelle ist `server/rules/order-rules.mjs`.

## Regeln aendern

Neue oder geaenderte Regeln zuerst im passenden `server/rules/*` Modul anpassen. Bestehende Kompatibilitaets-Exports in `server/helpers.mjs` nur erhalten oder gezielt erweitern, wenn bestehende Imports sie brauchen.

Bei neuen App-Seiten immer beide Listen pruefen:

- `shared/app-pages.mjs`
- `service-worker.js`

Bei neuen statischen Dateien zusaetzlich `server/config/static-files.mjs` aktualisieren.

## Pflicht-Tests nach Regelaenderungen

- `npm.cmd run lint`
- `node --check server.mjs`
- `node --check` fuer geaenderte `server/**/*.mjs`, `shared/*.mjs` und `scripts/*.mjs`
- `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` gegen eine isolierte QA-Kopie

Manuell pruefen:

- Artikelvalidierung und Gebindemengen
- SSI-Wareneingang und SSI-Warenausgang mit Stellplatznormalisierung
- Rollenfehler bei Mutationen
- bekannte Unterseiten und Service-Worker-Fallback
- Export-Sperre bei offenen Positionen
- Manuelle Einlagerung: `Anzahl Positionen` 1, >1 und >100; mehrere gleiche Artikelnummern; Sollmenge leer.
- CR-002 bleibt unveraendert aktiv
