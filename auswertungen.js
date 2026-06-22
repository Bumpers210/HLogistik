const SEARCH_DEBOUNCE_MS = 200;
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
  const { name: userName, group: userGroup } = HLogistikUi.currentUser();
  if (!userName || !userGroup || userGroup === "lager") {
    window.location.replace("/");
    return false;
  }
  HLogistikUi.applyCurrentUserName(elements.currentUserName, userName, userGroup);
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
  HLogistikUi.clearUserAndReturnHome();
}

function saveCurrentWarehouse() {
  HLogistikUi.saveCurrentWarehouse(elements.warehouseSelect);
}

function applyWarehouseSelection() {
  HLogistikUi.applyWarehouseSelection(elements.warehouseSelect);
}

// ── HTTP ───────────────────────────────────────────────────────────────────

async function apiJson(url, options = {}) {
  return HLogistikUi.apiJson(url, options);
}

// ── UI-Helfer ────────────────────────────────────────────────────────────────

function setConnectionStatus(isOnline) {
  HLogistikUi.setConnectionStatus(elements.connectionBadge, elements.connectionText, isOnline);
}

function setStatus(message, type = "") {
  HLogistikUi.setStatus(elements.reportStatus, message, type);
}

function formatNumber(value) {
  return HLogistikUi.formatNumber(value);
}

function normalizeSearch(value) {
  return HLogistikUi.normalizeSearch(value);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  return HLogistikUi.formatDate(value);
}

function escapeHtml(value) {
  return HLogistikUi.escapeHtml(value);
}
