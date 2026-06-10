const API_BASE = "";
const ARTICLE_SEARCH_DEBOUNCE_MS = 200;
const USER_KEY = "kommissionier-app-user-v1";
const USER_GROUP_KEY = "kommissionier-app-user-group-v1";
const WAREHOUSE_KEY = "hlogistik-warehouse-v1";
const ARTICLE_SORT_KEY = "artikelstamm-sort-v1";
const ARTICLE_SORT_COLUMNS = new Set([
  "materialnummer",
  "materialbezeichnung",
  "gebindeArt",
  "mengeProKarton",
  "mengeProPalette",
  "gesamtStueck",
  "status"
]);

const elements = {};
let articles = [];
let stockTotalsByMaterial = new Map();
let selectedArticleId = "";
let searchTimer = null;
let serverOnline = false;
let articleSort = readArticleSort();

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  initialize();
});

function bindElements() {
  [
    "connectionBadge",
    "connectionText",
    "warehouseSelect",
    "storageAppLink",
    "currentUserName",
    "switchUserButton",
    "searchInput",
    "includeInactiveInput",
    "newArticleButton",
    "csvInput",
    "exportLink",
    "resetArticleDataButton",
    "articleStatus",
    "articleCount",
    "articleTableBody",
    "editorTitle",
    "articleForm",
    "materialnummerInput",
    "materialbezeichnungInput",
    "gebindeArtInput",
    "mengeProKartonField",
    "mengeProKartonLabel",
    "mengeProKartonInput",
    "mengeProPaletteInput",
    "artikelgruppeInput",
    "bemerkungInput",
    "aktivInput",
    "deactivateButton",
    "permanentDeleteButton",
    "articleEditorOverlay",
    "closeEditorButton",
    "editorStatus"
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(loadArticles, ARTICLE_SEARCH_DEBOUNCE_MS);
  });
  elements.includeInactiveInput.addEventListener("change", loadArticles);
  elements.newArticleButton.addEventListener("click", () => { selectArticle(null); openEditor(); });
  elements.csvInput.addEventListener("change", importArticleFile);
  elements.resetArticleDataButton.addEventListener("click", resetArticleMasterData);
  elements.articleForm.addEventListener("submit", saveArticle);
  elements.deactivateButton.addEventListener("click", deactivateSelectedArticle);
  elements.permanentDeleteButton.addEventListener("click", permanentlyDeleteSelectedArticle);
  elements.gebindeArtInput.addEventListener("change", updateKrtFieldVisibility);
  elements.switchUserButton.addEventListener("click", switchUser);
  elements.closeEditorButton.addEventListener("click", closeEditor);
  document.querySelectorAll("[data-article-sort]").forEach((button) => {
    button.addEventListener("click", () => changeArticleSort(button.dataset.articleSort));
  });
  elements.articleEditorOverlay.addEventListener("click", (event) => {
    if (event.target === elements.articleEditorOverlay) closeEditor();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.articleEditorOverlay.hidden) closeEditor();
  });
  if (elements.warehouseSelect) {
    elements.warehouseSelect.addEventListener("change", async () => {
      saveCurrentWarehouse();
      selectedArticleId = "";
      selectArticle(null);
      updateExportLink();
      if (serverOnline) await loadArticles();
    });
  }
}

async function initialize() {
  if (!enforceArticleAccess()) return;
  applyWarehouseSelection();
  updateExportLink();
  selectArticle(null);
  try {
    setConnectionStatus(null);
    await apiJson("/api/health");
    serverOnline = true;
    setConnectionStatus(true);
    await loadArticles("");
  } catch {
    serverOnline = false;
    setConnectionStatus(false);
    setStatus("Server nicht verbunden. Artikelstamm ist nicht verfügbar.", "error");
  }
}

function enforceArticleAccess() {
  const userName = localStorage.getItem(USER_KEY) || "";
  const userGroup = localStorage.getItem(USER_GROUP_KEY) || "";
  if (!userName || !userGroup) {
    window.location.replace("/");
    return false;
  }
  if (userGroup === "lager") {
    window.location.replace("/");
    return false;
  }
  if (elements.storageAppLink) {
    elements.storageAppLink.hidden = false;
    elements.storageAppLink.textContent = userGroup === "buero" ? "Buchung" : "Einlagern";
  }
  if (elements.currentUserName) {
    const groupLabel = userGroup === "buero" ? "Büro" : userGroup === "tablet" ? "Tablet" : "";
    elements.currentUserName.textContent = groupLabel ? `${userName} - ${groupLabel}` : userName;
  }
  if (elements.resetArticleDataButton) {
    elements.resetArticleDataButton.hidden = !["buero", "verwaltung"].includes(userGroup);
  }
  return true;
}

function switchUser() {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(USER_GROUP_KEY);
  window.location.replace("/");
}

async function loadArticles(query = null) {
  if (!serverOnline) return;
  try {
    const searchQuery = query ?? elements.searchInput.value.trim();
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    if (elements.includeInactiveInput.checked) params.set("includeInactive", "1");
    const [loadedArticles, locations] = await Promise.all([
      apiJson(`/api/articles${params.toString() ? `?${params}` : ""}`),
      apiJson("/api/storage/locations")
    ]);
    articles = loadedArticles;
    stockTotalsByMaterial = calculateStockTotals(locations);
    renderArticles();
    setStatus("Artikel geladen.", "ok");
  } catch (error) {
    setStatus(`Artikel konnten nicht geladen werden: ${error.message}`, "error");
  }
}

function currentWarehouse() {
  return normalizeWarehouse(localStorage.getItem(WAREHOUSE_KEY));
}

function saveCurrentWarehouse() {
  if (!elements.warehouseSelect) return;
  localStorage.setItem(WAREHOUSE_KEY, normalizeWarehouse(elements.warehouseSelect.value));
}

function applyWarehouseSelection() {
  if (!elements.warehouseSelect) return;
  elements.warehouseSelect.value = currentWarehouse();
}

function updateExportLink() {
  if (!elements.exportLink) return;
  elements.exportLink.href = `/api/articles/export?warehouse=${encodeURIComponent(currentWarehouse())}`;
}

function normalizeWarehouse(value) {
  return String(value || "SSI").trim().toUpperCase() === "SI" ? "SI" : "SSI";
}

function renderArticles() {
  elements.articleTableBody.innerHTML = "";
  elements.articleCount.textContent = `${articles.length} Artikel`;
  updateArticleSortIndicators();

  if (!articles.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7" class="empty-cell">Keine Artikel gefunden.</td>`;
    elements.articleTableBody.appendChild(row);
    return;
  }

  sortedArticlesForDisplay().forEach((article) => {
    const row = document.createElement("tr");
    row.classList.toggle("is-selected", article.id === selectedArticleId);
    row.classList.toggle("is-inactive", !article.aktiv);
    row.innerHTML = `
      <td>${escapeHtml(article.materialnummer)}</td>
      <td>${escapeHtml(article.materialbezeichnung)}</td>
      <td>${escapeHtml(article.gebindeArt || "STK")}</td>
      <td>${supportsPackageQuantity(article.gebindeArt) ? escapeHtml(article.mengeProKarton || "") : ""}</td>
      <td>${escapeHtml(formatPaletteQuantity(article.mengeProPalette))}</td>
      <td>${escapeHtml(stockTotalsByMaterial.get(article.materialnummer) || 0)}</td>
      <td>${article.aktiv ? "Aktiv" : "Inaktiv"}</td>
    `;
    row.addEventListener("click", () => { selectArticle(article); openEditor(); });
    elements.articleTableBody.appendChild(row);
  });
}

function changeArticleSort(key) {
  if (!ARTICLE_SORT_COLUMNS.has(key)) return;
  const sameColumn = articleSort.key === key;
  articleSort = {
    key,
    direction: sameColumn && articleSort.direction === "asc" ? "desc" : "asc"
  };
  writeArticleSort();
  renderArticles();
}

function sortedArticlesForDisplay() {
  return articles.slice().sort((left, right) => {
    const direction = articleSort.direction === "desc" ? -1 : 1;
    const result = compareArticleSortValue(articleSortValue(left, articleSort.key), articleSortValue(right, articleSort.key));
    if (result) return result * direction;
    return compareArticleSortValue(articleSortValue(left, "materialnummer"), articleSortValue(right, "materialnummer"));
  });
}

function articleSortValue(article, key) {
  if (key === "gesamtStueck") return Number(stockTotalsByMaterial.get(article.materialnummer) || 0);
  if (key === "status") return article.aktiv ? "Aktiv" : "Inaktiv";
  if (key === "mengeProKarton") return supportsPackageQuantity(article.gebindeArt) ? sortableNumber(article.mengeProKarton) : null;
  if (key === "mengeProPalette") return sortableNumber(article.mengeProPalette);
  return String(article[key] || "");
}

function compareArticleSortValue(left, right) {
  const leftEmpty = left === null || left === undefined || left === "";
  const rightEmpty = right === null || right === undefined || right === "";
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "de", { numeric: true, sensitivity: "base" });
}

function sortableNumber(value) {
  const number = Number(String(value || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function updateArticleSortIndicators() {
  document.querySelectorAll("[data-article-sort]").forEach((button) => {
    const active = button.dataset.articleSort === articleSort.key;
    button.dataset.sortDirection = active ? articleSort.direction : "";
    button.setAttribute("aria-pressed", active ? "true" : "false");

    const header = button.closest("th");
    if (header) header.setAttribute("aria-sort", active ? (articleSort.direction === "desc" ? "descending" : "ascending") : "none");
  });
}

function readArticleSort() {
  try {
    const saved = JSON.parse(localStorage.getItem(ARTICLE_SORT_KEY) || "{}");
    const key = ARTICLE_SORT_COLUMNS.has(saved.key) ? saved.key : "materialnummer";
    const direction = saved.direction === "desc" ? "desc" : "asc";
    return { key, direction };
  } catch {
    return { key: "materialnummer", direction: "asc" };
  }
}

function writeArticleSort() {
  try {
    localStorage.setItem(ARTICLE_SORT_KEY, JSON.stringify(articleSort));
  } catch {
    // Sorting can still work without persistence.
  }
}

function calculateStockTotals(locations) {
  const totals = new Map();
  locations.forEach((location) => {
    const materialnummer = String(location.materialnummer || "").trim();
    if (!materialnummer) return;
    totals.set(materialnummer, (totals.get(materialnummer) || 0) + (Number(location.mengeStueck) || 0));
  });
  return totals;
}

function selectArticle(article) {
  selectedArticleId = article?.id || "";
  elements.editorTitle.textContent = article ? "Artikel bearbeiten" : "Neuer Artikel";
  elements.materialnummerInput.value = article?.materialnummer || "";
  elements.materialbezeichnungInput.value = article?.materialbezeichnung || "";
  elements.gebindeArtInput.value = article?.gebindeArt || "STK";
  elements.mengeProKartonInput.value = article?.mengeProKarton || "";
  elements.mengeProPaletteInput.value = article?.mengeProPalette || "";
  elements.artikelgruppeInput.value = article?.artikelgruppe || "";
  elements.bemerkungInput.value = article?.bemerkung || "";
  elements.aktivInput.checked = article?.aktiv ?? true;
  elements.deactivateButton.hidden = !article || !article.aktiv;
  elements.permanentDeleteButton.hidden = !article;
  updateKrtFieldVisibility();
  renderArticles();
}

function openEditor() {
  if (!elements.articleEditorOverlay) return;
  elements.articleEditorOverlay.hidden = false;
  setEditorStatus("");
  if (elements.materialnummerInput) elements.materialnummerInput.focus();
}

function closeEditor() {
  if (elements.articleEditorOverlay) elements.articleEditorOverlay.hidden = true;
}

function setEditorStatus(message, type = "") {
  if (!elements.editorStatus) return;
  elements.editorStatus.textContent = message;
  elements.editorStatus.classList.toggle("is-ok", type === "ok");
  elements.editorStatus.classList.toggle("is-error", type === "error");
}

async function saveArticle(event) {
  event.preventDefault();
  if (!serverOnline) return setStatus("Server nicht verbunden.", "error");

  const article = formArticle();
  const endpoint = selectedArticleId ? `/api/articles/${encodeURIComponent(selectedArticleId)}` : "/api/articles";
  const method = selectedArticleId ? "PUT" : "POST";

  try {
    const result = await apiJson(endpoint, { method, body: JSON.stringify({ article }) });
    selectedArticleId = result.article.id;
    setStatus("Artikel gespeichert.", "ok");
    await loadArticles();
    selectArticle(articles.find((entry) => entry.id === selectedArticleId) || result.article);
    closeEditor();
  } catch (error) {
    setStatus(`Speichern fehlgeschlagen: ${error.message}`, "error");
    setEditorStatus(`Speichern fehlgeschlagen: ${error.message}`, "error");
  }
}

async function deactivateSelectedArticle() {
  if (!selectedArticleId) return;
  const article = articles.find((entry) => entry.id === selectedArticleId);
  if (!article) return;
  if (!confirm(`Artikel ${article.materialnummer} deaktivieren?`)) return;

  try {
    const result = await apiJson(`/api/articles/${encodeURIComponent(selectedArticleId)}`, { method: "DELETE" });
    setStatus("Artikel deaktiviert.", "ok");
    await loadArticles();
    selectArticle(result.article);
    closeEditor();
  } catch (error) {
    setStatus(`Deaktivieren fehlgeschlagen: ${error.message}`, "error");
    setEditorStatus(`Deaktivieren fehlgeschlagen: ${error.message}`, "error");
  }
}

async function permanentlyDeleteSelectedArticle() {
  if (!selectedArticleId) return;
  const article = articles.find((entry) => entry.id === selectedArticleId);
  if (!article) return;

  const warning = [
    `Artikel ${article.materialnummer} endgültig löschen?`,
    "",
    "Dabei werden auch aktueller Lagerbestand und die Lagerhistorie zu dieser Materialnummer im gewählten Lager gelöscht.",
    "Diese Aktion kann nicht rückgängig gemacht werden."
  ].join("\n");
  if (!confirm(warning)) return;

  const password = prompt("Passwort für endgültiges Löschen eingeben:");
  if (password === null) return;

  try {
    const result = await apiJson(`/api/articles/${encodeURIComponent(selectedArticleId)}/permanent`, {
      method: "DELETE",
      body: JSON.stringify({ password })
    });
    selectedArticleId = "";
    setStatus(
      `Artikel gelöscht. ${result.stockDeleted || 0} Bestandszeile(n), ${result.movementsDeleted || 0} Historienzeile(n) entfernt.`,
      "ok"
    );
    await loadArticles();
    selectArticle(null);
    closeEditor();
  } catch (error) {
    setStatus(`Löschen fehlgeschlagen: ${error.message}`, "error");
    setEditorStatus(`Löschen fehlgeschlagen: ${error.message}`, "error");
  }
}

async function importArticleFile(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (!files.length) return;

  try {
    setStatus(files.length === 1 ? `Lese ${files[0].name}...` : `Lese ${files.length} Dateien...`);
    const importData = await readArticleImportFiles(files);
    const importedArticles = mergeArticlesByMaterial(importData.articles);
    if (!importedArticles.length) throw new Error("Keine verwertbaren Artikel in der Auswahl gefunden");

    const existingArticles = await loadAllArticles();
    const existingMatches = findExistingArticleMatches(importedArticles, existingArticles);
    const skipExisting = Boolean(existingMatches.length && !confirm(overwriteArticleMessage(existingMatches)));

    const result = await apiJson("/api/articles/import", {
      method: "POST",
      body: JSON.stringify({ articles: importedArticles, skipExisting })
    });
    const importedMaterials = new Set((result.importedMaterials || []).map((materialnummer) => String(materialnummer || "").trim()));
    const existingMaterials = new Set(existingArticles.map((article) => String(article.materialnummer || "").trim()));
    const bookableMaterials = new Set([...existingMaterials, ...importedMaterials]);
    const receiptsToImport = (skipExisting
      ? importData.receipts.filter((receipt) => bookableMaterials.has(String(receipt.materialnummer || "").trim()))
      : importData.receipts
    ).filter(isBookableStorageReceipt);
    let storageResult = { imported: 0, skipped: 0, message: "" };
    let storageError = "";
    let storageVerification = { missing: [], message: "" };
    try {
      storageResult = await importStorageReceipts(receiptsToImport);
    } catch (error) {
      storageError = error.message || "Lagerbuchungen konnten nicht importiert werden";
    }
    if (receiptsToImport.length) {
      try {
        storageVerification = await verifyStorageReceiptsImported(receiptsToImport);
      } catch (error) {
        storageVerification = { missing: [], message: `Pruefung der Lagerbuchungen fehlgeschlagen: ${error.message}` };
      }
    }
    const errorText = result.errors?.length ? ` ${result.errors.length} Zeilen mit Fehlern.` : "";
    const storageText = storageResult.message ? ` ${storageResult.message}` : "";
    const storageErrorText = storageError ? ` Lagerbuchungen nicht komplett importiert: ${storageError}` : "";
    const storageVerificationText = storageVerification.message ? ` ${storageVerification.message}` : "";
    const skippedText = importData.skipped.length ? ` ${importData.skipped.length} Datei(en) ohne verwertbare Daten.` : "";
    const existingText = result.skippedExisting ? ` ${result.skippedExisting} bestehende Artikel uebersprungen.` : "";
    await loadArticles();
    setStatus(
      `${result.created} neu, ${result.updated} aktualisiert.${storageText}${storageErrorText}${storageVerificationText}${existingText}${skippedText}${errorText}`,
      result.errors?.length || storageError || storageVerification.missing?.length ? "error" : "ok"
    );
  } catch (error) {
    await loadArticles().catch(() => {});
    setStatus(`Import fehlgeschlagen: ${error.message}`, "error");
  }
}

async function resetArticleMasterData() {
  if (!serverOnline) return setStatus("Server nicht verbunden.", "error");

  const password = prompt("Passwort zum Loeschen des Artikelstamms eingeben:");
  if (password === null) return;

  const confirmation = prompt("Zum Bestaetigen bitte LOESCHEN eingeben. Auftraege bleiben erhalten.");
  if (confirmation !== "LOESCHEN") {
    setStatus("Zuruecksetzen abgebrochen.", "error");
    return;
  }

  try {
    setStatus("Artikelstamm wird geloescht...");
    const result = await apiJson("/api/articles/reset", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    selectedArticleId = "";
    selectArticle(null);
    await loadArticles("");
    setStatus(
      `Artikelstamm geloescht. Backup: ${result.backupDir || "erstellt"}. Auftraege: ${result.after?.auftraege ?? "unveraendert"}`,
      "ok"
    );
  } catch (error) {
    setStatus(`Zuruecksetzen fehlgeschlagen: ${error.message}`, "error");
  }
}

async function readArticleImportFiles(files) {
  const articles = [];
  const receipts = [];
  const skipped = [];

  for (const file of files) {
    setStatus(`Lese ${file.name}...`);
    const rows = await readArticleRows(file);
    const importData = rowsToArticleImport(rows, file.name);
    if (!importData.articles.length && !importData.receipts.length) {
      skipped.push(file.name);
      continue;
    }
    articles.push(...importData.articles);
    receipts.push(...importData.receipts);
  }

  return { articles, receipts, skipped };
}

function mergeArticlesByMaterial(incoming) {
  const byMaterial = new Map();
  incoming.forEach((article) => {
    const materialnummer = String(article.materialnummer || "").trim();
    if (!materialnummer) return;
    byMaterial.set(materialnummer, article);
  });
  return Array.from(byMaterial.values());
}

function isBookableStorageReceipt(receipt) {
  return (
    String(receipt?.materialnummer || "").trim() &&
    String(receipt?.lagerplatz || "").trim() &&
    Number(receipt?.mengeStueck || 0) > 0
  );
}

async function loadAllArticles() {
  return apiJson("/api/articles?includeInactive=1");
}

function findExistingArticleMatches(incoming, existing) {
  const byMaterial = new Map(existing.map((article) => [String(article.materialnummer || "").trim(), article]));
  return incoming
    .map((article) => byMaterial.get(String(article.materialnummer || "").trim()))
    .filter(Boolean);
}

function overwriteArticleMessage(matches) {
  const preview = matches
    .slice(0, 8)
    .map((article) => `${article.materialnummer} - ${article.materialbezeichnung}`)
    .join("\n");
  const suffix = matches.length > 8 ? `\n... und ${matches.length - 8} weitere` : "";
  return `Es gibt bereits ${matches.length} Artikel aus dieser Datei:\n\n${preview}${suffix}\n\nBestehende Artikel überschreiben?`;
}

async function importStorageReceipts(receipts) {
  if (!receipts.length) return { imported: 0, skipped: 0, message: "" };

  const storageCheck = await inspectStorageReceipts(receipts);
  const duplicateReceipts = storageCheck.duplicates;
  const duplicateKeys = new Set(duplicateReceipts.map(storageReceiptKey));
  const newReceipts = receipts.filter((receipt) => !duplicateKeys.has(storageReceiptKey(receipt)));
  let replaceLegacyBaseLocations = false;

  if (storageCheck.legacyBaseLocations.length) {
    const legacyText = storageCheck.legacyBaseLocations
      .slice(0, 6)
      .map((location) => `${location.materialnummer} | ${location.lagerplatz} | ${location.leNummer} | ${location.mengeStueck}`)
      .join("\n");
    const suffix = storageCheck.legacyBaseLocations.length > 6 ? `\n... und ${storageCheck.legacyBaseLocations.length - 6} weitere` : "";
    if (!confirm(`Es gibt alte Sammelbuchungen, die jetzt in einzelne Paletten aufgeteilt werden können:\n\n${legacyText}${suffix}\n\nAlte Sammelbuchungen ersetzen?`)) {
      throw new Error("Lagerbuchungs-Import abgebrochen");
    }
    replaceLegacyBaseLocations = true;
  }

  if (!newReceipts.length) return { imported: 0, skipped: duplicateReceipts.length, message: `${duplicateReceipts.length} Lagerbuchung(en) bereits vorhanden.` };

  if (replaceLegacyBaseLocations) {
    await apiJson("/api/storage/issues", {
      method: "POST",
      body: JSON.stringify({
        issues: storageCheck.legacyBaseLocations.map((location) => ({
          materialnummer: location.materialnummer,
          lagerplatz: location.lagerplatz,
          leNummer: location.leNummer,
          mengeStueck: location.mengeStueck,
          referenz: "Korrektur Excel-Sammelbuchung"
        }))
      })
    });
  }

  const result = await apiJson("/api/storage/receipts", {
    method: "POST",
    body: JSON.stringify({ receipts: newReceipts })
  });
  return {
    imported: result.movements?.length || 0,
    skipped: duplicateReceipts.length,
    message: `${result.movements?.length || 0} Lagerbuchung(en) importiert.${duplicateReceipts.length ? ` ${duplicateReceipts.length} bereits vorhanden.` : ""}`
  };
}

async function verifyStorageReceiptsImported(receipts) {
  const expected = aggregateStorageReceipts(receipts);
  if (!expected.size) return { missing: [], message: "" };

  const locations = await apiJson("/api/storage/locations");
  const actual = aggregateStorageReceipts(locations.map((location) => ({
    materialnummer: location.materialnummer,
    lagerplatz: location.lagerplatz,
    leNummer: location.leNummer || location.le_nummer,
    mengeStueck: location.mengeStueck || location.menge_stueck,
    paletten: location.paletten
  })));

  const missing = [];
  expected.forEach((entry, key) => {
    const currentQty = actual.get(key)?.mengeStueck || 0;
    const currentPallets = actual.get(key)?.paletten || 0;
    if (currentQty < entry.mengeStueck || currentPallets < entry.paletten) {
      missing.push({
        ...entry,
        currentQty,
        currentPallets,
        missingQty: Math.max(0, entry.mengeStueck - currentQty),
        missingPallets: Math.max(0, entry.paletten - currentPallets)
      });
    }
  });

  if (!missing.length) return { missing, message: "" };

  const preview = missing
    .slice(0, 8)
    .map((entry) => {
      const missingParts = [
        entry.missingQty ? `${entry.missingQty} Stk fehlt` : "",
        entry.missingPallets ? `${entry.missingPallets} Pal. fehlt` : ""
      ].filter(Boolean).join(", ");
      return `Zeile ${entry.importRows.join(", ")}: ${entry.materialnummer} ${entry.lagerplatz} ${entry.leNummer || "-"} (${missingParts})`;
    })
    .join("; ");
  const suffix = missing.length > 8 ? `; ... und ${missing.length - 8} weitere` : "";

  return {
    missing,
    message: `Pruefung: ${missing.length} Lagerzeile(n) fehlen nach Import. ${preview}${suffix}`
  };
}

function aggregateStorageReceipts(receipts) {
  const aggregated = new Map();

  receipts
    .filter(isBookableStorageReceipt)
    .forEach((receipt) => {
      const key = storageReceiptKey(receipt);
      const entry = aggregated.get(key) || {
        materialnummer: String(receipt.materialnummer || "").trim(),
        lagerplatz: String(receipt.lagerplatz || "").trim(),
        leNummer: String(receipt.leNummer || receipt.le_nummer || "").trim(),
        mengeStueck: 0,
        paletten: 0,
        importRows: []
      };
      const mengeStueck = Number(receipt.mengeStueck || receipt.menge_stueck || 0) || 0;
      entry.mengeStueck += mengeStueck;
      entry.paletten += Number(receipt.paletten || 0) || (mengeStueck > 0 ? 1 : 0);
      const importRow = String(receipt.importRow || "").trim();
      if (importRow) entry.importRows.push(importRow);
      aggregated.set(key, entry);
    });

  return aggregated;
}

async function inspectStorageReceipts(receipts) {
  const duplicates = [];
  const legacyBaseLocations = [];
  const legacyKeys = new Set();
  const materials = Array.from(new Set(receipts.map((receipt) => receipt.materialnummer)));
  for (const materialnummer of materials) {
    const existing = await apiJson(`/api/storage/locations?materialnummer=${encodeURIComponent(materialnummer)}`);
    const existingKeys = new Set(existing.map(storageReceiptKey));
    const byLegacyKey = new Map(existing.map((location) => [storageLegacyKey(location), location]));
    receipts
      .filter((receipt) => receipt.materialnummer === materialnummer)
      .forEach((receipt) => {
        if (existingKeys.has(storageReceiptKey(receipt))) duplicates.push(receipt);
        if (!receipt.leNummer) {
          const generatedLocation = existing.find((location) => {
            return (
              String(location.materialnummer || "").trim().toLowerCase() === String(receipt.materialnummer || "").trim().toLowerCase() &&
              String(location.lagerplatz || "").trim().toUpperCase() === String(receipt.lagerplatz || "").trim().toUpperCase() &&
              /^EXCEL-/i.test(String(location.leNummer || location.le_nummer || "").trim())
            );
          });
          const generatedKey = generatedLocation ? storageReceiptKey(generatedLocation) : "";
          if (generatedLocation && !legacyKeys.has(generatedKey)) {
            legacyKeys.add(generatedKey);
            legacyBaseLocations.push(generatedLocation);
          }
        }
        if (receipt.leNummer) {
          const generatedLocation = existing.find((location) => {
            return (
              String(location.materialnummer || "").trim().toLowerCase() === String(receipt.materialnummer || "").trim().toLowerCase() &&
              String(location.lagerplatz || "").trim().toUpperCase() === String(receipt.lagerplatz || "").trim().toUpperCase() &&
              /^EXCEL-/i.test(String(location.leNummer || location.le_nummer || "").trim())
            );
          });
          const generatedKey = generatedLocation ? storageReceiptKey(generatedLocation) : "";
          if (generatedLocation && !legacyKeys.has(generatedKey)) {
            legacyKeys.add(generatedKey);
            legacyBaseLocations.push(generatedLocation);
          }
        }
        if (receipt.originalLe && receipt.originalLe !== receipt.leNummer) {
          const legacyLocation = byLegacyKey.get(storageLegacyKey({ ...receipt, leNummer: receipt.originalLe }));
          const legacyKey = legacyLocation ? storageReceiptKey(legacyLocation) : "";
          if (legacyLocation && !legacyKeys.has(legacyKey)) {
            legacyKeys.add(legacyKey);
            legacyBaseLocations.push(legacyLocation);
          }
        }
      });
  }
  return { duplicates, legacyBaseLocations };
}

function storageReceiptKey(receipt) {
  return [
    String(receipt.materialnummer || "").trim().toLowerCase(),
    String(receipt.lagerplatz || "").trim().toUpperCase(),
    String(receipt.leNummer || receipt.le_nummer || "").trim().toLowerCase()
  ].join("|");
}

function storageLegacyKey(receipt) {
  return [
    String(receipt.materialnummer || "").trim().toLowerCase(),
    String(receipt.lagerplatz || "").trim().toUpperCase(),
    String(receipt.leNummer || receipt.le_nummer || "").trim().toLowerCase()
  ].join("|");
}

async function readArticleRows(file) {
  const buffer = await file.arrayBuffer();
  if (window.XLSX?.read) {
    const workbook = window.XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false
    });
    const rawRows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false
    });
    Object.defineProperty(rows, "rawRows", { value: rawRows });
    return rows;
  }

  const text = new TextDecoder("windows-1252").decode(buffer);
  if (/<table|<tr|<td/i.test(text)) return readHtmlRows(text);
  return parseCsv(text);
}

function readHtmlRows(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return Array.from(doc.querySelectorAll("tr"))
    .map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => cell.textContent.trim()))
    .filter((row) => row.some(Boolean));
}

function rowsToArticleImport(rows, fileName = "") {
  if (!rows.length) return { articles: [], receipts: [] };
  const rawRows = rows.rawRows || rows;
  const cleanedRows = rows
    .map((row, index) => attachSourceRow(row.map((cell) => String(cell ?? "").trim()), index + 1))
    .filter((row) => row.some(Boolean));
  Object.defineProperty(cleanedRows, "rawRows", {
    value: rawRows
      .map((row, index) => attachSourceRow(row.map((cell) => cell ?? ""), index + 1))
      .filter((row) => row.some((cell) => String(cell ?? "").trim()))
  });
  const stockSheetImport = stockSheetToImport(cleanedRows, fileName);
  if (stockSheetImport) return stockSheetImport;
  const stockDetailImport = stockDetailToImport(cleanedRows, fileName);
  if (stockDetailImport) return stockDetailImport;

  const headerIndex = cleanedRows.findIndex((row) => detectArticleColumns(row).score >= 2);
  const header = headerIndex >= 0 ? cleanedRows[headerIndex] : [];
  const columns = detectArticleColumns(header);
  const dataRows = cleanedRows.slice(headerIndex >= 0 ? headerIndex + 1 : 0);
  const defaultMaterial = fileName.match(/\b\d{7}\b/)?.[0] || "";
  const articlesByMaterial = new Map();

  dataRows
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .forEach((row) => {
      const article = rowToArticle(row, columns, defaultMaterial, fileName);
      if (article?.materialnummer) articlesByMaterial.set(article.materialnummer, article);
    });

  return { articles: Array.from(articlesByMaterial.values()), receipts: [] };
}

function attachSourceRow(row, sourceRow) {
  Object.defineProperty(row, "sourceRow", { value: sourceRow });
  return row;
}

function stockSheetToImport(rows, fileName) {
  const rawRows = rows.rawRows || rows;
  const firstRows = rows.slice(0, 8);
  const hasArticleMarker = firstRows.some((row) => row.some((cell) => normalizeHeader(cell) === "artikel"));
  const hasMovementHeader = firstRows.some((row) => row.some((cell) => ["zugang", "abgang", "bestand"].includes(normalizeHeader(cell))));
  if (!hasArticleMarker || !hasMovementHeader) return null;

  const materialnummer = findStockSheetMaterial(rows) || fileName.match(/\b\d{7}\b/)?.[0] || "";
  if (!materialnummer) return null;

  const headerBestand = findStockSheetValue(rows, "bestande", rawRows);
  const headerPaletten = findStockSheetValue(rows, "paletten", rawRows);
  let stockLines = findCurrentStockSheetLines(rows, {
    bestand: headerBestand,
    paletten: headerPaletten
  });
  const foundQuantities = stockLines.map((line) => line.quantity).filter((quantity) => quantity > 0);
  const bestand = headerBestand || sumNumbers(foundQuantities) || 0;
  const paletten = headerPaletten || stockLines.length || 0;
  if (!stockLines.length && bestand > 0) {
    const lastDetailLine = findLastStockSheetDetailLine(rows);
    stockLines = lastDetailLine
      ? [{
        ...lastDetailLine,
        pack: `${Math.max(1, paletten || 1)}x${bestand}`,
        quantity: bestand,
        paletten: Math.max(1, paletten || 1),
        note: "Stellplatz/HU aus letzter Detailzeile uebernommen"
      }]
      : [stockSheetFallbackLine(bestand, paletten)];
  }
  const quantities = stockLines.map((line) => line.quantity).filter((quantity) => quantity > 0);
  const mengeProPalette = bestand > 0
    ? mostFrequentNumber(quantities) || Math.max(1, Math.round(bestand / Math.max(1, paletten)))
    : "";
  const firstLine = stockLines[0] || {};
  const lineText = stockLines
    .map((line) => `${line.quantity} St. ${line.location || ""} ${line.le || ""} ${line.note || ""}`.trim())
    .filter(Boolean)
    .join("; ");

  const article = {
    materialnummer,
    materialbezeichnung: findStockSheetDescription(rows) || materialnummer,
    gebindeArt: "STK",
    mengeProKarton: "",
    mengeProPalette,
    barcode: firstLine.le || "",
    lagerplatz: firstLine.location || "",
    artikelgruppe: "Excel-Lager",
    bemerkung: [`Bestand: ${bestand}`, `Paletten: ${paletten}`, lineText, `Import: ${fileName}`].filter(Boolean).join(" | "),
    aktiv: true
  };
  const receipts = stockLines.map((line) => stockLineReceipt(line, materialnummer, fileName));
  return { articles: [article], receipts };
}

function stockDetailToImport(rows, fileName) {
  const headerIndex = rows.findIndex((row) => detectStockDetailColumns(row).score >= 5);
  if (headerIndex < 0) return null;

  const columns = detectStockDetailColumns(rows[headerIndex]);
  if (columns.material < 0 || columns.quantity < 0 || columns.location < 0 || columns.handlingUnit < 0) return null;

  const articlesByMaterial = new Map();
  const receipts = [];
  const importLabel = /^bestandsdetail\b/i.test(String(fileName || "").trim())
    ? fileName
    : `Bestandsdetail ${fileName}`;

  rows.slice(headerIndex + 1).forEach((row) => {
    const materialnummer = normalizeMaterialNumber(getCell(row, columns.material));
    if (!materialnummer) return;

    const quantity = parseStockNumber(getCell(row, columns.quantity));
    const palletCount = parseStockNumber(getCell(row, columns.pallets)) || (quantity > 0 ? 1 : 0);
    const lagerplatz = normalizeStockDetailStoragePlace(getCell(row, columns.location));
    const leNummer = normalizeHandlingUnitNumber(getCell(row, columns.handlingUnit));
    const description = cleanStockDetailDescription(getCell(row, columns.description), materialnummer);
    const area = getCell(row, columns.area);
    const status = getCell(row, columns.status);
    const reference = [getCell(row, columns.bookingNumber), getCell(row, columns.date), status]
      .filter(Boolean)
      .join(" | ");

    const stats = articlesByMaterial.get(materialnummer) || {
      materialnummer,
      materialbezeichnung: description || materialnummer,
      totalQuantity: 0,
      totalPallets: 0,
      palletQuantities: [],
      firstLocation: "",
      firstLe: "",
      areas: new Set(),
      statuses: new Set()
    };

    if (description && stats.materialbezeichnung === materialnummer) stats.materialbezeichnung = description;
    stats.totalQuantity += quantity;
    stats.totalPallets += palletCount;
    if (quantity > 0) stats.palletQuantities.push(stockDetailPalletQuantity(quantity, palletCount));
    if (!stats.firstLocation && lagerplatz) stats.firstLocation = lagerplatz;
    if (!stats.firstLe && leNummer) stats.firstLe = leNummer;
    if (area) stats.areas.add(area);
    if (status) stats.statuses.add(status);
    articlesByMaterial.set(materialnummer, stats);

    if (!quantity || !lagerplatz) return;
    receipts.push({
      materialnummer,
      lagerplatz,
      leNummer,
      mengeStueck: quantity,
      paletten: Math.max(1, palletCount),
      referenz: [importLabel, reference].filter(Boolean).join(" - "),
      importFile: fileName,
      importRow: row.sourceRow || ""
    });
  });

  if (!articlesByMaterial.size) return null;

  const articles = Array.from(articlesByMaterial.values()).map((stats) => ({
    materialnummer: stats.materialnummer,
    materialbezeichnung: stats.materialbezeichnung,
    gebindeArt: "STK",
    mengeProKarton: "",
    mengeProPalette: stats.totalQuantity > 0 ? mostFrequentNumber(stats.palletQuantities) || "" : "",
    barcode: stats.firstLe,
    lagerplatz: stats.firstLocation,
    artikelgruppe: Array.from(stats.areas).join(", "),
    bemerkung: [
      `Bestand: ${stats.totalQuantity}`,
      `Paletten: ${stats.totalPallets}`,
      stats.statuses.size ? `Status: ${Array.from(stats.statuses).join(", ")}` : "",
      `Import: ${fileName}`
    ].filter(Boolean).join(" | "),
    aktiv: true
  }));

  return { articles, receipts };
}

function detectStockDetailColumns(row) {
  const columns = {
    material: -1,
    description: -1,
    quantity: -1,
    pallets: -1,
    location: -1,
    handlingUnit: -1,
    bookingNumber: -1,
    date: -1,
    supplier: -1,
    status: -1,
    area: -1,
    score: 0
  };

  row.forEach((cell, index) => {
    const token = normalizeToken(cell);
    if (columns.material === -1 && ["artikelnr", "artikelnummer", "materialnummer", "material_nr", "matnr"].includes(token)) columns.material = index;
    if (columns.description === -1 && ["bezeichnung", "artikelbezeichnung", "materialbezeichnung", "beschreibung"].includes(token)) columns.description = index;
    if (columns.quantity === -1 && ["menge", "bestand", "stuck", "stueck", "stueckzahl", "stuckzahl"].includes(token)) columns.quantity = index;
    if (columns.pallets === -1 && ["paletten", "palettenanzahl", "pal_anz", "palanz", "pal"].includes(token)) columns.pallets = index;
    if (columns.location === -1 && ["stellplatz", "lagerplatz", "lagerort", "platz"].includes(token)) columns.location = index;
    if (columns.handlingUnit === -1 && ["lagereinheit", "le", "le_nummer", "hu", "hu_nummer"].includes(token)) columns.handlingUnit = index;
    if (columns.bookingNumber === -1 && ["buchungs_nr", "buchungsnummer", "buchung", "referenz"].includes(token)) columns.bookingNumber = index;
    if (columns.date === -1 && token === "datum") columns.date = index;
    if (columns.supplier === -1 && token === "lieferant") columns.supplier = index;
    if (columns.status === -1 && token === "status") columns.status = index;
    if (columns.area === -1 && ["bereich", "lagerbereich", "artikelgruppe"].includes(token)) columns.area = index;
  });

  columns.score = ["material", "quantity", "location", "handlingUnit", "description", "pallets", "area"].filter(
    (key) => columns[key] >= 0
  ).length;
  return columns;
}

function normalizeMaterialNumber(value) {
  const text = String(value || "").trim();
  if (/^\d{4,7}$/.test(text)) return text;
  const numeric = text.match(/^(\d{4,7})(?:[,.]0+)?$/);
  if (numeric) return numeric[1];
  if (/^\d{7}$/.test(text)) return text;
  return text.match(/\b\d{4,7}\b/)?.[0] || "";
}

function cleanStockDetailDescription(value, materialnummer) {
  const description = String(value || "").trim();
  if (!description || description === materialnummer) return "";
  return description;
}

function normalizeHandlingUnitNumber(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const numeric = text.match(/^(\d{8,10})(?:[,.]0+)?$/);
  if (numeric) return numeric[1];
  const digits = text.replace(/\D/g, "");
  return /^\d{8,10}$/.test(digits) ? digits : "";
}

function stockDetailPalletQuantity(quantity, palletCount) {
  const pallets = Math.max(1, Number(palletCount || 0));
  return Math.max(1, Math.round(quantity / pallets));
}

function stockSheetFallbackLine(bestand, paletten) {
  return {
    pack: `${Math.max(1, paletten || 1)}x${bestand}`,
    quantity: bestand,
    paletten: Math.max(1, paletten || 1),
    location: "KLAERFALL",
    le: "",
    note: "Stellplatz/HU fehlen in Excel"
  };
}

function findLastStockSheetDetailLine(rows) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const locations = findStoragePlaces(rows[index]);
    const handlingUnits = findHandlingUnits(rows[index]);
    if (!locations.length && !handlingUnits.length) continue;

    const location = locations.at(-1) || "";
    const le = handlingUnits.at(-1) || "";
    if (!location && !le) continue;

    return {
      pack: "",
      quantity: 0,
      location,
      le,
      sourceRow: rows[index].sourceRow || index + 1
    };
  }

  return null;
}

function findStockSheetMaterial(rows) {
  for (const row of rows.slice(0, 5)) {
    const articleIndex = row.findIndex((cell) => normalizeHeader(cell) === "artikel");
    if (articleIndex >= 0) {
      const nearby = row.slice(articleIndex + 1).map(String).find((cell) => /^\d{7}$/.test(cell.trim()));
      if (nearby) return nearby.trim();
    }
  }
  return findMaterialNumber(rows.flat());
}

function findStockSheetDescription(rows) {
  for (const row of rows.slice(0, 5)) {
    const materialIndex = row.findIndex((cell) => normalizeToken(cell) === "material");
    if (materialIndex >= 0) {
      const description = row.slice(materialIndex + 1).map(String).map((cell) => cell.trim()).find((cell) => cell.length > 3);
      if (description) return description;
    }
  }
  return "";
}

function findStockSheetValue(rows, key, rawRows = rows) {
  for (let rowIndex = 0; rowIndex < rows.slice(0, 6).length; rowIndex += 1) {
    const row = rows[rowIndex];
    const index = row.findIndex((cell) => normalizeHeader(cell) === key);
    if (index >= 0) {
      const value = row
        .slice(index + 1)
        .map((cell, offset) => parseStockNumber(rawRows[rowIndex]?.[index + 1 + offset] ?? cell))
        .find((amount) => amount > 0);
      if (value) return value;
    }
  }
  return 0;
}

function findCurrentStockSheetLines(rows, { bestand = 0, paletten = 0 } = {}) {
  const columns = detectStockSheetMovementColumns(rows);
  if (!columns) return findCurrentStockSheetLinesFromTail(rows, { bestand, paletten });

  const detailLines = rows
    .slice(columns.startIndex)
    .flatMap((row) => stockSheetDetailRowToLines(row, columns.detailStart));

  return detailLines.length ? reconcileStockSheetLines(detailLines, { bestand, paletten }) : findCurrentStockSheetLinesFromTail(rows, { bestand, paletten });
}

function findCurrentStockSheetLinesFromTail(rows, { bestand = 0, paletten = 0 } = {}) {
  const currentLines = [];
  let totalQuantity = 0;
  let totalPallets = 0;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const rowLines = stockSheetRowToLines(rows[index]);
    if (!rowLines.length) continue;

    currentLines.unshift(...rowLines);
    totalQuantity += sumNumbers(rowLines.map((line) => line.quantity));
    totalPallets += rowLines.length;

    if (bestand > 0 && totalQuantity >= bestand && (!paletten || totalPallets >= paletten)) break;
    if (!bestand && paletten > 0 && totalPallets >= paletten) break;
  }

  return currentLines;
}

function detectStockSheetMovementColumns(rows) {
  const headerIndex = rows
    .slice(0, 12)
    .findIndex((row) => row.some((cell) => normalizeToken(cell) === "zugang") && row.some((cell) => normalizeToken(cell) === "abgang"));
  if (headerIndex < 0) return null;

  const header = rows[headerIndex];
  const accessColumns = [];
  const issueColumns = [];
  const balanceColumns = [];
  header.forEach((cell, index) => {
    const token = normalizeToken(cell);
    if (token === "zugang") accessColumns.push(index);
    if (token === "abgang") issueColumns.push(index);
    if (token === "bestand") balanceColumns.push(index);
  });

  return {
    startIndex: headerIndex + 1,
    quantityAccess: accessColumns[0] ?? 1,
    quantityIssue: issueColumns[0] ?? 2,
    quantityBalance: balanceColumns[0] ?? 4,
    palletAccess: accessColumns[1] ?? 5,
    palletIssue: issueColumns[1] ?? 6,
    palletBalance: balanceColumns[1] ?? 7,
    detailStart: Math.max(balanceColumns[1] ?? 7, issueColumns[1] ?? 6, accessColumns[1] ?? 5) + 1
  };
}

function reconcileStockSheetLines(lines, { bestand = 0, paletten = 0 } = {}) {
  const activeLines = lines.filter((line) => line.quantity > 0);
  if (!activeLines.length) return activeLines;

  const currentTotal = sumNumbers(activeLines.map((line) => line.quantity));
  const difference = bestand > 0 ? bestand - currentTotal : 0;
  const canAdjust =
    difference !== 0 &&
    Math.abs(difference) <= Math.max(1000, Math.round((bestand || currentTotal) * 0.05)) &&
    activeLines.at(-1).quantity + difference > 0;
  if (canAdjust) activeLines.at(-1).quantity += difference;

  if (paletten > 0 && activeLines.length > paletten) return activeLines.slice(-paletten);
  return activeLines;
}

function stockSheetDetailRowToLines(row, detailStart) {
  const detailCells = row.slice(detailStart).map(String);
  const lines = [];

  for (let index = 0; index < detailCells.length; index += 1) {
    const pack = parsePack(detailCells[index]);
    if (!pack.quantity) continue;

    const cellsUntilNextPack = [];
    for (let next = index + 1; next < detailCells.length; next += 1) {
      if (parsePack(detailCells[next]).quantity) break;
      cellsUntilNextPack.push(detailCells[next]);
    }

    const locations = findStoragePlaces(cellsUntilNextPack);
    const handlingUnits = findHandlingUnits(cellsUntilNextPack);
    const count = Math.max(pack.count, locations.length || 0, handlingUnits.length || 0, 1);

    for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
      const location = locations[itemIndex] || locations[0] || "";
      if (!location) continue;
      lines.push({
        pack: `${pack.count}x${pack.quantity}`,
        quantity: pack.quantity,
        paletten: 1,
        location,
        le: handlingUnits[itemIndex] || handlingUnits[0] || "",
        sourceRow: row.sourceRow
      });
    }
  }

  return lines;
}

function stockSheetRowToLines(row) {
  const pack = row.map(String).find((cell) => /^\s*\d+\s*x\s*\d+\s*$/i.test(cell.trim())) || "";
  const parsedPack = parsePack(pack);
  const locations = findStoragePlaces(row);
  if (!parsedPack.quantity || !locations.length) return [];

  return locations.map((location) => ({
    pack: pack.replace(/\s+/g, ""),
    quantity: parsedPack.quantity,
    paletten: 1,
    location,
    sourceRow: row.sourceRow
  }));
}

function parsePack(value) {
  const match = String(value || "").match(/^\s*(\d+)\s*x\s*(\d+)\s*$/i);
  return match ? { count: parsePositiveInteger(match[1]) || 1, quantity: parsePositiveInteger(match[2]) } : { count: 1, quantity: 0 };
}

function stockLineReceipt(line, materialnummer, fileName) {
  return {
    materialnummer,
    lagerplatz: line.location,
    leNummer: line.le || "",
    mengeStueck: line.quantity,
    paletten: Math.max(1, Number(line.paletten || 0)),
    referenz: [`Excel-Import ${fileName}`, line.note].filter(Boolean).join(" - "),
    importFile: fileName,
    importRow: line.sourceRow || ""
  };
}

function mostFrequentNumber(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 0;
}

function sumNumbers(values) {
  return values.reduce((sum, value) => sum + value, 0);
}

function formatPaletteQuantity(value) {
  const amount = Number(value || 0);
  return amount > 0 ? String(amount) : "";
}

function rowToArticle(row, columns, defaultMaterial, fileName) {
  const materialnummer = getCell(row, columns.material) || findMaterialNumber(row) || defaultMaterial;
  if (!materialnummer) return null;

  const materialbezeichnung = getCell(row, columns.description) || findArticleDescription(row, columns) || materialnummer;
  const gebindeArt = normalizeGebindeArt(getCell(row, columns.package));
  const mengeProKarton = parsePositiveInteger(getCell(row, columns.cartonQuantity));
  const mengeProPalette =
    parsePositiveInteger(getCell(row, columns.paletteQuantity)) ||
    parsePositiveInteger(getCell(row, columns.quantity)) ||
    findPositiveInteger(row, materialnummer) ||
    1;
  const bemerkung = [getCell(row, columns.note), detectMovementText(row, columns), `Import: ${fileName}`].filter(Boolean).join(" | ");

  return {
    materialnummer,
    materialbezeichnung,
    gebindeArt,
    mengeProKarton: supportsPackageQuantity(gebindeArt) ? mengeProKarton || "" : "",
    mengeProPalette,
    barcode: getCell(row, columns.barcode),
    lagerplatz: getCell(row, columns.location) || findStoragePlace(row),
    artikelgruppe: getCell(row, columns.group),
    bemerkung,
    aktiv: parseActive(getCell(row, columns.active))
  };
}

function detectArticleColumns(row) {
  const columns = {
    material: -1,
    description: -1,
    package: -1,
    cartonQuantity: -1,
    paletteQuantity: -1,
    quantity: -1,
    barcode: -1,
    location: -1,
    group: -1,
    note: -1,
    active: -1,
    movement: -1,
    score: 0
  };

  row.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (columns.material === -1 && key === "materialnummer") columns.material = index;
    if (columns.description === -1 && key === "materialbezeichnung") columns.description = index;
    if (columns.package === -1 && key === "gebinde") columns.package = index;
    if (columns.cartonQuantity === -1 && key === "menge_pro_karton") columns.cartonQuantity = index;
    if (columns.paletteQuantity === -1 && key === "menge_pro_palette") columns.paletteQuantity = index;
    if (columns.quantity === -1 && key === "menge") columns.quantity = index;
    if (columns.barcode === -1 && key === "barcode") columns.barcode = index;
    if (columns.location === -1 && key === "lagerplatz") columns.location = index;
    if (columns.group === -1 && key === "artikelgruppe") columns.group = index;
    if (columns.note === -1 && key === "bemerkung") columns.note = index;
    if (columns.active === -1 && key === "aktiv") columns.active = index;
    if (columns.movement === -1 && key === "bewegung") columns.movement = index;
  });

  columns.score = ["material", "description", "paletteQuantity", "quantity", "location", "barcode"].filter(
    (key) => columns[key] >= 0
  ).length;
  return columns;
}

function getCell(row, index) {
  return index >= 0 ? String(row[index] || "").trim() : "";
}

function findMaterialNumber(row) {
  return row
    .map(String)
    .map((cell) => cell.trim())
    .find((cell) => /^\d{7}$/.test(cell)) || "";
}

function findArticleDescription(row, columns) {
  return row
    .map((cell, index) => ({ cell: String(cell || "").trim(), index }))
    .filter(({ cell, index }) => {
      if (!cell || cell.length < 3) return false;
      if (
        [
          columns.material,
          columns.package,
          columns.cartonQuantity,
          columns.paletteQuantity,
          columns.quantity,
          columns.barcode,
          columns.location,
          columns.group,
          columns.note,
          columns.active,
          columns.movement
        ].includes(index)
      ) {
        return false;
      }
      if (/^\d+$/.test(cell)) return false;
      if (normalizeStoragePlace(cell)) return false;
      return true;
    })
    .map(({ cell }) => cell)
    .join(" ")
    .slice(0, 160);
}

function normalizeGebindeArt(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ["C1", "C2", "A1", "KRT", "STK"].includes(normalized) ? normalized : "STK";
}

function parsePositiveInteger(value) {
  const normalized = String(value || "").replace(/\./g, "").replace(",", ".").trim();
  const amount = Number(normalized);
  return Number.isInteger(amount) && amount > 0 ? amount : 0;
}

function parseStockNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const text = String(value || "").trim();
  if (!text) return 0;
  const normalized = /^\d{1,3},\d{3}$/.test(text)
    ? text.replace(",", "")
    : text.replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}

function findPositiveInteger(row, materialnummer) {
  return row
    .map(String)
    .map((cell) => cell.trim())
    .map((cell) => ({ cell, amount: parsePositiveInteger(cell) }))
    .find(({ cell, amount }) => amount > 0 && cell !== materialnummer && !/^\d{8,10}$/.test(cell))?.amount || 0;
}

function findStoragePlace(row) {
  return row.map(String).map(normalizeStoragePlace).find(Boolean) || "";
}

function findStoragePlaces(row) {
  return row.map(String).map(normalizeStoragePlace).filter(Boolean);
}

function findHandlingUnits(row) {
  return row
    .map(String)
    .map((cell) => cell.replace(/\D/g, ""))
    .filter((cell) => /^\d{8,10}$/.test(cell));
}

function normalizeStockDetailStoragePlace(value) {
  return normalizeStoragePlace(value) || normalizeLooseStockDetailStoragePlace(value);
}

function normalizeLooseStockDetailStoragePlace(value) {
  if (/^\s*\d+\s*x\s*\d+\s*$/i.test(String(value || ""))) return "";
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[-_/\u2010-\u2015]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) return "";

  if (/^H\s*\d{1,2}(?:\s+[A-Z]{1,3}\s*\d{0,3})?$/.test(normalized)) {
    return normalized.replace(/\b([A-Z])\s*(\d{1,3})\b/g, "$1 $2").replace(/\s+/g, " ").trim();
  }

  if (/^[A-Z]{1,3}$/.test(normalized)) return normalized;
  if (/^[A-Z]{1,3}\s+\d{1,3}(?:\s+[A-Z]\s*\d{1,3})?$/.test(normalized)) {
    return normalized.replace(/\b([A-Z])\s*(\d{1,3})\b/g, "$1 $2").replace(/\s+/g, " ").trim();
  }

  return "";
}

function normalizeStoragePlace(value) {
  if (/^\s*\d+\s*x\s*\d+\s*$/i.test(String(value || ""))) return "";
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[-_/\u2010-\u2015]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) return "";
  const rackPlace = normalized.match(/^(?:002\s+)?H\s*([25])\s+R\s*(\d{1,3})$/);
  if (rackPlace) return `002-H${rackPlace[1]}-R${Number(rackPlace[2])}`;
  const existingCanonical = normalized.match(/^002\s+(H[1347])\s+S\s*(.+)$/);
  if (existingCanonical) {
    const suffix = formatStoragePlaceSuffix(existingCanonical[2].split(" "));
    if (!/[A-Z]/.test(suffix)) return "";
    return suffix ? `002-${existingCanonical[1]}-S${suffix}` : "";
  }
  const compactAreaPlace = normalized.match(/^(\d{1,3})([A-Z])(\d{1,3})$/);
  if (compactAreaPlace) return canonicalStoragePlace(compactAreaPlace.slice(1));
  return canonicalStoragePlace(normalized.split(" ").filter(Boolean));
}

function canonicalStoragePlace(tokens) {
  const cleanTokens = tokens.map(formatStoragePlaceToken).filter(Boolean);
  if (!isStoragePlaceShape(cleanTokens)) return "";

  const area = cleanTokens[0];
  const hall = storageHallForArea(area);
  if (!hall) return "";

  const suffix = formatStoragePlaceSuffix(cleanTokens);
  return suffix ? `002-${hall}-S${suffix}` : "";
}

function isStoragePlaceShape(tokens) {
  if (tokens.length < 3) return false;
  const [area, second, third] = tokens;
  if (/^\d{1,3}$/.test(area)) return /^[A-Z]$/.test(second) && /^\d{1,3}$/.test(third);
  if (/^[A-Z]$/.test(area) || /^A[A-Z]$/.test(area)) {
    if (tokens.length === 3) return tokens.slice(1).every((token) => /^\d{1,3}$/.test(token));
    if (tokens.length === 4) return /^\d{1,3}$/.test(second) && /^[A-Z]$/.test(third) && /^\d{1,3}$/.test(tokens[3]);
  }
  return false;
}

function storageHallForArea(area) {
  const numericArea = parsePositiveInteger(area);
  if (numericArea >= 1 && numericArea <= 69) return "H7";
  if (/^[A-Z]$/.test(area) && area >= "A" && area <= "N") return "H4";
  if (/^[A-Z]$/.test(area) && area >= "O" && area <= "Z") return "H3";
  if (/^A[A-Z]$/.test(area)) return "H1";
  return "";
}

function formatStoragePlaceToken(token) {
  return String(token || "").trim().toUpperCase();
}

function formatStoragePlaceSuffix(tokens) {
  return tokens.map(formatStoragePlaceToken).filter(Boolean).join("");
}

function detectMovementText(row, columns) {
  const value = getCell(row, columns.movement);
  if (!value) return "";
  return `Bewegung: ${value}`;
}

function parseActive(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return true;
  return !["0", "nein", "no", "false", "inaktiv"].includes(normalized);
}

function parseCsv(text) {
  const delimiter = chooseDelimiter(text);
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function chooseDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons >= commas ? ";" : ",";
}

function normalizeHeader(value) {
  const text = normalizeToken(value);

  const aliases = {
    material: "materialnummer",
    material_nr: "materialnummer",
    materialnummer: "materialnummer",
    mat_nr: "materialnummer",
    matnr: "materialnummer",
    art_nr: "materialnummer",
    artnr: "materialnummer",
    nr: "materialnummer",
    artikelnummer: "materialnummer",
    bezeichnung: "materialbezeichnung",
    beschreibung: "materialbezeichnung",
    artikelbezeichnung: "materialbezeichnung",
    materialbezeichnung: "materialbezeichnung",
    gebinde_art: "gebinde",
    verpackung: "gebinde",
    einheit: "gebinde",
    menge_karton: "menge_pro_karton",
    kartonmenge: "menge_pro_karton",
    menge_krt: "menge_pro_karton",
    menge_pro_krt: "menge_pro_karton",
    menge_palette: "menge_pro_palette",
    menge_pro_pal: "menge_pro_palette",
    palettenmenge: "menge_pro_palette",
    menge: "menge",
    bestand: "menge",
    anzahl: "menge",
    stk: "menge",
    stueck: "menge",
    stuck: "menge",
    ean: "barcode",
    barcode: "barcode",
    lagerort: "lagerplatz",
    stellplatz: "lagerplatz",
    platz: "lagerplatz",
    lagerplatz: "lagerplatz",
    artikelgruppe: "artikelgruppe",
    gruppe: "artikelgruppe",
    bemerkung: "bemerkung",
    notiz: "bemerkung",
    aktiv: "aktiv",
    bewegung: "bewegung",
    bewegungsart: "bewegung"
  };
  return aliases[text] || text;
}

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function formArticle() {
  return {
    materialnummer: elements.materialnummerInput.value,
    materialbezeichnung: elements.materialbezeichnungInput.value,
    gebindeArt: elements.gebindeArtInput.value,
    mengeProKarton: supportsPackageQuantity(elements.gebindeArtInput.value) ? elements.mengeProKartonInput.value : "",
    mengeProPalette: elements.mengeProPaletteInput.value,
    artikelgruppe: elements.artikelgruppeInput.value,
    bemerkung: elements.bemerkungInput.value,
    aktiv: elements.aktivInput.checked
  };
}

function updateKrtFieldVisibility() {
  const gebindeArt = elements.gebindeArtInput.value;
  const showQuantity = supportsPackageQuantity(gebindeArt);
  const needsQuantity = requiresPackageQuantity(gebindeArt);
  elements.mengeProKartonField.hidden = !showQuantity;
  elements.mengeProKartonInput.required = needsQuantity;
  if (elements.mengeProKartonLabel) elements.mengeProKartonLabel.textContent = `Menge pro ${gebindeArt}`;
  if (!showQuantity) elements.mengeProKartonInput.value = "";
}

function requiresPackageQuantity(gebindeArt) {
  return String(gebindeArt || "").trim().toUpperCase() === "KRT";
}

function supportsPackageQuantity(gebindeArt) {
  return ["KRT", "A1"].includes(String(gebindeArt || "").trim().toUpperCase());
}

async function apiJson(url, options = {}) {
  const userGroup = localStorage.getItem(USER_GROUP_KEY) || "";
  const warehouse = currentWarehouse();
  const { headers: extraHeaders, ...rest } = options;
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      "Content-Type": "application/json",
      "X-User-Group": userGroup,
      "X-Warehouse": warehouse,
      ...extraHeaders,
    },
    ...rest,
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : { error: (await response.text()).trim() };
  if (!response.ok || data.ok === false) throw new Error(data.error || "Serverfehler");
  return data;
}

function setConnectionStatus(isOnline) {
  elements.connectionBadge.classList.toggle("is-online", isOnline === true);
  elements.connectionBadge.classList.toggle("is-offline", isOnline === false);
  elements.connectionBadge.classList.toggle("is-checking", isOnline === null);
  elements.connectionText.textContent = isOnline === true ? "Online" : isOnline === false ? "Offline" : "Prüfe Verbindung";
}

function setStatus(message, type = "") {
  elements.articleStatus.textContent = message;
  elements.articleStatus.classList.toggle("is-ok", type === "ok");
  elements.articleStatus.classList.toggle("is-error", type === "error");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
