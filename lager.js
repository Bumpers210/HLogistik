const SEARCH_DEBOUNCE_MS = 200;
const ARTICLE_OVERVIEW_SORT_KEY = "artikeluebersicht-sort-v1";
const ARTICLE_OVERVIEW_SORT_COLUMNS = new Set([
  "materialnummer",
  "materialbezeichnung",
  "gesamtStueck",
  "palettenGesamt"
]);

function storagePageLabel(group) {
  return HLogistikUi.storageNavLabel(group);
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
let articleOverviewSort = readArticleOverviewSort();

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
    "articleOverviewTableBody",
    "movementSearchInput",
    "refreshMovementsButton",
    "movementCount",
    "movementTableBody",
    "refreshIssueErrorsButton",
    "issueErrorSortSelect",
    "issueErrorCount",
    "issueErrorTableBody",
    "storagePageTitle",
    "storageBookingLink",
    "articleOverviewNavLink",
    "issueLogNavLink",
    "storageBookingPanel",
    "storageLocationsPanel",
    "articleOverviewPanel",
    "issueLogPanel",
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
  elements.refreshIssueErrorsButton.addEventListener("click", loadIssueErrors);
  elements.issueErrorSortSelect.addEventListener("change", loadIssueErrors);
  elements.articleOverviewSearchInput.addEventListener("input", () => {
    window.clearTimeout(articleOverviewSearchTimer);
    articleOverviewSearchTimer = window.setTimeout(() => renderArticleOverview(loadedLocations), SEARCH_DEBOUNCE_MS);
  });
  document.querySelectorAll("[data-overview-sort]").forEach((button) => {
    button.addEventListener("click", () => changeArticleOverviewSort(button.dataset.overviewSort));
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
  const { name: userName, group: userGroup } = HLogistikUi.currentUser();
  if (!userName || !userGroup || userGroup === "lager") {
    window.location.replace("/");
    return false;
  }
  applyStoragePageLabels(userGroup);
  HLogistikUi.applyCurrentUserName(elements.currentUserName, userName, userGroup);
  return true;
}

function applyStoragePageLabels(userGroup) {
  const view = currentStorageView();
  const label = view === "overview" ? "Artikelübersicht" : view === "issueLog" ? "Buchungsfehler" : storagePageLabel(userGroup);
  document.title = label;
  if (elements.storagePageTitle) elements.storagePageTitle.textContent = label;
  if (elements.storageBookingLink) elements.storageBookingLink.textContent = storagePageLabel(userGroup);
}

function currentStorageView() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("ansicht") === "artikeluebersicht") return "overview";
  if (params.get("ansicht") === "buchungsfehler") return "issueLog";
  return "booking";
}

function applyStorageView() {
  const view = currentStorageView();
  const isOverview = view === "overview";
  const isIssueLog = view === "issueLog";
  document.body.classList.toggle("is-article-overview-view", isOverview);
  document.body.classList.toggle("is-issue-log-view", isIssueLog);
  elements.storageBookingLink?.classList.toggle("is-active", view === "booking");
  elements.articleOverviewNavLink?.classList.toggle("is-active", isOverview);
  elements.issueLogNavLink?.classList.toggle("is-active", isIssueLog);
  if (elements.storageBookingPanel) elements.storageBookingPanel.hidden = view !== "booking";
  if (elements.storageLocationsPanel) elements.storageLocationsPanel.hidden = true;
  if (elements.articleOverviewPanel) elements.articleOverviewPanel.hidden = !isOverview;
  if (elements.issueLogPanel) elements.issueLogPanel.hidden = !isIssueLog;
  if (elements.storageHistoryPanel) elements.storageHistoryPanel.hidden = view !== "booking";
}

function switchUser() {
  HLogistikUi.clearUserAndReturnHome();
}

function currentWarehouse() {
  return HLogistikUi.currentWarehouse();
}

function saveCurrentWarehouse() {
  HLogistikUi.saveCurrentWarehouse(elements.warehouseSelect);
}

function applyWarehouseSelection() {
  HLogistikUi.applyWarehouseSelection(elements.warehouseSelect);
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
  if (currentStorageView() === "issueLog") {
    await loadIssueErrors();
    return;
  }
  await loadMovements();
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

async function loadIssueErrors() {
  if (!serverOnline) return;

  try {
    const errors = await apiJson("/api/storage/issue-errors?limit=300");
    renderIssueErrors(errors);
  } catch (error) {
    setStatus(elements.storageStatus, `Buchungsfehler konnten nicht geladen werden: ${error.message}`, "error");
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
  updateArticleOverviewSortIndicators();
  const overview = sortArticleOverview(filterArticleOverview(buildArticleOverview(locations)));
  elements.articleOverviewCount.textContent = `${overview.length} Artikel`;
  updateArticleOverviewMetrics(overview);

  if (!overview.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="5" class="empty-cell">Keine Artikel mit Bestand gefunden.</td>`;
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
      <td>${escapeHtml(formatNumber(article.gesamtStueck))}</td>
      <td>${escapeHtml(formatNumber(article.palettenGesamt))}</td>
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
      detailRow.innerHTML = `<td colspan="5">${renderArticleOverviewDetails(article)}</td>`;
      elements.articleOverviewTableBody.appendChild(detailRow);
    }
  });
}

function changeArticleOverviewSort(key) {
  if (!ARTICLE_OVERVIEW_SORT_COLUMNS.has(key)) return;
  const sameColumn = articleOverviewSort.key === key;
  articleOverviewSort = {
    key,
    direction: sameColumn && articleOverviewSort.direction === "asc" ? "desc" : "asc"
  };
  writeArticleOverviewSort();
  renderArticleOverview(loadedLocations);
}

function sortArticleOverview(overview) {
  const direction = articleOverviewSort.direction === "desc" ? -1 : 1;
  return overview.slice().sort((left, right) => {
    const result = compareArticleOverviewValue(
      articleOverviewSortValue(left, articleOverviewSort.key),
      articleOverviewSortValue(right, articleOverviewSort.key)
    );
    if (result) return result * direction;
    return compareArticleOverviewValue(left.materialnummer, right.materialnummer);
  });
}

function articleOverviewSortValue(article, key) {
  if (key === "gesamtStueck" || key === "palettenGesamt") return Number(article[key] || 0);
  return String(article[key] || "");
}

function compareArticleOverviewValue(left, right) {
  const leftEmpty = left === null || left === undefined || left === "";
  const rightEmpty = right === null || right === undefined || right === "";
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "de", { numeric: true, sensitivity: "base" });
}

function updateArticleOverviewSortIndicators() {
  document.querySelectorAll("[data-overview-sort]").forEach((button) => {
    const active = button.dataset.overviewSort === articleOverviewSort.key;
    button.dataset.sortDirection = active ? articleOverviewSort.direction : "";
    button.setAttribute("aria-pressed", active ? "true" : "false");

    const header = button.closest("th");
    if (header) header.setAttribute("aria-sort", active ? (articleOverviewSort.direction === "desc" ? "descending" : "ascending") : "none");
  });
}

function readArticleOverviewSort() {
  try {
    const saved = JSON.parse(localStorage.getItem(ARTICLE_OVERVIEW_SORT_KEY) || "{}");
    const key = ARTICLE_OVERVIEW_SORT_COLUMNS.has(saved.key) ? saved.key : "materialnummer";
    const direction = saved.direction === "desc" ? "desc" : "asc";
    return { key, direction };
  } catch {
    return { key: "materialnummer", direction: "asc" };
  }
}

function writeArticleOverviewSort() {
  try {
    localStorage.setItem(ARTICLE_OVERVIEW_SORT_KEY, JSON.stringify(articleOverviewSort));
  } catch {
    // The overview can still be sorted without browser persistence.
  }
}

function updateArticleOverviewMetrics(overview) {
  const totalPieces = overview.reduce((sum, article) => sum + Number(article.gesamtStueck || 0), 0);
  const totalPallets = overview.reduce((sum, article) => sum + Number(article.palettenGesamt || 0), 0);
  elements.articleOverviewMetricArticles.textContent = formatNumber(overview.length);
  elements.articleOverviewMetricPieces.textContent = formatNumber(totalPieces);
  elements.articleOverviewMetricPallets.textContent = formatNumber(totalPallets);
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
        palettenGesamt: 0,
        locations: []
      });
    }

    const article = byMaterial.get(materialnummer);
    const mengeStueck = Number(location.mengeStueck || 0);
    const paletten = Number(location.paletten || 0) || calculatePalletCount(mengeStueck, article.mengeProPalette, 1);
    article.gesamtStueck += mengeStueck;
    article.palettenGesamt += paletten;
    article.locations.push({ ...location, mengeStueck, paletten });
  });

  return Array.from(byMaterial.values())
    .map((article) => ({
      ...article,
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
      const palletCount = Number(location.paletten || 0) || calculatePalletCount(location.mengeStueck, article.mengeProPalette, 1);
      return `
        <tr>
          <td>${escapeHtml(location.lagerplatz)}</td>
          <td>${escapeHtml(location.leNummer || "-")}</td>
          <td>${escapeHtml(formatNumber(location.mengeStueck))}</td>
          <td>${escapeHtml(formatNumber(palletCount))}</td>
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

function renderIssueErrors(errors) {
  const sortedErrors = sortIssueErrors(errors);
  elements.issueErrorTableBody.innerHTML = "";
  elements.issueErrorCount.textContent = `${sortedErrors.length} Fehler`;

  if (!sortedErrors.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="8" class="empty-cell">Keine Buchungsfehler gefunden.</td>`;
    elements.issueErrorTableBody.appendChild(row);
    return;
  }

  sortedErrors.forEach((entry) => {
    const row = document.createElement("tr");
    row.className = "is-issue";
    row.innerHTML = `
      <td>${escapeHtml(formatDateTime(entry.erstelltAm))}</td>
      <td>${escapeHtml(entry.auftragsnummer || entry.auftragId || "-")}</td>
      <td>${escapeHtml(entry.position || "")}</td>
      <td>${escapeHtml(entry.materialnummer)}</td>
      <td>${escapeHtml(entry.lagerplatz)}</td>
      <td class="num">${escapeHtml(entry.menge)}</td>
      <td>${escapeHtml(entry.fehler)}</td>
      <td>${escapeHtml(entry.exportiertPdfDatei)}</td>
    `;
    elements.issueErrorTableBody.appendChild(row);
  });
}

function sortIssueErrors(errors) {
  const sortMode = elements.issueErrorSortSelect?.value || "time";
  const sorted = Array.isArray(errors) ? errors.slice() : [];
  const textCompare = (left, right) => String(left || "").localeCompare(String(right || ""), "de", { numeric: true, sensitivity: "base" });

  return sorted.sort((left, right) => {
    if (sortMode === "error") {
      return textCompare(left.fehler, right.fehler) ||
        textCompare(left.materialnummer, right.materialnummer) ||
        textCompare(left.auftragsnummer || left.auftragId, right.auftragsnummer || right.auftragId) ||
        textCompare(right.erstelltAm, left.erstelltAm);
    }
    if (sortMode === "material") {
      return textCompare(left.materialnummer, right.materialnummer) ||
        textCompare(left.fehler, right.fehler) ||
        textCompare(right.erstelltAm, left.erstelltAm);
    }
    if (sortMode === "order") {
      return textCompare(left.auftragsnummer || left.auftragId, right.auftragsnummer || right.auftragId) ||
        Number(left.position || 0) - Number(right.position || 0) ||
        textCompare(left.materialnummer, right.materialnummer);
    }
    if (sortMode === "location") {
      return textCompare(left.lagerplatz, right.lagerplatz) ||
        textCompare(left.materialnummer, right.materialnummer) ||
        textCompare(left.fehler, right.fehler);
    }
    return textCompare(right.erstelltAm, left.erstelltAm) ||
      textCompare(left.auftragsnummer || left.auftragId, right.auftragsnummer || right.auftragId) ||
      Number(left.position || 0) - Number(right.position || 0);
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
  return HLogistikUi.apiJson(url, options);
}

function setConnectionStatus(isOnline) {
  HLogistikUi.setConnectionStatus(elements.connectionBadge, elements.connectionText, isOnline);
}

function setStatus(element, message, type = "") {
  HLogistikUi.setStatus(element, message, type);
}

function sumQuantity(movements) {
  return movements.reduce((sum, movement) => sum + Number(movement.mengeStueck || 0), 0);
}

function formatNumber(value) {
  return HLogistikUi.formatNumber(value);
}

function normalizeSearch(value) {
  return HLogistikUi.normalizeSearch(value);
}

function calculatePalletCount(total, perPalette, fallback) {
  const paletteSize = Number(perPalette || 0);
  if (!paletteSize) return Number(fallback || 0);
  return Math.ceil(Number(total || 0) / paletteSize);
}

function formatDateTime(value) {
  return HLogistikUi.formatDateTime(value);
}

function escapeHtml(value) {
  return HLogistikUi.escapeHtml(value);
}

function escapeAttribute(value) {
  return HLogistikUi.escapeAttribute(value);
}
