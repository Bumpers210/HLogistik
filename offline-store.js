(function () {
  const DB_NAME = "hlogistik-offline";
  const DB_VERSION = 1;
  let _db = null;

  function openDb() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains("orders")) {
          db.createObjectStore("orders", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("order-summaries")) {
          db.createObjectStore("order-summaries", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("sync-queue")) {
          db.createObjectStore("sync-queue", { keyPath: "queueId", autoIncrement: true });
        }
      };
      request.onsuccess = function () {
        _db = request.result;
        resolve(_db);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  function txGetAll(storeName) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = function () { resolve(request.result || []); };
        request.onerror = function () { reject(request.error); };
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

  window.OfflineStore = {
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

    // ── Sync queue ───────────────────────────────────────────────────────────

    enqueue: function (method, url, body) {
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction("sync-queue", "readwrite");
          var request = tx.objectStore("sync-queue").add({
            method: method,
            url: url,
            body: body,
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
