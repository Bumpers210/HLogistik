# HLogistik Robustness Audit

Stand: 2026-06-25 10:08:47 +02:00

## PDF-Import OCR-Kandidatenbewertung

Geprueft und verbessert:

- Kommissionier-PDFs werden nicht mehr aus einem seitenweise gemischten OCR-Ergebnis aufgebaut.
- Der Import bildet vollstaendige OCR-Kandidaten aus Skala und Rotation und waehlt den besten Kandidaten anhand messbarer Tabellenqualitaet.
- Verwendete Skalen: `6`/DPI `1000` und `7.5`/DPI `1600`.
- Verwendete Rotationen: `0`, `90`, `180`, `270`.
- Der Score bewertet erkannte Tabellenpositionen, Pflichtfelder, Von-Lagerplatz, Nach-Lagerplatz, HU, Produkt und Menge; fehlende oder verdaechtige Quellfelder werden abgezogen.
- Wenn kein Kandidat die Mindestqualitaet erreicht, wird der Import abgebrochen, bevor ein Auftrag im UI-Zustand entsteht.
- Der Von-Lagerplatz bleibt der OCR-Rohwert aus der Spalte `Von-Lagerplatz`; es gibt keine Stellplatzvalidierung, keine Stellplatzkorrektur, keinen SSI-Regelabgleich und keinen Bestands-Stellplatzersatz im PDF-Importpfad.

Robustheitsgewinn:

- Fehlorientierte oder qualitativ schwache OCR-Laeufe werden nicht mehr still mit besseren Seiten/Zeilen anderer Kandidaten vermischt.
- Die Diagnose zeigt Kandidaten, Scores, Skalen, DPI, Rotation und Roh-/Finalwerte pro importierter Position.
- Cache-Bump auf `app.js?v=20260625-6` und Service Worker `1.5.144` verhindert, dass bekannte Clients die alte Importlogik behalten.

Validierung:

- QA-Matrix erweitert um Kandidatenbewertung, Score-Regeln und Diagnosefelder.
- CR-002 bleibt unveraendert.

## PDF-Import Roh-Stellplatzdiagnose

Geprueft:

- Rohwert aus `Von-Lagerplatz` wird vor nachgelagerten Bestands-/Stellplatzabgleichen betrachtet.
- Referenz-HUs `340063810002072174` und `340063810002072181` mit Produkt `1060610` ergeben jeweils `002-H3-SO4D1`.
- `Nach-Lagerplatz` `9021-0OUT` bleibt Zielplatz/Kunde und wird nicht als Von-Lagerplatz verwendet.
- Keine neue automatische Stellplatzkorrektur wurde eingefuehrt.

Robustheitsgewinn:

- Importdiagnose zeigt fuer jede erkannte Position Roh-Stellplatz und finalen Stellplatz.
- Abweichungen muessen kuenftig mit einem Grund sichtbar sein, statt Rohimportfehler durch eine spaetere Korrektur zu verdecken.
- QA-Matrix schuetzt gegen Verwechslung von Produktnummer, Menge oder Nach-Lagerplatz mit der Quelle `Von-Lagerplatz`.

Validierung:

- Direkter Parser-Harness fuer die Referenzzeilen.
- QA-Matrix um Roh-Stellplatz- und Diagnosechecks erweitert.
- CR-002 bleibt unveraendert.

## PDF-Import Lageraufgabe-Scan

Geprueft und verbessert:

- Lageraufgabe-Zeilenstarterkennung akzeptiert jetzt 6 bis 14 Ziffern.
- Kommissionierimport ohne erkannte Positionen bricht vor jeder Zustandsaenderung ab.
- Keine zufaelligen Metadaten werden aus OCR-Resten in den aktuellen Auftrag uebernommen, wenn keine Positionen erkannt wurden.
- Die Importdiagnose wird nur in der Browser-Konsole ausgegeben und erzeugt keine dauerhaften QA-Dateien.

Validierung:

- Parser-Fixture mit Spalten `Lageraufgabe`, `Von-Handling-Unit`, `Von-Lagerplatz`, `Produkt`, `Menge`, `Basis`, `Produktbeschreibung`, `Nach-Lagerplatz`.
- Abbruch-Harness fuer Text ohne Positionen bestaetigt unveraenderten Auftragzustand.
- CR-002 bleibt unveraendert.

## Buchungsexport inklusive Fehlerlog

Geprueft und umgesetzt:

- Der Artikelstamm-Buchungsexport liest jetzt neben `lagerbewegung` auch `bestandsbuchung_fehler`.
- Beide Quellen werden read-only geladen, zusammen sortiert und im bestehenden XLSX-Aufbau ausgegeben.
- Fehlerzeilen behalten die Richtung `AUS`, werden ueber `auftrag_id` bzw. gespeicherte `auftragsnummer` dem eigentlichen Auftrag zugeordnet und nutzen in `Referenz` die Auftragsreferenz.
- Fehlermeldungen aus dem Fehlerlog werden nicht in die Spalte `Referenz` geschrieben.
- Die Spalten bleiben unveraendert, damit bestehende Auswertungen nicht brechen.

Validierung:

- QA-Matrix erweitert um einen CR-002-Buchungsfehler, der danach im Buchungsexport mit Auftragsreferenz gesucht wird.
- Isolierte QA-Kopie `tmp/bookings-export-errors-qa-20260625-080743/` mit 78/78 Checks.
- Nachkorrektur gegen `tmp/booking-error-reference-qa-20260625-081519/` mit 78/78 Checks: Fehlerzeilen verwenden `Kommissionierung <Auftragsnummer>` statt Fehlermeldung in `Referenz`.
- CR-002 bleibt unveraendert.

## Artikelstamm Buchungsexport

Geprueft und umgesetzt:

- Der Export liest ausschliesslich aus `lagerbewegung`; es gibt keine Schreiboperation, keine Dateipfadeingabe und keine serverseitige Exportdatei.
- Zeitraumparameter muessen echte ISO-Daten sein; `Von` nach `Bis` wird als HTTP 400 abgelehnt.
- `Bis` schliesst den ganzen gewaehlten Tag ein, indem serverseitig bis kleiner Folgetag gefiltert wird.
- Rollenfehler werden vor der Datenabfrage mit HTTP 403 abgelehnt.
- Die Excel-Datei wird im Browser mit der vorhandenen `xlsx.full.min.js` erzeugt.

Ergebnis:

Der neue Buchungsexport ist ein read-only Reportpfad. Er veraendert weder Lagerbestand noch Auftraege noch Exportstatus und erzeugt keine dauerhaften QA- oder Tempdateien auf dem Server.

Validierung:

- Syntaxcheck fuer `server.mjs`, `server/reports.mjs`, `artikel.js` und `service-worker.js`.
- Direkter Report-Funktionscheck gegen vorhandene Bewegungsdaten.
- HTTP-Smoke auf Port `4175` fuer 200/400/403.
- Vollstaendige QA-Matrix gegen isolierte Kopie `tmp/bookings-export-qa-20260625-073122/` mit 77/77 Checks.
- CR-002 bleibt unveraendert.

## Tablet-Kommissionierexport

Geprueft und verbessert:

- Online-Speicherung vor dem PDF-Export wird jetzt explizit erzwungen.
- Offline-Fallback darf den PDF-Export nicht mehr starten.
- Pending-Queue fuer denselben Auftrag wird nach erfolgreichem Server-Save bereinigt, damit kein alter Tablet-Zustand spaeter nachgeschoben wird.
- Direkt vor dem Export wird der Auftrag frisch vom Server geladen.
- Offene Positionen und Einlagerungsvalidierung werden nach dem Reload erneut geprueft.
- Exportbutton hat einen Single-Flight-Guard und wird bei Fehlern wieder freigegeben.

Ergebnis:

Der Tablet-Export haengt nicht mehr am impliziten Callback-/Reload-Zustand. Ein Tab-Reload vor der PDF-Erstellung ist nicht mehr Teil des erwarteten Workflows.

Validierung:

- Baseline-QA vor Umsetzung bestand mit 50/50 Checks.
- QA-Matrix enthaelt einen Tablet-Direktexport: Auftrag per Tablet speichern, Serverzustand laden und ohne Reload-Workaround exportieren; finale Matrix bestand mit 52/52 Checks.
- Browser-Smoke bestaetigt direkten Tablet-Export nach Positionsaenderung ohne Tab-Reload.
- Headless-Chrome-CDP-Smoke bestaetigt sichtbare Fehlermeldung und freigegebenen Button bei offenen Positionen.
- CR-002 bleibt unveraendert und wird weiter in der QA-Matrix geprueft.

## PDF-Import Bestellhinweis

Geprueft und verbessert:

- Labelbasierte Erkennung von `Bestellhinweis`.
- Same-line- und next-line-Werte.
- Normalisierung von Whitespace und problematischen Datei-/Exportzeichen.
- Vermeidung von Doppelanhaengen.
- Ablehnung typischer Nicht-Hinweise wie Tabellenueberschriften, Datum/Uhrzeit, Mengen, Lagerplaetze, Artikelnummern und Barcodes.

Ergebnis:

Der Import kann gedruckte Bestellhinweise in die Auftragsnummer uebernehmen, ohne beliebigen Kopf- oder Tabellentext einzusammeln. Beispiel: `60126` + `Service Ecke` ergibt `60126-Service Ecke`.

Validierung:

- QA-Matrix nutzt einen VM-Harness fuer die echte `parseOrderText()`-Funktion aus `app.js`.
- Positionsparsing bleibt in derselben Fixture aktiv.
- CR-002 wurde in der QA-Matrix gegengeprueft und bleibt unveraendert.

## Tablet manuelle Einlagerung verlassen/abbrechen/loeschen

Geprueft und verbessert:

- Nicht-destruktives Verlassen einer manuellen Tablet-Einlagerung.
- Separates Loeschen serverseitig angelegter offener manueller Einlagerungen.
- Abbrechen reiner lokaler Offline-Entwuerfe inklusive Sync-Queue- und Cache-Bereinigung.
- Offline-Listenrendering bei leerem Cache, damit geloeschte lokale Eintraege nicht als `[Cache]` sichtbar bleiben.
- Cache-Bump fuer Tablet-Assets und Service Worker auf `1.5.122`.

Ergebnis:

Der Tablet-Workflow hat keinen bekannten Fangzustand mehr fuer manuelle Einlagerung. Benutzer koennen eine Einlagerung verlassen, lokale Entwuerfe abbrechen oder serverseitige offene Einlagerungen loeschen.

Validierung:

- `npm.cmd run lint`
- `node --check tablet-legacy.js`, `tablet.js`, `scripts\qa-api-matrix.mjs`, `service-worker.js`
- `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` mit 42/42 Checks
- Headless-Chrome-CDP-Smoke gegen `tmp/tablet-manual-storage-postfix-qa-20260623-081813/`

## Tablet Offline-Auftragsgruppen

Geprueft und verbessert:

- Gemeinsame Tablet-Uebernahme mehrerer Auftraege derselben Kundengruppe.
- Lokale Vollauftrags-Speicherung pro Auftrag-ID.
- Zusaetzliche Gruppenablage `order-groups` im Offline-Store mit `groupId` und `orderIds`.
- Wechsel zwischen uebernommenen Auftraegen bei unterbrochener Serververbindung.
- Offline-Speichern nach nachtraeglichem Verbindungsverlust ueber bestehende Sync-Queue.

Ergebnis:

Der Tablet-Workflow ist robuster gegen Verbindungsabbrueche. Nach einer Gruppenuebernahme bleiben alle gemeinsam uebernommenen Auftraege lokal sichtbar, wechselbar und pro Auftrag getrennt bearbeitbar.

Validierung:

- QA-Matrix erweitert: zwei Auftraege gleicher Kundengruppe werden gemeinsam uebernommen; Details und Summaries werden geliefert; getrennte Updates bleiben getrennt.
- Browser-Smoke online und offline gegen `tmp/tablet-offline-group-qa/` auf Port `4175`.
- Cache-/Manifest-Version: `1.5.118`.

## Manuelle Einlagerung

Die manuelle Einlagerung wurde gegen versehentliche Massenanlage abgesichert:

- `Anzahl Positionen` wird auf positive ganze Zahlen validiert.
- Obergrenze: `100` Positionen pro Anlageaktion bzw. manuellem Einlagerauftrag.
- Mehrere Positionen derselben Artikelnummer bleiben erlaubt.
- Soll-Stueckzahl ist fuer manuelle Einlagerung optional und wird in der manuellen UI nicht mehr angezeigt.
- SSI-HU-Regeln bleiben unveraendert; vollstaendige HU-Werte werden nicht automatisch dupliziert.

Die QA-Matrix deckt Mehrfachanlage, fehlende Sollmenge, ungueltige Anzahl und SSI-HU-Pflicht ab.

## Regel-Refactoring

Die fachlichen Serverregeln sind jetzt kontrolliert in `server/rules/` und `server/config/` gebuendelt. Dadurch sind Rollenmatrix, Gebinderegeln, Lagerkonstanten, SSI-Stellplatznormalisierung, Kunden-/Auftragsregeln und Export-Vollstaendigkeitspruefung besser pruefbar.

Verhalten:

- Keine REST-API-, Datenbank- oder Exportformat-Aenderung.
- CR-002 bleibt aktiv und wurde nicht umgebaut.
- Browser-/Tablet-Legacy-Regeln bleiben bewusst nicht voll modularisiert.

Validierung:

- Jede Refactoring-Stufe wurde mit `npm.cmd run lint`, `node --check` fuer die geaenderten Dateien und `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` geprueft.
- Die finale QA-Matrix bestand mit 24/24 Checks.
- CR-002 wurde gezielt gegengeprueft: Ein abgehakter Auftrag mit Bestandsbuchungsfehler wurde weiterhin exportiert und der Fehler blieb protokolliert.

## Teststrategie

Schreibende QA-Tests laufen weiterhin gegen isolierte Kopien, nicht gegen die aktive Produktivdatenbank.

Aktuelle Pruefumgebungen:

- QA-Kopie: `tmp/risk-qa-workspace/`
- QA-Port: `4175`
- Korrupte-DB-Kopie: `tmp/risk-corrupt-db-workspace-20260622-083739/`

## Eingabevalidierung

Geprueft:

- Ungueltige Artikelmengen
- Fehlende/ungueltige JSON-Nutzlast
- Fehlende Rolle bei Mutationen
- Unvollstaendige Auftraege beim Export
- Umlaute/Sonderzeichen in Artikeltexten

Ergebnis:

`npm run test:qa` gegen die isolierte Kopie bestand mit 21/21 Checks.

## Datenintegritaet

Geprueft:

- SSI-Warenausgang nach normalisiertem SSI-Wareneingang
- Bestand nach Teilentnahme
- Auftragsanlage mit 9021-0OUT
- Export-Sperre bei offenen Positionen
- Loeschen nicht exportierter Auftraege

Ergebnis:

Die geprueften Datenpfade verhalten sich konsistent. CR-002 wurde nicht geaendert.

## Datenbank-Robustheit

Leere Datenbank:

Leere Datenablaegen werden weiterhin automatisch initialisiert.

Korrupte Datenbank:

Korrupte SQLite-Dateien werden nicht automatisch repariert. Der Server gibt jetzt vor dem Abbruch eine klare Diagnose mit betroffenen Dateien und Wiederherstellungshinweis aus.

Betreiberentscheidung:

Ein automatischer Quarantaene-/Restore-Modus ist nicht aktiv. Vor einer solchen Funktion muss entschieden werden, wann Dateien verschoben werden duerfen, welcher Backup-Stand automatisch vertrauenswuerdig ist und wie versehentlicher Datenverlust verhindert wird.

## Datei- und Exportpfade

Geprueft:

- Fehlende statische Datei
- Separater Exportordner in der QA-Kopie
- PDF-Export-Endpunkt vor Validierungsfehlern

Ergebnis:

Fehlende statische Dateien liefern HTTP 404. Der Export unvollstaendiger Auftraege bleibt blockiert.

## Service Worker

Der Offline-Navigationsfallback ist fuer bekannte App-Seiten konsistenter:

- `/` und `/index.html` -> `/index.html`
- `/tablet.html` -> `/tablet.html`
- `/lager.html` -> `/lager.html`
- `/artikel.html` -> `/artikel.html`
- `/auswertungen.html` -> `/auswertungen.html`
- unbekannte Pfade -> `/index.html`

Cache- und Manifest-Version: `1.5.113`.

## UI-Robustheit

Browser-Smokes:

- Desktop 1280 px: `/`, `/lager.html`, `/artikel.html`, `/auswertungen.html`
- Tablet 820 px: `/tablet.html`

Ergebnis:

Alle geprueften Seiten laden ohne Konsolenfehler und ohne horizontalen Body-Overflow.

## Security- und Betriebsbefunde

- Mutationen bleiben gegen falsche Rollen serverseitig abgesichert.
- `ARTICLE_DELETE_PASSWORD` gibt beim fehlenden Umgebungswert jetzt eine Startwarnung aus.
- Das Rollenmodell ist ein LAN-Schutz gegen Fehlbedienung, keine echte Authentifizierung.
- Ein harter Startabbruch ohne gesetztes `ARTICLE_DELETE_PASSWORD` ist noch nicht aktiv und bleibt Betreiberentscheidung.

## QA-Exportartefakte

Befund:

Die API-Matrix verwendete fuer CR-002, Tablet-Direktexport und Einlagerabschluss bisher echte Exportaufrufe. Dadurch konnten `QA-*.pdf` im konfigurierten Exportziel und `QA-*.html` im Tempbereich liegen bleiben.

Neue Absicherung:

- QA-Exports senden `x-qa-discard-export: 1`.
- Der Server akzeptiert den Discard-Modus nur fuer lokale Requests und QA-Auftraege.
- Im Discard-Modus wird kein PDF in dauerhafte Exportziele kopiert.
- Temporaere HTML-/PDF-Dateien werden im `finally` geloescht.
- Die QA-Matrix prueft am Ende des Laufes auf verbleibende `QA-*.pdf` und `QA-*.html` fuer den aktuellen Lauf.

Produktiver Export:

Normale Exporte ohne QA-Header bleiben unveraendert und erzeugen weiterhin PDF-Dateien im Exportziel.

## Manuelle Einlagerungspositionen

Neue Absicherung:

- Neue manuelle Positionen uebernehmen keinen Stellplatz mehr aus Artikelstamm, vorheriger Position, Auftrag oder Default.
- Desktop und Tablet erzwingen beim manuellen Anlegen eine positive ganzzahlige Stueckzahl.
- Die Servervalidierung weist manuelle Positionen mit ungueltiger Stueckzahl als HTTP 400 mit fachlicher Meldung ab.

Bestehende Entwuerfe:

Leere Platzhalterzeilen bleiben erlaubt, solange sie keinen weiteren Inhalt enthalten. Gespeicherte Positionen mit vorhandenen Stellplaetzen werden weiterhin geladen und angezeigt.

## Tablet-PDF-Export und Auftragsabschluss

Befund:

Der Tablet-Export darf den lokalen Auftrag erst verlassen bzw. lokale Sync-Spuren entfernen, wenn der Server den PDF-Export bestaetigt hat. Zusaetzlich muss der Server sicherstellen, dass der Browser-Aufruf tatsaechlich eine PDF-Datei erzeugt hat.

Neue Absicherung:

- `tablet-legacy.js` und `tablet.js` rufen `removeQueuedOrderMutations` erst nach erfolgreichem PDF-Export mit `ok: true` auf.
- `server/export.mjs` prueft die erzeugte PDF per Dateistatus und Groesse.
- Wenn die Datei fehlt oder leer ist, wird der Auftrag nicht als exportiert markiert und bleibt fuer Nacharbeit sichtbar.
- Die API-Matrix enthaelt statische Regressionchecks fuer diese Reihenfolge und die Datei-Pruefung.

Restpruefung:

Auf dem echten Tablet einmal Cache aktualisieren oder Seite neu laden und einen kontrollierten Export mit absichtlich blockiertem PDF-Ziel in einer isolierten Kopie pruefen.

## Originaldatei-Archivierung nach PDF-Export

Neue Absicherung:

- Importierte Originaldateien werden nur ueber einen verwalteten Importordner aufgeloest.
- Der Client speichert nur den Dateinamen; der Server ignoriert Client-Pfade und berechnet den Pfad selbst.
- Archivierung startet erst nach erfolgreicher PDF-Erstellung und Exportstatus-Speicherung.
- Bei Exportvalidierung, PDF-Fehlern oder Abbruch bleibt die Originaldatei im Importordner.
- Bei Archivfehlern bleibt die PDF erhalten; der Auftrag speichert den Fehler in `originalArchiveError`.
- Namenskollisionen im Archiv fuehren zu einem eindeutigen neuen Dateinamen.

QA-Abdeckung:

- Erfolgreiche Archivierung in temporärem QA-Importordner.
- Keine Archivierung bei Validierungsfehler.
- Kollision ohne Ueberschreiben.
- Bereits archivierte Datei wird nicht erneut verschoben.
- Fehlende Metadaten und fehlende Dateien erzeugen keinen Serverabbruch.
- Path-Traversal-Dateinamen werden abgelehnt.
## 2026-06-25 - PDF-Import: OCR-only ohne Stellplatzkorrektur

Befund:

Nach mehreren Reparaturversuchen wurden Von-Lagerplaetze im Kommissionier-PDF-Import zu stark nachbearbeitet. Dadurch konnten OCR-Rohwerte durch Stellplatzvalidierung, Korrektur oder Bestandsabgleich veraendert werden.

Neue Absicherung:

- Kommissionier-PDFs verwenden nur noch den hochaufloesenden OCR-Pfad.
- Die PDF-Textschicht und der einfache PDF-Text-Fallback werden fuer Kommissionier-PDFs nicht mehr als Importquelle genutzt.
- Von-Lagerplaetze werden nur aus dem OCR-/Tabellenwert der Spalte `Von-Lagerplatz` gebildet.
- Erlaubt bleiben nur technische Feldbereinigungen: trimmen, Whitespace entfernen und Bindestriche vereinheitlichen.
- Es gibt keine automatische `O/0`-, `S/5`-, `I/1`- oder SSI-Regelkorrektur fuer Von-Lagerplaetze im PDF-Importpfad.
- Der Bestandsabgleich darf importierte Von-Lagerplaetze nicht mehr ersetzen oder leer auffuellen.

QA-Abdeckung:

- Die API-Matrix enthaelt Checks fuer OCR-only, deaktivierten Stellplatz-Repair, keine SSI-Stellplatzregel im App-Importpfad und unveraenderte OCR-Rohwerte.
- Der Check `picking import keeps OCR-confused SSI source bins unchanged` bestaetigt, dass `002-H3-5010A2` und `002-H3-5Z2D1` nicht mehr automatisch umgeschrieben werden.
