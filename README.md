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
- Eingescannte PDFs per OCR auslesen
- Lager-Tabelle aus dem PDF-Text erkennen
- Spalten fuer Von-HU, Lagerplatz, Produkt, Menge und Beschreibung bearbeiten
- Positionen abhaken
- Soll-/Ist-Mengen korrigieren
- Europaletten, Stellplaetze und Notiz erfassen
- Auftraege zentral auf dem Server speichern
- CSV exportieren
- PDF automatisch in `Exporte` speichern

## Wichtig

Text-PDFs werden direkt ausgelesen. Wenn eine PDF nur aus eingescannten Bildern besteht, rendert die App die Seiten als Bild und liest sie per OCR aus. Fuer OCR wird beim ersten Lauf Tesseract.js mit deutscher und englischer Spracherkennung geladen; das kann je nach WLAN und PDF-Groesse etwas dauern.

## Ordner

- `data/orders.json`: gespeicherte Auftraege
- `Exporte`: automatisch erzeugte PDF-Dateien
- `tmp`: temporaere HTML-Dateien fuer den PDF-Export
