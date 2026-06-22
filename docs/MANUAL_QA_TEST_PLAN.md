# HLogistik Manual QA Test Plan

Stand: 2026-06-22 13:35:44 +02:00

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

## Artikelstamm

1. Neuen Artikel mit Umlauten in Bezeichnung und Bemerkung anlegen.
2. Ungueltigen KRT-Artikel mit Menge pro Gebinde `0` testen.
3. Artikel suchen und bearbeiten.
4. Artikel deaktivieren.
5. Loeschpfad nur mit korrekt gesetztem `ARTICLE_DELETE_PASSWORD` pruefen.

Erwartung: Ungueltige Eingaben zeigen fachliche Fehlermeldungen, keine Serverfehler.

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

Erwartung: HU-Prefix haengt am Kunden SSI, nicht am Lager. Soll-Stueckzahl ist fuer manuelle Einlagerung nicht erforderlich. Ungueltige Positionsanzahl zeigt eine fachliche Fehlermeldung.

## Tablet

1. `/tablet.html` auf Tablet oeffnen.
2. Auftrag laden/aktualisieren.
3. Position abhaken.
4. Erledigte Position muss automatisch kompakt bleiben.
5. Schalter `Erledigte einklappen` darf nicht vorhanden sein.
6. Buttons `Aktualisieren`, `Jetzt speichern`, `PDF exportieren` sollen in einer Zeile liegen.
7. In Tablet-Einlagerung `Material` und `Anzahl Positionen` pruefen.
8. Manuelle Positionen ohne Soll-Feld pruefen.
9. Zwei offene Kommissionierauftraege mit gleichem Kunden/Nach-Lagerplatz anlegen.
10. Einen dieser Auftraege am Tablet uebernehmen.
11. Pruefen, dass beide Auftraege in der Auswahl als `Von mir uebernommen` erscheinen.
12. Verbindung trennen oder Server in der QA-Kopie stoppen.
13. Offline zwischen beiden Auftraegen wechseln.
14. In Auftrag A eine Position abhaken, zu Auftrag B wechseln und zurueck zu A wechseln.
15. Pruefen, dass Auftrag A erledigt bleibt und Auftrag B unveraendert offen bleibt.

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
