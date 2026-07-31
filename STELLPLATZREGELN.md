# Aktuelle Stellplatzregeln

Stand: 2026-07-27

Diese Datei beschreibt die aktuell im Code wirksamen Regeln fuer Lagerplatz, Stellplatz und Nach-Lagerplatz.

## Begriffe

- `fromBin`: Von-Lagerplatz bei Kommissionierung, Stellplatz bei Einlagerung.
- `toBin`: Nach-Lagerplatz aus Kommissionierauftraegen.
- `lagerplatz`: Stellplatz in Bestand, Buchung und Artikelstamm.
- `leNummer`: LE/HU-Nummer in Bestand und Buchung.

## Import Kommissionierung

- Bei Lageraufgaben muss fuer normale Positionen ein Von-Lagerplatz vorhanden sein, wenn der Text wie eine Lageraufgabe aussieht.
- OCR-Lagerplaetze werden aus Mustern wie `002-H4-SK5C2`, `022-H5-R28` oder aehnlichen Varianten gelesen.
- Fuehrende OCR-Fehler `O`, `Q` oder `D` am Lagerplatz werden als `0` normalisiert.
- Leerzeichen werden entfernt, Bindestriche bleiben die Strukturtrenner.
- Ein plausibler Kommissionier-Lagerplatz ist aktuell:
  - `002-Hx-Rn` oder `022-Hx-Rn`
  - `002-H1-A[A-L]1`
  - `002-H1-SA[A-T][1-12][A-D][1-3]`
  - `002-H3-S[O-Z][1-12][A-D][1-3]`
  - `002-H4-S[A-N][1-12][A-D][1-4]`
- Nicht plausible erkannte Lagerplaetze erzeugen eine Warnung `Lagerplatz unklar`.
- Bei auffaelligen Lagerplaetzen kann ein genauer OCR-Scan ausgefuehrt werden.
- Wird dabei genau ein anderer plausibler Kandidat gefunden, wird der Lagerplatz automatisch korrigiert.
- Wird kein eindeutiger Kandidat gefunden, bleibt der Wert stehen und muss manuell geprueft werden.
- Eine Lagerplatz-Warnung wird automatisch geloescht, wenn der Benutzer einen anderen plausiblen Lagerplatz eintraegt.

## Nach-Lagerplatz / Kunde

- Beim Import wird der erste gefundene Nach-Lagerplatz als Kunde des Auftrags uebernommen.
- Weitere Nach-Lagerplaetze, die vom ersten Nach-Lagerplatz abweichen, werden als automatische Zusatzbemerkung an der jeweiligen Position gespeichert.
- Varianten wie `9021-00UT`, `8021-00UT` und `99021-00UT` werden zu `9021-0OUT` normalisiert.
- Nach-Lagerplatz-Fusszeilenreste werden teilweise abgeschnitten, z. B. ein einzelnes angehaengtes Seiten-/Footerfragment nach Satzzeichen.

## Automatische Stellplatzuebernahme bei Kommissionierung

- Nach dem Import wird fuer erkannte Artikel und HU/LE im aktuellen Buchungslager der Bestand abgefragt.
- Wenn Materialnummer und HU/LE eindeutig im Bestand gefunden werden, wird der Von-Lagerplatz aus dem Bestand uebernommen.
- Bei dieser automatischen Uebernahme werden bestehende Lagerplatz-Warnungen der Position geloescht.
- Wenn Bestand und Soll-/Ist-Menge voneinander abweichen, kann eine automatische Mengenbemerkung an der Position entstehen.

## Einlagerung in der Hauptansicht

- Einlagerungspositionen brauchen zum Erledigen einen Stellplatz (`fromBin`).
- Der Stellplatz wird in der Eingabe in Grossbuchstaben umgewandelt.
- Bei manuellen Einlagerungszeilen gilt: leere Zeilen werden ignoriert, sobald kein Artikel, keine Menge, kein Stellplatz, keine HU und keine Bemerkung enthalten sind.
- HU-Pflicht haengt am Kunden:
  - Kunde `SSI`: HU ist Pflicht und muss mit `34006381000` beginnen plus 7 weitere Ziffern enthalten.
  - Andere Kunden: keine HU-Pflicht und kein automatischer HU-Praefix.
- Das Lager `SSI` oder `SI` allein entscheidet nicht ueber HU-Pflicht.

## SSI-Stellplatznormalisierung bei Einlagerung/Wareneingang

Fuer SSI wird der Stellplatz serverseitig normalisiert. Bekannte Regeln:

- Leerzeichen werden entfernt, Unterstriche werden zu Bindestrichen, alles wird grossgeschrieben.
- `H1R1` bis `H1R16` wird zu `022-H1-R1` bis `022-H1-R16`; `H1AG1` bis `H1AM1` wird zu `022-H1-AG1` bis `022-H1-AM1`.
- `H2R1` bis `H2R56` wird zu `022-H2-R1` bis `022-H2-R56`.
- `H3P1` bis `H3Y3` wird zu `022-H3-P1` bis `022-H3-Y3`, ausgenommen `H3R3` und `H3S3`; diese Stellplätze existieren nicht.
- `H4R1` bis `H4R21` wird zu `022-H4-R1` bis `022-H4-R21`.
- `H5R1` bis `H5R50` wird zu `022-H5-R1` bis `022-H5-R50`.
- `H72R1` bis `H75R3` wird zu `022-H7-2R1` bis `022-H7-5R3`.
- `S####` oder genau vier Ziffern werden zu `002-H2-S####`, zum Beispiel `S0074` und `0074` zu `002-H2-S0074`.
- `002-Hx-S...` bleibt gueltig, wenn es dem Shelf-Muster entspricht.
- Kurze Nummern `1` bis `69` optional mit Suffix werden zu `002-H7-S...`.
- Werte von `AA...` bis `AT...` werden zu `002-H1-SA...`.
- Werte mit erstem Buchstaben `A` bis `N`, sofern nicht `AA...` bis `AT...`, werden zu `002-H4-S...`.
- Werte mit erstem Buchstaben `O` bis `Z` werden zu `002-H3-S...`.
- Nicht bekannte SSI-Stellplaetze werden beim Export/Buchen abgelehnt.

## Buchungs-API und Bestand

- Wareneingang (`/api/storage/receipts`):
  - Artikelnummer ist Pflicht.
  - Lagerplatz/Stellplatz ist Pflicht.
  - Stueckzahl muss groesser 0 sein.
  - Fuer SSI wird der Stellplatz mit den SSI-Regeln normalisiert.
  - Fuer SI wird der Stellplatz nur grossgeschrieben, keine SSI-Normalisierung.
- Warenausgang (`/api/storage/issues`):
  - Artikelnummer oder Barcode ist Pflicht.
  - Lagerplatz ist Pflicht.
  - Fuer SSI wird der Stellplatz mit den SSI-Regeln normalisiert.
  - Fuer SI wird der Stellplatz nur grossgeschrieben, keine SSI-Normalisierung.
  - Stueckzahl muss groesser 0 sein.
- Bestand ist eindeutig pro Kombination aus Lager, Materialnummer, Lagerplatz und LE/HU.
- Bei Warenausgang ohne konkrete LE/HU wird aus vorhandenen Bestaenden am Lagerplatz entnommen.

## Hallenplan / Blockplatzübersicht

- Die Hallenplanansicht gilt nur für Lager `SSI`.
- Als Blockplätze gelten ausschließlich:
  - Halle `H1`: `022-H1-R1` bis `022-H1-R16`, gegliedert in `R1 bis R5` und `R6 bis R16`, sowie `022-H1-AG1` bis `022-H1-AM1`.
  - Halle `H2`: `022-H2-R1` bis `022-H2-R56`.
  - Halle `H3`: `022-H3-P1` bis `022-H3-Y3`, ausgenommen `022-H3-R3` und `022-H3-S3`.
  - Halle `H4`: `022-H4-R1` bis `022-H4-R21`.
  - Halle `H5`: `022-H5-R1` bis `022-H5-R50`.
  - Halle `H7`: `022-H7-2R1` bis `022-H7-5R3`.
- Ein Blockplatz ist belegt, sobald mindestens eine positive Bestandszeile aus `SSI` oder `SI` auf genau diesem normalisierten Stellplatz vorliegt. Ohne positive Bestandszeile ist er frei.
- Bei belegten Blockplätzen zeigt die Übersicht die Materialnummer und die Palettenanzahl an.
- Die Eingaben `H1-AG1` bis `H1-AM1` werden bei SSI-Buchungen auf die entsprechenden Stellplätze `002-H1-SAG1` bis `002-H1-SAM1` normalisiert.
- Die Übersicht ist rein lesend und berechnet ihren Stand bei jedem Abruf neu. Sie ändert weder Bestandsdaten noch Stellplatznormalisierungen.
- In der Tablet-Ansicht steht die Übersicht als eigener Reiter bereit. Der letzte erfolgreich geladene Hallenplan wird getrennt im lokalen Tablet-Cache gespeichert und offline angezeigt.
- Bei jeder erfolgreichen Online-Prüfung, nach dem Wiederverbinden und beim Öffnen des Reiters wird der Hallenplan erneut vom Server geladen und der Offline-Cache ersetzt.

## H1-Regalplatzuebersicht

- Die Regalplatzstruktur gilt fuer Lager `SSI` und Halle `H1`; die Belegungspruefung wertet die positiven Bestaende aus `SSI` und `SI` gemeinsam aus.
- Erfasst werden die Reihen `AA` bis `AT`: `AA1` bis `AA10`, `AB1` bis `AS9` und `AT1` bis `AT10`.
- Jede Bucht besitzt die Ebenen `A` bis `D` und je Ebene die Positionen `1` bis `3`, zum Beispiel `AA1A1` bis `AA1A3`.
- Die kanonische Stellplatz-ID lautet `002-H1-S<Reihe><Bucht><Ebene><Position>`, zum Beispiel `002-H1-SAA1A1`.
- Eine Regalposition ist belegt, sobald mindestens eine positive Bestandszeile aus `SSI` oder `SI` auf genau dieser kanonischen ID liegt. Materialnummer, Stueck und Paletten werden ueber alle positiven Bestandszeilen summiert.
- Die Uebersicht ist rein lesend, aendert keine Bestandsdaten und nutzt dieselbe SSI-Stellplatznormalisierung wie die Buchungs-API.
- Tablet und Desktop zeigen den schematischen Plan je Ebene getrennt. Das Tablet speichert den letzten erfolgreichen Stand fuer jede Ebene getrennt und aktualisiert alle Ebenen nach Wiederverbindung.

## Artikelstamm und Lageruebersicht

- Der Artikelstamm besitzt ein freies Feld `lagerplatz`.
- In Artikelimport/-pflege wird dieser Wert als Text gespeichert, ohne die SSI-Stellplatznormalisierung aus der Wareneingangsbuchung zu erzwingen.
- Lageruebersicht und Bewegungen sortieren/filtern nach Lagerplatz, Materialnummer und LE/HU.

## Tablet-Ansicht

- In der Tablet-Ansicht ist der Lagerplatz bei Kommissionierung grundsaetzlich readonly.
- Er wird editierbar, wenn eine Lagerplatz-Warnung vorhanden ist.
- Bei Einlagerung ist der Stellplatz editierbar.
- Tablet nutzt die gleiche Plausibilitaetslogik fuer Lagerplatz-Warnungen wie die Hauptansicht.
