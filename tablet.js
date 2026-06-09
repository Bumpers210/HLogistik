const API_BASE = "";
const USER_KEY = "tablet-pick-user-v1";
const SORT_MODE_KEY = "tablet-pick-sort-mode-v1";
const MAIN_USER_KEY = "kommissionier-app-user-v1";
const USER_GROUP_KEY = "kommissionier-app-user-group-v1";
const CURRENT_ORDER_CACHE_KEY = "tablet-pick-current-order-v1";
const ORDER_LIST_REFRESH_MS = 120000;
const AUTO_SAVE_MS = 10000;

const elements = {};
let currentOrder = null;
let serverOnline = false;
let dirty = false;
let orderListTimer = null;
let saveTimer = null;
let changeRevision = 0;

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  loadUser();
  initialize();
});

window.addEventListener("online", () => {
  if (!serverOnline) initialize();
});

window.addEventListener("pagehide", persistCurrentOrderCache);
window.addEventListener("beforeunload", persistCurrentOrderCache);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) persistCurrentOrderCache();
});

function bindElements() {
  [
    "connectionStatus",
    "userNameInput",
    "orderSelect",
    "sortModeSelect",
    "refreshButton",
    "takeOverButton",
    "saveButton",
    "exportPdfButton",
    "collapseDoneInput",
    "doneCount",
    "openCount",
    "changedCount",
    "message",
    "pickHeader",
    "lineList",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.userNameInput.addEventListener("change", () => {
    saveUser();
    renderTakeOverButton();
  });
  elements.userNameInput.addEventListener("keyup", renderTakeOverButton);
  elements.orderSelect.addEventListener("change", () => {
    if (elements.orderSelect.value) {
      loadOrder(elements.orderSelect.value);
      return;
    }
    resetToStart("Bitte Auftrag wählen.");
  });
  elements.sortModeSelect.addEventListener("change", () => {
    saveSortMode();
    renderOrder();
  });
  elements.refreshButton.addEventListener("click", loadOrderList);
  elements.takeOverButton.addEventListener("click", takeOverCurrentOrder);
  elements.saveButton.addEventListener("click", () => saveOrder(false));
  elements.exportPdfButton.addEventListener("click", exportPdf);
  elements.collapseDoneInput.addEventListener("change", () => {
    if (!currentOrder) return;
    currentOrder.collapseDone = elements.collapseDoneInput.checked;
    persistCurrentOrderCache();
    renderOrder();
  });
}

async function initialize() {
  setConnectionStatus(null);
  try {
    await apiJson("/api/health");
    serverOnline = true;
    setConnectionStatus(true);
    await flushSyncQueue();
    loadOrderList();
    if (!orderListTimer) orderListTimer = window.setInterval(loadOrderList, ORDER_LIST_REFRESH_MS);
    if (!saveTimer) {
      saveTimer = window.setInterval(async () => {
        if (dirty) await saveOrder(true);
        if (!serverOnline) return;
        // Retry queue after auto-save interval when back online
        const pending = window.OfflineStore ? await OfflineStore.getPending().catch(() => []) : [];
        if (pending.length) await flushSyncQueue();
      }, AUTO_SAVE_MS);
    }
  } catch {
    serverOnline = false;
    setConnectionStatus(false);
    const cached = await loadOrderListFromCache();
    setMessage(cached ? "Offline: Auftragsliste aus Cache." : "Server nicht verbunden.", !cached);
  }
}

async function flushSyncQueue() {
  if (!window.OfflineStore) return;
  try {
    const pending = await OfflineStore.getPending();
    if (!pending.length) return;

    const latestByUrl = new Map();
    pending.forEach((item) => {
      const existing = latestByUrl.get(item.url);
      if (!existing || item.timestamp > existing.timestamp) latestByUrl.set(item.url, item);
    });

    let synced = 0;
    for (const [, item] of latestByUrl) {
      try {
        await apiJson(item.url, { method: item.method, body: item.body });
        synced++;
      } catch { /* weiter */ }
    }
    await OfflineStore.clearQueue();
    if (synced > 0) setMessage(`${synced} Offline-Änderung${synced !== 1 ? "en" : ""} synchronisiert.`, false);
  } catch { /* non-critical */ }
}

async function loadOrderListFromCache() {
  if (!window.OfflineStore) return false;
  try {
    const cached = (await OfflineStore.loadOrderSummaries())
      .filter((o) => (o.orderType || "picking") === "picking");
    if (!cached.length) return false;
    renderCachedOrderList(cached);
    return true;
  } catch {
    return false;
  }
}

function renderCachedOrderList(orders) {
  clearSelect(elements.orderSelect);
  addOption(elements.orderSelect, "", "Auftrag wählen (Offline-Cache)");
  orders.forEach((order) => {
    addOption(
      elements.orderSelect,
      order.id,
      `${order.orderNumber || order.id} - ${order.customerName || ""} (${order.picked}/${order.total}) [Cache]`
    );
  });
}

function loadUser() {
  try {
    elements.userNameInput.value = localStorage.getItem(USER_KEY) || localStorage.getItem(MAIN_USER_KEY) || "";
    elements.sortModeSelect.value = localStorage.getItem(SORT_MODE_KEY) || "fromBin";
  } catch {
    elements.userNameInput.value = "";
    elements.sortModeSelect.value = "fromBin";
  }
}

function saveUser() {
  try {
    const name = elements.userNameInput.value || "";
    localStorage.setItem(USER_KEY, name);
    localStorage.setItem(MAIN_USER_KEY, name);
  } catch {
    // Alte Browser können lokalen Speicher blockieren; die Pickliste bleibt trotzdem nutzbar.
  }
}

function saveSortMode() {
  try {
    localStorage.setItem(SORT_MODE_KEY, elements.sortModeSelect.value || "fromBin");
  } catch {
    // Sortierung bleibt auch ohne lokalen Speicher fuer die aktuelle Sitzung aktiv.
  }
}

async function loadOrderList() {
  if (!serverOnline) {
    await loadOrderListFromCache();
    return;
  }
  try {
    const orders = await apiJson("/api/orders");
    const selected = elements.orderSelect.value;
    clearSelect(elements.orderSelect);
    addOption(elements.orderSelect, "", "Auftrag wählen");
    orders.forEach((order) => {
      if ((order.orderType || "picking") !== "picking") return;
      addOption(
        elements.orderSelect,
        order.id,
        formatOrderOptionLabel(order)
      );
    });
    elements.orderSelect.value = selected;
    setMessage(currentOrder ? "Auftragsliste aktualisiert." : "Bitte Auftrag wählen.", false);
    try { if (window.OfflineStore) await OfflineStore.saveOrderSummaries(orders.filter((o) => (o.orderType || "picking") === "picking")); } catch { /* non-critical */ }
  } catch (error) {
    setMessage(`Auftragsliste konnte nicht geladen werden: ${error.message}`, true);
  }
}

async function loadOrder(id) {
  if (!id) return;
  if (dirty && !window.confirm("Es gibt ungespeicherte Änderungen. Auftrag trotzdem wechseln?")) {
    elements.orderSelect.value = currentOrder ? currentOrder.id : "";
    return;
  }

  if (!serverOnline) {
    if (!window.OfflineStore) return;
    try {
      const cached = await OfflineStore.loadOrder(id);
      if (!cached) {
        setMessage("Offline: Dieser Auftrag ist nicht im lokalen Cache vorhanden.", true);
        return;
      }
      currentOrder = cached;
      currentOrder.collapseDone = currentOrder.collapseDone !== false;
      elements.collapseDoneInput.checked = currentOrder.collapseDone;
      dirty = false;
      renderOrder();
      setMessage("Offline: Auftrag aus Cache geladen. Änderungen werden bei Verbindung synchronisiert.", false);
    } catch (error) {
      setMessage(`Cache-Fehler: ${error.message}`, true);
    }
    return;
  }

  try {
    const order = await apiJson(`/api/orders/${encodeURIComponent(id)}`);
    const cachedOrder = restoreCachedOrderFor(order);
    currentOrder = cachedOrder || order;
    currentOrder.collapseDone = currentOrder.collapseDone !== false;
    elements.collapseDoneInput.checked = currentOrder.collapseDone;
    dirty = Boolean(cachedOrder);
    renderOrder();
    if (cachedOrder) {
      setMessage("Lokaler Zwischenstand wiederhergestellt. Bitte speichern oder weiterarbeiten.", false);
      return;
    }
    setMessage(
      currentOrder.activeUser && currentOrder.activeUser !== currentUserName()
        ? `Auftrag geladen. Aktuell in Bearbeitung: ${currentOrder.activeUser}.`
        : "Auftrag geladen.",
      false
    );
    persistCurrentOrderCache();
    try { if (window.OfflineStore) await OfflineStore.saveOrder(order); } catch { /* non-critical */ }
  } catch (error) {
    setMessage(`Auftrag konnte nicht geladen werden: ${error.message}`, true);
  }
}

function renderOrder() {
  elements.lineList.innerHTML = "";
  renderTakeOverButton();
  if (!currentOrder || !currentOrder.lines || !currentOrder.lines.length) {
    elements.pickHeader.hidden = true;
    updateCounts();
    return;
  }
  elements.pickHeader.hidden = false;

  const sorted = sortOrderLines(currentOrder.lines);
  sorted.forEach((line) => elements.lineList.appendChild(renderLine(line)));
  updateCounts();
}

function sortOrderLines(lines) {
  const sortMode = elements.sortModeSelect.value || "fromBin";
  const primary = sortMode === "product" ? "product" : "fromBin";
  const secondary = primary === "product" ? "fromBin" : "product";
  return lines.slice().sort((left, right) =>
    compareLineValue(left[primary], right[primary]) ||
    compareLineValue(left[secondary], right[secondary]) ||
    compareLineValue(left.description, right.description)
  );
}

function compareLineValue(left, right) {
  return String(left || "").localeCompare(String(right || ""), "de", { numeric: true, sensitivity: "base" });
}

function formatOrderOptionLabel(order) {
  const status = orderStatusText(order);
  return `${order.orderNumber || order.id} - ${order.customerName || ""} [${status}] (${order.picked}/${order.total})`;
}

function orderStatusText(order) {
  if (order.completedAt && !order.exportedAt) return "Fertig, PDF fehlt";
  const activeUser = String(order?.activeUser || "").trim();
  if (!activeUser) return "Frei";
  return activeUser === currentUserName() ? "Bearbeitet von mir" : `Bearbeitet von ${activeUser}`;
}

function renderLine(line) {
  const card = document.createElement("article");
  card.className =
    "pick-item" +
    (line.picked ? " is-done" : "") +
    (line.picked && currentOrder.collapseDone ? " is-collapsed" : "");

  const checkWrap = document.createElement("button");
  checkWrap.type = "button";
  checkWrap.className = `check-target${line.picked ? " is-picked" : ""}`;
  checkWrap.setAttribute("aria-pressed", line.picked ? "true" : "false");
  checkWrap.setAttribute("aria-label", line.picked ? "Position wieder öffnen" : "Position abhaken");
  const checkmark = document.createElement("span");
  checkmark.className = "checkmark";
  checkmark.setAttribute("aria-hidden", "true");
  checkWrap.appendChild(checkmark);
  checkWrap.addEventListener("click", (event) => {
    event.preventDefault();
    toggleLinePicked(line, card, checkWrap);
  });
  card.appendChild(checkWrap);

  const body = document.createElement("div");
  body.className = "line-body";

  const isMissingHandlingUnit = !String(line.fromHandlingUnit || "").trim();
  const canEditHandlingUnit = line.fromHandlingUnitEditable === true || isMissingHandlingUnit;

  const top = document.createElement("div");
  top.className = "line-top";
  top.appendChild(makeInput("Produkt", line.product, () => {}, { readOnly: true, className: "short-input" }));
  top.appendChild(makeInput("Lagerplatz", line.fromBin, () => {}, { readOnly: true, className: "short-input" }));
  top.appendChild(makeInput("Produktbeschreibung", line.description, () => {}, { readOnly: true }));
  top.appendChild(makeInput("Soll", line.targetQty, () => {}, { readOnly: true, className: "short-input" }));
  top.appendChild(
    makeInput(
      "Ist",
      line.actualQty,
      (value) => {
        line.actualQty = value;
        markDirty();
        updateCounts();
      },
      { className: "short-input" }
    )
  );
  top.appendChild(makeInput("Einheit", line.unit, () => {}, { readOnly: true, className: "short-input" }));
  body.appendChild(top);

  const locationRow = document.createElement("div");
  locationRow.className = "location-row";
  locationRow.appendChild(
    makeInput(
      "Von HU",
      line.fromHandlingUnit,
      (value) => {
        line.fromHandlingUnit = value;
        line.fromHandlingUnitEditable = canEditHandlingUnit;
        markDirty();
      },
      { readOnly: !canEditHandlingUnit, digitsOnly: true }
    )
  );
  locationRow.appendChild(
    makeInput("Zusatzbemerkung", line.positionNote, (value) => {
      line.positionNote = value;
      markDirty();
    })
  );
  body.appendChild(locationRow);

  card.appendChild(body);
  return card;
}

function toggleLinePicked(line, card, button) {
  line.picked = !line.picked;
  updateLinePickedState(line, card, button);
  markDirty();
  updateCounts();
}

function updateLinePickedState(line, card, button) {
  const picked = Boolean(line.picked);
  card.classList.toggle("is-done", picked);
  card.classList.remove("is-collapsed");
  button.classList.toggle("is-picked", picked);
  button.setAttribute("aria-pressed", picked ? "true" : "false");
  button.setAttribute("aria-label", picked ? "Position wieder öffnen" : "Position abhaken");
  if (picked && currentOrder && currentOrder.collapseDone) {
    window.setTimeout(() => {
      if (line.picked && currentOrder && currentOrder.collapseDone) card.classList.add("is-collapsed");
    }, 180);
  }
}

function makeInput(labelText, value, onChange, options = {}) {
  const label = document.createElement("label");
  label.appendChild(document.createTextNode(labelText));
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.className = options.className || "";
  if (options.readOnly) {
    input.readOnly = true;
    input.setAttribute("readonly", "");
    input.className = (input.className ? `${input.className} ` : "") + "readonly-input";
  }
  const handleChange = () => {
    if (input.readOnly) return;
    if (options.digitsOnly) input.value = input.value.replace(/[^0-9,]/g, "");
    onChange(input.value);
  };
  input.addEventListener("change", handleChange);
  input.addEventListener("keyup", handleChange);
  label.appendChild(input);
  return label;
}

function renderTakeOverButton() {
  if (!elements.takeOverButton) return;
  const hasOrder = Boolean(currentOrder && currentOrder.id && currentOrder.lines && currentOrder.lines.length);
  const activeUser = currentOrder ? String(currentOrder.activeUser || "").trim() : "";
  const user = currentUserName();
  const isMine = activeUser && activeUser === user;
  elements.takeOverButton.hidden = !hasOrder || isMine;
  elements.takeOverButton.disabled = !hasOrder || !user || !serverOnline;
  elements.takeOverButton.innerHTML = escapeHtml(
    activeUser ? `Bearbeitung von ${activeUser} übernehmen` : "Bearbeitung übernehmen"
  );
}

function takeOverCurrentOrder() {
  if (!currentOrder || !currentOrder.id) {
    setMessage("Kein Auftrag ausgewählt.", true);
    return;
  }
  if (!currentUserName()) {
    setMessage("Bitte erst Mitarbeiter eintragen.", true);
    return;
  }
  touchOrder();
  dirty = true;
  renderTakeOverButton();
  saveOrder(false);
}

function markDirty() {
  dirty = true;
  changeRevision += 1;
  touchOrder();
  persistCurrentOrderCache();
  setMessage("Änderungen noch nicht gespeichert.", false);
}

function touchOrder() {
  if (!currentOrder) return;
  const user = currentUserName() || "Tablet";
  const now = new Date().toISOString();
  currentOrder.createdBy = currentOrder.createdBy || user;
  currentOrder.lastEditedBy = user;
  currentOrder.activeUser = user;
  currentOrder.activeUserAt = now;

  if (currentOrder.lines.length && allPicked()) {
    currentOrder.completedBy = currentOrder.completedBy || user;
    currentOrder.completedAt = currentOrder.completedAt || now;
  } else {
    currentOrder.completedBy = "";
    currentOrder.completedAt = "";
  }
}

function currentUserName() {
  return String(elements.userNameInput.value || "").trim();
}

async function saveOrder(silent, onSuccess) {
  if (!currentOrder || !currentOrder.id) return;
  touchOrder();
  persistCurrentOrderCache();
  const revision = changeRevision;

  if (!serverOnline) {
    if (window.OfflineStore) {
      try {
        const url = `/api/orders/${encodeURIComponent(currentOrder.id)}`;
        await OfflineStore.enqueue("PUT", url, JSON.stringify({ order: currentOrder }));
        await OfflineStore.saveOrder(currentOrder);
        dirty = false;
        if (!silent) setMessage("Offline gespeichert – wird synchronisiert, sobald der Server erreichbar ist.", false);
      } catch {
        if (!silent) setMessage("Offline: Lokales Speichern fehlgeschlagen.", true);
      }
    } else {
      if (!silent) setMessage("Server nicht verbunden.", true);
    }
    return;
  }

  try {
    await apiJson(`/api/orders/${encodeURIComponent(currentOrder.id)}`, {
      method: "PUT",
      body: JSON.stringify({ order: currentOrder }),
    });
    if (changeRevision === revision) {
      dirty = false;
      clearCurrentOrderCache();
    } else {
      dirty = true;
      persistCurrentOrderCache();
    }
    setMessage(silent ? "Automatisch gespeichert." : "Auftrag gespeichert.", false);
    loadOrderList();
    if (onSuccess) onSuccess();
  } catch (error) {
    setMessage(`Speichern fehlgeschlagen: ${error.message}`, true);
  }
}

async function exportPdf() {
  if (!currentOrder || !currentOrder.id) {
    setMessage("Kein Auftrag ausgewählt.", true);
    return;
  }
  if (!serverOnline) {
    setMessage("PDF kann nur am Server exportiert werden.", true);
    return;
  }
  if (!currentUserName()) {
    setMessage("Bitte erst Mitarbeiter eintragen.", true);
    return;
  }

  setMessage("PDF wird auf dem Server erstellt...", false);
  await saveOrder(true, async () => {
    try {
      await apiJson(`/api/orders/${encodeURIComponent(currentOrder.id)}/export-pdf`, {
        method: "POST",
        body: JSON.stringify({ order: currentOrder }),
      });
      dirty = false;
      clearCurrentOrderCache();
      resetToStart("PDF erfolgreich exportiert. Bitte Auftrag wählen.");
      loadOrderList();
    } catch (error) {
      setMessage(`PDF-Export fehlgeschlagen: ${error.message}`, true);
    }
  });
}

function resetToStart(message) {
  clearCurrentOrderCache();
  currentOrder = null;
  dirty = false;
  elements.orderSelect.value = "";
  elements.collapseDoneInput.checked = true;
  renderOrder();
  setMessage(message || "Bitte Auftrag wählen.", false);
}

function persistCurrentOrderCache() {
  if (!currentOrder || !currentOrder.id) return;
  try {
    localStorage.setItem(CURRENT_ORDER_CACHE_KEY, JSON.stringify({
      orderId: currentOrder.id,
      cachedAt: new Date().toISOString(),
      dirty: dirty === true,
      order: currentOrder,
    }));
  } catch {
    // Der Auftrag bleibt im Speicher; nur die Absturzsicherung ist dann nicht verfuegbar.
  }
}

function clearCurrentOrderCache() {
  try {
    localStorage.removeItem(CURRENT_ORDER_CACHE_KEY);
  } catch {
    // Nicht kritisch.
  }
}

function restoreCachedOrderFor(serverOrder) {
  const payload = loadCachedOrderPayload();
  if (!payload || !payload.order || !serverOrder || !serverOrder.id) return null;
  if (payload.dirty !== true) return null;
  if (String(payload.orderId || payload.order.id) !== String(serverOrder.id)) return null;
  if (serverOrder.exportedAt) return null;
  if (!Array.isArray(payload.order.lines) || !Array.isArray(serverOrder.lines)) return null;
  if (payload.order.lines.length !== serverOrder.lines.length) return null;
  const cachedAt = dateToMs(payload.cachedAt);
  const serverAt = dateToMs(serverOrder.updatedAt || serverOrder.activeUserAt || serverOrder.createdAt);
  if (serverAt && cachedAt <= serverAt) return null;
  return payload.order;
}

function loadCachedOrderPayload() {
  try {
    const raw = localStorage.getItem(CURRENT_ORDER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function dateToMs(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function updateCounts() {
  const lines = currentOrder && currentOrder.lines ? currentOrder.lines : [];
  let done = 0;
  let changed = 0;
  lines.forEach((line) => {
    if (line.picked) done += 1;
    if (String(line.actualQty || "").trim() !== String(line.targetQty || "").trim()) changed += 1;
  });
  elements.doneCount.innerHTML = done;
  elements.openCount.innerHTML = Math.max(lines.length - done, 0);
  elements.changedCount.innerHTML = changed;
}

function allPicked() {
  const lines = currentOrder && currentOrder.lines ? currentOrder.lines : [];
  return lines.length > 0 && lines.every((line) => line.picked);
}

function setConnectionStatus(value) {
  elements.connectionStatus.className = "connection-status";
  if (value === true) {
    elements.connectionStatus.className += " is-online";
    elements.connectionStatus.innerHTML = "Online";
  } else if (value === false) {
    elements.connectionStatus.className += " is-offline";
    elements.connectionStatus.innerHTML = "Offline";
  } else {
    elements.connectionStatus.innerHTML = "Prüfe Verbindung";
  }
}

function setMessage(text, isError) {
  elements.message.className = `message${isError ? " is-error" : ""}`;
  elements.message.innerHTML = escapeHtml(text);
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

function clearSelect(select) {
  while (select.options.length) select.remove(0);
}

function addOption(select, value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.text = text;
  select.add(option);
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
