# Post-Phase-2 Realtest-Checkliste

Stand: 2026-07-03

## Kurzfazit

Der technische Stabilitäts-Checkpoint nach den bisherigen Phase-2-Refactorings ist grün: Precommit-Checks, QA-Matrix, Helper-Ladefolge, direkte Asset-Auslieferung und Browser-Smoke waren erfolgreich. Vor weiteren Parser- oder Import-Extraktionen sollte trotzdem mindestens ein kontrollierter Realtest im Betriebsablauf durchgeführt werden.

## Abgeschlossene Phase-2-Änderungen

- `app-import-line-helpers.js`: reine Import-/Zeilen- und Normalisierungshelfer.
- `app-import-diagnostics.js`: reine Import-/OCR-Diagnosehelfer.
- `app-state-helpers.js`: kleine reine Line-/State-Helfer.
- `app-ui-helpers.js`: kleine reine UI-String-/SVG-Helfer.

## Realtest-Checkliste Für Den Betrieb

- Desktop-Kommissionier-PDF importieren und Positionen, Mengen, Kunde, Nach-Lagerplatz und Von-Lagerplatz prüfen.
- Ladelistenfall prüfen: Ladelistenposition muss sichtbar angehängt werden und Barcode-/Ladelistenanzeige muss wie erwartet aussehen.
- Einlagerung manuell anlegen, speichern, abschließen und PDF-Erstellung prüfen.
- Tablet-Auftrag übernehmen, Position bearbeiten und speichern.
- Tablet-PDF-Export kontrolliert testen: Auftrag darf erst nach erfolgreicher PDF-Erstellung gelöscht/abgeschlossen sein.
- Artikelstamm-Buchungsexport prüfen, inklusive Buchungsfehlerzuordnung.
- Export-Sperre bei offenen Positionen prüfen: nicht vollständig abgehakte Aufträge dürfen nicht exportiert werden.
- CR-002 bewusst unverändert prüfen: vollständig abgehakter Kommissionierauftrag darf trotz Bestandsbuchungsfehlern exportiert werden; Fehler müssen protokolliert bleiben.

## Beobachtungspunkte

- Falsche Script- oder Cache-Version im Browser.
- Alte Service-Worker-Version trotz Neuladen.
- Browser-Konsolenfehler.
- Abweichende Mengen nach Import oder Export.
- Abweichende Ladelistenanzeige oder fehlende Ladelistenposition.
- Abweichende Von-Lagerplatz-Werte im importierten Auftrag.
- Tablet-Offline-Auffälligkeiten, insbesondere Speichern, Wiederverbinden und PDF-Export.

## Realtest-Ergebnis

Ergebnis: erfolgreich abgeschlossen.

Geprüfte Bereiche:

- Desktop-Kommissionier-PDF.
- Ladelistenfall.
- Manuelle Einlagerung.
- Tablet-Speichern/PDF-Export.
- Artikelstamm-Buchungsexport.
- Export-Sperre bei offenen Positionen.
- CR-002 unverändert.

Entscheidung: stabil, Phase 2E darf geplant werden.

## Entscheidung Nach Realtest

- Stabil: Betrieb bestätigt, Refactoring kann kontrolliert weiter geplant werden.
- Nacharbeiten: Auffälligkeit dokumentieren, betroffene Funktion isoliert prüfen, keine neue Refactoring-Phase starten.
- Refactoring fortsetzen: erst nach erfolgreichem Realtest und sauberem Arbeitsbaum.
- Blockieren: bei Datenabweichungen, Importfehlern, fehlenden PDFs, Tablet-Sync-Problemen oder CR-002-Abweichungen.

## Empfehlung

Vor einem weiteren Parser-Extract mindestens einen kontrollierten Realtest mit echten Betriebsdaten durchführen. Erst danach Phase 2E planen oder freigeben.
