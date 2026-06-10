var API_BASE = "";
var USER_KEY = "tablet-pick-user-v1";
var SORT_MODE_KEY = "tablet-pick-sort-mode-v1";
var MAIN_USER_KEY = "kommissionier-app-user-v1";
var USER_GROUP_KEY = "kommissionier-app-user-group-v1";
var CURRENT_ORDER_CACHE_KEY = "tablet-pick-current-order-v1";
var ORDER_LIST_REFRESH_MS = 120000;
var AUTO_SAVE_MS = 2500;

var elements = {};
var currentOrder = null;
var serverOnline = false;
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
  if (document.hidden) persistCurrentOrderCache();
});

function bindElements() {
  var ids = [
    "connectionStatus",
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
    "lineList"
  ];
  for (var index = 0; index < ids.length; index += 1) {
    elements[ids[index]] = document.getElementById(ids[index]);
  }
}

function bindEvents() {
  elements.userNameInput.onchange = function () {
    saveUser();
    renderTakeOverButton();
  };
  elements.userNameInput.onkeyup = renderTakeOverButton;
  elements.orderSelect.onchange = function () {
    if (elements.orderSelect.value) {
      loadOrder(elements.orderSelect.value);
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
    if (!orderListTimer) orderListTimer = window.setInterval(loadOrderList, ORDER_LIST_REFRESH_MS);
  }, function (message) {
    serverOnline = false;
    setConnectionStatus(false);
    setMessage("Server nicht verbunden: " + message, true);
  });
}

function loadUser() {
  try {
    elements.userNameInput.value = localStorage.getItem(USER_KEY) || localStorage.getItem(MAIN_USER_KEY) || "";
    elements.sortModeSelect.value = localStorage.getItem(SORT_MODE_KEY) || "fromBin";
    if (!localStorage.getItem(USER_GROUP_KEY)) localStorage.setItem(USER_GROUP_KEY, "tablet");
  } catch (error) {
    void error;
    elements.userNameInput.value = "";
    elements.sortModeSelect.value = "fromBin";
  }
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

function loadOrderList() {
  if (!serverOnline) {
    setMessage("Server nicht verbunden.", true);
    return;
  }
  apiJson("/api/orders", null, function (orders) {
    var selected = elements.orderSelect.value;
    clearSelect(elements.orderSelect);
    addOption(elements.orderSelect, "", "Auftrag waehlen");
    var count = 0;
    for (var index = 0; index < orders.length; index += 1) {
      var order = orders[index];
      if ((order.orderType || "picking") !== "picking") continue;
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
    setMessage(count ? "Auftragsliste geladen: " + count + " Auftrag/Auftraege." : "Keine offenen Auftraege gefunden.", false);
  }, function (message) {
    setMessage("Auftragsliste konnte nicht geladen werden: " + message, true);
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
  return timeText + (order.orderNumber || order.id) + " - " + (order.customerName || "") + " [" + status + "] (" + order.picked + "/" + order.total + ")";
}

function orderStatusText(order) {
  if (order.completedAt && !order.exportedAt) return "Fertig, PDF fehlt";
  var activeUser = String(order && order.activeUser || "").trim();
  if (!activeUser) return "Frei";
  return activeUser === currentUserName() ? "Bearbeitet von mir" : "Bearbeitet von " + activeUser;
}

function loadOrder(id) {
  if (!id) return;
  if (dirty && !window.confirm("Es gibt ungespeicherte Aenderungen. Auftrag trotzdem wechseln?")) {
    elements.orderSelect.value = currentOrder ? currentOrder.id : "";
    return;
  }
  apiJson("/api/orders/" + encodeURIComponent(id), null, function (order) {
    var cachedOrder = restoreCachedOrderFor(order);
    currentOrder = cachedOrder || order;
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
    setMessage(currentOrder.activeUser && currentOrder.activeUser !== currentUserName()
      ? "Auftrag geladen. Aktuell in Bearbeitung: " + currentOrder.activeUser + "."
      : "Auftrag geladen.", false);
  }, function (message) {
    setMessage("Auftrag konnte nicht geladen werden: " + message, true);
  });
}

function renderOrder() {
  elements.lineList.innerHTML = "";
  renderTakeOverButton();
  if (!currentOrder || !currentOrder.lines || !currentOrder.lines.length) {
    setHidden(elements.pickHeader, true);
    updateCounts();
    return;
  }
  setHidden(elements.pickHeader, false);

  var sorted = sortOrderLines(currentOrder.lines);
  for (var index = 0; index < sorted.length; index += 1) {
    elements.lineList.appendChild(renderLine(sorted[index]));
  }
  updateCounts();
}

function sortOrderLines(lines) {
  var sortMode = elements.sortModeSelect.value || "fromBin";
  var primary = sortMode === "product" ? "product" : "fromBin";
  var secondary = primary === "product" ? "fromBin" : "product";
  return lines.slice().sort(function (left, right) {
    var leftLoadingSlip = left.lineType === "loading-slip";
    var rightLoadingSlip = right.lineType === "loading-slip";
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

  var card = document.createElement("article");
  card.className = "pick-item" + (line.picked ? " is-done" : "") + (line.picked && currentOrder.collapseDone ? " is-collapsed" : "");

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

  top.appendChild(makeInput("Produkt", line.product, null, true, "short-input"));
  top.appendChild(makeInput("Lagerplatz", line.fromBin, null, true, "short-input"));
  top.appendChild(makeInput("Produktbeschreibung", line.description, null, true, ""));
  top.appendChild(makeInput("Soll", line.targetQty, null, true, "short-input"));
  top.appendChild(makeInput("Ist", line.actualQty, function (value) {
    line.actualQty = value;
    markDirty();
    updateCounts();
  }, false, "short-input"));
  top.appendChild(makeInput("Einheit", line.unit, null, true, "short-input"));
  body.appendChild(top);

  var locationRow = document.createElement("div");
  locationRow.className = "location-row";
  var canEditHu = line.fromHandlingUnitEditable === true || !String(line.fromHandlingUnit || "").trim();
  locationRow.appendChild(makeInput("Von HU", line.fromHandlingUnit, function (value) {
    line.fromHandlingUnit = value.replace(/[^0-9,]/g, "");
    line.fromHandlingUnitEditable = canEditHu;
    markDirty();
  }, !canEditHu, ""));
  locationRow.appendChild(makeInput("Zusatzbemerkung", line.positionNote, function (value) {
    line.positionNote = value;
    markDirty();
  }, false, ""));
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
  line.picked = !line.picked;
  updateLinePickedState(line, card, button);
  markDirty();
  updateCounts();
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

function renderTakeOverButton() {
  var hasOrder = Boolean(currentOrder && currentOrder.id && currentOrder.lines && currentOrder.lines.length);
  var activeUser = currentOrder ? String(currentOrder.activeUser || "").trim() : "";
  var user = currentUserName();
  setHidden(elements.takeOverButton, !hasOrder || (activeUser && activeUser === user));
  elements.takeOverButton.disabled = !hasOrder || !user || !serverOnline;
  elements.takeOverButton.innerHTML = escapeHtml(activeUser ? "Bearbeitung von " + activeUser + " uebernehmen" : "Bearbeitung uebernehmen");
}

function takeOverCurrentOrder() {
  if (!currentOrder || !currentOrder.id) return setMessage("Kein Auftrag ausgewaehlt.", true);
  if (!currentUserName()) return setMessage("Bitte erst Mitarbeiter eintragen.", true);
  touchOrder();
  dirty = true;
  renderTakeOverButton();
  saveOrder(false);
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
    body: JSON.stringify({ order: currentOrder })
  }, function () {
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
  setMessage("PDF wird auf dem Server erstellt...", false);
  saveOrder(true, function () {
    apiJson("/api/orders/" + encodeURIComponent(currentOrder.id) + "/export-pdf", {
      method: "POST",
      body: JSON.stringify({ order: currentOrder })
    }, function () {
      dirty = false;
      clearCurrentOrderCache();
      resetToStart("PDF erfolgreich exportiert. Bitte Auftrag waehlen.");
      loadOrderList();
    }, function (message) {
      setMessage("PDF-Export fehlgeschlagen: " + message, true);
    });
  });
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
    if (!lines[index].picked) return false;
  }
  return true;
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
