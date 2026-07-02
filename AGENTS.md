# AGENTS.md

Verbindliche Arbeitsregeln für Codex- und Agentenarbeit im Projekt HLogistik.

## Sprache und Stil

- Kommunikation, Dokumentation und fachliche Notizen auf Deutsch verfassen.
- Dateien als UTF-8 behandeln und deutsche Umlaute korrekt schreiben.
- Änderungen klein, konservativ und nachvollziehbar halten.
- Keine großen Refactorings, Architekturumbauten oder Feature-Erweiterungen ohne ausdrückliche Freigabe.

## Git und Datenhygiene

- Vor Änderungen immer `git status --short` prüfen.
- Keine produktiven Daten, Datenbanken, Exporte, Backups, Logs, lokale Pfaddateien oder QA-Artefakte committen.
- `data/`, `Exporte/`, `tmp/`, `Backups/`, `*.sqlite*`, `QA-*.pdf`, `QA-*.xlsx`, `QA-*.csv` und `QA-*.html` bleiben außerhalb des Commit-Scopes.
- Ungetrackte lokale Audit-/Risiko-Dateien, z. B. `docs/FULL_APP_RISK_ANALYSIS_LOG.md`, nur anfassen, wenn der Nutzer das ausdrücklich verlangt.
- Kein Commit und kein Push ohne ausdrückliche menschliche Freigabe.

## QA-Testbasis

- Die verbindliche Testbasis steht in `docs/TEST_BASELINE.md` und ist bei jeder Änderung zu beachten.
- Schreibende QA-Läufe laufen gegen eine isolierte QA-Kopie auf Port `4175`, nicht gegen den Live-Server auf Port `4174`.
- Für QA die PowerShell-Befehle aus `docs/TEST_BASELINE.md` verwenden.
- QA-Läufe dürfen keine dauerhaften PDF/XLSX/CSV/HTML-Artefakte hinterlassen.
- Vor Commit mindestens `git diff --check` und die passende Testbasis ausführen; bei JS-/MJS-/Frontend-/Serveränderungen `npm.cmd run check:precommit`.

## Fachliche Schutzregeln

- CR-002 bleibt unverändert: Ein vollständig abgehakter Kommissionierauftrag darf trotz Bestandsbuchungsfehlern exportiert werden; Fehler werden protokolliert.
- PDF-/OCR-Importlogik nicht durch Stellplatzvalidierung, SSI-Stellplatzregeln oder Bestandsdaten verfälschen. Eingelesene Von-Lagerplätze bleiben Rohwerte, solange keine ausdrücklich freigegebene Importregel etwas anderes verlangt.
- Keine automatische SQLite-Reparatur einbauen.
- Keine echte Authentifizierung einbauen oder das LAN-Rollenmodell stillschweigend als echte Authentifizierung behandeln.
- Keine DB-Migration oder produktive Datenänderung ohne ausdrücklichen Auftrag.

## Frontend, Tablet und Offline

- Tablet-, Legacy-Tablet- und Offline-Code besonders vorsichtig behandeln; alte Tablet-Kompatibilität nicht versehentlich brechen.
- `tablet.js` und `tablet-legacy.js` nicht zusammenführen und keine Offline-Sync-Abläufe umbauen, außer der Nutzer fordert genau das.
- Bei Frontendänderungen Service-Worker-, Manifest- und Asset-Versionen prüfen und, wenn nötig, konsistent erhöhen.
- Nach Frontendänderungen Browser-/Tablet-Smokes gemäß `docs/TEST_BASELINE.md` einplanen.

## Regel- und Dokumentationspflege

- Fachregeln bevorzugt in vorhandenen Regel-/Config-Dateien halten, aber nur risikoarm und ohne Verhaltensänderung auslagern.
- Dokumentation aktuell halten, besonders `docs/TEST_BASELINE.md`, `docs/RULES_OVERVIEW.md`, `docs/OPEN_RISKS.md` und `docs/FIX_LOG.md`.
- Laufzeitverhalten und Dokumentation müssen übereinstimmen; bekannte Abweichungen wie `archive-path.txt` vs. `HLOGISTIK_ARCHIVE_DIR` klar dokumentieren.
