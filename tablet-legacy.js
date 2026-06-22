var API_BASE = "";
var USER_KEY = "tablet-pick-user-v1";
var MODE_KEY = "tablet-pick-mode-v1";
var SORT_MODE_KEY = "tablet-pick-sort-mode-v1";
var MAIN_USER_KEY = "kommissionier-app-user-v1";
var USER_GROUP_KEY = "kommissionier-app-user-group-v1";
var CURRENT_ORDER_CACHE_KEY = "tablet-pick-current-order-v1";
var ORDER_LIST_REFRESH_MS = 30000;
var AUTO_SAVE_MS = 2500;
var SSI_STORAGE_HU_PREFIX = "34006381000";
var SSI_STORAGE_HU_SUFFIX_LENGTH = 7;
var SSI_STORAGE_HU_LENGTH = SSI_STORAGE_HU_PREFIX.length + SSI_STORAGE_HU_SUFFIX_LENGTH;
var MANUAL_STORAGE_POSITION_CREATE_COUNT_DEFAULT = 1;
var MANUAL_STORAGE_POSITION_CREATE_COUNT_MIN = 1;
var MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX = 100;

var elements = {};
var currentOrder = null;
var serverOnline = false;
var currentMode = "picking";
var dirty = false;
var orderListTimer = null;
var autoSaveTimer = null;
var savingOrder = false;
var changeRevision = 0;
var listedOrdersById = {};
var acceptedOrderGroupsById = {};
var manualStorageCustomerEdited = false;

document.addEventListener("DOMContentLoaded", function () {
  bindElements();
  bindEvents();
  loadUser();
  renderCompletionFields();
  initialize();
});

window.addEventListener("online", function () {
  if (!serverOnline) initialize();
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
    "acceptedGroupInfo",
    "sortModeSelect",
    "refreshButton",
    "manualStorageCustomerRow",
    "manualStorageCustomerInput",
    "manualStorageWarehouseRow",
    "manualStorageWarehouseSelect",
    "manualStorageStartButton",
    "takeOverButton",
    "leaveOrderButton",
    "discardOrderButton",
    "saveButton",
    "exportPdfButton",
    "euroPalletsInput",
    "storageSpacesInput",
    "orderNoteInput",
    "doneCount",
    "openCount",
    "changedCount",
    "message",
    "tabletListPanel",
    "pickHeader",
    "lineList",
    "storageLineActions",
    "manualStorageMaterialInput",
    "manualStoragePositionCountInput",
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
    renderManualStorageStartButton();
    renderTakeOverButton();
  };
  elements.userNameInput.onkeyup = function () {
    renderManualStorageStartButton();
    renderTakeOverButton();
  };
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
  if (elements.manualStorageCustomerInput) {
    elements.manualStorageCustomerInput.oninput = function () {
      manualStorageCustomerEdited = true;
      renderManualStorageStartButton();
    };
    elements.manualStorageCustomerInput.onchange = function () {
      manualStorageCustomerEdited = true;
      renderManualStorageStartButton();
    };
    elements.manualStorageCustomerInput.onkeyup = function () {
      manualStorageCustomerEdited = true;
      renderManualStorageStartButton();
    };
  }
  if (elements.manualStorageStartButton) elements.manualStorageStartButton.onclick = startManualStorageOrder;
  elements.takeOverButton.onclick = takeOverCurrentOrder;
  if (elements.leaveOrderButton) elements.leaveOrderButton.onclick = leaveCurrentOrder;
  if (elements.discardOrderButton) elements.discardOrderButton.onclick = discardCurrentManualStorageOrder;
  elements.saveButton.onclick = function () { saveOrder(false); };
  elements.exportPdfButton.onclick = exportPdf;
  elements.addStorageLineButton.onclick = addManualStorageLine;
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
    flushSyncQueue(function () {
      loadOrderList();
    });
    if (!orderListTimer) orderListTimer = window.setInterval(function () { loadOrderList({ silent: true }); }, ORDER_LIST_REFRESH_MS);
  }, function (message) {
    serverOnline = false;
    setConnectionStatus(false);
    loadOrderListFromCache(function (cached) {
      setMessage(cached ? "Offline: Auftragsliste aus Cache." : "Server nicht verbunden: " + message, !cached);
    });
  });
}

function markServerOffline() {
  serverOnline = false;
  setConnectionStatus(false);
}

function flushSyncQueue(done) {
  if (!window.OfflineStore) {
    if (done) done();
    return;
  }
  OfflineStore.getPending().then(function (pending) {
    if (!pending.length) {
      if (done) done();
      return;
    }

    var latestByKey = {};
    pending.forEach(function (item) {
      var key = syncQueueEntryKey(item);
      var existing = latestByKey[key];
      if (!existing || item.timestamp > existing.timestamp) latestByKey[key] = item;
    });

    var latestItems = Object.keys(latestByKey).map(function (key) { return latestByKey[key]; });
    var synced = 0;
    var chain = Promise.resolve();
    latestItems.forEach(function (item) {
      chain = chain.then(function () {
        return new Promise(function (resolve) {
          apiJson(item.url, { method: item.method, body: item.body }, function (result) {
            handleSyncedQueueItem(item, result).then(function () {
              var itemKey = syncQueueEntryKey(item);
              var deletions = pending
                .filter(function (entry) { return syncQueueEntryKey(entry) === itemKey; })
                .map(function (entry) { return OfflineStore.dequeue(entry.queueId); });
              Promise.all(deletions).then(function () {
                synced += 1;
                resolve();
              }, function () {
                resolve();
              });
            }, function () {
              resolve();
            });
          }, function () {
            resolve();
          });
        });
      });
    });

    chain.then(function () {
      if (synced > 0) setMessage(synced + " Offline-Aenderung" + (synced !== 1 ? "en" : "") + " synchronisiert.", false);
      if (done) done();
    }, function () {
      if (done) done();
    });
  }, function () {
    if (done) done();
  });
}

function syncQueueEntryKey(item) {
  return String(item && (item.dedupeKey || item.url) || "");
}

function handleSyncedQueueItem(item, result) {
  if (!item || item.method !== "POST" || item.url !== "/api/orders" || !window.OfflineStore) return Promise.resolve();
  var payload = {};
  try {
    payload = item.body ? JSON.parse(item.body) : {};
  } catch (error) {
    void error;
    return Promise.resolve();
  }
  var localOrder = payload.order || {};
  if (!localOrder.id) return Promise.resolve();
  var syncedOrder = applyOrderSummaryToOrder(localOrder, result && result.order);
  return saveOrderToOfflineStore(syncedOrder).then(function () {
    if (currentOrder && String(currentOrder.id) === String(localOrder.id)) {
      applyOrderSummaryToOrder(currentOrder, result && result.order);
      persistCurrentOrderCache();
      renderOrder();
    }
  });
}

function applyOrderSummaryToOrder(order, summary) {
  if (!order || !summary) return order;
  [
    "id",
    "orderNumber",
    "customerName",
    "customerGroupKey",
    "orderDate",
    "orderTime",
    "createdBy",
    "lastEditedBy",
    "activeUser",
    "activeUserAt",
    "acceptedBy",
    "acceptedAt",
    "completedBy",
    "completedAt",
    "orderWarehouse",
    "exportedAt",
    "orderType",
    "createdAt",
    "updatedAt"
  ].forEach(function (field) {
    if (Object.prototype.hasOwnProperty.call(summary, field)) order[field] = summary[field];
  });
  return order;
}

function loadOrderListFromCache(done) {
  if (!window.OfflineStore) {
    if (done) done(false);
    return;
  }
  var loadCachedGroups = OfflineStore.loadOrderGroups ? OfflineStore.loadOrderGroups().catch(function () { return []; }) : Promise.resolve([]);
  var loadCachedOrders = OfflineStore.loadOrders ? OfflineStore.loadOrders() : OfflineStore.loadOrderSummaries();
  loadCachedGroups.then(function (groups) {
    rememberAcceptedOrderGroups(groups);
    return loadCachedOrders;
  }).then(function (orders) {
    var cached = (orders || []).filter(function (order) {
      return (order.orderType || "picking") === currentMode
        && isOpenOrder(order)
        && isAcceptedByCurrentUser(order);
    }).map(normalizeOrderListEntry);
    if (!cached.length) {
      renderAcceptedGroupInfo();
      if (done) done(false);
      return;
    }
    renderCachedOrderList(cached);
    if (done) done(true);
  }, function () {
    if (done) done(false);
  });
}

function renderCachedOrderList(orders) {
  clearSelect(elements.orderSelect);
  addOption(elements.orderSelect, "", modeLabel() + " waehlen (Offline-Cache)");
  rememberListedOrders(orders);
  orders.forEach(function (order) {
    var createdTime = formatOrderCreatedAt(order.createdAt || order.updatedAt);
    var timeText = createdTime ? createdTime + " - " : "";
    addOption(
      elements.orderSelect,
      order.id,
      formatOrderOptionLabel(order, timeText) + " [Cache]"
    );
  });
  elements.orderSelect.value = currentOrder && currentOrder.id ? currentOrder.id : "";
  renderAcceptedGroupInfo();
}

function ensureCurrentOrderInSelect() {
  if (!currentOrder || !currentOrder.id || !elements.orderSelect) return;
  var summary = orderSummaryFromOrder(currentOrder);
  listedOrdersById[String(summary.id)] = summary;
  var option = null;
  for (var index = 0; index < elements.orderSelect.options.length; index += 1) {
    if (String(elements.orderSelect.options[index].value) === String(summary.id)) {
      option = elements.orderSelect.options[index];
      break;
    }
  }
  var createdTime = formatOrderCreatedAt(summary.createdAt || summary.updatedAt);
  var timeText = createdTime ? createdTime + " - " : "";
  var label = formatOrderOptionLabel(summary, timeText);
  if (option) option.text = label;
  else addOption(elements.orderSelect, summary.id, label);
  elements.orderSelect.value = summary.id;
  renderAcceptedGroupInfo();
}

function normalizeOrderListEntry(order) {
  return Array.isArray(order && order.lines) ? orderSummaryFromOrder(order) : order;
}

function rememberListedOrders(orders) {
  listedOrdersById = {};
  (orders || []).forEach(function (order) {
    if (order && order.id) listedOrdersById[String(order.id)] = order;
  });
}

function rememberAcceptedOrderGroups(groups) {
  acceptedOrderGroupsById = {};
  (groups || []).forEach(function (group) {
    if (group && group.groupId && groupBelongsToCurrentUser(group)) {
      acceptedOrderGroupsById[String(group.groupId)] = group;
    }
  });
}

function rememberAcceptedOrderGroup(group) {
  if (!group || !group.groupId || !groupBelongsToCurrentUser(group)) return;
  acceptedOrderGroupsById[String(group.groupId)] = group;
}

function buildAcceptedOrderGroup(result, detailOrders) {
  var byId = {};
  var summaries = result && Array.isArray(result.acceptedOrders) ? result.acceptedOrders : [];
  var source = (detailOrders || []).concat(summaries);
  source.forEach(function (order) {
    if (order && order.id) byId[String(order.id)] = order;
  });
  var orderIds = Object.keys(byId);
  if (orderIds.length <= 1) return null;

  var first = byId[orderIds[0]] || {};
  var group = {
    groupId: "",
    orderIds: orderIds,
    customerName: result && result.customerName || first.customerName || first.customerGroupKey || "",
    customerGroupKey: first.customerGroupKey || "",
    orderType: first.orderType || currentMode || "picking",
    acceptedBy: first.acceptedBy || currentUserName() || "",
    acceptedAt: first.acceptedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  group.groupId = acceptedOrderGroupId(group);
  return group;
}

function acceptedOrderGroupId(group) {
  return [
    "tablet",
    normalizeAcceptedGroupPart(group && group.acceptedBy || currentUserName() || "tablet"),
    normalizeAcceptedGroupPart(group && group.orderType || currentMode || "picking"),
    normalizeAcceptedGroupPart(group && (group.customerGroupKey || group.customerName || (group.orderIds || []).join("-")))
  ].join(":");
}

function normalizeAcceptedGroupPart(value) {
  return String(value || "")
    .replace(/^\s+|\s+$/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "UNBEKANNT";
}

function groupBelongsToCurrentUser(group) {
  var acceptedBy = String(group && group.acceptedBy || "").replace(/^\s+|\s+$/g, "");
  var user = currentUserName();
  return !acceptedBy || !user || sameUserName(acceptedBy, user);
}

function orderWithAcceptedGroup(order, group) {
  if (!order || !group) return order;
  var copy = {};
  Object.keys(order).forEach(function (key) {
    copy[key] = order[key];
  });
  copy.tabletGroupId = group.groupId;
  copy.tabletGroupOrderIds = (group.orderIds || []).slice();
  copy.tabletGroupCustomerName = group.customerName || "";
  copy.tabletGroupCustomerGroupKey = group.customerGroupKey || "";
  return copy;
}

function acceptedGroupForOrder(orderOrId) {
  var id = typeof orderOrId === "object" ? String(orderOrId && orderOrId.id || "") : String(orderOrId || "");
  if (!id) return null;
  var directGroupId = typeof orderOrId === "object" ? String(orderOrId && orderOrId.tabletGroupId || "") : "";
  if (directGroupId && acceptedOrderGroupsById[directGroupId]) return acceptedOrderGroupsById[directGroupId];
  var groupIds = Object.keys(acceptedOrderGroupsById);
  for (var index = 0; index < groupIds.length; index += 1) {
    var group = acceptedOrderGroupsById[groupIds[index]];
    var orderIds = (group && group.orderIds || []).map(String);
    if (orderIds.indexOf(id) >= 0) return group;
  }
  return null;
}

function orderIdInCurrentAcceptedGroup(orderId) {
  var group = acceptedGroupForOrder(currentOrder);
  return Boolean(group && (group.orderIds || []).map(String).indexOf(String(orderId || "")) >= 0);
}

function renderAcceptedGroupInfo(group) {
  if (!elements.acceptedGroupInfo) return;
  var selectedId = elements.orderSelect ? elements.orderSelect.value : "";
  var activeGroup = group || acceptedGroupForOrder(currentOrder) || acceptedGroupForOrder(selectedId);
  var orderIds = activeGroup && activeGroup.orderIds ? activeGroup.orderIds.filter(Boolean) : [];
  if (!activeGroup || orderIds.length <= 1) {
    elements.acceptedGroupInfo.hidden = true;
    elements.acceptedGroupInfo.textContent = "";
    return;
  }
  var customer = activeGroup.customerName || activeGroup.customerGroupKey || "Kunde";
  var offlineText = serverOnline ? "" : " offline";
  elements.acceptedGroupInfo.textContent = orderIds.length + " Auftraege fuer " + customer + " uebernommen -" + offlineText + " ueber die Auftragsauswahl wechselbar.";
  elements.acceptedGroupInfo.hidden = false;
}

function cacheOrderSummaries(orders) {
  if (!window.OfflineStore) return;
  OfflineStore.saveOrderSummaries(orders || []).catch(function () {});
}

function cacheAcceptedOpenOrders(orders) {
  if (!window.OfflineStore || !serverOnline) return;
  (orders || [])
    .filter(function (order) {
      return isOpenOrder(order) && isAcceptedByCurrentUser(order);
    })
    .forEach(function (order) {
      apiJson("/api/orders/" + encodeURIComponent(order.id), null, function (fullOrder) {
        saveOrderToOfflineStore(fullOrder);
      }, function () {});
    });
}

function cacheOrderDetailsFromAccept(result) {
  if (!window.OfflineStore || !result) return Promise.resolve();
  var details = Array.isArray(result.acceptedOrderDetails) ? result.acceptedOrderDetails : [];
  if (!details.length && result.order) details = [result.order];
  var group = buildAcceptedOrderGroup(result, details);
  var chain = Promise.resolve();
  if (group && OfflineStore.saveOrderGroup) {
    chain = chain.then(function () {
      return OfflineStore.saveOrderGroup(group).then(function () {
        rememberAcceptedOrderGroup(group);
        if (currentOrder && currentOrder.id && group.orderIds.map(String).indexOf(String(currentOrder.id)) >= 0) {
          currentOrder = orderWithAcceptedGroup(currentOrder, group);
        }
      });
    });
  }
  details.forEach(function (order) {
    chain = chain.then(function () { return saveOrderToOfflineStore(orderWithAcceptedGroup(order, group)); });
  });
  if (Array.isArray(result.acceptedOrders) && result.acceptedOrders.length) {
    chain = chain.then(function () { return OfflineStore.loadOrderSummaries(); }).then(function (existing) {
      var byId = {};
      (existing || []).forEach(function (order) {
        if (order && order.id) byId[order.id] = order;
      });
      result.acceptedOrders.forEach(function (order) {
        if (order && order.id) byId[order.id] = orderWithAcceptedGroup(order, group);
      });
      return OfflineStore.saveOrderSummaries(Object.keys(byId).map(function (id) { return byId[id]; }));
    }).catch(function () {});
  }
  return chain.then(function () {
    renderAcceptedGroupInfo(group);
  }).catch(function () {});
}

function saveOrderToOfflineStore(order) {
  if (!window.OfflineStore || !order || !order.id) return Promise.resolve();
  return OfflineStore.saveOrder(order)
    .then(function () { return updateCachedOrderSummary(order); })
    .catch(function () {});
}

function updateCachedOrderSummary(order) {
  if (!window.OfflineStore || !order || !order.id) return Promise.resolve();
  return OfflineStore.loadOrderSummaries().then(function (existing) {
    var byId = {};
    (existing || []).forEach(function (entry) {
      if (entry && entry.id) byId[entry.id] = entry;
    });
    byId[order.id] = orderSummaryFromOrder(order);
    return OfflineStore.saveOrderSummaries(Object.keys(byId).map(function (id) { return byId[id]; }));
  });
}

function orderSummaryFromOrder(order) {
  var lines = Array.isArray(order.lines) ? order.lines : [];
  return {
    id: order.id,
    orderNumber: order.orderNumber || (order.manualStorageDraft ? "" : order.id),
    customerName: order.customerName || "",
    customerGroupKey: order.customerGroupKey || "",
    orderDate: order.orderDate || "",
    orderTime: order.orderTime || "",
    total: lines.length,
    picked: lines.filter(function (line) { return line && line.picked; }).length,
    createdBy: order.createdBy || "",
    lastEditedBy: order.lastEditedBy || "",
    activeUser: order.activeUser || "",
    activeUserAt: order.activeUserAt || "",
    acceptedBy: order.acceptedBy || "",
    acceptedAt: order.acceptedAt || "",
    completedBy: order.completedBy || "",
    completedAt: order.completedAt || "",
    orderWarehouse: order.orderWarehouse || "",
    exportedAt: order.exportedAt || "",
    orderType: order.orderType || "picking",
    createdAt: order.createdAt || "",
    updatedAt: order.updatedAt || "",
    manualStorageDraft: order.manualStorageDraft === true,
    localDraft: order.localDraft === true
  };
}

function isAcceptedByCurrentUser(order) {
  return sameUserName(order && order.acceptedBy, currentUserName());
}

function normalizeAutoPositionNotes(notes) {
  var source = notes && typeof notes === "object" ? notes : {};
  return {
    destination: String(source.destination || "").trim(),
    quantity: String(source.quantity || "").trim(),
    storagePallet: String(source.storagePallet || "").trim(),
    loadingSlip: String(source.loadingSlip || "").trim()
  };
}

function combinedPositionNote(line) {
  return combineUniqueNoteParts([line && line.positionNote].concat(autoPositionNoteValues(line)));
}

function autoPositionNoteValues(line) {
  var notes = normalizeAutoPositionNotes(line && line.autoPositionNotes);
  return [notes.destination, notes.quantity, notes.storagePallet, notes.loadingSlip];
}

function combineUniqueNoteParts(parts) {
  var seen = {};
  var result = [];
  (parts || []).forEach(function (part) {
    var text = String(part || "").trim();
    var key = text.toUpperCase();
    if (!text || seen[key]) return;
    seen[key] = true;
    result.push(text);
  });
  return result.join("; ");
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

function isManualStorageOrder(order) {
  if (!order || (order.orderType || "picking") !== "storage") return false;
  if (order.manualStorageDraft === true || order.localDraft === true || isLocalStorageOrderId(order.id)) return true;
  var lines = (Array.isArray(order.lines) ? order.lines : []).filter(function (line) {
    return line && line.lineType !== "loading-slip" && !isEmptyManualStorageLine(line);
  });
  return Boolean(lines.length && lines.every(function (line) { return line.manual === true; }));
}

function isLocalStorageOrderId(id) {
  return String(id || "").indexOf("local-storage-") === 0;
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
    var manualStorageHeader = isManualStorageHeader();
    if (manualStorageHeader) grid.className += grid.className.indexOf("is-manual-storage-grid") < 0 ? " is-manual-storage-grid" : "";
    else grid.className = grid.className.replace(/\bis-manual-storage-grid\b/g, "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    grid.innerHTML = isStorage
      ? (manualStorageHeader
        ? "<span>Material</span><span>Stellplatz</span><span>Artikelbezeichnung</span><span>Ist</span><span>Einheit</span>"
        : "<span>Material</span><span>Stellplatz</span><span>Artikelbezeichnung</span><span>Soll</span><span>Ist</span><span>Einheit</span>")
      : "<span>Artikelnummer</span><span>Lagerplatz</span><span>Produktbeschreibung</span><span>Soll</span><span>Ist</span><span>Einheit</span>";
  }
  if (elements.exportPdfButton) elements.exportPdfButton.textContent = isStorage ? "Einlagerung abschliessen" : "PDF exportieren";
  renderManualStorageStartButton();
}

function isManualStorageHeader() {
  if (!isStorageOrder()) return false;
  var lines = currentOrder && Array.isArray(currentOrder.lines)
    ? currentOrder.lines.filter(function (line) { return line && line.lineType !== "loading-slip"; })
    : [];
  return !lines.length || lines.every(function (line) {
    return line && (line.manual === true || isEmptyManualStorageLine(line));
  });
}

function loadOrderList(options) {
  var silent = options && options.silent === true;
  if (!serverOnline) {
    loadOrderListFromCache(function (cached) {
      if (!silent) setMessage(cached ? "Offline: Auftragsliste aus Cache." : "Server nicht verbunden.", !cached);
    });
    return;
  }
  apiJson("/api/orders", null, function (orders) {
    var currentMissingOnServer = false;
    var index;
    if (currentOrder && currentOrder.id) {
      currentMissingOnServer = true;
      for (index = 0; index < orders.length; index += 1) {
        if (orders[index].id === currentOrder.id) {
          currentMissingOnServer = false;
          break;
        }
      }
    }
    var statusMessage = "";
    if (currentMissingOnServer && !dirty) {
      clearCurrentOrderCache();
      currentOrder = null;
      dirty = false;
      renderCompletionFields();
      renderOrder();
      statusMessage = "Der geoeffnete Auftrag ist auf dem Server nicht mehr vorhanden. Tablet wurde freigegeben.";
    } else if (currentMissingOnServer) {
      statusMessage = "Der geoeffnete Auftrag ist auf dem Server nicht mehr vorhanden. Nutze Auftrag verlassen, um das Tablet freizugeben.";
    }
    var selected = currentMissingOnServer ? "" : elements.orderSelect.value;
    clearSelect(elements.orderSelect);
    addOption(elements.orderSelect, "", currentMode === "storage" ? "Einlagerung waehlen" : "Auftrag waehlen");
    var count = 0;
    for (index = 0; index < orders.length; index += 1) {
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
    rememberListedOrders(orders);
    renderAcceptedGroupInfo();
    if (statusMessage) setMessage(statusMessage, currentMissingOnServer && dirty);
    else if (!silent) setMessage(count ? "Auftragsliste geladen: " + count + " Auftrag/Auftraege." : "Keine offenen " + modeLabel() + "en gefunden.", false);
    cacheOrderSummaries(orders);
    cacheAcceptedOpenOrders(orders);
  }, function (message) {
    markServerOffline();
    loadOrderListFromCache(function (cached) {
      if (!silent) {
        setMessage(cached ? "Offline: Auftragsliste aus Cache." : "Auftragsliste konnte nicht geladen werden: " + message, !cached);
      }
    });
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
  var number = order.orderNumber || (order.manualStorageDraft ? "Manuelle Einlagerung" : order.id);
  return timeText + number + " - " + (order.customerName || "") + warehouse + " [" + status + "] (" + order.picked + "/" + order.total + ")";
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

function currentOrderAcceptedByCurrentUser() {
  if (!currentOrder || !currentOrder.id || currentOrder.exportedAt) return false;
  var acceptedBy = String(currentOrder.acceptedBy || "").trim();
  return Boolean(acceptedBy && sameUserName(acceptedBy, currentUserName()));
}

function canEditCurrentOrder() {
  return currentOrderAcceptedByCurrentUser();
}

function currentOrderLocksSwitch(nextOrderId) {
  if (!currentOrder || !currentOrder.id || currentOrder.exportedAt) return false;
  if (String(nextOrderId || "") === String(currentOrder.id)) return false;
  var acceptedBy = String(currentOrder.acceptedBy || "").trim();
  if (!acceptedBy || !sameUserName(acceptedBy, currentUserName())) return false;
  var target = listedOrdersById[String(nextOrderId || "")];
  if (target && isAcceptedByCurrentUser(target)) return false;
  if (orderIdInCurrentAcceptedGroup(nextOrderId)) return false;
  return true;
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
  if (dirty && currentOrderAcceptedByCurrentUser() && isAcceptedByCurrentUser(listedOrdersById[String(id)])) {
    saveOrder(true, function () {
      loadOrder(id);
    });
    return;
  }
  if (dirty && !window.confirm("Es gibt ungespeicherte Aenderungen. Auftrag trotzdem wechseln?")) {
    elements.orderSelect.value = currentOrder ? currentOrder.id : "";
    return;
  }
  if (!serverOnline) {
    if (!window.OfflineStore) return setMessage("Offline-Cache ist nicht verfuegbar.", true);
    OfflineStore.loadOrder(id).then(function (cached) {
      if (!cached) {
        setMessage("Offline: Dieser Auftrag ist nicht im lokalen Cache vorhanden.", true);
        return;
      }
      currentOrder = cached;
      currentMode = (currentOrder.orderType || "picking") === "storage" ? "storage" : "picking";
      try {
        localStorage.setItem(MODE_KEY, currentMode);
      } catch (error) {
        void error;
      }
      currentOrder.collapseDone = true;
      renderCompletionFields();
      dirty = false;
      renderOrder();
      persistCurrentOrderCache();
      setMessage("Offline: Auftrag aus Cache geladen. Aenderungen werden bei Verbindung synchronisiert.", false);
    }, function (error) {
      setMessage("Cache-Fehler: " + (error && error.message ? error.message : error), true);
    });
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
    currentOrder.collapseDone = true;
    renderCompletionFields();
    dirty = Boolean(cachedOrder);
    renderOrder();
    if (cachedOrder) {
      setMessage("Lokaler Zwischenstand wiederhergestellt. Bitte speichern oder weiterarbeiten.", false);
      return;
    }
    persistCurrentOrderCache();
    saveOrderToOfflineStore(order);
    setMessage(currentOrder.acceptedBy && !sameUserName(currentOrder.acceptedBy, currentUserName())
      ? "Auftrag geladen. Bereits von " + currentOrder.acceptedBy + " uebernommen."
      : "Auftrag geladen.", false);
  }, function (message) {
    markServerOffline();
    if (!window.OfflineStore) {
      setMessage("Auftrag konnte nicht geladen werden: " + message, true);
      return;
    }
    OfflineStore.loadOrder(id).then(function (cached) {
      if (!cached) {
        setMessage("Auftrag konnte nicht geladen werden: " + message, true);
        return;
      }
      currentOrder = cached;
      currentMode = (currentOrder.orderType || "picking") === "storage" ? "storage" : "picking";
      try {
        localStorage.setItem(MODE_KEY, currentMode);
      } catch (error) {
        void error;
      }
      currentOrder.collapseDone = true;
      renderCompletionFields();
      dirty = false;
      renderOrder();
      persistCurrentOrderCache();
      setMessage("Offline: Auftrag aus Cache geladen. Aenderungen werden bei Verbindung synchronisiert.", false);
    }, function () {
      setMessage("Auftrag konnte nicht geladen werden: " + message, true);
    });
  });
}

function renderOrder() {
  elements.lineList.innerHTML = "";
  updateModeUi();
  renderTakeOverButton();
  if (!currentOrder || !currentOrder.lines || !currentOrder.lines.length) {
    if (elements.tabletListPanel) setHidden(elements.tabletListPanel, true);
    setHidden(elements.pickHeader, true);
    renderStorageLineActions();
    renderAcceptedGroupInfo();
    updateCounts();
    return;
  }
  if (elements.tabletListPanel) setHidden(elements.tabletListPanel, false);
  setHidden(elements.pickHeader, false);

  var sorted = sortOrderLines(currentOrder.lines);
  for (var index = 0; index < sorted.length; index += 1) {
    elements.lineList.appendChild(renderLine(sorted[index]));
  }
  renderStorageLineActions();
  renderAcceptedGroupInfo();
  updateCounts();
}

function renderManualStorageStartButton() {
  if (!elements.manualStorageStartButton) return;
  var visible = currentMode === "storage" && !currentOrder;
  if (elements.manualStorageCustomerRow) setHidden(elements.manualStorageCustomerRow, !visible);
  if (elements.manualStorageWarehouseRow) setHidden(elements.manualStorageWarehouseRow, !visible);
  clearAutofilledManualStorageCustomer(visible);
  setHidden(elements.manualStorageStartButton, !visible);
  var invalidCustomer = visible && !manualStorageCustomerIsValid();
  elements.manualStorageStartButton.disabled = !visible || !currentUserName() || invalidCustomer || (!serverOnline && !window.OfflineStore);
  elements.manualStorageStartButton.title = !currentUserName()
    ? "Bitte erst Mitarbeiter eintragen."
    : (invalidCustomer
      ? "Bitte Kunde eintragen."
      : (!serverOnline && !window.OfflineStore ? "Offline-Cache ist nicht verfuegbar." : ""));
}

function clearAutofilledManualStorageCustomer(visible) {
  if (!visible || manualStorageCustomerEdited || !elements.manualStorageCustomerInput) return;
  if (manualStorageCustomerName().toUpperCase() === "SSI") elements.manualStorageCustomerInput.value = "";
}

function renderStorageLineActions() {
  if (!elements.storageLineActions || !elements.addStorageLineButton) return;
  var isStorage = isStorageOrder();
  renderManualStorageStartButton();
  setHidden(elements.storageLineActions, !isStorage || !currentOrder);
  elements.addStorageLineButton.disabled = !isStorage || !currentOrder || !canEditCurrentOrder();
  if (elements.manualStorageMaterialInput) elements.manualStorageMaterialInput.disabled = elements.addStorageLineButton.disabled;
  if (elements.manualStoragePositionCountInput) {
    elements.manualStoragePositionCountInput.disabled = elements.addStorageLineButton.disabled;
    elements.manualStoragePositionCountInput.min = String(MANUAL_STORAGE_POSITION_CREATE_COUNT_MIN);
    elements.manualStoragePositionCountInput.max = String(MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX);
  }
}

function addManualStorageLine() {
  if (!currentOrder || !isStorageOrder()) return;
  if (!currentUserName()) {
    setMessage("Bitte erst Mitarbeiter eintragen.", true);
    return;
  }
  if (!canEditCurrentOrder()) {
    setMessage("Bearbeitung erst uebernehmen.", true);
    return;
  }
  var countResult = readManualStoragePositionCreateCount();
  if (!countResult.ok) {
    setMessage(countResult.error, true);
    if (elements.manualStoragePositionCountInput) elements.manualStoragePositionCountInput.focus();
    return;
  }
  manualStorageLinePreset(elements.manualStorageMaterialInput && elements.manualStorageMaterialInput.value || "", function (preset) {
    currentOrder.lines = Array.isArray(currentOrder.lines) ? currentOrder.lines : [];
    for (var index = 0; index < countResult.value; index += 1) {
      currentOrder.lines.push(createManualStorageLine(currentOrder.lines, preset));
    }
    if (elements.manualStorageMaterialInput) elements.manualStorageMaterialInput.value = "";
    if (elements.manualStoragePositionCountInput) elements.manualStoragePositionCountInput.value = String(MANUAL_STORAGE_POSITION_CREATE_COUNT_DEFAULT);
    markDirty();
    renderOrder();
    saveOrder(false);
  });
}

function createManualStorageLine(lines, preset) {
  preset = preset || {};
  return {
    id: createLineId(),
    orderType: "storage",
    manual: true,
    warehouseOrder: nextManualStoragePosition(lines),
    fromHandlingUnit: usesSsiStorageHuPrefix() ? SSI_STORAGE_HU_PREFIX : "",
    fromHandlingUnitEditable: true,
    positionNote: "",
    autoPositionNotes: {},
    fromBin: preset.fromBin || "",
    product: preset.product || "",
    description: preset.description || "",
    targetQty: "",
    actualQty: "",
    unit: preset.unit || "Stk",
    picked: false
  };
}

function readManualStoragePositionCreateCount() {
  var raw = String(elements.manualStoragePositionCountInput && elements.manualStoragePositionCountInput.value || MANUAL_STORAGE_POSITION_CREATE_COUNT_DEFAULT).replace(/^\s+|\s+$/g, "");
  var value = Number(raw);
  if (!isWholeNumber(value) || value < MANUAL_STORAGE_POSITION_CREATE_COUNT_MIN) {
    return {
      ok: false,
      value: MANUAL_STORAGE_POSITION_CREATE_COUNT_DEFAULT,
      error: "Anzahl Positionen muss eine positive ganze Zahl sein."
    };
  }
  if (value > MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX) {
    return {
      ok: false,
      value: MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX,
      error: "Anzahl Positionen darf maximal " + MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX + " betragen."
    };
  }
  return { ok: true, value: value, error: "" };
}

function isWholeNumber(value) {
  return isFinite(value) && Math.floor(value) === value;
}

function manualStorageLinePreset(material, done) {
  var product = normalizeDigits(material);
  var preset = product ? { product: product } : {};
  if (!product || !serverOnline) {
    done(preset);
    return;
  }
  apiJson(
    "/api/articles/lookup/" + encodeURIComponent(product) + "?warehouse=" + encodeURIComponent(manualStorageWarehouse()),
    {},
    function (article) {
      preset.product = String(article.materialnummer || product).replace(/^\s+|\s+$/g, "");
      preset.description = String(article.materialbezeichnung || "").replace(/^\s+|\s+$/g, "");
      preset.fromBin = String(article.lagerplatz || "").replace(/^\s+|\s+$/g, "");
      done(preset);
    },
    function () {
      done(preset);
    }
  );
}

function startManualStorageOrder() {
  if (!currentUserName()) {
    setMessage("Bitte erst Mitarbeiter eintragen.", true);
    renderManualStorageStartButton();
    return;
  }
  if (!manualStorageCustomerIsValid()) {
    setMessage("Bitte Kunde eintragen.", true);
    renderManualStorageStartButton();
    return;
  }
  if (currentOrder) {
    setMessage("Bitte den geoeffneten Auftrag erst abschliessen oder verlassen.", true);
    return;
  }
  currentMode = "storage";
  try {
    localStorage.setItem(MODE_KEY, currentMode);
  } catch (error) {
    void error;
  }
  currentOrder = createManualStorageOrder();
  dirty = true;
  changeRevision += 1;
  ensureCurrentOrderInSelect();
  renderCompletionFields();
  renderOrder();
  persistCurrentOrderCache();
  if (serverOnline) {
    createManualStorageOrderOnServer();
    return;
  }
  persistManualStorageOrderOffline("Offline: Manuelle Einlagerung lokal gestartet. Sie wird bei Verbindung angelegt.");
}

function createManualStorageOrder() {
  var now = new Date();
  var nowIso = now.toISOString();
  var user = currentUserName();
  var customerName = manualStorageCustomerName();
  var warehouse = manualStorageWarehouse();
  var lines = [];
  lines.push(createManualStorageLine(lines));
  return {
    id: createLocalStorageOrderId(),
    orderNumber: "",
    customerName: customerName,
    customerGroupKey: manualStorageCustomerGroupKey(customerName),
    orderDate: formatLocalDate(now),
    orderTime: formatLocalTime(now),
    euroPallets: "",
    storageSpaces: "",
    orderNote: "",
    rawText: "",
    collapseDone: true,
    orderType: "storage",
    orderWarehouse: warehouse,
    manualStorageDraft: true,
    localDraft: true,
    exportedAt: "",
    exportedPdfFile: "",
    exportedPdfPath: "",
    createdBy: user,
    lastEditedBy: user,
    activeUser: user,
    activeUserAt: nowIso,
    acceptedBy: user,
    acceptedAt: nowIso,
    completedBy: "",
    completedAt: "",
    createdAt: nowIso,
    updatedAt: nowIso,
    lines: lines
  };
}

function manualStorageCustomerName() {
  return String(elements.manualStorageCustomerInput && elements.manualStorageCustomerInput.value || "").trim();
}

function manualStorageCustomerIsValid() {
  var customerName = manualStorageCustomerName();
  return Boolean(customerName && (manualStorageCustomerEdited || customerName.toUpperCase() !== "SSI"));
}

function manualStorageCustomerGroupKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function manualStorageWarehouse() {
  var value = String(elements.manualStorageWarehouseSelect && elements.manualStorageWarehouseSelect.value || "SSI").trim().toUpperCase();
  return value === "SI" ? "SI" : "SSI";
}

function createLocalStorageOrderId() {
  if (window.crypto && window.crypto.randomUUID) return "local-storage-" + window.crypto.randomUUID();
  return "local-storage-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function formatLocalDate(date) {
  var month = String(date.getMonth() + 1);
  var day = String(date.getDate());
  if (month.length < 2) month = "0" + month;
  if (day.length < 2) day = "0" + day;
  return date.getFullYear() + "-" + month + "-" + day;
}

function formatLocalTime(date) {
  var hours = String(date.getHours());
  var minutes = String(date.getMinutes());
  if (hours.length < 2) hours = "0" + hours;
  if (minutes.length < 2) minutes = "0" + minutes;
  return hours + ":" + minutes;
}

function createManualStorageOrderOnServer() {
  if (!currentOrder) return;
  apiJson("/api/orders", {
    method: "POST",
    body: JSON.stringify({ order: currentOrder, userName: currentUserName() })
  }, function (result) {
    applyOrderSummaryToOrder(currentOrder, result && result.order);
    currentOrder.localDraft = false;
    dirty = false;
    clearCurrentOrderCache();
    ensureCurrentOrderInSelect();
    renderOrder();
    saveOrderToOfflineStore(currentOrder);
    loadOrderList({ silent: true });
    setMessage("Manuelle Einlagerung gestartet.", false);
  }, function (message) {
    persistCurrentOrderCache();
    if (!window.OfflineStore) {
      setMessage("Manuelle Einlagerung konnte nicht angelegt werden: " + message, true);
      return;
    }
    persistManualStorageOrderOffline("Server nicht erreichbar: Manuelle Einlagerung lokal gestartet und wird synchronisiert.");
  });
}

function persistManualStorageOrderOffline(message) {
  if (!window.OfflineStore || !currentOrder) {
    setMessage("Offline-Cache ist nicht verfuegbar.", true);
    return;
  }
  queueManualStorageOrderCreate(currentOrder)
    .then(function () { return saveOrderToOfflineStore(currentOrder); })
    .then(function () {
      dirty = false;
      clearCurrentOrderCache();
      ensureCurrentOrderInSelect();
      renderOrder();
      setMessage(message, false);
    }, function () {
      dirty = true;
      persistCurrentOrderCache();
      setMessage("Offline: Manuelle Einlagerung konnte nicht lokal gespeichert werden.", true);
    });
}

function queueManualStorageOrderCreate(order) {
  return OfflineStore.enqueue(
    "POST",
    "/api/orders",
    JSON.stringify({ order: order, userName: currentUserName() }),
    manualStorageCreateDedupeKey(order.id)
  );
}

function manualStorageCreateDedupeKey(orderId) {
  return "POST:/api/orders:" + String(orderId || "");
}

function storageOrderPutDedupeKey(orderId) {
  return "PUT:/api/orders/" + encodeURIComponent(orderId);
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
  var canEditOrder = canEditCurrentOrder();
  var missing = isMissingStorageLine(line);

  var card = document.createElement("article");
  var binWarningText = String(line.binWarning || "").trim();
  card.className = "pick-item" + (line.picked ? " is-done is-collapsed" : "") + (binWarningText ? " has-bin-warning" : "") + (missing ? " is-missing" : "");

  var checkWrap = document.createElement("button");
  checkWrap.type = "button";
  checkWrap.className = "check-target";
  if (line.picked) checkWrap.className += " is-picked";
  checkWrap.disabled = false;
  checkWrap.setAttribute("data-blocked", !canEditOrder || missing ? "true" : "false");
  checkWrap.setAttribute("aria-pressed", line.picked ? "true" : "false");
  checkWrap.setAttribute("aria-label", line.picked ? "Position wieder öffnen" : "Position abhaken");
  var checkmark = document.createElement("span");
  checkmark.className = "checkmark";
  checkmark.setAttribute("aria-hidden", "true");
  checkWrap.appendChild(checkmark);
  checkWrap.onclick = function (event) {
    event.preventDefault();
    event.stopPropagation();
    toggleLinePicked(line, card, checkWrap);
  };
  card.appendChild(checkWrap);

  var body = document.createElement("div");
  body.className = "line-body";
  var top = document.createElement("div");
  top.className = "line-top";
  if (isManualStorageLine) top.className += " is-manual-storage-top";

  top.appendChild(makeInput(isStorage ? "Material" : "Produkt", line.product, function (value) {
    line.product = normalizeDigits(value);
    markDirty();
  }, !canEditOrder || missing || !isManualStorageLine, "short-input", numericInputOptions()));
  var canEditBin = canEditOrder && !missing && (isStorage || Boolean(binWarningText));
  var binInput = makeInput(isStorage ? "Stellplatz" : "Lagerplatz", line.fromBin, canEditBin ? function (value) {
    line.fromBin = normalizeUppercaseText(value);
    if (shouldClearBinWarning(line, line.fromBin)) {
      line.binWarning = "";
      line.binWarningValue = "";
      renderOrder();
    }
    markDirty();
  } : null, !canEditBin, "short-input", uppercaseInputOptions());
  if (binWarningText) decorateBinWarningLabel(binInput, binWarningText);
  top.appendChild(binInput);
  top.appendChild(makeInput(isStorage ? "Artikelbezeichnung" : "Produktbeschreibung", line.description, function (value) {
    line.description = value;
    markDirty();
  }, !canEditOrder || missing || !isManualStorageLine, ""));
  if (!isManualStorageLine) {
    top.appendChild(makeInput("Soll", line.targetQty, function (value) {
      line.targetQty = value;
      markDirty();
      updateCounts();
    }, true, "short-input"));
  }
  top.appendChild(makeInput("Ist", line.actualQty, function (value) {
    line.actualQty = value;
    markDirty();
    updateCounts();
  }, !canEditOrder || missing, "short-input"));
  top.appendChild(makeInput("Einheit", line.unit, function (value) {
    line.unit = value || "Stk";
    markDirty();
  }, !canEditOrder || missing || !isManualStorageLine, "short-input"));
  body.appendChild(top);

  var locationRow = document.createElement("div");
  locationRow.className = "location-row";
  var canEditHu = isStorage || line.fromHandlingUnitEditable === true || isMissingOrIncompleteHandlingUnit(line.fromHandlingUnit);
  var useSsiStorageHuPrefix = isStorage && usesSsiStorageHuPrefix();
  locationRow.appendChild(makeInput(isStorage ? "HU" : "Von HU", storageHandlingUnitDisplayValue(line.fromHandlingUnit, useSsiStorageHuPrefix), function (value) {
    if (useSsiStorageHuPrefix) value = normalizeSsiStorageHandlingUnit(value);
    line.fromHandlingUnit = value;
    line.fromHandlingUnitEditable = canEditHu;
    markDirty();
  }, !canEditOrder || missing || !canEditHu, "", useSsiStorageHuPrefix ? ssiStorageHuInputOptions() : null));
  var noteInput = makeInput("Zusatzbemerkung", combinedPositionNote(line), function (value) {
    line.positionNote = value;
    markDirty();
  }, !canEditOrder || missing || (isStorage && !isManualStorageLine), "");
  locationRow.appendChild(noteInput);
  if (isStorage && !isEmptyManualStorageLine(line)) locationRow.appendChild(makeStorageMissingButton(line));
  if (isManualStorageLine && canEditOrder && !missing) locationRow.appendChild(makeManualStorageDeleteButton(line));
  body.appendChild(locationRow);

  card.appendChild(body);
  return card;
}

function renderLoadingSlipLine(line) {
  var canEditOrder = canEditCurrentOrder();
  var card = document.createElement("article");
  card.className = "pick-item is-loading-slip" + (line.picked ? " is-done is-collapsed" : "");

  var checkWrap = document.createElement("button");
  checkWrap.type = "button";
  checkWrap.className = "check-target";
  if (line.picked) checkWrap.className += " is-picked";
  checkWrap.disabled = false;
  checkWrap.setAttribute("data-blocked", !canEditOrder ? "true" : "false");
  checkWrap.setAttribute("aria-pressed", line.picked ? "true" : "false");
  checkWrap.setAttribute("aria-label", line.picked ? "Position wieder oeffnen" : "Position abhaken");
  var checkmark = document.createElement("span");
  checkmark.className = "checkmark";
  checkmark.setAttribute("aria-hidden", "true");
  checkWrap.appendChild(checkmark);
  checkWrap.onclick = function (event) {
    event.preventDefault();
    event.stopPropagation();
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
  var noteInput = makeInput("Zusatzbemerkung", combinedPositionNote(line), function (value) {
    line.positionNote = value;
    markDirty();
  }, !canEditOrder, "");
  noteRow.appendChild(noteInput);
  body.appendChild(noteRow);

  card.appendChild(body);
  return card;
}

function toggleLinePicked(line, card, button) {
  if (!canEditCurrentOrder()) {
    setMessage("Bearbeitung erst uebernehmen.", true);
    return;
  }
  if (isMissingStorageLine(line)) return;
  if (!line.picked && storageLineCompletionErrors(line).length) {
    setMessage(storageLineErrorMessage(line), true);
    return;
  }
  line.picked = !line.picked;
  updateLinePickedState(line, card, button);
  markDirty();
  updateCounts();
}

function makeStorageMissingButton(line) {
  var missing = isMissingStorageLine(line);
  var button = document.createElement("button");
  button.type = "button";
  button.className = "missing-line-toggle" + (missing ? " restore-missing" : " danger-button");
  button.textContent = missing ? "Wiederherstellen" : "Fehlmenge";
  button.disabled = !canEditCurrentOrder();
  button.onclick = function (event) {
    event.preventDefault();
    event.stopPropagation();
    toggleStorageLineMissing(line);
  };
  return button;
}

function toggleStorageLineMissing(line) {
  if (!currentOrder || !isStorageOrder() || !line || isEmptyManualStorageLine(line)) return;
  if (!canEditCurrentOrder()) {
    setMessage("Bearbeitung erst uebernehmen.", true);
    return;
  }
  if (isMissingStorageLine(line)) {
    if (!window.confirm("Fehlmenge fuer diese Position wiederherstellen?")) return;
    delete line.missing;
    delete line.missingBy;
    delete line.missingAt;
    delete line.missingNote;
  } else {
    if (!window.confirm("Diese Position als Fehlmenge markieren? Sie wird nicht als Wareneingang gebucht.")) return;
    line.missing = true;
    line.missingBy = currentUserName() || "Tablet";
    line.missingAt = new Date().toISOString();
    line.missingNote = line.missingNote || "nicht geliefert";
    line.picked = false;
  }
  markDirty();
  renderOrder();
  saveOrder(false);
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
  var handlingUnit = usesSsiStorageHuPrefix()
    ? (isCompleteSsiStorageHandlingUnit(line.fromHandlingUnit) ? line.fromHandlingUnit : "")
    : line.fromHandlingUnit;
  return [
    line.product,
    line.description,
    line.actualQty,
    handlingUnit,
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
    card.className += " is-collapsed";
    button.className += " is-picked";
  }
  button.setAttribute("aria-pressed", picked ? "true" : "false");
  button.setAttribute("aria-label", picked ? "Position wieder öffnen" : "Position abhaken");
}

function makeInput(labelText, value, onChange, readOnly, className, inputOptions) {
  var options = inputOptions || {};
  var label = document.createElement("label");
  label.appendChild(document.createTextNode(labelText));
  var input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.className = className || "";
  if (options.inputMode) input.inputMode = options.inputMode;
  if (options.pattern) input.pattern = options.pattern;
  if (options.maxLength) input.maxLength = options.maxLength;
  if (options.autocapitalize) input.setAttribute("autocapitalize", options.autocapitalize);
  if (readOnly) {
    input.readOnly = true;
    input.setAttribute("readonly", "");
    input.className = (input.className ? input.className + " " : "") + "readonly-input";
  }
  var handleChange = function () {
    if (input.readOnly) return;
    if (options.normalize) input.value = options.normalize(input.value);
    if (onChange) onChange(input.value);
  };
  input.oninput = handleChange;
  input.onchange = handleChange;
  input.onkeyup = handleChange;
  label.appendChild(input);
  return label;
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function storageOrderUsesSsiCustomer() {
  var value = currentOrder ? currentOrder.customerName : manualStorageCustomerName();
  return manualStorageCustomerGroupKey(value) === "SSI";
}

function usesSsiStorageHuPrefix() {
  return isStorageOrder() && storageOrderUsesSsiCustomer();
}

function normalizeSsiStorageHandlingUnit(value) {
  var digits = normalizeDigits(value);
  if (!digits) return SSI_STORAGE_HU_PREFIX;
  if (digits.indexOf(SSI_STORAGE_HU_PREFIX) === 0) return digits.slice(0, SSI_STORAGE_HU_LENGTH);
  var suffix = digits.length <= SSI_STORAGE_HU_SUFFIX_LENGTH
    ? digits
    : digits.slice(digits.length - SSI_STORAGE_HU_SUFFIX_LENGTH);
  return SSI_STORAGE_HU_PREFIX + suffix;
}

function isCompleteSsiStorageHandlingUnit(value) {
  var digits = normalizeDigits(value);
  return digits.indexOf(SSI_STORAGE_HU_PREFIX) === 0 && digits.length === SSI_STORAGE_HU_LENGTH;
}

function isIncompleteSsiStorageHandlingUnit(value) {
  var digits = normalizeDigits(value);
  return digits.indexOf(SSI_STORAGE_HU_PREFIX) === 0 && digits.length < SSI_STORAGE_HU_LENGTH;
}

function isMissingOrIncompleteHandlingUnit(value) {
  var text = String(value || "").trim();
  return !text || isIncompleteSsiStorageHandlingUnit(text);
}

function storageHandlingUnitDisplayValue(value, useSsiStorageHuPrefix) {
  return useSsiStorageHuPrefix ? normalizeSsiStorageHandlingUnit(value) : value || "";
}

function ssiStorageHuInputOptions() {
  return {
    inputMode: "numeric",
    pattern: "[0-9]*",
    maxLength: SSI_STORAGE_HU_LENGTH,
    normalize: normalizeSsiStorageHandlingUnit
  };
}

function normalizeUppercaseText(value) {
  return String(value || "").toUpperCase();
}

function numericInputOptions() {
  return {
    inputMode: "numeric",
    pattern: "[0-9]*",
    normalize: normalizeDigits
  };
}

function uppercaseInputOptions() {
  return {
    autocapitalize: "characters",
    normalize: normalizeUppercaseText
  };
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
  var isMine = acceptedBy && sameUserName(acceptedBy, user);
  var canEditOrder = hasOrder && Boolean(isMine);
  var manualStorage = isManualStorageOrder(currentOrder);
  setHidden(elements.takeOverButton, !hasOrder || isMine);
  elements.takeOverButton.disabled = !hasOrder || !user || !serverOnline;
  elements.takeOverButton.innerHTML = escapeHtml(acceptedBy ? "Von " + acceptedBy + " uebernommen" : "Bearbeitung uebernehmen");
  if (elements.leaveOrderButton) {
    setHidden(elements.leaveOrderButton, !hasOrder || !isMine || manualStorage);
    elements.leaveOrderButton.disabled = !hasOrder;
  }
  renderDiscardOrderButton(hasOrder, isMine, manualStorage);
  elements.saveButton.disabled = !canEditOrder;
  elements.exportPdfButton.disabled = !canEditOrder;
  renderManualStorageStartButton();
  renderStorageLineActions();
}

function renderDiscardOrderButton(hasOrder, isMine, manualStorage) {
  if (!elements.discardOrderButton) return;
  var localManualStorage = Boolean(manualStorage && currentOrder && (currentOrder.localDraft === true || isLocalStorageOrderId(currentOrder.id)));
  var visible = Boolean(hasOrder && manualStorage && (isMine || localManualStorage));
  setHidden(elements.discardOrderButton, !visible);
  elements.discardOrderButton.textContent = "Einlagerung abbrechen";
  elements.discardOrderButton.disabled = !visible || (!serverOnline && !window.OfflineStore && !localManualStorage);
  elements.discardOrderButton.title = visible ? "Manuelle Einlagerung abbrechen und Auftrag loeschen." : "";
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
  var localOrderBeforeAccept = currentOrderAcceptedByCurrentUser() ? currentOrder : null;
  var hadLocalChanges = dirty && Boolean(localOrderBeforeAccept);
  acceptOrderOnServer(currentOrder.id, function (accepted) {
    if (accepted && accepted.order) currentOrder = localOrderBeforeAccept ? mergeLocalOrderAfterAccept(accepted.order, localOrderBeforeAccept) : accepted.order;
    currentOrder.collapseDone = true;
    renderCompletionFields();
    renderOrder();
    persistCurrentOrderCache();
    var finishTakeOver = function () {
      cacheOrderDetailsFromAccept(accepted).then(function () {
        loadOrderList({ silent: true });
        setMessage(acceptedOrderMessage(accepted), false);
      }, function () {
        loadOrderList({ silent: true });
        setMessage(acceptedOrderMessage(accepted), false);
      });
    };
    if (hadLocalChanges) {
      saveOrder(true, finishTakeOver);
    } else {
      dirty = false;
      finishTakeOver();
    }
  }, function (message) {
    setMessage("Bearbeitung konnte nicht uebernommen werden: " + message, true);
  });
}

function releaseOrderOnServer(id, success, failure) {
  if (!serverOnline) {
    if (success) success({ ok: true, localOnly: true });
    return;
  }
  apiJson("/api/orders/" + encodeURIComponent(id) + "/release", {
    method: "POST",
    body: JSON.stringify({ userName: currentUserName() })
  }, success, failure);
}

function leaveCurrentOrder() {
  if (!currentOrder || !currentOrder.id) {
    resetToStart("Tablet freigegeben.");
    return;
  }
  var label = lockedOrderLabel();
  var warning = dirty
    ? "Auftrag " + label + " verlassen? Ungespeicherte Aenderungen auf diesem Tablet werden verworfen."
    : "Auftrag " + label + " verlassen und zur Auftragsauswahl zurueckkehren?";
  if (!window.confirm(warning)) return;

  var leavingOrderId = currentOrder.id;
  releaseOrderOnServer(leavingOrderId, function () {
    resetToStart("Auftrag verlassen. Bitte Auftrag waehlen.");
    loadOrderList({ silent: true });
  }, function (message) {
    resetToStart("Auftrag lokal verlassen. Serverfreigabe konnte nicht bestaetigt werden.");
    loadOrderList({ silent: true });
    setMessage("Auftrag lokal verlassen. Servermeldung: " + message, true);
  });
}

function discardCurrentManualStorageOrder() {
  if (!currentOrder || !currentOrder.id || !isManualStorageOrder(currentOrder)) return setMessage("Kein manueller Einlagerauftrag geoeffnet.", true);
  var orderId = currentOrder.id;
  var localManualStorage = currentOrder.localDraft === true || isLocalStorageOrderId(orderId);
  if (!canEditCurrentOrder() && !localManualStorage) return setMessage("Bearbeitung erst uebernehmen.", true);
  if (!serverOnline && !window.OfflineStore && !localManualStorage) return setMessage("Einlagerung kann ohne Serververbindung nicht geloescht werden.", true);
  var label = lockedOrderLabel() || "manuelle Einlagerung";
  if (!window.confirm("Manuelle Einlagerung " + label + " wirklich abbrechen? Der Auftrag wird geloescht und nicht synchronisiert.")) return;

  if (serverOnline && !isLocalStorageOrderId(orderId)) {
    apiJson("/api/orders/" + encodeURIComponent(orderId), { method: "DELETE" }, function () {
      removeOrderFromOfflineStore(orderId).then(function () {
        resetToStart("Manuelle Einlagerung abgebrochen.");
        loadOrderList({ silent: true });
      });
    }, function (message) {
      setMessage("Auftrag konnte nicht verworfen werden: " + message, true);
    });
    return;
  }

  var cleanup = removeOrderFromOfflineStore(orderId);
  if (!isLocalStorageOrderId(orderId) && window.OfflineStore) {
    cleanup = cleanup.then(function () {
      return OfflineStore.enqueue("DELETE", "/api/orders/" + encodeURIComponent(orderId), "", deleteOrderDedupeKey(orderId));
    });
  }
  cleanup.then(function () {
    resetToStart("Manuelle Einlagerung abgebrochen.");
    loadOrderList({ silent: true });
  }, function () {
    setMessage("Auftrag konnte lokal nicht abgebrochen werden.", true);
  });
}

function removeOrderFromOfflineStore(orderId) {
  if (!window.OfflineStore || !orderId) return Promise.resolve();
  return removeQueuedOrderMutations(orderId)
    .then(function () {
      return OfflineStore.deleteOrder ? OfflineStore.deleteOrder(orderId) : Promise.resolve();
    })
    .then(function () {
      return OfflineStore.deleteOrderSummary ? OfflineStore.deleteOrderSummary(orderId) : OfflineStore.loadOrderSummaries().then(function (orders) {
        return OfflineStore.saveOrderSummaries((orders || []).filter(function (order) {
          return String(order && order.id || "") !== String(orderId);
        }));
      });
    });
}

function removeQueuedOrderMutations(orderId) {
  if (!window.OfflineStore || !OfflineStore.getPending) return Promise.resolve();
  return OfflineStore.getPending().then(function (pending) {
    var removals = (pending || [])
      .filter(function (entry) { return queuedMutationMatchesOrder(entry, orderId); })
      .map(function (entry) { return OfflineStore.dequeue(entry.queueId); });
    return Promise.all(removals);
  });
}

function queuedMutationMatchesOrder(entry, orderId) {
  var id = String(orderId || "");
  var encodedId = encodeURIComponent(id);
  var key = syncQueueEntryKey(entry);
  if (key === manualStorageCreateDedupeKey(id) || key === storageOrderPutDedupeKey(id) || key === deleteOrderDedupeKey(id)) return true;
  if (String(entry && entry.url || "") === "/api/orders/" + encodedId) return true;
  try {
    var payload = entry && entry.body ? JSON.parse(entry.body) : {};
    return String(payload && payload.order && payload.order.id || "") === id;
  } catch (error) {
    void error;
    return false;
  }
}

function deleteOrderDedupeKey(orderId) {
  return "DELETE:/api/orders/" + encodeURIComponent(orderId);
}

function mergeLocalOrderAfterAccept(acceptedOrder, localOrder) {
  if (!acceptedOrder || !localOrder) return acceptedOrder || localOrder;
  var merged = {};
  var key;
  for (key in localOrder) {
    if (Object.prototype.hasOwnProperty.call(localOrder, key)) merged[key] = localOrder[key];
  }
  for (key in acceptedOrder) {
    if (Object.prototype.hasOwnProperty.call(acceptedOrder, key)) merged[key] = acceptedOrder[key];
  }
  ["euroPallets", "storageSpaces", "orderNote"].forEach(function (field) {
    if (String(localOrder[field] || "").trim()) merged[field] = localOrder[field];
  });

  var serverLines = Array.isArray(acceptedOrder.lines) ? acceptedOrder.lines : [];
  var localLines = Array.isArray(localOrder.lines) ? localOrder.lines : [];
  if (!localLines.length) return merged;

  var editableFields = [
    "actualQty",
    "autoPositionNotes",
    "binWarning",
    "binWarningValue",
    "description",
    "fromBin",
    "fromHandlingUnit",
    "manualStorageLine",
    "missing",
    "missingAt",
    "missingBy",
    "missingNote",
    "palletInfo",
    "picked",
    "positionNote",
    "product",
    "targetQty",
    "unit"
  ];
  var localById = {};
  localLines.forEach(function (line) {
    localById[line.id] = line;
  });
  var serverIds = {};
  var mergedLines = serverLines.map(function (line) {
    serverIds[line.id] = true;
    var localLine = localById[line.id];
    if (!localLine) return line;
    var nextLine = {};
    var lineKey;
    for (lineKey in line) {
      if (Object.prototype.hasOwnProperty.call(line, lineKey)) nextLine[lineKey] = line[lineKey];
    }
    editableFields.forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(localLine, field)) nextLine[field] = localLine[field];
    });
    return nextLine;
  });

  localLines.forEach(function (line) {
    if (!serverIds[line.id] && !isEmptyManualStorageLine(line)) mergedLines.push(line);
  });
  merged.lines = mergedLines.length ? mergedLines : localLines;
  return merged;
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
  var canEditOrder = hasOrder && canEditCurrentOrder();
  elements.euroPalletsInput.disabled = !canEditOrder;
  elements.storageSpacesInput.disabled = !canEditOrder;
  elements.orderNoteInput.disabled = !canEditOrder;
  elements.euroPalletsInput.value = currentOrder ? currentOrder.euroPallets || "" : "";
  elements.storageSpacesInput.value = currentOrder ? currentOrder.storageSpaces || "" : "";
  elements.orderNoteInput.value = currentOrder ? currentOrder.orderNote || "" : "";
}

function updateCompletionFieldsFromInputs() {
  if (!currentOrder || !canEditCurrentOrder()) return;
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
  if (!canEditCurrentOrder()) {
    if (!silent) setMessage("Bearbeitung erst uebernehmen.", true);
    return;
  }
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

  if (!serverOnline) {
    saveCurrentOrderOffline(silent, onSuccess, revision);
    return;
  }

  apiJson("/api/orders/" + encodeURIComponent(currentOrder.id), {
    method: "PUT",
    body: JSON.stringify({ order: currentOrder, userName: currentUserName() })
  }, function (result) {
    applyOrderSummaryToOrder(currentOrder, result && result.order);
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
    saveOrderToOfflineStore(currentOrder);
    loadOrderList();
    if (onSuccess) onSuccess();
  }, function (message) {
    markServerOffline();
    if (!saveCurrentOrderOffline(silent, onSuccess, revision)) {
      savingOrder = false;
      persistCurrentOrderCache();
      setMessage("Speichern fehlgeschlagen: " + message, true);
    }
  });
}

function saveCurrentOrderOffline(silent, onSuccess, revision) {
  if (!window.OfflineStore) {
    savingOrder = false;
    if (!silent) setMessage("Server nicht verbunden.", true);
    return false;
  }
  var url = "/api/orders/" + encodeURIComponent(currentOrder.id);
  OfflineStore.enqueue("PUT", url, JSON.stringify({ order: currentOrder, userName: currentUserName() }), storageOrderPutDedupeKey(currentOrder.id))
    .then(function () { return saveOrderToOfflineStore(currentOrder); })
    .then(function () {
      savingOrder = false;
      if (changeRevision === revision) {
        dirty = false;
        clearCurrentOrderCache();
      } else {
        dirty = true;
        persistCurrentOrderCache();
        scheduleAutoSave();
      }
      if (!silent) setMessage("Offline gespeichert - wird synchronisiert, sobald der Server erreichbar ist.", false);
      if (onSuccess) onSuccess();
    }, function () {
      savingOrder = false;
      persistCurrentOrderCache();
      if (!silent) setMessage("Offline: Lokales Speichern fehlgeschlagen.", true);
    });
  return true;
}

function exportPdf() {
  if (!currentOrder || !currentOrder.id) return setMessage("Kein Auftrag ausgewaehlt.", true);
  if (!currentUserName()) return setMessage("Bitte erst Mitarbeiter eintragen.", true);
  if (!canEditCurrentOrder()) return setMessage("Bearbeitung erst uebernehmen.", true);
  pruneEmptyManualStorageLines();
  var completionMessage = exportCompletionMessage();
  if (completionMessage) {
    renderOrder();
    setMessage(completionMessage, true);
    window.alert(completionMessage);
    return;
  }
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

function exportCompletionMessage() {
  var lines = (currentOrder && Array.isArray(currentOrder.lines) ? currentOrder.lines : []).filter(function (line) {
    return !isEmptyManualStorageLine(line);
  });
  if (!lines.length) return "Export gesperrt: Auftrag hat keine Positionen.";
  var openLines = lines.filter(function (line) {
    return !line.picked && !isMissingStorageLine(line);
  });
  if (!openLines.length) return "";
  return "Export gesperrt: Erst alle Positionen abhaken (" + openLines.length + " offen" + openPositionListText(openLines) + ").";
}

function openPositionListText(lines) {
  var positions = lines.slice(0, 5).map(function (line, index) {
    return String(storageLinePosition(line, index)).trim();
  }).filter(Boolean);
  if (!positions.length) return "";
  return ": Pos. " + positions.join(", ") + (lines.length > positions.length ? ", ..." : "");
}

function resetToStart(message) {
  clearCurrentOrderCache();
  currentOrder = null;
  dirty = false;
  elements.orderSelect.value = "";
  renderCompletionFields();
  renderOrder();
  setMessage(message, false);
}

function scheduleAutoSave() {
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(function () {
    autoSaveTimer = null;
    if (!dirty || !currentOrder || !currentOrder.id || !currentUserName()) return;
    if (!serverOnline && !window.OfflineStore) return;
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
    merged.autoPositionNotes = normalizeAutoPositionNotes(previous && previous.autoPositionNotes || line.autoPositionNotes);
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
  if (!sameUserName(serverOrder.acceptedBy, currentUserName())) return null;
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
  var lines = (currentOrder && currentOrder.lines ? currentOrder.lines : []).filter(function (line) {
    return !isEmptyManualStorageLine(line);
  });
  var done = 0;
  var changed = 0;
  for (var index = 0; index < lines.length; index += 1) {
    if (lines[index].picked || isMissingStorageLine(lines[index])) done += 1;
    if (isMissingStorageLine(lines[index]) || storageLineQuantityChanged(lines[index])) changed += 1;
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
    if (!lines[index].picked && !isMissingStorageLine(lines[index])) return false;
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
  if (isMissingStorageLine(line)) return [];
  var errors = [];
  var product = String(line.product || "").trim();
  var handlingUnit = String(line.fromHandlingUnit || "").trim();
  if (!product) errors.push("Artikelnummer fehlt");
  else if (!/^\d+$/.test(product)) errors.push("Artikelnummer darf nur Zahlen enthalten");
  if (line.manual !== true && !String(line.description || "").trim()) errors.push("Artikelbezeichnung fehlt");
  if (!String(line.fromBin || "").trim()) errors.push("Stellplatz fehlt");
  if (requiresStorageHandlingUnit()) {
    if (usesSsiStorageHuPrefix()) {
      if (!isCompleteSsiStorageHandlingUnit(handlingUnit)) {
        errors.push("HU muss mit " + SSI_STORAGE_HU_PREFIX + " beginnen und danach " + SSI_STORAGE_HU_SUFFIX_LENGTH + " Ziffern enthalten");
      }
    } else if (!handlingUnit) {
      errors.push("HU fehlt");
    }
  }
  if (!readTabletQuantity(line.actualQty || line.targetQty)) errors.push("Menge fehlt");
  return errors;
}

function storageLineQuantityChanged(line) {
  if (line && line.manual === true && !String(line.targetQty || "").trim()) return false;
  return String(line && line.actualQty || "").trim() !== String(line && line.targetQty || "").trim();
}

function requiresStorageHandlingUnit() {
  return isStorageOrder() && storageOrderUsesSsiCustomer();
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

  return "";
}

function isPlausiblePickingBin(value) {
  var bin = normalizePickingBinText(value);
  if (/^(?:002|022)-H\d{1,2}-R\d{1,3}$/i.test(bin)) return true;
  if (/^002-H1-A[A-L]1$/i.test(bin)) return true;
  if (/^002-H1-SA[A-T](?:[1-9]|1[0-2])[A-D][1-3]$/i.test(bin)) return true;
  if (/^002-H3-S[O-Z](?:[1-9]|1[0-2])[A-D][1-3]$/i.test(bin)) return true;
  if (/^002-H4-S[A-N](?:[1-9]|1[0-2])[A-D][1-4]$/i.test(bin)) return true;
  return false;
}

function normalizePickingBinText(value) {
  var bin = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/^O/, "0")
    .replace(/^QD/, "00");
  if (/^H1A[A-L]1$/i.test(bin)) return "002-H1-" + bin.slice(2);
  return bin;
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

function isMissingStorageLine(line) {
  return line && line.missing === true;
}

function apiJson(url, options, success, failure) {
  var xhr = new XMLHttpRequest();
  var method = options && options.method ? options.method : "GET";
  var requestUrl = API_BASE + url;
  if (method === "GET") {
    requestUrl += (requestUrl.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
  }
  xhr.open(method, requestUrl, true);
  xhr.timeout = 5000;
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("Cache-Control", "no-cache");
  xhr.setRequestHeader("Pragma", "no-cache");
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
  xhr.ontimeout = function () {
    if (failure) failure("Server antwortet nicht rechtzeitig");
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
