var API_BASE = "";
var USER_KEY = "tablet-pick-user-v1";
var MODE_KEY = "tablet-pick-mode-v1";
var SORT_MODE_KEY = "tablet-pick-sort-mode-v1";
var MAIN_USER_KEY = "kommissionier-app-user-v1";
var USER_GROUP_KEY = "kommissionier-app-user-group-v1";
var CURRENT_ORDER_CACHE_KEY = "tablet-pick-current-order-v1";
var ORDER_LIST_REFRESH_MS = 30000;
var AUTO_SAVE_MS = 2500;

var elements = {};
var currentOrder = null;
var serverOnline = false;
var currentMode = "picking";
var dirty = false;
var orderListTimer = null;
var autoSaveTimer = null;
var savingOrder = false;
var changeRevision = 0;

document.addEventListener("DOMContentLoaded", function () {
  bindElements();
  bindEvents();
  loadUser();
  renderCompletionFields();
  initialize();
});

window.addEventListener("pagehide", persistCurrentOrderCache);
window.addEventListener("beforeunload", persistCurrentOrderCache);
document.addEventListener("visibilitychange", function () {
  if (document.hidden) {
    persistCurrentOrderCache();
  } else if (serverOnline) {
    loadOrderList({ silent: true });
  }
});

function bindElements() {
  var ids = [
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
    "euroPalletsInput",
    "storageSpacesInput",
    "orderNoteInput",
    "doneCount",
    "openCount",
    "changedCount",
    "message",
    "pickHeader",
    "lineList",
    "storageLineActions",
    "addStorageLineButton"
  ];
  for (var index = 0; index < ids.length; index += 1) {
    elements[ids[index]] = document.getElementById(ids[index]);
  }
}

function bindEvents() {
  elements.pickingModeButton.onclick = function () { setMode("picking"); };
  elements.storageModeButton.onclick = function () { setMode("storage"); };
  elements.userNameInput.onchange = function () {
    saveUser();
    renderTakeOverButton();
  };
  elements.userNameInput.onkeyup = renderTakeOverButton;
  elements.orderSelect.onchange = function () {
    var nextOrderId = elements.orderSelect.value;
    if (currentOrderLocksSwitch(nextOrderId)) {
      keepCurrentOrderSelected();
      return;
    }
    if (nextOrderId) {
      loadOrder(nextOrderId);
    } else {
      resetToStart("Bitte Auftrag waehlen.");
    }
  };
  elements.sortModeSelect.onchange = function () {
    saveSortMode();
    renderOrder();
  };
  elements.refreshButton.onclick = loadOrderList;
  elements.takeOverButton.onclick = takeOverCurrentOrder;
  elements.saveButton.onclick = function () { saveOrder(false); };
  elements.exportPdfButton.onclick = exportPdf;
  elements.addStorageLineButton.onclick = addManualStorageLine;
  elements.collapseDoneInput.onchange = function () {
    if (!currentOrder) return;
    currentOrder.collapseDone = elements.collapseDoneInput.checked;
    persistCurrentOrderCache();
    renderOrder();
  };
  elements.euroPalletsInput.onchange = updateCompletionFieldsFromInputs;
  elements.euroPalletsInput.onkeyup = updateCompletionFieldsFromInputs;
  elements.storageSpacesInput.onchange = updateCompletionFieldsFromInputs;
  elements.storageSpacesInput.onkeyup = updateCompletionFieldsFromInputs;
  elements.orderNoteInput.onchange = updateCompletionFieldsFromInputs;
  elements.orderNoteInput.onkeyup = updateCompletionFieldsFromInputs;
}

function initialize() {
  setConnectionStatus(null);
  apiJson("/api/health", null, function () {
    serverOnline = true;
    setConnectionStatus(true);
    loadOrderList();
    if (!orderListTimer) orderListTimer = window.setInterval(function () { loadOrderList({ silent: true }); }, ORDER_LIST_REFRESH_MS);
  }, function (message) {
    serverOnline = false;
    setConnectionStatus(false);
    setMessage("Server nicht verbunden: " + message, true);
  });
}

function loadUser() {
  try {
    elements.userNameInput.value = localStorage.getItem(USER_KEY) || localStorage.getItem(MAIN_USER_KEY) || "";
    currentMode = localStorage.getItem(MODE_KEY) === "storage" ? "storage" : "picking";
    elements.sortModeSelect.value = localStorage.getItem(SORT_MODE_KEY) || "fromBin";
    localStorage.setItem(USER_GROUP_KEY, "tablet");
  } catch (error) {
    void error;
    elements.userNameInput.value = "";
    currentMode = "picking";
    elements.sortModeSelect.value = "fromBin";
  }
  updateModeUi();
}

function saveUser() {
  try {
    var name = elements.userNameInput.value || "";
    localStorage.setItem(USER_KEY, name);
    localStorage.setItem(MAIN_USER_KEY, name);
    localStorage.setItem(USER_GROUP_KEY, "tablet");
  } catch (error) {
    void error;
    // Lokaler Speicher ist auf alten Browsern manchmal eingeschraenkt.
  }
}

function saveSortMode() {
  try {
    localStorage.setItem(SORT_MODE_KEY, elements.sortModeSelect.value || "fromBin");
  } catch (error) {
    void error;
  }
}

function setMode(mode) {
  var nextMode = mode === "storage" ? "storage" : "picking";
  if (nextMode === currentMode) return;
  if (currentOrderLocksModeSwitch(nextMode)) {
    keepCurrentOrderSelected();
    return;
  }
  if (dirty && !window.confirm("Es gibt ungespeicherte Aenderungen. Bereich trotzdem wechseln?")) return;
  currentMode = nextMode;
  try {
    localStorage.setItem(MODE_KEY, currentMode);
  } catch (error) {
    void error;
  }
  resetToStart("Bitte " + modeLabel() + " waehlen.");
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
  var isStorage = isStorageOrder();
  if (elements.tabletTitle) elements.tabletTitle.textContent = isStorage ? "Tablet Einlagerung" : "Tablet Pickliste";
  if (elements.pickingModeButton) elements.pickingModeButton.className = currentMode === "picking" ? "is-active" : "";
  if (elements.storageModeButton) elements.storageModeButton.className = currentMode === "storage" ? "is-active" : "";
  if (elements.orderSelect && !elements.orderSelect.value && elements.orderSelect.options[0]) {
    elements.orderSelect.options[0].text = isStorage ? "Einlagerung waehlen" : "Auftrag waehlen";
  }
  if (elements.sortModeSelect && elements.sortModeSelect.options.length) {
    elements.sortModeSelect.options[0].text = isStorage ? "Stellplatz" : "Lagerplatz";
  }
  var grid = elements.pickHeader && elements.pickHeader.querySelector(".pick-column-grid");
  if (grid) {
    grid.innerHTML = isStorage
      ? "<span>Material</span><span>Stellplatz</span><span>Artikelbezeichnung</span><span>Soll</span><span>Ist</span><span>Einheit</span>"
      : "<span>Artikelnummer</span><span>Lagerplatz</span><span>Produktbeschreibung</span><span>Soll</span><span>Ist</span><span>Einheit</span>";
  }
  if (elements.exportPdfButton) elements.exportPdfButton.textContent = isStorage ? "Einlagerung abschliessen" : "PDF exportieren";
}

function loadOrderList(options) {
  var silent = options && options.silent === true;
  if (!serverOnline) {
    if (!silent) setMessage("Server nicht verbunden.", true);
    return;
  }
  apiJson("/api/orders", null, function (orders) {
    var selected = elements.orderSelect.value;
    clearSelect(elements.orderSelect);
    addOption(elements.orderSelect, "", currentMode === "storage" ? "Einlagerung waehlen" : "Auftrag waehlen");
    var count = 0;
    for (var index = 0; index < orders.length; index += 1) {
      var order = orders[index];
      if ((order.orderType || "picking") !== currentMode) continue;
      if (!isOpenOrder(order)) continue;
      var createdTime = formatOrderCreatedAt(order.createdAt || order.updatedAt);
      var timeText = createdTime ? createdTime + " - " : "";
      addOption(
        elements.orderSelect,
        order.id,
        formatOrderOptionLabel(order, timeText)
      );
      count += 1;
    }
    elements.orderSelect.value = selected;
    if (!silent) setMessage(count ? "Auftragsliste geladen: " + count + " Auftrag/Auftraege." : "Keine offenen " + modeLabel() + "en gefunden.", false);
  }, function (message) {
    if (!silent) setMessage("Auftragsliste konnte nicht geladen werden: " + message, true);
  });
}

function isOpenOrder(order) {
  return !order.exportedAt;
}

function formatOrderCreatedAt(value) {
  if (!value) return "";
  var date = new Date(value);
  if (isNaN(date.getTime())) return "";
  var hours = String(date.getHours());
  var minutes = String(date.getMinutes());
  if (hours.length < 2) hours = "0" + hours;
  if (minutes.length < 2) minutes = "0" + minutes;
  return hours + ":" + minutes;
}

function formatOrderOptionLabel(order, timeText) {
  var status = orderStatusText(order);
  var warehouse = order.orderWarehouse ? " - " + order.orderWarehouse : "";
  return timeText + (order.orderNumber || order.id) + " - " + (order.customerName || "") + warehouse + " [" + status + "] (" + order.picked + "/" + order.total + ")";
}

function orderStatusText(order) {
  if (order.completedAt && !order.exportedAt) return "Fertig, PDF fehlt";
  var acceptedBy = String(order && order.acceptedBy || "").trim();
  if (acceptedBy) return sameUserName(acceptedBy, currentUserName()) ? "Von mir uebernommen" : "Von " + acceptedBy + " uebernommen";
  return "Frei";
}

function sameUserName(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function currentOrderLocksSwitch(nextOrderId) {
  if (!currentOrder || !currentOrder.id || currentOrder.exportedAt) return false;
  if (String(nextOrderId || "") === String(currentOrder.id)) return false;
  var acceptedBy = String(currentOrder.acceptedBy || "").trim();
  return Boolean(acceptedBy && sameUserName(acceptedBy, currentUserName()));
}

function currentOrderLocksModeSwitch(nextMode) {
  if (!currentOrder || !currentOrder.id || currentOrder.exportedAt) return false;
  if ((currentOrder.orderType || "picking") === nextMode) return false;
  var acceptedBy = String(currentOrder.acceptedBy || "").trim();
  return Boolean(acceptedBy && sameUserName(acceptedBy, currentUserName()));
}

function keepCurrentOrderSelected() {
  elements.orderSelect.value = currentOrder ? currentOrder.id : "";
  setMessage("Erst Auftrag " + lockedOrderLabel() + " abschliessen: PDF auf dem Server erzeugen.", true);
}

function lockedOrderLabel() {
  if (!currentOrder) return "";
  var parts = [];
  if (currentOrder.orderNumber) parts.push(currentOrder.orderNumber);
  if (currentOrder.customerName) parts.push(currentOrder.customerName);
  return parts.join(" - ") || currentOrder.id || "";
}

function loadOrder(id) {
  if (!id) return;
  if (currentOrderLocksSwitch(id)) {
    keepCurrentOrderSelected();
    return;
  }
  if (dirty && !window.confirm("Es gibt ungespeicherte Aenderungen. Auftrag trotzdem wechseln?")) {
    elements.orderSelect.value = currentOrder ? currentOrder.id : "";
    return;
  }
  apiJson("/api/orders/" + encodeURIComponent(id), null, function (order) {
    var cachedOrder = restoreCachedOrderFor(order);
    currentOrder = cachedOrder ? mergeServerLoadingSlipLines(cachedOrder, order) : order;
    currentMode = (currentOrder.orderType || "picking") === "storage" ? "storage" : "picking";
    try {
      localStorage.setItem(MODE_KEY, currentMode);
    } catch (error) {
      void error;
    }
    currentOrder.collapseDone = currentOrder.collapseDone !== false;
    elements.collapseDoneInput.checked = currentOrder.collapseDone;
    renderCompletionFields();
    dirty = Boolean(cachedOrder);
    renderOrder();
    if (cachedOrder) {
      setMessage("Lokaler Zwischenstand wiederhergestellt. Bitte speichern oder weiterarbeiten.", false);
      return;
    }
    persistCurrentOrderCache();
    setMessage(currentOrder.acceptedBy && !sameUserName(currentOrder.acceptedBy, currentUserName())
      ? "Auftrag geladen. Bereits von " + currentOrder.acceptedBy + " uebernommen."
      : "Auftrag geladen.", false);
  }, function (message) {
    setMessage("Auftrag konnte nicht geladen werden: " + message, true);
  });
}

function renderOrder() {
  elements.lineList.innerHTML = "";
  updateModeUi();
  renderTakeOverButton();
  if (!currentOrder || !currentOrder.lines || !currentOrder.lines.length) {
    setHidden(elements.pickHeader, true);
    renderStorageLineActions();
    updateCounts();
    return;
  }
  setHidden(elements.pickHeader, false);

  var sorted = sortOrderLines(currentOrder.lines);
  for (var index = 0; index < sorted.length; index += 1) {
    elements.lineList.appendChild(renderLine(sorted[index]));
  }
  renderStorageLineActions();
  updateCounts();
}

function renderStorageLineActions() {
  if (!elements.storageLineActions || !elements.addStorageLineButton) return;
  var isStorage = isStorageOrder();
  setHidden(elements.storageLineActions, !isStorage || !currentOrder);
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
  var numbers = [];
  var source = Array.isArray(lines) ? lines : [];
  for (var index = 0; index < source.length; index += 1) {
    var value = String(source[index].warehouseOrder || "");
    if (/^M\d+$/i.test(value)) numbers.push(Number(value.replace(/\D/g, "")));
  }
  return "M" + ((numbers.length ? Math.max.apply(null, numbers) : 0) + 1);
}

function createLineId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return "line-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function sortOrderLines(lines) {
  if (isStorageOrder()) return lines.slice();
  var sortMode = elements.sortModeSelect.value || "fromBin";
  var primary = sortMode === "product" ? "product" : "fromBin";
  var secondary = primary === "product" ? "fromBin" : "product";
  return lines.slice().sort(function (left, right) {
    var leftLoadingSlip = left.lineType === "loading-slip";
    var rightLoadingSlip = right.lineType === "loading-slip";
    if (leftLoadingSlip && rightLoadingSlip) return 0;
    if (leftLoadingSlip && !rightLoadingSlip) return 1;
    if (!leftLoadingSlip && rightLoadingSlip) return -1;

    return compareLineValue(left[primary], right[primary]) ||
      compareLineValue(left[secondary], right[secondary]) ||
      compareLineValue(left.description, right.description);
  });
}

function compareLineValue(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function renderLine(line) {
  if (line.lineType === "loading-slip") return renderLoadingSlipLine(line);
  var isStorage = isStorageOrder();
  var isManualStorageLine = isStorage && line.manual === true;

  var card = document.createElement("article");
  var binWarningText = String(line.binWarning || "").trim();
  card.className = "pick-item" + (line.picked ? " is-done" : "") + (line.picked && currentOrder.collapseDone ? " is-collapsed" : "") + (binWarningText ? " has-bin-warning" : "");

  var checkWrap = document.createElement("button");
  checkWrap.type = "button";
  checkWrap.className = "check-target";
  if (line.picked) checkWrap.className += " is-picked";
  checkWrap.setAttribute("aria-pressed", line.picked ? "true" : "false");
  checkWrap.setAttribute("aria-label", line.picked ? "Position wieder öffnen" : "Position abhaken");
  var checkmark = document.createElement("span");
  checkmark.className = "checkmark";
  checkmark.setAttribute("aria-hidden", "true");
  checkWrap.appendChild(checkmark);
  checkWrap.onclick = function (event) {
    event.preventDefault();
    toggleLinePicked(line, card, checkWrap);
  };
  card.appendChild(checkWrap);

  var body = document.createElement("div");
  body.className = "line-body";
  var top = document.createElement("div");
  top.className = "line-top";

  top.appendChild(makeInput(isStorage ? "Material" : "Produkt", line.product, function (value) {
    line.product = String(value || "").trim();
    markDirty();
  }, !isManualStorageLine, "short-input"));
  var canEditBin = isStorage || Boolean(binWarningText);
  var binInput = makeInput(isStorage ? "Stellplatz" : "Lagerplatz", line.fromBin, canEditBin ? function (value) {
    line.fromBin = value.toUpperCase();
    if (shouldClearBinWarning(line, line.fromBin)) {
      line.binWarning = "";
      line.binWarningValue = "";
      renderOrder();
    }
    markDirty();
  } : null, !canEditBin, "short-input");
  if (binWarningText) decorateBinWarningLabel(binInput, binWarningText);
  top.appendChild(binInput);
  top.appendChild(makeInput(isStorage ? "Artikelbezeichnung" : "Produktbeschreibung", line.description, function (value) {
    line.description = value;
    markDirty();
  }, !isManualStorageLine, ""));
  top.appendChild(makeInput("Soll", line.targetQty, function (value) {
    line.targetQty = value;
    if (!line.actualQty) line.actualQty = value;
    markDirty();
    updateCounts();
  }, !isManualStorageLine, "short-input"));
  top.appendChild(makeInput("Ist", line.actualQty, function (value) {
    line.actualQty = value;
    markDirty();
    updateCounts();
  }, isStorage && !isManualStorageLine, "short-input"));
  top.appendChild(makeInput("Einheit", line.unit, function (value) {
    line.unit = value || "Stk";
    markDirty();
  }, !isManualStorageLine, "short-input"));
  body.appendChild(top);

  var locationRow = document.createElement("div");
  locationRow.className = "location-row";
  var canEditHu = isStorage || line.fromHandlingUnitEditable === true || !String(line.fromHandlingUnit || "").trim();
  locationRow.appendChild(makeInput(isStorage ? "HU" : "Von HU", line.fromHandlingUnit, function (value) {
    line.fromHandlingUnit = isStorage ? value.toUpperCase().replace(/[^A-Z0-9,-]/g, "") : value.replace(/[^0-9,]/g, "");
    line.fromHandlingUnitEditable = canEditHu;
    markDirty();
  }, !canEditHu, ""));
  locationRow.appendChild(makeInput("Zusatzbemerkung", line.positionNote, function (value) {
    line.positionNote = value;
    markDirty();
  }, isStorage && !isManualStorageLine, ""));
  if (isManualStorageLine) locationRow.appendChild(makeManualStorageDeleteButton(line));
  body.appendChild(locationRow);

  card.appendChild(body);
  return card;
}

function renderLoadingSlipLine(line) {
  var card = document.createElement("article");
  card.className = "pick-item is-loading-slip" + (line.picked ? " is-done" : "") + (line.picked && currentOrder.collapseDone ? " is-collapsed" : "");

  var checkWrap = document.createElement("button");
  checkWrap.type = "button";
  checkWrap.className = "check-target";
  if (line.picked) checkWrap.className += " is-picked";
  checkWrap.setAttribute("aria-pressed", line.picked ? "true" : "false");
  checkWrap.setAttribute("aria-label", line.picked ? "Position wieder oeffnen" : "Position abhaken");
  var checkmark = document.createElement("span");
  checkmark.className = "checkmark";
  checkmark.setAttribute("aria-hidden", "true");
  checkWrap.appendChild(checkmark);
  checkWrap.onclick = function (event) {
    event.preventDefault();
    toggleLinePicked(line, card, checkWrap);
  };
  card.appendChild(checkWrap);

  var body = document.createElement("div");
  body.className = "line-body";

  var top = document.createElement("div");
  top.className = "loading-slip-top";
  var barcode = document.createElement("div");
  barcode.className = "loading-slip-barcode";
  barcode.innerHTML = code128Svg(line.barcode || "");
  top.appendChild(barcode);
  top.appendChild(makeInput("Artikelnummer", line.product, null, true, "short-input"));
  top.appendChild(makeInput("Produktbeschreibung", line.description, null, true, ""));
  top.appendChild(makeInput("Soll", line.targetQty, null, true, "short-input"));
  body.appendChild(top);

  var noteRow = document.createElement("div");
  noteRow.className = "location-row loading-slip-note-row";
  noteRow.appendChild(makeInput("Zusatzbemerkung", line.positionNote, function (value) {
    line.positionNote = value;
    markDirty();
  }, false, ""));
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
  var button = document.createElement("button");
  button.type = "button";
  button.className = "danger-button manual-line-delete";
  button.textContent = "Zeile loeschen";
  button.onclick = function (event) {
    event.preventDefault();
    event.stopPropagation();
    removeManualStorageLine(line);
  };
  return button;
}

function removeManualStorageLine(line) {
  if (!currentOrder || !line || line.manual !== true) return;
  if (manualStorageLineHasContent(line) && !window.confirm("Manuell hinzugefuegte Zeile wirklich loeschen?")) return;
  currentOrder.lines = (Array.isArray(currentOrder.lines) ? currentOrder.lines : []).filter(function (entry) {
    return entry.id !== line.id;
  });
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
  ].some(function (value) {
    return String(value == null ? "" : value).trim();
  });
}

function updateLinePickedState(line, card, button) {
  var picked = Boolean(line.picked);
  card.className = card.className
    .replace(/\bis-done\b/g, "")
    .replace(/\bis-collapsed\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\s+|\s+$/g, "");
  button.className = button.className
    .replace(/\bis-picked\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\s+|\s+$/g, "");
  if (picked) {
    card.className += " is-done";
    button.className += " is-picked";
  }
  button.setAttribute("aria-pressed", picked ? "true" : "false");
  button.setAttribute("aria-label", picked ? "Position wieder öffnen" : "Position abhaken");
  if (picked && currentOrder && currentOrder.collapseDone) {
    window.setTimeout(function () {
      if (line.picked && currentOrder && currentOrder.collapseDone) {
        card.className += " is-collapsed";
      }
    }, 180);
  }
}

function makeInput(labelText, value, onChange, readOnly, className) {
  var label = document.createElement("label");
  label.appendChild(document.createTextNode(labelText));
  var input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.className = className || "";
  if (readOnly) {
    input.readOnly = true;
    input.setAttribute("readonly", "");
    input.className = (input.className ? input.className + " " : "") + "readonly-input";
  }
  input.onchange = input.onkeyup = function () {
    if (!input.readOnly && onChange) onChange(input.value);
  };
  label.appendChild(input);
  return label;
}

function decorateBinWarningLabel(label, message) {
  if (!label) return;
  label.className = "has-field-warning";
  var input = label.querySelector("input");
  if (input) {
    input.className = (input.className ? input.className + " " : "") + "is-warning";
    input.title = message;
  }
  var warning = document.createElement("span");
  warning.className = "field-warning";
  warning.appendChild(document.createTextNode(message));
  label.appendChild(warning);
}

function renderTakeOverButton() {
  var hasOrder = Boolean(currentOrder && currentOrder.id && currentOrder.lines && currentOrder.lines.length);
  var acceptedBy = currentOrder ? String(currentOrder.acceptedBy || "").trim() : "";
  var user = currentUserName();
  setHidden(elements.takeOverButton, !hasOrder || (acceptedBy && sameUserName(acceptedBy, user)));
  elements.takeOverButton.disabled = !hasOrder || !user || !serverOnline;
  elements.takeOverButton.innerHTML = escapeHtml(acceptedBy ? "Von " + acceptedBy + " uebernommen" : "Bearbeitung uebernehmen");
}

function acceptOrderOnServer(id, success, failure) {
  if (!serverOnline) {
    if (failure) failure("Auftrag kann nur mit Serververbindung uebernommen werden.");
    return;
  }
  apiJson("/api/orders/" + encodeURIComponent(id) + "/accept", {
    method: "POST",
    body: JSON.stringify({ userName: currentUserName() })
  }, success, failure);
}

function takeOverCurrentOrder() {
  if (!currentOrder || !currentOrder.id) return setMessage("Kein Auftrag ausgewaehlt.", true);
  if (!currentUserName()) return setMessage("Bitte erst Mitarbeiter eintragen.", true);
  acceptOrderOnServer(currentOrder.id, function (accepted) {
    if (accepted && accepted.order) currentOrder = accepted.order;
    currentOrder.collapseDone = currentOrder.collapseDone !== false;
    dirty = false;
    renderCompletionFields();
    renderOrder();
    persistCurrentOrderCache();
    loadOrderList({ silent: true });
    setMessage(acceptedOrderMessage(accepted), false);
  }, function (message) {
    setMessage("Bearbeitung konnte nicht uebernommen werden: " + message, true);
  });
}

function acceptedOrderMessage(result) {
  var count = Number(result && result.acceptedCount || 0);
  if (count > 1) {
    return count + " Auftraege fuer Kunde " + (result.customerName || "") + " uebernommen.";
  }
  return "Bearbeitung uebernommen. Bitte diesen Auftrag abschliessen.";
}

function renderCompletionFields() {
  var hasOrder = Boolean(currentOrder);
  elements.euroPalletsInput.disabled = !hasOrder;
  elements.storageSpacesInput.disabled = !hasOrder;
  elements.orderNoteInput.disabled = !hasOrder;
  elements.euroPalletsInput.value = currentOrder ? currentOrder.euroPallets || "" : "";
  elements.storageSpacesInput.value = currentOrder ? currentOrder.storageSpaces || "" : "";
  elements.orderNoteInput.value = currentOrder ? currentOrder.orderNote || "" : "";
}

function updateCompletionFieldsFromInputs() {
  if (!currentOrder) return;
  applyCompletionFieldsToOrder();
  markDirty();
}

function applyCompletionFieldsToOrder() {
  if (!currentOrder) return;
  currentOrder.euroPallets = elements.euroPalletsInput.value || "";
  currentOrder.storageSpaces = elements.storageSpacesInput.value || "";
  currentOrder.orderNote = elements.orderNoteInput.value || "";
}

function markDirty() {
  dirty = true;
  changeRevision += 1;
  touchOrder();
  persistCurrentOrderCache();
  scheduleAutoSave();
  setMessage("Aenderungen noch nicht gespeichert.", false);
}

function touchOrder() {
  if (!currentOrder) return;
  var user = currentUserName() || "Tablet";
  var now = new Date().toISOString();
  currentOrder.createdBy = currentOrder.createdBy || user;
  currentOrder.lastEditedBy = user;
  currentOrder.activeUser = user;
  currentOrder.activeUserAt = now;
  applyCompletionFieldsToOrder();
  if (currentOrder.lines.length && allPicked()) {
    currentOrder.completedBy = currentOrder.completedBy || user;
    currentOrder.completedAt = currentOrder.completedAt || now;
  } else {
    currentOrder.completedBy = "";
    currentOrder.completedAt = "";
  }
}

function saveOrder(silent, onSuccess) {
  if (!currentOrder || !currentOrder.id) return;
  if (!currentUserName()) return setMessage("Bitte erst Mitarbeiter eintragen.", true);
  if (savingOrder) {
    window.setTimeout(function () {
      saveOrder(silent, onSuccess);
    }, 300);
    return;
  }
  savingOrder = true;
  touchOrder();
  persistCurrentOrderCache();
  var revision = changeRevision;
  apiJson("/api/orders/" + encodeURIComponent(currentOrder.id), {
    method: "PUT",
    body: JSON.stringify({ order: currentOrder, userName: currentUserName() })
  }, function (result) {
    currentOrder.acceptedBy = result && result.order && result.order.acceptedBy || currentOrder.acceptedBy || "";
    currentOrder.acceptedAt = result && result.order && result.order.acceptedAt || currentOrder.acceptedAt || "";
    savingOrder = false;
    if (changeRevision === revision) {
      dirty = false;
      clearCurrentOrderCache();
    } else {
      dirty = true;
      persistCurrentOrderCache();
      scheduleAutoSave();
    }
    setMessage(silent ? "Automatisch gespeichert." : "Auftrag gespeichert.", false);
    loadOrderList();
    if (onSuccess) onSuccess();
  }, function (message) {
    savingOrder = false;
    persistCurrentOrderCache();
    setMessage("Speichern fehlgeschlagen: " + message, true);
  });
}

function exportPdf() {
  if (!currentOrder || !currentOrder.id) return setMessage("Kein Auftrag ausgewaehlt.", true);
  if (!currentUserName()) return setMessage("Bitte erst Mitarbeiter eintragen.", true);
  pruneEmptyManualStorageLines();
  var validationMessage = storageOrderExportMessage();
  if (validationMessage) {
    renderOrder();
    setMessage(validationMessage, true);
    window.alert(validationMessage);
    return;
  }
  setMessage("PDF wird auf dem Server erstellt...", false);
  saveOrder(true, function () {
    apiJson("/api/orders/" + encodeURIComponent(currentOrder.id) + "/export-pdf", {
      method: "POST",
      body: JSON.stringify({ order: currentOrder, userName: currentUserName() })
    }, function () {
      dirty = false;
      clearCurrentOrderCache();
      loadTabletStartPage();
    }, function (message) {
      setMessage("PDF-Export fehlgeschlagen: " + message, true);
    });
  });
}

function loadTabletStartPage() {
  resetToStart("PDF erfolgreich exportiert. Bitte Auftrag waehlen.");
  window.location.href = (window.location.pathname || "/tablet.html") + "?start=" + Date.now();
}

function resetToStart(message) {
  clearCurrentOrderCache();
  currentOrder = null;
  dirty = false;
  elements.orderSelect.value = "";
  elements.collapseDoneInput.checked = true;
  renderCompletionFields();
  renderOrder();
  setMessage(message, false);
}

function scheduleAutoSave() {
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(function () {
    autoSaveTimer = null;
    if (!dirty || !serverOnline || !currentOrder || !currentOrder.id || !currentUserName()) return;
    saveOrder(true);
  }, AUTO_SAVE_MS);
}

function persistCurrentOrderCache() {
  if (!currentOrder || !currentOrder.id) return;
  try {
    localStorage.setItem(CURRENT_ORDER_CACHE_KEY, JSON.stringify({
      orderId: currentOrder.id,
      cachedAt: new Date().toISOString(),
      dirty: dirty === true,
      order: currentOrder
    }));
  } catch (error) {
    void error;
  }
}

function clearCurrentOrderCache() {
  try {
    localStorage.removeItem(CURRENT_ORDER_CACHE_KEY);
  } catch (error) {
    void error;
  }
}

function mergeServerLoadingSlipLines(order, serverOrder) {
  if (!order || !Array.isArray(order.lines) || !serverOrder || !Array.isArray(serverOrder.lines)) return order;

  var serverLoadingSlipLines = serverOrder.lines.filter(function (line) {
    return line && line.lineType === "loading-slip" && String(line.barcode || "").trim();
  });
  if (!serverLoadingSlipLines.length) return order;

  var previousByBarcode = {};
  order.lines.forEach(function (line) {
    var barcode = line && line.lineType === "loading-slip" ? String(line.barcode || "").trim() : "";
    if (barcode) previousByBarcode[barcode] = line;
  });

  var normalLines = order.lines.filter(function (line) {
    return !line || line.lineType !== "loading-slip";
  });
  var mergedLoadingSlipLines = serverLoadingSlipLines.map(function (line) {
    var previous = previousByBarcode[String(line.barcode || "").trim()];
    var merged = {};
    Object.keys(line).forEach(function (key) {
      merged[key] = line[key];
    });
    if (previous && Object.prototype.hasOwnProperty.call(previous, "picked")) merged.picked = previous.picked;
    merged.positionNote = previous && String(previous.positionNote || "").trim()
      ? previous.positionNote
      : line.positionNote || "";
    return merged;
  });

  var mergedOrder = {};
  Object.keys(order).forEach(function (key) {
    mergedOrder[key] = order[key];
  });
  mergedOrder.lines = normalLines.concat(mergedLoadingSlipLines);
  return mergedOrder;
}

function restoreCachedOrderFor(serverOrder) {
  var payload = loadCachedOrderPayload();
  if (!payload || !payload.order || !serverOrder || !serverOrder.id) return null;
  if (payload.dirty !== true) return null;
  if (String(payload.orderId || payload.order.id) !== String(serverOrder.id)) return null;
  if (serverOrder.exportedAt) return null;
  if (!payload.order.lines || !serverOrder.lines) return null;
  if (payload.order.lines.length !== serverOrder.lines.length) return null;
  var cachedAt = dateToMs(payload.cachedAt);
  var serverAt = dateToMs(serverOrder.updatedAt || serverOrder.activeUserAt || serverOrder.createdAt);
  if (serverAt && cachedAt <= serverAt) return null;
  return payload.order;
}

function loadCachedOrderPayload() {
  try {
    var raw = localStorage.getItem(CURRENT_ORDER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    void error;
    return null;
  }
}

function dateToMs(value) {
  if (!value) return 0;
  var time = new Date(value).getTime();
  return isNaN(time) ? 0 : time;
}

function updateCounts() {
  var lines = currentOrder && currentOrder.lines ? currentOrder.lines : [];
  var done = 0;
  var changed = 0;
  for (var index = 0; index < lines.length; index += 1) {
    if (lines[index].picked) done += 1;
    if (String(lines[index].actualQty || "").trim() !== String(lines[index].targetQty || "").trim()) changed += 1;
  }
  elements.doneCount.innerHTML = done;
  elements.openCount.innerHTML = Math.max(lines.length - done, 0);
  elements.changedCount.innerHTML = changed;
}

function allPicked() {
  var lines = currentOrder && currentOrder.lines ? currentOrder.lines : [];
  if (!lines.length) return false;
  for (var index = 0; index < lines.length; index += 1) {
    if (isEmptyManualStorageLine(lines[index])) continue;
    if (!lines[index].picked) return false;
  }
  return true;
}

function pruneEmptyManualStorageLines() {
  if (!currentOrder || !Array.isArray(currentOrder.lines)) return;
  var before = currentOrder.lines.length;
  currentOrder.lines = currentOrder.lines.filter(function (line) {
    return !isEmptyManualStorageLine(line);
  });
  if (currentOrder.lines.length !== before) markDirty();
}

function storageOrderExportMessage() {
  if (!isStorageOrder() || !currentOrder) return "";
  var errors = [];
  var lines = Array.isArray(currentOrder.lines) ? currentOrder.lines : [];
  for (var index = 0; index < lines.length; index += 1) {
    if (isEmptyManualStorageLine(lines[index])) continue;
    var lineErrors = storageLineCompletionErrors(lines[index]);
    for (var errorIndex = 0; errorIndex < lineErrors.length; errorIndex += 1) {
      errors.push("Pos. " + storageLinePosition(lines[index], index) + ": " + lineErrors[errorIndex]);
    }
  }
  if (!errors.length) return "";
  return "Einlagerung unvollstaendig: " + errors.slice(0, 5).join("; ") + (errors.length > 5 ? "; weitere Fehler vorhanden" : "");
}

function storageLineErrorMessage(line) {
  return "Position kann noch nicht erledigt werden: " + storageLineCompletionErrors(line).join(", ");
}

function storageLineCompletionErrors(line) {
  if (!isStorageOrder() || !line || line.lineType === "loading-slip" || isEmptyManualStorageLine(line)) return [];
  var errors = [];
  if (!String(line.product || "").trim()) errors.push("Artikelnummer fehlt");
  if (!String(line.description || "").trim()) errors.push("Artikelbezeichnung fehlt");
  if (!String(line.fromBin || "").trim()) errors.push("Stellplatz fehlt");
  if (!readTabletQuantity(line.actualQty || line.targetQty)) errors.push("Menge fehlt");
  return errors;
}

function shouldClearBinWarning(line, nextBin) {
  if (!String(line && line.binWarning || "").trim()) return false;
  var previous = normalizePickingBinText(line.binWarningValue || line.fromBin);
  var next = normalizePickingBinText(nextBin);
  return Boolean(next && next !== previous && isPlausiblePickingBin(next) && !suspiciousPickingBinWarning({ fromBin: next }));
}

function suspiciousPickingBinWarning(line) {
  if (!line || line.lineType === "loading-slip") return "";
  var bin = normalizePickingBinText(line.fromBin);
  if (!bin) return "";
  if (!isPlausiblePickingBin(bin)) return "Lagerplatz unklar: " + bin + ".";

  var h1LetterInNumberSlot = bin.match(/^002-H1-SA[A-Z]([A-Z])[A-D]\d$/i);
  if (h1LetterInNumberSlot) return "Lagerplatz unklar: " + bin + ".";

  return "";
}

function isPlausiblePickingBin(value) {
  var bin = normalizePickingBinText(value);
  return /^(?:002|022)-H\d{1,2}-(?:S[A-Z0-9]{2,10}|R\d{1,3})$/i.test(bin);
}

function normalizePickingBinText(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/^O/, "0")
    .replace(/^QD/, "00");
}

function readTabletQuantity(value) {
  var number = Number(String(value || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) && number > 0;
}

function storageLinePosition(line, index) {
  return line.warehouseOrder || (index + 1);
}

function isEmptyManualStorageLine(line) {
  return line && line.manual === true && !manualStorageLineHasContent(line);
}

function apiJson(url, options, success, failure) {
  var xhr = new XMLHttpRequest();
  var method = options && options.method ? options.method : "GET";
  xhr.open(method, API_BASE + url, true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("X-User-Group", "tablet");
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    var data = null;
    try {
      data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
    } catch (error) {
      void error;
      if (failure) failure("Antwort konnte nicht gelesen werden");
      return;
    }
    if (xhr.status < 200 || xhr.status >= 300 || (data && data.ok === false)) {
      if (failure) failure((data && data.error) || "Serverfehler");
      return;
    }
    if (success) success(data);
  };
  xhr.onerror = function () {
    if (failure) failure("Server nicht erreichbar");
  };
  xhr.send(options && options.body ? options.body : null);
}

function setConnectionStatus(isOnline) {
  serverOnline = isOnline === true;
  elements.connectionStatus.className = "connection-status" + (isOnline === true ? " is-online" : isOnline === false ? " is-offline" : "");
  elements.connectionStatus.innerHTML = isOnline === true ? "Online" : isOnline === false ? "Offline" : "Pruefe Verbindung";
}

function setMessage(message, isError) {
  elements.message.innerHTML = escapeHtml(message || "");
  elements.message.className = "message" + (isError ? " is-error" : "");
}

function clearSelect(select) {
  while (select.options.length) select.remove(0);
}

function addOption(select, value, label) {
  var option = document.createElement("option");
  option.value = value;
  option.text = label;
  select.add(option);
}

function currentUserName() {
  return String(elements.userNameInput.value || "").trim();
}

function setHidden(element, hidden) {
  if (!element) return;
  element.hidden = hidden;
  if (hidden) element.setAttribute("hidden", "");
  else element.removeAttribute("hidden");
}

function code128Svg(value) {
  var barcode = String(value || "").trim();
  if (!barcode) return '<span class="loading-slip-empty">Kein Barcode</span>';

  var patterns = [
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
  var codes = [104];
  for (var i = 0; i < barcode.length; i += 1) {
    var charCode = barcode.charCodeAt(i);
    if (charCode >= 32 && charCode <= 126) codes.push(charCode - 32);
  }
  if (codes.length === 1) return '<span class="loading-slip-empty">Barcode ungueltig</span>';

  var checksum = 0;
  for (var c = 0; c < codes.length; c += 1) checksum += codes[c] * (c || 1);
  codes.push(checksum % 103, 106);

  var x = 10;
  var bars = "";
  for (var codeIndex = 0; codeIndex < codes.length; codeIndex += 1) {
    var pattern = patterns[codes[codeIndex]];
    if (!pattern) continue;
    for (var part = 0; part < pattern.length; part += 1) {
      var width = Number(pattern.charAt(part));
      if (part % 2 === 0) bars += '<rect x="' + x + '" y="0" width="' + width + '" height="44"></rect>';
      x += width;
    }
  }

  var svgWidth = x + 10;
  return '<svg class="code128" viewBox="0 0 ' + svgWidth + ' 58" role="img" aria-label="Barcode ' + escapeHtmlAttribute(barcode) + '">' +
    '<g fill="#111">' + bars + '</g>' +
    '<text x="' + (svgWidth / 2) + '" y="56" text-anchor="middle">' + escapeSvgText(barcode) + '</text>' +
    '</svg>';
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
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
