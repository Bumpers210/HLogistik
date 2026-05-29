const API_BASE = "";
const SEARCH_DEBOUNCE_MS = 200;
const USER_KEY = "kommissionier-app-user-v1";
const USER_GROUP_KEY = "kommissionier-app-user-group-v1";

const elements = {};
let serverOnline = false;
let searchTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  initialize();
});

function bindElements() {
  [
    "connectionBadge",
    "connectionText",
    "currentUserName",
    "switchUserButton",
    "storageForm",
    "materialnummerInput",
    "lagerplatzInput",
    "mengeStueckInput",
    "leNummerInput",
    "storageStatus",
    "locationSearchInput",
    "refreshLocationsButton",
    "locationCount",
    "locationTableBody"
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.storageForm.addEventListener("submit", bookStorageReceipt);
  elements.switchUserButton.addEventListener("click", switchUser);
  elements.refreshLocationsButton.addEventListener("click", loadLocations);
  elements.locationSearchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(loadLocations, SEARCH_DEBOUNCE_MS);
  });
}

async function initialize() {
  if (!enforceStorageAccess()) return;
  try {
    setConnectionStatus(null);
    await apiJson("/api/health");
    serverOnline = true;
    setConnectionStatus(true);
    await loadLocations();
    setStatus("Bereit zum Einlagern.", "ok");
  } catch {
    serverOnline = false;
    setConnectionStatus(false);
    setStatus("Server nicht verbunden. Einlagerung ist nicht verfügbar.", "error");
  }
}

function enforceStorageAccess() {
  const userName = localStorage.getItem(USER_KEY) || "";
  const userGroup = localStorage.getItem(USER_GROUP_KEY) || "";
  if (!userName || !userGroup || userGroup === "lager") {
    window.location.replace("/");
    return false;
  }
  if (elements.currentUserName) elements.currentUserName.textContent = `${userName} - Büro`;
  return true;
}

function switchUser() {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(USER_GROUP_KEY);
  window.location.replace("/");
}

async function bookStorageReceipt(event) {
  event.preventDefault();
  if (!serverOnline) return setStatus("Server nicht verbunden.", "error");

  try {
    const receipt = {
      materialnummer: elements.materialnummerInput.value,
      lagerplatz: elements.lagerplatzInput.value,
      mengeStueck: elements.mengeStueckInput.value,
      leNummer: elements.leNummerInput.value
    };
    const result = await apiJson("/api/storage/receipts", {
      method: "POST",
      body: JSON.stringify({ receipt })
    });
    setStatus(`${result.movement.materialnummer} auf ${result.location.lagerplatz} eingelagert. Bestand: ${result.location.mengeStueck} Stück.`, "ok");
    elements.mengeStueckInput.value = "";
    elements.leNummerInput.value = "";
    await loadLocations();
  } catch (error) {
    setStatus(`Einlagern fehlgeschlagen: ${error.message}`, "error");
  }
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
    setStatus(`Stellplätze konnten nicht geladen werden: ${error.message}`, "error");
  }
}

function renderLocations(locations) {
  elements.locationTableBody.innerHTML = "";
  elements.locationCount.textContent = `${locations.length} Eintraege`;

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
    elements.locationTableBody.appendChild(row);
  });
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
  elements.storageStatus.textContent = message;
  elements.storageStatus.classList.toggle("is-ok", type === "ok");
  elements.storageStatus.classList.toggle("is-error", type === "error");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
