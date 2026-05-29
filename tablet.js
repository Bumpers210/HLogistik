(function () {
  var API_BASE = "";
  var USER_KEY = "tablet-pick-user-v1";
  var MAIN_USER_KEY = "kommissionier-app-user-v1";
  var ORDER_LIST_REFRESH_MS = 120000;
  var AUTO_SAVE_MS = 10000;

  var elements = {};
  var currentOrder = null;
  var serverOnline = false;
  var dirty = false;
  var orderListTimer = null;
  var saveTimer = null;

  document.addEventListener("DOMContentLoaded", function () {
    bindElements();
    bindEvents();
    loadUser();
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
      "doneCount",
      "openCount",
      "changedCount",
      "message",
      "pickHeader",
      "lineList"
    ];
    for (var i = 0; i < ids.length; i += 1) {
      elements[ids[i]] = document.getElementById(ids[i]);
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
        return;
      }
      resetToStart("Bitte Auftrag wählen.");
    };
    elements.refreshButton.onclick = loadOrderList;
    elements.takeOverButton.onclick = takeOverCurrentOrder;
    elements.saveButton.onclick = function () {
      saveOrder(false);
    };
    elements.exportPdfButton.onclick = exportPdf;
    elements.collapseDoneInput.onchange = function () {
      if (!currentOrder) return;
      currentOrder.collapseDone = elements.collapseDoneInput.checked;
      renderOrder();
    };
  }

  function initialize() {
    setConnectionStatus(null);
    apiJson("GET", "/api/health", null, function () {
      serverOnline = true;
      setConnectionStatus(true);
      loadOrderList();
      orderListTimer = window.setInterval(loadOrderList, ORDER_LIST_REFRESH_MS);
      saveTimer = window.setInterval(function () {
        if (dirty) saveOrder(true);
      }, AUTO_SAVE_MS);
    }, function () {
      serverOnline = false;
      setConnectionStatus(false);
      setMessage("Server nicht verbunden.", true);
    });
  }

  function loadUser() {
    try {
      elements.userNameInput.value = localStorage.getItem(USER_KEY) || localStorage.getItem(MAIN_USER_KEY) || "";
    } catch (error) {
      elements.userNameInput.value = "";
    }
  }

  function saveUser() {
    try {
      localStorage.setItem(USER_KEY, elements.userNameInput.value || "");
      localStorage.setItem(MAIN_USER_KEY, elements.userNameInput.value || "");
    } catch (error) {
      // Alte Browser können lokalen Speicher blockieren; die Pickliste bleibt trotzdem nutzbar.
    }
  }

  function loadOrderList() {
    if (!serverOnline) return;
    apiJson("GET", "/api/orders", null, function (orders) {
      var selected = elements.orderSelect.value;
      clearSelect(elements.orderSelect);
      addOption(elements.orderSelect, "", "Auftrag wählen");
      for (var i = 0; i < orders.length; i += 1) {
        var order = orders[i];
        if ((order.orderType || "picking") !== "picking") continue;
        addOption(
          elements.orderSelect,
          order.id,
          (order.orderNumber || order.id) + " - " + (order.customerName || "") + " (" + order.picked + "/" + order.total + ")"
        );
      }
      elements.orderSelect.value = selected;
      setMessage(currentOrder ? "Auftragsliste aktualisiert." : "Bitte Auftrag wählen.", false);
    }, function (error) {
      setMessage("Auftragsliste konnte nicht geladen werden: " + error, true);
    });
  }

  function loadOrder(id) {
    if (!id) return;
    if (dirty && !window.confirm("Es gibt ungespeicherte Änderungen. Auftrag trotzdem wechseln?")) {
      elements.orderSelect.value = currentOrder ? currentOrder.id : "";
      return;
    }

    apiJson("GET", "/api/orders/" + encodeURIComponent(id), null, function (order) {
      currentOrder = order;
      currentOrder.collapseDone = currentOrder.collapseDone !== false;
      elements.collapseDoneInput.checked = currentOrder.collapseDone;
      dirty = false;
      renderOrder();
      setMessage(
        currentOrder.activeUser && currentOrder.activeUser !== currentUserName()
          ? "Auftrag geladen. Aktuell in Bearbeitung: " + currentOrder.activeUser + "."
          : "Auftrag geladen.",
        false
      );
    }, function (error) {
      setMessage("Auftrag konnte nicht geladen werden: " + error, true);
    });
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

    var sorted = currentOrder.lines.slice().sort(function (a, b) {
      return String(a.fromBin || "").localeCompare(String(b.fromBin || ""));
    });

    for (var i = 0; i < sorted.length; i += 1) {
      elements.lineList.appendChild(renderLine(sorted[i]));
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
    card.appendChild(checkWrap);

    var body = document.createElement("div");
    body.className = "line-body";

    var isMissingHandlingUnit = !String(line.fromHandlingUnit || "").trim();
    var canEditHandlingUnit = line.fromHandlingUnitEditable === true || isMissingHandlingUnit;

    var top = document.createElement("div");
    top.className = "line-top";
    top.appendChild(makeInput("Produkt", line.product, function () {}, { readOnly: true, className: "short-input" }));
    top.appendChild(makeInput("Lagerplatz", line.fromBin, function () {}, { readOnly: true, className: "short-input" }));
    top.appendChild(makeInput("Produktbeschreibung", line.description, function () {}, { readOnly: true }));
    top.appendChild(makeInput("Soll", line.targetQty, function () {}, { readOnly: true, className: "short-input" }));
    top.appendChild(makeInput("Ist", line.actualQty, function (value) {
        line.actualQty = value;
        markDirty();
        updateCounts();
      }, { className: "short-input" }));
    top.appendChild(makeInput("Einheit", line.unit, function () {}, { readOnly: true, className: "short-input" }));
    body.appendChild(top);

    var locationRow = document.createElement("div");
    locationRow.className = "location-row";
    locationRow.appendChild(makeInput("Von HU", line.fromHandlingUnit, function (value) {
        line.fromHandlingUnit = value;
        line.fromHandlingUnitEditable = canEditHandlingUnit;
        markDirty();
      }, { readOnly: !canEditHandlingUnit, digitsOnly: true }));
    locationRow.appendChild(makeInput("Zusatzbemerkung", line.positionNote, function (value) {
      line.positionNote = value;
      markDirty();
    }));
    body.appendChild(locationRow);

    card.appendChild(body);
    return card;
  }

  function makeInput(labelText, value, onChange, options) {
    options = options || {};
    var label = document.createElement("label");
    label.appendChild(document.createTextNode(labelText));
    var input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.className = options.className || "";
    if (options.readOnly) {
      input.readOnly = true;
      input.setAttribute("readonly", "");
      input.className = (input.className ? input.className + " " : "") + "readonly-input";
    }
    input.onchange = function () {
      if (input.readOnly) return;
      if (options.digitsOnly) input.value = input.value.replace(/[^0-9,]/g, "");
      onChange(input.value);
    };
    input.onkeyup = function () {
      if (input.readOnly) return;
      if (options.digitsOnly) input.value = input.value.replace(/[^0-9,]/g, "");
      onChange(input.value);
    };
    label.appendChild(input);
    return label;
  }

  function renderTakeOverButton() {
    if (!elements.takeOverButton) return;
    var hasOrder = Boolean(currentOrder && currentOrder.id && currentOrder.lines && currentOrder.lines.length);
    var activeUser = currentOrder ? String(currentOrder.activeUser || "").trim() : "";
    var user = currentUserName();
    var isMine = activeUser && activeUser === user;
    elements.takeOverButton.hidden = !hasOrder || isMine;
    elements.takeOverButton.disabled = !hasOrder || !user || !serverOnline;
    elements.takeOverButton.innerHTML = escapeHtml(activeUser ? "Bearbeitung von " + activeUser + " übernehmen" : "Bearbeitung übernehmen");
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
    touchOrder();
    setMessage("Änderungen noch nicht gespeichert.", false);
  }

  function touchOrder() {
    if (!currentOrder) return;
    var user = currentUserName() || "Tablet";
    var now = new Date().toISOString();
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

  function saveOrder(silent, onSuccess) {
    if (!currentOrder || !currentOrder.id) return;
    touchOrder();
    apiJson("PUT", "/api/orders/" + encodeURIComponent(currentOrder.id), { order: currentOrder }, function () {
      dirty = false;
      setMessage(silent ? "Automatisch gespeichert." : "Auftrag gespeichert.", false);
      loadOrderList();
      if (onSuccess) onSuccess();
    }, function (error) {
      setMessage("Speichern fehlgeschlagen: " + error, true);
    });
  }

  function exportPdf() {
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
    saveOrder(true, function () {
      apiJson("POST", "/api/orders/" + encodeURIComponent(currentOrder.id) + "/export-pdf", { order: currentOrder }, function (result) {
        dirty = false;
        resetToStart("PDF erfolgreich exportiert. Bitte Auftrag wählen.");
        loadOrderList();
      }, function (error) {
        setMessage("PDF-Export fehlgeschlagen: " + error, true);
      });
    });
  }

  function resetToStart(message) {
    currentOrder = null;
    dirty = false;
    elements.orderSelect.value = "";
    elements.collapseDoneInput.checked = true;
    renderOrder();
    setMessage(message || "Bitte Auftrag wählen.", false);
  }

  function updateCounts() {
    var lines = currentOrder && currentOrder.lines ? currentOrder.lines : [];
    var done = 0;
    var changed = 0;
    for (var i = 0; i < lines.length; i += 1) {
      if (lines[i].picked) done += 1;
      if (String(lines[i].actualQty || "").trim() !== String(lines[i].targetQty || "").trim()) changed += 1;
    }
    elements.doneCount.innerHTML = done;
    elements.openCount.innerHTML = Math.max(lines.length - done, 0);
    elements.changedCount.innerHTML = changed;
  }

  function allPicked() {
    var lines = currentOrder && currentOrder.lines ? currentOrder.lines : [];
    if (!lines.length) return false;
    for (var i = 0; i < lines.length; i += 1) {
      if (!lines[i].picked) return false;
    }
    return true;
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
    elements.message.className = "message" + (isError ? " is-error" : "");
    elements.message.innerHTML = escapeHtml(text);
  }

  function apiJson(method, url, body, success, failure) {
    var request = new XMLHttpRequest();
    request.open(method, API_BASE + url, true);
    request.setRequestHeader("Content-Type", "application/json");
    request.onreadystatechange = function () {
      if (request.readyState !== 4) return;
      var data = null;
      try {
        data = request.responseText ? JSON.parse(request.responseText) : null;
      } catch (error) {
        failure("Ungültige Serverantwort");
        return;
      }
      if (request.status >= 200 && request.status < 300 && (!data || data.ok !== false)) {
        success(data);
        return;
      }
      failure(data && data.error ? data.error : "Serverfehler");
    };
    request.onerror = function () {
      failure("Netzwerkfehler");
    };
    request.send(body ? JSON.stringify(body) : null);
  }

  function clearSelect(select) {
    while (select.options.length) select.remove(0);
  }

  function addOption(select, value, text) {
    var option = document.createElement("option");
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
}());
