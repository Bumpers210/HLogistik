# HLogistik

![Node](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=node.js&logoColor=white)
![Version](https://img.shields.io/badge/Version-1.1.0-blue)
![Stack](https://img.shields.io/badge/Stack-Vanilla%20JS%20%C2%B7%20SQLite-orange)
![Status](https://img.shields.io/badge/Status-intern-lightgrey)

HLogistik ist eine lokale Server-Anwendung fuer Lagerlogistik im LAN: Kommissionierung, Einlagerung, Wareneingang/-ausgang, Artikelstamm, Auswertungen und eine robuste Tablet-Oberflaeche laufen ueber einen Node.js-Server mit lokalen SQLite-Datenbanken.

Die App ist als PWA ausgelegt und wird auf PCs und Tablets im Browser genutzt. Es gibt keine Cloud-Abhaengigkeit.

## Funktionsumfang

### Kommissionierung (`/`)

- PDF-Import fuer Kommissionierauftraege, inklusive OCR mit Tesseract.js.
- OCR-Kandidatenbewertung mit 1000 DPI Basislauf, 1600 DPI Praezisionslauf und Rotationsfallback.
- Bestellhinweis-Erkennung: `Bestellhinweis` wird labelbasiert an die Auftragsnummer angehaengt.
- Ladelisten koennen als zusaetzliche Positionen aus OCR-Nebenkandidaten angehaengt werden.
- Nach-Lagerplatz-Regel: Wenn irgendeine Position `9021-0OUT` hat, wird der Auftrag als Kunde `9021-0OUT` und Auftragsnummer `SSI` behandelt; abweichende Nach-Lagerplaetze stehen positionsbezogen in der Zusatzbemerkung.
- Positionen abhaken, Ist-Mengen bearbeiten, Notizen erfassen und PDF exportieren.
- Export ist gesperrt, solange relevante Positionen offen sind.
- CR-002 bleibt bewusst aktiv: Bestandsbuchungsfehler blockieren den Kommissionierexport aktuell nicht, werden aber protokolliert.

### Einlagerung

- Manuelle Einlagerung mit einer oder mehreren Positionen gleicher Artikelnummer.
- Neue manuelle Stellplatzfelder starten leer.
- Soll-Stueckzahl ist bei manueller Einlagerung nicht erforderlich; die Ist-Stueckzahl wird explizit erfasst.
- HU-Prefix `34006381000` plus 7 Ziffern wird nur verlangt, wenn der Kunde `SSI` ist. Das Lager allein erzwingt keine HU.
- Tablet und Desktop unterstuetzen Verlassen, Abbrechen lokaler Entwuerfe und Loeschen offener serverseitiger Einlagerungen.

### Buchung und Bestand (`/lager.html`)

- Wareneingang und Warenausgang fuer SSI/SI.
- SSI-Stellplatznormalisierung gilt fuer Buchungen, nicht fuer den Kommissionier-PDF-Import.
- Artikeluebersicht, Stellplatzdetails, Buchungshistorie und Buchungsfehler.

### Artikelstamm (`/artikel.html`)

- Artikel anlegen, bearbeiten, deaktivieren und passwortgeschuetzt endgueltig loeschen.
- Gebindearten und Mengenvalidierung.
- Artikelimport/-export.
- Excel-Buchungsexport fuer frei waehlbare Zeitraeume. Der Export enthaelt erfolgreiche Buchungen und Buchungsfehler mit Auftragsreferenz und erzeugt die XLSX-Datei im Browser.

### Tablet (`/tablet.html`)

- Schlanke Tablet-Oberflaeche fuer Kommissionierung und Einlagerung.
- Modernes Script plus `tablet-legacy.js` fuer aeltere Geraete.
- Offline-Cache und Sync-Queue fuer zuvor uebernommene Auftraege.
- Gemeinsam uebernommene Auftraege gleicher Kundengruppe bleiben lokal wechselbar.
- PDF-Export versucht online zu speichern, laedt den Serverzustand frisch und entfernt lokale Auftragsdaten erst nach erfolgreicher PDF-Erstellung.
- Erledigte Positionen sind automatisch kompakt; es gibt keinen Schalter `Erledigte einklappen` mehr.

## Technischer Ueberblick

| Bereich | Umsetzung |
| --- | --- |
| Server | Node.js `node:http`, keine Web-Framework-Abhaengigkeit |
| Frontend | Vanilla JS, klassische Scripts, PWA mit Service Worker |
| Datenbank | SQLite fuer Auftraege, Bestaende, Bewegungen und Artikelstaemme |
| Import | `pdf.js`, Tesseract.js OCR, klassische Browser-Helfer |
| Export | Server-PDF per Browser-Automation, Excel/XLSX im Browser |
| Port | Standard `4174`, LAN-faehig |
| Schutz | Rollenmodell und Same-Origin-Schutz fuer LAN-Betrieb |

Wichtig: Das Rollenmodell ist ein LAN-Schutz gegen Fehlbedienung. Es ist keine echte Authentifizierung und ersetzt kein Benutzerkonto-, Session- oder Netzschutzkonzept fuer unsichere Netze.

## Installation und Start

```bash
npm install
npm start
```

Standardadresse: `http://localhost:4174/`

Unter Windows kann `start-server.ps1` genutzt werden. Das Fenster zeigt lokale und LAN-Adressen an, z. B. `http://192.168.x.x:4174/` oder den optionalen lokalen Hostnamen.

## Konfiguration

Konfiguration erfolgt ueber Umgebungsvariablen oder Textdateien im Projektordner.

| Variable / Datei | Zweck | Standard |
| --- | --- | --- |
| `PORT` | HTTP-Port | `4174` |
| `LOCAL_HOSTNAME` / `local-hostname.txt` | Lokaler Hostname fuer LAN-Hinweis | keiner |
| `HLOGISTIK_EXPORT_DIR` / `EXPORT_DIR` / `export-path.txt` | Zielordner fuer PDF-Exporte | `./Exporte` |
| `HLOGISTIK_IMPORT_DIR` / `import-path.txt` | Verwalteter Ordner fuer importierte Originaldateien | Exportordner |
| `HLOGISTIK_ARCHIVE_DIR` | Archivordner fuer Originaldateien nach erfolgreichem PDF-Export | `<Importordner>/Archiv` |
| `ARTICLE_DELETE_PASSWORD` | Passwort fuer endgueltiges Loeschen im Artikelstamm | Code-Fallback mit Startwarnung |

Originaldateien werden nur ueber den konfigurierten Importordner aufgeloest. Der Browser liefert beim Import nur den Dateinamen, keinen vertrauenswuerdigen Pfad. Nach erfolgreicher PDF-Erstellung, erfolgreichem Exportstatus und Abschluss des Exportpfads verschiebt der Server die Originaldatei in den Archivordner. Scheitert die Archivierung danach, bleibt der PDF-Export erfolgreich und der Archivfehler wird am Auftrag dokumentiert.

Hinweis: `archive-path.txt` ist als lokale Pfaddatei ignoriert, wird vom aktuellen Serverstand aber nicht ausgewertet. Fuer einen abweichenden Archivordner ist `HLOGISTIK_ARCHIVE_DIR` zu setzen.

`ARTICLE_DELETE_PASSWORD` sollte produktiv immer per Umgebung gesetzt werden. Ohne Umgebungswert startet der Server aus Kompatibilitaetsgruenden weiter, gibt aber eine Warnung aus.

## Oberflaechen

| Pfad | Bereich | Beschreibung |
| --- | --- | --- |
| `/` | Kommissionierung | PDF-/OCR-Import, Pickliste, Export |
| `/lager.html` | Buchung | Wareneingang/-ausgang, Artikeluebersicht, Buchungsfehler |
| `/artikel.html` | Artikelstamm | Artikelpflege, Import/Export, Buchungsexport |
| `/auswertungen.html` | Auswertungen | Reports und Lagerauswertungen |
| `/tablet.html` | Tablet | Kommissionierung und Einlagerung fuer Tablets |

## Wichtige API-Endpunkte

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/api/health` | Status, Host, Port, LAN-Adressen, `exportDir`, `importDir`, `archiveDir` |
| `GET` | `/api/storage/locations` | Bestand/Stellplaetze suchen |
| `POST` | `/api/storage/receipts` | Wareneingang buchen |
| `POST` | `/api/storage/issues` | Warenausgang buchen |
| `GET` | `/api/storage/issue-errors` | Buchungsfehler lesen |
| `GET` | `/api/articles` | Artikel suchen |
| `POST` | `/api/articles` | Artikel anlegen |
| `DELETE` | `/api/articles/:id/permanent` | Artikel endgueltig loeschen |
| `GET` | `/api/articles/bookings/export` | Buchungsdaten fuer Browser-XLSX |
| `GET/POST/PUT/DELETE` | `/api/orders...` | Auftragsverwaltung |
| `POST` | `/api/orders/:id/export-pdf` | PDF-Export, Bestandsbuchung, Archivierung |

## Datenhaltung und Artefakte

| Pfad | Inhalt |
| --- | --- |
| `data/logistik.sqlite` | Auftraege, Bestaende, Bewegungen, Fehlerlog |
| `data/artikel-ssi.sqlite` | Artikelstamm SSI |
| `data/artikel-si.sqlite` | Artikelstamm SI |
| `Exporte/` oder Exportpfad | erzeugte PDF-Exporte |
| Importordner | eingehende Original-PDFs |
| Archivordner | verschobene Originaldateien nach erfolgreichem Export |
| `tmp/` | temporaere Export- und QA-Dateien |
| `Backups/` | Code-Backups |

Laufzeitdaten, Datenbank-Backups, Exportdateien, lokale Pfaddateien und QA-Artefakte sind ueber `.gitignore` von der Versionierung ausgeschlossen.

## PDF- und OCR-Verarbeitung

Der Kommissionier-PDF-Import nutzt OCR-Kandidaten und waehlt einen vollstaendigen Kandidaten. Von-Lagerplaetze werden dabei nicht automatisch per SSI-Stellplatzregel, Bestandsdaten oder OCR-Zeichenkorrektur umgeschrieben. Erlaubt sind technische Bereinigungen wie Trimmen, Whitespace und Bindestriche.

Einlagerungs-PDFs koennen eine saubere PDF-Textschicht direkt nutzen; unsichere Faelle gehen weiterhin durch OCR. Die echte Scan-Qualitaet sollte regelmaessig mit Referenz-PDFs geprueft werden.

## Entwicklung und QA

```powershell
npm.cmd run lint
npm.cmd run check:syntax
```

Schreibende QA-Laeufe muessen gegen eine isolierte Kopie laufen. Empfohlener Start:

```powershell
.\scripts\start-qa-copy.ps1
```

In einem zweiten PowerShell-Fenster:

```powershell
$env:QA_BASE_URL = "http://127.0.0.1:4175"
npm.cmd run test:qa
Remove-Item Env:\QA_BASE_URL -ErrorAction SilentlyContinue
```

Automatisierte QA-Exporte duerfen keine dauerhaften PDF/XLSX/CSV/HTML-Artefakte hinterlassen. Produktive Exporte ohne QA-Header erzeugen weiterhin Dateien im Exportziel.

Die verbindliche Testbasis steht in `docs/TEST_BASELINE.md`.

## Projektstruktur

```text
.
|-- server.mjs
|-- server/
|   |-- db.mjs
|   |-- orders.mjs
|   |-- export.mjs
|   |-- reports.mjs
|   |-- original-archive.mjs
|   |-- rules/
|   `-- config/
|-- index.html / app.js
|-- artikel.html / artikel.js
|-- lager.html / lager.js
|-- tablet.html / tablet.js / tablet-legacy.js
|-- offline-store.js
|-- order-hint-rules.js
|-- service-worker.js / manifest.webmanifest
`-- data/, Exporte/, tmp/, Backups/  (nicht versioniert)
```

## Hinweis

Internes Projekt ohne oeffentliche Lizenz. Verwendung und Weitergabe nur im vorgesehenen betrieblichen Rahmen.
