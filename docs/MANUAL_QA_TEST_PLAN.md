# HLogistik Manual QA Test Plan

Stand: 2026-06-25 10:08:47 +02:00

## Vorbereitung

1. Vor schreibenden Tests eine isolierte Kopie erstellen.
2. Server in der Kopie starten, z. B. auf Port `4175`.
3. `QA_BASE_URL=http://127.0.0.1:4175 npm run test:qa` ausfuehren.
4. Fuer Live-Server nur bewusst testen: `QA_ALLOW_LIVE=1` setzen, da Testdaten geschrieben werden.

## Automatisierte QA-Matrix

Skript: `scripts/qa-api-matrix.mjs`

NPM-Befehl: `npm run test:qa`

Geprueft werden:

- statische Kernseiten
- `/api/health`
- Artikelvalidierung
- UTF-8 in Artikeltexten
- SSI-Wareneingang/-ausgang mit Stellplatznormalisierung
- Rollenfehler bei Mutationen
- 9021-0OUT-Kunden-/SSI-Auftragsnummerregel
- Export-Sperre bei offenen Positionen
- Manuelle Einlagerung mit Anzahl Positionen `1` und `>1`
- Manuelle Einlagerung ohne Soll-Stueckzahl
- Ablehnung geloeschter/abgeschlossener Einlagerauftraege beim Loeschen
- Tablet manuelle Einlagerung: offene serverseitige Einlagerung loeschen
- Tablet-Kommissionierung: bearbeiteten Auftrag speichern, Serverzustand laden und direkt ohne Reload exportieren
- Tablet-Exportscript: Guard gegen parallele Exporte und Online-Speicherpflicht
- PDF-/Textfixtures fuer `Bestellhinweis` an der Auftragsnummer
- Lageraufgabe-Importfixture mit langer Lageraufgabe-Nummer und Spalten `Von-Handling-Unit`, `Von-Lagerplatz`, `Produkt`, `Menge`, `Basis`, `Nach-Lagerplatz`
- Roh-Stellplatz-Import fuer Produkt `1060610`, HU `340063810002072174`/`340063810002072181`, `Von-Lagerplatz` `002-H3-SO4D1`
- Kommissionier-PDF-Import: OCR-Kandidaten aus Skalen `6`/`7.5` und Rotationen `0`/`90`/`180`/`270`, Score-Auswahl, Diagnose mit Kandidatenliste und keine Stellplatzkorrektur
- Artikelstamm-Buchungsexport mit Zeitraum, Spaltenreihenfolge, `EIN`/`AUS`, Rollenfehler und read-only Wiederholaufruf
- Ablehnung von mehr als `100` manuellen Einlagerungspositionen
- Tablet-Gruppenuebernahme: zwei Auftraege gleicher Kundengruppe werden gemeinsam uebernommen und getrennt aktualisiert
- Reports
- 404 und malformed JSON

## Smoke-Test Desktop

1. `/` laden.
2. Mit Buero-Rolle anmelden.
3. Navigation zu Buchung, Artikelstamm und Auswertungen pruefen.
4. Kein horizontaler Scrollbalken, keine abgeschnittenen Hauptbuttons.

Erwartung: Alle Ansichten laden ohne sichtbare Fehler.

## Kommissionier-PDF-Import OCR

1. Seite hart neu laden, damit `app.js?v=20260625-6` aktiv ist.
2. Problematisches gescanntes Lageraufgabe-PDF importieren.
3. Browser-Konsole oeffnen und `PDF-Import Diagnose` pruefen.
4. Pruefen, dass `ocrScales` `6` und `7.5` enthaelt.
5. Pruefen, dass `ocrRotations` `0`, `90`, `180`, `270` enthaelt.
6. Pruefen, dass `selectedCandidate` und `ocrCandidates` mit Scores enthalten sind.
7. Jede importierte Position pruefen: `rawFromBin` und `finalFromBin` muessen gleich sein.
8. `Nach-Lagerplatz`, HU, Produktnummer und Menge duerfen nicht als `Von-Lagerplatz` erscheinen.
9. PDF mit absichtlich schlechter/leer erkannter OCR testen; Erwartung: Import bricht ab, kein halbfertiger Auftrag entsteht.
10. Ein bisher funktionierendes PDF importieren und Positionsanzahl, Kunde, Auftragsnummer, HU, Von-Lagerplatz, Menge und Nach-Lagerplatz stichprobenartig pruefen.

Erwartung: Der Import uebernimmt den Von-Lagerplatz ausschliesslich aus dem gewaehlten OCR-Tabellenkandidaten. Es gibt keine Stellplatzvalidierung, keine Stellplatzkorrektur und keinen Bestands-Stellplatzersatz im PDF-Importpfad.

## Artikelstamm

1. Neuen Artikel mit Umlauten in Bezeichnung und Bemerkung anlegen.
2. Ungueltigen KRT-Artikel mit Menge pro Gebinde `0` testen.
3. Artikel suchen und bearbeiten.
4. Artikel deaktivieren.
5. Loeschpfad nur mit korrekt gesetztem `ARTICLE_DELETE_PASSWORD` pruefen.

Erwartung: Ungueltige Eingaben zeigen fachliche Fehlermeldungen, keine Serverfehler.

## Artikelstamm Buchungsexport

1. `/artikel.html` mit Buero- oder Verwaltungsrolle oeffnen.
2. Zeitraum `Von` und `Bis` waehlen, in dem Buchungen vorhanden sind.
3. `Buchungen exportieren` ausfuehren.
4. Pruefen, dass eine echte `.xlsx` mit Namen `buchungen-YYYY-MM-DD-bis-YYYY-MM-DD.xlsx` heruntergeladen wird.
5. Excel-Datei oeffnen und die Spalten exakt pruefen: `Buchungsrichtung`, `Datum/Uhrzeit`, `Lager`, `Stellplatz`, `HU/LE-Nummer`, `Menge`, `Referenz`.
6. Wareneingaenge muessen als `EIN`, Warenausgaenge als `AUS` erscheinen.
7. Auftrag mit bewusstem Bestandsbuchungsfehler exportieren und danach denselben Zeitraum exportieren.
8. Pruefen, dass die Fehlerzeile mit Richtung `AUS` enthalten ist und in `Referenz` die Auftragsreferenz steht, z. B. `Kommissionierung <Auftragsnummer>`.
9. Pruefen, dass keine Fehlermeldung wie `Buchungsfehler` oder `Fehler:` in `Referenz` steht.
10. Leeren Zeitraum testen; Datei darf leer ausser Kopfzeile sein und eine ruhige Statusmeldung zeigen.
11. Ungueltigen Zeitraum testen (`Von` nach `Bis`); Erwartung: fachliche Fehlermeldung, kein Download.
12. Mit falscher Rolle testen; Erwartung: 403 bzw. sichtbare Fehlermeldung.

Erwartung: Der Export enthaelt erfolgreiche Buchungen und Buchungsfehler, veraendert keine Buchungen und erzeugt keine Serverdatei.

## Lager / Buchung

1. Wareneingang SSI mit bekanntem abweichendem Platz eingeben, z. B. `002-H1-SQA`.
2. Bestand pruefen: Platz wird auf bekannte Regel normalisiert.
3. Warenausgang mit demselben Eingabewert buchen.
4. Bestand muss reduziert werden.
5. Fehlende Rolle oder fehlende Pflichtfelder pruefen.

Erwartung: Eingang und Ausgang verwenden dieselbe SSI-Stellplatznormalisierung.

## Kommissionierung

1. PDF importieren oder Testauftrag manuell anlegen.
2. Auftrag mit Nach-Lagerplatz `9021-0OUT` pruefen.
3. Kunde muss `9021-0OUT` sein.
4. Auftragsnummer muss `SSI` sein.
5. Nicht alle Positionen abhaken und PDF-Export versuchen.
6. Alle Positionen abhaken und Export erneut pruefen.

Erwartung: Unvollstaendiger Export ist blockiert. CR-002 bleibt bewusst: Bestandsbuchungsfehler duerfen den Export aktuell noch nicht blockieren.

## PDF-Import Bestellhinweis

1. PDF oder Textfixture mit `Bestellschein Nr.: 60126` und `Bestellhinweis: Service Ecke` importieren.
2. Pruefen, dass die Auftragsnummer `60126-Service Ecke` wird.
3. Fixture mit `Bestellhinweis:` in einer Zeile und `Service Ecke` in der direkt folgenden Zeile pruefen.
4. Fixture ohne `Bestellhinweis` pruefen; Auftragsnummer bleibt `60126`.
5. Fixture mit bereits vorhandener Nummer `60126-Service Ecke` und Hinweis `Service Ecke` pruefen; kein Doppelanhang.
6. Fixture mit `Bestellhinweis:` gefolgt von `Artikelnummer` pruefen; kein Anhang.
7. Pruefen, dass Positionen weiterhin gelesen werden.

Erwartung: Nur labelbasierte Bestellhinweise werden uebernommen; Tabellenkopf, Lagerplatz, Artikelnummern, Mengen, Datum/Uhrzeit und Barcodes werden nicht als Hinweis genutzt.

## PDF-Import Lageraufgabe-Scan

1. Referenz-PDF mit sichtbarer Lageraufgabe-Tabelle importieren.
2. Pruefen, dass keine Meldung `Keine lesbaren Inhalte gefunden` erscheint.
3. Pruefen, dass die Positionen mit HU/LE, Von-Lagerplatz, Produkt, Menge/Basis, Produktbeschreibung und Nach-Lagerplatz entstehen.
4. Pruefen, dass Lagerhinweis SSI/SI aus den erkannten Positionen bzw. Artikel-/Bestandsdaten ableitbar ist.
5. Fehlerfall pruefen: PDF/Text ohne erkennbare Positionen importieren.
6. Erwartung im Fehlerfall: keine Auftragsnummer, kein Kunde und keine Positionen werden in den aktuellen Auftrag uebernommen; Browser-Konsole enthaelt eine `PDF-Import Diagnose`.

Erwartung: Scan-/OCR-PDFs mit Lageraufgabe-Tabelle erzeugen Positionen. Ohne Positionen bricht der Import sauber ab und erzeugt keinen halbfertigen Auftrag.

## PDF-Import Roh-Stellplatz

1. Referenz-PDF oder Textfixture mit Lageraufgabe-Tabelle importieren.
2. Fuer Produkt `1060610` und HU `340063810002072174` pruefen: `Von-Lagerplatz` ist `002-H3-SO4D1`.
3. Fuer Produkt `1060610` und HU `340063810002072181` pruefen: `Von-Lagerplatz` ist `002-H3-SO4D1`.
4. Pruefen, dass kein Wert `002-H3-SOO4D1` entsteht.
5. Pruefen, dass `Nach-Lagerplatz` `9021-0OUT` nicht in das Feld `Von-Lagerplatz` uebernommen wird.
6. Browser-Konsole oeffnen und nach `PDF-Import Positionsdiagnose` schauen.
7. Erwartung in der Diagnose: `rawFromBin` und `finalFromBin` sind bei den Referenzpositionen beide `002-H3-SO4D1`, `changed` ist `false`.

Erwartung: Erst wenn Rohwert und Diagnose stimmen, darf spaeter eine separate Stellplatzvalidierung oder Korrektur bewertet werden.

## Einlagerung

1. Auftrag fuer Kunde SSI pruefen.
2. HU muss Prefix `34006381000` plus 7 manuelle Ziffern haben.
3. Auftrag fuer anderen Kunden pruefen.
4. Bei anderem Kunden darf kein HU-Prefix erzwungen werden.
5. In der manuellen Einlagerung Material eintragen und `Anzahl Positionen = 1` waehlen.
6. Pruefen, dass eine Position angelegt wird und kein Soll-Feld sichtbar ist.
7. Dasselbe mit `Anzahl Positionen = 5` pruefen.
8. Pruefen, dass fuenf getrennte Positionen mit derselben Artikelnummer entstehen, aber HU, Stellplatz und Ist-Menge je Position getrennt bleiben.
9. `Anzahl Positionen = 0`, Dezimalwert und `101` testen.
10. Beim manuellen Anlegen `Stueckzahl = 3` eintragen und pruefen, dass jede neue Position `Stueckzahl`/Ist-Menge `3` erhaelt.
11. `Stueckzahl` leer, `0`, negativ und Dezimalwert testen; Erwartung: fachliche Fehlermeldung, keine Position wird angelegt.
12. Material mit gepflegtem Artikelstamm-Lagerplatz anlegen; Erwartung: Material und Artikelbezeichnung werden uebernommen, Stellplatz startet leer.
13. Mehrere Positionen derselben Artikelnummer anlegen und danach unterschiedliche Stellplaetze je Position eintragen.

Erwartung: HU-Prefix haengt am Kunden SSI, nicht am Lager. Soll-Stueckzahl ist fuer manuelle Einlagerung nicht erforderlich. Ungueltige Positionsanzahl zeigt eine fachliche Fehlermeldung.

## Tablet

1. `/tablet.html` auf Tablet oeffnen.
2. Auftrag laden/aktualisieren.
3. Position abhaken.
4. Erledigte Position muss automatisch kompakt bleiben.
5. Schalter `Erledigte einklappen` darf nicht vorhanden sein.
6. Buttons `Aktualisieren`, `Jetzt speichern`, `PDF exportieren` sollen in einer Zeile liegen.
7. In Tablet-Einlagerung `Material` und `Anzahl Positionen` pruefen.
8. In Tablet-Einlagerung `Stueckzahl` beim Anlegen pruefen; neue Stellplatzfelder muessen leer starten.
9. Manuelle Positionen ohne Soll-Feld pruefen.
10. Zwei offene Kommissionierauftraege mit gleichem Kunden/Nach-Lagerplatz anlegen.
11. Einen dieser Auftraege am Tablet uebernehmen.
12. Pruefen, dass beide Auftraege in der Auswahl als `Von mir uebernommen` erscheinen.
13. Verbindung trennen oder Server in der QA-Kopie stoppen.
14. Offline zwischen beiden Auftraegen wechseln.
15. In Auftrag A eine Position abhaken, zu Auftrag B wechseln und zurueck zu A wechseln.
16. Pruefen, dass Auftrag A erledigt bleibt und Auftrag B unveraendert offen bleibt.

## Tablet PDF-Export

1. `/tablet.html` auf Tablet oeffnen.
2. Mit Mitarbeitername einen Kommissionierauftrag uebernehmen.
3. Eine Position abhaken und die Ist-Menge eintragen.
4. Ohne Tab-Reload direkt `PDF exportieren` antippen.
5. Pruefen, dass zuerst gespeichert wird und danach der PDF-Export startet.
6. Waehrend des Exports erneut auf den Button tippen.
7. Pruefen, dass kein zweiter Export parallel startet.
8. Fehlerfall pruefen: Position offen lassen und Export starten.
9. Fehlerfall pruefen: Server stoppen oder Verbindung trennen und Export starten.
10. Nach jedem Fehler pruefen, dass der Button wieder bedienbar ist und die Fehlermeldung sichtbar bleibt.
11. Fehlerfall pruefen: In einer isolierten Kopie den PDF-Zielpfad blockieren oder unbeschreibbar machen und Export starten.
12. Pruefen, dass der Auftrag danach nicht als exportiert verschwindet und weiter nachbearbeitet/exportiert werden kann.
13. Erfolgsfall pruefen: PDF wird erzeugt, danach erst verschwindet der Auftrag aus der aktiven Bearbeitung.

Erwartung: Der Export funktioniert ohne vorherigen Tab-Reload. Offline, fehlgeschlagene Speicherung oder fehlgeschlagene PDF-Erstellung entfernt den Auftrag nicht aus der Bearbeitung.

## Tablet Einlagerung verlassen/loeschen

1. In Tablet-Einlagerung manuelle Einlagerung starten.
2. Online pruefen: `Einlagerung verlassen` ist sichtbar, `Einlagerung loeschen` ist aktiv, `Einlagerung abbrechen` ist fuer serverseitige Einlagerung deaktiviert.
3. `Einlagerung loeschen` bestaetigen und pruefen, dass der Auftrag nicht mehr in der Auswahl steht.
4. Tablet-Seite neu laden, Server stoppen und manuelle Einlagerung offline starten.
5. `Einlagerung verlassen`; Auftrag muss lokal in der Offline-Auswahl sichtbar bleiben.
6. Auftrag erneut laden und `Einlagerung abbrechen`; danach darf nur noch `Einlagerung waehlen (Offline-Cache)` sichtbar sein.

Erwartung: Bedienung ist ohne gequetschte Buttons moeglich. Gemeinsam uebernommene Auftraege bleiben offline sichtbar, wechselbar und getrennt bearbeitbar.

## Datenbank-Wiederherstellung

Wenn der Server mit SQLite-Diagnose startet:

1. Server stoppen.
2. Aktuellen `data/`-Ordner sichern, inklusive `*.sqlite`, `*.sqlite-shm`, `*.sqlite-wal`.
3. Letzte intakte Sicherung aus `data/sqlite-backup-*` oder `Backups/` auswaehlen.
4. Datenbankdateien zurueckkopieren.
5. Server neu starten.
6. `/api/health` und Kernseiten pruefen.

Keine Datenbankdateien loeschen oder ersetzen, ohne vorher den defekten Stand zu sichern.

## Rollenmodell

Das Rollenmodell schuetzt LAN-Workflows gegen Fehlbedienung. Es ist keine echte Authentifizierung. Bei externer Freigabe oder unsicheren Netzen muss ein separates Authentifizierungs-/Netzschutzkonzept davor.

## QA-Exportartefakte

1. Isolierte QA-Kopie auf Port 4175 starten.
2. `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` ausfuehren.
3. Pruefen, dass CR-002, Tablet-Direktexport, Einlagerabschluss und manuelle Einlagerung fachlich gruen bleiben.
4. Pruefen, dass die Matrix den Check `QA export tests leave no durable PDF/HTML artifacts` meldet.
5. Im konfigurierten Exportziel und in `Exporte/` nach `QA-*.pdf` und `QA-*.html` des aktuellen Laufes suchen.
6. Einen normalen Benutzerexport ohne QA-Header in einer isolierten Kopie testen und bestaetigen, dass weiterhin eine PDF-Datei erzeugt wird.

Erwartung: Automatisierte Tests hinterlassen keine dauerhaften QA-PDFs oder QA-HTML-Dateien. Produktiver Export bleibt aktiv.

## Originaldatei-Archivierung

1. Importordner ueber `HLOGISTIK_IMPORT_DIR` oder `import-path.txt` festlegen; ohne Konfiguration ist der Exportordner der Importordner.
2. Test-PDF in den Importordner legen und in der App importieren.
3. Auftrag freigeben, alle Positionen abschliessen und PDF exportieren.
4. Pruefen, dass die Export-PDF erstellt wurde.
5. Pruefen, dass die Originaldatei nach `<Importordner>/Archiv` oder `HLOGISTIK_ARCHIVE_DIR` verschoben wurde.
6. Gleichen Dateinamen im Archiv vorab anlegen und erneut testen; Erwartung: vorhandene Datei bleibt unveraendert, neue Datei bekommt eindeutigen Namen.
7. Fehlerfall pruefen: Position offen lassen und Export starten; Erwartung: Originaldatei bleibt im Importordner.
8. Fehlerfall pruefen: Originaldatei vor dem Export umbenennen/entfernen; Erwartung: PDF-Export bleibt erfolgreich, Archivfehler wird gemeldet.
9. `/api/health` pruefen; `importDir` und `archiveDir` muessen die aktiven Ordner anzeigen.

Erwartung: Archivierung passiert nur nach erfolgreicher PDF-Erstellung. Archivfehler beschaedigen den Auftrag nicht und rollen keine PDF zurueck.
## PDF-Import: OCR-only Von-Lagerplatz

1. In einer isolierten Kopie `20260625125646.pdf` importieren.
2. Pruefen, dass der Import erfolgreich Positionen erkennt.
3. Pruefen, dass der Von-Lagerplatz exakt aus der OCR-/Tabellenspalte `Von-Lagerplatz` kommt.
4. Pruefen, dass Werte wie `002-H3-SO4D1`, `002-H1-SAG8D3`, `002-H3-SO6C1` und `002-H1-SAL7C3` nicht veraendert werden.
5. Pruefen, dass OCR-Rohwerte wie `002-H3-5010A2` und `002-H3-5Z2D1` nicht automatisch in andere Stellplaetze umgeschrieben werden.
6. Pruefen, dass Nach-Lagerplaetze wie `9021-00UT`, `9021-0OUT` oder `9020-MOEHREN` niemals als Von-Lagerplatz uebernommen werden.
7. Pruefen, dass HU, Produktnummer und Menge nicht als Von-Lagerplatz uebernommen werden.
8. Pruefen, dass die Browser-Konsole `PDF-Import Positionsdiagnose` mit Rohwert und finalem Von-Lagerplatz ausgibt.

Erwartung: Rohwert Von-Lagerplatz und final importierter Von-Lagerplatz sind gleich, abgesehen von trimmen, Whitespace und Bindestrich-Bereinigung. Artikel, Mengen, HU und CR-002-Verhalten bleiben unveraendert.
