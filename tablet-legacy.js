var API_BASE = "";
var USER_KEY = "tablet-pick-user-v1";
var MAIN_USER_KEY = "kommissionier-app-user-v1";
var USER_GROUP_KEY = "kommissionier-app-user-group-v1";
var ORDER_LIST_REFRESH_MS = 120000;

var elements = {};
var currentOrder = null;
var serverOnline = false;
var dirty = false;
var orderListTimer = null;

document.addEventListener("DOMContentLoaded", function () {
  bindElements();
  bindEvents();
  loadUser();
  renderCompletionFields();
  initialize();
});

function bindElements() {
  var ids = [
    "connectionStatus",
    "userNameInput",
    "orderSelect",
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
  elements.refreshButton.onclick = loadOrderList;
  elements.takeOverButton.onclick = takeOverCurrentOrder;
  elements.saveButton.onclick = function () { saveOrder(false); };
  elements.exportPdfButton.onclick = exportPdf;
  elements.collapseDoneInput.onchange = function () {
    if (!currentOrder) return;
    currentOrder.collapseDone = elements.collapseDoneInput.checked;
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
    if (!localStorage.getItem(USER_GROUP_KEY)) localStorage.setItem(USER_GROUP_KEY, "tablet");
  } catch (error) {
    void error;
    elements.userNameInput.value = "";
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
        timeText + (order.orderNumber || order.id) + " - " + (order.customerName || "") + " (" + order.picked + "/" + order.total + ")"
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
  return !order.exportedAt && !order.completedAt;
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

function loadOrder(id) {
  if (!id) return;
  if (dirty && !window.confirm("Es gibt ungespeicherte Aenderungen. Auftrag trotzdem wechseln?")) {
    elements.orderSelect.value = currentOrder ? currentOrder.id : "";
    return;
  }
  apiJson("/api/orders/" + encodeURIComponent(id), null, function (order) {
    currentOrder = order;
    currentOrder.collapseDone = currentOrder.collapseDone !== false;
    elements.collapseDoneInput.checked = currentOrder.collapseDone;
    renderCompletionFields();
    dirty = false;
    renderOrder();
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

  var sorted = currentOrder.lines.slice().sort(function (left, right) {
    return String(left.fromBin || "").localeCompare(String(right.fromBin || ""));
  });
  for (var index = 0; index < sorted.length; index += 1) {
    elements.lineList.appendChild(renderLine(sorted[index]));
  }
  updateCounts();
}

function renderLine(line) {
  var card = document.createElement("article");
  card.className = "pick-item" + (line.picked ? " is-done" : "") + (line.picked && currentOrder.collapseDone ? " is-collapsed" : "");

  var checkWrap = document.createElement("label");
  checkWrap.className = "check-target";
  var checkbox = document.createElement("input");
  checkbox.className = "picked-input";
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(line.picked);
  checkbox.onchange = function () {
    line.picked = checkbox.checked;
    markDirty();
    renderOrder();
  };
  checkWrap.appendChild(checkbox);
  var checkmark = document.createElement("span");
  checkmark.className = "checkmark";
  checkmark.setAttribute("aria-hidden", "true");
  checkWrap.appendChild(checkmark);
  checkWrap.onclick = function (event) {
    if (event.target === checkbox) return;
    event.preventDefault();
    checkbox.checked = !checkbox.checked;
    checkbox.onchange();
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
  touchOrder();
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
  touchOrder();
  apiJson("/api/orders/" + encodeURIComponent(currentOrder.id), {
    method: "PUT",
    body: JSON.stringify({ order: currentOrder })
  }, function () {
    dirty = false;
    setMessage(silent ? "Automatisch gespeichert." : "Auftrag gespeichert.", false);
    loadOrderList();
    if (onSuccess) onSuccess();
  }, function (message) {
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
      resetToStart("PDF erfolgreich exportiert. Bitte Auftrag waehlen.");
      loadOrderList();
    }, function (message) {
      setMessage("PDF-Export fehlgeschlagen: " + message, true);
    });
  });
}

function resetToStart(message) {
  currentOrder = null;
  dirty = false;
  elements.orderSelect.value = "";
  elements.collapseDoneInput.checked = true;
  renderCompletionFields();
  renderOrder();
  setMessage(message, false);
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

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
