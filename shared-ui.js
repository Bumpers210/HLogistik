(function () {
  var USER_KEY = "kommissionier-app-user-v1";
  var USER_GROUP_KEY = "kommissionier-app-user-group-v1";
  var WAREHOUSE_KEY = "hlogistik-warehouse-v1";

  function normalizeWarehouse(value) {
    return String(value || "SSI").trim().toUpperCase() === "SI" ? "SI" : "SSI";
  }

  function currentWarehouse() {
    return normalizeWarehouse(localStorage.getItem(WAREHOUSE_KEY));
  }

  function saveCurrentWarehouse(selectElement) {
    if (!selectElement) return currentWarehouse();
    var warehouse = normalizeWarehouse(selectElement.value);
    localStorage.setItem(WAREHOUSE_KEY, warehouse);
    return warehouse;
  }

  function applyWarehouseSelection(selectElement) {
    if (!selectElement) return;
    selectElement.value = currentWarehouse();
  }

  function normalizeUserGroup(value) {
    return value === "lager" || value === "buero" || value === "tablet" || value === "verwaltung" ? value : "";
  }

  function userGroupLabel(group) {
    if (group === "lager") return "Lager";
    if (group === "buero") return "Büro";
    if (group === "tablet") return "Tablet";
    if (group === "verwaltung") return "Verwaltung";
    return "";
  }

  function storageNavLabel(group) {
    return group === "buero" || group === "verwaltung" ? "Buchung" : "Einlagern";
  }

  function currentUser() {
    return {
      name: localStorage.getItem(USER_KEY) || "",
      group: localStorage.getItem(USER_GROUP_KEY) || ""
    };
  }

  function applyCurrentUserName(element, name, group) {
    if (!element) return;
    var groupLabel = userGroupLabel(group);
    element.textContent = name ? name + (groupLabel ? " - " + groupLabel : "") : "Nicht angemeldet";
  }

  function clearUserAndReturnHome() {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(USER_GROUP_KEY);
    window.location.replace("/");
  }

  function setConnectionStatus(badgeElement, textElement, isOnline) {
    if (!badgeElement || !textElement) return;
    badgeElement.classList.toggle("is-online", isOnline === true);
    badgeElement.classList.toggle("is-offline", isOnline === false);
    badgeElement.classList.toggle("is-checking", isOnline === null);
    textElement.textContent = isOnline === true ? "Online" : isOnline === false ? "Offline" : "Prüfe Verbindung";
  }

  function setStatus(element, message, type) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-ok", type === "ok");
    element.classList.toggle("is-error", type === "error");
    element.classList.toggle("is-warning", type === "warning");
  }

  async function apiJson(url, options) {
    var requestOptions = options || {};
    var extraHeaders = requestOptions.headers || {};
    var rest = {};
    Object.keys(requestOptions).forEach(function (key) {
      if (key !== "headers") rest[key] = requestOptions[key];
    });
    if (!rest.cache && String(rest.method || "GET").toUpperCase() === "GET") {
      rest.cache = "no-store";
    }

    var response = await fetch(url, Object.assign({}, rest, {
      headers: Object.assign({
        "Content-Type": "application/json",
        "X-User-Group": localStorage.getItem(USER_GROUP_KEY) || "",
        "X-Warehouse": currentWarehouse()
      }, extraHeaders)
    }));
    var contentType = response.headers.get("content-type") || "";
    var data = contentType.indexOf("application/json") >= 0
      ? await response.json()
      : { error: (await response.text()).trim() };
    if (!response.ok || data.ok === false) throw new Error(data.error || "Serverfehler");
    return data;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("de-DE");
  }

  function formatDate(value) {
    if (!value) return "-";
    var text = String(value);
    var date = new Date(text.length <= 10 ? text + "T00:00:00" : text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function formatDateTime(value) {
    if (!value) return "-";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function normalizeSearch(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  window.HLogistikUi = {
    keys: {
      user: USER_KEY,
      userGroup: USER_GROUP_KEY,
      warehouse: WAREHOUSE_KEY
    },
    apiJson: apiJson,
    applyCurrentUserName: applyCurrentUserName,
    applyWarehouseSelection: applyWarehouseSelection,
    clearUserAndReturnHome: clearUserAndReturnHome,
    currentUser: currentUser,
    currentWarehouse: currentWarehouse,
    escapeAttribute: escapeHtml,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    formatNumber: formatNumber,
    normalizeSearch: normalizeSearch,
    normalizeUserGroup: normalizeUserGroup,
    normalizeWarehouse: normalizeWarehouse,
    saveCurrentWarehouse: saveCurrentWarehouse,
    setConnectionStatus: setConnectionStatus,
    setStatus: setStatus,
    storageNavLabel: storageNavLabel,
    userGroupLabel: userGroupLabel
  };
})();
