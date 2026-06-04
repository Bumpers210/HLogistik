# HLogistik

![Node](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=node.js&logoColor=white)
![Version](https://img.shields.io/badge/Version-1.1.0-blue)
![Stack](https://img.shields.io/badge/Stack-Vanilla%20JS%20%C2%B7%20SQLite-orange)
![Status](https://img.shields.io/badge/Status-intern-lightgrey)

Lokale Server-Anwendung für die digitale Lagerlogistik: **Kommissionierung**, **Wareneingangs-/Warenausgangsbuchung**, **Artikelstamm** und eine schlanke **Tablet-Oberfläche** – alles über einen einzelnen Node.js-Server im lokalen Netzwerk, ohne externe Cloud-Abhängigkeit.

Die App ist als Progressive Web App ausgelegt, läuft im Browser auf PCs und Tablets und speichert alle Daten zentral in lokalen SQLite-Datenbanken.

---

## Inhalt

- [Funktionsumfang](#funktionsumfang)
- [Technischer Überblick](#technischer-überblick)
- [Voraussetzungen](#voraussetzungen)
- [Installation & Start](#installation--start)
- [Konfiguration](#konfiguration)
- [Oberflächen](#oberflächen)
- [API-Referenz](#api-referenz)
- [Datenhaltung](#datenhaltung)
- [Nutzung auf älteren Tablets](#nutzung-auf-älteren-tablets)
- [PDF- & OCR-Verarbeitung](#pdf--und-ocr-verarbeitung)
- [Projektstruktur](#projektstruktur)
- [Entwicklung](#entwicklung)
- [Hinweis](#hinweis)

---

## Funktionsumfang

### Kommissionierung (`/`)
- Kommissionieraufträge aus PDF importieren und Text automatisch auslesen
- Eingescannte (Bild-)PDFs per OCR (Tesseract.js, DE/EN) erkennen
- Lager-Tabelle aus dem PDF-Text erkennen und Spalten (Von-HU, Lagerplatz, Produkt, Menge, Beschreibung) bearbeiten
- Positionen abhaken, Soll-/Ist-Mengen korrigieren, Europaletten/Stellplätze/Notizen erfassen
- Aufträge zentral auf dem Server speichern und gegen Duplikate prüfen
- Export als CSV sowie automatischer PDF-Export nach `Exporte/`

### Buchung & Bestand (`/lager.html`)
- **Wareneingang** und **Warenausgang** buchen (mehrere Stellplätze/HU-Nummern je Vorgang)
- **Artikelübersicht** mit Gesamtstückzahl, Paletten und aufklappbarer Stellplatz-Detailansicht
- **Buchungsfehler-Log** für nicht gebuchte Positionen aus PDF-Exporten
- Stellplätze nach Artikelnummer, Lagerplatz oder LE-/HU-Nummer durchsuchen
- Buchungshistorie mit Volltextsuche

### Artikelstamm (`/artikel.html`)
- Artikel anlegen, bearbeiten, deaktivieren und passwortgeschützt endgültig löschen
- Gebindearten (C1, C2, A1, KRT, STK) inkl. Mengenlogik pro Gebinde/Palette
- Import/Export per Excel/CSV/HTML (automatische Spaltenerkennung)
- Suche nach Materialnummer, Bezeichnung oder Barcode
- Anlage/Bearbeitung über ein zentrales Eingabe-Popup

### Tablet-Light (`/tablet.html`)
- Reduzierte Pickliste für ressourcenschwache Geräte (lädt nur `tablet.*`, keine PDF-/OCR-Bibliotheken)

### Mehrlager-Betrieb
- Zwei getrennte Lager (**SSI** und **SI**) mit eigenen Artikelstämmen, umschaltbar in der Kopfzeile

---

## Technischer Überblick

| Bereich        | Umsetzung                                                              |
| -------------- | --------------------------------------------------------------------- |
| Server         | Node.js (`node:http`), **keine** Web-Framework-Abhängigkeit           |
| Frontend       | Vanilla JS, PWA (Service Worker + Web-Manifest)                       |
| Datenbank      | SQLite (Bewegungen/Bestände/Aufträge sowie Artikelstamm je Lager)    |
| Import/Export  | `xlsx` (Excel/CSV), `pdf.js` (PDF-Text), Tesseract.js (OCR)          |
| Port           | `4174` (Bindung an `0.0.0.0`, im LAN erreichbar)                     |
| Sicherheit     | Same-Origin-Schutz für schreibende Anfragen, Rollen via Benutzergruppe |

Der Server liefert statische Dateien aus einer Allowlist aus und beantwortet eine schlanke REST-API. Beim Start werden Datenverzeichnisse angelegt, die Datenbanken initialisiert und Alt-Daten (Legacy-JSON) migriert.

---

## Voraussetzungen

- **Node.js ≥ 22** (siehe `engines` in `package.json`)
- Windows mit PowerShell (für die komfortablen Start-Skripte) – der Server selbst läuft plattformunabhängig

---

## Installation & Start

```bash
# Abhängigkeiten installieren (nur Dev-Tools: ESLint, Prettier)
npm install

# Server starten
npm start
```

Anschließend erreichbar unter `http://localhost:4174/`.

### Komfortstart unter Windows

1. Node.js LTS installieren.
2. *(Optional)* `local-hostname.txt` anpassen (z. B. `hlogistik.lokal`) und einmalig `setup-local-hostname.ps1` als Administrator ausführen.
3. `start-server.ps1` starten – das Fenster zeigt die lokalen Adressen (inkl. echter LAN-IP) als anklickbare Links.
4. Adresse aus dem Fenster auf den Tablets öffnen, z. B. `http://192.168.x.x:4174/` oder `http://hlogistik.lokal:4174/`.

---

## Konfiguration

Konfiguration erfolgt über Umgebungsvariablen oder optionale Textdateien im Projektordner.

| Variable / Datei                          | Zweck                                          | Standard            |
| ----------------------------------------- | ---------------------------------------------- | ------------------- |
| `PORT`                                    | HTTP-Port                                      | `4174`              |
| `LOCAL_HOSTNAME` / `local-hostname.txt`   | Lokaler Hostname für die LAN-Adresse           | – (keiner)          |
| `HLOGISTIK_EXPORT_DIR` / `EXPORT_DIR` / `export-path.txt` | Zielordner für PDF-Exporte    | `./Exporte`         |
| `ARTICLE_DELETE_PASSWORD`                 | Passwort für *endgültiges* Löschen von Artikeln | im Code hinterlegt |

> **Sicherheitshinweis:** Für `ARTICLE_DELETE_PASSWORD` ist im Code ein Standardwert hinterlegt. Im produktiven Einsatz sollte dieser über die Umgebungsvariable durch ein eigenes Passwort ersetzt werden.

---

## Oberflächen

| Pfad            | Bereich          | Beschreibung                                            | Zugriff (Benutzergruppe) |
| --------------- | ---------------- | ------------------------------------------------------- | ------------------------ |
| `/`             | Kommissionierung | PDF-/OCR-Import, Pickliste, Export                      | alle angemeldeten        |
| `/lager.html`   | Buchung          | Wareneingang/-ausgang, Artikelübersicht, Buchungsfehler | Büro / Tablet            |
| `/artikel.html` | Artikelstamm     | Artikelpflege, Import/Export                            | Büro / Tablet            |
| `/tablet.html`  | Tablet-Light     | Minimale Pickliste für alte Geräte                      | alle angemeldeten        |

Die Benutzergruppe (z. B. *Lager*, *Büro*, *Tablet*) wird bei der Anmeldung gesetzt und steuert die Sichtbarkeit der Bereiche. Schreibende Anfragen werden zusätzlich serverseitig auf gleichen Ursprung geprüft.

---

## API-Referenz

Alle Endpunkte erwarten/liefern JSON (Ausnahme: CSV-/Datei-Downloads). Das Lager wird über den Header `X-Warehouse` (`SSI` | `SI`) bzw. den Query-Parameter `?warehouse=` ausgewählt, die Rolle über `X-User-Group`.

### Allgemein
| Methode | Pfad           | Beschreibung                                  |
| ------- | -------------- | --------------------------------------------- |
| `GET`   | `/api/health`  | Status, Host, Port, LAN-Adressen, aktive Lager |

### Lager & Buchungen
| Methode | Pfad                          | Beschreibung                                |
| ------- | ----------------------------- | ------------------------------------------- |
| `GET`   | `/api/storage/locations?q=`   | Stellplätze/Bestände suchen                 |
| `GET`   | `/api/storage/movements?q=`   | Buchungshistorie                            |
| `GET`   | `/api/storage/issue-errors`   | Log nicht gebuchter Positionen              |
| `POST`  | `/api/storage/receipts`       | Wareneingänge buchen                        |
| `POST`  | `/api/storage/issues`         | Warenausgänge buchen                        |

### Artikelstamm
| Methode  | Pfad                                  | Beschreibung                          |
| -------- | ------------------------------------- | ------------------------------------- |
| `GET`    | `/api/articles?q=`                    | Artikel suchen/auflisten              |
| `POST`   | `/api/articles`                       | Artikel anlegen                       |
| `GET`    | `/api/articles/:id`                   | Einzelnen Artikel laden               |
| `PUT`    | `/api/articles/:id`                   | Artikel aktualisieren                 |
| `DELETE` | `/api/articles/:id`                   | Artikel deaktivieren                  |
| `DELETE` | `/api/articles/:id/permanent`         | Artikel endgültig löschen (Passwort)  |
| `GET`    | `/api/articles/lookup/:code`          | Lookup nach Materialnummer/Barcode    |
| `POST`   | `/api/articles/calculate-package`     | Gebinde-/Palettenmengen berechnen     |
| `POST`   | `/api/articles/import`                | Artikel importieren                   |
| `GET`    | `/api/articles/export`                | Artikel als CSV exportieren           |

### Aufträge
| Methode  | Pfad                          | Beschreibung                      |
| -------- | ----------------------------- | --------------------------------- |
| `GET`    | `/api/orders`                 | Aufträge auflisten                |
| `GET`    | `/api/orders/duplicate-check` | Duplikatsprüfung                  |
| `POST`   | `/api/orders`                 | Auftrag anlegen                   |
| `GET`    | `/api/orders/:id`             | Auftrag laden                     |
| `PUT`    | `/api/orders/:id`             | Auftrag aktualisieren             |
| `DELETE` | `/api/orders/:id`             | Auftrag löschen                   |
| `POST`   | `/api/orders/:id/export`      | Auftrag als PDF exportieren       |
| `GET`    | `/exports/...`                | Erzeugte Export-Dateien abrufen   |

---

## Datenhaltung

| Pfad                       | Inhalt                                              |
| -------------------------- | --------------------------------------------------- |
| `data/logistik.sqlite`     | Bestände, Buchungsbewegungen, Aufträge, Fehlerlog   |
| `data/artikel-ssi.sqlite`  | Artikelstamm Lager **SSI**                          |
| `data/artikel-si.sqlite`   | Artikelstamm Lager **SI**                           |
| `Exporte/`                 | Automatisch erzeugte PDF-Exporte                    |
| `tmp/`                     | Temporäre HTML-Dateien für den PDF-Export           |
| `data/backups/`, `Backups/`| Datenbank-Sicherungen                               |

Laufzeitdaten (`data/*.sqlite`, `Exporte/`, `tmp/`, `Backups/`, `*.log`) sind über `.gitignore` von der Versionierung ausgeschlossen.

---

## Nutzung auf älteren Tablets

Da Aufträge in der Regel maximal ca. 40 Positionen umfassen, ist die reine Bearbeitung im Browser auch auf schwächeren Geräten ressourcenschonend möglich.

**Empfehlung:**
- PDF-Import und OCR auf einem PC oder Server ausführen, **nicht** auf alten Tablets.
- Tablets nur zur Bearbeitung offener Aufträge nutzen – über den Tablet-Light-Modus `http://<server-ip>:4174/tablet.html`.
- Erledigte Positionen einklappen, Hintergrundaktualisierungen sparsam einsetzen.

Der Tablet-Light-Modus lädt nur `tablet.html`, `tablet.css` und `tablet.js`. PDF.js, OCR, PDF-Vorschau und Exportfunktionen bleiben der normalen PC-Oberfläche vorbehalten.

---

## PDF- und OCR-Verarbeitung

Text-PDFs werden direkt ausgelesen. Besteht eine PDF nur aus eingescannten Bildern, rendert die App die Seiten als Bild und liest sie per OCR aus. Für OCR wird beim ersten Lauf Tesseract.js mit deutscher und englischer Spracherkennung geladen – das kann je nach Netzwerk und PDF-Größe einen Moment dauern.

---

## Projektstruktur

```
.
├── server.mjs              # HTTP-Server, Routing, statische Auslieferung
├── server/
│   ├── db.mjs              # SQLite-Zugriff & Initialisierung
│   ├── articles.mjs        # Artikel-Logik (Suche, Import, Validierung, CSV)
│   ├── storage.mjs         # Bestände, Buchungen, Bewegungen, Fehlerlog
│   ├── orders.mjs          # Auftragsverwaltung
│   ├── export.mjs          # PDF-Export
│   └── helpers.mjs         # HTTP-Helfer, Validierung, IDs
├── index.html / app.js     # Kommissionierung
├── lager.html / lager.js   # Buchung, Artikelübersicht, Buchungsfehler
├── artikel.html / artikel.js # Artikelstamm
├── tablet.html / tablet.js # Tablet-Light-Modus
├── offline-store.js        # Lokale/Offline-Speicherung
├── styles.css / tablet.css # Oberflächen-Styles
├── service-worker.js, manifest.webmanifest  # PWA
├── start-server.ps1        # Windows-Starter mit Adressanzeige
├── setup-local-hostname.ps1# Lokalen Hostnamen einrichten
└── data/, Exporte/, tmp/   # Laufzeitdaten (nicht versioniert)
```

---

## Entwicklung

```bash
npm run lint     # ESLint
npm run format   # Prettier (schreibt Änderungen)
```

**Projektregeln** (siehe `CONVENTIONS.md`):
- Sprache von Kommentaren und UI-Texten: **Deutsch**.
- Änderungen klein und nachvollziehbar halten; keine großen Refactorings ohne Rückfrage.
- Bestehende Funktionsnamen nicht unnötig umbenennen.
- Minifizierte Bibliotheken (`pdf.min.js`, `pdf.worker.min.js`, `xlsx.full.min.js`) nicht bearbeiten.
- Vor größeren Änderungen kurz die betroffenen Dateien benennen.

---

## Hinweis

Internes Projekt (`"private": true`) ohne öffentliche Lizenz. Verwendung und Weitergabe nur im vorgesehenen betrieblichen Rahmen.
