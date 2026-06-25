# HLogistik Open Risks

Stand: 2026-06-25 10:08:47 +02:00

## Aktueller Lauf - PDF-Import OCR-Kandidatenbewertung

Kein neues offenes Produktivrisiko aus der technischen Umstellung. Der Import waehlt jetzt den besten kompletten OCR-Kandidaten aus Skala und Rotation und bricht bei zu schwacher Qualitaet ab, bevor ein Auftragszustand entsteht.

Restempfehlung:

Mindestens zwei problematische Original-PDFs und ein bisher funktionierendes PDF manuell im Browser importieren. Die CLI-Umgebung hat keine lokale OCR-Engine; die echte OCR-Qualitaet muss deshalb im Browserpfad validiert werden. Nach Deployment Browser hart neu laden bzw. Service Worker aktualisieren, damit `app.js?v=20260625-6` und Cache `1.5.144` aktiv sind.

## Aktueller Lauf - PDF-Import Roh-Stellplatz

Kein neues offenes Produktivrisiko aus dem Lauf. Es wurde keine automatische Stellplatzkorrektur eingebaut; der Rohimport wird jetzt diagnostiziert und per QA-Matrix abgesichert.

Restempfehlung:

Vor einer spaeteren Stellplatzregel-Validierung weitere echte Referenz-PDFs stichprobenartig pruefen. Die neue Diagnose muss bei jeder Abweichung zeigen, ob der Fehler aus der OCR-/Spaltenlogik oder aus einer nachgelagerten Anreicherung stammt.

## Aktueller Lauf - PDF-Import Lageraufgabe-Scan

Kein neues offenes Produktivrisiko aus dem Fix. Der Import bricht bei 0 Positionen jetzt sauber ab, statt einen halbfertigen Auftragszustand zu erzeugen.

Restempfehlung:

Nach Deployment Browser hart neu laden bzw. Service-Worker aktualisieren, damit `app.js?v=20260625-2` und Cache `1.5.140` aktiv sind. Fuer echte OCR-Qualitaet bleibt RISK-005 relevant.

## Aktueller Lauf - Artikelstamm Buchungsexport

Kein neues offenes Produktivrisiko aus der Erweiterung. Der Endpunkt ist read-only, validiert den Zeitraum und erzeugt keine serverseitige Exportdatei.

Restempfehlung:

Nach Deployment den Server neu starten, damit der neue API-Endpunkt aktiv wird. Danach `artikel.html` einmal hart neu laden oder den Service-Worker-Cache aktualisieren, damit die neue Oberflaeche sicher geladen ist.

## Aktueller Lauf - Tablet-Kommissionierexport

Keine neuen offenen Risiken aus dem Fix. Der Tablet-PDF-Export ist weiterhin ein Online-Servervorgang. Wenn Server oder Netzwerk nicht erreichbar sind, wird der Export bewusst nicht gestartet; offene Aenderungen bleiben lokal speicherbar bzw. synchronisierbar.

## Aktueller Lauf - PDF-Import Bestellhinweis

Keine neuen offenen Risiken aus dem Fix. Der Import bleibt heuristisch, aber die neue Bestellhinweis-Erkennung ist labelbasiert und in der QA-Matrix abgesichert. Fuer echte Scan-/OCR-Qualitaet bleibt RISK-005 relevant.

## Aktueller Lauf - Tablet manuelle Einlagerung verlassen/abbrechen/loeschen

Keine neuen offenen Risiken aus dem Fix. Serverseitig angelegte offene manuelle Einlagerungen werden geloescht; reine Offline-Entwuerfe werden lokal abgebrochen. Wenn ein serverseitiger Auftrag offline geloescht wird, bleibt die bestehende Sync-Queue-Logik verantwortlich fuer die spaetere Server-Loeschung.

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

Der PDF-/OCR-Import enthaelt viele Heuristiken fuer echte Auftragsdokumente. Die API- und UI-Smokes pruefen Stabilitaet, ersetzen aber keine regelmaessige Stichprobe mit echten Kunden-PDFs. Fuer Kommissionier-PDFs werden Von-Lagerplaetze jetzt bewusst nicht mehr automatisch korrigiert; OCR-Rohwerte muessen bei auffaelligen Scans fachlich geprueft oder manuell bearbeitet werden.

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

## Aktueller Lauf - QA-Exportartefakte

Kein neues offenes Produktivrisiko aus dem Fix. QA-Exports werden nur bei lokalem Request, QA-Auftrag und explizitem Header verworfen. Normale Benutzerexporte bleiben aktiv.

Restempfehlung:

Regelmaessig pruefen, dass QA-Laeufe weiterhin gegen eine isolierte Kopie auf Port 4175 laufen. Der Schutz gegen versehentliche Live-Schreibtests bleibt wichtig, weil die QA-Matrix weiterhin Auftraege und Buchungen erzeugt.

## Aktueller Lauf - manuelle Einlagerungsfelder

Kein neues offenes Produktivrisiko aus dem Fix. Die Stueckzahl ist jetzt beim manuellen Anlegen explizit und wird fachlich validiert. Neue Stellplatzfelder starten leer; vorhandene gespeicherte Stellplaetze bleiben erhalten.

Restempfehlung:

Auf echten Tablets nach Cache-Update einmal pruefen, dass die neue Tablet-Version geladen wurde und dass mehrere Positionen derselben Artikelnummer getrennt bearbeitbare Stellplaetze behalten.

## Aktueller Lauf - Tablet-PDF-Export

Kein neues offenes Produktivrisiko aus dem Fix. Der Auftrag wird erst nach serverseitig bestaetigter PDF-Erstellung lokal aufgeraeumt, und der Server markiert den Auftrag nur bei vorhandener, nicht leerer PDF als exportiert.

Restempfehlung:

Auf dem echten Tablet nach Cache-Update einen Einlagerabschluss testen. Wenn das Exportziel ein Netzlaufwerk ist, sollte zusaetzlich ein isolierter Fehlerfall mit nicht erreichbarem Exportziel geprueft werden.

## Aktueller Lauf - Originaldatei-Archivierung

Kein neues kritisches Produktivrisiko aus dem Fix. Die Archivierung ist nachgelagert: PDF-Export und Auftragsabschluss bleiben erfolgreich, auch wenn das Verschieben der Originaldatei fehlschlaegt.

Restempfehlung:

Den gewuenschten Importordner betrieblich festlegen und entweder `HLOGISTIK_IMPORT_DIR` oder `import-path.txt` setzen. Ohne Konfiguration nutzt der Server den Exportordner als Importordner, damit keine beliebigen Benutzerpfade akzeptiert werden.
