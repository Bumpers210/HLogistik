const API_BASE = "";
const SEARCH_DEBOUNCE_MS = 200;
const USER_KEY = "kommissionier-app-user-v1";
const USER_GROUP_KEY = "kommissionier-app-user-group-v1";

function storagePageLabel(group) {
  return group === "buero" ? "Buchung" : "Einlagern";
}

const elements = {};
let serverOnline = false;
let searchTimer = null;
let movementSearchTimer = null;
let receiptLineCounter = 0;
let issueLineCounter = 0;

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
    "movementSearchInput",
    "refreshMovementsButton",
    "movementCount",
    "movementTableBody",
    "storagePageTitle",
    "storageNavLabel"
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
  elements.refreshLocationsButton.addEventListener("click", loadLocations);
  elements.refreshMovementsButton.addEventListener("click", loadMovements);
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
  const label = storagePageLabel(userGroup);
  document.title = label;
  if (elements.storagePageTitle) elements.storagePageTitle.textContent = label;
  if (elements.storageNavLabel) elements.storageNavLabel.textContent = label;
}

function switchUser() {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(USER_GROUP_KEY);
  window.location.replace("/");
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
      <input data-field="leNummer" name="${type}-le-${id}" type="text" autocomplete="off" value="${escapeAttribute(values.leNummer)}" required>
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
  await Promise.all([loadLocations(), loadMovements()]);
}

async function loadLocations() {
  if (!serverOnline) return;

  try {
    const params = new URLSearchParams();
    const query = elements.locationSearchInput.value.trim();
    if (query) params.set("q", query);
    const locations = await apiJson(`/api/storage/locations${params.toString() ? `?${params}` : ""}`);
    renderLocations(locations);
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

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.classList.toggle("is-ok", type === "ok");
  element.classList.toggle("is-error", type === "error");
}

function sumQuantity(movements) {
  return movements.reduce((sum, movement) => sum + Number(movement.mengeStueck || 0), 0);
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
