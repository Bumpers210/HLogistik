# Kommissionier-App

Lokale Server-App fuer digitale Kommissionierung auf mehreren Geraeten.

## Start

Aktuell in dieser Sitzung:

`http://127.0.0.1:4174/`

Spaeter dauerhaft:

1. Node.js LTS installieren.
2. `start-server.ps1` starten.
3. Adresse aus dem Fenster auf Tablets oeffnen.

## Was schon geht

- PDF importieren und Text auslesen
- Lager-Tabelle aus dem PDF-Text erkennen
- Spalten fuer Lagerauftrag, Von-HU, Von-Lagerplatz, Produkt, Menge, Beschreibung und Nach-Lagerplatz bearbeiten
- Positionen abhaken
- Soll-/Ist-Mengen korrigieren
- Europaletten, Stellplaetze und Notiz erfassen
- Auftraege zentral auf dem Server speichern
- CSV exportieren
- PDF automatisch in `Exporte` speichern

## Wichtig

Der PDF-Import funktioniert direkt bei Text-PDFs. Eingescannte PDFs brauchen vorher OCR, sonst ist in der Datei kein lesbarer Text enthalten. Der Parser ist als Startpunkt gebaut und sollte spaeter an echte Beispielauftraege angepasst werden.

## Ordner

- `data/orders.json`: gespeicherte Auftraege
- `Exporte`: automatisch erzeugte PDF-Dateien
- `tmp`: temporaere HTML-Dateien fuer den PDF-Export
