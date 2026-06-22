# HLogistik Open Risks

Stand: 2026-06-22 13:35:44 +02:00

## Aktueller Lauf - Tablet Offline-Auftragsgruppen

Keine neuen offenen Risiken aus dem Fix. Die automatische Kundengruppierung wurde nicht fachlich veraendert. Die Offline-Verfuegbarkeit haengt weiterhin davon ab, dass der Auftrag vor dem Verbindungsverlust am Tablet uebernommen und in den lokalen Browserdaten gespeichert wurde.

## Aktueller Lauf - manuelle Einlagerung

Keine neuen offenen Risiken aus der Mehrfachpositions-Erweiterung. Die Obergrenze `100` ist bewusst konservativ und kann spaeter fachlich angepasst werden.

## RISK-001 - CR-002 bleibt bewusst aktiv

Prioritaet: P2

Kommissionierexporte koennen trotz Bestandsbuchungsfehlern abgeschlossen werden. Das ist aktuell bewusstes Uebergangsverhalten, bis Artikel und Bestaende vollstaendig gepflegt sind.

Empfehlung: Sobald Stammdaten und Bestaende stabil sind, Export bei Bestandsbuchungsfehlern blockieren oder einen klaren Freigabeprozess einfuehren.

## RISK-002 - Automatisches Restore korrupter SQLite-Dateien ist nicht aktiv

Prioritaet: P1

Korrupte SQLite-Dateien verhindern weiterhin den produktiven Start, werden jetzt aber klar diagnostiziert. Es gibt absichtlich keine automatische Quarantaene und kein automatisches Restore.

Betreiberentscheidung:

- Duerfen korrupte Dateien automatisch in einen Quarantaene-Ordner verschoben werden?
- Welcher Backup-Stand darf automatisch eingespielt werden?
- Soll der Server danach automatisch neu starten oder auf manuelle Freigabe warten?

Empfehlung: Erst nach klaerer Betriebsentscheidung automatisieren.

## RISK-003 - Passwort-Fallback bleibt fuer Kompatibilitaet vorhanden

Prioritaet: P2

`ARTICLE_DELETE_PASSWORD` hat weiterhin einen Fallback im Code. Der Server warnt nun beim Start, wenn der Umgebungswert fehlt.

Betreiberentscheidung:

Soll der produktive Start ohne `ARTICLE_DELETE_PASSWORD` in Zukunft hart verweigert werden?

Empfehlung: Passwort dauerhaft per Umgebung setzen und spaeter den Fallback entfernen oder per Betriebsmodus blockieren.

## RISK-005 - OCR/PDF-Import bleibt fachlich schwer vollautomatisch testbar

Prioritaet: P2

Der PDF-/OCR-Import enthaelt viele Heuristiken fuer echte Auftragsdokumente. Die API- und UI-Smokes pruefen Stabilitaet, ersetzen aber keine regelmaessige Stichprobe mit echten Kunden-PDFs.

Empfehlung: Eine kleine Sammlung anonymisierter Referenz-PDFs aufbauen und Import-Erwartungen als technische Regressionstests ablegen.

## RISK-007 - LAN-Rollenmodell ist keine echte Authentifizierung

Prioritaet: P2

Die Rollen werden ueber Browserzustand und `X-User-Group` abgesichert. Das reduziert Fehlbedienung im LAN, ersetzt aber kein Benutzerkonto-/Session-System.

Betreiberentscheidung:

Soll HLogistik ausserhalb eines kontrollierten LANs erreichbar sein, muss ein echtes Authentifizierungs- oder Netzschutzkonzept davor.

## RISK-008 - Browser-Regellisten bleiben teilweise dupliziert

Prioritaet: P3

Serverseitige Regeln sind ausgelagert. Einige Browser-/Tablet-Legacy-Konstanten, besonders HU-Prefix und Service-Worker-App-Shell, bleiben bewusst klassisch im Frontend dupliziert, damit alte Tablets keine ES-Modul- oder Service-Worker-Kompatibilitaetsprobleme bekommen.

Empfehlung: Bei spaeterer Modernisierung ein klassisches Browser-Regelbundle mit Regressionstests fuer Desktop und Tablet planen.

## Erledigt in diesem Lauf

- RISK-004: Service-Worker-Offline-Fallback fuer Desktop-Unterseiten vereinheitlicht.
- RISK-006: API-Matrix als `scripts/qa-api-matrix.mjs` und `npm run test:qa` versioniert.
- Regel-Refactoring: Server-Regeln in `server/rules/`, statische Allowlist in `server/config/static-files.mjs`, App-Seiten in `shared/app-pages.mjs` dokumentiert.
