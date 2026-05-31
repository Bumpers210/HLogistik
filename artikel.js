const API_BASE = "";
const ARTICLE_SEARCH_DEBOUNCE_MS = 200;
const USER_KEY = "kommissionier-app-user-v1";
const USER_GROUP_KEY = "kommissionier-app-user-group-v1";

const elements = {};
let articles = [];
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
  elements.csvInput.addEventListener("change", importCsv);
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
    articles = await apiJson(`/api/articles${params.toString() ? `?${params}` : ""}`);
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
    row.innerHTML = `<td colspan="6" class="empty-cell">Keine Artikel gefunden.</td>`;
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
      <td>${article.aktiv ? "Aktiv" : "Inaktiv"}</td>
    `;
    row.addEventListener("click", () => selectArticle(article));
    elements.articleTableBody.appendChild(row);
  });
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

async function importCsv(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = parseCsv(text);
    const importedArticles = rowsToArticles(parsed);
    if (!importedArticles.length) throw new Error("Keine verwertbaren Artikel in der CSV gefunden");
    const result = await apiJson("/api/articles/import", {
      method: "POST",
      body: JSON.stringify({ articles: importedArticles })
    });
    const errorText = result.errors?.length ? ` ${result.errors.length} Zeilen mit Fehlern.` : "";
    setStatus(`${result.created} neu, ${result.updated} aktualisiert.${errorText}`, result.errors?.length ? "error" : "ok");
    await loadArticles();
  } catch (error) {
    setStatus(`Import fehlgeschlagen: ${error.message}`, "error");
  }
}

function rowsToArticles(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(normalizeHeader);
  return rows.slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row) => {
      const entry = {};
      row.forEach((cell, index) => {
        entry[header[index]] = cell;
      });
      return {
        materialnummer: entry.materialnummer,
        materialbezeichnung: entry.materialbezeichnung,
        gebindeArt: entry.gebinde || entry.gebindeart || "STK",
        mengeProKarton: entry.menge_pro_krt || entry.menge_pro_karton,
        mengeProPalette: entry.menge_pro_palette,
        barcode: entry.barcode,
        lagerplatz: entry.lagerplatz,
        artikelgruppe: entry.artikelgruppe,
        bemerkung: entry.bemerkung,
        aktiv: entry.aktiv ?? true
      };
    });
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
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  const aliases = {
    material: "materialnummer",
    material_nr: "materialnummer",
    artikelnummer: "materialnummer",
    bezeichnung: "materialbezeichnung",
    artikelbezeichnung: "materialbezeichnung",
    gebinde_art: "gebinde",
    verpackung: "gebinde",
    menge_karton: "menge_pro_karton",
    kartonmenge: "menge_pro_karton",
    menge_krt: "menge_pro_krt",
    menge_palette: "menge_pro_palette",
    palettenmenge: "menge_pro_palette"
  };
  return aliases[text] || text;
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
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options
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
