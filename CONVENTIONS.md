# Projektregeln für HLogistik

- Sprache der Kommentare und UI-Texte: Deutsch.
- Keine großen Refactorings ohne Rückfrage.
- Änderungen möglichst klein und nachvollziehbar halten.
- Minifizierte Bibliotheken wie pdf.min.js und pdf.worker.min.js nicht bearbeiten.
- Bestehende Funktionsnamen nicht unnötig umbenennen.
- Frontend-Dateien:
  - artikel.js: Artikelstamm, Artikelsuche, Artikelstatus.
  - lager.js: Lagerverwaltung und Bestände.
  - offline-store.js: lokale/offline Speicherung.
  - tablet.js: Tablet-Oberfläche für Aufträge.
- Server-Dateien:
  - server/articles.mjs: Artikel-API.
  - server/orders.mjs: Auftrags-API.
  - server/db.mjs: Datenbankzugriff.
- Vor jeder größeren Änderung erst kurz erklären, welche Dateien betroffen sind.
- Bei Änderungen immer nur die minimal nötigen Dateien bearbeiten.