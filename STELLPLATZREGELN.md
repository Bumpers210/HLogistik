# Aktuelle Stellplatzregeln

Stand: 2026-06-22

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
- `022-H1-R5` bis `022-H7-Rn` bleibt Blockplatz und wird normalisiert.
- `002-H1-R5` bis `002-H7-Rn` wird als Blockplatz auf `022-Hx-Rn` normalisiert.
- `H1-R5` oder `H1R5` wird zu `022-H1-R5`.
- `002-H?-SHxRn` wird zu `022-Hx-Rn`, wobei das `x` nach `SH` die Halle bestimmt.
- `H3[O-Y][1-3]` wird direkt zu `002-H3-[O-Y][1-3]`, z. B. `H3T1` oder `H3-T1` zu `002-H3-T1`.
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

## Artikelstamm und Lageruebersicht

- Der Artikelstamm besitzt ein freies Feld `lagerplatz`.
- In Artikelimport/-pflege wird dieser Wert als Text gespeichert, ohne die SSI-Stellplatznormalisierung aus der Wareneingangsbuchung zu erzwingen.
- Lageruebersicht und Bewegungen sortieren/filtern nach Lagerplatz, Materialnummer und LE/HU.

## Tablet-Ansicht

- In der Tablet-Ansicht ist der Lagerplatz bei Kommissionierung grundsaetzlich readonly.
- Er wird editierbar, wenn eine Lagerplatz-Warnung vorhanden ist.
- Bei Einlagerung ist der Stellplatz editierbar.
- Tablet nutzt die gleiche Plausibilitaetslogik fuer Lagerplatz-Warnungen wie die Hauptansicht.
