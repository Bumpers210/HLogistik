(function () {
  var SEARCH_DEBOUNCE_MS = 250;
  var SOURCE_PAGE_SIZE = 20;
  var HISTORY_RESULT_LIMIT = 30;
  var elements = {};
  var options = {};
  var initialized = false;
  var active = false;
  var serverOnline = false;
  var currentUser = { name: "", group: "tablet" };
  var loadedSources = [];
  var sourceSearchQuery = "";
  var sourceSearchOffset = 0;
  var sourceSearchHasMore = false;
  var sourceSearchLoading = false;
  var selectedSource = null;
  var selectionStale = false;
  var selectionNeedsValidation = false;
  var validationPending = false;
  var validationSequence = 0;
  var snapshotMeta = null;
  var snapshotStorageInfo = null;
  var snapshotSyncing = false;
  var snapshotRefreshToken = 0;
  var currentDraftId = "";
  var savedFingerprint = "";
  var submitting = false;
  var historyTimer = null;
  var cameraStream = null;
  var cameraDetector = null;
  var cameraTargetId = "";
  var cameraFrame = 0;
  var cameraLastDetection = 0;

  function initialize(configuration) {
    options = configuration || {};
    if (initialized) return;
    bindElements();
    bindEvents();
    renderSources([]);
    renderSelectedSource();
    renderTransferPdfActions(null);
    renderDrafts([]);
    renderHistory([]);
    initialized = true;
  }

  function bindElements() {
    [
      "transferWorkspace",
      "transferCapabilityStatus",
      "transferSnapshotStatus",
      "transferRefreshSnapshotButton",
      "transferWarehouseSelect",
      "transferSourceSearchForm",
      "transferSourceSearchInput",
      "transferSourceCameraButton",
      "transferSourceSearchButton",
      "transferSourcePreviousButton",
      "transferSourceNextButton",
      "transferSourceStatus",
      "transferSourceCount",
      "transferSourceTableBody",
      "transferSelectedSourceCard",
      "transferSelectedSourceTitle",
      "transferSelectedSourceBin",
      "transferSelectedSourceUnit",
      "transferSelectedSourceQuantity",
      "transferSelectedSourcePallets",
      "transferForm",
      "transferTargetBinInput",
      "transferTargetCameraButton",
      "transferReferenceInput",
      "transferSaveDraftButton",
      "transferBookButton",
      "transferStatus",
      "transferPdfActions",
      "transferPdfDownloadLink",
      "transferPdfPrintLink",
      "transferDraftCount",
      "transferDraftList",
      "transferHistoryCount",
      "transferHistorySearchInput",
      "transferRefreshHistoryButton",
      "transferHistoryTableBody",
      "transferCameraOverlay",
      "transferCameraVideo",
      "transferCameraStatus",
      "transferCloseCameraButton"
    ].forEach(function (id) {
      elements[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    elements.transferWarehouseSelect.addEventListener("change", changeWarehouse);
    elements.transferRefreshSnapshotButton.addEventListener("click", refreshStockSnapshot);
    elements.transferSourceSearchForm.addEventListener("submit", searchSources);
    elements.transferSourceSearchInput.addEventListener("keydown", handleSourceScannerEnter);
    elements.transferSourcePreviousButton.addEventListener("click", loadPreviousSourcePage);
    elements.transferSourceNextButton.addEventListener("click", loadNextSourcePage);
    elements.transferSourceTableBody.addEventListener("click", selectSourceFromTable);
    elements.transferForm.addEventListener("submit", submitTransfer);
    elements.transferTargetBinInput.addEventListener("input", updateActions);
    elements.transferTargetBinInput.addEventListener("keydown", preventTargetScannerSubmit);
    elements.transferReferenceInput.addEventListener("input", updateActions);
    elements.transferSaveDraftButton.addEventListener("click", saveCurrentDraft);
    elements.transferDraftList.addEventListener("click", handleDraftAction);
    elements.transferRefreshHistoryButton.addEventListener("click", loadHistory);
    elements.transferHistorySearchInput.addEventListener("input", function () {
      window.clearTimeout(historyTimer);
      historyTimer = window.setTimeout(loadHistory, SEARCH_DEBOUNCE_MS);
    });
    elements.transferSourceCameraButton.addEventListener("click", openCameraForButton);
    elements.transferTargetCameraButton.addEventListener("click", openCameraForButton);
    elements.transferCloseCameraButton.addEventListener("click", closeCamera);
    elements.transferCameraOverlay.addEventListener("click", function (event) {
      if (event.target === elements.transferCameraOverlay) closeCamera();
    });
    window.addEventListener("beforeunload", closeCamera);
  }

  function activate(context) {
    if (!initialized) initialize(options);
    var next = context || {};
    currentUser = {
      name: String(next.userName || readOption("getUserName") || "").trim(),
      group: normalizeGroup(next.userGroup || readOption("getUserGroup") || "tablet")
    };
    if (!canAccess(currentUser.group)) {
      active = false;
      elements.transferWorkspace.hidden = true;
      return false;
    }
    active = true;
    elements.transferWorkspace.hidden = false;
    var warehouse = normalizeWarehouse(next.warehouse || readOption("getWarehouse") || elements.transferWarehouseSelect.value);
    elements.transferWarehouseSelect.value = warehouse;
    updateUnitLabels();
    loadDrafts();
    loadSnapshotMetadata();
    setOnline(next.online === true);
    if (!currentUser.name) setStatus(elements.transferStatus, "Bitte Mitarbeiter eintragen.", true);
    return true;
  }

  function deactivate() {
    active = false;
    closeCamera();
    if (elements.transferWorkspace) elements.transferWorkspace.hidden = true;
  }

  function updateContext(context) {
    if (!active) return;
    activate(context || {});
  }

  function setOnline(value) {
    var wasOnline = serverOnline;
    serverOnline = value === true;
    if (!active) return;
    if (!serverOnline) {
      if (wasOnline && loadedSources.length) {
        resetSourceSearchResults();
      }
      validationSequence += 1;
      validationPending = false;
      if (selectedSource) {
        selectionNeedsValidation = true;
        selectionStale = false;
      }
      renderSelectedSource();
      renderCapabilityStatus(
        "Offline – keine Buchung möglich. Suche verwendet ausschließlich den letzten vollständigen Lager-Snapshot; Entwürfe bleiben ungeprüft.",
        "offline"
      );
      setStatus(elements.transferSourceStatus, "Offline: Suchbegriff eingeben. Es wird nur im gespeicherten Lager-Snapshot gesucht.", false);
      setStatus(elements.transferStatus, "Offline: Nur ungeprüften Entwurf speichern. Verbindliches Buchen ist gesperrt.", false);
      updateActions();
      loadSnapshotMetadata();
      return;
    }
    if (!wasOnline && loadedSources.length) {
      resetSourceSearchResults();
      setStatus(elements.transferSourceStatus, "Wieder online: Bitte Quelle neu suchen; Offline-Treffer wurden verworfen.", false);
    } else if (!String(elements.transferSourceSearchInput.value || "").trim()) {
      setStatus(elements.transferSourceStatus, "Bitte Suchbegriff eingeben.", false);
    }
    if (!selectedSource) {
      selectionNeedsValidation = false;
      selectionStale = false;
      validationPending = false;
      renderCapabilityStatus("Online: Verbindliche Buchungen sind nach aktueller Bestandsprüfung möglich.", "online");
      setStatus(elements.transferStatus, currentUser.name
        ? "Quelle wählen und Zielstellplatz eingeben."
        : "Bitte Mitarbeiter eintragen.", !currentUser.name);
      updateActions();
    } else {
      selectionNeedsValidation = true;
      selectionStale = false;
      validationPending = true;
      renderSelectedSource();
      renderCapabilityStatus("Wieder online – der geöffnete Quellbestand wird geprüft. Die Buchung bleibt bis zum Ergebnis gesperrt.", "checking");
      setStatus(elements.transferStatus, "Quellbestand wird gegen den aktuellen Onlinebestand geprüft...", false);
      validateResumedSource(false).then(function () {
        if (!serverOnline) return;
        renderCapabilityStatus("Online – Quellbestand geprüft. Die verbindliche Buchung kann bestätigt werden.", "online");
        setStatus(elements.transferStatus, "Quellbestand geprüft. Buchung kann bestätigt werden.", false);
      }).catch(function (error) {
        if (!serverOnline || error.validationCancelled) return;
        if (error.sourceConflict) {
          renderCapabilityStatus("Online – der Bestand weicht vom Entwurf ab. Quelle erneut suchen und auswählen.", "conflict");
          setStatus(elements.transferStatus, "Der geöffnete Entwurf ist veraltet. Bitte Quelle erneut suchen und auswählen.", true);
        } else {
          renderCapabilityStatus("Online – Bestandsprüfung fehlgeschlagen. Die Buchung bleibt gesperrt.", "conflict");
          setStatus(elements.transferStatus, "Bestandsprüfung fehlgeschlagen: " + error.message + ". Bitte erneut verbinden oder Quelle neu laden.", true);
        }
      });
    }
    loadHistory();
    loadSnapshotMetadata().then(function () {
      if (!wasOnline && serverOnline) refreshStockSnapshot();
    });
  }

  function changeWarehouse() {
    var warehouse = currentWarehouse();
    snapshotRefreshToken += 1;
    snapshotSyncing = false;
    snapshotMeta = null;
    if (typeof options.onWarehouseChange === "function") options.onWarehouseChange(warehouse);
    updateUnitLabels();
    clearTransferEditor();
    resetSourceSearchResults();
    loadDrafts();
    setOnline(serverOnline);
    loadSnapshotMetadata().then(function () {
      if (serverOnline) refreshStockSnapshot();
    });
  }

  function updateUnitLabels() {
    var labels = currentWarehouse() === "SSI"
      ? { singular: "HU-Nummer", short: "HU" }
      : { singular: "LE-Nummer", short: "LE" };
    Array.prototype.forEach.call(elements.transferWorkspace.querySelectorAll("[data-transfer-unit]"), function (element) {
      element.textContent = labels[element.getAttribute("data-transfer-unit")] || labels.singular;
    });
  }

  function searchSources(event) {
    if (event) event.preventDefault();
    var query = String(elements.transferSourceSearchInput.value || "").trim();
    if (!query) return setStatus(elements.transferSourceStatus, "Bitte Artikel, Barcode, Stellplatz oder HU/LE eingeben.", true);
    sourceSearchQuery = query;
    loadSourcePage(0);
  }

  function loadPreviousSourcePage() {
    if (sourceSearchLoading || sourceSearchOffset <= 0 || !sourceSearchQuery) return;
    loadSourcePage(Math.max(0, sourceSearchOffset - SOURCE_PAGE_SIZE));
  }

  function loadNextSourcePage() {
    if (sourceSearchLoading || !sourceSearchHasMore || !sourceSearchQuery) return;
    loadSourcePage(sourceSearchOffset + loadedSources.length);
  }

  function loadSourcePage(offset) {
    var safeOffset = Math.max(0, Number(offset) || 0);
    sourceSearchLoading = true;
    renderSourcePagination();
    setStatus(elements.transferSourceStatus, serverOnline ? "Bestand wird online gesucht..." : "Gespeicherter Snapshot wird durchsucht...", false);
    var searchPromise = serverOnline
      ? resolveSourceSearch(sourceSearchQuery, safeOffset)
      : resolveOfflineSourceSearch(sourceSearchQuery, safeOffset);
    searchPromise.then(function (locations) {
      var page = normalizeSourcePage(locations, safeOffset);
      loadedSources = page.rows;
      sourceSearchOffset = page.offset;
      sourceSearchHasMore = page.hasMore;
      sourceSearchLoading = false;
      renderSources(loadedSources);
      setStatus(elements.transferSourceStatus, loadedSources.length
        ? sourceResultRangeText() + (serverOnline ? " Online-Bestandszeilen geladen." : " Snapshot-Bestandszeilen geladen.") +
          (sourceSearchHasMore ? " Weitere Treffer sind verfügbar." : "")
        : (serverOnline ? "Kein positiver Bestand gefunden." : "Kein passender Bestand im vollständigen Snapshot gefunden."), false);
    }).catch(function (error) {
      sourceSearchLoading = false;
      loadedSources = [];
      sourceSearchOffset = safeOffset;
      sourceSearchHasMore = false;
      renderSources([]);
      setStatus(elements.transferSourceStatus, "Suche fehlgeschlagen: " + error.message, true);
    });
  }

  function handleSourceScannerEnter(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchSources();
  }

  function preventTargetScannerSubmit(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    updateActions();
  }

  function resolveSourceSearch(query, offset) {
    var warehouseQuery = "warehouse=" + encodeURIComponent(currentWarehouse()) +
      "&offset=" + Math.max(0, Number(offset) || 0) + "&limit=" + (SOURCE_PAGE_SIZE + 1);
    return apiJson("/api/articles/lookup/" + encodeURIComponent(query) + "?" + warehouseQuery).then(function (article) {
      return apiJson("/api/storage/locations?" + warehouseQuery + "&materialnummer=" + encodeURIComponent(article.materialnummer || query));
    }).catch(function () {
      return apiJson("/api/storage/locations?" + warehouseQuery + "&q=" + encodeURIComponent(query));
    }).then(function (rows) {
      return sourcePageFromRows(rows, offset);
    });
  }

  function resolveOfflineSourceSearch(query, offset) {
    var apiError = transferSnapshotApiError("searchTransferStockSnapshot");
    if (apiError) return Promise.reject(apiError);
    return window.OfflineStore.searchTransferStockSnapshot(currentWarehouse(), query, {
      offset: Math.max(0, Number(offset) || 0),
      limit: SOURCE_PAGE_SIZE
    }).then(function (result) {
      snapshotMeta = result && result.metadata || null;
      renderSnapshotStatus();
      if (!snapshotMeta) throw new Error("Für " + currentWarehouse() + " ist noch kein vollständiger Snapshot gespeichert");
      return result || { rows: [], offset: offset, hasMore: false };
    }).catch(function (error) {
      if (error && !error.offlineStoreCode && String(error.message || "").indexOf("noch kein vollständiger Snapshot") >= 0) throw error;
      throw snapshotStorageUiError("Offline-Suche fehlgeschlagen", error);
    });
  }

  function loadSnapshotMetadata() {
    var apiError = transferSnapshotApiError("loadTransferStockSnapshotMeta");
    if (apiError) {
      snapshotMeta = null;
      renderSnapshotStatus(apiError.message, true);
      return Promise.resolve(null);
    }
    var warehouse = currentWarehouse();
    return window.OfflineStore.probeTransferStockSnapshotStorage().then(function (diagnostic) {
      snapshotStorageInfo = diagnostic || null;
      if (!diagnostic || diagnostic.ok !== true) {
        var error = storageDiagnosticError(
          diagnostic && diagnostic.code || "TRANSFER_STORAGE_UNAVAILABLE",
          diagnostic && diagnostic.message || "Umlagerungs-Offline-Speicher ist nicht verfügbar"
        );
        error.originalName = String(diagnostic && diagnostic.originalName || "");
        error.originalMessage = String(diagnostic && diagnostic.originalMessage || "");
        error.dbVersion = Number(diagnostic && diagnostic.dbVersion || 0);
        error.objectStores = diagnostic && Array.isArray(diagnostic.objectStores) ? diagnostic.objectStores.slice() : [];
        throw error;
      }
      return window.OfflineStore.loadTransferStockSnapshotMeta(warehouse);
    }).then(function (metadata) {
      if (warehouse !== currentWarehouse()) return null;
      snapshotMeta = metadata || null;
      renderSnapshotStatus();
      return snapshotMeta;
    }).catch(function (error) {
      snapshotMeta = null;
      renderSnapshotStatus(snapshotStorageUiError("Snapshot-Status konnte nicht geladen werden", error).message, true);
      return null;
    });
  }

  function refreshStockSnapshot(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!serverOnline || snapshotSyncing) return Promise.resolve(snapshotMeta);
    var apiError = transferSnapshotApiError("replaceTransferStockSnapshot");
    if (apiError) {
      renderSnapshotStatus(apiError.message, true);
      return Promise.resolve(null);
    }
    var warehouse = currentWarehouse();
    var token = snapshotRefreshToken + 1;
    snapshotRefreshToken = token;
    snapshotSyncing = true;
    updateActions();
    renderSnapshotStatus("Snapshot " + warehouse + " wird vollständig und atomar aktualisiert...", false, "checking");
    return window.OfflineStore.probeTransferStockSnapshotStorage().then(function (diagnostic) {
      snapshotStorageInfo = diagnostic || null;
      if (!diagnostic || diagnostic.ok !== true) throw storageDiagnosticError(
        diagnostic && diagnostic.code || "TRANSFER_STORAGE_UNAVAILABLE",
        diagnostic && diagnostic.message || "Umlagerungs-Offline-Speicher ist nicht verfügbar"
      );
      return refreshPagedStockSnapshot(warehouse);
    }).then(function (metadata) {
      return window.OfflineStore.probeTransferStockSnapshotStorage().then(function (diagnostic) {
        snapshotStorageInfo = diagnostic || null;
        return metadata;
      });
    }).then(function (metadata) {
      if (token !== snapshotRefreshToken || warehouse !== currentWarehouse()) return metadata;
      snapshotMeta = metadata;
      renderSnapshotStatus();
      return metadata;
    }).catch(function (error) {
      if (token !== snapshotRefreshToken || warehouse !== currentWarehouse()) return null;
      return loadSnapshotMetadata().then(function () {
        var preserved = snapshotMeta
          ? " Letzter vollständiger Stand " + formatDateTime(snapshotMeta.capturedAt) + " bleibt erhalten."
          : " Es ist noch kein vollständiger Snapshot verfügbar.";
        renderSnapshotStatus(snapshotStorageUiError("Snapshot-Aktualisierung unterbrochen", error).message + "." + preserved, true);
        return snapshotMeta;
      });
    }).then(function (metadata) {
      if (token === snapshotRefreshToken) {
        snapshotSyncing = false;
        updateActions();
      }
      return metadata;
    });
  }

  function refreshPagedStockSnapshot(warehouse) {
    var pageSize = 100;
    var session = null;
    var expectedSnapshotKey = "";
    var expectedRowCount = -1;
    var nextOffset = 0;

    function loadPage() {
      return apiJson(
        "/api/storage/locations/snapshot?warehouse=" + encodeURIComponent(warehouse) +
          "&offset=" + nextOffset + "&limit=" + pageSize,
        { timeout: 30000 }
      ).then(function (page) {
        var rows = page && Array.isArray(page.rows) ? page.rows : [];
        if (!page || normalizeWarehouse(page.warehouse) !== warehouse || !page.capturedAt || !page.snapshotKey || Number(page.offset) !== nextOffset || rows.length > pageSize) {
          throw new Error("Server lieferte keine gültige Snapshot-Seite");
        }
        if (!session) {
          expectedSnapshotKey = String(page.snapshotKey);
          expectedRowCount = Number(page.rowCount);
          if (!isFinite(expectedRowCount) || expectedRowCount < 0) throw new Error("Server lieferte keine gültige Snapshot-Zeilenzahl");
          return window.OfflineStore.beginTransferStockSnapshotUpdate({
            warehouse: warehouse,
            capturedAt: page.capturedAt,
            rowCount: expectedRowCount,
            snapshotKey: expectedSnapshotKey
          }).then(function (createdSession) {
            session = createdSession;
            return appendPage(page, rows);
          });
        }
        if (String(page.snapshotKey) !== expectedSnapshotKey || Number(page.rowCount) !== expectedRowCount) {
          throw new Error("Lagerbestand änderte sich während der Snapshot-Aktualisierung");
        }
        return appendPage(page, rows);
      });
    }

    function appendPage(page, rows) {
      return window.OfflineStore.appendTransferStockSnapshotPage(session, rows).then(function () {
        nextOffset += rows.length;
        if (page.hasMore === true) {
          if (!rows.length || nextOffset >= expectedRowCount) throw new Error("Snapshot-Seitenfolge ist unvollständig");
          return loadPage();
        }
        if (nextOffset !== expectedRowCount) throw new Error("Snapshot ist unvollständig: " + nextOffset + " von " + expectedRowCount + " Zeilen");
        return window.OfflineStore.completeTransferStockSnapshotUpdate(session);
      });
    }

    return loadPage().catch(function (error) {
      if (!session) throw error;
      return window.OfflineStore.abortTransferStockSnapshotUpdate(session).then(function () { throw error; });
    });
  }

  function renderSnapshotStatus(message, isError, state) {
    if (!elements.transferSnapshotStatus) return;
    if (message) {
      elements.transferSnapshotStatus.textContent = message + snapshotStorageStatusText();
    } else if (snapshotMeta) {
      elements.transferSnapshotStatus.textContent = formatNumber(snapshotMeta.rowCount) + " positive Bestandszeilen";
    } else {
      elements.transferSnapshotStatus.textContent = "Noch kein vollständiger Snapshot gespeichert.";
    }
    elements.transferSnapshotStatus.className = "tablet-transfer-snapshot-status" +
      (isError ? " is-error" : state === "checking" ? " is-checking" : "");
  }

  function snapshotStorageStatusText() {
    if (!snapshotStorageInfo || !snapshotStorageInfo.backend) return "";
    if (snapshotStorageInfo.backend === "IndexedDB") return " Speicher: IndexedDB.";
    if (snapshotStorageInfo.backend === "WebSQL") {
      var fallback = snapshotStorageInfo.fallbackReason || {};
      return " Speicher: WebSQL (Legacy-Fallback). IndexedDB-Diagnose [" +
        String(fallback.code || "IDB_UNKNOWN_ERROR") + "]: " + String(fallback.message || "Schreib-/Leseprobe fehlgeschlagen") + ".";
    }
    return " Speicher: " + String(snapshotStorageInfo.backend) + ".";
  }

  function transferSnapshotApiError(methodName) {
    if (!window.OfflineStore) {
      return snapshotStorageUiError(
        "Offline-Speicher-Skript fehlt",
        storageDiagnosticError("OFFLINE_STORE_SCRIPT_MISSING", "offline-store.js wurde nicht geladen oder von diesem Browser nicht ausgeführt")
      );
    }
    if (Number(window.OfflineStore.transferSnapshotApiVersion || 0) < 6 ||
        typeof window.OfflineStore[methodName] !== "function" ||
        typeof window.OfflineStore.probeTransferStockSnapshotStorage !== "function") {
      var version = String(window.OfflineStore.transferSnapshotApiVersion || "alt");
      return snapshotStorageUiError(
        "Offline-Speicher-Version veraltet",
        storageDiagnosticError("OFFLINE_STORE_API_OUTDATED", "Snapshot-Methode " + methodName + " fehlt; geladene API-Version: " + version + ". Seite online vollständig neu laden")
      );
    }
    return null;
  }

  function storageDiagnosticError(code, message) {
    var error = new Error(message);
    error.offlineStoreCode = code;
    return error;
  }

  function snapshotStorageUiError(action, error) {
    var code = String(error && error.offlineStoreCode || error && error.name || "IDB_UNKNOWN_ERROR");
    var message = String(error && error.message || "Unbekannter Fehler");
    var details = [];
    var originalName = String(error && error.originalName || "");
    var originalMessage = String(error && error.originalMessage || "");
    var dbVersion = Number(error && error.dbVersion || 0);
    var objectStores = error && Array.isArray(error.objectStores) ? error.objectStores : [];
    if (message.indexOf("Originalfehler:") < 0 && (originalName || originalMessage)) {
      details.push("Originalfehler: " + (originalName || "unbekannt") + (originalMessage ? ": " + originalMessage : ""));
    }
    if (message.indexOf("DB-Version:") < 0 && dbVersion) details.push("DB-Version: " + dbVersion);
    if (message.indexOf("Object-Stores:") < 0 && objectStores.length) details.push("Object-Stores: " + objectStores.join(", "));
    var uiError = storageDiagnosticError(code, action + " [" + code + "]: " + message + (details.length ? " | " + details.join(" | ") : ""));
    uiError.originalName = originalName;
    uiError.originalMessage = originalMessage;
    uiError.dbVersion = dbVersion;
    uiError.objectStores = objectStores.slice();
    return uiError;
  }

  function renderSources(locations) {
    elements.transferSourceTableBody.innerHTML = "";
    renderSourcePagination();
    if (!locations.length) {
      elements.transferSourceTableBody.innerHTML = '<tr><td colspan="6">Keine Bestandszeilen gefunden.</td></tr>';
      return;
    }
    locations.forEach(function (location) {
      var row = document.createElement("tr");
      row.innerHTML =
        "<td><strong>" + escapeHtml(location.materialnummer) + "</strong><small>" + escapeHtml(location.materialbezeichnung || location.barcode || "") + "</small></td>" +
        "<td>" + escapeHtml(location.lagerplatz) + "</td>" +
        "<td>" + escapeHtml(location.leNummer || "-") + "</td>" +
        "<td>" + escapeHtml(formatNumber(location.mengeStueck)) + "</td>" +
        "<td>" + escapeHtml(formatNumber(location.paletten)) + "</td>" +
        '<td><button type="button" data-transfer-source-id="' + escapeAttribute(location.id) + '">Wählen</button></td>';
      elements.transferSourceTableBody.appendChild(row);
    });
  }

  function renderSourcePagination() {
    var range = sourceResultRangeText();
    elements.transferSourceCount.textContent = range || "0 Treffer";
    elements.transferSourcePreviousButton.hidden = sourceSearchOffset <= 0;
    elements.transferSourcePreviousButton.disabled = sourceSearchLoading || sourceSearchOffset <= 0;
    elements.transferSourceNextButton.hidden = !sourceSearchHasMore;
    elements.transferSourceNextButton.disabled = sourceSearchLoading || !sourceSearchHasMore;
  }

  function sourceResultRangeText() {
    if (!loadedSources.length) return "";
    var first = sourceSearchOffset + 1;
    var last = sourceSearchOffset + loadedSources.length;
    return first === last ? first + " Treffer" : first + "–" + last + " Treffer";
  }

  function sourcePageFromRows(rows, offset) {
    var values = Array.isArray(rows) ? rows : [];
    return {
      rows: values.slice(0, SOURCE_PAGE_SIZE),
      offset: Math.max(0, Number(offset) || 0),
      hasMore: values.length > SOURCE_PAGE_SIZE
    };
  }

  function normalizeSourcePage(page, offset) {
    if (Array.isArray(page)) return sourcePageFromRows(page, offset);
    return {
      rows: page && Array.isArray(page.rows) ? page.rows.slice(0, SOURCE_PAGE_SIZE) : [],
      offset: Math.max(0, Number(page && page.offset != null ? page.offset : offset) || 0),
      hasMore: Boolean(page && page.hasMore)
    };
  }

  function resetSourceSearchResults() {
    loadedSources = [];
    sourceSearchQuery = "";
    sourceSearchOffset = 0;
    sourceSearchHasMore = false;
    sourceSearchLoading = false;
    renderSources([]);
  }

  function selectSourceFromTable(event) {
    var button = closest(event.target, "data-transfer-source-id");
    if (!button) return;
    var id = button.getAttribute("data-transfer-source-id");
    var source = findById(loadedSources, id);
    if (!source) return;
    var preserveDraft = Boolean(currentDraftId && selectionStale);
    selectedSource = cloneSource(source);
    selectionStale = false;
    selectionNeedsValidation = !serverOnline;
    validationPending = false;
    validationSequence += 1;
    if (!preserveDraft) currentDraftId = "";
    savedFingerprint = "";
    if (!preserveDraft) {
      elements.transferTargetBinInput.value = "";
      elements.transferReferenceInput.value = "";
    }
    renderSelectedSource();
    elements.transferTargetBinInput.focus();
    if (serverOnline) {
      renderCapabilityStatus("Online – aktuelle Quellzeile ausgewählt. Vor der Buchung wird sie erneut geprüft.", "online");
      setStatus(elements.transferStatus, preserveDraft
        ? "Quelle erneut ausgewählt. Entwurf kann gespeichert oder nach erneuter Prüfung gebucht werden."
        : "Quelle gewählt. Zielstellplatz eingeben und Buchung prüfen.", false);
    } else {
      renderCapabilityStatus(
        "Offline – die gewählte Zeile stammt aus dem gespeicherten Snapshot. Nur ungeprüften Entwurf speichern; Buchen ist gesperrt.",
        "offline"
      );
      setStatus(elements.transferStatus, "Offline-Snapshot gewählt. Der Entwurf bleibt bis zur Onlineprüfung ungeprüft.", false);
    }
  }

  function cloneSource(source) {
    return {
      id: String(source.id || ""),
      lager: String(source.lager || currentWarehouse()),
      artikelId: String(source.artikelId || ""),
      materialnummer: String(source.materialnummer || ""),
      barcode: String(source.barcode || ""),
      materialbezeichnung: String(source.materialbezeichnung || ""),
      lagerplatz: String(source.lagerplatz || ""),
      leNummer: String(source.leNummer || ""),
      mengeStueck: Number(source.mengeStueck || 0),
      paletten: Number(source.paletten || 0),
      aktualisiertAm: String(source.aktualisiertAm || "")
    };
  }

  function renderSelectedSource() {
    var hasSource = Boolean(selectedSource);
    toggleClass(elements.transferSelectedSourceCard, "is-empty", !hasSource);
    toggleClass(elements.transferSelectedSourceCard, "is-stale", selectionStale);
    toggleClass(elements.transferSelectedSourceCard, "is-unchecked", hasSource && !selectionStale && (selectionNeedsValidation || validationPending));
    elements.transferSelectedSourceTitle.textContent = hasSource
      ? selectedSource.materialnummer + (selectedSource.materialbezeichnung ? " – " + selectedSource.materialbezeichnung : "")
      : "Keine Quelle gewählt";
    elements.transferSelectedSourceBin.textContent = hasSource ? selectedSource.lagerplatz : "-";
    elements.transferSelectedSourceUnit.textContent = hasSource ? selectedSource.leNummer || "-" : "-";
    elements.transferSelectedSourceQuantity.textContent = hasSource ? formatNumber(selectedSource.mengeStueck) : "-";
    elements.transferSelectedSourcePallets.textContent = hasSource ? formatNumber(selectedSource.paletten) : "-";
    updateActions();
  }

  function updateActions() {
    var complete = Boolean(selectedSource && String(elements.transferTargetBinInput.value || "").trim() && currentUser.name);
    elements.transferBookButton.disabled = !complete || !serverOnline || selectionStale || selectionNeedsValidation || validationPending || submitting;
    elements.transferSaveDraftButton.disabled = !complete || submitting || !window.OfflineStore;
    elements.transferSourceCameraButton.disabled = !serverOnline;
    elements.transferSourceSearchInput.disabled = false;
    elements.transferSourceSearchButton.disabled = false;
    elements.transferRefreshSnapshotButton.disabled = !serverOnline || snapshotSyncing;
    elements.transferRefreshHistoryButton.disabled = !serverOnline;
    elements.transferHistorySearchInput.disabled = !serverOnline;
    elements.transferTargetCameraButton.disabled = !selectedSource || !serverOnline || !cameraSupported();
  }

  function submitTransfer(event) {
    event.preventDefault();
    if (submitting) return;
    if (!currentUser.name) return setStatus(elements.transferStatus, "Bitte Mitarbeiter eintragen.", true);
    if (!selectedSource) return setStatus(elements.transferStatus, "Bitte zuerst eine Quellzeile wählen.", true);
    if (!serverOnline) return setStatus(elements.transferStatus, "Offline kann nicht gebucht werden. Bitte Entwurf speichern.", true);
    var targetBin = String(elements.transferTargetBinInput.value || "").trim();
    if (!targetBin) return setStatus(elements.transferStatus, "Zielstellplatz fehlt.", true);

    submitting = true;
    updateActions();
    validateResumedSource(true).then(function () {
      var message = "Vollständige Bestandszeile umlagern?\n\n" +
        selectedSource.materialnummer + "\n" + selectedSource.lagerplatz + " → " + targetBin + "\n" +
        formatNumber(selectedSource.mengeStueck) + " Stück, " + formatNumber(selectedSource.paletten) + " Paletten";
      if (!window.confirm(message)) throw new Error("Buchung abgebrochen");
      var transferId = currentDraftId || createTransferId();
      currentDraftId = transferId;
      return apiJson("/api/storage/transfers?warehouse=" + encodeURIComponent(currentWarehouse()), {
        method: "POST",
        body: JSON.stringify({ transfer: {
          id: transferId,
          sourceLocationId: selectedSource.id,
          expectedQuantity: selectedSource.mengeStueck,
          expectedUpdatedAt: selectedSource.aktualisiertAm,
          targetBin: targetBin,
          reference: String(elements.transferReferenceInput.value || "").trim(),
          userName: currentUser.name
        } })
      }).then(function (result) {
        return deleteDraft(transferId).catch(function () {}).then(function () { return result; });
      });
    }).then(function (result) {
      renderTransferPdfActions(result.pdf);
      setStatus(elements.transferStatus,
        (result.replayed ? "Umlagerung war bereits gebucht: " : "Umlagerung gebucht: ") +
        formatNumber(result.transfer.mengeStueck) + " Stück von " + result.transfer.quellLagerplatz + " nach " + result.transfer.zielLagerplatz +
        ". PDF wurde erstellt.", false);
      clearTransferEditor();
      return Promise.all([loadDrafts(), loadHistory(), repeatCurrentSearch()]);
    }).catch(function (error) {
      if (error.message !== "Buchung abgebrochen") setStatus(elements.transferStatus, "Umlagerung fehlgeschlagen: " + error.message, true);
    }).then(function () {
      submitting = false;
      updateActions();
    });
  }

  function renderTransferPdfActions(pdf) {
    var url = String(pdf && pdf.url || "");
    var fileName = String(pdf && pdf.file || "Umlagerung.pdf");
    elements.transferPdfActions.hidden = !url;
    elements.transferPdfDownloadLink.setAttribute("href", url || "#");
    elements.transferPdfDownloadLink.setAttribute("download", fileName);
    elements.transferPdfPrintLink.setAttribute("href", url || "#");
  }

  function validateResumedSource(showStatus) {
    if (!selectedSource || !serverOnline) return Promise.resolve(false);
    var snapshot = cloneSource(selectedSource);
    var sequence = validationSequence + 1;
    validationSequence = sequence;
    validationPending = true;
    selectionNeedsValidation = true;
    updateActions();
    var url = "/api/storage/locations?warehouse=" + encodeURIComponent(currentWarehouse()) +
      "&limit=1&id=" + encodeURIComponent(snapshot.id);
    return apiJson(url).then(function (locations) {
      if (sequence !== validationSequence || !selectedSource || selectedSource.id !== snapshot.id || !serverOnline) {
        var cancelledError = new Error("Bestandsprüfung wurde verworfen");
        cancelledError.validationCancelled = true;
        throw cancelledError;
      }
      var current = findById(locations, snapshot.id);
      var matches = sourceSnapshotMatches(snapshot, current);
      validationPending = false;
      selectionNeedsValidation = false;
      selectionStale = !matches;
      if (matches) selectedSource = cloneSource(current);
      renderSelectedSource();
      if (!matches) {
        if (showStatus !== false) setStatus(elements.transferStatus, "Der Quellbestand hat sich geändert. Bitte Quelle erneut suchen und auswählen.", true);
        var conflictError = new Error("Der Quellbestand hat sich geändert");
        conflictError.sourceConflict = true;
        throw conflictError;
      }
      return true;
    }).catch(function (error) {
      if (sequence === validationSequence && !error.sourceConflict && !error.validationCancelled) {
        validationPending = false;
        selectionNeedsValidation = true;
        selectionStale = false;
        renderSelectedSource();
      }
      throw error;
    });
  }

  function sourceSnapshotMatches(snapshot, current) {
    if (!snapshot || !current) return false;
    return String(current.id || "") === String(snapshot.id || "") &&
      normalizeWarehouse(current.lager) === normalizeWarehouse(snapshot.lager) &&
      String(current.materialnummer || "") === String(snapshot.materialnummer || "") &&
      String(current.lagerplatz || "") === String(snapshot.lagerplatz || "") &&
      String(current.leNummer || "") === String(snapshot.leNummer || "") &&
      Number(current.mengeStueck || 0) === Number(snapshot.mengeStueck || 0) &&
      Number(current.paletten || 0) === Number(snapshot.paletten || 0) &&
      String(current.aktualisiertAm || "") === String(snapshot.aktualisiertAm || "");
  }

  function repeatCurrentSearch() {
    if (!String(elements.transferSourceSearchInput.value || "").trim()) return Promise.resolve();
    searchSources();
    return Promise.resolve();
  }

  function clearTransferEditor() {
    selectedSource = null;
    selectionStale = false;
    selectionNeedsValidation = false;
    validationPending = false;
    validationSequence += 1;
    currentDraftId = "";
    savedFingerprint = "";
    elements.transferTargetBinInput.value = "";
    elements.transferReferenceInput.value = "";
    renderSelectedSource();
  }

  function saveCurrentDraft() {
    if (!window.OfflineStore || !window.OfflineStore.saveTransferDraft) return setStatus(elements.transferStatus, "Offline-Speicher ist nicht verfügbar.", true);
    if (!currentUser.name) return setStatus(elements.transferStatus, "Bitte Mitarbeiter eintragen.", true);
    if (!selectedSource || !String(elements.transferTargetBinInput.value || "").trim()) {
      return setStatus(elements.transferStatus, "Quelle und Ziel sind für einen Entwurf erforderlich.", true);
    }
    var now = new Date().toISOString();
    var id = currentDraftId || createTransferId();
    var draftStored = false;
    var draft = {
      id: id,
      warehouse: currentWarehouse(),
      userName: currentUser.name,
      source: cloneSource(selectedSource),
      targetBin: String(elements.transferTargetBinInput.value || "").trim(),
      reference: String(elements.transferReferenceInput.value || "").trim(),
      verificationState: "unchecked",
      verifiedAt: "",
      createdAt: now,
      updatedAt: now
    };
    window.OfflineStore.loadTransferDrafts().then(function (drafts) {
      var previous = findById(drafts, id);
      if (previous && previous.createdAt) draft.createdAt = previous.createdAt;
      return window.OfflineStore.saveTransferDraft(draft);
    }).then(function () {
      draftStored = true;
      currentDraftId = id;
      savedFingerprint = editorFingerprint();
      selectionNeedsValidation = true;
      renderSelectedSource();
      setStatus(elements.transferStatus, "Ungeprüfter Entwurf lokal gespeichert. Buchen ist erst online nach aktueller Bestandsprüfung möglich.", false);
      return loadDrafts();
    }).then(function () {
      if (!serverOnline || !selectedSource) return;
      renderCapabilityStatus("Online – der gespeicherte Entwurf wird gegen den aktuellen Bestand geprüft.", "checking");
      return validateResumedSource(false).then(function () {
        savedFingerprint = editorFingerprint();
        renderCapabilityStatus("Online – Entwurf gegen den aktuellen Quellbestand geprüft.", "online");
        setStatus(elements.transferStatus, "Entwurf gespeichert und geprüft. Buchung kann bestätigt werden.", false);
      });
    }).catch(function (error) {
      if (error.sourceConflict) {
        renderCapabilityStatus("Online – der Bestand weicht vom Entwurf ab. Quelle erneut suchen und auswählen.", "conflict");
        setStatus(elements.transferStatus, "Entwurf gespeichert, aber Quellbestand abweichend. Bitte Quelle erneut auswählen.", true);
      } else if (draftStored) {
        renderCapabilityStatus("Online – Bestandsprüfung fehlgeschlagen. Die Buchung bleibt gesperrt.", "conflict");
        setStatus(elements.transferStatus, "Entwurf gespeichert, aber Onlineprüfung fehlgeschlagen: " + error.message, true);
      } else {
        setStatus(elements.transferStatus, "Entwurf konnte nicht gespeichert werden: " + error.message, true);
      }
    });
  }

  function loadDrafts() {
    if (!window.OfflineStore || !window.OfflineStore.loadTransferDrafts) {
      renderDrafts([]);
      return Promise.resolve([]);
    }
    return window.OfflineStore.loadTransferDrafts().then(function (drafts) {
      var filtered = drafts.filter(function (draft) {
        return draft && draft.userName === currentUser.name && draft.warehouse === currentWarehouse();
      }).sort(function (left, right) {
        return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
      });
      renderDrafts(filtered);
      return filtered;
    }).catch(function (error) {
      renderDrafts([]);
      setStatus(elements.transferStatus, "Entwürfe konnten nicht geladen werden: " + error.message, true);
      return [];
    });
  }

  function renderDrafts(drafts) {
    elements.transferDraftList.innerHTML = "";
    elements.transferDraftCount.textContent = drafts.length + (drafts.length === 1 ? " Entwurf" : " Entwürfe");
    if (!drafts.length) {
      elements.transferDraftList.innerHTML = "<p>Keine lokalen Entwürfe für diesen Mitarbeiter und dieses Lager.</p>";
      return;
    }
    drafts.forEach(function (draft) {
      var source = draft && draft.source ? draft.source : {};
      var card = document.createElement("article");
      card.className = "tablet-transfer-draft-card";
      card.innerHTML = "<div><strong>" + escapeHtml(source.materialnummer) + "</strong>" +
        '<span class="tablet-transfer-draft-state">Ungeprüft</span>' +
        "<span>" + escapeHtml(source.lagerplatz) + " → " + escapeHtml(draft.targetBin) + "</span>" +
        "<small>" + escapeHtml(formatNumber(source.mengeStueck)) + " Stück · " + escapeHtml(formatDateTime(draft.updatedAt)) + "</small></div>" +
        '<div><button type="button" data-transfer-draft-resume="' + escapeAttribute(draft.id) + '">Öffnen</button>' +
        '<button class="danger-action" type="button" data-transfer-draft-delete="' + escapeAttribute(draft.id) + '">Löschen</button></div>';
      card._transferDraft = draft;
      elements.transferDraftList.appendChild(card);
    });
  }

  function handleDraftAction(event) {
    var resume = closest(event.target, "data-transfer-draft-resume");
    var remove = closest(event.target, "data-transfer-draft-delete");
    if (resume) {
      var card = closestClass(resume, "tablet-transfer-draft-card");
      resumeDraft(card && card._transferDraft);
    } else if (remove && window.confirm("Umlagerungsentwurf löschen?")) {
      deleteDraft(remove.getAttribute("data-transfer-draft-delete")).then(loadDrafts).catch(function (error) {
        setStatus(elements.transferStatus, "Entwurf konnte nicht gelöscht werden: " + error.message, true);
      });
    }
  }

  function resumeDraft(draft) {
    if (!draft || !draft.source) return;
    selectedSource = cloneSource(draft.source);
    currentDraftId = draft.id;
    selectionStale = false;
    selectionNeedsValidation = true;
    validationPending = serverOnline;
    validationSequence += 1;
    elements.transferTargetBinInput.value = draft.targetBin || "";
    elements.transferReferenceInput.value = draft.reference || "";
    savedFingerprint = editorFingerprint();
    renderSelectedSource();
    renderCapabilityStatus(serverOnline
      ? "Online – der geöffnete ungeprüfte Entwurf wird gegen den aktuellen Bestand geprüft."
      : "Offline – ungeprüfter Entwurf geöffnet. Eine verbindliche Buchung ist nicht möglich.", serverOnline ? "checking" : "offline");
    setStatus(elements.transferStatus, serverOnline
      ? "Entwurf wird gegen den aktuellen Bestand geprüft..."
      : "Ungeprüfter Entwurf geöffnet. Buchen ist erst nach einer Onlineprüfung möglich.", false);
    if (serverOnline) validateResumedSource(false).then(function () {
      savedFingerprint = editorFingerprint();
      renderCapabilityStatus("Online – Entwurf gegen den aktuellen Quellbestand geprüft.", "online");
      setStatus(elements.transferStatus, "Entwurf geprüft. Buchung kann bestätigt werden.", false);
    }).catch(function (error) {
      if (error.validationCancelled) return;
      if (error.sourceConflict) {
        renderCapabilityStatus("Online – der Bestand weicht vom Entwurf ab. Quelle erneut suchen und auswählen.", "conflict");
        setStatus(elements.transferStatus, "Entwurf ist veraltet. Bitte Quelle erneut suchen und auswählen.", true);
      } else {
        renderCapabilityStatus("Online – Bestandsprüfung fehlgeschlagen. Die Buchung bleibt gesperrt.", "conflict");
        setStatus(elements.transferStatus, "Entwurf konnte nicht geprüft werden: " + error.message, true);
      }
    });
  }

  function deleteDraft(id) {
    if (!id || !window.OfflineStore || !window.OfflineStore.deleteTransferDraft) return Promise.resolve();
    return window.OfflineStore.deleteTransferDraft(id);
  }

  function loadHistory() {
    if (!active || !serverOnline) return Promise.resolve([]);
    var query = String(elements.transferHistorySearchInput.value || "").trim();
    var url = "/api/storage/transfers?warehouse=" + encodeURIComponent(currentWarehouse()) + "&limit=" + HISTORY_RESULT_LIMIT +
      (query ? "&q=" + encodeURIComponent(query) : "");
    return apiJson(url).then(function (transfers) {
      renderHistory(Array.isArray(transfers) ? transfers : []);
      return transfers;
    }).catch(function (error) {
      renderHistory([]);
      setStatus(elements.transferStatus, "Umlagerungsverlauf konnte nicht geladen werden: " + error.message, true);
      return [];
    });
  }

  function renderHistory(transfers) {
    elements.transferHistoryTableBody.innerHTML = "";
    elements.transferHistoryCount.textContent = transfers.length + (transfers.length === 1 ? " Buchung" : " Buchungen");
    if (!transfers.length) {
      elements.transferHistoryTableBody.innerHTML = '<tr><td colspan="8">Keine Umlagerungen gefunden.</td></tr>';
      return;
    }
    transfers.forEach(function (transfer) {
      var row = document.createElement("tr");
      row.innerHTML = "<td>" + escapeHtml(formatDateTime(transfer.erstelltAm)) + "</td>" +
        "<td><strong>" + escapeHtml(transfer.materialnummer) + "</strong><small>" + escapeHtml(transfer.materialbezeichnung) + "</small></td>" +
        "<td>" + escapeHtml(transfer.quellLagerplatz) + "</td><td>" + escapeHtml(transfer.zielLagerplatz) + "</td>" +
        "<td>" + escapeHtml(transfer.leNummer || "-") + "</td><td>" + escapeHtml(formatNumber(transfer.mengeStueck)) + "</td>" +
        "<td>" + escapeHtml(formatNumber(transfer.paletten)) + "</td><td>" + escapeHtml(transfer.gebuchtVon || "-") +
        (transfer.referenz ? "<small>" + escapeHtml(transfer.referenz) + "</small>" : "") + "</td>";
      elements.transferHistoryTableBody.appendChild(row);
    });
  }

  function openCameraForButton(event) {
    openCamera(event.currentTarget.getAttribute("data-camera-target"));
  }

  function cameraSupported() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.BarcodeDetector);
  }

  function openCamera(targetId) {
    if (!cameraSupported()) return setStatus(elements.transferStatus, "Kamera-Scan wird von diesem Browser nicht unterstützt. Externer Scanner bleibt verfügbar.", false);
    cameraTargetId = targetId;
    elements.transferCameraOverlay.hidden = false;
    setStatus(elements.transferCameraStatus, "Kamera wird gestartet...", false);
    supportedBarcodeFormats().then(function (formats) {
      cameraDetector = formats.length ? new window.BarcodeDetector({ formats: formats }) : new window.BarcodeDetector();
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    }).then(function (stream) {
      cameraStream = stream;
      elements.transferCameraVideo.srcObject = stream;
      return elements.transferCameraVideo.play();
    }).then(function () {
      setStatus(elements.transferCameraStatus, "Barcode in den Kamerabereich halten.", false);
      cameraFrame = window.requestAnimationFrame(detectCameraBarcode);
    }).catch(function (error) {
      setStatus(elements.transferCameraStatus, "Kamera konnte nicht gestartet werden: " + error.message, true);
    });
  }

  function supportedBarcodeFormats() {
    var preferred = ["code_128", "ean_13", "ean_8", "qr_code"];
    if (typeof window.BarcodeDetector.getSupportedFormats !== "function") return Promise.resolve(preferred);
    return window.BarcodeDetector.getSupportedFormats().then(function (formats) {
      return preferred.filter(function (format) { return formats.indexOf(format) >= 0; });
    }).catch(function () { return preferred; });
  }

  function detectCameraBarcode(timestamp) {
    if (!cameraDetector || !cameraStream || elements.transferCameraOverlay.hidden) return;
    if (timestamp - cameraLastDetection < 250) {
      cameraFrame = window.requestAnimationFrame(detectCameraBarcode);
      return;
    }
    cameraLastDetection = timestamp;
    cameraDetector.detect(elements.transferCameraVideo).then(function (barcodes) {
      if (barcodes && barcodes[0] && barcodes[0].rawValue) return applyCameraValue(barcodes[0].rawValue);
      cameraFrame = window.requestAnimationFrame(detectCameraBarcode);
    }).catch(function () {
      cameraFrame = window.requestAnimationFrame(detectCameraBarcode);
    });
  }

  function applyCameraValue(value) {
    var target = document.getElementById(cameraTargetId);
    if (target) {
      target.value = String(value || "").trim();
      if (document.createEvent) {
        var inputEvent = document.createEvent("Event");
        inputEvent.initEvent("input", true, true);
        target.dispatchEvent(inputEvent);
      }
    }
    var shouldSearch = cameraTargetId === "transferSourceSearchInput";
    closeCamera();
    updateActions();
    if (shouldSearch) searchSources();
  }

  function closeCamera() {
    if (cameraFrame) window.cancelAnimationFrame(cameraFrame);
    cameraFrame = 0;
    if (cameraStream) cameraStream.getTracks().forEach(function (track) { track.stop(); });
    cameraStream = null;
    cameraDetector = null;
    cameraTargetId = "";
    if (elements.transferCameraVideo) elements.transferCameraVideo.srcObject = null;
    if (elements.transferCameraOverlay) elements.transferCameraOverlay.hidden = true;
  }

  function hasUnsavedChanges() {
    var fingerprint = editorFingerprint();
    return Boolean(fingerprint && fingerprint !== savedFingerprint);
  }

  function editorFingerprint() {
    if (!selectedSource && !String(elements.transferTargetBinInput.value || "").trim() && !String(elements.transferReferenceInput.value || "").trim()) return "";
    return JSON.stringify([
      selectedSource ? selectedSource.id : "",
      selectedSource ? selectedSource.aktualisiertAm : "",
      String(elements.transferTargetBinInput.value || "").trim(),
      String(elements.transferReferenceInput.value || "").trim()
    ]);
  }

  function apiJson(url, requestOptions) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var config = requestOptions || {};
      var method = config.method || "GET";
      var requestUrl = url;
      if (method === "GET") requestUrl += (requestUrl.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
      xhr.open(method, requestUrl, true);
      xhr.timeout = Number(config.timeout) > 0 ? Number(config.timeout) : 5000;
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Cache-Control", "no-cache");
      xhr.setRequestHeader("X-User-Group", currentUser.group);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var data;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; }
        catch (error) { void error; reject(new Error("Antwort konnte nicht gelesen werden")); return; }
        if (xhr.status < 200 || xhr.status >= 300 || (data && data.ok === false)) {
          reject(new Error(data && data.error || "Serverfehler"));
          return;
        }
        resolve(data);
      };
      xhr.onerror = function () { reject(new Error("Server nicht erreichbar")); };
      xhr.ontimeout = function () { reject(new Error("Server antwortet nicht rechtzeitig")); };
      xhr.send(config.body || null);
    });
  }

  function renderCapabilityStatus(message, state) {
    var status = elements.transferCapabilityStatus;
    if (!status) return;
    status.textContent = message || "";
    status.className = "tablet-transfer-capability is-" + (state || "online");
  }

  function setStatus(element, message, isError) {
    element.textContent = message || "";
    element.className = "message" + (isError ? " is-error" : "");
  }

  function createTransferId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "transfer-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function currentWarehouse() {
    return normalizeWarehouse(elements.transferWarehouseSelect.value);
  }

  function normalizeWarehouse(value) {
    return String(value || "").toUpperCase() === "SI" ? "SI" : "SSI";
  }

  function normalizeGroup(value) {
    return String(value || "").trim().toLowerCase();
  }

  function canAccess(group) {
    return ["buero", "tablet", "verwaltung"].indexOf(String(group || "").toLowerCase()) >= 0;
  }

  function readOption(name) {
    return typeof options[name] === "function" ? options[name]() : "";
  }

  function findById(items, id) {
    var list = Array.isArray(items) ? items : [];
    for (var index = 0; index < list.length; index += 1) {
      if (String(list[index] && list[index].id || "") === String(id || "")) return list[index];
    }
    return null;
  }

  function closest(element, attribute) {
    var current = element;
    while (current && current !== document) {
      if (current.getAttribute && current.getAttribute(attribute) !== null) return current;
      current = current.parentNode;
    }
    return null;
  }

  function closestClass(element, className) {
    var current = element;
    while (current && current !== document) {
      if ((" " + String(current.className || "") + " ").indexOf(" " + className + " ") >= 0) return current;
      current = current.parentNode;
    }
    return null;
  }

  function toggleClass(element, className, enabled) {
    var classes = String(element.className || "").split(/\s+/).filter(Boolean);
    var index = classes.indexOf(className);
    if (enabled && index < 0) classes.push(className);
    if (!enabled && index >= 0) classes.splice(index, 1);
    element.className = classes.join(" ");
  }

  function formatNumber(value) {
    var number = Number(value || 0);
    if (window.Intl && window.Intl.NumberFormat) return new window.Intl.NumberFormat("de-DE").format(number);
    return String(number);
  }

  function formatDateTime(value) {
    var date = new Date(value || "");
    if (isNaN(date.getTime())) return "-";
    return pad2(date.getDate()) + "." + pad2(date.getMonth() + 1) + "." + date.getFullYear() +
      ", " + pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  }

  function pad2(value) {
    var text = String(value);
    return text.length < 2 ? "0" + text : text;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  window.HLogistikTransfer = {
    initialize: initialize,
    activate: activate,
    deactivate: deactivate,
    updateContext: updateContext,
    setOnline: setOnline,
    hasUnsavedChanges: hasUnsavedChanges,
    canAccess: canAccess
  };
}());
