(function () {
  var DB_NAME = "hlogistik-offline";
  var DB_VERSION = 7;
  var TRANSFER_SNAPSHOT_API_VERSION = 4;
  var _db = null;
  var _opening = null;
  var _lastStorageDiagnostic = null;
  var _lastSchemaRepair = null;
  var _transferBackend = null;
  var _transferBackendPromise = null;
  var _indexedDbProbeFailure = null;
  var _webSqlDb = null;

  function listContains(list, name) {
    if (!list) return false;
    if (typeof list.contains === "function") return list.contains(name);
    for (var index = 0; index < Number(list.length || 0); index += 1) {
      var value = typeof list.item === "function" ? list.item(index) : list[index];
      if (String(value || "") === name) return true;
    }
    return false;
  }

  function listValues(list) {
    var values = [];
    if (!list) return values;
    for (var index = 0; index < Number(list.length || 0); index += 1) {
      var value = typeof list.item === "function" ? list.item(index) : list[index];
      if (value != null && String(value)) values.push(String(value));
    }
    return values;
  }

  function databaseDetails(db) {
    return {
      dbVersion: Number(db && db.version || 0),
      objectStores: listValues(db && db.objectStoreNames)
    };
  }

  function storageError(code, message, cause, db) {
    if (cause && cause.offlineStoreCode) return cause;
    var causeName = String(cause && (cause.originalName || cause.name) || "");
    var causeMessage = String(cause && (cause.originalMessage || cause.message) || "");
    var details = databaseDetails(db);
    if (!details.dbVersion && cause && cause.dbVersion) details.dbVersion = Number(cause.dbVersion || 0);
    if (!details.objectStores.length && cause && Array.isArray(cause.objectStores)) details.objectStores = cause.objectStores.slice();
    var original = causeName || causeMessage;
    if (causeName && causeMessage && causeMessage !== causeName) original = causeName + ": " + causeMessage;
    var context = [];
    if (original) context.push("Originalfehler: " + original);
    if (details.dbVersion) context.push("DB-Version: " + details.dbVersion);
    context.push("Object-Stores: " + (details.objectStores.length ? details.objectStores.join(", ") : "keine/noch nicht lesbar"));
    var error = new Error(message + " (" + context.join("; ") + ")");
    error.name = "OfflineStoreError";
    error.offlineStoreCode = code;
    error.originalName = causeName;
    error.originalMessage = causeMessage;
    error.dbVersion = details.dbVersion;
    error.objectStores = details.objectStores.slice();
    _lastStorageDiagnostic = {
      ok: false,
      code: code,
      message: error.message,
      originalName: causeName,
      originalMessage: causeMessage,
      dbVersion: details.dbVersion,
      objectStores: details.objectStores.slice()
    };
    return error;
  }

  function snapshotKeyRange(value) {
    var keyRangeApi = window.IDBKeyRange || window.webkitIDBKeyRange;
    if (!keyRangeApi || typeof keyRangeApi.only !== "function") {
      throw storageError("IDB_KEY_RANGE_UNAVAILABLE", "IndexedDB-Schlüsselbereich wird von diesem Browser nicht bereitgestellt");
    }
    return keyRangeApi.only(value);
  }

  function snapshotSchemaState(db) {
    var requiredStores = ["transfer-drafts", "transfer-stock-rows", "transfer-stock-snapshots", "transfer-storage-probe"];
    var missingStores = [];
    var missingIndexes = [];
    var inspectionError = null;
    for (var index = 0; index < requiredStores.length; index += 1) {
      if (!listContains(db.objectStoreNames, requiredStores[index])) missingStores.push(requiredStores[index]);
    }
    if (missingStores.indexOf("transfer-stock-rows") < 0) {
      try {
        var tx = db.transaction("transfer-stock-rows", "readonly");
        var indexes = tx.objectStore("transfer-stock-rows").indexNames;
        if (!listContains(indexes, "warehouse-generation")) missingIndexes.push("warehouse-generation");
        if (!listContains(indexes, "warehouse")) missingIndexes.push("warehouse");
      } catch (error) {
        inspectionError = error;
      }
    }
    return {
      complete: !missingStores.length && !missingIndexes.length && !inspectionError,
      missingStores: missingStores,
      missingIndexes: missingIndexes,
      inspectionError: inspectionError
    };
  }

  function validateSnapshotSchema(db) {
    var state = snapshotSchemaState(db);
    if (state.complete) return state;
    var missing = [];
    if (state.missingStores.length) missing.push("Stores " + state.missingStores.join(", "));
    if (state.missingIndexes.length) missing.push("Indizes " + state.missingIndexes.join(", "));
    throw storageError(
      "IDB_SCHEMA_INCOMPLETE",
      "IndexedDB-Snapshot-Schema unvollständig: " + (missing.join("; ") || "Schema-Prüfung fehlgeschlagen"),
      state.inspectionError,
      db
    );
  }

  function ensureSchema(event) {
    var db = event.target.result;
    if (!listContains(db.objectStoreNames, "orders")) db.createObjectStore("orders", { keyPath: "id" });
    if (!listContains(db.objectStoreNames, "order-summaries")) db.createObjectStore("order-summaries", { keyPath: "id" });
    if (!listContains(db.objectStoreNames, "sync-queue")) db.createObjectStore("sync-queue", { keyPath: "queueId", autoIncrement: true });
    if (!listContains(db.objectStoreNames, "order-groups")) db.createObjectStore("order-groups", { keyPath: "groupId" });
    if (!listContains(db.objectStoreNames, "transfer-drafts")) db.createObjectStore("transfer-drafts", { keyPath: "id" });
    var transferStockStore = listContains(db.objectStoreNames, "transfer-stock-rows")
      ? event.target.transaction.objectStore("transfer-stock-rows")
      : db.createObjectStore("transfer-stock-rows", { keyPath: "key" });
    if (!listContains(transferStockStore.indexNames, "warehouse-generation")) {
      transferStockStore.createIndex("warehouse-generation", "warehouseGeneration", { unique: false });
    }
    if (!listContains(transferStockStore.indexNames, "warehouse")) {
      transferStockStore.createIndex("warehouse", "warehouse", { unique: false });
    }
    if (!listContains(db.objectStoreNames, "transfer-stock-snapshots")) {
      db.createObjectStore("transfer-stock-snapshots", { keyPath: "warehouse" });
    }
    if (!listContains(db.objectStoreNames, "transfer-storage-probe")) {
      db.createObjectStore("transfer-storage-probe", { keyPath: "id" });
    }
  }

  function openRequest(indexedDbApi, version, previousDetails) {
    return new Promise(function (resolve, reject) {
      var request;
      var upgradeError = null;
      var settled = false;
      try {
        request = version ? indexedDbApi.open(DB_NAME, version) : indexedDbApi.open(DB_NAME);
      } catch (error) {
        reject(storageError("IDB_OPEN_THROWN", "IndexedDB konnte nicht geöffnet werden", error));
        return;
      }
      request.onupgradeneeded = function (event) {
        try {
          ensureSchema(event);
        } catch (error) {
          upgradeError = storageError("IDB_UPGRADE_FAILED", "IndexedDB-Schema konnte nicht auf Version " + (version || DB_VERSION) + " aktualisiert werden", error, event.target.result);
          try { event.target.transaction.abort(); } catch (abortError) { void abortError; }
        }
      };
      request.onsuccess = function () {
        if (settled) {
          try { request.result.close(); } catch (lateCloseError) { void lateCloseError; }
          return;
        }
        settled = true;
        resolve(request.result);
      };
      request.onerror = function () {
        if (settled) return;
        settled = true;
        reject(upgradeError || storageError("IDB_OPEN_FAILED", "IndexedDB konnte nicht geöffnet werden", request.error));
      };
      request.onblocked = function () {
        if (settled) return;
        settled = true;
        var blockedCause = new Error("Eine andere geöffnete Seite hält die alte IndexedDB-Verbindung fest");
        blockedCause.name = "BlockedError";
        blockedCause.dbVersion = previousDetails && previousDetails.dbVersion || 0;
        blockedCause.objectStores = previousDetails && previousDetails.objectStores || [];
        reject(storageError("IDB_UPGRADE_BLOCKED", "IndexedDB-Schema-Reparatur ist blockiert; alle anderen HLogistik-Tabs schließen und erneut versuchen", blockedCause));
      };
    });
  }

  function prepareDatabase(indexedDbApi) {
    return openRequest(indexedDbApi, 0, null).then(function (db) {
      var state = snapshotSchemaState(db);
      var details = databaseDetails(db);
      var targetVersion = Number(db.version || 0);
      if (targetVersion < DB_VERSION) targetVersion = DB_VERSION;
      if (!state.complete && targetVersion <= Number(db.version || 0)) targetVersion = Number(db.version || 0) + 1;
      if (targetVersion <= Number(db.version || 0) && state.complete) return db;
      var repair = _lastSchemaRepair && _lastSchemaRepair.reasonCode ? _lastSchemaRepair : {};
      repair.attempted = true;
      repair.completed = false;
      repair.fromVersion = details.dbVersion;
      repair.toVersion = targetVersion;
      repair.missingStores = state.missingStores.slice();
      repair.missingIndexes = state.missingIndexes.slice();
      repair.objectStoresBefore = details.objectStores.slice();
      _lastSchemaRepair = repair;
      try { db.close(); } catch (closeError) { void closeError; }
      return openRequest(indexedDbApi, targetVersion, details).then(function (upgradedDb) {
        var upgradedDetails = databaseDetails(upgradedDb);
        _lastSchemaRepair.completed = true;
        _lastSchemaRepair.dbVersion = upgradedDetails.dbVersion;
        _lastSchemaRepair.objectStoresAfter = upgradedDetails.objectStores.slice();
        return upgradedDb;
      });
    });
  }

  function useReadyDatabase(db) {
    try {
      validateSnapshotSchema(db);
      _db = db;
      var readyDb = _db;
      readyDb.onversionchange = function () {
        try { readyDb.close(); } catch (error) { void error; }
        if (_db === readyDb) _db = null;
      };
      var details = databaseDetails(_db);
      _lastStorageDiagnostic = {
        ok: true,
        code: "IDB_READY",
        message: "IndexedDB-Snapshot-Speicher bereit",
        originalName: "",
        originalMessage: "",
        dbVersion: details.dbVersion,
        objectStores: details.objectStores.slice()
      };
      return _db;
    } catch (error) {
      try { db.close(); } catch (closeError) { void closeError; }
      throw storageError("IDB_SCHEMA_INCOMPLETE", "IndexedDB-Snapshot-Schema ist nicht verwendbar", error, db);
    }
  }

  function openDb() {
    if (_db) return Promise.resolve(_db);
    if (_opening) return _opening;
    var indexedDbApi = window.indexedDB || window.webkitIndexedDB;
    if (!indexedDbApi || typeof indexedDbApi.open !== "function") {
      return Promise.reject(storageError("IDB_UNAVAILABLE", "IndexedDB ist in diesem Browser oder Browsermodus nicht verfügbar"));
    }
    _opening = prepareDatabase(indexedDbApi).then(useReadyDatabase);
    return _opening.then(function (db) {
      _opening = null;
      return db;
    }, function (error) {
      _opening = null;
      throw error;
    });
  }

  function diagnosticFromError(error) {
    return {
      code: String(error && error.offlineStoreCode || error && error.name || "IDB_UNKNOWN_ERROR"),
      message: String(error && error.message || "Unbekannter Speicherfehler"),
      originalName: String(error && (error.originalName || error.name) || ""),
      originalMessage: String(error && (error.originalMessage || error.message) || ""),
      dbVersion: Number(error && error.dbVersion || 0),
      objectStores: error && Array.isArray(error.objectStores) ? error.objectStores.slice() : []
    };
  }

  function indexedDbTransferProbe(db) {
    return new Promise(function (resolve, reject) {
      var tx;
      var verified = false;
      var probeId = "transfer-probe-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      try {
        tx = db.transaction("transfer-storage-probe", "readwrite");
        var store = tx.objectStore("transfer-storage-probe");
        var putRequest = store.put({ id: probeId, value: probeId });
        putRequest.onsuccess = function () {
          var getRequest = store.get(probeId);
          getRequest.onsuccess = function () {
            if (!getRequest.result || String(getRequest.result.value || "") !== probeId) {
              var mismatch = new Error("IndexedDB-Probewert konnte nicht unverändert gelesen werden");
              mismatch.name = "DataError";
              try { tx.abort(); } catch (abortError) { void abortError; }
              reject(storageError("IDB_PROBE_READ_FAILED", "IndexedDB-Schreib-/Leseprobe ist fehlgeschlagen", mismatch, db));
              return;
            }
            verified = true;
            store.delete(probeId);
          };
        };
      } catch (error) {
        reject(storageError("IDB_PROBE_WRITE_START_FAILED", "IndexedDB-Schreib-/Leseprobe konnte nicht gestartet werden", error, db));
        return;
      }
      tx.oncomplete = function () {
        if (verified) resolve(db);
        else reject(storageError("IDB_PROBE_READ_FAILED", "IndexedDB-Schreib-/Leseprobe lieferte kein bestätigtes Ergebnis", tx.error, db));
      };
      tx.onerror = function () {
        reject(storageError("IDB_PROBE_WRITE_FAILED", "IndexedDB-Schreib-/Leseprobe ist fehlgeschlagen", tx.error, db));
      };
      tx.onabort = function () {
        if (!verified) reject(storageError("IDB_PROBE_ABORTED", "IndexedDB-Schreib-/Leseprobe wurde abgebrochen", tx.error, db));
      };
    });
  }

  function webSqlNativeError(error) {
    var message = String(error && error.message || "Unbekannter WebSQL-Fehler");
    var nativeError = new Error(message);
    nativeError.name = "WebSQLError" + (error && error.code != null ? " " + error.code : "");
    return nativeError;
  }

  function webSqlRows(result) {
    var rows = [];
    var list = result && result.rows;
    for (var index = 0; list && index < Number(list.length || 0); index += 1) rows.push(list.item(index));
    return rows;
  }

  function initializeWebSql() {
    if (_webSqlDb) return Promise.resolve(_webSqlDb);
    if (typeof window.openDatabase !== "function") {
      return Promise.reject(storageError("WEBSQL_UNAVAILABLE", "WebSQL-Legacy-Fallback ist in diesem Browser nicht verfügbar"));
    }
    try {
      _webSqlDb = window.openDatabase("hlogistik-transfer-legacy", "1.0", "HLogistik Umlagerungen", 20 * 1024 * 1024);
    } catch (error) {
      return Promise.reject(storageError("WEBSQL_OPEN_FAILED", "WebSQL-Legacy-Fallback konnte nicht geöffnet werden", error));
    }
    return new Promise(function (resolve, reject) {
      _webSqlDb.transaction(function (tx) {
        tx.executeSql("CREATE TABLE IF NOT EXISTS transfer_snapshot_meta (warehouse TEXT PRIMARY KEY, captured_at TEXT NOT NULL, row_count INTEGER NOT NULL, generation TEXT NOT NULL, completed_at TEXT NOT NULL, snapshot_key TEXT NOT NULL)");
        tx.executeSql("CREATE TABLE IF NOT EXISTS transfer_snapshot_rows (generation TEXT NOT NULL, warehouse TEXT NOT NULL, stock_id TEXT NOT NULL, article_id TEXT, material_number TEXT, barcode TEXT, bin TEXT, handling_unit TEXT, quantity REAL NOT NULL, pallets REAL NOT NULL, updated_at TEXT, search_text TEXT NOT NULL, PRIMARY KEY (generation, stock_id))");
        tx.executeSql("CREATE INDEX IF NOT EXISTS transfer_snapshot_rows_generation ON transfer_snapshot_rows (generation)");
        tx.executeSql("CREATE INDEX IF NOT EXISTS transfer_snapshot_rows_warehouse ON transfer_snapshot_rows (warehouse, generation)");
        tx.executeSql("CREATE TABLE IF NOT EXISTS transfer_drafts (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)");
        tx.executeSql("CREATE TABLE IF NOT EXISTS transfer_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
      }, function (error) {
        _webSqlDb = null;
        reject(storageError("WEBSQL_SCHEMA_FAILED", "WebSQL-Umlagerungsschema konnte nicht initialisiert werden", webSqlNativeError(error)));
      }, function () {
        resolve(_webSqlDb);
      });
    }).then(webSqlReadWriteProbe);
  }

  function webSqlReadWriteProbe(db) {
    return new Promise(function (resolve, reject) {
      var probeId = "transfer-probe-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      var verified = false;
      db.transaction(function (tx) {
        tx.executeSql("INSERT OR REPLACE INTO transfer_probe (id, value) VALUES (?, ?)", [probeId, probeId]);
        tx.executeSql("SELECT value FROM transfer_probe WHERE id = ?", [probeId], function (_tx, result) {
          var rows = webSqlRows(result);
          verified = rows.length === 1 && String(rows[0].value || "") === probeId;
          if (verified) tx.executeSql("DELETE FROM transfer_probe WHERE id = ?", [probeId]);
        });
      }, function (error) {
        reject(storageError("WEBSQL_PROBE_FAILED", "WebSQL-Schreib-/Leseprobe ist fehlgeschlagen", webSqlNativeError(error)));
      }, function () {
        if (verified) resolve(db);
        else reject(storageError("WEBSQL_PROBE_READ_FAILED", "WebSQL-Schreib-/Leseprobe lieferte keinen unveränderten Wert"));
      });
    });
  }

  function selectTransferBackend() {
    if (_transferBackend) return Promise.resolve(_transferBackend);
    if (_transferBackendPromise) return _transferBackendPromise;
    _transferBackendPromise = openDb().then(function (db) {
      return indexedDbTransferProbe(db);
    }).then(function (db) {
      _transferBackend = { name: "IndexedDB", db: db, fallbackReason: null };
      return _transferBackend;
    }).catch(function (indexedDbError) {
      _indexedDbProbeFailure = diagnosticFromError(indexedDbError);
      return initializeWebSql().then(function (db) {
        _transferBackend = { name: "WebSQL", db: db, fallbackReason: _indexedDbProbeFailure };
        return _transferBackend;
      }).catch(function (webSqlError) {
        var combined = new Error(
          "IndexedDB [" + _indexedDbProbeFailure.code + "]: " + _indexedDbProbeFailure.message +
          "; WebSQL [" + String(webSqlError && webSqlError.offlineStoreCode || "WEBSQL_UNKNOWN_ERROR") + "]: " + String(webSqlError && webSqlError.message || "unbekannter Fehler")
        );
        combined.name = "TransferStorageError";
        var unavailableError = storageError("TRANSFER_STORAGE_UNAVAILABLE", "Kein funktionsfähiger Umlagerungs-Offline-Speicher", combined);
        unavailableError.indexedDbDiagnostic = _indexedDbProbeFailure;
        unavailableError.webSqlDiagnostic = diagnosticFromError(webSqlError);
        throw unavailableError;
      });
    });
    return _transferBackendPromise.then(function (backend) {
      _transferBackendPromise = null;
      return backend;
    }, function (error) {
      _transferBackendPromise = null;
      throw error;
    });
  }

  function transferBackendDiagnostic(backend) {
    var diagnostic = {
      ok: true,
      code: backend.name === "IndexedDB" ? "IDB_READY" : "WEBSQL_FALLBACK_READY",
      message: backend.name === "IndexedDB"
        ? "IndexedDB-Schreib-/Leseprobe erfolgreich"
        : "WebSQL-Legacy-Fallback nach fehlgeschlagener IndexedDB-Schreib-/Leseprobe aktiv",
      backend: backend.name,
      fallbackReason: backend.fallbackReason,
      snapshotApiVersion: TRANSFER_SNAPSHOT_API_VERSION,
      schemaRepair: schemaRepairDiagnostic()
    };
    if (backend.name === "IndexedDB") {
      var details = databaseDetails(backend.db);
      diagnostic.dbVersion = details.dbVersion;
      diagnostic.objectStores = details.objectStores.slice();
    } else {
      diagnostic.dbVersion = 0;
      diagnostic.objectStores = [];
      diagnostic.webSqlVersion = String(backend.db && backend.db.version || "1.0");
    }
    return diagnostic;
  }

  function webSqlDraftForStorage(draft) {
    var stored = JSON.parse(JSON.stringify(draft || {}));
    stored.verificationState = "unchecked";
    stored.updatedAt = String(stored.updatedAt || new Date().toISOString());
    return stored;
  }

  function webSqlSaveTransferDraft(db, draft) {
    if (!draft || !draft.id) return Promise.reject(new Error("Umlagerungsentwurf ohne ID"));
    var stored = webSqlDraftForStorage(draft);
    return new Promise(function (resolve, reject) {
      db.transaction(function (tx) {
        tx.executeSql(
          "INSERT OR REPLACE INTO transfer_drafts (id, payload, updated_at) VALUES (?, ?, ?)",
          [String(stored.id), JSON.stringify(stored), stored.updatedAt]
        );
      }, function (error) {
        reject(storageError("WEBSQL_DRAFT_WRITE_FAILED", "WebSQL-Umlagerungsentwurf konnte nicht gespeichert werden", webSqlNativeError(error)));
      }, function () { resolve(); });
    });
  }

  function webSqlLoadTransferDrafts(db) {
    return new Promise(function (resolve, reject) {
      db.readTransaction(function (tx) {
        tx.executeSql("SELECT payload FROM transfer_drafts ORDER BY updated_at DESC", [], function (_tx, result) {
          var drafts = webSqlRows(result).map(function (row) {
            try { return JSON.parse(String(row.payload || "{}")); } catch (error) { void error; return null; }
          }).filter(Boolean);
          resolve(drafts);
        });
      }, function (error) {
        reject(storageError("WEBSQL_DRAFT_READ_FAILED", "WebSQL-Umlagerungsentwürfe konnten nicht gelesen werden", webSqlNativeError(error)));
      });
    });
  }

  function webSqlDeleteTransferDraft(db, id) {
    return new Promise(function (resolve, reject) {
      db.transaction(function (tx) {
        tx.executeSql("DELETE FROM transfer_drafts WHERE id = ?", [String(id || "")]);
      }, function (error) {
        reject(storageError("WEBSQL_DRAFT_DELETE_FAILED", "WebSQL-Umlagerungsentwurf konnte nicht gelöscht werden", webSqlNativeError(error)));
      }, function () { resolve(); });
    });
  }

  function createTransferSnapshotSession(snapshot) {
    var warehouse = normalizeTransferWarehouse(snapshot && snapshot.warehouse);
    var capturedAt = String(snapshot && snapshot.capturedAt || "");
    var rowCount = Math.max(0, Number(snapshot && snapshot.rowCount || 0));
    if (!capturedAt) throw storageError("SNAPSHOT_CAPTURE_TIME_MISSING", "Bestandssnapshot enthält keinen Zeitpunkt");
    return {
      backend: "WebSQL",
      warehouse: warehouse,
      capturedAt: capturedAt,
      rowCount: rowCount,
      snapshotKey: String(snapshot && snapshot.snapshotKey || ""),
      generation: warehouse + "|" + capturedAt + "|" + Date.now() + "-" + Math.random().toString(16).slice(2),
      appendedRows: 0
    };
  }

  function webSqlBeginTransferSnapshot(db, snapshot) {
    var session;
    try { session = createTransferSnapshotSession(snapshot); } catch (error) { return Promise.reject(error); }
    return new Promise(function (resolve, reject) {
      db.transaction(function (tx) {
        tx.executeSql(
          "DELETE FROM transfer_snapshot_rows WHERE warehouse = ? AND generation NOT IN (SELECT generation FROM transfer_snapshot_meta WHERE warehouse = ?)",
          [session.warehouse, session.warehouse]
        );
      }, function (error) {
        reject(storageError("WEBSQL_SNAPSHOT_BEGIN_FAILED", "WebSQL-Snapshot-Vorbereitung ist fehlgeschlagen", webSqlNativeError(error)));
      }, function () { resolve(session); });
    });
  }

  function webSqlAppendTransferSnapshotRows(db, session, rows) {
    var projectedRows = Array.isArray(rows) ? rows.map(transferStockPublicRow).filter(function (row) {
      return row.id && row.lager === session.warehouse && row.mengeStueck > 0;
    }) : [];
    return new Promise(function (resolve, reject) {
      db.transaction(function (tx) {
        projectedRows.forEach(function (row) {
          tx.executeSql(
            "INSERT OR REPLACE INTO transfer_snapshot_rows (generation, warehouse, stock_id, article_id, material_number, barcode, bin, handling_unit, quantity, pallets, updated_at, search_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              session.generation, session.warehouse, row.id, row.artikelId, row.materialnummer, row.barcode,
              row.lagerplatz, row.leNummer, row.mengeStueck, row.paletten, row.aktualisiertAm,
              transferStockSearchText([row.id, row.artikelId, row.materialnummer, row.barcode, row.lagerplatz, row.leNummer].join(" "))
            ]
          );
        });
      }, function (error) {
        reject(storageError("WEBSQL_SNAPSHOT_PAGE_WRITE_FAILED", "WebSQL-Snapshot-Seite konnte nicht gespeichert werden", webSqlNativeError(error)));
      }, function () {
        session.appendedRows += projectedRows.length;
        resolve(session);
      });
    });
  }

  function webSqlCompleteTransferSnapshot(db, session) {
    var activated = false;
    var countError = null;
    return new Promise(function (resolve, reject) {
      db.transaction(function (tx) {
        tx.executeSql("SELECT COUNT(*) AS row_count FROM transfer_snapshot_rows WHERE generation = ?", [session.generation], function (_tx, result) {
          var rows = webSqlRows(result);
          var actualCount = Number(rows[0] && rows[0].row_count || 0);
          if (actualCount !== session.rowCount || session.appendedRows !== session.rowCount) {
            countError = new Error("Erwartet " + session.rowCount + " Zeilen, gespeichert " + actualCount);
            countError.name = "SnapshotCountError";
            tx.executeSql("SELECT force_snapshot_rollback FROM missing_snapshot_guard_table");
            return;
          }
          var completedAt = new Date().toISOString();
          tx.executeSql(
            "INSERT OR REPLACE INTO transfer_snapshot_meta (warehouse, captured_at, row_count, generation, completed_at, snapshot_key) VALUES (?, ?, ?, ?, ?, ?)",
            [session.warehouse, session.capturedAt, session.rowCount, session.generation, completedAt, session.snapshotKey]
          );
          tx.executeSql("DELETE FROM transfer_snapshot_rows WHERE warehouse = ? AND generation <> ?", [session.warehouse, session.generation]);
          activated = true;
        });
      }, function (error) {
        reject(storageError(
          countError ? "WEBSQL_SNAPSHOT_INCOMPLETE" : "WEBSQL_SNAPSHOT_ACTIVATE_FAILED",
          countError ? "Unvollständiger WebSQL-Snapshot wurde nicht aktiviert" : "WebSQL-Snapshot konnte nicht atomar aktiviert werden",
          countError || webSqlNativeError(error)
        ));
      }, function () {
        if (!activated) {
          reject(storageError("WEBSQL_SNAPSHOT_INCOMPLETE", "Unvollständiger WebSQL-Snapshot wurde nicht aktiviert", countError));
          return;
        }
        resolve({
          warehouse: session.warehouse,
          capturedAt: session.capturedAt,
          rowCount: session.rowCount,
          generation: session.generation,
          completedAt: new Date().toISOString(),
          snapshotKey: session.snapshotKey,
          storageBackend: "WebSQL"
        });
      });
    });
  }

  function webSqlAbortTransferSnapshot(db, session) {
    if (!session || !session.generation) return Promise.resolve();
    return new Promise(function (resolve) {
      db.transaction(function (tx) {
        tx.executeSql("DELETE FROM transfer_snapshot_rows WHERE generation = ?", [session.generation]);
      }, function () { resolve(); }, function () { resolve(); });
    });
  }

  function webSqlLoadTransferSnapshotMeta(db, warehouse) {
    return new Promise(function (resolve, reject) {
      db.readTransaction(function (tx) {
        tx.executeSql(
          "SELECT warehouse, captured_at, row_count, generation, completed_at, snapshot_key FROM transfer_snapshot_meta WHERE warehouse = ?",
          [normalizeTransferWarehouse(warehouse)],
          function (_tx, result) {
            var rows = webSqlRows(result);
            if (!rows.length || !rows[0].generation || !rows[0].completed_at) {
              resolve(null);
              return;
            }
            resolve({
              warehouse: String(rows[0].warehouse || ""),
              capturedAt: String(rows[0].captured_at || ""),
              rowCount: Number(rows[0].row_count || 0),
              generation: String(rows[0].generation || ""),
              completedAt: String(rows[0].completed_at || ""),
              snapshotKey: String(rows[0].snapshot_key || ""),
              storageBackend: "WebSQL"
            });
          }
        );
      }, function (error) {
        reject(storageError("WEBSQL_SNAPSHOT_META_READ_FAILED", "WebSQL-Snapshot-Metadaten konnten nicht gelesen werden", webSqlNativeError(error)));
      });
    });
  }

  function webSqlSearchTransferSnapshot(db, warehouse, query, limit) {
    var normalizedWarehouse = normalizeTransferWarehouse(warehouse);
    var terms = transferStockSearchText(query).split(" ").filter(Boolean);
    var safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 25);
    return webSqlLoadTransferSnapshotMeta(db, normalizedWarehouse).then(function (metadata) {
      if (!metadata) return { metadata: null, rows: [] };
      return new Promise(function (resolve, reject) {
        db.readTransaction(function (tx) {
          var sql = "SELECT stock_id, warehouse, article_id, material_number, barcode, bin, handling_unit, quantity, pallets, updated_at FROM transfer_snapshot_rows WHERE generation = ? AND warehouse = ?";
          var parameters = [metadata.generation, normalizedWarehouse];
          terms.forEach(function (term) {
            sql += " AND instr(search_text, ?) > 0";
            parameters.push(term);
          });
          sql += " ORDER BY bin COLLATE NOCASE, material_number COLLATE NOCASE, handling_unit COLLATE NOCASE LIMIT ?";
          parameters.push(safeLimit);
          tx.executeSql(sql, parameters, function (_tx, result) {
            var rows = webSqlRows(result).map(function (row) {
              return {
                id: String(row.stock_id || ""),
                lager: normalizeTransferWarehouse(row.warehouse),
                artikelId: String(row.article_id || ""),
                materialnummer: String(row.material_number || ""),
                barcode: String(row.barcode || ""),
                lagerplatz: String(row.bin || ""),
                leNummer: String(row.handling_unit || ""),
                mengeStueck: Number(row.quantity || 0),
                paletten: Number(row.pallets || 0),
                aktualisiertAm: String(row.updated_at || "")
              };
            });
            resolve({ metadata: metadata, rows: rows });
          });
        }, function (error) {
          reject(storageError("WEBSQL_SNAPSHOT_SEARCH_FAILED", "WebSQL-Snapshot-Suche ist fehlgeschlagen", webSqlNativeError(error)));
        });
      });
    });
  }

  function txGetAll(storeName) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var store;
        try {
          store = db.transaction(storeName, "readonly").objectStore(storeName);
        } catch (error) {
          reject(storageError("IDB_READ_TRANSACTION_FAILED", "IndexedDB-Lesetransaktion für " + storeName + " konnte nicht gestartet werden", error));
          return;
        }
        if (typeof store.getAll === "function") {
          var request = store.getAll();
          request.onsuccess = function () { resolve(request.result || []); };
          request.onerror = function () { reject(storageError("IDB_READ_FAILED", "IndexedDB-Daten aus " + storeName + " konnten nicht gelesen werden", request.error)); };
          return;
        }
        var items = [];
        var cursorRequest = store.openCursor();
        cursorRequest.onsuccess = function () {
          var cursor = cursorRequest.result;
          if (!cursor) {
            resolve(items);
            return;
          }
          items.push(cursor.value);
          cursor.continue();
        };
        cursorRequest.onerror = function () {
          reject(storageError("IDB_CURSOR_READ_FAILED", "IndexedDB-Cursor für " + storeName + " konnte nicht gelesen werden", cursorRequest.error));
        };
      });
    });
  }

  function txGet(storeName, key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function txPut(storeName, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(value);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function txClear(storeName) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function txDelete(storeName, key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function normalizeTransferWarehouse(value) {
    return String(value || "").toUpperCase() === "SI" ? "SI" : "SSI";
  }

  function transferStockSearchText(value) {
    return String(value == null ? "" : value).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function transferStockPublicRow(row) {
    return {
      id: String(row && row.id || ""),
      lager: normalizeTransferWarehouse(row && row.lager),
      artikelId: String(row && row.artikelId || ""),
      materialnummer: String(row && row.materialnummer || ""),
      barcode: String(row && row.barcode || ""),
      lagerplatz: String(row && row.lagerplatz || ""),
      leNummer: String(row && row.leNummer || ""),
      mengeStueck: Number(row && row.mengeStueck || 0),
      paletten: Math.max(0, Number(row && row.paletten || 0)),
      aktualisiertAm: String(row && row.aktualisiertAm || "")
    };
  }

  function cleanupTransferStockRows(warehouse, activeGeneration) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        var request;
        try {
          tx = db.transaction("transfer-stock-rows", "readwrite");
          request = tx.objectStore("transfer-stock-rows").index("warehouse").openCursor(snapshotKeyRange(warehouse));
        } catch (error) {
          reject(storageError("IDB_SNAPSHOT_CLEANUP_START_FAILED", "Alte Snapshot-Generation konnte nicht zur Bereinigung geöffnet werden", error, db));
          return;
        }
        request.onsuccess = function () {
          var cursor = request.result;
          if (!cursor) return;
          if (String(cursor.value && cursor.value.generation || "") !== activeGeneration) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(storageError("IDB_SNAPSHOT_CLEANUP_FAILED", "Alte Snapshot-Generation konnte nicht bereinigt werden", tx.error)); };
        tx.onabort = function () { reject(storageError("IDB_SNAPSHOT_CLEANUP_ABORTED", "Snapshot-Bereinigung wurde abgebrochen", tx.error)); };
      });
    });
  }

  function closeDatabaseConnection(db) {
    try { if (db) db.close(); } catch (error) { void error; }
    if (_db === db) _db = null;
  }

  function startSnapshotWrite(db, warehouse, generation, projectedRows, metadata) {
    return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(["transfer-stock-rows", "transfer-stock-snapshots"], "readwrite");
        var rowStore = tx.objectStore("transfer-stock-rows");
        projectedRows.forEach(function (row) {
          rowStore.put({
            key: generation + "|" + row.id,
            warehouse: warehouse,
            warehouseGeneration: generation,
            generation: generation,
            id: row.id,
            lager: row.lager,
            artikelId: row.artikelId,
            materialnummer: row.materialnummer,
            barcode: row.barcode,
            lagerplatz: row.lagerplatz,
            leNummer: row.leNummer,
            mengeStueck: row.mengeStueck,
            paletten: row.paletten,
            aktualisiertAm: row.aktualisiertAm
          });
        });
        tx.objectStore("transfer-stock-snapshots").put(metadata);
      } catch (error) {
        if (tx) try { tx.abort(); } catch (abortError) { void abortError; }
        reject(storageError("IDB_SNAPSHOT_WRITE_START_FAILED", "Snapshot-Schreibtransaktion konnte nicht gestartet werden", error, db));
        return;
      }
      tx.oncomplete = function () { resolve(metadata); };
      tx.onerror = function () { reject(storageError("IDB_SNAPSHOT_WRITE_FAILED", "Snapshot konnte nicht vollständig gespeichert werden", tx.error, db)); };
      tx.onabort = function () { reject(storageError("IDB_SNAPSHOT_WRITE_ABORTED", "Snapshot-Aktualisierung wurde abgebrochen", tx.error, db)); };
    });
  }

  function retrySnapshotWriteAfterStartFailure(db, error, warehouse, generation, projectedRows, metadata) {
    _lastSchemaRepair = {
      attempted: true,
      completed: false,
      reasonCode: String(error && error.offlineStoreCode || "IDB_SNAPSHOT_WRITE_START_FAILED"),
      originalName: String(error && error.originalName || ""),
      originalMessage: String(error && error.originalMessage || ""),
      fromVersion: Number(error && error.dbVersion || db && db.version || 0),
      objectStoresBefore: error && Array.isArray(error.objectStores) ? error.objectStores.slice() : listValues(db && db.objectStoreNames)
    };
    closeDatabaseConnection(db);
    return openDb().then(function (reopenedDb) {
      return startSnapshotWrite(reopenedDb, warehouse, generation, projectedRows, metadata).then(function (savedMetadata) {
        var details = databaseDetails(reopenedDb);
        _lastSchemaRepair.completed = true;
        _lastSchemaRepair.dbVersion = details.dbVersion;
        _lastSchemaRepair.objectStoresAfter = details.objectStores.slice();
        return savedMetadata;
      });
    });
  }

  function replaceIndexedDbTransferStockSnapshot(snapshot) {
    var warehouse = normalizeTransferWarehouse(snapshot && snapshot.warehouse);
    var capturedAt = String(snapshot && snapshot.capturedAt || "");
    var rows = Array.isArray(snapshot && snapshot.rows) ? snapshot.rows : [];
    if (!capturedAt) return Promise.reject(storageError("SNAPSHOT_CAPTURE_TIME_MISSING", "Bestandssnapshot enthält keinen Zeitpunkt"));
    var generation = warehouse + "|" + capturedAt + "|" + Date.now() + "-" + Math.random().toString(16).slice(2);
    var projectedRows = rows.map(transferStockPublicRow).filter(function (row) {
      return row.id && row.lager === warehouse && row.mengeStueck > 0;
    });
    var metadata = {
      warehouse: warehouse,
      capturedAt: capturedAt,
      rowCount: projectedRows.length,
      generation: generation,
      completedAt: new Date().toISOString()
    };
    return openDb().then(function (db) {
      return startSnapshotWrite(db, warehouse, generation, projectedRows, metadata).catch(function (error) {
        if (!error || error.offlineStoreCode !== "IDB_SNAPSHOT_WRITE_START_FAILED") throw error;
        return retrySnapshotWriteAfterStartFailure(db, error, warehouse, generation, projectedRows, metadata);
      });
    }).then(function (savedMetadata) {
      cleanupTransferStockRows(warehouse, generation).catch(function () {});
      return savedMetadata;
    });
  }

  function searchIndexedDbTransferStockSnapshot(warehouse, query, limit) {
    var normalizedWarehouse = normalizeTransferWarehouse(warehouse);
    var terms = transferStockSearchText(query).split(" ").filter(Boolean);
    var safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 25);
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        var metadataRequest;
        try {
          tx = db.transaction(["transfer-stock-snapshots", "transfer-stock-rows"], "readonly");
          metadataRequest = tx.objectStore("transfer-stock-snapshots").get(normalizedWarehouse);
        } catch (error) {
          reject(storageError("IDB_SNAPSHOT_SEARCH_START_FAILED", "Snapshot-Suchtransaktion konnte nicht gestartet werden", error));
          return;
        }
        metadataRequest.onerror = function () {
          reject(storageError("IDB_SNAPSHOT_META_READ_FAILED", "Snapshot-Metadaten konnten nicht gelesen werden", metadataRequest.error));
        };
        metadataRequest.onsuccess = function () {
          var metadata = metadataRequest.result;
          if (!metadata || !metadata.generation) {
            resolve({ metadata: null, rows: [] });
            return;
          }
          var rows = [];
          var cursorRequest;
          try {
            cursorRequest = tx.objectStore("transfer-stock-rows")
              .index("warehouse-generation")
              .openCursor(snapshotKeyRange(metadata.generation));
          } catch (error) {
            reject(storageError("IDB_SNAPSHOT_CURSOR_START_FAILED", "Snapshot-Cursor konnte nicht gestartet werden", error));
            return;
          }
          cursorRequest.onerror = function () {
            reject(storageError("IDB_SNAPSHOT_CURSOR_READ_FAILED", "Snapshot-Bestandszeilen konnten nicht gelesen werden", cursorRequest.error));
          };
          cursorRequest.onsuccess = function () {
            var cursor = cursorRequest.result;
            if (!cursor || rows.length >= safeLimit) {
              rows.sort(function (left, right) {
                return String(left.lagerplatz || "").localeCompare(String(right.lagerplatz || ""));
              });
              resolve({ metadata: metadata, rows: rows });
              return;
            }
            var row = transferStockPublicRow(cursor.value);
            var haystack = transferStockSearchText([
              row.id, row.artikelId, row.materialnummer, row.barcode, row.lagerplatz, row.leNummer
            ].join(" "));
            if (!terms.length || terms.every(function (term) { return haystack.indexOf(term) >= 0; })) rows.push(row);
            cursor.continue();
          };
        };
      });
    });
  }

  function loadIndexedDbTransferStockSnapshotMeta(warehouse) {
    return txGet("transfer-stock-snapshots", normalizeTransferWarehouse(warehouse)).catch(function (error) {
      throw storageError("IDB_SNAPSHOT_META_READ_FAILED", "Snapshot-Metadaten konnten nicht gelesen werden", error);
    });
  }

  function replaceTransferStockSnapshot(snapshot) {
    return selectTransferBackend().then(function (backend) {
      if (backend.name === "IndexedDB") return replaceIndexedDbTransferStockSnapshot(snapshot);
      var rows = Array.isArray(snapshot && snapshot.rows) ? snapshot.rows : [];
      return webSqlBeginTransferSnapshot(backend.db, {
        warehouse: snapshot && snapshot.warehouse,
        capturedAt: snapshot && snapshot.capturedAt,
        rowCount: rows.filter(function (row) { return Number(row && row.mengeStueck || 0) > 0; }).length,
        snapshotKey: snapshot && snapshot.snapshotKey
      }).then(function (session) {
        var offset = 0;
        function appendNext() {
          var page = rows.slice(offset, offset + 100);
          if (!page.length) return webSqlCompleteTransferSnapshot(backend.db, session);
          offset += page.length;
          return webSqlAppendTransferSnapshotRows(backend.db, session, page).then(appendNext);
        }
        return appendNext().catch(function (error) {
          return webSqlAbortTransferSnapshot(backend.db, session).then(function () { throw error; });
        });
      });
    });
  }

  function loadTransferStockSnapshotMeta(warehouse) {
    return selectTransferBackend().then(function (backend) {
      if (backend.name === "IndexedDB") {
        return loadIndexedDbTransferStockSnapshotMeta(warehouse).then(function (metadata) {
          if (metadata) metadata.storageBackend = "IndexedDB";
          return metadata;
        });
      }
      return webSqlLoadTransferSnapshotMeta(backend.db, warehouse);
    });
  }

  function searchTransferStockSnapshot(warehouse, query, limit) {
    return selectTransferBackend().then(function (backend) {
      if (backend.name === "IndexedDB") return searchIndexedDbTransferStockSnapshot(warehouse, query, limit);
      return webSqlSearchTransferSnapshot(backend.db, warehouse, query, limit);
    });
  }

  function beginTransferStockSnapshotUpdate(snapshot) {
    return selectTransferBackend().then(function (backend) {
      if (backend.name !== "WebSQL") {
        throw storageError("TRANSFER_PAGED_BACKEND_MISMATCH", "Seitenweiser Snapshot ist nur für den WebSQL-Legacy-Fallback vorgesehen");
      }
      return webSqlBeginTransferSnapshot(backend.db, snapshot);
    });
  }

  function appendTransferStockSnapshotPage(session, rows) {
    return selectTransferBackend().then(function (backend) {
      if (backend.name !== "WebSQL" || !session || session.backend !== "WebSQL") {
        throw storageError("TRANSFER_PAGED_BACKEND_MISMATCH", "Snapshot-Seite gehört nicht zum aktiven WebSQL-Legacy-Fallback");
      }
      return webSqlAppendTransferSnapshotRows(backend.db, session, rows);
    });
  }

  function completeTransferStockSnapshotUpdate(session) {
    return selectTransferBackend().then(function (backend) {
      if (backend.name !== "WebSQL" || !session || session.backend !== "WebSQL") {
        throw storageError("TRANSFER_PAGED_BACKEND_MISMATCH", "Snapshot-Abschluss gehört nicht zum aktiven WebSQL-Legacy-Fallback");
      }
      return webSqlCompleteTransferSnapshot(backend.db, session);
    });
  }

  function abortTransferStockSnapshotUpdate(session) {
    return selectTransferBackend().then(function (backend) {
      if (backend.name !== "WebSQL") return;
      return webSqlAbortTransferSnapshot(backend.db, session);
    }).catch(function () {});
  }

  function probeTransferStockSnapshotStorage() {
    return selectTransferBackend().then(function (backend) {
      return transferBackendDiagnostic(backend);
    }).catch(function (error) {
      return {
        ok: false,
        code: String(error && error.offlineStoreCode || "IDB_UNKNOWN_ERROR"),
        message: String(error && error.message || "Unbekannter IndexedDB-Fehler"),
        originalName: String(error && (error.originalName || error.name) || ""),
        originalMessage: String(error && (error.originalMessage || error.message) || ""),
        backend: "Keines",
        dbVersion: Number(error && error.dbVersion || 0),
        objectStores: error && Array.isArray(error.objectStores) ? error.objectStores.slice() : [],
        fallbackReason: error && error.indexedDbDiagnostic || null,
        webSqlDiagnostic: error && error.webSqlDiagnostic || null,
        snapshotApiVersion: TRANSFER_SNAPSHOT_API_VERSION,
        schemaRepair: schemaRepairDiagnostic()
      };
    });
  }

  function schemaRepairDiagnostic() {
    if (!_lastSchemaRepair) return null;
    return {
      attempted: _lastSchemaRepair.attempted === true,
      completed: _lastSchemaRepair.completed === true,
      reasonCode: String(_lastSchemaRepair.reasonCode || ""),
      originalName: String(_lastSchemaRepair.originalName || ""),
      originalMessage: String(_lastSchemaRepair.originalMessage || ""),
      fromVersion: Number(_lastSchemaRepair.fromVersion || 0),
      toVersion: Number(_lastSchemaRepair.toVersion || 0),
      dbVersion: Number(_lastSchemaRepair.dbVersion || 0),
      missingStores: Array.isArray(_lastSchemaRepair.missingStores) ? _lastSchemaRepair.missingStores.slice() : [],
      missingIndexes: Array.isArray(_lastSchemaRepair.missingIndexes) ? _lastSchemaRepair.missingIndexes.slice() : [],
      objectStoresBefore: Array.isArray(_lastSchemaRepair.objectStoresBefore) ? _lastSchemaRepair.objectStoresBefore.slice() : [],
      objectStoresAfter: Array.isArray(_lastSchemaRepair.objectStoresAfter) ? _lastSchemaRepair.objectStoresAfter.slice() : []
    };
  }

  window.OfflineStore = {
    transferSnapshotApiVersion: TRANSFER_SNAPSHOT_API_VERSION,
    // ── Order list (summaries) ───────────────────────────────────────────────

    saveOrderSummaries: function (orders) {
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction("order-summaries", "readwrite");
          var store = tx.objectStore("order-summaries");
          store.clear();
          orders.forEach(function (o) { store.put(o); });
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        });
      });
    },

    loadOrderSummaries: function () {
      return txGetAll("order-summaries");
    },

    // ── Full order ───────────────────────────────────────────────────────────

    saveOrder: function (order) {
      return txPut("orders", order);
    },

    loadOrder: function (id) {
      return txGet("orders", id);
    },

    loadOrders: function () {
      return txGetAll("orders");
    },

    deleteOrder: function (id) {
      return txDelete("orders", id);
    },

    deleteOrderSummary: function (id) {
      return this.loadOrderSummaries().then(function (orders) {
        return window.OfflineStore.saveOrderSummaries((orders || []).filter(function (order) {
          return String(order && order.id || "") !== String(id || "");
        }));
      });
    },

    // ── Accepted tablet order groups ─────────────────────────────────────────

    saveOrderGroup: function (group) {
      if (!group || !group.groupId) return Promise.resolve();
      return txPut("order-groups", group);
    },

    loadOrderGroup: function (groupId) {
      return txGet("order-groups", groupId);
    },

    loadOrderGroups: function () {
      return txGetAll("order-groups");
    },

    deleteOrderGroup: function (groupId) {
      return txDelete("order-groups", groupId);
    },

    saveTransferDraft: function (draft) {
      if (!draft || !draft.id) return Promise.reject(new Error("Umlagerungsentwurf ohne ID"));
      return selectTransferBackend().then(function (backend) {
        if (backend.name === "IndexedDB") return txPut("transfer-drafts", draft);
        return webSqlSaveTransferDraft(backend.db, draft);
      });
    },

    loadTransferDrafts: function () {
      return selectTransferBackend().then(function (backend) {
        if (backend.name === "IndexedDB") return txGetAll("transfer-drafts");
        return webSqlLoadTransferDrafts(backend.db);
      });
    },

    deleteTransferDraft: function (id) {
      return selectTransferBackend().then(function (backend) {
        if (backend.name === "IndexedDB") return txDelete("transfer-drafts", id);
        return webSqlDeleteTransferDraft(backend.db, id);
      });
    },

    replaceTransferStockSnapshot: replaceTransferStockSnapshot,

    loadTransferStockSnapshotMeta: loadTransferStockSnapshotMeta,

    searchTransferStockSnapshot: searchTransferStockSnapshot,

    beginTransferStockSnapshotUpdate: beginTransferStockSnapshotUpdate,

    appendTransferStockSnapshotPage: appendTransferStockSnapshotPage,

    completeTransferStockSnapshotUpdate: completeTransferStockSnapshotUpdate,

    abortTransferStockSnapshotUpdate: abortTransferStockSnapshotUpdate,

    probeTransferStockSnapshotStorage: probeTransferStockSnapshotStorage,

    getLastStorageDiagnostic: function () {
      if (!_lastStorageDiagnostic) return null;
      return {
        ok: _lastStorageDiagnostic.ok === true,
        code: String(_lastStorageDiagnostic.code || ""),
        message: String(_lastStorageDiagnostic.message || ""),
        originalName: String(_lastStorageDiagnostic.originalName || ""),
        originalMessage: String(_lastStorageDiagnostic.originalMessage || ""),
        dbVersion: Number(_lastStorageDiagnostic.dbVersion || 0),
        objectStores: Array.isArray(_lastStorageDiagnostic.objectStores) ? _lastStorageDiagnostic.objectStores.slice() : [],
        schemaRepair: schemaRepairDiagnostic()
      };
    },

    // ── Sync queue ───────────────────────────────────────────────────────────

    enqueue: function (method, url, body, dedupeKey) {
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction("sync-queue", "readwrite");
          var request = tx.objectStore("sync-queue").add({
            method: method,
            url: url,
            body: body,
            dedupeKey: dedupeKey || "",
            timestamp: Date.now()
          });
          request.onsuccess = function () { resolve(request.result); };
          tx.onerror = function () { reject(tx.error); };
        });
      });
    },

    getPending: function () {
      return txGetAll("sync-queue");
    },

    dequeue: function (queueId) {
      return txDelete("sync-queue", queueId);
    },

    clearQueue: function () {
      return txClear("sync-queue");
    }
  };
}());
