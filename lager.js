const API_BASE = "";
const SEARCH_DEBOUNCE_MS = 200;
const USER_KEY = "kommissionier-app-user-v1";
const USER_GROUP_KEY = "kommissionier-app-user-group-v1";
const WAREHOUSE_KEY = "hlogistik-warehouse-v1";

function storagePageLabel(group) {
  return group === "buero" ? "Buchung" : "Einlagern";
}

const elements = {};
let serverOnline = false;
let searchTimer = null;
let movementSearchTimer = null;
let articleOverviewSearchTimer = null;
let receiptLineCounter = 0;
let issueLineCounter = 0;
let loadedLocations = [];
const expandedOverviewMaterials = new Set();

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  resetBookingLines("receipt");
  resetBookingLines("issue");
  initialize();
});

function bindElements() {
  [
    "connectionBadge",
    "connectionText",
    "warehouseSelect",
    "currentUserName",
    "switchUserButton",
    "receiptTabButton",
    "issueTabButton",
    "receiptTabPanel",
    "issueTabPanel",
    "storageForm",
    "materialnummerInput",
    "receiptReferenceInput",
    "addReceiptLineButton",
    "receiptLinesBody",
    "storageStatus",
    "issueForm",
    "issueMaterialInput",
    "issueReferenceInput",
    "addIssueLineButton",
    "issueLinesBody",
    "issueStatus",
    "locationSearchInput",
    "refreshLocationsButton",
    "locationCount",
    "locationTableBody",
    "articleOverviewSearchInput",
    "articleOverviewCount",
    "articleOverviewMetricArticles",
    "articleOverviewMetricPieces",
    "articleOverviewMetricPallets",
    "articleOverviewMetricPlaces",
    "articleOverviewTableBody",
    "movementSearchInput",
    "refreshMovementsButton",
    "movementCount",
    "movementTableBody",
    "storagePageTitle",
    "storageBookingLink",
    "articleOverviewNavLink",
    "storageBookingPanel",
    "storageLocationsPanel",
    "articleOverviewPanel",
    "storageHistoryPanel"
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.storageForm.addEventListener("submit", bookStorageReceipt);
  elements.issueForm.addEventListener("submit", bookStorageIssue);
  elements.switchUserButton.addEventListener("click", switchUser);
  elements.receiptTabButton.addEventListener("click", () => switchStorageTab("receipt"));
  elements.issueTabButton.addEventListener("click", () => switchStorageTab("issue"));
  elements.addReceiptLineButton.addEventListener("click", () => addBookingLine("receipt"));
  elements.addIssueLineButton.addEventListener("click", () => addBookingLine("issue"));
  elements.receiptLinesBody.addEventListener("click", handleBookingLineAction);
  elements.issueLinesBody.addEventListener("click", handleBookingLineAction);
  if (elements.warehouseSelect) {
    elements.warehouseSelect.addEventListener("change", async () => {
      saveCurrentWarehouse();
      updateUnitLabels();
      resetBookingLines("receipt");
      resetBookingLines("issue");
      if (serverOnline) await refreshStorageViews();
    });
  }
  elements.refreshLocationsButton.addEventListener("click", loadLocations);
  elements.refreshMovementsButton.addEventListener("click", loadMovements);
  elements.articleOverviewSearchInput.addEventListener("input", () => {
    window.clearTimeout(articleOverviewSearchTimer);
    articleOverviewSearchTimer = window.setTimeout(() => renderArticleOverview(loadedLocations), SEARCH_DEBOUNCE_MS);
  });
  elements.articleOverviewTableBody.addEventListener("click", handleArticleOverviewAction);
  elements.locationSearchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(loadLocations, SEARCH_DEBOUNCE_MS);
  });
  elements.movementSearchInput.addEventListener("input", () => {
    window.clearTimeout(movementSearchTimer);
    movementSearchTimer = window.setTimeout(loadMovements, SEARCH_DEBOUNCE_MS);
  });
}

async function initialize() {
  if (!enforceStorageAccess()) return;
  applyWarehouseSelection();
  updateUnitLabels();
  applyStorageView();
  try {
    setConnectionStatus(null);
    await apiJson("/api/health");
    serverOnline = true;
    setConnectionStatus(true);
    await refreshStorageViews();
    setStatus(elements.storageStatus, "Bereit zur Buchung.", "ok");
  } catch {
    serverOnline = false;
    setConnectionStatus(false);
    setStatus(elements.storageStatus, "Server nicht verbunden. Buchung ist nicht verfügbar.", "error");
  }
}

function enforceStorageAccess() {
  const userName = localStorage.getItem(USER_KEY) || "";
  const userGroup = localStorage.getItem(USER_GROUP_KEY) || "";
  if (!userName || !userGroup || userGroup === "lager") {
    window.location.replace("/");
    return false;
  }
  applyStoragePageLabels(userGroup);
  if (elements.currentUserName) {
    const groupLabel = userGroup === "buero" ? "Büro" : userGroup === "tablet" ? "Tablet" : "";
    elements.currentUserName.textContent = groupLabel ? `${userName} - ${groupLabel}` : userName;
  }
  return true;
}

function applyStoragePageLabels(userGroup) {
  const label = currentStorageView() === "overview" ? "Artikelübersicht" : storagePageLabel(userGroup);
  document.title = label;
  if (elements.storagePageTitle) elements.storagePageTitle.textContent = label;
  if (elements.storageBookingLink) elements.storageBookingLink.textContent = storagePageLabel(userGroup);
}

function currentStorageView() {
  const params = new URLSearchParams(window.location.search);
  return params.get("ansicht") === "artikeluebersicht" ? "overview" : "booking";
}

function applyStorageView() {
  const isOverview = currentStorageView() === "overview";
  document.body.classList.toggle("is-article-overview-view", isOverview);
  elements.storageBookingLink?.classList.toggle("is-active", !isOverview);
  elements.articleOverviewNavLink?.classList.toggle("is-active", isOverview);
  if (elements.storageBookingPanel) elements.storageBookingPanel.hidden = isOverview;
  if (elements.storageLocationsPanel) elements.storageLocationsPanel.hidden = isOverview;
  if (elements.articleOverviewPanel) elements.articleOverviewPanel.hidden = !isOverview;
  if (elements.storageHistoryPanel) elements.storageHistoryPanel.hidden = isOverview;
}

function switchUser() {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(USER_GROUP_KEY);
  window.location.replace("/");
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

function normalizeWarehouse(value) {
  return String(value || "SSI").trim().toUpperCase() === "SI" ? "SI" : "SSI";
}

function storageUnitLabels() {
  return currentWarehouse() === "SSI"
    ? { singular: "HU-Nummer", plural: "HU-Nummern", short: "HU" }
    : { singular: "LE-Nummer", plural: "LE-Nummern", short: "LE" };
}

function updateUnitLabels() {
  const labels = storageUnitLabels();
  document.querySelectorAll("[data-unit-label]").forEach((element) => {
    const type = element.dataset.unitLabel || "singular";
    element.textContent = labels[type] || labels.singular;
  });
  if (elements.locationSearchInput) {
    elements.locationSearchInput.placeholder = `Artikelnummer, Lagerplatz oder ${labels.singular}`;
  }
  if (elements.movementSearchInput) {
    elements.movementSearchInput.placeholder = `Artikel, Lagerplatz, ${labels.short} oder Referenz`;
  }
}

function switchStorageTab(type) {
  const isReceipt = type === "receipt";
  elements.receiptTabButton.classList.toggle("is-active", isReceipt);
  elements.issueTabButton.classList.toggle("is-active", !isReceipt);
  elements.receiptTabButton.setAttribute("aria-selected", String(isReceipt));
  elements.issueTabButton.setAttribute("aria-selected", String(!isReceipt));
  elements.receiptTabPanel.classList.toggle("is-active", isReceipt);
  elements.issueTabPanel.classList.toggle("is-active", !isReceipt);
  elements.receiptTabPanel.hidden = !isReceipt;
  elements.issueTabPanel.hidden = isReceipt;
}

async function bookStorageReceipt(event) {
  event.preventDefault();
  if (!serverOnline) return setStatus(elements.storageStatus, "Server nicht verbunden.", "error");

  try {
    const materialnummer = elements.materialnummerInput.value;
    const referenz = elements.receiptReferenceInput.value;
    const receipts = collectBookingLines("receipt").map((line) => ({ materialnummer, referenz, ...line }));
    const result = await apiJson("/api/storage/receipts", {
      method: "POST",
      body: JSON.stringify({ receipts })
    });
    const amount = sumQuantity(result.movements);
    setStatus(
      elements.storageStatus,
      `${result.movements.length} Wareneingang${result.movements.length === 1 ? "" : "e"} gebucht. Gesamtmenge: ${amount} Stück.`,
      "ok"
    );
    elements.receiptReferenceInput.value = "";
    resetBookingLines("receipt");
    await refreshStorageViews();
  } catch (error) {
    setStatus(elements.storageStatus, `Buchung fehlgeschlagen: ${error.message}`, "error");
  }
}

async function bookStorageIssue(event) {
  event.preventDefault();
  if (!serverOnline) return setStatus(elements.issueStatus, "Server nicht verbunden.", "error");

  try {
    const materialnummer = elements.issueMaterialInput.value;
    const referenz = elements.issueReferenceInput.value;
    const issues = collectBookingLines("issue").map((line) => ({ materialnummer, referenz, ...line }));
    const result = await apiJson("/api/storage/issues", {
      method: "POST",
      body: JSON.stringify({ issues })
    });
    const amount = sumQuantity(result.movements);
    setStatus(
      elements.issueStatus,
      `${result.movements.length} Warenausgang${result.movements.length === 1 ? "" : "e"} gebucht. Gesamtmenge: ${amount} Stück.`,
      "ok"
    );
    elements.issueReferenceInput.value = "";
    resetBookingLines("issue");
    await refreshStorageViews();
  } catch (error) {
    setStatus(elements.issueStatus, `Warenausgang fehlgeschlagen: ${error.message}`, "error");
  }
}

function resetBookingLines(type) {
  const body = bookingLinesBody(type);
  body.innerHTML = "";
  addBookingLine(type);
}

function addBookingLine(type, values = {}) {
  const body = bookingLinesBody(type);
  const id = type === "receipt" ? ++receiptLineCounter : ++issueLineCounter;
  const row = document.createElement("tr");
  row.dataset.bookingLine = type;
  row.innerHTML = `
    <td>
      <input data-field="lagerplatz" name="${type}-lagerplatz-${id}" type="text" autocomplete="off" value="${escapeAttribute(values.lagerplatz)}" required>
    </td>
    <td>
      <input data-field="mengeStueck" name="${type}-menge-${id}" type="number" inputmode="numeric" min="1" step="1" value="${escapeAttribute(values.mengeStueck)}" required>
    </td>
    <td>
      <input data-field="leNummer" name="${type}-le-${id}" type="text" autocomplete="off" value="${escapeAttribute(values.leNummer)}">
    </td>
    <td>
      <button class="icon-button compact remove-booking-line" type="button" aria-label="Zeile entfernen">×</button>
    </td>
  `;

  if (values.maxMenge) {
    row.querySelector('[data-field="mengeStueck"]').max = String(values.maxMenge);
  }

  body.appendChild(row);
  return row;
}

function handleBookingLineAction(event) {
  const button = event.target.closest(".remove-booking-line");
  if (!button) return;

  const row = button.closest("tr");
  const body = row?.parentElement;
  if (!row || !body) return;

  if (body.querySelectorAll("tr").length === 1) {
    row.querySelectorAll("input").forEach((input) => {
      input.value = "";
      input.removeAttribute("max");
    });
    return;
  }

  row.remove();
}

function collectBookingLines(type) {
  const rows = Array.from(bookingLinesBody(type).querySelectorAll("tr"));
  return rows.map((row) => ({
    lagerplatz: row.querySelector('[data-field="lagerplatz"]').value,
    mengeStueck: row.querySelector('[data-field="mengeStueck"]').value,
    leNummer: row.querySelector('[data-field="leNummer"]').value
  }));
}

function bookingLinesBody(type) {
  return type === "receipt" ? elements.receiptLinesBody : elements.issueLinesBody;
}

async function refreshStorageViews() {
  if (currentStorageView() === "overview") {
    await loadLocations();
    return;
  }
  await Promise.all([loadLocations(), loadMovements()]);
}

async function loadLocations() {
  if (!serverOnline) return;

  try {
    const params = new URLSearchParams();
    const query = elements.locationSearchInput.value.trim();
    if (query) params.set("q", query);
    const locations = await apiJson(`/api/storage/locations${params.toString() ? `?${params}` : ""}`);
    loadedLocations = locations;
    renderLocations(locations);
    renderArticleOverview(locations);
  } catch (error) {
    setStatus(elements.storageStatus, `Stellplätze konnten nicht geladen werden: ${error.message}`, "error");
  }
}

async function loadMovements() {
  if (!serverOnline) return;

  try {
    const params = new URLSearchParams();
    const query = elements.movementSearchInput.value.trim();
    if (query) params.set("q", query);
    params.set("limit", "150");
    const movements = await apiJson(`/api/storage/movements?${params}`);
    renderMovements(movements);
  } catch (error) {
    setStatus(elements.issueStatus, `Historie konnte nicht geladen werden: ${error.message}`, "error");
  }
}

function renderLocations(locations) {
  elements.locationTableBody.innerHTML = "";
  elements.locationCount.textContent = `${locations.length} Einträge`;

  if (!locations.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="5" class="empty-cell">Keine Stellplätze gefunden.</td>`;
    elements.locationTableBody.appendChild(row);
    return;
  }

  locations.forEach((location) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(location.materialnummer)}</td>
      <td>${escapeHtml(location.materialbezeichnung)}</td>
      <td>${escapeHtml(location.lagerplatz)}</td>
      <td class="num">${escapeHtml(location.mengeStueck)}</td>
      <td>${escapeHtml(location.leNummer)}</td>
    `;
    row.addEventListener("click", () => fillIssueFromLocation(location));
    elements.locationTableBody.appendChild(row);
  });
}

function renderArticleOverview(locations) {
  elements.articleOverviewTableBody.innerHTML = "";
  const overview = filterArticleOverview(buildArticleOverview(locations));
  elements.articleOverviewCount.textContent = `${overview.length} Artikel`;
  updateArticleOverviewMetrics(overview);

  if (!overview.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="6" class="empty-cell">Keine Artikel mit Bestand gefunden.</td>`;
    elements.articleOverviewTableBody.appendChild(row);
    return;
  }

  overview.forEach((article) => {
    const isExpanded = expandedOverviewMaterials.has(article.materialnummer);
    const row = document.createElement("tr");
    row.className = `article-overview-summary-row${isExpanded ? " is-expanded" : ""}`;
    row.innerHTML = `
      <td><strong>${escapeHtml(article.materialnummer)}</strong></td>
      <td>${escapeHtml(article.materialbezeichnung)}</td>
      <td class="num">${escapeHtml(formatNumber(article.gesamtStueck))}</td>
      <td class="num">${escapeHtml(formatNumber(article.palettenGesamt))}</td>
      <td class="num">${escapeHtml(formatNumber(article.locations.length))}</td>
      <td>
        <button class="secondary-button overview-toggle-button" type="button" data-overview-toggle="${escapeHtml(article.materialnummer)}" aria-expanded="${isExpanded}">
          ${isExpanded ? "Ausblenden" : "Anzeigen"}
        </button>
      </td>
    `;
    elements.articleOverviewTableBody.appendChild(row);

    if (isExpanded) {
      const detailRow = document.createElement("tr");
      detailRow.className = "article-overview-detail-row";
      detailRow.innerHTML = `<td colspan="6">${renderArticleOverviewDetails(article)}</td>`;
      elements.articleOverviewTableBody.appendChild(detailRow);
    }
  });
}

function updateArticleOverviewMetrics(overview) {
  const totalPieces = overview.reduce((sum, article) => sum + Number(article.gesamtStueck || 0), 0);
  const totalPallets = overview.reduce((sum, article) => sum + Number(article.palettenGesamt || 0), 0);
  const totalPlaces = overview.reduce((sum, article) => sum + article.locations.length, 0);
  elements.articleOverviewMetricArticles.textContent = formatNumber(overview.length);
  elements.articleOverviewMetricPieces.textContent = formatNumber(totalPieces);
  elements.articleOverviewMetricPallets.textContent = formatNumber(totalPallets);
  elements.articleOverviewMetricPlaces.textContent = formatNumber(totalPlaces);
}

function handleArticleOverviewAction(event) {
  const target = event.target instanceof Element ? event.target : event.target.parentElement;
  const toggle = target?.closest("[data-overview-toggle]");
  if (!toggle) return;
  const materialnummer = toggle.dataset.overviewToggle;
  if (expandedOverviewMaterials.has(materialnummer)) {
    expandedOverviewMaterials.delete(materialnummer);
  } else {
    expandedOverviewMaterials.add(materialnummer);
  }
  renderArticleOverview(loadedLocations);
}

function filterArticleOverview(overview) {
  const terms = normalizeSearch(elements.articleOverviewSearchInput?.value || "").split(" ").filter(Boolean);
  if (!terms.length) return overview;
  return overview.filter((article) => {
    const haystack = normalizeSearch(
      [
        article.materialnummer,
        article.materialbezeichnung,
        article.gesamtStueck,
        article.palettenGesamt,
        ...article.locations.flatMap((location) => [location.lagerplatz, location.leNummer, location.mengeStueck])
      ].join(" ")
    );
    return terms.every((term) => haystack.includes(term));
  });
}

function buildArticleOverview(locations) {
  const byMaterial = new Map();
  locations.forEach((location) => {
    const materialnummer = String(location.materialnummer || "").trim();
    if (!materialnummer) return;
    if (!byMaterial.has(materialnummer)) {
      byMaterial.set(materialnummer, {
        materialnummer,
        materialbezeichnung: location.materialbezeichnung || "",
        mengeProPalette: Number(location.mengeProPalette || 0),
        gesamtStueck: 0,
        locations: []
      });
    }

    const article = byMaterial.get(materialnummer);
    const mengeStueck = Number(location.mengeStueck || 0);
    article.gesamtStueck += mengeStueck;
    article.locations.push({ ...location, mengeStueck });
  });

  return Array.from(byMaterial.values())
    .map((article) => ({
      ...article,
      palettenGesamt: calculatePalletCount(article.gesamtStueck, article.mengeProPalette, article.locations.length),
      locations: article.locations.sort((a, b) =>
        String(a.lagerplatz).localeCompare(String(b.lagerplatz), "de", { numeric: true }) ||
        String(a.leNummer).localeCompare(String(b.leNummer), "de", { numeric: true })
      )
    }))
    .sort((a, b) => String(a.materialnummer).localeCompare(String(b.materialnummer), "de", { numeric: true }));
}

function renderArticleOverviewDetails(article) {
  const unit = storageUnitLabels().short;
  return `
    <table class="overview-location-table">
      <thead>
        <tr>
          <th>Stellplatz</th>
          <th>${escapeHtml(unit)}</th>
          <th>Stück</th>
          <th>Paletten</th>
        </tr>
      </thead>
      <tbody>
        ${article.locations
    .map((location) => {
      const palletCount = calculatePalletCount(location.mengeStueck, article.mengeProPalette, 1);
      return `
        <tr>
          <td>${escapeHtml(location.lagerplatz)}</td>
          <td>${escapeHtml(location.leNummer || "-")}</td>
          <td class="num">${escapeHtml(formatNumber(location.mengeStueck))}</td>
          <td class="num">${escapeHtml(formatNumber(palletCount))}</td>
        </tr>
      `;
    })
    .join("")}
      </tbody>
    </table>
  `;
}

function renderMovements(movements) {
  elements.movementTableBody.innerHTML = "";
  elements.movementCount.textContent = `${movements.length} Buchungen`;

  if (!movements.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7" class="empty-cell">Keine Buchungen gefunden.</td>`;
    elements.movementTableBody.appendChild(row);
    return;
  }

  movements.forEach((movement) => {
    const row = document.createElement("tr");
    row.className = movement.bewegungsart === "Warenausgang" ? "is-issue" : "is-receipt";
    row.innerHTML = `
      <td>${escapeHtml(formatDateTime(movement.erstelltAm))}</td>
      <td>${escapeHtml(movement.bewegungsart)}</td>
      <td>${escapeHtml(movement.materialnummer)}</td>
      <td>${escapeHtml(movement.lagerplatz)}</td>
      <td>${escapeHtml(movement.leNummer)}</td>
      <td class="num">${escapeHtml(movement.mengeStueck)}</td>
      <td>${escapeHtml(movement.referenz)}</td>
    `;
    elements.movementTableBody.appendChild(row);
  });
}

function fillIssueFromLocation(location) {
  switchStorageTab("issue");
  elements.issueMaterialInput.value = location.materialnummer;
  const emptyRow = findEmptyBookingLine("issue") || addBookingLine("issue");
  emptyRow.querySelector('[data-field="lagerplatz"]').value = location.lagerplatz;
  emptyRow.querySelector('[data-field="leNummer"]').value = location.leNummer;
  const quantityInput = emptyRow.querySelector('[data-field="mengeStueck"]');
  quantityInput.value = "";
  quantityInput.max = String(location.mengeStueck || "");
  setStatus(elements.issueStatus, `Bestand gewählt: ${location.mengeStueck} Stück verfügbar.`, "ok");
}

function findEmptyBookingLine(type) {
  return Array.from(bookingLinesBody(type).querySelectorAll("tr")).find((row) => {
    return Array.from(row.querySelectorAll("input")).every((input) => !input.value.trim());
  });
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

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.classList.toggle("is-ok", type === "ok");
  element.classList.toggle("is-error", type === "error");
}

function sumQuantity(movements) {
  return movements.reduce((sum, movement) => sum + Number(movement.mengeStueck || 0), 0);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("de-DE");
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function calculatePalletCount(total, perPalette, fallback) {
  const paletteSize = Number(perPalette || 0);
  if (!paletteSize) return Number(fallback || 0);
  return Math.ceil(Number(total || 0) / paletteSize);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
