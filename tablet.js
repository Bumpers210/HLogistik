const API_BASE = "";
const USER_KEY = "tablet-pick-user-v1";
const MODE_KEY = "tablet-pick-mode-v1";
const SORT_MODE_KEY = "tablet-pick-sort-mode-v1";
const MAIN_USER_KEY = "kommissionier-app-user-v1";
const USER_GROUP_KEY = "kommissionier-app-user-group-v1";
const CURRENT_ORDER_CACHE_KEY = "tablet-pick-current-order-v1";
const ORDER_LIST_REFRESH_MS = 30000;
const AUTO_SAVE_MS = 10000;

const elements = {};
let currentOrder = null;
let serverOnline = false;
let currentMode = "picking";
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
  if (document.hidden) {
    persistCurrentOrderCache();
  } else if (serverOnline) {
    loadOrderList({ silent: true });
  }
});

function bindElements() {
  [
    "connectionStatus",
    "tabletTitle",
    "pickingModeButton",
    "storageModeButton",
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
    "storageLineActions",
    "addStorageLineButton",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.pickingModeButton.addEventListener("click", () => setMode("picking"));
  elements.storageModeButton.addEventListener("click", () => setMode("storage"));
  elements.userNameInput.addEventListener("change", () => {
    saveUser();
    renderTakeOverButton();
  });
  elements.userNameInput.addEventListener("keyup", renderTakeOverButton);
  elements.orderSelect.addEventListener("change", () => {
    const nextOrderId = elements.orderSelect.value;
    if (currentOrderLocksSwitch(nextOrderId)) {
      keepCurrentOrderSelected();
      return;
    }
    if (nextOrderId) {
      loadOrder(nextOrderId);
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
  elements.addStorageLineButton.addEventListener("click", addManualStorageLine);
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
    if (!orderListTimer) orderListTimer = window.setInterval(() => loadOrderList({ silent: true }), ORDER_LIST_REFRESH_MS);
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
      .filter((o) => (o.orderType || "picking") === currentMode);
    if (!cached.length) return false;
    renderCachedOrderList(cached);
    return true;
  } catch {
    return false;
  }
}

function renderCachedOrderList(orders) {
  clearSelect(elements.orderSelect);
  addOption(elements.orderSelect, "", `${modeLabel()} waehlen (Offline-Cache)`);
  orders.forEach((order) => {
    addOption(
      elements.orderSelect,
      order.id,
      `${order.orderNumber || order.id} - ${order.customerName || ""}${order.orderWarehouse ? ` - ${order.orderWarehouse}` : ""} (${order.picked}/${order.total}) [Cache]`
    );
  });
}

function loadUser() {
  try {
    elements.userNameInput.value = localStorage.getItem(USER_KEY) || localStorage.getItem(MAIN_USER_KEY) || "";
    currentMode = localStorage.getItem(MODE_KEY) === "storage" ? "storage" : "picking";
    elements.sortModeSelect.value = localStorage.getItem(SORT_MODE_KEY) || "fromBin";
    localStorage.setItem(USER_GROUP_KEY, "tablet");
  } catch {
    elements.userNameInput.value = "";
    currentMode = "picking";
    elements.sortModeSelect.value = "fromBin";
  }
  updateModeUi();
}

function saveUser() {
  try {
    const name = elements.userNameInput.value || "";
    localStorage.setItem(USER_KEY, name);
    localStorage.setItem(MAIN_USER_KEY, name);
    localStorage.setItem(USER_GROUP_KEY, "tablet");
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

function setMode(mode) {
  const nextMode = mode === "storage" ? "storage" : "picking";
  if (nextMode === currentMode) return;
  if (currentOrderLocksModeSwitch(nextMode)) {
    keepCurrentOrderSelected();
    return;
  }
  if (dirty && !window.confirm("Es gibt ungespeicherte Aenderungen. Bereich trotzdem wechseln?")) return;
  currentMode = nextMode;
  try {
    localStorage.setItem(MODE_KEY, currentMode);
  } catch {
    // Modus bleibt fuer diese Sitzung aktiv.
  }
  resetToStart(`Bitte ${modeLabel()} waehlen.`);
  updateModeUi();
  loadOrderList();
}

function modeLabel() {
  return currentMode === "storage" ? "Einlagerung" : "Kommissionierung";
}

function isStorageOrder() {
  return (currentOrder && (currentOrder.orderType || "picking") === "storage") || (!currentOrder && currentMode === "storage");
}

function updateModeUi() {
  const isStorage = isStorageOrder();
  if (elements.tabletTitle) elements.tabletTitle.textContent = isStorage ? "Tablet Einlagerung" : "Tablet Pickliste";
  if (elements.pickingModeButton) elements.pickingModeButton.classList.toggle("is-active", currentMode === "picking");
  if (elements.storageModeButton) elements.storageModeButton.classList.toggle("is-active", currentMode === "storage");
  if (elements.orderSelect && !elements.orderSelect.value && elements.orderSelect.options[0]) {
    elements.orderSelect.options[0].text = isStorage ? "Einlagerung waehlen" : "Auftrag waehlen";
  }
  if (elements.sortModeSelect && elements.sortModeSelect.options.length) {
    elements.sortModeSelect.options[0].text = isStorage ? "Stellplatz" : "Lagerplatz";
  }
  const grid = elements.pickHeader?.querySelector(".pick-column-grid");
  if (grid) {
    grid.innerHTML = isStorage
      ? "<span>Material</span><span>Stellplatz</span><span>Artikelbezeichnung</span><span>Soll</span><span>Ist</span><span>Einheit</span>"
      : "<span>Artikelnummer</span><span>Lagerplatz</span><span>Produktbeschreibung</span><span>Soll</span><span>Ist</span><span>Einheit</span>";
  }
  if (elements.exportPdfButton) elements.exportPdfButton.textContent = isStorage ? "Einlagerung abschliessen" : "PDF exportieren";
}

async function loadOrderList(options = {}) {
  const silent = options?.silent === true;
  if (!serverOnline) {
    await loadOrderListFromCache();
    return;
  }
  try {
    const orders = await apiJson("/api/orders");
    const selected = elements.orderSelect.value;
    clearSelect(elements.orderSelect);
    addOption(elements.orderSelect, "", currentMode === "storage" ? "Einlagerung waehlen" : "Auftrag waehlen");
    orders.forEach((order) => {
      if ((order.orderType || "picking") !== currentMode) return;
      if (!isOpenOrder(order)) return;
      addOption(
        elements.orderSelect,
        order.id,
        formatOrderOptionLabel(order)
      );
    });
    elements.orderSelect.value = selected;
    if (!silent) setMessage(currentOrder ? "Auftragsliste aktualisiert." : `Bitte ${modeLabel()} waehlen.`, false);
    try { if (window.OfflineStore) await OfflineStore.saveOrderSummaries(orders.filter((o) => (o.orderType || "picking") === currentMode)); } catch { /* non-critical */ }
  } catch (error) {
    if (!silent) setMessage(`Auftragsliste konnte nicht geladen werden: ${error.message}`, true);
  }
}

function isOpenOrder(order) {
  return !order.exportedAt;
}

async function loadOrder(id) {
  if (!id) return;
  if (currentOrderLocksSwitch(id)) {
    keepCurrentOrderSelected();
    return;
  }
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
      currentMode = (currentOrder.orderType || "picking") === "storage" ? "storage" : "picking";
      try {
        localStorage.setItem(MODE_KEY, currentMode);
      } catch { /* Modus bleibt fuer diese Sitzung aktiv. */ }
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
    currentOrder = cachedOrder ? mergeServerLoadingSlipLines(cachedOrder, order) : order;
    currentMode = (currentOrder.orderType || "picking") === "storage" ? "storage" : "picking";
    try {
      localStorage.setItem(MODE_KEY, currentMode);
    } catch { /* Modus bleibt fuer diese Sitzung aktiv. */ }
    currentOrder.collapseDone = currentOrder.collapseDone !== false;
    elements.collapseDoneInput.checked = currentOrder.collapseDone;
    dirty = Boolean(cachedOrder);
    renderOrder();
    if (cachedOrder) {
      setMessage("Lokaler Zwischenstand wiederhergestellt. Bitte speichern oder weiterarbeiten.", false);
      return;
    }
    setMessage(
      currentOrder.acceptedBy && !sameUserName(currentOrder.acceptedBy, currentUserName())
        ? `Auftrag geladen. Bereits von ${currentOrder.acceptedBy} uebernommen.`
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
  updateModeUi();
  renderTakeOverButton();
  if (!currentOrder || !currentOrder.lines || !currentOrder.lines.length) {
    elements.pickHeader.hidden = true;
    renderStorageLineActions();
    updateCounts();
    return;
  }
  elements.pickHeader.hidden = false;

  const sorted = sortOrderLines(currentOrder.lines);
  sorted.forEach((line) => elements.lineList.appendChild(renderLine(line)));
  renderStorageLineActions();
  updateCounts();
}

function renderStorageLineActions() {
  if (!elements.storageLineActions || !elements.addStorageLineButton) return;
  const isStorage = isStorageOrder();
  elements.storageLineActions.hidden = !isStorage || !currentOrder;
  elements.addStorageLineButton.disabled = !isStorage || !currentOrder;
}

function addManualStorageLine() {
  if (!currentOrder || !isStorageOrder()) return;
  if (!currentUserName()) {
    setMessage("Bitte erst Mitarbeiter eintragen.", true);
    return;
  }
  currentOrder.lines = Array.isArray(currentOrder.lines) ? currentOrder.lines : [];
  currentOrder.lines.push({
    id: createLineId(),
    orderType: "storage",
    manual: true,
    warehouseOrder: nextManualStoragePosition(currentOrder.lines),
    fromHandlingUnit: "",
    fromHandlingUnitEditable: true,
    positionNote: "",
    fromBin: "",
    product: "",
    description: "",
    targetQty: "",
    actualQty: "",
    unit: "Stk",
    picked: false
  });
  markDirty();
  renderOrder();
  saveOrder(false);
}

function nextManualStoragePosition(lines) {
  const numbers = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line.warehouseOrder || ""))
    .filter((value) => /^M\d+$/i.test(value))
    .map((value) => Number(value.replace(/\D/g, "")))
    .filter((value) => Number.isInteger(value) && value > 0);
  return `M${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
}

function createLineId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sortOrderLines(lines) {
  if (isStorageOrder()) return lines.slice();
  const sortMode = elements.sortModeSelect.value || "fromBin";
  const primary = sortMode === "product" ? "product" : "fromBin";
  const secondary = primary === "product" ? "fromBin" : "product";
  return lines.slice().sort((left, right) => {
    const leftLoadingSlip = left.lineType === "loading-slip";
    const rightLoadingSlip = right.lineType === "loading-slip";
    if (leftLoadingSlip && rightLoadingSlip) return 0;
    if (leftLoadingSlip && !rightLoadingSlip) return 1;
    if (!leftLoadingSlip && rightLoadingSlip) return -1;

    return compareLineValue(left[primary], right[primary]) ||
    compareLineValue(left[secondary], right[secondary]) ||
    compareLineValue(left.description, right.description);
  });
}

function compareLineValue(left, right) {
  return String(left || "").localeCompare(String(right || ""), "de", { numeric: true, sensitivity: "base" });
}

function sameUserName(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function currentOrderLocksSwitch(nextOrderId = "") {
  if (!currentOrder?.id || currentOrder.exportedAt) return false;
  if (String(nextOrderId || "") === String(currentOrder.id)) return false;
  const acceptedBy = String(currentOrder.acceptedBy || "").trim();
  return Boolean(acceptedBy && sameUserName(acceptedBy, currentUserName()));
}

function currentOrderLocksModeSwitch(nextMode) {
  if (!currentOrder?.id || currentOrder.exportedAt) return false;
  if ((currentOrder.orderType || "picking") === nextMode) return false;
  const acceptedBy = String(currentOrder.acceptedBy || "").trim();
  return Boolean(acceptedBy && sameUserName(acceptedBy, currentUserName()));
}

function keepCurrentOrderSelected() {
  elements.orderSelect.value = currentOrder?.id || "";
  setMessage(`Erst Auftrag ${lockedOrderLabel()} abschliessen: PDF auf dem Server erzeugen.`, true);
}

function lockedOrderLabel() {
  if (!currentOrder) return "";
  return [currentOrder.orderNumber, currentOrder.customerName]
    .filter(Boolean)
    .join(" - ") || currentOrder.id || "";
}

function formatOrderOptionLabel(order) {
  const status = orderStatusText(order);
  const warehouse = order.orderWarehouse ? ` - ${order.orderWarehouse}` : "";
  return `${order.orderNumber || order.id} - ${order.customerName || ""}${warehouse} [${status}] (${order.picked}/${order.total})`;
}

function orderStatusText(order) {
  if (order.completedAt && !order.exportedAt) return "Fertig, PDF fehlt";
  const acceptedBy = String(order?.acceptedBy || "").trim();
  if (acceptedBy) return sameUserName(acceptedBy, currentUserName()) ? "Von mir uebernommen" : `Von ${acceptedBy} uebernommen`;
  return "Frei";
}

function renderLine(line) {
  if (line.lineType === "loading-slip") return renderLoadingSlipLine(line);
  const isStorage = isStorageOrder();
  const isManualStorageLine = isStorage && line.manual === true;

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
  const canEditHandlingUnit = isStorage || line.fromHandlingUnitEditable === true || isMissingHandlingUnit;

  const top = document.createElement("div");
  top.className = "line-top";
  top.appendChild(makeInput(isStorage ? "Material" : "Produkt", line.product, (value) => {
    line.product = value.trim();
    markDirty();
  }, { readOnly: !isManualStorageLine, className: "short-input" }));
  top.appendChild(makeInput(isStorage ? "Stellplatz" : "Lagerplatz", line.fromBin, (value) => {
    line.fromBin = value.toUpperCase();
    markDirty();
  }, { readOnly: !isStorage, className: "short-input" }));
  top.appendChild(makeInput(isStorage ? "Artikelbezeichnung" : "Produktbeschreibung", line.description, (value) => {
    line.description = value;
    markDirty();
  }, { readOnly: !isManualStorageLine }));
  top.appendChild(makeInput("Soll", line.targetQty, (value) => {
    line.targetQty = value;
    if (!line.actualQty) line.actualQty = value;
    markDirty();
    updateCounts();
  }, { readOnly: !isManualStorageLine, className: "short-input" }));
  top.appendChild(
    makeInput(
      "Ist",
      line.actualQty,
      (value) => {
        line.actualQty = value;
        markDirty();
        updateCounts();
      },
      { readOnly: isStorage && !isManualStorageLine, className: "short-input" }
    )
  );
  top.appendChild(makeInput("Einheit", line.unit, (value) => {
    line.unit = value || "Stk";
    markDirty();
  }, { readOnly: !isManualStorageLine, className: "short-input" }));
  body.appendChild(top);

  const locationRow = document.createElement("div");
  locationRow.className = "location-row";
  locationRow.appendChild(
    makeInput(
      isStorage ? "HU" : "Von HU",
      line.fromHandlingUnit,
      (value) => {
        line.fromHandlingUnit = isStorage ? value.toUpperCase().replace(/[^A-Z0-9,-]/g, "") : value;
        line.fromHandlingUnitEditable = canEditHandlingUnit;
        markDirty();
      },
      { readOnly: !canEditHandlingUnit, digitsOnly: !isStorage }
    )
  );
  locationRow.appendChild(
    makeInput("Zusatzbemerkung", line.positionNote, (value) => {
      line.positionNote = value;
      markDirty();
    }, { readOnly: isStorage && !isManualStorageLine })
  );
  if (isManualStorageLine) locationRow.appendChild(makeManualStorageDeleteButton(line));
  body.appendChild(locationRow);

  card.appendChild(body);
  return card;
}

function renderLoadingSlipLine(line) {
  const card = document.createElement("article");
  card.className =
    "pick-item is-loading-slip" +
    (line.picked ? " is-done" : "") +
    (line.picked && currentOrder.collapseDone ? " is-collapsed" : "");

  const checkWrap = document.createElement("button");
  checkWrap.type = "button";
  checkWrap.className = `check-target${line.picked ? " is-picked" : ""}`;
  checkWrap.setAttribute("aria-pressed", line.picked ? "true" : "false");
  checkWrap.setAttribute("aria-label", line.picked ? "Position wieder oeffnen" : "Position abhaken");
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

  const top = document.createElement("div");
  top.className = "loading-slip-top";
  const barcode = document.createElement("div");
  barcode.className = "loading-slip-barcode";
  barcode.innerHTML = code128Svg(line.barcode || "");
  top.appendChild(barcode);
  top.appendChild(makeInput("Artikelnummer", line.product, () => {}, { readOnly: true, className: "short-input" }));
  top.appendChild(makeInput("Produktbeschreibung", line.description, () => {}, { readOnly: true }));
  top.appendChild(makeInput("Soll", line.targetQty, () => {}, { readOnly: true, className: "short-input" }));
  body.appendChild(top);

  const noteRow = document.createElement("div");
  noteRow.className = "location-row loading-slip-note-row";
  noteRow.appendChild(
    makeInput("Zusatzbemerkung", line.positionNote, (value) => {
      line.positionNote = value;
      markDirty();
    })
  );
  body.appendChild(noteRow);

  card.appendChild(body);
  return card;
}

function toggleLinePicked(line, card, button) {
  if (!line.picked && storageLineCompletionErrors(line).length) {
    setMessage(storageLineErrorMessage(line), true);
    return;
  }
  line.picked = !line.picked;
  updateLinePickedState(line, card, button);
  markDirty();
  updateCounts();
}

function makeManualStorageDeleteButton(line) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "danger-button manual-line-delete";
  button.textContent = "Zeile loeschen";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeManualStorageLine(line);
  });
  return button;
}

function removeManualStorageLine(line) {
  if (!currentOrder || !line || line.manual !== true) return;
  if (manualStorageLineHasContent(line) && !window.confirm("Manuell hinzugefuegte Zeile wirklich loeschen?")) return;
  currentOrder.lines = (Array.isArray(currentOrder.lines) ? currentOrder.lines : []).filter((entry) => entry.id !== line.id);
  markDirty();
  renderOrder();
  saveOrder(false);
}

function manualStorageLineHasContent(line) {
  return [
    line.product,
    line.description,
    line.targetQty,
    line.actualQty,
    line.fromHandlingUnit,
    line.fromBin,
    line.positionNote
  ].some((value) => String(value ?? "").trim());
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
  const acceptedBy = currentOrder ? String(currentOrder.acceptedBy || "").trim() : "";
  const user = currentUserName();
  const isMine = acceptedBy && sameUserName(acceptedBy, user);
  elements.takeOverButton.hidden = !hasOrder || isMine;
  elements.takeOverButton.disabled = !hasOrder || !user || !serverOnline;
  elements.takeOverButton.innerHTML = escapeHtml(
    acceptedBy ? `Von ${acceptedBy} uebernommen` : "Bearbeitung uebernehmen"
  );
}

async function acceptOrderOnServer(id) {
  if (!serverOnline) {
    setMessage("Auftrag kann nur mit Serververbindung uebernommen werden.", true);
    return null;
  }
  try {
    return await apiJson(`/api/orders/${encodeURIComponent(id)}/accept`, {
      method: "POST",
      body: JSON.stringify({ userName: currentUserName() }),
    });
  } catch (error) {
    setMessage(error.message || "Auftrag konnte nicht uebernommen werden.", true);
    await loadOrderList();
    return null;
  }
}

async function takeOverCurrentOrder() {
  if (!currentOrder || !currentOrder.id) {
    setMessage("Kein Auftrag ausgewählt.", true);
    return;
  }
  if (!currentUserName()) {
    setMessage("Bitte erst Mitarbeiter eintragen.", true);
    return;
  }
  const accepted = await acceptOrderOnServer(currentOrder.id);
  if (!accepted) return;
  currentOrder = accepted.order || currentOrder;
  currentOrder.collapseDone = currentOrder.collapseDone !== false;
  dirty = false;
  renderTakeOverButton();
  renderOrder();
  persistCurrentOrderCache();
  await loadOrderList({ silent: true });
  setMessage(acceptedOrderMessage(accepted), false);
}

function acceptedOrderMessage(result) {
  const count = Number(result?.acceptedCount || 0);
  if (count > 1) {
    return `${count} Auftraege fuer Kunde ${result.customerName || ""} uebernommen.`;
  }
  return "Bearbeitung uebernommen. Bitte diesen Auftrag abschliessen.";
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
        await OfflineStore.enqueue("PUT", url, JSON.stringify({ order: currentOrder, userName: currentUserName() }));
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
    const result = await apiJson(`/api/orders/${encodeURIComponent(currentOrder.id)}`, {
      method: "PUT",
      body: JSON.stringify({ order: currentOrder, userName: currentUserName() }),
    });
    currentOrder.acceptedBy = result.order?.acceptedBy || currentOrder.acceptedBy || "";
    currentOrder.acceptedAt = result.order?.acceptedAt || currentOrder.acceptedAt || "";
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
  pruneEmptyManualStorageLines();
  const validationMessage = storageOrderExportMessage();
  if (validationMessage) {
    renderOrder();
    setMessage(validationMessage, true);
    window.alert(validationMessage);
    return;
  }

  setMessage("PDF wird auf dem Server erstellt...", false);
  await saveOrder(true, async () => {
    try {
      await apiJson(`/api/orders/${encodeURIComponent(currentOrder.id)}/export-pdf`, {
        method: "POST",
        body: JSON.stringify({ order: currentOrder, userName: currentUserName() }),
      });
      dirty = false;
      clearCurrentOrderCache();
      loadTabletStartPage();
    } catch (error) {
      setMessage(`PDF-Export fehlgeschlagen: ${error.message}`, true);
    }
  });
}

function loadTabletStartPage() {
  resetToStart("PDF erfolgreich exportiert. Bitte Auftrag waehlen.");
  window.location.href = `${window.location.pathname || "/tablet.html"}?start=${Date.now()}`;
}

function resetToStart(message) {
  clearCurrentOrderCache();
  currentOrder = null;
  dirty = false;
  elements.orderSelect.value = "";
  elements.collapseDoneInput.checked = true;
  renderOrder();
  setMessage(message || "Bitte Auftrag waehlen.", false);
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

function mergeServerLoadingSlipLines(order, serverOrder) {
  if (!order || !Array.isArray(order.lines) || !Array.isArray(serverOrder?.lines)) return order;

  const serverLoadingSlipLines = serverOrder.lines
    .filter((line) => line?.lineType === "loading-slip" && String(line.barcode || "").trim());
  if (!serverLoadingSlipLines.length) return order;

  const previousByBarcode = new Map(
    order.lines
      .filter((line) => line?.lineType === "loading-slip" && String(line.barcode || "").trim())
      .map((line) => [String(line.barcode || "").trim(), line])
  );
  const normalLines = order.lines.filter((line) => line?.lineType !== "loading-slip");
  const mergedLoadingSlipLines = serverLoadingSlipLines.map((line) => {
    const previous = previousByBarcode.get(String(line.barcode || "").trim());
    return {
      ...line,
      picked: previous?.picked ?? line.picked,
      positionNote: String(previous?.positionNote || "").trim() || line.positionNote || ""
    };
  });

  return {
    ...order,
    lines: [...normalLines, ...mergedLoadingSlipLines]
  };
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
  return lines.length > 0 && lines.every((line) => isEmptyManualStorageLine(line) || line.picked);
}

function pruneEmptyManualStorageLines() {
  if (!currentOrder || !Array.isArray(currentOrder.lines)) return;
  const before = currentOrder.lines.length;
  currentOrder.lines = currentOrder.lines.filter((line) => !isEmptyManualStorageLine(line));
  if (currentOrder.lines.length !== before) markDirty();
}

function storageOrderExportMessage() {
  if (!isStorageOrder() || !currentOrder) return "";
  const errors = [];
  (Array.isArray(currentOrder.lines) ? currentOrder.lines : []).forEach((line, index) => {
    if (isEmptyManualStorageLine(line)) return;
    storageLineCompletionErrors(line).forEach((error) => {
      errors.push(`Pos. ${storageLinePosition(line, index)}: ${error}`);
    });
  });
  if (!errors.length) return "";
  return `Einlagerung unvollstaendig: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? "; weitere Fehler vorhanden" : ""}`;
}

function storageLineErrorMessage(line) {
  return `Position kann noch nicht erledigt werden: ${storageLineCompletionErrors(line).join(", ")}`;
}

function storageLineCompletionErrors(line) {
  if (!isStorageOrder() || !line || line.lineType === "loading-slip" || isEmptyManualStorageLine(line)) return [];
  const errors = [];
  if (!String(line.product || "").trim()) errors.push("Artikelnummer fehlt");
  if (!String(line.description || "").trim()) errors.push("Artikelbezeichnung fehlt");
  if (!String(line.fromBin || "").trim()) errors.push("Stellplatz fehlt");
  if (!readTabletQuantity(line.actualQty || line.targetQty)) errors.push("Menge fehlt");
  return errors;
}

function readTabletQuantity(value) {
  const number = Number(String(value || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) && number > 0;
}

function storageLinePosition(line, index) {
  return line.warehouseOrder || index + 1;
}

function isEmptyManualStorageLine(line) {
  return line?.manual === true && !manualStorageLineHasContent(line);
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

function code128Svg(value) {
  const barcode = String(value || "").trim();
  if (!barcode) return `<span class="loading-slip-empty">Kein Barcode</span>`;

  const patterns = [
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
    "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
    "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
    "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
    "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
    "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
    "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
    "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
    "114131", "311141", "411131", "211412", "211214", "211232", "2331112"
  ];
  const codes = [104];
  for (const char of barcode) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) continue;
    codes.push(code - 32);
  }
  if (codes.length === 1) return `<span class="loading-slip-empty">Barcode ungueltig</span>`;

  const checksum = codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103;
  codes.push(checksum, 106);

  let x = 10;
  let bars = "";
  codes.forEach((code) => {
    const pattern = patterns[code];
    if (!pattern) return;
    [...pattern].forEach((widthText, index) => {
      const width = Number(widthText);
      if (index % 2 === 0) bars += `<rect x="${x}" y="0" width="${width}" height="44"></rect>`;
      x += width;
    });
  });

  const width = x + 10;
  return `<svg class="code128" viewBox="0 0 ${width} 58" role="img" aria-label="Barcode ${escapeHtmlAttribute(barcode)}">
    <g fill="#111">${bars}</g>
    <text x="${width / 2}" y="56" text-anchor="middle">${escapeSvgText(barcode)}</text>
  </svg>`;
}

function escapeSvgText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeSvgText(value).replace(/"/g, "&quot;");
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
