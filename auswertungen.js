const API_BASE = "";
const SEARCH_DEBOUNCE_MS = 200;
const USER_KEY = "kommissionier-app-user-v1";
const USER_GROUP_KEY = "kommissionier-app-user-group-v1";
const WAREHOUSE_KEY = "hlogistik-warehouse-v1";
const DEFAULT_RANGE_DAYS = 90;

const elements = {};
let serverOnline = false;
let searchTimer = null;
let activeReport = "article-movements";
let loadedItems = [];

// ── Berichtsdefinitionen ────────────────────────────────────────────────────
const REPORTS = {
  "article-movements": {
    title: "Artikelbewegungen",
    endpoint: "/api/storage/reports/article-movements",
    empty: "Keine Artikelbewegungen im Zeitraum.",
    search: (row) => [row.materialnummer, row.materialbezeichnung],
    columns: [
      { label: "Artikelnummer", cell: (row) => `<strong>${escapeHtml(row.materialnummer)}</strong>` },
      { label: "Artikelbezeichnung", cell: (row) => escapeHtml(row.materialbezeichnung) },
      { label: "Entnahmen", cell: (row) => escapeHtml(formatNumber(row.entnahmen)) },
      { label: "Zugänge", cell: (row) => escapeHtml(formatNumber(row.zugaenge)) },
      { label: "Aktueller Bestand", cell: (row) => escapeHtml(formatNumber(row.bestand)) },
    ],
  },
  "top-articles": {
    title: "Top-Artikel",
    endpoint: "/api/storage/reports/top-articles",
    empty: "Keine Kommissionierungen im Zeitraum.",
    search: (row) => [row.materialnummer, row.materialbezeichnung],
    columns: [
      { label: "Rang", cell: (row) => escapeHtml(formatNumber(row.rang)) },
      { label: "Artikelnummer", cell: (row) => `<strong>${escapeHtml(row.materialnummer)}</strong>` },
      { label: "Artikelbezeichnung", cell: (row) => escapeHtml(row.materialbezeichnung) },
      { label: "Anzahl Aufträge", cell: (row) => escapeHtml(formatNumber(row.anzahlAuftraege)) },
      { label: "Gesamtmenge", cell: (row) => escapeHtml(formatNumber(row.gesamtmenge)) },
    ],
  },
  "slow-articles": {
    title: "Langsame Artikel",
    endpoint: "/api/storage/reports/slow-articles",
    empty: "Keine aktiven Artikel vorhanden.",
    search: (row) => [row.materialnummer, row.materialbezeichnung],
    columns: [
      { label: "Artikelnummer", cell: (row) => `<strong>${escapeHtml(row.materialnummer)}</strong>` },
      { label: "Artikelbezeichnung", cell: (row) => escapeHtml(row.materialbezeichnung) },
      { label: "Entnahmen", cell: (row) => escapeHtml(formatNumber(row.entnahmen)) },
      { label: "Letzte Bewegung", cell: (row) => escapeHtml(row.letzteBewegung ? formatDate(row.letzteBewegung) : "—") },
      { label: "Aktueller Bestand", cell: (row) => escapeHtml(formatNumber(row.bestand)) },
    ],
  },
  "location-usage": {
    title: "Lagerplatz-Auswertung",
    endpoint: "/api/storage/reports/location-usage",
    empty: "Keine Lagerplatz-Daten im Zeitraum.",
    search: (row) => [row.lagerplatz],
    columns: [
      { label: "Lagerplatz", cell: (row) => `<strong>${escapeHtml(row.lagerplatz)}</strong>` },
      { label: "Entnahmen", cell: (row) => escapeHtml(formatNumber(row.entnahmen)) },
      { label: "Artikelanzahl", cell: (row) => escapeHtml(formatNumber(row.artikelanzahl)) },
      { label: "Fehlmengen", cell: (row) => escapeHtml(formatNumber(row.fehlmengen)) },
    ],
  },
};

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
    "currentUserName",
    "switchUserButton",
    "fromInput",
    "toInput",
    "refreshButton",
    "searchInput",
    "reportStatus",
    "reportTabs",
    "reportTitle",
    "reportCount",
    "reportTableHead",
    "reportTableBody",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.switchUserButton.addEventListener("click", switchUser);
  elements.refreshButton.addEventListener("click", loadReport);
  elements.fromInput.addEventListener("change", loadReport);
  elements.toInput.addEventListener("change", loadReport);
  elements.searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderReport, SEARCH_DEBOUNCE_MS);
  });
  elements.reportTabs.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-report]") : null;
    if (!button) return;
    const report = button.dataset.report;
    if (!REPORTS[report] || report === activeReport) return;
    setActiveReport(report);
    loadReport();
  });
  if (elements.warehouseSelect) {
    elements.warehouseSelect.addEventListener("change", () => {
      saveCurrentWarehouse();
      if (serverOnline) loadReport();
    });
  }
}

async function initialize() {
  if (!enforceAccess()) return;
  applyWarehouseSelection();
  setDefaultRange();
  setActiveReport(activeReport);
  try {
    setConnectionStatus(null);
    await apiJson("/api/health");
    serverOnline = true;
    setConnectionStatus(true);
    await loadReport();
  } catch {
    serverOnline = false;
    setConnectionStatus(false);
    setStatus("Server nicht verbunden. Auswertungen sind nicht verfügbar.", "error");
  }
}

function enforceAccess() {
  const userName = localStorage.getItem(USER_KEY) || "";
  const userGroup = localStorage.getItem(USER_GROUP_KEY) || "";
  if (!userName || !userGroup || userGroup === "lager") {
    window.location.replace("/");
    return false;
  }
  if (elements.currentUserName) {
    const groupLabel = userGroup === "buero" ? "Büro" : userGroup === "tablet" ? "Tablet" : "";
    elements.currentUserName.textContent = groupLabel ? `${userName} - ${groupLabel}` : userName;
  }
  return true;
}

function setDefaultRange() {
  const today = new Date();
  const from = new Date(today.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  elements.toInput.value = toDateInputValue(today);
  elements.fromInput.value = toDateInputValue(from);
}

function setActiveReport(report) {
  activeReport = report;
  const config = REPORTS[report];
  elements.reportTitle.textContent = config.title;
  elements.reportTabs.querySelectorAll("[data-report]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.report === report);
  });
}

async function loadReport() {
  if (!serverOnline) return;
  const config = REPORTS[activeReport];
  const params = new URLSearchParams();
  if (elements.fromInput.value) params.set("from", elements.fromInput.value);
  if (elements.toInput.value) params.set("to", elements.toInput.value);
  setStatus("Auswertung wird geladen...");
  try {
    const data = await apiJson(`${config.endpoint}?${params}`);
    loadedItems = Array.isArray(data.items) ? data.items : [];
    renderReport();
    setStatus(`Zeitraum ${formatDate(data.from)} – ${formatDate(data.to)}`, "ok");
  } catch (error) {
    loadedItems = [];
    renderReport();
    setStatus(`Auswertung konnte nicht geladen werden: ${error.message}`, "error");
  }
}

function renderReport() {
  const config = REPORTS[activeReport];
  const rows = filterItems(loadedItems, config);
  elements.reportCount.textContent = `${formatNumber(rows.length)} ${rows.length === 1 ? "Eintrag" : "Einträge"}`;

  elements.reportTableHead.innerHTML = `<tr>${config.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>`;
  elements.reportTableBody.innerHTML = "";

  if (!rows.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="${config.columns.length}" class="empty-cell">${escapeHtml(config.empty)}</td>`;
    elements.reportTableBody.appendChild(row);
    return;
  }

  const fragment = document.createDocumentFragment();
  rows.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = config.columns.map((column) => `<td>${column.cell(item)}</td>`).join("");
    fragment.appendChild(row);
  });
  elements.reportTableBody.appendChild(fragment);
}

function filterItems(items, config) {
  const terms = normalizeSearch(elements.searchInput?.value || "").split(" ").filter(Boolean);
  if (!terms.length) return items;
  return items.filter((item) => {
    const haystack = normalizeSearch(config.search(item).join(" "));
    return terms.every((term) => haystack.includes(term));
  });
}

// ── Benutzer / Lager ─────────────────────────────────────────────────────────

function switchUser() {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(USER_GROUP_KEY);
  window.location.replace("/");
}

function normalizeWarehouse(value) {
  return String(value || "").trim().toUpperCase() === "SI" ? "SI" : "SSI";
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

// ── HTTP ───────────────────────────────────────────────────────────────────

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

// ── UI-Helfer ────────────────────────────────────────────────────────────────

function setConnectionStatus(isOnline) {
  elements.connectionBadge.classList.toggle("is-online", isOnline === true);
  elements.connectionBadge.classList.toggle("is-offline", isOnline === false);
  elements.connectionBadge.classList.toggle("is-checking", isOnline === null);
  elements.connectionText.textContent = isOnline === true ? "Online" : isOnline === false ? "Offline" : "Prüfe Verbindung";
}

function setStatus(message, type = "") {
  if (!elements.reportStatus) return;
  elements.reportStatus.textContent = message;
  elements.reportStatus.classList.toggle("is-ok", type === "ok");
  elements.reportStatus.classList.toggle("is-error", type === "error");
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("de-DE");
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
