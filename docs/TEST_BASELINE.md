# HLogistik Test Baseline

Stand: 2026-07-24 08:27:50 +02:00

## Kurzbeschreibung

Diese Datei ist die verbindliche Testbasis fuer kuenftige HLogistik-Aenderungen. Schreibende Tests laufen nicht gegen den Live-Server auf Port `4174`, sondern gegen eine isolierte QA-Kopie auf Port `4175`.

Die QA-Matrix ist gross genug und soll nicht ohne konkreten Bug-/Risikoanlass erweitert werden. Neue Tests sollen gezielt Luecken schliessen, nicht bestehende Abdeckung duplizieren.

## Pflichtchecks vor Commit

### Reine Markdown-/Dokuaenderungen

```powershell
git diff --check
git diff --cached --check
```

### JS-/MJS-/Frontend-/Serveraenderungen

```powershell
npm.cmd run lint
npm.cmd run check:syntax
```

Danach gegen isolierte QA-Kopie:

```powershell
$env:QA_BASE_URL = "http://127.0.0.1:4175"
npm.cmd run test:qa
Remove-Item Env:\QA_BASE_URL -ErrorAction SilentlyContinue
```

### Pre-Commit-Basis ohne QA-Server

```powershell
npm.cmd run check:precommit
```

`check:precommit` fuehrt Lint und Syntaxcheck aus. Die API-Matrix bleibt bewusst separat, weil sie einen laufenden isolierten Server auf Port `4175` braucht.

## Isolierte QA-Kopie starten

Empfohlener PowerShell-Ablauf:

```powershell
.\scripts\start-qa-copy.ps1
```

Das Skript erstellt eine Kopie unter `tmp/qa-workspace-YYYYMMDD-HHMMSS/`, schliesst `.git`, `node_modules`, `data`, `Backups`, `tmp`, `Exporte`, lokale Pfaddateien und Exportartefakte aus und startet den Server auf Port `4175`.

In einem zweiten PowerShell-Fenster:

```powershell
$env:QA_BASE_URL = "http://127.0.0.1:4175"
npm.cmd run test:qa
Remove-Item Env:\QA_BASE_URL -ErrorAction SilentlyContinue
```

Nur vorbereiten, ohne Serverstart:

```powershell
.\scripts\start-qa-copy.ps1 -PrepareOnly
```

Die QA-Kopie nutzt eigene Ordner innerhalb der Kopie:

- Export: `<QA-Kopie>\Exporte`
- Import: `<QA-Kopie>\Import`
- Archiv: `<QA-Kopie>\Import\Archiv`

`ARTICLE_DELETE_PASSWORD` wird fuer den QA-Server gesetzt. Produktive Datenbanken, Importordner und Exportordner werden nicht verwendet.

## Live-Port-Verbot

`npm.cmd run test:qa` darf nicht gegen Port `4174` laufen. Die QA-Matrix schreibt Testartikel, Testbuchungen und Testauftraege. Der Live-Port-Schutz bricht ohne `QA_ALLOW_LIVE=1` ab, wenn `QA_BASE_URL` auf Port `4174` zeigt.

`QA_ALLOW_LIVE=1` ist nur fuer bewusst geplante Live-Diagnosen erlaubt und nicht Teil der normalen Commit-Validierung.

## QA-Artefaktregeln

Automatisierte QA-Laeufe duerfen keine dauerhaften Artefakte hinterlassen:

- keine `QA-*.pdf`
- keine `QA-*.xlsx`
- keine `QA-*.csv`
- keine `QA-*.html`

Die QA-Matrix sucht im Exportziel, in `Exporte/`, in `tmp/` und in gemeldeten Exportpfaden nach QA-Artefakten. Originaldatei-Archivtests bereinigen ihre `QA-ORIG-*.pdf` in Import- und Archivordnern.

## Manuelle Smokes nach Aenderungstyp

### Frontend oder Service Worker

- Asset-/Cache-Version pruefen.
- `/`, `/lager.html`, `/artikel.html`, `/auswertungen.html`, `/tablet.html` laden.
- Browser hart neu laden.
- Service-Worker-Fallback fuer bekannte Unterseiten pruefen.

### PDF-/OCR-Import

- QA-Matrix ausfuehren.
- Mindestens ein problematisches Referenz-PDF manuell importieren.
- Mindestens ein bisher funktionierendes PDF manuell importieren.
- Browser-Konsole auf `PDF-Import Diagnose` und Positionsdiagnose pruefen.
- Von-Lagerplatz darf nicht per SSI-Stellplatzregel oder Bestandsdaten korrigiert werden.

### Tablet oder Offline

- Tablet Modern pruefen.
- Tablet Legacy pruefen, soweit moeglich.
- Auftrag uebernehmen, offline wechseln, Sync-Queue-Verhalten pruefen.
- Button-, Loading- und Fehlerzustaende pruefen.
- PDF-Export ohne Tab-Reload pruefen.

### Umlagerungen

- Nur gegen eine isolierte QA-Datenbank auf Port `4175` buchen.
- Buero, Tablet und Verwaltung duerfen buchen; Lager und unbekannte Rollen nicht.
- Vollstaendige Bestandszeile auf neues und vorhandenes Ziel verschieben; Stueck- und Palettensumme muessen gleich bleiben.
- Scanner-Enter fuer die Quellsuche pruefen; Enter im Zielstellplatz darf keine Buchung ausloesen.
- Entwurf speichern, Seite neu laden, Entwurf oeffnen und Quellsnapshot online erneut validieren.
- Offline darf kein `POST /api/storage/transfers` und kein Eintrag in die bestehende Sync-Queue entstehen.
- Online fuer das gewaehlte Lager einen vollstaendigen Snapshot aller positiven Bestandszeilen speichern; nur ID, Lager, Artikel-ID, Materialnummer, Barcode, Stellplatz, HU/LE, Menge, Paletten und Aktualisierungszeitpunkt duerfen enthalten sein.
- Offline-Suche direkt im aktiven Snapshot-Backend nach Artikel/Material, Barcode, Stellplatz und HU/LE pruefen; die Oberflaeche zeigt maximal 25 Treffer. Verlauf und Bewegungen duerfen nicht offline persistiert werden.
- Snapshot-Lager, Zeitpunkt und Zeilenzahl sichtbar pruefen. Eine simuliert unterbrochene Aktualisierung muss den zuvor vollstaendigen Snapshot unveraendert aktiv lassen.
- iOS-9-Kompatibilitaet ohne `IDBObjectStore.getAll()` und `DOMStringList.contains()` sowie mit `webkitIndexedDB`/`webkitIDBKeyRange` pruefen. Snapshot muss nach neuem Store-Aufruf und Reload suchbar bleiben.
- Fehlerfaelle fuer fehlendes/veraltetes Offline-Store-Skript, blockiertes Upgrade, unvollstaendiges Schema sowie Schreib-/Cursorfehler muessen einen konkreten Diagnosecode statt einer Sammelmeldung zeigen.
- Bei `IDB_SNAPSHOT_WRITE_START_FAILED` muessen nativer Fehlername, native Meldung, Ist-DB-Version und vorhandene Object-Stores sichtbar sein. Fuer die gemeldete DB-Version 7 mit vollstaendigem Schema darf der Fehlerpfad weder loeschen noch upgraden; Entwuerfe, Queue-Eintraege, Auftraege und sonstige Stores muessen erhalten bleiben.
- Die IndexedDB-Bereitschaftspruefung muss exakt die gemeinsame `readwrite`-Transaktion ueber `transfer-stock-rows` und `transfer-stock-snapshots` verwenden und Schreiben sowie Lesen in beiden Stores nachweisen. `NotFoundError` bei Start, Schreiben, Lesen oder beim anschliessenden Snapshot markiert IndexedDB fuer die Sitzung einmalig als unbrauchbar; derselbe vollstaendige Snapshot wird automatisch ueber WebSQL wiederholt. Wiederholte IndexedDB-Versuche und Fallback-Schleifen sind unzulaessig.
- Eine IndexedDB, deren echte Schreib-/Leseprobe fehlschlaegt, muss fuer Umlagerung auf die isolierte WebSQL-Datenbank wechseln. Backend und IndexedDB-Ursache sichtbar pruefen. WebSQL darf nur Snapshot, ungepruefte Umlagerungsentwuerfe und Probedaten enthalten; keine Auftraege oder Sync-Queue. Snapshot seitenweise schreiben, erst nach exakter Zeilenzahl aktivieren und nach Reload per SQL nach Artikel, Barcode, Stellplatz und HU/LE mit maximal 25 Treffern suchen. Eine unvollstaendige Generation darf den vorherigen Stand nicht ersetzen.
- Fuer den vollstaendigen Snapshot darf kein LocalStorage-Fallback eingefuehrt werden.
- Verlauf online auf maximal 30 Zeilen begrenzen.
- Offline gespeicherte Entwuerfe als `unchecked` kennzeichnen. Nach Wiederverbindung bleibt Buchen bis zur erfolgreichen Onlinepruefung gesperrt.
- Mengen-, Paletten-, Stellplatz-, HU-/LE- oder Zeitstempelabweichung muss die Buchung sperren und eine erneute Quellauswahl verlangen.
- Integrierten Arbeitsbereich in `tablet.html` ueber Modusschalter und direkten Link `tablet.html?bereich=umlagerungen` pruefen.
- Desktop-, 1024er- und 768er-Tablet-Layout sowie Kamera-Fallback pruefen; eine eigenstaendige Umlagerungsseite darf nicht ausgeliefert werden.
- Reale Kamera und Berechtigungsdialog auf einem physischen Tablet stichprobenartig pruefen.

### Export oder Archivierung

- Desktop-PDF-Export pruefen.
- Tablet-PDF-Export pruefen.
- Originaldatei-Archivierung pruefen.
- Fehlerfall mit offen gelassener Position pruefen.
- QA-Artefaktfreiheit pruefen.
- CR-002 pruefen.

### Artikelstamm und Buchungsexport

- Gueltiger Zeitraum, leerer Zeitraum, ungueltiger Zeitraum.
- Spaltenreihenfolge `Buchungsrichtung`, `Datum/Uhrzeit`, `Lager`, `Stellplatz`, `HU/LE-Nummer`, `Menge`, `Referenz`.
- Erfolgreiche Buchungen und Buchungsfehler mit Auftragsreferenz.
- Rollenfehler.
- Read-only Wiederholaufruf.

## CR-002

CR-002 bleibt bewusst aktiv. Ein vollstaendig abgehakter Kommissionierauftrag darf trotz Bestandsbuchungsfehlern exportiert werden; Fehler werden protokolliert und im Buchungsexport sichtbar. Diese Regel darf in Test- oder Infrastrukturarbeiten nicht veraendert werden.
