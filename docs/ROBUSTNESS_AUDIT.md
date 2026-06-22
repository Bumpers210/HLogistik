# HLogistik Robustness Audit

Stand: 2026-06-22 13:35:44 +02:00

## Tablet Offline-Auftragsgruppen

Geprueft und verbessert:

- Gemeinsame Tablet-Uebernahme mehrerer Auftraege derselben Kundengruppe.
- Lokale Vollauftrags-Speicherung pro Auftrag-ID.
- Zusaetzliche Gruppenablage `order-groups` im Offline-Store mit `groupId` und `orderIds`.
- Wechsel zwischen uebernommenen Auftraegen bei unterbrochener Serververbindung.
- Offline-Speichern nach nachtraeglichem Verbindungsverlust ueber bestehende Sync-Queue.

Ergebnis:

Der Tablet-Workflow ist robuster gegen Verbindungsabbrueche. Nach einer Gruppenuebernahme bleiben alle gemeinsam uebernommenen Auftraege lokal sichtbar, wechselbar und pro Auftrag getrennt bearbeitbar.

Validierung:

- QA-Matrix erweitert: zwei Auftraege gleicher Kundengruppe werden gemeinsam uebernommen; Details und Summaries werden geliefert; getrennte Updates bleiben getrennt.
- Browser-Smoke online und offline gegen `tmp/tablet-offline-group-qa/` auf Port `4175`.
- Cache-/Manifest-Version: `1.5.118`.

## Manuelle Einlagerung

Die manuelle Einlagerung wurde gegen versehentliche Massenanlage abgesichert:

- `Anzahl Positionen` wird auf positive ganze Zahlen validiert.
- Obergrenze: `100` Positionen pro Anlageaktion bzw. manuellem Einlagerauftrag.
- Mehrere Positionen derselben Artikelnummer bleiben erlaubt.
- Soll-Stueckzahl ist fuer manuelle Einlagerung optional und wird in der manuellen UI nicht mehr angezeigt.
- SSI-HU-Regeln bleiben unveraendert; vollstaendige HU-Werte werden nicht automatisch dupliziert.

Die QA-Matrix deckt Mehrfachanlage, fehlende Sollmenge, ungueltige Anzahl und SSI-HU-Pflicht ab.

## Regel-Refactoring

Die fachlichen Serverregeln sind jetzt kontrolliert in `server/rules/` und `server/config/` gebuendelt. Dadurch sind Rollenmatrix, Gebinderegeln, Lagerkonstanten, SSI-Stellplatznormalisierung, Kunden-/Auftragsregeln und Export-Vollstaendigkeitspruefung besser pruefbar.

Verhalten:

- Keine REST-API-, Datenbank- oder Exportformat-Aenderung.
- CR-002 bleibt aktiv und wurde nicht umgebaut.
- Browser-/Tablet-Legacy-Regeln bleiben bewusst nicht voll modularisiert.

Validierung:

- Jede Refactoring-Stufe wurde mit `npm.cmd run lint`, `node --check` fuer die geaenderten Dateien und `QA_BASE_URL=http://127.0.0.1:4175 npm.cmd run test:qa` geprueft.
- Die finale QA-Matrix bestand mit 24/24 Checks.
- CR-002 wurde gezielt gegengeprueft: Ein abgehakter Auftrag mit Bestandsbuchungsfehler wurde weiterhin exportiert und der Fehler blieb protokolliert.

## Teststrategie

Schreibende QA-Tests laufen weiterhin gegen isolierte Kopien, nicht gegen die aktive Produktivdatenbank.

Aktuelle Pruefumgebungen:

- QA-Kopie: `tmp/risk-qa-workspace/`
- QA-Port: `4175`
- Korrupte-DB-Kopie: `tmp/risk-corrupt-db-workspace-20260622-083739/`

## Eingabevalidierung

Geprueft:

- Ungueltige Artikelmengen
- Fehlende/ungueltige JSON-Nutzlast
- Fehlende Rolle bei Mutationen
- Unvollstaendige Auftraege beim Export
- Umlaute/Sonderzeichen in Artikeltexten

Ergebnis:

`npm run test:qa` gegen die isolierte Kopie bestand mit 21/21 Checks.

## Datenintegritaet

Geprueft:

- SSI-Warenausgang nach normalisiertem SSI-Wareneingang
- Bestand nach Teilentnahme
- Auftragsanlage mit 9021-0OUT
- Export-Sperre bei offenen Positionen
- Loeschen nicht exportierter Auftraege

Ergebnis:

Die geprueften Datenpfade verhalten sich konsistent. CR-002 wurde nicht geaendert.

## Datenbank-Robustheit

Leere Datenbank:

Leere Datenablaegen werden weiterhin automatisch initialisiert.

Korrupte Datenbank:

Korrupte SQLite-Dateien werden nicht automatisch repariert. Der Server gibt jetzt vor dem Abbruch eine klare Diagnose mit betroffenen Dateien und Wiederherstellungshinweis aus.

Betreiberentscheidung:

Ein automatischer Quarantaene-/Restore-Modus ist nicht aktiv. Vor einer solchen Funktion muss entschieden werden, wann Dateien verschoben werden duerfen, welcher Backup-Stand automatisch vertrauenswuerdig ist und wie versehentlicher Datenverlust verhindert wird.

## Datei- und Exportpfade

Geprueft:

- Fehlende statische Datei
- Separater Exportordner in der QA-Kopie
- PDF-Export-Endpunkt vor Validierungsfehlern

Ergebnis:

Fehlende statische Dateien liefern HTTP 404. Der Export unvollstaendiger Auftraege bleibt blockiert.

## Service Worker

Der Offline-Navigationsfallback ist fuer bekannte App-Seiten konsistenter:

- `/` und `/index.html` -> `/index.html`
- `/tablet.html` -> `/tablet.html`
- `/lager.html` -> `/lager.html`
- `/artikel.html` -> `/artikel.html`
- `/auswertungen.html` -> `/auswertungen.html`
- unbekannte Pfade -> `/index.html`

Cache- und Manifest-Version: `1.5.113`.

## UI-Robustheit

Browser-Smokes:

- Desktop 1280 px: `/`, `/lager.html`, `/artikel.html`, `/auswertungen.html`
- Tablet 820 px: `/tablet.html`

Ergebnis:

Alle geprueften Seiten laden ohne Konsolenfehler und ohne horizontalen Body-Overflow.

## Security- und Betriebsbefunde

- Mutationen bleiben gegen falsche Rollen serverseitig abgesichert.
- `ARTICLE_DELETE_PASSWORD` gibt beim fehlenden Umgebungswert jetzt eine Startwarnung aus.
- Das Rollenmodell ist ein LAN-Schutz gegen Fehlbedienung, keine echte Authentifizierung.
- Ein harter Startabbruch ohne gesetztes `ARTICLE_DELETE_PASSWORD` ist noch nicht aktiv und bleibt Betreiberentscheidung.
