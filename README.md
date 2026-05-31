# Kommissionier-App

Lokale Server-App für digitale Kommissionierung auf mehreren Geräten.

## Start

Aktuell in dieser Sitzung:

`http://127.0.0.1:4174/`

Später dauerhaft:

1. Node.js LTS installieren.
2. Optional: `local-hostname.txt` anpassen (z. B. `hlogistik.lokal`) und einmal `setup-local-hostname.ps1` als Administrator ausführen.
3. `start-server.ps1` starten.
4. Adresse aus dem Fenster auf Tablets öffnen (z. B. `http://hlogistik.lokal:4174/`).

## Was schon geht

- PDF importieren und Text auslesen
- Eingescannte PDFs per OCR auslesen
- Lager-Tabelle aus dem PDF-Text erkennen
- Spalten für Von-HU, Lagerplatz, Produkt, Menge und Beschreibung bearbeiten
- Positionen abhaken
- Soll-/Ist-Mengen korrigieren
- Europaletten, Stellplätze und Notiz erfassen
- Aufträge zentral auf dem Server speichern
- CSV exportieren
- PDF automatisch in `Exporte` speichern
- Export enthält auch intern gelesene Werte wie Lagerauftrag und Nach-Lagerplatz
- Artikelstamm mit SQLite pflegen unter `http://127.0.0.1:4174/artikel.html`
- Artikel per CSV importieren/exportieren
- Artikel nach Materialnummer, Materialbezeichnung oder Barcode suchen
- Manuelle Buchung (Büro) unter `http://127.0.0.1:4174/lager.html`
- Stellplätze nach Artikelnummer, Lagerplatz oder LE-Nummer abrufen
- Tablet-Light-Modus als einfache Pickliste unter `http://127.0.0.1:4174/tablet.html`
- REST-Schnittstellen für spätere Apps:
  - `GET /api/articles?q=...`
  - `GET /api/articles/lookup/:materialnummerOderBarcode`
  - `POST /api/articles/calculate-package`
  - `POST /api/articles/import`
  - `POST /api/storage/receipts`
  - `GET /api/storage/locations?q=...`

## Nutzung auf älteren Tablets

Die App kann auf älteren Tablets als einfache digitale Pickliste verwendet werden. Da die Aufträge in der Regel maximal ca. 40 Positionen enthalten, ist die reine Bearbeitung im Browser ressourcenschonend möglich.

Empfohlene Nutzung:

- PDF-Import und OCR auf einem PC oder Server ausführen
- Tablets nur zur Bearbeitung offener Aufträge verwenden
- Tablet-Light-Modus über `http://server-ip:4174/tablet.html` öffnen
- Erledigte Positionen standardmäßig einklappen
- Auf automatische Hintergrundaktualisierungen sparsam setzen
- Keine PDF- oder OCR-Verarbeitung direkt auf alten Tablets ausführen

Der Tablet-Light-Modus lädt nur `tablet.html`, `tablet.css` und `tablet.js`. PDF.js, Tesseract/OCR, PDF-Vorschau und Exportfunktionen bleiben auf der normalen PC-Oberfläche.

## Wichtig

Text-PDFs werden direkt ausgelesen. Wenn eine PDF nur aus eingescannten Bildern besteht, rendert die App die Seiten als Bild und liest sie per OCR aus. Für OCR wird beim ersten Lauf Tesseract.js mit deutscher und englischer Spracherkennung geladen; das kann je nach WLAN und PDF-Größe etwas dauern.

## Ordner

- `data/orders.json`: gespeicherte Aufträge
- `data/logistik.sqlite`: SQLite-Datenbank für den Artikelstamm
- `Exporte`: automatisch erzeugte PDF-Dateien
- `tmp`: temporäre HTML-Dateien für den PDF-Export
