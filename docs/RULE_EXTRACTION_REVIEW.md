# HLogistik Rule Extraction Review

Stand: 2026-07-02 08:10:00 +02:00

## Kurzfazit

Weitere Auslagerung ist sinnvoll, aber nicht als grosser Umbau. Die wichtigsten neuen Kandidaten seit den letzten Funktionen sind keine neuen Server-Features, sondern duplizierte Frontend-/Tablet-Regeln:

- SSI-HU-Prefix, HU-Laenge und HU-Normalisierung sind in `server.mjs`, `app.js`, `tablet.js` und `tablet-legacy.js` mehrfach vorhanden.
- Regeln fuer manuelle Einlagerungspositionen (`Default`, `Min`, `Max`, Validierungstexte) liegen serverseitig bereits in `server/rules/order-rules.mjs`, sind aber in Desktop und Tablet erneut hart codiert.
- Export-Vollstaendigkeit ist serverseitig in `server/rules/export-rules.mjs` ausgelagert, die gleiche Meldungs-/Prueflogik existiert aber weiter in Desktop und Tablet.
- Tablet-Offline-Schluessel, Sync-Queue-Dedupe-Keys und lokale Statuswerte sind in `tablet.js` und `tablet-legacy.js` doppelt vorhanden.
- Service-Worker-App-Shell, statische Server-Allowlist, Manifest-Version und HTML-Asset-Querystrings muessen weiter manuell synchron gehalten werden.

Empfehlung: Zuerst reine Konstanten und klassische Browser-Helper auslagern. Komplexe Ablaufsteuerung wie Tablet-Export-Pipeline, Offline-Sync-Verarbeitung, DB-Transaktionen und OCR-Heuristik nicht sofort auslagern.

CR-002 wurde in dieser Analyse nicht geaendert. Der Kommissionierexport trotz Bestandsbuchungsfehlern bleibt bewusst erlaubt.

## Baseline und Tests

Ausgefuehrt vor der Analyse:

- `git status --short`
- `npm.cmd run lint`
- `node --check` fuer `server.mjs`, zentrale `server/*.mjs`, `tablet.js`, `tablet-legacy.js`, `offline-store.js`, `service-worker.js`, `scripts/qa-api-matrix.mjs`, `server/rules/*.mjs`, `server/config/*.mjs`, `shared/*.mjs`
- isolierte QA-Kopie: `tmp/rule-extraction-review-qa-20260623-093550/`
- `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa`

Ergebnis:

- Lint: gruen
- Syntaxchecks: 19/19 Dateien gruen
- QA-Matrix: 52/52 Checks gruen

Der Arbeitsbaum enthielt vor dieser Review bereits uncommitted Aenderungen aus den vorigen Arbeiten. Diese Review hat keine Refactorings umgesetzt.

## Regelkandidaten

| Fundstelle | Aktuelle Regel / Konstante | Aktuelle Datei | Vorgeschlagener Zielort | Risiko | Empfehlung | Begruendung |
|---|---|---|---|---|---|---|
| SSI-HU-Prefix und Suffixlaenge | `34006381000`, `7`, berechnete HU-Laenge | `server.mjs`, `app.js`, `tablet.js`, `tablet-legacy.js` | `server/rules/storage-hu-rules.mjs` plus klassisches Browser-Bundle `shared/storage-hu-rules.js` | mittel | auslagern | Gleiche Fachregel ist vierfach vorhanden. Besonders riskant, weil Servervalidierung und Tablet-Eingabe identisch bleiben muessen. Browser muss wegen Legacy klassisch bleiben. |
| SSI-HU-Normalisierung | `normalizeSsiStorageHandlingUnit`, `isComplete...`, `isIncomplete...`, Prefix stripping | `server.mjs`, `app.js`, `tablet.js`, `tablet-legacy.js` | gleiche Zielstruktur wie HU-Konstanten | mittel | auslagern | Es ist echte Fachlogik, aber klein und gut testbar. Verhalten darf nur mit Regressionstests bewegt werden. |
| HU-Pflicht nur fuer Kunde SSI | `storageOrderUsesSsiCustomer`, `requiresStorageHandlingUnit`, `manualStorageCustomerGroupKey(...) === "SSI"` | `server.mjs`, `app.js`, `tablet.js`, `tablet-legacy.js` | `server/rules/order-rules.mjs` erweitern; Browser-Pendant `shared/browser-order-rules.js` | mittel | auslagern | Die zuletzt korrigierte Fachregel darf nicht wieder auseinanderlaufen. Vorsicht wegen unterschiedlicher Browser-/Server-Modulformate. |
| Manuelle Einlagerung Positionsanzahl | Default `1`, Min `1`, Max `100`, Validierungstexte | `server/rules/order-rules.mjs`, `app.js`, `tablet.js`, `tablet-legacy.js` | bestehendes `server/rules/order-rules.mjs` plus klassisches Browser-Bundle `shared/manual-storage-rules.js` | niedrig bis mittel | auslagern | Serverregel existiert bereits; Frontend dupliziert sie fuer UI-Min/Max und Fehlermeldungen. Guter erster Refactoring-Kandidat. |
| Manuelle Positionsnummern | Praefix `M`, naechste Nummer aus `M\d+` | `app.js`, `tablet.js`, `tablet-legacy.js` | `shared/manual-storage-rules.js` | niedrig | auslagern | Reine lokale Formatregel, in Desktop und Tablet mehrfach vorhanden. |
| Manuelle Einlagerung ohne Sollmenge | `targetQty: ""`, `storageLineQuantity` faellt auf `actualQty` zurueck | `server.mjs`, `app.js`, `tablet.js`, `tablet-legacy.js` | `server/rules/order-rules.mjs` / Browser-Pendant | mittel | spaeter | Fachlich wichtig, aber eng an Validierung und UI-Rendering gekoppelt. Erst nach HU-/Count-Regeln angehen. |
| Export-Vollstaendigkeitsmeldung | `Export gesperrt: Auftrag hat keine Positionen`, `Erst alle Positionen abhaken` | `server/rules/export-rules.mjs`, `app.js`, `tablet.js`, `tablet-legacy.js` | `shared/export-texts.js` oder Browser-Pendant zu `export-rules` | mittel | spaeter | Serverregel ist bereits sauber. Browser dupliziert fuer fruehe UI-Sperre. Auslagerung lohnt, aber nur mit Browser-/Server-Testabdeckung. |
| Storage-Exportvalidierung | `Einlagerung unvollstaendig`, max. 5 Fehler, Texte fuer Artikel/HU/Stellplatz/Menge | `server.mjs`, `app.js`, `tablet.js`, `tablet-legacy.js` | `server/rules/storage-order-rules.mjs` plus Browser-Pendant | mittel bis hoch | spaeter | Viel gemeinsam, aber Kontext unterscheidet sich zwischen Serverfehlern und UI-Hinweisen. Nicht als erster Schritt. |
| Tablet-Export online-only | `allowOffline: false`, `exportingPdf`, frischer Server-Reload vor PDF | `tablet.js`, `tablet-legacy.js` | keine reine Regeldatei; optional `shared/tablet-export-texts.js` fuer Texte | hoch | nicht auslagern | Das ist Ablaufsteuerung mit Fehlerbehandlung. Eine Auslagerung wuerde den Fix schwerer nachvollziehbar machen. Nur Meldungstexte koennen spaeter gebuendelt werden. |
| Tablet-Export Meldungen | `PDF-Export nur online moeglich`, `Aenderungen werden vor dem PDF-Export gespeichert`, `PDF wird erstellt` | `tablet.js`, `tablet-legacy.js` | `shared/tablet-messages.js` | niedrig | spaeter | Mehrfach verwendete UI-Texte. Technisch leicht, aber Nutzen kleiner als bei Fachregeln. |
| Tablet-Auto-Save/Refresh-Zeiten | `ORDER_LIST_REFRESH_MS = 30000`, `AUTO_SAVE_MS = 10000` modern, `2500` legacy | `tablet.js`, `tablet-legacy.js` | `shared/tablet-config.js` | mittel | spaeter | Konstante ist doppelt, aber die Abweichung zwischen Modern und Legacy kann Absicht sein. Vor Auslagerung fachlich bestaetigen. |
| Tablet-LocalStorage Keys | `tablet-pick-user-v1`, `tablet-pick-mode-v1`, `tablet-pick-current-order-v1` | `tablet.js`, `tablet-legacy.js` | `shared/tablet-storage-keys.js` | niedrig | auslagern | Reine String-Konstanten, beide Tablet-Dateien muessen identisch bleiben. |
| Desktop/Tablet User-Group Key | `kommissionier-app-user-group-v1`, Gruppe `tablet` | `app.js`, `tablet.js`, `tablet-legacy.js` | `shared/browser-storage-keys.js` und ggf. `shared/browser-permission-values.js` | niedrig | auslagern | Browserseitige Rollen-/Storage-Schluessel sind dupliziert. Serverseitige Rollenmatrix liegt bereits in `permission-rules.mjs`. |
| Offline IndexedDB Schema | DB `hlogistik-offline`, Version `2`, Stores `orders`, `order-summaries`, `sync-queue`, `order-groups` | `offline-store.js` | `shared/offline-store-config.js` | mittel | spaeter | Reine Namen koennen raus, aber DB-Version und Upgradepfad sollten nahe am IndexedDB-Code bleiben. |
| Sync-Queue Dedupe-Keys | `POST:/api/orders:<id>`, `PUT:/api/orders/<id>`, `DELETE:/api/orders/<id>` | `tablet.js`, `tablet-legacy.js` | `shared/tablet-offline-rules.js` | mittel | auslagern, aber vorsichtig | Doppelter Code in Modern/Legacy. Wichtig fuer Offline-Datenintegritaet, deshalb nur mit gezielten Queue-Tests. |
| Lokale manuelle Einlagerung Status | `localDraft === true`, `manualStorageDraft`, ID-Prefix `local-storage-` | `tablet.js`, `tablet-legacy.js` | `shared/tablet-offline-rules.js` | mittel | spaeter | Statuswerte sind fachlich wichtig. Auslagerung moeglich, aber nicht zusammen mit Dedupe-Keys in einem grossen Schritt. |
| Gemeinsam uebernommene Tablet-Auftraege | `order-groups`, `groupId`, `orderIds`, lokale Gruppencache-Logik | `offline-store.js`, `tablet.js`, `tablet-legacy.js` | nur Store-Namen in Config; Ablauf im Code lassen | hoch | nicht auslagern | Offline-Wechsel-Workflow ist komplexe Ablaufsteuerung und sollte lesbar im Tablet-Code bleiben. |
| Bestellhinweis-Regeln | Labelpattern, Stoplabels, Rejectpatterns, Maxlaenge `80` | `order-hint-rules.js`, Tests in `scripts/qa-api-matrix.mjs` | optional verschieben nach `shared/order-hint-rules.js` | niedrig bis mittel | spaeter | Bereits ausgelagert, aber nicht unter `shared/`. Umzug waere Ordnung, kein fachlicher Mehrwert. |
| PDF-/OCR-Import-Konstanten | OCR-Skalen, Rotationen, Scores, Scan-Seiten | `app.js` | `shared/import-config.js` oder `app/import-rules.js` | hoch | spaeter | Viele Heuristiken, stark an `app.js` gekoppelt. Erst bei weiterer Importarbeit mit Referenz-PDFs auslagern. |
| Service-Worker App-Shell | `APP_SHELL`, `NAVIGATION_FALLBACKS` | `service-worker.js` | generierte `service-worker-assets.js` oder manuell synchronisierte `shared/app-pages.mjs` plus Pruefscript | mittel | spaeter | Listen muessen mit `shared/app-pages.mjs` und `server/config/static-files.mjs` synchron bleiben. Service Worker kann nicht einfach ESM importieren. |
| Asset-/Cache-Versionen | aktueller Stand `CACHE_VERSION 1.5.151`, Manifest `version`, HTML Querystrings, `CLIENT_ASSET_VERSION 20260702-1` | `service-worker.js`, `manifest.webmanifest`, `tablet.html`, `index.html`, `app.js` | `shared/asset-version.mjs` plus kleines Update-/Check-Script | niedrig bis mittel | auslagern/generieren | Haendisches Bumpen ist fehleranfaellig. Am besten nicht zur Laufzeit importieren, sondern per Script pruefen oder aktualisieren. |
| Statische Server-Allowlist | `PUBLIC_STATIC_FILES`, No-store Extensions | `server/config/static-files.mjs` | bleibt dort | niedrig | nicht auslagern | Ist bereits korrekt ausgelagert. Nur App-Shell-Abgleich verbessern. |
| Report-/API-Limits | Bodylimit `2 * 1024 * 1024`, Default-Limits `100`, Fehlerlog `200` | `server.mjs`, `server/storage.mjs` | `server/config/server-limits.mjs` | niedrig | auslagern | Reine Betriebskonstanten, leicht testbar. Kein neues Fachverhalten. |
| Artikel-Delete Passwortfallback | Fallback `HLogistik2026!` und Warntext | `server.mjs` | `server/config/security-config.mjs` | mittel | spaeter / Betreiberentscheidung | Nicht neu, aber harte Security-Konstante. Entfernung/Startblockade ist Betreiberentscheidung; nur Konfig-Ort waere technisch moeglich. |
| PDF-Export Layoutbreiten | Tabellenbreiten, HU/Material/Bezeichnung-Spalten | `server/export.mjs` | optional `server/config/pdf-layout.mjs` | niedrig | nicht auslagern | Layout ist lokal im Export gut lesbar. Auslagerung bringt wenig, solange keine mehreren Layouts existieren. |
| QA-Matrix Fachwerte | `60126`, `Service Ecke`, `9021-0OUT`, `34006381000`, String-Includes fuer `allowOffline` | `scripts/qa-api-matrix.mjs` | Testfixtures in `scripts/fixtures/` oder importierte Rule-Konstanten | niedrig | spaeter | Tests duerfen Beispiele enthalten. Kritisch sind aber String-Includes auf Implementierungsdetails; besser nach Regel-Auslagerung gegen Verhalten testen. |

## Bewertung nach neuen Funktionen

### Manuelle Einlagerung mit mehreren Positionen gleicher Artikelnummer

- Neue Grenzwerte: `MANUAL_STORAGE_POSITION_CREATE_COUNT_*` sind serverseitig ausgelagert, aber in `app.js`, `tablet.js` und `tablet-legacy.js` dupliziert.
- Neue Regelentscheidungen: Positionspraefix `M`, Anzahl-Validierung, `targetQty: ""`.
- Empfehlung: Count-Regeln und Positionspraefix zuerst in ein klassisches Browser-Regelbundle auslagern. Sollmengen-/Validierungslogik spaeter, weil UI und Server unterschiedliche Kontexte haben.

### Entfernte/optionale Soll-Stueckzahl bei manueller Einlagerung

- Neue Status-/Regelentscheidung: manuelle Zeile kann ohne `targetQty` gueltig sein; Menge kommt aus `actualQty`.
- Duplikate: Server, Desktop und Tablet pruefen aehnliche Regeln.
- Empfehlung: noch nicht sofort auslagern. Erst die leichteren Konstanten auslagern, danach gezielt `storageLineQuantity` und manuelle Zeilenvalidierung harmonisieren.

### Tablet-Offline-Wechsel zwischen gemeinsam uebernommenen Auftraegen

- Neue Statuswerte/Stores: `order-groups`, `groupId`, `orderIds`, `acceptedOrderDetails`.
- Duplikate: Store-Namen nur in `offline-store.js`, Workflow in Tablet Modern/Legacy.
- Empfehlung: Store-Namen koennen spaeter in Config. Workflow bleibt im Code, da er zustands- und cacheabhaengig ist.

### Manuelle Einlagerung auf Tablet verlassen/abbrechen/loeschen

- Neue Statuswerte: `localDraft === true`, Prefix `local-storage-`, Dedupe-Keys fuer POST/PUT/DELETE.
- Neue UI-Texte mehrfach in Modern/Legacy.
- Empfehlung: Dedupe-Key- und Local-Draft-Helfer vorsichtig in `shared/tablet-offline-rules.js`; UI-Texte optional spaeter.

### Bestellhinweis beim PDF-Import an Auftragsnummer

- Neue Regeln: `Bestellhinweis` Label/Rejectpatterns, Maxlaenge 80.
- Zustand: bereits in `order-hint-rules.js` ausgelagert.
- Empfehlung: vorerst lassen. Spaeter nach `shared/order-hint-rules.js` verschieben, wenn die statische Allowlist/App-Shell sauber mitgezogen wird.

### Tablet-PDF-Export ohne Tab-Reload

- Neue Statuswerte: `exportingPdf`, Option `allowOffline: false`.
- Neue Ablaufentscheidung: speichern, Queue bereinigen, frisch laden, exportieren.
- Empfehlung: Ablauf nicht auslagern. Nur Meldungstexte und eventuell eine kleine Konstantendatei fuer Buttontexte waeren spaeter sinnvoll.

## Vorgeschlagene Zielstruktur

Sinnvolle spaetere Struktur, ohne sie jetzt umzusetzen:

- `server/rules/storage-hu-rules.mjs`
  - SSI-HU-Prefix, Suffixlaenge, Normalisierung, Vollstaendigkeitspruefung, Prefix stripping.
- `shared/storage-hu-rules.js`
  - klassisches Browser-Bundle fuer `app.js`, `tablet.js`, `tablet-legacy.js`.
- `shared/manual-storage-rules.js`
  - Positionsanzahl Default/Min/Max, `M`-Positionspraefix, einfache Browser-Validierung.
- `shared/tablet-storage-keys.js`
  - LocalStorage-Key-Konstanten fuer Tablet/Desktop-Benutzerbezug.
- `shared/tablet-offline-rules.js`
  - Dedupe-Key-Helfer, `local-storage-` ID-Prefix, `localDraft`-Checks.
- `server/config/server-limits.mjs`
  - Bodylimit, Default-Limits fuer Reports/Logs.
- `scripts/check-asset-shell-sync.mjs`
  - prueft `service-worker.js`, `manifest.webmanifest`, `shared/app-pages.mjs` und `server/config/static-files.mjs` auf Synchronitaet.

## Empfohlene Reihenfolge fuer ein spaeteres Refactoring

1. Browser-/Server-HU-Konstanten und HU-Helfer auslagern.
2. Manuelle Einlagerungsanzahl und `M`-Positionspraefix fuer Desktop/Tablet harmonisieren.
3. Tablet-/Browser-Storage-Keys auslagern.
4. Sync-Queue-Dedupe-Helfer fuer Tablet Modern/Legacy zusammenfuehren.
5. Asset-/Service-Worker-Synchronitaet per Pruefscript absichern.
6. Erst danach Storage-Exportvalidierung und optionale Sollmengen-Regeln konsolidieren.
7. OCR-/PDF-Heuristiken nur mit echten Referenz-PDFs und Testfixtures weiter modularisieren.

## Risiken

- Browser-Legacy-Kompatibilitaet: `tablet-legacy.js` darf nicht durch ES-Module oder moderne Syntax gebrochen werden.
- Service Worker: Runtime-Imports sind heikel; besser generieren oder pruefen statt dynamisch importieren.
- Offline-Datenintegritaet: Dedupe-Key- und Queue-Regeln beeinflussen, ob lokale Aenderungen spaeter korrekt synchronisiert werden.
- Server/UI-Meldungen: gleiche Texte koennen fachlich gewollt sein, aber Serverfehler und UI-Hinweise brauchen teilweise anderen Kontext.
- OCR-Heuristik: Auslagerung kann die Lesbarkeit verbessern, aber kleine Regex-Aenderungen koennen echte PDFs anders importieren.

## Tests nach spaeterer Auslagerung

Mindestens ausfuehren:

- `npm.cmd run lint`
- `node --check` fuer alle geaenderten JS/MJS-Dateien
- `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa`
- Browser-Smoke Desktop Import/Export
- Browser-Smoke Tablet: Auftrag uebernehmen, Position abhaken, direkt PDF exportieren
- Offline-Smoke Tablet: gemeinsam uebernommene Auftraege wechseln und getrennt speichern
- Manuelle Einlagerung: mehrere gleiche Artikelnummern, leere Sollmenge, SSI-HU-Pflicht nur bei Kunde SSI
- PDF-/Textfixture: `Bestellhinweis` same-line, next-line, ohne Hinweis, Doppelanhaengung
- Service-Worker-Check: neue Asset-Version und App-Shell-Auslieferung
- CR-002-Zusatzcheck: abgehakter Kommissionierauftrag exportiert trotz Bestandsbuchungsfehlern weiter

## Nicht auslagern

Bewusst im Code lassen:

- Datenbanktransaktionen und SQLite-Schreiblogik.
- Tablet-Export-Pipeline inklusive `try/catch/finally`.
- Offline-Sync-Abarbeitung und IndexedDB-Migrationen, abgesehen von reinen Namen/Konstanten.
- PDF-Rendering-HTML in `server/export.mjs`, solange nur ein Layout existiert.
- Fehlerbehandlung, die unmittelbaren Request-, UI- oder Datenbankkontext benoetigt.

## CR-002

CR-002 wurde in dieser Review nicht veraendert. Die QA-Matrix bestaetigt weiterhin: Ein abgehakter Kommissionierauftrag darf trotz Bestandsbuchungsfehlern exportiert werden; der Fehler wird protokolliert.
