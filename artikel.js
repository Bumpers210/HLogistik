const API_BASE = "";
const ARTICLE_SEARCH_DEBOUNCE_MS = 200;
const USER_KEY = "kommissionier-app-user-v1";
const USER_GROUP_KEY = "kommissionier-app-user-group-v1";

const elements = {};
let articles = [];
let stockTotalsByMaterial = new Map();
let selectedArticleId = "";
let searchTimer = null;
let serverOnline = false;

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  initialize();
});

function bindElements() {
  [
    "connectionBadge",
    "connectionText",
    "storageAppLink",
    "currentUserName",
    "switchUserButton",
    "searchInput",
    "includeInactiveInput",
    "newArticleButton",
    "csvInput",
    "exportLink",
    "articleStatus",
    "articleCount",
    "articleTableBody",
    "editorTitle",
    "articleForm",
    "materialnummerInput",
    "materialbezeichnungInput",
    "gebindeArtInput",
    "mengeProKartonField",
    "mengeProKartonInput",
    "mengeProPaletteInput",
    "artikelgruppeInput",
    "bemerkungInput",
    "aktivInput",
    "deactivateButton"
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
  elements.newArticleButton.addEventListener("click", () => selectArticle(null));
  elements.csvInput.addEventListener("change", importArticleFile);
  elements.articleForm.addEventListener("submit", saveArticle);
  elements.deactivateButton.addEventListener("click", deactivateSelectedArticle);
  elements.gebindeArtInput.addEventListener("change", updateKrtFieldVisibility);
  elements.switchUserButton.addEventListener("click", switchUser);
}

async function initialize() {
  if (!enforceArticleAccess()) return;
  selectArticle(null);
  try {
    setConnectionStatus(null);
    await apiJson("/api/health");
    serverOnline = true;
    setConnectionStatus(true);
    await loadArticles();
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
  return true;
}

function switchUser() {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(USER_GROUP_KEY);
  window.location.replace("/");
}

async function loadArticles() {
  if (!serverOnline) return;
  try {
    const params = new URLSearchParams();
    const query = elements.searchInput.value.trim();
    if (query) params.set("q", query);
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

function renderArticles() {
  elements.articleTableBody.innerHTML = "";
  elements.articleCount.textContent = `${articles.length} Artikel`;

  if (!articles.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7" class="empty-cell">Keine Artikel gefunden.</td>`;
    elements.articleTableBody.appendChild(row);
    return;
  }

  articles.forEach((article) => {
    const row = document.createElement("tr");
    row.classList.toggle("is-selected", article.id === selectedArticleId);
    row.classList.toggle("is-inactive", !article.aktiv);
    row.innerHTML = `
      <td>${escapeHtml(article.materialnummer)}</td>
      <td>${escapeHtml(article.materialbezeichnung)}</td>
      <td>${escapeHtml(article.gebindeArt || "STK")}</td>
      <td class="num">${article.gebindeArt === "KRT" ? escapeHtml(article.mengeProKarton) : ""}</td>
      <td class="num">${escapeHtml(article.mengeProPalette)}</td>
      <td class="num">${escapeHtml(stockTotalsByMaterial.get(article.materialnummer) || 0)}</td>
      <td>${article.aktiv ? "Aktiv" : "Inaktiv"}</td>
    `;
    row.addEventListener("click", () => selectArticle(article));
    elements.articleTableBody.appendChild(row);
  });
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
  updateKrtFieldVisibility();
  renderArticles();
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
  } catch (error) {
    setStatus(`Speichern fehlgeschlagen: ${error.message}`, "error");
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
  } catch (error) {
    setStatus(`Deaktivieren fehlgeschlagen: ${error.message}`, "error");
  }
}

async function importArticleFile(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;

  try {
    setStatus(`Lese ${file.name}...`);
    const rows = await readArticleRows(file);
    const importData = rowsToArticleImport(rows, file.name);
    const importedArticles = importData.articles;
    if (!importedArticles.length) throw new Error("Keine verwertbaren Artikel in der Datei gefunden");

    const existingArticles = await loadAllArticles();
    const existingMatches = findExistingArticleMatches(importedArticles, existingArticles);
    if (existingMatches.length && !confirm(overwriteArticleMessage(existingMatches))) {
      setStatus("Import abgebrochen. Bestehende Artikel wurden nicht überschrieben.", "error");
      return;
    }

    const result = await apiJson("/api/articles/import", {
      method: "POST",
      body: JSON.stringify({ articles: importedArticles })
    });
    const storageResult = await importStorageReceipts(importData.receipts);
    const errorText = result.errors?.length ? ` ${result.errors.length} Zeilen mit Fehlern.` : "";
    const storageText = storageResult.message ? ` ${storageResult.message}` : "";
    setStatus(`${result.created} neu, ${result.updated} aktualisiert.${storageText}${errorText}`, result.errors?.length ? "error" : "ok");
    await loadArticles();
  } catch (error) {
    setStatus(`Import fehlgeschlagen: ${error.message}`, "error");
  }
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

  if (duplicateReceipts.length) {
    const duplicateText = duplicateReceipts
      .slice(0, 6)
      .map((receipt) => `${receipt.materialnummer} | ${receipt.lagerplatz} | ${receipt.leNummer}`)
      .join("\n");
    const suffix = duplicateReceipts.length > 6 ? `\n... und ${duplicateReceipts.length - 6} weitere` : "";
    if (!newReceipts.length) {
      throw new Error(`Diese Lagerbuchungen sind bereits vorhanden und werden nicht doppelt importiert:\n${duplicateText}${suffix}`);
    }
    if (!confirm(`Es gibt bereits ${duplicateReceipts.length} Lagerbuchung(en):\n\n${duplicateText}${suffix}\n\nDiese überspringen und nur neue Lagerbuchungen importieren?`)) {
      throw new Error("Lagerbuchungs-Import abgebrochen");
    }
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
    return window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false
    });
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
  const cleanedRows = rows
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some(Boolean));
  const stockSheetImport = stockSheetToImport(cleanedRows, fileName);
  if (stockSheetImport) return stockSheetImport;

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

function stockSheetToImport(rows, fileName) {
  const firstRows = rows.slice(0, 8);
  const hasArticleMarker = firstRows.some((row) => row.some((cell) => normalizeHeader(cell) === "artikel"));
  const hasMovementHeader = firstRows.some((row) => row.some((cell) => ["zugang", "abgang", "bestand"].includes(normalizeHeader(cell))));
  if (!hasArticleMarker || !hasMovementHeader) return null;

  const materialnummer = findStockSheetMaterial(rows) || fileName.match(/\b\d{7}\b/)?.[0] || "";
  if (!materialnummer) return null;

  const stockLines = findStockSheetLines(rows);
  const quantities = stockLines.map((line) => line.quantity).filter((quantity) => quantity > 0);
  const bestand = findStockSheetValue(rows, "bestande") || sumNumbers(quantities) || findPositiveInteger(rows.flat(), materialnummer) || 1;
  const paletten = findStockSheetValue(rows, "paletten") || stockLines.length || 1;
  const mengeProPalette = mostFrequentNumber(quantities) || Math.max(1, Math.round(bestand / Math.max(1, paletten)));
  const firstLine = stockLines[0] || {};
  const lineText = stockLines
    .map((line) => `${line.pack || `${line.quantity} St.`} ${line.location || ""} ${line.le || ""}`.trim())
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
  const receipts = stockLines.flatMap((line) => splitStockLineReceipts(line, materialnummer, fileName));
  return { articles: [article], receipts };
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

function findStockSheetValue(rows, key) {
  for (const row of rows.slice(0, 6)) {
    const index = row.findIndex((cell) => normalizeHeader(cell) === key);
    if (index >= 0) {
      const value = row.slice(index + 1).map(parsePositiveInteger).find((amount) => amount > 0);
      if (value) return value;
    }
  }
  return 0;
}

function findStockSheetLines(rows) {
  return rows
    .map((row) => {
      const pack = row.map(String).find((cell) => /^\s*\d+\s*x\s*\d+\s*$/i.test(cell.trim())) || "";
      const parsedPack = parsePack(pack);
      const quantity = parsedPack.quantity;
      const location = findStoragePlace(row);
      const le = row
        .map(String)
        .map((cell) => cell.trim())
        .find((cell) => /^\d{8,10}$/.test(cell)) || "";
      if (!quantity || !location || !le) return null;
      return { pack: pack.replace(/\s+/g, ""), palletCount: parsedPack.count, quantity, location, le };
    })
    .filter(Boolean);
}

function parsePack(value) {
  const match = String(value || "").match(/^\s*(\d+)\s*x\s*(\d+)\s*$/i);
  return match ? { count: parsePositiveInteger(match[1]) || 1, quantity: parsePositiveInteger(match[2]) } : { count: 1, quantity: 0 };
}

function splitStockLineReceipts(line, materialnummer, fileName) {
  const palletCount = Math.max(1, line.palletCount || 1);
  const quantities = distributeQuantity(line.quantity, palletCount);
  return quantities.map((mengeStueck, index) => ({
    materialnummer,
    lagerplatz: line.location,
    leNummer: palletCount > 1 ? `${line.le}/${index + 1}` : line.le,
    originalLe: line.le,
    mengeStueck,
    referenz: `Excel-Import ${fileName}`
  }));
}

function distributeQuantity(quantity, count) {
  const total = Number(quantity) || 0;
  const safeCount = Math.max(1, Number(count) || 1);
  const base = Math.floor(total / safeCount);
  const remainder = total % safeCount;
  return Array.from({ length: safeCount }, (_unused, index) => base + (index < remainder ? 1 : 0)).filter((amount) => amount > 0);
}

function mostFrequentNumber(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 0;
}

function sumNumbers(values) {
  return values.reduce((sum, value) => sum + value, 0);
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
    mengeProKarton: gebindeArt === "KRT" ? mengeProKarton || 1 : "",
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
  return ["C1", "C2", "KRT", "STK"].includes(normalized) ? normalized : "STK";
}

function parsePositiveInteger(value) {
  const normalized = String(value || "").replace(/\./g, "").replace(",", ".").trim();
  const amount = Number(normalized);
  return Number.isInteger(amount) && amount > 0 ? amount : 0;
}

function findPositiveInteger(row, materialnummer) {
  return row
    .map(String)
    .map((cell) => cell.trim())
    .map((cell) => ({ cell, amount: parsePositiveInteger(cell) }))
    .find(({ cell, amount }) => amount > 0 && cell !== materialnummer && !/^\d{8,10}$/.test(cell))?.amount || 0;
}

function findStoragePlace(row) {
  return row.map(String).find((cell) => normalizeStoragePlace(cell)) || "";
}

function normalizeStoragePlace(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ");
  return /^[A-Z]{1,3}\s+\d{1,3}\s+[A-Z]\s+\d{1,3}$/.test(normalized) ? normalized : "";
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
    mengeProKarton: elements.gebindeArtInput.value === "KRT" ? elements.mengeProKartonInput.value : "",
    mengeProPalette: elements.mengeProPaletteInput.value,
    artikelgruppe: elements.artikelgruppeInput.value,
    bemerkung: elements.bemerkungInput.value,
    aktiv: elements.aktivInput.checked
  };
}

function updateKrtFieldVisibility() {
  const isKrt = elements.gebindeArtInput.value === "KRT";
  elements.mengeProKartonField.hidden = !isKrt;
  elements.mengeProKartonInput.required = isKrt;
  if (!isKrt) elements.mengeProKartonInput.value = "";
}

async function apiJson(url, options = {}) {
  const userGroup = localStorage.getItem(USER_GROUP_KEY) || "";
  const { headers: extraHeaders, ...rest } = options;
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      "Content-Type": "application/json",
      "X-User-Group": userGroup,
      ...extraHeaders,
    },
    ...rest,
  });
  const data = await response.json();
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
