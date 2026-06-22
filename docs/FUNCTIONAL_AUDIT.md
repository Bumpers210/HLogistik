# HLogistik Functional Audit

Stand: 2026-06-22 07:34:44 +02:00

## Grundlage

Dieser Audit wurde frisch aus dem aktuellen Arbeitsbaum erstellt. Alte Audit-, QA- und Bug-Dokumente wurden nicht als Quelle verwendet.

- Repository: `C:\Users\Lager\Documents\Logistik\HLogistik-git`
- Branch: `codex/tablet-offline-storage-pdf-updates`
- App-Typ: Node.js Server mit klassischem HTML/CSS/JavaScript-Frontend
- Laufzeit: Node >= 22, SQLite ueber `node:sqlite`
- Paketmanager: npm
- Startbefehl: `npm start` bzw. `node server.mjs`
- Testkopie: `tmp/audit-workspace/`
- Audit-Port: `4175`
- Audit-Exportordner: `tmp/audit-workspace/Exporte`

Der Arbeitsbaum war zu Beginn bereits uncommitted veraendert. Diese Aenderungen wurden als aktuelle Baseline behandelt und nicht zurueckgesetzt.

## Gepruefte Kernbereiche

### Start und statische Auslieferung

Geprueft wurden `/`, `/tablet.html`, `/lager.html`, `/artikel.html`, `/auswertungen.html`, `/manifest.webmanifest`, `/service-worker.js` und `/api/health`.

Ergebnis: Alle genannten Ressourcen liefern im Audit-Server HTTP 200. HTML, JavaScript, CSS, Manifest und Service Worker werden mit `no-store` ausgeliefert.

### Rollen und Navigation

Geprueft wurden Buero- und Tablet-Pfade.

- Ohne gespeicherte Rolle leiten geschuetzte Desktop-Seiten auf `/` zurueck.
- Mit Buero-Rolle laden Buchung, Artikelstamm und Auswertungen korrekt.
- Tablet-Ansicht laedt separat ueber `tablet.html` und zeigt die Arbeitsbuttons in einer Zeile bei 820 px Breite.
- Mutationen ohne passende `X-User-Group` werden serverseitig mit 403 abgelehnt.

### Artikelverwaltung

Geprueft wurden Lesen, Anlegen, Validierung, UTF-8/Umlaute, ungueltige Gebinde-/Mengenfelder und Rollenpruefung.

Ergebnis nach Fix: Ungueltige Artikelwerte liefern kontrollierte 400-Fehler statt 500. Umlaute und Sonderzeichen werden in Artikelbezeichnung und Bemerkung korrekt gespeichert.

### Lagerbestand und Lagerlogik

Geprueft wurden Wareneingang, Warenausgang, SSI-Stellplatznormalisierung, Lagerbestand nach Buchung, fehlende Rolle, Reports und leere Suchergebnisse.

Ergebnis nach Fix: Warenausgang normalisiert SSI-Stellplaetze jetzt konsistent wie Wareneingang. Ein Testbestand auf `002-H1-SQA` wurde intern auf `002-H3-SQA` gebucht und beim Warenausgang mit demselben Benutzereingabewert korrekt reduziert.

### Kommissionierung und Auftraege

Geprueft wurden Auftragserstellung, 9021-0OUT-Kundenuebernahme, SSI-Auftragsnummer-Regel, Export-Sperre bei offenen Positionen und Loeschen nicht exportierter Auftraege.

Ergebnis: Bei `toBin = 9021-0OUT` wird `customerName = 9021-0OUT` und `orderNumber = SSI` gesetzt. PDF-Export unvollstaendiger Auftraege wird mit einem klaren 400-Fehler blockiert. Nicht exportierte Auftraege koennen geloescht werden.

### Einlagerung

Geprueft wurden Validierungen im Codepfad fuer manuelle Einlagerungen und die bestehende SSI-HU-Regel. Die Regel bleibt: HU-Prefix `34006381000` wird nur fuer SSI-Kunden erzwungen, nicht allein anhand des Lagers.

### Auswertungen

Geprueft wurden:

- `/api/storage/reports/article-movements`
- `/api/storage/reports/top-articles`
- `/api/storage/reports/slow-articles`
- `/api/storage/reports/location-usage`

Ergebnis: Alle Report-Endpunkte liefern HTTP 200 und `ok: true`.

### Import / Export

Geprueft wurden Export-Sperre bei offenen Positionen, PDF-Endpunkt vor Validierungsfehlern, Exportpfad in der Audit-Kopie und fehlende Exportdateien.

CR-002 bleibt unveraendert: Der Kommissionierexport darf trotz Bestandsbuchungsfehlern abschliessen. Das ist aktuell bewusstes Uebergangsverhalten und wurde nicht behoben.

## Gesamtstatus

Die geprueften Kernworkflows sind nach den beiden Fixes in der Audit-Kopie stabil. Es bleiben offene Robustheits- und Betriebsrisiken, besonders bei korrupten SQLite-Dateien und Service-Worker-Offline-Fallbacks fuer einzelne Desktop-Unterseiten.
