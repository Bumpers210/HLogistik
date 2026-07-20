const STORAGE_KEY = "kommissionier-app-state-v1";
const USER_KEY = "kommissionier-app-user-v1";
const USER_GROUP_KEY = "kommissionier-app-user-group-v1";
const KNOWN_ORDERS_KEY = "kommissionier-app-known-orders-v1";
const MODE_KEY = "kommissionier-app-mode-v1";
const API_BASE = "";
const CLIENT_ASSET_VERSION = "20260710-1";
const OCR_LANGUAGE = "deu+eng";
const OCR_RENDER_SCALE = 3.5;
const OCR_PRECISE_RENDER_SCALE = 4.5;
const OCR_RENDER_DPI = "300";
const OCR_PRECISE_RENDER_DPI = "600";
const BESTELLSCHEIN_PRECISE_OCR_SCALES = [OCR_PRECISE_RENDER_SCALE];
const PICKING_OCR_SCALE_CANDIDATES = [
  { label: "basis", scale: OCR_RENDER_SCALE, dpi: OCR_RENDER_DPI },
  { label: "praezise", scale: OCR_PRECISE_RENDER_SCALE, dpi: OCR_PRECISE_RENDER_DPI }
];
const OCR_ROTATIONS = [0, 90, 180, 270];
const PICKING_OCR_UPRIGHT_ROTATIONS = [0];
const PICKING_OCR_ROTATION_FALLBACK_ROTATIONS = [90, 270, 180];
const PICKING_OCR_LOADING_SLIP_ROTATIONS = [90];
const PICKING_OCR_MAX_STEPS = 18;
const PICKING_OCR_MAX_MS = 175000;
const PICKING_OCR_LOADING_SLIP_MAX_MS = 45000;
const PICKING_OCR_ROTATION_FALLBACK_MAX_MS = 60000;
const SI_BESTELLSCHEIN_ORIENTATION_PROBE_SCALE = 2;
const SI_BESTELLSCHEIN_ORIENTATION_PROBE_DPI = "180";
const SI_BESTELLSCHEIN_ORIENTATION_PROBE_ROTATIONS = [0, 90, 180, 270];
const SI_BESTELLSCHEIN_ORIENTATION_PROBE_MIN_SCORE = 4500;
const SI_BESTELLSCHEIN_ORIENTATION_PROBE_MIN_MARGIN = 1200;
const SI_BESTELLSCHEIN_ORIENTATION_TIEBREAKER_LIMIT = 2;
const SI_BESTELLSCHEIN_ORIENTATION_TIEBREAKER_MAX_MS = 60000;
const PICKING_FROM_BIN_RECHECK_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";
const PICKING_FROM_BIN_RECHECK_MIN_CONFIDENCE = 55;
const PICKING_FROM_BIN_VISUAL_RECHECK_ROW_RADIUS = 4;
const PICKING_FROM_BIN_VISUAL_RECHECK_MAX_ROW_HEIGHT = 120;
const PICKING_FROM_BIN_RECHECK_MAX_CROP_WIDTH = 700;
const PICKING_FROM_BIN_RECHECK_MAX_CROP_HEIGHT = 180;
const PICKING_FROM_BIN_RECHECK_MAX_CROP_PIXELS = 90000;
const FROM_BIN_REVIEW_BLOCK_MESSAGE = "Export/Freigabe gesperrt: OCR-unsichere Von-Lagerplätze prüfen.";
const STORAGE_IMAGE_ROTATIONS = [0, -2, 2, -4, 4];
const OCR_STRONG_CANDIDATE_SCORE = 6500;
const PICKING_OCR_MINIMUM_SCORE = 2500;
const PICKING_OCR_FAST_ACCEPT_SCORE = 6500;
const ACTIVE_ORDER_TIMEOUT_MS = 10 * 60 * 1000;
const ORDER_LIST_REFRESH_MS = 30 * 1000;
const ACTIVITY_HEARTBEAT_MS = 60 * 1000;
const ORDER_NOTICE_DURATION_MS = 12000;
const CONNECTION_CHECK_MS = 30 * 1000;
const CONNECTION_CHECK_TIMEOUT_MS = 5000;
const SSI_DESTINATION_CUSTOMER = "9021-0OUT";
const STORAGE_HU_RULES = window.HLogistikStorageHuRules;
const MANUAL_STORAGE_RULES = window.HLogistikManualStorageRules;
const SSI_STORAGE_HU_PREFIX = STORAGE_HU_RULES.prefix;
const SSI_STORAGE_HU_SUFFIX_LENGTH = STORAGE_HU_RULES.suffixLength;
const SSI_STORAGE_HU_LENGTH = STORAGE_HU_RULES.length;
const MANUAL_STORAGE_POSITION_CREATE_COUNT_DEFAULT = MANUAL_STORAGE_RULES.positionCreateCountDefault;
const MANUAL_STORAGE_POSITION_CREATE_COUNT_MIN = MANUAL_STORAGE_RULES.positionCreateCountMin;
const MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX = MANUAL_STORAGE_RULES.positionCreateCountMax;

const state = {
  id: "",
  orderNumber: "",
  customerName: "",
  customerGroupKey: "",
  orderDate: new Date().toISOString().slice(0, 10),
  orderTime: "",
  euroPallets: "",
  storageSpaces: "",
  orderNote: "",
  rawText: "",
  collapseDone: true,
  createdBy: "",
  lastEditedBy: "",
  activeUser: "",
  activeUserAt: "",
  acceptedBy: "",
  acceptedAt: "",
  completedBy: "",
  completedAt: "",
  exportedAt: "",
  exportedPdfFile: "",
  exportedPdfPath: "",
  originalFileName: "",
  originalFilePath: "",
  originalArchivedAt: "",
  originalArchivePath: "",
  originalArchiveError: "",
  orderType: "picking",
  orderWarehouse: "",
  awaitingRelease: false,
  detectedWarehouse: "",
  warehouseHint: "",
  warehouseHintType: "",
  lines: []
};

const elements = {};
const currentUser = { name: "", group: "" };
let currentMode = "picking";
let activeDownloadUrl = "";
let saveTimer = null;
let serverOnline = false;
let topControlsCollapsed = false;
let orderListTimer = null;
let activityTimer = null;
let connectionCheckTimer = null;
let connectionCheckInProgress = false;
let connectionCheckStartedAt = 0;
let orderListInitialized = false;
let knownOrderIds = new Set();
let orderNoticeTimer = null;
let notifiedOrderId = "";
const packageArticleLookupCache = new Map();

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  loadCurrentMode();
  loadCurrentUser();
  applyWarehouseSelection();
  loadKnownOrderIds();
  clearCurrentOrder();
  loadState();
  bindEvents();
  configurePdfJs();
  registerServiceWorker();
  updateCurrentUserUi();
  render();
  showLoginIfNeeded();
  initializeServer();
  startConnectionMonitor();
});

function bindElements() {
  [
    "pdfInput",
    "imageInput",
    "loadingSlipPdfInput",
    "fileDrop",
    "fileDropTitle",
    "appTitle",
    "connectionBadge",
    "connectionText",
    "warehouseSelect",
    "pickingModeButton",
    "storageModeButton",
    "storageAppLink",
    "articleOverviewNavLink",
    "articleNavLink",
    "orderNumber",
    "customerName",
    "orderDate",
    "orderTime",
    "euroPallets",
    "storageSpaces",
    "orderNote",
    "importProgressWrap",
    "importProgressBar",
    "importStatus",
    "warehouseHint",
    "topControls",
    "topToggleButton",
    "newOrderButton",
    "printButton",
    "exportButton",
    "pdfExportButton",
    "exportStatus",
    "orderSelect",
    "saveOrderButton",
    "releaseOrderButton",
    "discardDraftButton",
    "takeOverOrderButton",
    "refreshOrdersButton",
    "deleteOrderButton",
    "serverStatus",
    "pickList",
    "pickHeader",
    "storageLineActions",
    "manualStorageMaterialInput",
    "manualStorageBinInput",
    "manualStoragePositionCountInput",
    "manualStorageQuantityInput",
    "addStorageLineButton",
    "emptyState",
    "pickedCount",
    "openCount",
    "changedCount",
    "lineTemplate",
    "currentUserName",
    "switchUserButton",
    "loginOverlay",
    "loginForm",
    "loginNameInput",
    "loginGroupInput",
    "loginSubmitButton",
    "orderNotice",
    "orderNoticeText",
    "openNotifiedOrderButton",
    "dismissOrderNoticeButton"
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.pdfInput.addEventListener("change", handlePdfUpload);
  elements.imageInput.addEventListener("change", handleImageUpload);
  elements.loadingSlipPdfInput.addEventListener("change", handleLoadingSlipPdfUpload);
  elements.pickingModeButton.addEventListener("click", () => setMode("picking"));
  elements.storageModeButton.addEventListener("click", () => setMode("storage"));
  elements.topToggleButton.addEventListener("click", () => {
    setTopControlsCollapsed(!topControlsCollapsed);
  });
  elements.newOrderButton.addEventListener("click", resetOrder);
  elements.printButton.addEventListener("click", () => window.print());
  elements.exportButton.addEventListener("click", exportCsv);
  elements.pdfExportButton.addEventListener("click", exportPdf);
  elements.addStorageLineButton.addEventListener("click", addManualStorageLine);
  elements.saveOrderButton.addEventListener("click", handleSaveOrderButtonClick);
  elements.releaseOrderButton.addEventListener("click", releaseCurrentOrder);
  elements.discardDraftButton.addEventListener("click", discardCurrentDraft);
  elements.takeOverOrderButton.addEventListener("click", takeOverCurrentOrder);
  elements.refreshOrdersButton.addEventListener("click", loadOrderList);
  elements.deleteOrderButton.addEventListener("click", () => deleteCurrentOrder());
  elements.orderSelect.addEventListener("change", () => loadOrder(elements.orderSelect.value));
  elements.switchUserButton.addEventListener("click", () => showLogin(true));
  elements.openNotifiedOrderButton.addEventListener("click", () => {
    const id = notifiedOrderId;
    hideOrderNotice();
    if (id) loadOrder(id);
  });
  elements.dismissOrderNoticeButton.addEventListener("click", hideOrderNotice);
  window.addEventListener("online", initializeServer);
  window.addEventListener("offline", () => setConnectionStatus(false));
  window.addEventListener("focus", () => initializeServer({ showChecking: false }));
  window.addEventListener("pagehide", persistCurrentOrderCache);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistCurrentOrderCache();
    else initializeServer({ showChecking: false });
  });
  elements.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setCurrentUser(elements.loginNameInput.value, elements.loginGroupInput.value);
  });
  if (elements.warehouseSelect) {
    elements.warehouseSelect.addEventListener("change", async () => {
      saveCurrentWarehouse();
      clearCurrentOrder();
      render();
      if (serverOnline) await loadOrderList();
    });
  }
  ["orderNumber", "customerName", "orderDate", "orderTime", "euroPallets", "storageSpaces", "orderNote"].forEach((id) => {
    elements[id].addEventListener("input", () => {
      state[id] = elements[id].value;
      markOrderTouched();
      if (id === "customerName") {
        applyCustomerOrderNumberRule();
      }
      if (id === "customerName" && (state.orderType || currentMode) === "storage") {
        state.customerGroupKey = customerGroupKeyForImport(state.customerName);
        state.lines = normalizeStorageHandlingUnits(state.lines, storageOrderUsesSsiCustomer());
        saveAndRender();
        return;
      }
      saveState();
      renderDiscardButton();
      updateCounts();
    });
  });
}

function configurePdfJs() {
  if (!window.pdfjsLib) return;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register(`/service-worker.js?v=${CLIENT_ASSET_VERSION}`, { updateViaCache: "none" })
    .then((registration) => {
      if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      registration.update().catch(() => {});
    })
    .catch(() => {
      // Offline caching is optional; the app still works online without it.
    });
}

function loadCurrentMode() {
  currentMode = window.location.hash === "#storage" || localStorage.getItem(MODE_KEY) === "storage" ? "storage" : "picking";
}

async function setMode(mode) {
  const nextMode = mode === "storage" ? "storage" : "picking";
  if (nextMode === currentMode) return;

  if (state.id || state.lines.length) await releaseCurrentOrderActivity();
  currentMode = nextMode;
  localStorage.setItem(MODE_KEY, currentMode);
  clearCurrentOrder();
  topControlsCollapsed = false;
  saveStateWithoutServer();
  render();
  await loadOrderList();
}

function modeLabel(mode = currentMode) {
  return mode === "storage" ? "Einlagerung" : "Kommissionierung";
}

function loadCurrentUser() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("login") || params.has("reset")) {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(USER_GROUP_KEY);
    localStorage.removeItem(MODE_KEY);
  }
  currentUser.name = localStorage.getItem(USER_KEY) || "";
  currentUser.group = localStorage.getItem(USER_GROUP_KEY) || "";
}

function currentWarehouse() {
  return HLogistikUi.currentWarehouse();
}

function saveCurrentWarehouse() {
  HLogistikUi.saveCurrentWarehouse(elements.warehouseSelect);
}

function applyWarehouseSelection() {
  HLogistikUi.applyWarehouseSelection(elements.warehouseSelect);
}

function normalizeWarehouse(value) {
  return HLogistikUi.normalizeWarehouse(value);
}

function normalizeOptionalWarehouse(value) {
  const text = String(value || "").trim().toUpperCase();
  return text === "SSI" || text === "SI" ? normalizeWarehouse(text) : "";
}

function sameUserName(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function currentOrderWarehouse() {
  return normalizeOptionalWarehouse(state.orderWarehouse) || currentWarehouse();
}

function currentStorageRequiresHandlingUnit() {
  return storageOrderUsesSsiCustomer();
}

function storageOrderUsesSsiCustomer(customerName = state.customerName) {
  return normalizeCustomerGroupKey(customerName) === "SSI";
}

function applyLoadedOrderWarehouse(source) {
  state.orderWarehouse = normalizeOptionalWarehouse(source?.orderWarehouse)
    || normalizeOptionalWarehouse(source?.pickingWarehouse)
    || normalizeOptionalWarehouse(source?.detectedWarehouse);
}

function setCurrentUser(value, groupValue) {
  const name = String(value || "").trim();
  const group = normalizeUserGroup(groupValue);
  if (!name || !group) return;

  currentUser.name = name;
  currentUser.group = group;
  localStorage.setItem(USER_KEY, name);
  localStorage.setItem(USER_GROUP_KEY, group);
  elements.loginOverlay.hidden = true;
  updateCurrentUserUi();
  if (!applyUserAccess()) return;

  if (state.lines.length || state.id) {
    saveStateWithoutServer();
    render();
  }
}

function showLogin(force = false) {
  elements.loginNameInput.value = force ? currentUser.name : "";
  elements.loginGroupInput.value = force ? currentUser.group : "";
  elements.loginOverlay.hidden = false;
  elements.loginNameInput.focus();
  elements.loginNameInput.select();
}

function showLoginIfNeeded() {
  if (!currentUser.name || !currentUser.group) showLogin(false);
  else applyUserAccess();
}

function requireCurrentUser() {
  if (currentUser.name && currentUser.group) return true;
  showLogin(false);
  setServerStatus("Bitte zuerst mit Namen anmelden.", "error");
  return false;
}

function updateCurrentUserUi() {
  HLogistikUi.applyCurrentUserName(elements.currentUserName, currentUser.name, currentUser.group);
}

function normalizeUserGroup(value) {
  return HLogistikUi.normalizeUserGroup(value);
}

function storageNavLabel(group) {
  return HLogistikUi.storageNavLabel(group);
}

function applyUserAccess() {
  const isWarehouse = currentUser.group === "lager";
  if (elements.storageModeButton) elements.storageModeButton.hidden = false;
  if (elements.storageAppLink) {
    elements.storageAppLink.hidden = isWarehouse;
    elements.storageAppLink.textContent = storageNavLabel(currentUser.group);
  }
  if (elements.articleNavLink) elements.articleNavLink.hidden = isWarehouse;
  if (elements.articleOverviewNavLink) elements.articleOverviewNavLink.hidden = isWarehouse;
  return true;
}

async function handlePdfUpload(event) {
  if (!requireCurrentUser()) {
    event.target.value = "";
    return;
  }

  const file = event.target.files[0];
  if (!file) return;
  let data;

  if (/\.xlsx?$/i.test(file.name || "")) {
    try {
      await handlePickingXlsxUpload(file);
    } finally {
      event.target.value = "";
    }
    return;
  }

  if (!window.pdfjsLib) {
    setImportStatus("PDF-Modul konnte nicht geladen werden. Seite neu laden.", "error");
    return;
  }

  try {
    setImportStatus(`Lese ${file.name} ...`, "", 0);
    data = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    const pageTexts = await readPdfPages(pdf);
    const fullText = pageTexts.join("\n");
    if (currentMode === "storage") {
      const imported = await chooseBestStorageImportText(pdf, fullText, file.name, pageTexts);
      const result = await importStorageText(imported.text, file.name, imported.parsed);

      if (result.cancelled) {
        setImportStatus(result.message || "Import abgebrochen.", result.type || "warning", 100);
      } else if (result.lines > 0) {
        setImportStatus(importSuccessMessage(result.lines), "ok", 100);
      } else if (result.warnings?.length) {
        setImportStatus(`Keine Einlagerungspositionen importiert. ${result.warnings.length} Tabellenzeile(n) nicht uebernommen: ${result.warnings[0]}`, "warning", 100);
      } else if (imported.text.trim()) {
        setImportStatus("Text gelesen, aber keine Lieferscheinpositionen erkannt.", "error");
      } else {
        setImportStatus("Keine lesbaren Inhalte gefunden.", "error");
      }
      return;
    }

    const imported = await chooseBestImportText(pdf, fullText);
    if (imported.rejected) {
      logPickingImportDiagnostics("weak-ocr-candidate", imported.diagnostics);
      setImportStatus(imported.message || "OCR-Import abgebrochen.", "error", 100);
      return;
    }

    const result = await importText(imported.text, file.name, imported.parsed, imported.diagnostics);

    if (result.cancelled) {
      setImportStatus(result.message || "Import abgebrochen.", result.type || "warning", 100);
    } else if (result.lines > 0) {
      setImportStatus(importSuccessMessage(result.lines), "ok", 100);
    } else if (imported.text.trim()) {
      setImportStatus("Text gelesen, aber keine Tabellenzeilen erkannt.", "error");
    } else {
      setImportStatus("Keine lesbaren Inhalte gefunden.", "error");
    }
  } catch (error) {
    console.error(error);
    if (currentMode !== "storage") {
      setImportStatus(error.message || "OCR-Import fehlgeschlagen.", "error");
      return;
    }

    const fallbackText = data ? extractTextFromSimplePdf(data) : "";
    if (fallbackText.trim()) {
      const result = currentMode === "storage"
        ? await importStorageText(fallbackText, file.name)
        : await importText(fallbackText, file.name);
      const warehouseNotice = currentMode === "storage" ? "" : result.warehouseHint?.shortMessage ? ` ${result.warehouseHint.shortMessage}` : "";
      setImportStatus(
        result.cancelled ? result.message || "Import abgebrochen." : `Fallback genutzt: ${result.lines} Positionen als Entwurf importiert. Bitte prüfen und freigeben.${warehouseNotice}`,
        result.cancelled ? result.type || "warning" : result.warehouseHint?.type === "warning" ? "warning" : result.lines ? "ok" : "error",
        result.cancelled || result.lines ? 100 : null
      );
    } else {
      setImportStatus(error.message || "PDF konnte nicht ausgelesen werden.", "error");
    }
  } finally {
    event.target.value = "";
  }
}

async function handleSaveOrderButtonClick() {
  if (!canAppendLoadingSlipToXlsxDraft()) {
    await saveOrderNow();
    return;
  }

  if (!elements.loadingSlipPdfInput) return;
  elements.loadingSlipPdfInput.value = "";
  elements.loadingSlipPdfInput.click();
}

function canAppendLoadingSlipToXlsxDraft(order = state) {
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  return isPickingXlsxOrder(order)
    && order?.awaitingRelease === true
    && !String(order?.id || "").trim()
    && lines.some((line) => line?.lineType !== "loading-slip");
}

async function handleLoadingSlipPdfUpload(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  if (!canAppendLoadingSlipToXlsxDraft()) {
    setImportStatus("Ladelisten können nur an einen noch ungespeicherten XLSX-Entwurf angehängt werden.", "error", 100);
    event.target.value = "";
    return;
  }
  if (!window.pdfjsLib || !window.Tesseract?.createWorker) {
    setImportStatus("PDF- oder OCR-Modul konnte nicht geladen werden. Seite neu laden.", "error", 100);
    event.target.value = "";
    return;
  }

  try {
    const attachment = await readLoadingSlipAttachmentPdf(file);
    if (!attachment.lines.length) {
      const detail = attachment.warnings.length ? ` ${attachment.warnings.join(" ")}` : "";
      setImportStatus(`Keine Ladelistenpositionen angehängt; der XLSX-Entwurf blieb unverändert.${detail}`, "error", 100);
      return;
    }

    state.lines = appendAllLoadingSlipLines(state.lines, attachment.lines);
    render();
    const warningText = attachment.warnings.length ? ` Warnung: ${attachment.warnings.join(" ")}` : "";
    setImportStatus(
      `${attachment.lines.length} Ladelistenposition(en) aus ${attachment.loadingSlipCount} Ladeliste(n) angehängt.${warningText}`,
      attachment.warnings.length ? "warning" : "ok",
      100
    );
  } catch (error) {
    console.error(error);
    setImportStatus(`Ladeliste konnte nicht angehängt werden; der XLSX-Entwurf blieb unverändert. ${error.message || ""}`.trim(), "error", 100);
  } finally {
    event.target.value = "";
  }
}

async function readLoadingSlipAttachmentPdf(file) {
  const data = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data }).promise;
  const pageTexts = await readPdfPages(pdf);
  const attachmentId = createId();
  const pageCandidates = pageTexts.map((text, index) => loadingSlipAttachmentPageCandidate(text, index + 1, {
    source: "pdf-text",
    rotation: 0
  }));
  const requiresOcr = pageCandidates.map((candidate) => !loadingSlipAttachmentCandidateIsComplete(candidate));
  let worker = null;

  try {
    if (requiresOcr.some(Boolean)) {
      worker = await createOcrWorker(pdf.numPages * OCR_ROTATIONS.length, OCR_RENDER_DPI);
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        if (!requiresOcr[pageNumber - 1]) continue;
        const baseCanvas = await renderPdfPageToCanvas(pdf, pageNumber, OCR_RENDER_SCALE);
        try {
          for (const rotation of OCR_ROTATIONS) {
            const canvas = rotation ? rotateCanvas(baseCanvas, rotation) : baseCanvas;
            try {
              setOcrWorkerStage(worker, "Ladeliste");
              await setOcrWorkerDpi(worker, OCR_RENDER_DPI);
              setImportStatus(`OCR Ladeliste: Seite ${pageNumber}/${pdf.numPages}${rotation ? `, Drehung ${rotation} Grad` : ""} ...`);
              const result = await worker.recognize(canvas);
              const candidate = loadingSlipAttachmentPageCandidate(result.data.text || "", pageNumber, {
                source: "ocr",
                rotation
              });
              if (loadingSlipAttachmentCandidateScore(candidate) > loadingSlipAttachmentCandidateScore(pageCandidates[pageNumber - 1])) {
                pageCandidates[pageNumber - 1] = candidate;
              }
            } catch (error) {
              pageCandidates[pageNumber - 1].ocrErrors.push(error.message || "OCR fehlgeschlagen.");
            } finally {
              if (canvas !== baseCanvas) {
                canvas.width = 0;
                canvas.height = 0;
              }
            }
          }
        } finally {
          baseCanvas.width = 0;
          baseCanvas.height = 0;
        }
      }
    }
  } finally {
    if (worker) await worker.terminate();
  }

  const warnings = [];
  const lines = pageCandidates.flatMap((candidate) => {
    warnings.push(...loadingSlipAttachmentWarnings(candidate));
    return candidate.lines.map((line) => createLine({
      ...line,
      loadingSlipAttachmentId: attachmentId,
      loadingSlipAttachmentPage: candidate.pageNumber
    }));
  });
  const loadingSlipCount = new Set(lines.map((line) => `${line.loadingSlipAttachmentPage}:${line.loadingSlipBlockIndex || 1}`)).size;
  return { lines, loadingSlipCount, warnings, pages: pageCandidates };
}

function loadingSlipAttachmentPageCandidate(text, pageNumber, options = {}) {
  const sourceLines = String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const lines = parseLoadingSlipLines(sourceLines);
  const audit = auditLoadingSlipImport(sourceLines, lines);
  const blocks = loadingSlipBlocksFrom(sourceLines);
  const hasSignal = blocks.length > 0 || /lad[ce](?:schein|liste)|lade(?:schein|liste)/i.test(sourceLines.join("\n"));
  return {
    pageNumber,
    source: options.source || "",
    rotation: Number(options.rotation || 0),
    sourceLines,
    lines,
    audit,
    hasSignal,
    ocrErrors: []
  };
}

function loadingSlipAttachmentCandidateIsComplete(candidate) {
  return candidate?.lines?.length > 0 && !candidate?.audit?.issues?.length;
}

function loadingSlipAttachmentCandidateScore(candidate) {
  const lines = Array.isArray(candidate?.lines) ? candidate.lines.length : 0;
  const expected = Number(candidate?.audit?.expected || 0);
  const issues = Array.isArray(candidate?.audit?.issues) ? candidate.audit.issues.length : 0;
  return lines * 10000 + expected * 100 - issues * 1000 + (candidate?.source === "pdf-text" ? 1 : 0);
}

function loadingSlipAttachmentWarnings(candidate) {
  if (!candidate?.hasSignal) return [];
  const pageLabel = `Seite ${candidate.pageNumber}`;
  if (!candidate.lines.length) {
    return [`${pageLabel}: Ladeliste erkannt, aber keine Position konnte gelesen werden.`];
  }
  return (candidate.audit?.issues || []).map((issue) => `${pageLabel}: ${issue}`);
}

async function handleImageUpload(event) {
  if (!requireCurrentUser()) {
    event.target.value = "";
    return;
  }

  const file = event.target.files[0];
  if (!file) return;

  if (!window.Tesseract?.recognize) {
    setImportStatus("OCR-Modul konnte nicht geladen werden. Internetverbindung prüfen und Seite neu laden.", "error");
    event.target.value = "";
    return;
  }

  try {
    setImportStatus(`Lese Lieferschein ${file.name} per OCR ...`, "", 0);
    const { text, parsed, rotation } = await readBestStorageImageOcr(file);
    const result = await importStorageText(text, file.name, parsed);

    if (result.cancelled) {
      setImportStatus(result.message || "Import abgebrochen.", "warning", 100);
    } else if (result.lines > 0) {
      const rotationText = rotation ? `, Rotation ${rotation} Grad` : "";
      setImportStatus(`${result.lines} Einlagerungspositionen importiert${rotationText}.`, "ok", 100);
    } else if (text.trim()) {
      setImportStatus("Bild gelesen, aber keine Lieferscheinpositionen erkannt.", "error");
    } else {
      setImportStatus("Keine lesbaren Inhalte gefunden.", "error");
    }
  } catch (error) {
    console.error(error);
    setImportStatus(error.message || "Lieferschein konnte nicht ausgelesen werden.", "error");
  } finally {
    event.target.value = "";
  }
}

async function readBestStorageImageOcr(file) {
  const candidates = [];

  for (let index = 0; index < STORAGE_IMAGE_ROTATIONS.length; index += 1) {
    const rotation = STORAGE_IMAGE_ROTATIONS[index];
    const rotationLabel = rotation ? `, Rotation ${rotation} Grad` : "";
    const imageSource = await createRotatedImageCanvas(file, rotation);

    try {
      setImportStatus(`OCR Lieferschein ${index + 1}/${STORAGE_IMAGE_ROTATIONS.length}${rotationLabel} ...`, "", Math.round((index / STORAGE_IMAGE_ROTATIONS.length) * 100));
      const result = await window.Tesseract.recognize(imageSource, OCR_LANGUAGE, {
        logger: (message) => {
          if (message.status === "recognizing text" && typeof message.progress === "number") {
            const overallPercent = Math.min(99, Math.round(((index + message.progress) / STORAGE_IMAGE_ROTATIONS.length) * 100));
            setImportStatus(`OCR Lieferschein ${index + 1}/${STORAGE_IMAGE_ROTATIONS.length}${rotationLabel}: ${Math.round(message.progress * 100)}%`, "", overallPercent);
          }
        }
      });
      const text = result.data.text || "";
      const parsed = parseStorageSlipText(text, file.name);
      const candidate = { text, parsed, rotation, score: scoreStorageOcrCandidate(text, parsed) };
      candidates.push(candidate);
      if (isStrongOcrCandidate(candidate)) break;
    } finally {
      if (imageSource instanceof HTMLCanvasElement) {
        imageSource.width = 0;
        imageSource.height = 0;
      }
    }
  }

  return candidates.sort((left, right) => right.score - left.score)[0] || {
    text: "",
    parsed: parseStorageSlipText("", file.name),
    rotation: 0
  };
}

async function createRotatedImageCanvas(file, degrees) {
  const bitmap = await loadImageBitmap(file);
  const radians = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const width = bitmap.width || bitmap.naturalWidth;
  const height = bitmap.height || bitmap.naturalHeight;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = Math.ceil(width * cos + height * sin);
  canvas.height = Math.ceil(width * sin + height * cos);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(radians);
  context.drawImage(bitmap, -width / 2, -height / 2, width, height);

  if (typeof bitmap.close === "function") bitmap.close();
  return canvas;
}

async function loadImageBitmap(file) {
  if (window.createImageBitmap) return window.createImageBitmap(file);

  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readPdfPages(pdf) {
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(rebuildPageRows(content.items));
  }

  return pages;
}

async function chooseBestImportText(pdf, fullText = "") {
  const textCandidate = String(fullText || "").trim()
    ? await buildPickingImportCandidate(pdf, fullText, "pdf-text", {
      ocrScales: [],
      ocrDpis: [],
      documentType: importDocumentType(fullText, parseOrderText(fullText))
    })
    : null;
  if (isAcceptedSiBestellscheinImportCandidate(textCandidate)) {
    return markPickingImportCandidateAccepted(textCandidate, "pdf-text-si-bestellschein");
  }
  if (isAcceptedPdfTextImportCandidate(textCandidate)) {
    return markPickingImportCandidateAccepted(textCandidate, "pdf-text");
  }

  setImportStatus("Starte hochaufloesende OCR-Kandidaten ...", "", 5);
  let selection = null;
  let ocrError = "";
  try {
    selection = await readPickingPdfWithOcrCandidate(pdf, {
      imageOnlyPdf: !String(fullText || "").trim()
    });
  } catch (error) {
    ocrError = error?.message || String(error || "");
    console.warn("Hochaufloesende OCR fehlgeschlagen.", error);
  }

  const candidate = await buildPickingImportCandidate(pdf, selection?.text || "", selection?.source || "ocr", {
    ...(selection || {}),
    ocrError
  });
  const selected = chooseBestPickingImportCandidate([candidate]);

  if (isAcceptedPickingImportCandidate(selected)) {
    return markPickingImportCandidateAccepted(selected);
  }

  if (selection?.budgetExceeded || selection?.aborted) {
    return {
      ...selected,
      rejected: true,
      message: selection.message || "OCR-Budget ueberschritten. Import abgebrochen, keine Positionen uebernommen."
    };
  }

  if (!selection || !isUsablePickingOcrSelection(selection)) {
    const message = ocrError
      ? `OCR-Import fehlgeschlagen: ${ocrError}`
      : "OCR-Qualitaet zu schwach. Import abgebrochen, keine Positionen uebernommen.";
    return {
      ...selected,
      rejected: true,
      message
    };
  }

  if (hasMissingExpectedImportRows(candidate)) {
    return {
      ...candidate,
      rejected: true,
      message: "OCR-Import unvollstaendig. Import abgebrochen, keine Positionen uebernommen."
    };
  }

  return markPickingImportCandidateAccepted(candidate);
}

async function chooseBestStorageImportText(pdf, fullText, fileName = "", pageTexts = []) {
  const fastCandidate = {
    text: fullText,
    parsed: parseStorageSlipText(fullText, fileName, pageTexts),
    source: "pdf-text"
  };
  if (isAcceptedStoragePdfTextImportCandidate(fastCandidate)) return fastCandidate;

  setImportStatus("Starte hochaufloesende OCR ...", "", 5);
  let ocrText = "";
  try {
    ocrText = await readPdfWithOcr(pdf, (text) => parseStorageSlipText(text, fileName), scoreStorageOcrCandidate);
  } catch (error) {
    console.warn("Hochaufloesende OCR fehlgeschlagen.", error);
  }

  if (!ocrText.trim()) return fastCandidate;

  const ocrCandidate = {
    text: ocrText,
    parsed: parseStorageSlipText(ocrText, fileName),
    source: "ocr"
  };
  return chooseBestStorageImportCandidate([ocrCandidate, fastCandidate]);
}

function isAcceptedStoragePdfTextImportCandidate(candidate) {
  const lines = Array.isArray(candidate?.parsed?.lines) ? candidate.parsed.lines : [];
  const warnings = Array.isArray(candidate?.parsed?.warnings) ? candidate.parsed.warnings : [];
  return lines.length > 0
    && warnings.length === 0
    && lines.every(isCompleteStorageImportLine);
}

function isCompleteStorageImportLine(line) {
  if (!line || !String(line.product || "").trim()) return false;
  const quantity = parseImportQuantityValue(line.targetQty);
  return Number.isFinite(quantity) && quantity > 0;
}

async function buildPickingImportCandidate(pdf, text, source, info = {}) {
  const parsed = appendLoadingSlipLinesToParsed(parseOrderText(text), info.loadingSlipLines);
  const binScan = {
    parsed,
    corrected: 0,
    warnings: 0,
    scannedPages: 0,
    disabled: true,
    reason: "Keine Stellplatzvalidierung oder -korrektur im PDF-Importpfad."
  };
  const sanitizedParsed = sanitizeBestellscheinHandlingUnitDuplicates(binScan.parsed, text);
  const issues = validatePickingImport(text, sanitizedParsed);
  const pageNotice = bestellscheinPageNotice(text, pdf.numPages);
  const siBestellscheinAccepted = isSiBestellscheinText(text)
    && sanitizedParsed.lines.some((line) => line?.lineType !== "loading-slip" && isCompleteImportLine(line))
    && !issues.length;
  const diagnostics = pickingImportDiagnostics(text, sanitizedParsed, {
    source,
    documentType: info.documentType || importDocumentType(text, sanitizedParsed),
    imageOnlyPdf: info.imageOnlyPdf === true,
    orientationProbeAttempted: info.orientationProbeAttempted === true,
    orientationProbeCandidates: info.orientationProbeCandidates || [],
    selectedOrientation: info.selectedOrientation ?? "",
    orientationTieBreakAttempted: info.orientationTieBreakAttempted === true,
    orientationTieBreakRotations: info.orientationTieBreakRotations || [],
    orientationTieBreakCandidates: info.orientationTieBreakCandidates || [],
    orientationTieBreakRejectReason: info.orientationTieBreakRejectReason || "",
    bestellscheinPageNotice: info.bestellscheinPageNotice || pageNotice,
    siBestellscheinAccepted: info.siBestellscheinAccepted === true || siBestellscheinAccepted,
    siBestellscheinRejectReason: info.siBestellscheinRejectReason || siBestellscheinRejectReason(text, sanitizedParsed, issues),
    pdfPages: pdf?.numPages || 0,
    ocrScale: OCR_RENDER_SCALE,
    ocrDpi: OCR_RENDER_DPI,
    ocrPreciseScale: OCR_PRECISE_RENDER_SCALE,
    ocrPreciseDpi: OCR_PRECISE_RENDER_DPI,
    ocrRotations: OCR_ROTATIONS,
    ocrScales: info.ocrScales || [],
    ocrDpis: info.ocrDpis || [],
    ocrRotation: info.ocrRotation ?? "",
    selectedCandidate: info.selectedCandidate || null,
    ocrCandidates: info.ocrCandidates || [],
    ocrTimings: info.ocrTimings || [],
    loadingSlipCandidates: info.loadingSlipCandidates || [],
    loadingSlipExpected: info.loadingSlipExpected,
    loadingSlipFallbackStatus: info.loadingSlipFallbackStatus || "",
    loadingSlipWarning: info.loadingSlipWarning || "",
    qualityScore: info.qualityScore ?? null,
    minimumQualityScore: info.minimumQualityScore ?? PICKING_OCR_MINIMUM_SCORE,
    qualityAccepted: info.qualityAccepted === true,
    ocrError: info.ocrError || "",
    ocrStepCount: info.ocrStepCount ?? 0,
    ocrComputedSteps: info.ocrComputedSteps ?? 0,
    ocrSkippedSteps: info.ocrSkippedSteps || [],
    ocrBudget: info.ocrBudget || null,
    ocrStage: info.ocrStage || "",
    ocrAbortReason: info.ocrAbortReason || "",
    fromBinRechecks: info.fromBinRechecks || [],
    binValidationApplied: false,
    binCorrectionApplied: false
  });

  return {
    text,
    parsed: sanitizedParsed,
    source,
    documentType: info.documentType || importDocumentType(text, sanitizedParsed),
    pageNotice,
    binScan,
    issues,
    qualityScore: info.qualityScore ?? scorePickingImportCandidate(text, sanitizedParsed, issues),
    diagnostics
  };
}

function chooseBestPickingImportCandidate(candidates) {
  return candidates
    .filter(Boolean)
    .sort((left, right) => Number(right.qualityScore || 0) - Number(left.qualityScore || 0))[0] || candidates.find(Boolean) || {};
}

function markPickingImportCandidateAccepted(candidate, source = "") {
  if (!candidate) return candidate;
  return {
    ...candidate,
    source: source || candidate.source,
    diagnostics: {
      ...(candidate.diagnostics || {}),
      source: source || candidate.diagnostics?.source || candidate.source || "",
      qualityScore: candidate.qualityScore ?? candidate.diagnostics?.qualityScore ?? null,
      qualityAccepted: true,
      documentType: candidate.documentType || candidate.diagnostics?.documentType || ""
    }
  };
}

function isAcceptedPickingImportCandidate(candidate) {
  if (!candidate || candidate.rejected) return false;
  const lines = Array.isArray(candidate.parsed?.lines) ? candidate.parsed.lines : [];
  return lines.some((line) => line?.lineType !== "loading-slip")
    && !candidate.issues?.length
    && Number(candidate.qualityScore || 0) >= PICKING_OCR_MINIMUM_SCORE;
}

function isAcceptedSiBestellscheinImportCandidate(candidate) {
  if (!candidate || candidate.rejected) return false;
  const lines = Array.isArray(candidate.parsed?.lines) ? candidate.parsed.lines : [];
  const normalLines = lines.filter((line) => line?.lineType !== "loading-slip");
  return isSiBestellscheinText(candidate.text)
    && normalLines.some(isCompleteImportLine)
    && !candidate.issues?.length;
}

function siBestellscheinRejectReason(text, parsed, issues = []) {
  if (!isBestellscheinText(text)) return "";
  if (!isSiBestellscheinText(text)) return "si-kontext-nicht-erkannt";

  const normalLines = (Array.isArray(parsed?.lines) ? parsed.lines : [])
    .filter((line) => line?.lineType !== "loading-slip");
  if (!normalLines.length) return "keine-positionen-erkannt";
  if (!normalLines.some(isCompleteImportLine)) return "keine-vollstaendige-position-mit-artikel-und-menge";
  if (Array.isArray(issues) && issues.length) return issues[0] || "validierung-fehlgeschlagen";
  return "";
}

function isAcceptedPdfTextImportCandidate(candidate) {
  if (!isAcceptedPickingImportCandidate(candidate)) return false;
  const metrics = pickingOcrCandidateMetrics(candidate.text, candidate.parsed, candidate.issues);
  if (metrics.issueCount > 0 || metrics.discardedRows > 0 || metrics.suspiciousSourceFieldCount > 0) return false;
  if (metrics.bestellscheinLike) {
    return metrics.bestellscheinCompleteCount > 0
      && metrics.bestellscheinOrderDetected
      && metrics.bestellscheinCustomerDetected;
  }
  return metrics.completeRequiredCount > 0 && metrics.completeRequiredCount === metrics.parsedLineCount;
}

function hasMissingExpectedImportRows(candidate) {
  const diagnostics = candidate?.diagnostics || {};
  const expectedRows = Number(diagnostics.expectedTableRows ?? diagnostics.expectedWarehouseRows ?? 0);
  const importedRows = Number(diagnostics.importedPositionCount ?? diagnostics.parsedLineCount ?? 0);
  return expectedRows > 0 && importedRows > 0 && importedRows < expectedRows;
}

function importDocumentType(text, parsed = {}) {
  if (isSiBestellscheinText(text)) return "si-bestellschein";
  if (isBestellscheinText(text)) return "bestellschein";
  if (isWarehouseLikeText(text)) return "lageraufgabe";
  if (Array.isArray(parsed?.lines) && parsed.lines.length) return "picking";
  return "";
}

function scorePickingImportCandidate(text, parsed, issues = []) {
  const parsedLines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const normalLines = parsedLines.filter((line) => line?.lineType !== "loading-slip");
  const completeLines = normalLines.filter((line) => {
    if (!isCompleteImportLine(line)) return false;
    if (isWarehouseLikeText(text) && !String(line.fromBin || "").trim()) return false;
    return true;
  }).length;
  const loadingSlips = countLoadingSlipLines(parsedLines);
  const binWarnings = countOpenBinWarnings(parsedLines);

  return completeLines * 2500
    + normalLines.length * 250
    + loadingSlips * 500
    + Math.min(String(text || "").length, 500)
    - (issues.length * 10000)
    - (binWarnings * 250);
}

function chooseBestStorageImportCandidate(candidates) {
  return candidates
    .filter(Boolean)
    .sort((left, right) => scoreStorageImportQuality(right) - scoreStorageImportQuality(left))[0] || candidates[0];
}

function scoreStorageImportQuality(candidate) {
  const lines = candidate?.parsed?.lines?.length || 0;
  const warnings = candidate?.parsed?.warnings?.length || 0;
  const sourceBonus = candidate?.source === "ocr" ? 150 : 0;
  return lines * 1200 - warnings * 900 + sourceBonus;
}

function suspiciousPickingBinWarning(line) {
  if (!line || line.lineType === "loading-slip") return "";
  const bin = normalizePickingBinText(line.fromBin);
  if (!bin) return "";
  const shape = pickingFromBinShapeDiagnostic(bin);
  if (shape.status === "suspicious") {
    const suggestionText = shape.suggestedCandidates.length
      ? ` Vorschlag nur zur Pruefung: ${shape.suggestedCandidates.join(", ")}.`
      : "";
    return `Lagerplatz formal verdaechtig: ${bin}.${suggestionText}`;
  }
  if (shape.status === "invalid") return `Lagerplatz formal ungueltig: ${bin}.`;
  if (!isPlausiblePickingBin(bin)) return `Lagerplatz unklar: ${bin}.`;

  return "";
}

function fromBinReviewBlockMessage() {
  return FROM_BIN_REVIEW_BLOCK_MESSAGE;
}

function fromBinReviewWarningMessage(value) {
  const bin = normalizePickingBinText(value) || String(value || "").trim();
  return `Von-Lagerplatz OCR-unsicher: ${bin}. Bitte anhand PDF prüfen und korrigieren.`;
}

function fromBinReviewConfirmationMessage(value) {
  const bin = normalizePickingBinText(value) || String(value || "").trim();
  return `Von-Lagerplatz manuell geprüft: ${bin}.`;
}

function fromBinReviewDiagnosticForValue(value) {
  const bin = normalizePickingBinText(value);
  const shape = pickingFromBinShapeDiagnostic(bin);
  const required = ["suspicious", "invalid"].includes(shape.status);
  return {
    fromBinReviewRequired: required,
    fromBinReviewReason: required ? fromBinReviewWarningMessage(bin) : "",
    fromBinReviewBlocksRelease: required,
    fromBinReviewBlocksExport: required,
    fromBinManualCorrectionClearsWarning: required,
    fromBinShapeStatus: shape.status
  };
}

function isFromBinReviewConfirmedForValue(value, line = {}) {
  const bin = normalizePickingBinText(value);
  const confirmedBin = normalizePickingBinText(line.fromBinReviewConfirmedValue);
  return Boolean(bin && confirmedBin && bin === confirmedBin);
}

function fromBinReviewConfirmedPatchForValue(value) {
  const bin = normalizePickingBinText(value);
  return {
    binWarning: "",
    binWarningValue: "",
    binWarningType: "",
    fromBinReviewRequired: false,
    fromBinReviewReason: fromBinReviewConfirmationMessage(bin),
    fromBinReviewBlocksRelease: false,
    fromBinReviewBlocksExport: false,
    fromBinManualCorrectionClearsWarning: false,
    fromBinReviewConfirmedValue: bin
  };
}

function canConfirmFromBinReview(line) {
  if (!line || line.lineType === "loading-slip") return false;
  const bin = normalizePickingBinText(line.fromBin);
  if (!bin || isFromBinReviewConfirmedForValue(bin, line)) return false;
  const review = fromBinReviewDiagnosticForValue(bin);
  return Boolean(review.fromBinReviewRequired && (line.fromBinReviewRequired === true || line.binWarningType === "from-bin-review"));
}

function fromBinReviewPatchForValue(value, line = {}) {
  const review = fromBinReviewDiagnosticForValue(value);
  if (review.fromBinReviewRequired && isFromBinReviewConfirmedForValue(value, line)) {
    return fromBinReviewConfirmedPatchForValue(value);
  }
  if (!review.fromBinReviewRequired) {
    const clearOwnWarning = line.fromBinReviewRequired === true || line.binWarningType === "from-bin-review";
    return {
      ...(clearOwnWarning ? { binWarning: "", binWarningValue: "", binWarningType: "" } : {}),
      fromBinReviewRequired: false,
      fromBinReviewReason: "",
      fromBinReviewBlocksRelease: false,
      fromBinReviewBlocksExport: false,
      fromBinManualCorrectionClearsWarning: false,
      fromBinReviewConfirmedValue: ""
    };
  }

  const bin = normalizePickingBinText(value) || String(value || "").trim();
  return {
    binWarning: review.fromBinReviewReason,
    binWarningValue: bin,
    binWarningType: "from-bin-review",
    fromBinReviewRequired: true,
    fromBinReviewReason: review.fromBinReviewReason,
    fromBinReviewBlocksRelease: true,
    fromBinReviewBlocksExport: true,
    fromBinManualCorrectionClearsWarning: true,
    fromBinReviewConfirmedValue: ""
  };
}

function applyFromBinReviewWarnings(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => {
    if (!line || line.lineType === "loading-slip") return line;
    if (line.binWarningType === "si-system-bin-review" && line.fromBinReviewRequired === true && !isFormalValidPickingBin(line.fromBin)) {
      return line;
    }
    return {
      ...line,
      ...fromBinReviewPatchForValue(line.fromBin, line)
    };
  });
}

function isPickingXlsxOrder(order = state) {
  const orderType = order?.orderType || currentMode;
  return orderType === "picking" && /\.(?:xlsx|xls)$/i.test(String(order?.originalFileName || "").trim());
}

function noFromBinReviewPatch() {
  return {
    binWarning: "",
    binWarningValue: "",
    binWarningType: "",
    fromBinReviewRequired: false,
    fromBinReviewReason: "",
    fromBinReviewBlocksRelease: false,
    fromBinReviewBlocksExport: false,
    fromBinManualCorrectionClearsWarning: false,
    fromBinReviewConfirmedValue: ""
  };
}

function openFromBinReviewWarnings(lines, order = state) {
  if (isPickingXlsxOrder(order)) return [];
  return (Array.isArray(lines) ? lines : [])
    .filter((line) => line?.lineType !== "loading-slip")
    .filter((line) =>
      fromBinReviewDiagnosticForValue(line.fromBin).fromBinReviewRequired
        && !isFromBinReviewConfirmedForValue(line.fromBin, line)
    );
}

function hasOpenFromBinReviewWarnings(lines = state.lines, order = state) {
  return openFromBinReviewWarnings(lines, order).length > 0;
}

function pickingFromBinShapeDiagnostic(value) {
  if (window.HLogistikImportDiagnostics?.pickingFromBinShapeDiagnostic) {
    return window.HLogistikImportDiagnostics.pickingFromBinShapeDiagnostic(value);
  }
  return {
    status: String(value || "").trim() ? "unknown" : "missing",
    reason: "",
    rawValue: String(value || "").trim(),
    normalizedValue: String(value || "").trim(),
    suggestedCandidates: []
  };
}

function isPlausiblePickingBin(value) {
  if (window.HLogistikStorageBinRules?.isValidPickingBin) {
    return window.HLogistikStorageBinRules.isValidPickingBin(value);
  }
  const bin = normalizePickingBinText(value);
  if (/^(?:002|022)-H\d{1,2}-R\d{1,3}$/i.test(bin)) return true;
  if (/^002-H1-A[A-L]1$/i.test(bin)) return true;
  if (/^002-H1-SA[A-T](?:[1-9]|1[0-2])[A-D][1-3]$/i.test(bin)) return true;
  if (/^002-H3-S[O-Z](?:[1-9]|1[0-2])[A-D][1-3]$/i.test(bin)) return true;
  if (/^002-H4-S[A-N](?:[1-9]|1[0-2])[A-D][1-4]$/i.test(bin)) return true;
  return false;
}

function isFormalValidPickingBin(value) {
  return Boolean(normalizePickingBinText(value)) && pickingFromBinShapeDiagnostic(value).status === "valid" && isPlausiblePickingBin(value);
}

function normalizePickingBinText(value) {
  return cleanImportedWarehouseBin(value);
}

function formatPickingBinForDisplay(value) {
  return String(value || "").replace(/^\d{3}-/, "");
}

function formatLineQuantityForDisplay(line, value) {
  return window.HLogistikQuantityFormat?.displayLineQuantity(line, value) ?? String(value || "");
}

function normalizeOrderQuantitiesForSave(order) {
  (Array.isArray(order?.lines) ? order.lines : []).forEach((line) => {
    if (!line || line.lineType === "loading-slip") return;
    ["targetQty", "actualQty"].forEach((key) => {
      const text = String(line[key] ?? "").trim();
      if (!text) return;
      const parsed = window.HLogistikQuantityFormat?.parse(text);
      if (Number.isFinite(parsed)) line[key] = String(parsed);
    });
    const source = String(line.quantitySourceText || "").trim();
    const effectiveQuantity = String(line.actualQty ?? "").trim() || line.targetQty;
    if (source && window.HLogistikQuantityFormat?.parse(source) !== window.HLogistikQuantityFormat?.parse(effectiveQuantity)) {
      line.quantitySourceText = "";
    }
  });
  return order;
}

function cleanImportedWarehouseBin(value) {
  const bin = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[‐‑‒–—]/g, "-")
    ;
  return bin;
}

async function readPickingPdfWithOcrCandidate(pdf, options = {}) {
  if (!window.Tesseract?.createWorker) {
    throw new Error("OCR-Modul konnte nicht geladen werden. Internetverbindung pruefen und Seite neu laden.");
  }

  const scaleCandidates = pickingOcrScaleCandidates();
  const fastScaleCandidates = scaleCandidates.slice(0, 1);
  const preciseScaleCandidates = scaleCandidates.slice(1);
  const uprightRotations = PICKING_OCR_UPRIGHT_ROTATIONS;
  const candidateMap = new Map();
  const timings = [];
  const budget = createPickingOcrBudget(pdf);
  const worker = await createOcrWorker(budget.maxSteps, scaleCandidates[0]?.dpi || OCR_RENDER_DPI);

  try {
    let stageStarted = importNowMs();
    setImportStatus("OCR Schnellpruefung ...", "", 5);
    const fastResult = await readPickingPdfOcrCandidateSet(pdf, fastScaleCandidates, uprightRotations, {
      worker,
      candidateMap,
      budget,
      stage: "schnellpruefung",
      stageLabel: "Schnellpruefung"
    });
    stageStarted = pushImportTiming(timings, "basis-gerade", stageStarted, fastResult);
    if (shouldRunSiBestellscheinOrientationProbe(fastResult, options)) {
      const probeStarted = importNowMs();
      const probe = await readSiBestellscheinOrientationProbe(pdf, worker, budget);
      timings.push({
        label: "si-bestellschein-orientierungsprobe",
        ms: Math.max(0, Math.round(importNowMs() - probeStarted)),
        best: probe.selectedCandidate || null
      });

      if (probe.selectedOrientation !== "") {
        setImportStatus(`OCR SI-Bestellschein Rotation ${probe.selectedOrientation} Grad ...`, "", 25);
        const orientationStarted = importNowMs();
        let orientedResult = await readPickingPdfOcrCandidateSet(pdf, fastScaleCandidates, [probe.selectedOrientation], {
          worker,
          candidateMap,
          budget,
          stage: "si-bestellschein-rotation",
          stageLabel: "SI-Bestellschein"
        });
        stageStarted = pushImportTiming(timings, "si-bestellschein-rotation", orientationStarted, orientedResult);

        if (!isAcceptedSiBestellscheinOcrCandidate(orientedResult.best) && preciseScaleCandidates.length) {
          const preciseStarted = importNowMs();
          setImportStatus(`OCR SI-Bestellschein Praezision Rotation ${probe.selectedOrientation} Grad ...`, "", 45);
          orientedResult = await readPickingPdfOcrCandidateSet(pdf, preciseScaleCandidates, [probe.selectedOrientation], {
            worker,
            candidateMap,
            budget,
            stage: "si-bestellschein-praezision",
            stageLabel: "SI-Bestellschein Praezision",
            stopReason: "si-bestellschein-akzeptiert",
            stopWhen: (currentResult) => isAcceptedSiBestellscheinOcrCandidate(currentResult?.best)
          });
          stageStarted = pushImportTiming(timings, "si-bestellschein-praezision", preciseStarted, orientedResult);
        }

        const selection = pickingOcrSelectionWithoutFromBinCellRecheck(
          pdf,
          worker,
          orientedResult,
          scaleCandidates,
          [probe.selectedOrientation],
          timings,
          budget,
          "si-bestellschein-orientation"
        );
        return attachSiBestellscheinOrientationDiagnostics(selection, probe, options);
      }

      if (probe.hasSiBestellscheinSignal) {
        const tieBreak = await readSiBestellscheinOrientationTieBreak(
          pdf,
          worker,
          budget,
          probe,
          scaleCandidates,
          fastScaleCandidates,
          preciseScaleCandidates,
          candidateMap,
          timings
        );
        if (tieBreak.selectedCandidate && tieBreak.result) {
          const selection = pickingOcrSelectionWithoutFromBinCellRecheck(
            pdf,
            worker,
            tieBreak.result,
            scaleCandidates,
            tieBreak.rotations,
            timings,
            budget,
            "si-bestellschein-tiebreak"
          );
          return attachSiBestellscheinOrientationDiagnostics(selection, tieBreak.probe, options);
        }

        const unresolvedResult = tieBreak.result || fastResult;
        const unresolvedRotations = tieBreak.rotations.length ? tieBreak.rotations : uprightRotations;
        const selection = pickingOcrSelectionResult(unresolvedResult, scaleCandidates, unresolvedRotations, timings, budget, "si-bestellschein-tiebreak-unresolved");
        return attachSiBestellscheinOrientationDiagnostics({
          ...selection,
          aborted: true,
          message: "SI-Bestellschein-Orientierung nach Parser-Bewertung nicht eindeutig. Import abgebrochen, keine Positionen uebernommen."
        }, tieBreak.probe, options);
      }
    }
    if (isFastAcceptedPickingOcrCandidate(fastResult.best)) {
      const resultWithLoadingSlip = await readLoadingSlipOcrFallbackIfNeeded(pdf, fastResult, scaleCandidates, worker, candidateMap, timings, budget);
      return pickingOcrSelectionWithoutFromBinCellRecheck(
        pdf,
        worker,
        resultWithLoadingSlip,
        scaleCandidates,
        resultWithLoadingSlip.rotations || uprightRotations,
        timings,
        budget,
        "schnellpruefung"
      );
    }

    let uprightResult = fastResult;
    if (preciseScaleCandidates.length) {
      setImportStatus("OCR Praezisionspruefung ...", "", 35);
      const preciseResult = await readPickingPdfOcrCandidateSet(pdf, preciseScaleCandidates, uprightRotations, {
        worker,
        candidateMap,
        budget,
        stage: "praezisionspruefung",
        stageLabel: "Praezisionspruefung",
        stopReason: "vollstaendiger-kandidat",
        stopWhen: (currentResult) => isFastAcceptedPickingOcrCandidate(currentResult?.best)
      });
      uprightResult = preciseResult;
      stageStarted = pushImportTiming(timings, "praezise-gerade", stageStarted, uprightResult);
      if (isStableUprightPickingOcrResult(uprightResult, scaleCandidates)) {
        const resultWithLoadingSlip = await readLoadingSlipOcrFallbackIfNeeded(pdf, uprightResult, scaleCandidates, worker, candidateMap, timings, budget);
        return pickingOcrSelectionWithoutFromBinCellRecheck(
          pdf,
          worker,
          resultWithLoadingSlip,
          scaleCandidates,
          resultWithLoadingSlip.rotations || uprightRotations,
          timings,
          budget,
          "praezisionspruefung"
        );
      }
    }

    if (!shouldRunPickingRotationFallback(uprightResult)) {
      recordSkippedOcrStep(budget, {
        stage: "rotations-fallback",
        reason: "kein-konkreter-rotationshinweis",
        rotations: PICKING_OCR_ROTATION_FALLBACK_ROTATIONS
      });
      return pickingOcrSelectionWithoutFromBinCellRecheck(
        pdf,
        worker,
        uprightResult,
        scaleCandidates,
        uprightRotations,
        timings,
        budget,
        "upright-only"
      );
    }

    stageStarted = importNowMs();
    setImportStatus("OCR Rotationsfallback ...", "", 65);
    const fallbackRotations = pickingRotationFallbackRotations(uprightResult);
    const fullResult = await readPickingPdfOcrCandidateSet(pdf, fastScaleCandidates, fallbackRotations, {
      worker,
      candidateMap,
      budget,
      stage: "rotations-fallback",
      stageLabel: "Rotationsfallback",
      stageMaxMs: PICKING_OCR_ROTATION_FALLBACK_MAX_MS,
      stageStartedAt: stageStarted
    });
    pushImportTiming(timings, "rotations-fallback", stageStarted, fullResult);
    return pickingOcrSelectionWithoutFromBinCellRecheck(
      pdf,
      worker,
      fullResult,
      scaleCandidates,
      fallbackRotations,
      timings,
      budget,
      "rotations-fallback"
    );
  } catch (error) {
    if (!isPickingOcrBudgetError(error)) throw error;
    budget.aborted = true;
    budget.abortReason = error.message || "OCR-Budget ueberschritten.";
    const budgetResult = pickingOcrCandidateSetResult(candidateMap, scaleCandidates, uprightRotations);
    return {
      ...pickingOcrSelectionResult(budgetResult, scaleCandidates, uprightRotations, timings, budget, "budget-abbruch"),
      aborted: true,
      budgetExceeded: true,
      message: budget.abortReason
    };
  } finally {
    await worker.terminate();
  }
}

function shouldRunSiBestellscheinOrientationProbe(result, options = {}) {
  if (options.imageOnlyPdf !== true) return false;
  const best = result?.best;
  if (!best) return true;
  if (isAcceptedSiBestellscheinOcrCandidate(best)) return false;
  if (isCleanUprightPickingOcrCandidate(best)) return false;
  return !isUsablePickingOcrSelection(best)
    || Number(best?.metrics?.issueCount || 0) > 0
    || (Number(best?.metrics?.productCount || 0) > 0 && Number(best?.metrics?.quantityCount || 0) === 0);
}

async function readSiBestellscheinOrientationProbe(pdf, worker, budget) {
  const scaleConfig = {
    label: "si-probe",
    scale: SI_BESTELLSCHEIN_ORIENTATION_PROBE_SCALE,
    dpi: SI_BESTELLSCHEIN_ORIENTATION_PROBE_DPI
  };
  const pageNumber = 1;
  const candidates = [];
  const stageStartedAt = importNowMs();
  const baseCanvas = await renderPdfPageToCanvas(pdf, pageNumber, scaleConfig.scale);

  try {
    for (const rotation of SI_BESTELLSCHEIN_ORIENTATION_PROBE_ROTATIONS) {
      assertPickingOcrBudget(budget, {
        stage: "si-bestellschein-orientierungsprobe",
        stageLabel: "SI-Bestellschein Orientierungsprobe",
        stageStartedAt,
        pageNumber,
        scale: scaleConfig.scale,
        dpi: scaleConfig.dpi,
        rotation
      });
      setOcrWorkerStage(worker, "SI-Bestellschein Orientierungsprobe");
      setImportStatus(`OCR SI-Bestellschein Orientierungsprobe: Rotation ${rotation} Grad ...`, "", 15);
      await setOcrWorkerDpi(worker, scaleConfig.dpi);
      const canvas = rotation ? rotateCanvas(baseCanvas, rotation) : baseCanvas;
      const started = importNowMs();
      const result = await worker.recognize(canvas);
      recordCompletedOcrStep(budget, {
        stage: "si-bestellschein-orientierungsprobe",
        pageNumber,
        scale: scaleConfig.scale,
        dpi: scaleConfig.dpi,
        rotation
      });
      const text = result.data.text || "";
      candidates.push(siBestellscheinOrientationProbeCandidate(text, {
        rotation,
        scale: scaleConfig.scale,
        dpi: scaleConfig.dpi,
        durationMs: Math.max(0, Math.round(importNowMs() - started))
      }));
      if (canvas !== baseCanvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  } finally {
    baseCanvas.width = 0;
    baseCanvas.height = 0;
  }

  return selectSiBestellscheinOrientationCandidate(candidates);
}

function siBestellscheinOrientationProbeCandidate(text, info = {}) {
  const parsed = parseOrderText(text);
  const issues = validatePickingImport(text, parsed);
  const metrics = pickingOcrCandidateMetrics(text, parsed, issues);
  const markerHits = siBestellscheinOrientationMarkerHits(text);
  const score = scoreSiBestellscheinOrientationProbe(metrics, markerHits, issues);

  return {
    rotation: Number(info.rotation || 0),
    scale: info.scale || "",
    dpi: info.dpi || "",
    durationMs: Number(info.durationMs || 0),
    score,
    markerHits,
    markerScore: Object.values(markerHits).filter(Boolean).length,
    bestellscheinLike: metrics.bestellscheinLike === true || isBestellscheinText(text),
    siLike: isSiBestellscheinText(text),
    rawLineCount: metrics.rawLineCount,
    textLength: metrics.textLength,
    parsedLineCount: metrics.parsedLineCount,
    expectedRows: metrics.expectedRows,
    bestellscheinCompleteCount: metrics.bestellscheinCompleteCount,
    quantityCount: metrics.quantityCount,
    productCount: metrics.productCount,
    handlingUnitCount: metrics.handlingUnitCount,
    issueCount: metrics.issueCount,
    orderNumberDetected: metrics.bestellscheinOrderDetected,
    customerDetected: metrics.bestellscheinCustomerDetected,
    sample: String(text || "").replace(/\s+/g, " ").trim().slice(0, 240)
  };
}

function siBestellscheinOrientationMarkerHits(text) {
  const source = String(text || "");
  return {
    bestellschein: /bestellschein/i.test(source),
    entnahmeanweisungen: /entnahmeanweisungen/i.test(source),
    siWarehouse: /030\s*\/\s*012/i.test(source),
    siCustomer: /hummel\s+logistik\s+si|schwan\s+international/i.test(source),
    articleNumbers: /\b\d{6,8}\b/.test(source),
    quantities: /\b\d{1,6}(?:[,.]\d{1,3})?\s*(?:ST|Stk|Stueck|Stück|PC|PCS)\b/i.test(source),
    handlingUnits: /\b\d{7,12}\b/.test(source),
    pageNotice: /seite\s*:?\s*\d+\s*\(?\s*von\s*\d+\s*\)?/i.test(source)
  };
}

function scoreSiBestellscheinOrientationProbe(metrics, markerHits, issues = []) {
  const markerScore = Object.values(markerHits || {}).filter(Boolean).length;
  return markerScore * 450
    + (markerHits?.bestellschein ? 1200 : 0)
    + (markerHits?.entnahmeanweisungen ? 1200 : 0)
    + (markerHits?.siWarehouse ? 1200 : 0)
    + (markerHits?.siCustomer ? 1200 : 0)
    + Number(metrics.bestellscheinCompleteCount || 0) * 1600
    + Number(metrics.expectedRows || 0) * 700
    + Number(metrics.quantityCount || 0) * 350
    + Number(metrics.productCount || 0) * 250
    + Number(metrics.handlingUnitCount || 0) * 150
    + (metrics.bestellscheinOrderDetected ? 700 : 0)
    + (metrics.bestellscheinCustomerDetected ? 700 : 0)
    - Number(metrics.discardedRows || 0) * 900
    - (Array.isArray(issues) ? issues.length : 0) * 1200;
}

function selectSiBestellscheinOrientationCandidate(candidates) {
  const sorted = (Array.isArray(candidates) ? candidates : [])
    .slice()
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
  const best = sorted[0] || null;
  const second = sorted[1] || null;
  const hasSiBestellscheinSignal = sorted.some((candidate) => (
    candidate.siLike
    || (candidate.bestellscheinLike && candidate.markerScore >= 3)
    || (candidate.markerHits?.siWarehouse && candidate.markerHits?.articleNumbers && candidate.markerHits?.quantities)
  ));
  const hasClearWinner = Boolean(
    best
    && best.siLike
    && Number(best.expectedRows || 0) > 0
    && Number(best.bestellscheinCompleteCount || 0) > 0
    && Number(best.score || 0) >= SI_BESTELLSCHEIN_ORIENTATION_PROBE_MIN_SCORE
    && (!second || Number(best.score || 0) - Number(second.score || 0) >= SI_BESTELLSCHEIN_ORIENTATION_PROBE_MIN_MARGIN)
  );

  return {
    attempted: true,
    candidates: sorted,
    selectedOrientation: hasClearWinner ? best.rotation : "",
    selectedCandidate: hasClearWinner ? best : null,
    hasSiBestellscheinSignal,
    rejectReason: hasClearWinner
      ? ""
      : hasSiBestellscheinSignal
        ? "si-bestellschein-orientierung-nicht-eindeutig"
        : "kein-si-bestellschein-signal"
  };
}

async function readSiBestellscheinOrientationTieBreak(
  pdf,
  worker,
  budget,
  probe,
  scaleCandidates,
  fastScaleCandidates,
  preciseScaleCandidates,
  candidateMap,
  timings
) {
  const rotations = siBestellscheinOrientationTieBreakRotations(probe);
  const tieBreakProbe = {
    ...probe,
    orientationTieBreakAttempted: true,
    orientationTieBreakRotations: rotations,
    orientationTieBreakCandidates: [],
    orientationTieBreakRejectReason: ""
  };
  if (!rotations.length) {
    return {
      result: null,
      selectedCandidate: null,
      rotations: [],
      probe: {
        ...tieBreakProbe,
        orientationTieBreakRejectReason: "keine-geeignete-tiebreak-rotation",
        rejectReason: "keine-geeignete-tiebreak-rotation"
      }
    };
  }

  let result = null;
  let selected = null;
  const fastStepCount = Math.max(1, Number(pdf?.numPages || 0) * fastScaleCandidates.length * rotations.length);
  if (hasPickingOcrBudgetForSteps(budget, fastStepCount)) {
    const fastStarted = importNowMs();
    setImportStatus(`OCR SI-Bestellschein Tie-Break: Rotationen ${rotations.join("/")} Grad ...`, "", 30);
    result = await readPickingPdfOcrCandidateSet(pdf, fastScaleCandidates, rotations, {
      worker,
      candidateMap,
      budget,
      stage: "si-bestellschein-tiebreak",
      stageLabel: "SI-Bestellschein Tie-Break",
      stageMaxMs: SI_BESTELLSCHEIN_ORIENTATION_TIEBREAKER_MAX_MS,
      stageStartedAt: fastStarted
    });
    pushImportTiming(timings, "si-bestellschein-tiebreak", fastStarted, result);
    selected = selectSiBestellscheinOrientationTieBreakCandidate(result, rotations);
    if (selected.selectedCandidate) {
      recordSkippedOcrStep(budget, {
        stage: "si-bestellschein-tiebreak-praezision",
        reason: "parser-kandidat-akzeptiert",
        rotations
      });
      return siBestellscheinOrientationTieBreakResult(result, rotations, tieBreakProbe, selected);
    }
  } else {
    recordSkippedOcrStep(budget, {
      stage: "si-bestellschein-tiebreak",
      reason: "budget-zu-knapp",
      rotations
    });
  }

  const preciseStepCount = Math.max(1, Number(pdf?.numPages || 0) * preciseScaleCandidates.length * rotations.length);
  if (preciseScaleCandidates.length && hasPickingOcrBudgetForSteps(budget, preciseStepCount)) {
    const preciseStarted = importNowMs();
    setImportStatus(`OCR SI-Bestellschein Tie-Break Praezision: Rotationen ${rotations.join("/")} Grad ...`, "", 50);
    result = await readPickingPdfOcrCandidateSet(pdf, preciseScaleCandidates, rotations, {
      worker,
      candidateMap,
      budget,
      stage: "si-bestellschein-tiebreak-praezision",
      stageLabel: "SI-Bestellschein Tie-Break Praezision",
      stageMaxMs: SI_BESTELLSCHEIN_ORIENTATION_TIEBREAKER_MAX_MS,
      stageStartedAt: preciseStarted
    });
    pushImportTiming(timings, "si-bestellschein-tiebreak-praezision", preciseStarted, result);
    selected = selectSiBestellscheinOrientationTieBreakCandidate(result, rotations);
  } else if (preciseScaleCandidates.length) {
    recordSkippedOcrStep(budget, {
      stage: "si-bestellschein-tiebreak-praezision",
      reason: "budget-zu-knapp",
      rotations
    });
  }

  return siBestellscheinOrientationTieBreakResult(result, rotations, tieBreakProbe, selected);
}

function siBestellscheinOrientationTieBreakRotations(probe) {
  const seen = new Set();
  return (Array.isArray(probe?.candidates) ? probe.candidates : [])
    .filter((candidate) => candidate && (
      candidate.siLike
      || (candidate.bestellscheinLike && Number(candidate.markerScore || 0) >= 3)
      || (candidate.markerHits?.siWarehouse && candidate.markerHits?.articleNumbers && candidate.markerHits?.quantities)
    ))
    .map((candidate) => Number(candidate.rotation || 0))
    .filter((rotation) => {
      if (seen.has(rotation)) return false;
      seen.add(rotation);
      return true;
    })
    .slice(0, SI_BESTELLSCHEIN_ORIENTATION_TIEBREAKER_LIMIT);
}

function siBestellscheinOrientationTieBreakResult(result, rotations, probe, selected) {
  const selection = selected || selectSiBestellscheinOrientationTieBreakCandidate(result, rotations);
  const selectedCandidate = selection.selectedCandidate || null;
  const resultWithBest = result && (selectedCandidate || selection.bestCandidate)
    ? { ...result, best: selectedCandidate || selection.bestCandidate }
    : result;
  const selectedProbeCandidate = selectedCandidate
    ? (Array.isArray(probe.candidates) ? probe.candidates : []).find((candidate) => Number(candidate.rotation || 0) === Number(selectedCandidate.rotation || 0))
    : null;
  const rejectReason = selectedCandidate ? "" : selection.rejectReason || "kein-akzeptierter-si-kandidat-nach-parserbewertung";
  return {
    result: resultWithBest,
    selectedCandidate,
    rotations,
    probe: {
      ...probe,
      selectedOrientation: selectedCandidate ? selectedCandidate.rotation : "",
      selectedCandidate: selectedProbeCandidate || null,
      rejectReason,
      orientationTieBreakCandidates: selection.candidates || [],
      orientationTieBreakRejectReason: rejectReason
    }
  };
}

function selectSiBestellscheinOrientationTieBreakCandidate(result, rotations = []) {
  const rotationSet = new Set((Array.isArray(rotations) ? rotations : []).map((rotation) => Number(rotation || 0)));
  const ranked = (Array.isArray(result?.candidates) ? result.candidates : [])
    .filter((candidate) => !rotationSet.size || rotationSet.has(Number(candidate?.rotation || 0)))
    .map((candidate) => ({
      candidate,
      quality: siBestellscheinTieBreakCandidateQuality(candidate),
      accepted: isAcceptedSiBestellscheinOcrCandidate(candidate)
    }))
    .sort(compareSiBestellscheinTieBreakCandidates);
  const accepted = ranked.filter((entry) => entry.accepted);
  const first = accepted[0] || null;
  const second = accepted[1] || null;
  const selectedCandidate = first && (
    !second
    || first.quality > second.quality
    || Number(first.candidate?.score || 0) > Number(second.candidate?.score || 0)
  )
    ? first.candidate
    : null;
  return {
    selectedCandidate,
    bestCandidate: ranked[0]?.candidate || null,
    rejectReason: selectedCandidate
      ? ""
      : accepted.length
        ? "si-kandidaten-weiterhin-nicht-eindeutig"
        : "kein-akzeptierter-si-kandidat-nach-parserbewertung",
    candidates: ranked.map((entry) => siBestellscheinTieBreakCandidateDiagnostic(entry.candidate, entry.quality, entry.accepted))
  };
}

function compareSiBestellscheinTieBreakCandidates(left, right) {
  const qualityDiff = Number(right.quality || 0) - Number(left.quality || 0);
  if (qualityDiff) return qualityDiff;
  const scoreDiff = Number(right.candidate?.score || 0) - Number(left.candidate?.score || 0);
  if (scoreDiff) return scoreDiff;
  const leftMetrics = left.candidate?.metrics || {};
  const rightMetrics = right.candidate?.metrics || {};
  return Number(rightMetrics.bestellscheinCompleteCount || 0) - Number(leftMetrics.bestellscheinCompleteCount || 0)
    || Number(rightMetrics.parsedLineCount || 0) - Number(leftMetrics.parsedLineCount || 0)
    || Number(rightMetrics.quantityCount || 0) - Number(leftMetrics.quantityCount || 0)
    || Number(rightMetrics.productCount || 0) - Number(leftMetrics.productCount || 0)
    || Number(rightMetrics.unitCount || 0) - Number(leftMetrics.unitCount || 0)
    || Number(leftMetrics.issueCount || 0) - Number(rightMetrics.issueCount || 0);
}

function siBestellscheinTieBreakCandidateQuality(candidate) {
  const metrics = candidate?.metrics || {};
  return (isAcceptedSiBestellscheinOcrCandidate(candidate) ? 100000 : 0)
    + (isSiBestellscheinText(candidate?.text || "") ? 20000 : 0)
    + Number(metrics.bestellscheinCompleteCount || 0) * 12000
    + Number(metrics.parsedLineCount || 0) * 1500
    + Number(metrics.productCount || 0) * 1000
    + Number(metrics.quantityCount || 0) * 1000
    + Number(metrics.unitCount || 0) * 800
    + Number(metrics.handlingUnitCount || 0) * 300
    + (metrics.bestellscheinOrderDetected ? 5000 : 0)
    + (metrics.bestellscheinCustomerDetected ? 5000 : 0)
    + Math.min(Number(metrics.textLength || 0), 800)
    - Number(metrics.issueCount || 0) * 20000
    - Number(metrics.discardedRows || 0) * 8000
    - Number(metrics.suspiciousSourceFieldCount || 0) * 6000;
}

function siBestellscheinTieBreakCandidateDiagnostic(candidate, quality, accepted) {
  return {
    label: candidate?.label || "",
    scale: candidate?.scale || "",
    dpi: candidate?.dpi || "",
    rotation: Number(candidate?.rotation || 0),
    score: Number(candidate?.score || 0),
    tieBreakQuality: Number(quality || 0),
    accepted: accepted === true,
    rejectReason: siBestellscheinRejectReason(candidate?.text || "", candidate?.parsed || {}, candidate?.issues || []),
    orderNumber: candidate?.parsed?.orderNumber || "",
    customerName: candidate?.parsed?.customerName || "",
    metrics: candidate?.metrics || {}
  };
}

function isAcceptedSiBestellscheinOcrCandidate(candidate) {
  if (!candidate) return false;
  const parsed = candidate.parsed && Array.isArray(candidate.parsed.lines) ? candidate.parsed : { ...(candidate.parsed || {}), lines: [] };
  return isAcceptedSiBestellscheinImportCandidate({
    text: candidate.text,
    parsed,
    issues: candidate.issues || validatePickingImport(candidate.text || "", parsed)
  });
}

function attachSiBestellscheinOrientationDiagnostics(selection, probe, options = {}) {
  const parsed = selection?.parsed && Array.isArray(selection.parsed.lines) ? selection.parsed : { ...(selection?.parsed || {}), lines: [] };
  const issues = validatePickingImport(selection?.text || "", parsed);
  const rejectReason = probe.rejectReason || siBestellscheinRejectReason(selection?.text || "", parsed, issues);
  return {
    ...selection,
    imageOnlyPdf: options.imageOnlyPdf === true,
    orientationProbeAttempted: true,
    orientationProbeCandidates: probe.candidates || [],
    selectedOrientation: probe.selectedOrientation,
    orientationTieBreakAttempted: probe.orientationTieBreakAttempted === true,
    orientationTieBreakRotations: probe.orientationTieBreakRotations || [],
    orientationTieBreakCandidates: probe.orientationTieBreakCandidates || [],
    orientationTieBreakRejectReason: probe.orientationTieBreakRejectReason || "",
    siBestellscheinAccepted: isAcceptedSiBestellscheinImportCandidate({
      text: selection?.text || "",
      parsed,
      issues
    }),
    siBestellscheinRejectReason: rejectReason
  };
}

async function readPickingPdfOcrCandidateSet(pdf, scaleCandidates, rotations, options = {}) {
  const rotationCandidates = Array.isArray(rotations) && rotations.length ? rotations : OCR_ROTATIONS;
  const totalSteps = Math.max(1, pdf.numPages * scaleCandidates.length * rotationCandidates.length);
  const worker = options.worker || await createOcrWorker(options.budget?.maxSteps || totalSteps, scaleCandidates[0]?.dpi || OCR_RENDER_DPI);
  const ownsWorker = !options.worker;
  const candidateMap = options.candidateMap || new Map();
  const budget = options.budget || null;
  const stage = options.stage || "ocr";
  const stageLabel = options.stageLabel || "OCR";
  const stageStartedAt = options.stageStartedAt || importNowMs();
  const stopWhen = typeof options.stopWhen === "function" ? options.stopWhen : null;
  let stoppedResult = null;

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setImportStatus(
        `OCR ${stageLabel}: Seite ${pageNumber}/${pdf.numPages} vorbereiten ...`,
        "",
        Math.round(((pageNumber - 1) / pdf.numPages) * 100)
      );

      for (const scaleConfig of scaleCandidates) {
        const pendingRotations = rotationCandidates.filter((rotation) => {
          const entry = candidateMap.get(pickingOcrCandidateKey(scaleConfig, rotation));
          return !entry?.processedPages?.[pageNumber - 1];
        });
        if (!pendingRotations.length) {
          recordSkippedOcrStep(budget, {
            stage,
            reason: "bereits-gerechnet",
            pageNumber,
            scale: scaleConfig.scale,
            dpi: scaleConfig.dpi,
            rotations: rotationCandidates
          });
          continue;
        }

        const baseCanvas = await renderPdfPageToCanvas(pdf, pageNumber, scaleConfig.scale);
        try {
          for (const rotation of rotationCandidates) {
            const key = pickingOcrCandidateKey(scaleConfig, rotation);
            const entry = candidateMap.get(key) || {
              key,
              label: pickingOcrCandidateLabel(scaleConfig, rotation),
              scale: scaleConfig.scale,
              dpi: scaleConfig.dpi,
              rotation,
              pages: Array.from({ length: pdf.numPages }, () => ""),
              pageRawLines: Array.from({ length: pdf.numPages }, () => 0),
              processedPages: Array.from({ length: pdf.numPages }, () => false)
            };
            if (entry.processedPages[pageNumber - 1]) {
              recordSkippedOcrStep(budget, {
                stage,
                reason: "bereits-gerechnet",
                pageNumber,
                scale: scaleConfig.scale,
                dpi: scaleConfig.dpi,
                rotation
              });
              continue;
            }

            assertPickingOcrBudget(budget, {
              stage,
              stageLabel,
              stageStartedAt,
              stageMaxMs: options.stageMaxMs,
              pageNumber,
              scale: scaleConfig.scale,
              dpi: scaleConfig.dpi,
              rotation
            });
            const canvas = rotation ? rotateCanvas(baseCanvas, rotation) : baseCanvas;
            const rotationLabel = rotation ? `, Drehung ${rotation} Grad` : "";
            setOcrWorkerStage(worker, stageLabel);
            setImportStatus(
              `OCR ${stageLabel}: Seite ${pageNumber}/${pdf.numPages}, ${scaleConfig.label}${rotationLabel} ...`
            );
            await setOcrWorkerDpi(worker, scaleConfig.dpi);
            const result = await worker.recognize(canvas);
            recordCompletedOcrStep(budget, {
              stage,
              pageNumber,
              scale: scaleConfig.scale,
              dpi: scaleConfig.dpi,
              rotation
            });
            const text = result.data.text || "";
            entry.pages[pageNumber - 1] = text;
            entry.pageRawLines[pageNumber - 1] = countNonEmptyTextLines(text);
            entry.processedPages[pageNumber - 1] = true;
            candidateMap.set(key, entry);

            if (canvas !== baseCanvas) {
              canvas.width = 0;
              canvas.height = 0;
            }
            if (stopWhen) {
              const currentResult = pickingOcrCandidateSetResult(candidateMap, scaleCandidates, rotationCandidates);
              if (stopWhen(currentResult)) {
                stoppedResult = {
                  ...currentResult,
                  stoppedEarly: true,
                  stopReason: options.stopReason || "kandidat-akzeptiert"
                };
                recordRemainingOcrCandidateSetSkips(budget, {
                  stage,
                  reason: options.stopReason || "kandidat-akzeptiert",
                  pdf,
                  scaleCandidates,
                  rotations: rotationCandidates,
                  candidateMap
                });
                break;
              }
            }
          }
        } finally {
          baseCanvas.width = 0;
          baseCanvas.height = 0;
        }
        if (stoppedResult) break;
      }
      if (stoppedResult) break;
    }
  } finally {
    if (ownsWorker) await worker.terminate();
  }

  return stoppedResult || pickingOcrCandidateSetResult(candidateMap, scaleCandidates, rotationCandidates);
}

async function readLoadingSlipOcrFallbackIfNeeded(pdf, currentResult, scaleCandidates, worker, candidateMap, timings, budget) {
  if (!shouldRunLoadingSlipOcrFallback(currentResult)) {
    recordSkippedOcrStep(budget, {
      stage: "ladelistenpruefung",
      reason: "kein-ladelistenhinweis"
    });
    return {
      ...currentResult,
      loadingSlipFallbackStatus: "skipped-no-signal"
    };
  }

  const loadingSlipScales = scaleCandidates.slice(0, 1);
  if (!hasPickingOcrBudgetForSteps(budget, Math.max(1, pdf.numPages * loadingSlipScales.length * PICKING_OCR_LOADING_SLIP_ROTATIONS.length))) {
    recordSkippedOcrStep(budget, {
      stage: "ladelistenpruefung",
      reason: "budget-zu-knapp"
    });
    return {
      ...currentResult,
      loadingSlipFallbackStatus: "skipped-budget",
      loadingSlipWarning: "Ladeliste vermutet, aber OCR-Budget fuer Zusatzpruefung nicht verfuegbar."
    };
  }

  setImportStatus("OCR Ladelistenpruefung ...", "", 75);
  const stageStarted = importNowMs();
  let fallbackResult;
  try {
    fallbackResult = await readPickingPdfOcrCandidateSet(pdf, loadingSlipScales, PICKING_OCR_LOADING_SLIP_ROTATIONS, {
      worker,
      candidateMap,
      budget,
      stage: "ladelistenpruefung",
      stageLabel: "Ladelistenpruefung",
      stageMaxMs: PICKING_OCR_LOADING_SLIP_MAX_MS,
      stageStartedAt: stageStarted
    });
  } catch (error) {
    if (!isPickingOcrBudgetError(error)) throw error;
    recordSkippedOcrStep(budget, {
      stage: "ladelistenpruefung",
      reason: "budget-abbruch",
      detail: error.message
    });
    return {
      ...currentResult,
      loadingSlipFallbackStatus: "aborted-budget",
      loadingSlipWarning: "Ladeliste vermutet, aber OCR-Budget bei Zusatzpruefung erreicht."
    };
  }
  pushImportTiming(timings, "ladeliste-gezielt", stageStarted, fallbackResult);

  return {
    ...fallbackResult,
    best: currentResult.best || fallbackResult.best,
    loadingSlipFallback: true,
    loadingSlipFallbackStatus: "limited"
  };
}

function pickingOcrCandidateSetResult(candidateMap, scaleCandidates, rotationCandidates) {
  const candidates = [...candidateMap.values()]
    .map(buildPickingOcrCandidate)
    .sort((a, b) => b.score - a.score);
  const best = candidates[0] || buildPickingOcrCandidate({
    key: "empty",
    label: "empty",
    scale: "",
    dpi: "",
    rotation: 0,
    pages: [],
    pageRawLines: []
  });

  return {
    best,
    candidates,
    scaleCandidates,
    rotations: rotationCandidates
  };
}

function createPickingOcrBudget(pdf) {
  return {
    startedAt: importNowMs(),
    maxMs: PICKING_OCR_MAX_MS,
    maxSteps: PICKING_OCR_MAX_STEPS,
    pdfPages: Number(pdf?.numPages || 0),
    completedSteps: 0,
    skippedSteps: [],
    aborted: false,
    abortReason: ""
  };
}

function pickingOcrBudgetSummary(budget) {
  if (!budget) return null;
  return {
    maxMs: budget.maxMs,
    maxSteps: budget.maxSteps,
    elapsedMs: Math.max(0, Math.round(importNowMs() - Number(budget.startedAt || importNowMs()))),
    completedSteps: budget.completedSteps,
    skippedStepCount: budget.skippedSteps.length,
    pdfPages: budget.pdfPages,
    aborted: budget.aborted === true,
    abortReason: budget.abortReason || ""
  };
}

function hasPickingOcrBudgetForSteps(budget, steps) {
  if (!budget) return true;
  return Number(budget.completedSteps || 0) + Number(steps || 0) <= Number(budget.maxSteps || 0)
    && importNowMs() - Number(budget.startedAt || importNowMs()) < Number(budget.maxMs || 0);
}

function assertPickingOcrBudget(budget, context = {}) {
  if (!budget) return;
  const now = importNowMs();
  const elapsedMs = now - Number(budget.startedAt || now);
  const stageElapsedMs = now - Number(context.stageStartedAt || now);
  if (elapsedMs >= Number(budget.maxMs || 0)) {
    throw pickingOcrBudgetError(`OCR-Budget ueberschritten: ${Math.round(elapsedMs)} ms Gesamtzeit.`);
  }
  if (Number(context.stageMaxMs || 0) > 0 && stageElapsedMs >= Number(context.stageMaxMs || 0)) {
    throw pickingOcrBudgetError(`OCR-Budget ueberschritten: ${context.stageLabel || context.stage || "Stufe"} nach ${Math.round(stageElapsedMs)} ms.`);
  }
  if (Number(budget.completedSteps || 0) >= Number(budget.maxSteps || 0)) {
    throw pickingOcrBudgetError(`OCR-Budget ueberschritten: ${budget.completedSteps}/${budget.maxSteps} Schritte.`);
  }
}

function pickingOcrBudgetError(message) {
  const error = new Error(message || "OCR-Budget ueberschritten.");
  error.name = "PickingOcrBudgetError";
  return error;
}

function isPickingOcrBudgetError(error) {
  return error?.name === "PickingOcrBudgetError";
}

function recordCompletedOcrStep(budget, context = {}) {
  if (!budget) return;
  budget.completedSteps += 1;
  budget.lastStage = context.stage || budget.lastStage || "";
}

function recordSkippedOcrStep(budget, context = {}) {
  if (!budget) return;
  if (budget.skippedSteps.length >= 80) return;
  budget.skippedSteps.push({
    stage: context.stage || "",
    reason: context.reason || "",
    detail: context.detail || "",
    pageNumber: context.pageNumber || "",
    scale: context.scale || "",
    dpi: context.dpi || "",
    rotation: context.rotation ?? "",
    rotations: Array.isArray(context.rotations) ? context.rotations : []
  });
}

function recordRemainingOcrCandidateSetSkips(budget, context = {}) {
  if (!budget) return;
  const pdfPages = Number(context.pdf?.numPages || 0);
  const scaleCandidates = Array.isArray(context.scaleCandidates) ? context.scaleCandidates : [];
  const rotations = Array.isArray(context.rotations) ? context.rotations : [];
  const candidateMap = context.candidateMap || new Map();
  for (let pageNumber = 1; pageNumber <= pdfPages; pageNumber += 1) {
    for (const scaleConfig of scaleCandidates) {
      for (const rotation of rotations) {
        const entry = candidateMap.get(pickingOcrCandidateKey(scaleConfig, rotation));
        if (entry?.processedPages?.[pageNumber - 1]) continue;
        recordSkippedOcrStep(budget, {
          stage: context.stage || "",
          reason: context.reason || "kandidat-akzeptiert",
          pageNumber,
          scale: scaleConfig.scale,
          dpi: scaleConfig.dpi,
          rotation
        });
      }
    }
  }
}

function setOcrWorkerStage(worker, stageLabel) {
  if (worker?.__hlogistikOcrProgress) {
    worker.__hlogistikOcrProgress.stageLabel = stageLabel || "OCR";
  }
}

function shouldRunPickingRotationFallback(result) {
  const best = result?.best;
  const metrics = best?.metrics || {};
  if (!best) return true;
  if (Number(metrics.rawLineCount || 0) <= 2) return true;
  if (Number(metrics.parsedLineCount || 0) === 0) return true;
  if (Number(metrics.expectedRows || 0) > 0 && Number(metrics.parsedLineCount || 0) === 0) return true;
  if (Number(metrics.discardedRows || 0) > 0 && Number(metrics.parsedLineCount || 0) < Number(metrics.expectedRows || 0) / 2) return true;
  return false;
}

function pickingRotationFallbackRotations(result) {
  const best = result?.best;
  const metrics = best?.metrics || {};
  if (Number(metrics.rawLineCount || 0) <= 2 || Number(metrics.parsedLineCount || 0) === 0) {
    return PICKING_OCR_ROTATION_FALLBACK_ROTATIONS;
  }
  return PICKING_OCR_ROTATION_FALLBACK_ROTATIONS.slice(0, 2);
}

function shouldRunLoadingSlipOcrFallback(result) {
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  if (collectLoadingSlipLinesFromOcrCandidates(candidates).lines.length) return false;

  const best = result?.best;
  if (!best || Number(best.rotation || 0) !== 0) return false;
  if (!isCleanUprightPickingOcrCandidate(best)) return false;
  if (best.metrics?.bestellscheinLike) return false;

  // A complete first picking page can otherwise hide a rotated loading-slip
  // page: the upright OCR result is accepted before that page gets a rotated pass.
  if (hasUnrecognizedUprightOcrPage(best)) return true;

  const source = String(best.text || "");
  if (isLoadingSlipStartLine(source) || isLoadingSlipHeaderBarcodeLine(source)) return true;

  const rawLineCount = Number(best.metrics?.rawLineCount || 0);
  const parsedLineCount = Number(best.metrics?.parsedLineCount || 0);
  const expectedRows = Number(best.metrics?.expectedRows || 0);
  return rawLineCount - Math.max(parsedLineCount, expectedRows) >= 8;
}

function hasUnrecognizedUprightOcrPage(candidate) {
  const pages = Array.isArray(candidate?.pages) ? candidate.pages : [];
  if (pages.length < 2) return false;

  return pages.some((page) => {
    const source = String(page || "").trim();
    if (!source) return true;
    const parsed = parseOrderText(source);
    return !Array.isArray(parsed?.lines) || parsed.lines.length === 0;
  });
}

function isFastAcceptedPickingOcrCandidate(candidate) {
  return isUsablePickingOcrSelection(candidate)
    && hasCompleteUprightPickingOcrCoverage(candidate)
    && Number(candidate?.score || 0) >= PICKING_OCR_FAST_ACCEPT_SCORE
    && Number(candidate?.metrics?.issueCount || 0) === 0
    && Number(candidate?.metrics?.discardedRows || 0) === 0
    && Number(candidate?.metrics?.suspiciousSourceFieldCount || 0) === 0;
}

function isStableUprightPickingOcrResult(result, scaleCandidates = []) {
  const candidates = (Array.isArray(result?.candidates) ? result.candidates : [])
    .filter((candidate) => Number(candidate?.rotation || 0) === 0);
  const requiredCleanCandidates = Math.min(2, Math.max(1, Array.isArray(scaleCandidates) ? scaleCandidates.length : 1));
  const cleanCandidates = candidates.filter(isCleanUprightPickingOcrCandidate);
  const best = result?.best;

  if (isFastAcceptedPickingOcrCandidate(best)) return true;
  if (!isCleanUprightPickingOcrCandidate(best) || cleanCandidates.length < requiredCleanCandidates) return false;

  const bestSignature = pickingOcrCompletenessSignature(best);
  if (!bestSignature) return false;
  return cleanCandidates.filter((candidate) => pickingOcrCompletenessSignature(candidate) === bestSignature).length >= requiredCleanCandidates;
}

function isCleanUprightPickingOcrCandidate(candidate) {
  const metrics = candidate?.metrics || {};
  return isUsablePickingOcrSelection(candidate)
    && Number(metrics.issueCount || 0) === 0
    && Number(metrics.discardedRows || 0) === 0
    && Number(metrics.suspiciousSourceFieldCount || 0) === 0
    && hasCompleteUprightPickingOcrCoverage(candidate);
}

function hasCompleteUprightPickingOcrCoverage(candidate) {
  const metrics = candidate?.metrics || {};
  const parsedLineCount = Number(metrics.parsedLineCount || 0);
  if (!parsedLineCount) return false;

  if (metrics.bestellscheinLike) {
    const completeCount = Number(metrics.bestellscheinCompleteCount || 0);
    return completeCount > 0
      && completeCount === parsedLineCount
      && Number(metrics.handlingUnitCount || 0) >= completeCount;
  }

  const completeCount = Number(metrics.completeRequiredCount || 0);
  return completeCount > 0 && completeCount === parsedLineCount;
}

function pickingOcrCompletenessSignature(candidate) {
  const metrics = candidate?.metrics || {};
  const parsedLineCount = Number(metrics.parsedLineCount || 0);
  if (!parsedLineCount) return "";
  const completeCount = metrics.bestellscheinLike
    ? Number(metrics.bestellscheinCompleteCount || 0)
    : Number(metrics.completeRequiredCount || 0);
  return [
    metrics.bestellscheinLike ? "bestellschein" : "lageraufgabe",
    parsedLineCount,
    completeCount,
    Number(metrics.expectedRows || 0),
    Number(metrics.handlingUnitCount || 0),
    Number(metrics.fromBinCount || 0),
    Number(metrics.toBinCount || 0)
  ].join("|");
}

function importNowMs() {
  return window.performance?.now ? window.performance.now() : Date.now();
}

function pushImportTiming(timings, label, startedAt, result = null) {
  const endedAt = importNowMs();
  if (Array.isArray(timings)) {
    timings.push({
      label,
      ms: Math.max(0, Math.round(endedAt - Number(startedAt || endedAt))),
      best: result?.best ? pickingOcrCandidateDiagnostic(result.best) : null
    });
  }
  return endedAt;
}

function pickingOcrSelectionResult(result, allScaleCandidates, rotations, timings = [], budget = null, stage = "") {
  const best = result.best;
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const scaleCandidates = Array.isArray(allScaleCandidates) && allScaleCandidates.length
    ? allScaleCandidates
    : result.scaleCandidates || [];
  const rotationCandidates = Array.isArray(rotations) && rotations.length ? rotations : result.rotations || [];
  const loadingSlipResult = collectLoadingSlipLinesFromOcrCandidates(candidates);
  const parsed = appendLoadingSlipLinesToParsed(best.parsed, loadingSlipResult.lines);
  return {
    text: best.text,
    parsed,
    source: "ocr-candidate",
    selectedCandidate: pickingOcrCandidateDiagnostic(best),
    ocrCandidates: candidates.map(pickingOcrCandidateDiagnostic),
    ocrScales: scaleCandidates.map((candidate) => candidate.scale),
    ocrDpis: scaleCandidates.map((candidate) => candidate.dpi),
    ocrRotations: [...rotationCandidates],
    ocrScale: best.scale,
    ocrDpi: best.dpi,
    ocrRotation: best.rotation,
    qualityScore: best.score,
    minimumQualityScore: PICKING_OCR_MINIMUM_SCORE,
    qualityAccepted: isUsablePickingOcrSelection(best),
    ocrTimings: Array.isArray(timings) ? timings : [],
    ocrStepCount: budget?.completedSteps || 0,
    ocrComputedSteps: budget?.completedSteps || 0,
    ocrSkippedSteps: Array.isArray(budget?.skippedSteps) ? budget.skippedSteps : [],
    ocrBudget: pickingOcrBudgetSummary(budget),
    ocrStage: stage || budget?.lastStage || "",
    ocrAbortReason: budget?.abortReason || "",
    loadingSlipLines: loadingSlipResult.lines,
    loadingSlipCandidates: loadingSlipResult.diagnostics,
    loadingSlipExpected: loadingSlipResult.expected,
    loadingSlipFallback: result.loadingSlipFallback === true,
    loadingSlipFallbackStatus: result.loadingSlipFallbackStatus || "",
    loadingSlipWarning: result.loadingSlipWarning || ""
  };
}

function pickingOcrSelectionWithoutFromBinCellRecheck(_pdf, _worker, result, allScaleCandidates, rotations, timings = [], budget = null, stage = "") {
  const selection = pickingOcrSelectionResult(result, allScaleCandidates, rotations, timings, budget, stage);
  selection.fromBinRechecks = [];
  return selection;
}

/* eslint-disable no-unused-vars */
// Legacy Zell-Recheck-Helfer bleiben unaufgerufen; der produktive Importpfad nutzt nur die regelbasierte Pruefung.
async function readPickingFromBinCellRechecks(pdf, candidate, worker) {
  return [];
}

async function readPickingFromBinCellRecheck(pdf, worker, candidate, line, index, rawLine) {
  const fields = pickingFromBinRecheckFields(line);
  const base = basePickingFromBinRecheck(fields, index, {
    attempted: false,
    method: "disabled"
  });
  return {
    ...base,
    reason: "Von-Lagerplatz-Zell-Recheck durch Richtlinie deaktiviert."
  };
}

function pickingFromBinRecheckFields(line) {
  return {
    warehouseOrder: String(line?.warehouseOrder || "").trim(),
    fromHandlingUnit: String(line?.fromHandlingUnit || "").trim(),
    product: String(line?.product || "").trim(),
    targetQty: String(line?.targetQty || "").trim(),
    fromBin: String(line?.fromBin || "").trim()
  };
}

function basePickingFromBinRecheck(fields, index, overrides = {}) {
  return {
    position: index + 1,
    tableRowKey: [fields.warehouseOrder, fields.fromHandlingUnit, fields.product].filter(Boolean).join(" | "),
    warehouseOrder: fields.warehouseOrder,
    fromHandlingUnit: fields.fromHandlingUnit,
    product: fields.product,
    targetQty: fields.targetQty,
    rawValue: fields.fromBin,
    method: overrides.method || "",
    attempted: overrides.attempted === true,
    candidates: Array.isArray(overrides.candidates) ? overrides.candidates : [],
    suggestion: overrides.suggestion || "",
    confidence: Number(overrides.confidence || 0),
    autoApplied: false,
    reason: overrides.reason || "",
    visualAttempted: overrides.visualAttempted === true,
    visualSource: overrides.visualSource || "",
    visualCandidates: Array.isArray(overrides.visualCandidates) ? overrides.visualCandidates : [],
    visualBestCandidate: overrides.visualBestCandidate || "",
    visualConfidence: Number(overrides.visualConfidence || 0),
    visualReason: overrides.visualReason || "",
    visualAutoApplied: false
  };
}

function rawSegmentPickingFromBinRecheck(base, rawLine, reason) {
  const candidates = pickingFromBinRecheckCandidatesFromText(rawLine?.text || "", base.rawValue, {
    method: "raw-segment",
    source: "raw-segment",
    confidence: 0,
    allowTail: false
  });
  return choosePickingFromBinRecheckSuggestion({
    ...base,
    method: "raw-segment",
    visualSource: base.visualSource || "raw-segment",
    visualReason: base.visualReason || reason || "Raw-Segment-Fallback ohne visuellen Zell-Crop.",
    candidates,
    reason
  }, base.rawValue);
}

function pickingOcrRawLineEntries(candidate) {
  const pages = Array.isArray(candidate?.pages) ? candidate.pages : [];
  const result = [];
  pages.forEach((pageText, pageIndex) => {
    String(pageText || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((text, lineIndex) => {
        result.push({
          text,
          pageNumber: pageIndex + 1,
          localLineIndex: lineIndex,
          globalLineIndex: result.length,
          pageRawLineCount: countNonEmptyTextLines(pageText)
        });
      });
  });
  return result;
}

function findPickingOcrRawLineForPosition(rawLines, line, fallbackIndex) {
  const scored = (Array.isArray(rawLines) ? rawLines : [])
    .map((rawLine) => ({
      rawLine,
      score: pickingOcrRawLineMatchScore(line, rawLine.text)
    }))
    .sort((left, right) => right.score - left.score);
  if (scored.length && scored[0].score >= 5) return scored[0].rawLine;
  return rawLines[fallbackIndex] || null;
}

function pickingOcrRawLineMatchScore(line, rawText) {
  const fields = pickingFromBinRecheckFields(line);
  let score = 0;
  [
    ["warehouseOrder", 4],
    ["fromHandlingUnit", 4],
    ["fromBin", 5],
    ["product", 4],
    ["targetQty", 2]
  ].forEach(([field, weight]) => {
    if (compactOcrFieldValue(fields[field]) && compactOcrFieldValue(rawText).includes(compactOcrFieldValue(fields[field]))) {
      score += weight;
    }
  });
  return score;
}

async function createPickingFromBinRecheckCrop(pdf, worker, candidate, line, rawLine) {
  const pageNumber = Number(rawLine?.pageNumber || 0);
  if (!pageNumber) return { canvas: null, reason: "Rohsegment enthaelt keine Seitenzuordnung." };
  const scale = Number(candidate?.scale || OCR_PRECISE_RENDER_SCALE) || OCR_PRECISE_RENDER_SCALE;
  const dpi = String(candidate?.dpi || OCR_PRECISE_RENDER_DPI);
  const pdfTextCell = await findPickingPdfTextCellRecheck(pdf, line, scale, pageNumber);
  const baseCanvas = await renderPdfPageToCanvas(pdf, pageNumber, scale);
  try {
    if (pdfTextCell.bbox) {
      return {
        canvas: cropCanvas(baseCanvas, pdfTextCell.bbox, 10),
        candidates: pdfTextCell.candidates,
        method: "pdfjs-cell-crop",
        visualSource: "pdf-crop",
        dpi,
        reason: "Von-Lagerplatz-Zelle ueber PDF.js-Textkoordinaten ausgeschnitten."
      };
    }

    const visualCrop = await createPickingFromBinVisualOcrCrop(baseCanvas, worker, line, rawLine, dpi, pdfTextCell.reason);
    if (visualCrop.canvas || (Array.isArray(visualCrop.candidates) && visualCrop.candidates.length)) return visualCrop;

    return {
      canvas: null,
      candidates: pdfTextCell.candidates || [],
      method: "visual-cell-recheck",
      visualSource: visualCrop.visualSource || "",
      dpi,
      reason: visualCrop.reason || pdfTextCell.reason || "Keine visuellen OCR-Zellkoordinaten verfuegbar."
    };
  } finally {
    baseCanvas.width = 0;
    baseCanvas.height = 0;
  }
}

function parseTesseractTsvRows(tsv) {
  const lines = String(tsv || "").replace(/\r/g, "\n").split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");
  const indexOf = (name) => headers.indexOf(name);
  const textIndex = indexOf("text");
  return lines.slice(1).map((line) => {
    const parts = line.split("\t");
    return {
      level: Number(parts[indexOf("level")] || 0),
      blockNum: Number(parts[indexOf("block_num")] || 0),
      parNum: Number(parts[indexOf("par_num")] || 0),
      lineNum: Number(parts[indexOf("line_num")] || 0),
      left: Number(parts[indexOf("left")] || 0),
      top: Number(parts[indexOf("top")] || 0),
      width: Number(parts[indexOf("width")] || 0),
      height: Number(parts[indexOf("height")] || 0),
      confidence: Number(parts[indexOf("conf")] || 0),
      text: textIndex >= 0 ? parts.slice(textIndex).join("\t").trim() : ""
    };
  }).filter((row) => Number.isFinite(row.left) && Number.isFinite(row.top));
}

async function findPickingPdfTextCellRecheck(pdf, line, scale, preferredPageNumber = 0) {
  const candidates = [];
  const pages = preferredPageNumber
    ? [preferredPageNumber]
    : Array.from({ length: Number(pdf?.numPages || 0) }, (_, index) => index + 1);
  for (const pageNumber of pages) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const content = await page.getTextContent();
    const rows = groupPdfTextItemsByRow(pdfTextItemsWithBboxes(content.items, viewport));
    const row = rows
      .map((entry) => ({
        entry,
        score: pickingOcrRawLineMatchScore(line, entry.text)
      }))
      .sort((left, right) => right.score - left.score)[0];
    if (!row || row.score < 5) continue;

    const rowCandidates = pickingFromBinRecheckCandidatesFromText(row.entry.text, line.fromBin, {
      method: "pdfjs-text-row",
      source: "pdfjs-text",
      confidence: 95
    });
    candidates.push(...rowCandidates);

    const bbox = pdfTextFromBinBbox(row.entry, line.fromBin);
    return {
      pageNumber,
      candidates,
      bbox,
      reason: bbox
        ? "PDF.js-Textposition fuer Von-Lagerplatz gefunden."
        : "PDF.js-Zeile gefunden, aber keine Zellbox fuer den Von-Lagerplatz."
    };
  }
  return {
    pageNumber: 0,
    candidates,
    bbox: null,
    reason: "Keine passende PDF.js-Textzeile fuer den Von-Lagerplatz gefunden."
  };
}

async function createPickingFromBinVisualOcrCrop(baseCanvas, worker, line, rawLine, dpi, previousReason = "") {
  if (!baseCanvas || !worker) {
    return {
      canvas: null,
      candidates: [],
      method: "visual-cell-recheck",
      visualSource: "",
      dpi,
      reason: "Kein Seitenbild oder OCR-Worker fuer visuellen Zell-Recheck verfuegbar."
    };
  }

  const visualRows = pickingVisualTextRows(baseCanvas);
  const rowCandidates = pickingVisualRowCandidates(visualRows, rawLine);
  if (!rowCandidates.length) {
    return {
      canvas: null,
      candidates: [],
      method: "visual-cell-recheck",
      visualSource: "",
      dpi,
      reason: [previousReason, "Keine visuellen Zeilen-BBoxes im Seitenbild gefunden."].filter(Boolean).join(" ")
    };
  }

  const rowResults = rowCandidates
    .map((rowCandidate) => {
      const rowBbox = paddedCanvasBbox(baseCanvas, rowCandidate.row.bbox, 24, 10);
      const cell = pickingVisualFromBinCellBbox(baseCanvas, rowBbox);
      return {
        rowBbox,
        cell,
        distance: rowCandidate.distance,
        clusterCount: cell?.clusterCount || 0
      };
    })
    .filter((entry) => entry.cell)
    .sort((left, right) => {
      if (right.clusterCount !== left.clusterCount) return right.clusterCount - left.clusterCount;
      return left.distance - right.distance;
    });

  const best = rowResults[0] || null;
  if (!best) {
    return {
      canvas: null,
      candidates: [],
      method: "visual-row-bbox",
      visualSource: "line-bbox",
      dpi,
      reason: [
        previousReason,
        "Visueller Zeilen-BBox-Recheck fand keine plausible Von-Lagerplatz-Spaltengruppe."
      ].filter(Boolean).join(" ")
    };
  }

  return {
    canvas: cropCanvas(baseCanvas, best.cell.bbox, 8),
    candidates: [],
    method: "ocr-line-bbox-crop",
    visualSource: "line-bbox",
    dpi,
    reason: [
      previousReason,
      "Von-Lagerplatz-Zelle ueber visuelle Zeilen-BBox und dunkle Spaltencluster ausgeschnitten."
    ].filter(Boolean).join(" ")
  };
}

function pickingVisualTextRows(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return [];
  const image = context.getImageData(0, 0, width, height);
  const xStep = Math.max(2, Math.floor(width / 900));
  const yStep = 2;
  const minDark = Math.max(3, Math.floor(width / (xStep * 170)));
  const darkRows = [];
  for (let y = 0; y < height; y += yStep) {
    let dark = 0;
    for (let x = 0; x < width; x += xStep) {
      const offset = (y * width + x) * 4;
      const alpha = image.data[offset + 3];
      if (alpha < 20) continue;
      const gray = image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114;
      if (gray < 175) dark += 1;
    }
    if (dark >= minDark) darkRows.push(y);
  }

  const bands = [];
  darkRows.forEach((y) => {
    const last = bands[bands.length - 1];
    if (last && y - last.y1 <= 6) {
      last.y1 = y;
    } else {
      bands.push({ y0: y, y1: y });
    }
  });

  return bands
    .map((band) => ({
      bbox: {
        x0: 0,
        y0: Math.max(0, band.y0 - 2),
        x1: width,
        y1: Math.min(height, band.y1 + yStep + 2)
      }
    }))
    .filter((row) => {
      const rowHeight = row.bbox.y1 - row.bbox.y0;
      return rowHeight >= 5 && rowHeight <= PICKING_FROM_BIN_VISUAL_RECHECK_MAX_ROW_HEIGHT;
    });
}

function pickingVisualRowCandidates(rows, rawLine) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  if (!normalizedRows.length) return [];
  const lineIndex = Number(rawLine?.localLineIndex || 0);
  const lineCount = Math.max(1, Number(rawLine?.pageRawLineCount || normalizedRows.length));
  const expectedIndex = Math.max(
    0,
    Math.min(normalizedRows.length - 1, Math.round((lineIndex / Math.max(1, lineCount - 1)) * (normalizedRows.length - 1)))
  );
  const radius = Math.max(PICKING_FROM_BIN_VISUAL_RECHECK_ROW_RADIUS, Math.ceil(normalizedRows.length * 0.06));
  return normalizedRows
    .map((row, index) => ({
      row,
      index,
      distance: Math.abs(index - expectedIndex)
    }))
    .filter((entry) => entry.distance <= radius)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, Math.max(3, PICKING_FROM_BIN_VISUAL_RECHECK_ROW_RADIUS * 2 + 1));
}

function pickingVisualFromBinCellBbox(canvas, rowBbox) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const bbox = paddedCanvasBbox(canvas, rowBbox, 0, 0);
  const width = Math.max(1, Math.ceil(bbox.x1 - bbox.x0));
  const height = Math.max(1, Math.ceil(bbox.y1 - bbox.y0));
  const image = context.getImageData(Math.floor(bbox.x0), Math.floor(bbox.y0), width, height);
  const darkColumns = [];
  const minDark = Math.max(1, Math.floor(height / 12));
  for (let x = 0; x < width; x += 1) {
    let dark = 0;
    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * 4;
      const alpha = image.data[offset + 3];
      if (alpha < 20) continue;
      const gray = image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114;
      if (gray < 165) dark += 1;
    }
    if (dark >= minDark) darkColumns.push(x);
  }

  const columnBands = [];
  darkColumns.forEach((x) => {
    const last = columnBands[columnBands.length - 1];
    if (last && x - last.x1 <= 3) {
      last.x1 = x;
    } else {
      columnBands.push({ x0: x, x1: x });
    }
  });
  const clusters = [];
  columnBands.forEach((band) => {
    const last = clusters[clusters.length - 1];
    if (last && band.x0 - last.x1 <= 16) {
      last.x1 = band.x1;
    } else {
      clusters.push({ ...band });
    }
  });

  const substantial = clusters
    .map((cluster) => ({
      x0: bbox.x0 + cluster.x0,
      x1: bbox.x0 + cluster.x1,
      width: cluster.x1 - cluster.x0 + 1
    }))
    .filter((cluster) => cluster.width >= 14);
  if (substantial.length < 4) return null;

  const fromBinCluster = substantial[2];
  return {
    bbox: {
      x0: fromBinCluster.x0,
      y0: bbox.y0,
      x1: fromBinCluster.x1,
      y1: bbox.y1
    },
    source: "line-bbox",
    clusterCount: substantial.length
  };
}

function paddedCanvasBbox(canvas, bbox, paddingX = 0, paddingY = paddingX) {
  return {
    x0: Math.max(0, Math.floor(Number(bbox?.x0 || 0) - paddingX)),
    y0: Math.max(0, Math.floor(Number(bbox?.y0 || 0) - paddingY)),
    x1: Math.min(canvas.width, Math.ceil(Number(bbox?.x1 || canvas.width || 0) + paddingX)),
    y1: Math.min(canvas.height, Math.ceil(Number(bbox?.y1 || canvas.height || 0) + paddingY))
  };
}

function pdfTextItemsWithBboxes(items, viewport) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const text = String(item && item.str || "").trim();
      if (!text) return null;
      const transform = window.pdfjsLib?.Util?.transform
        ? window.pdfjsLib.Util.transform(viewport.transform, item.transform)
        : item.transform;
      const x = Number(transform && transform[4] || 0);
      const y = Number(transform && transform[5] || 0);
      const width = Math.max(1, Math.abs(Number(item.width || 0) * Number(viewport.scale || 1)));
      const height = Math.max(1, Math.abs(Number(transform && transform[3] || item.height || 0)));
      return {
        text,
        x,
        y,
        bbox: {
          x0: x,
          y0: y - height,
          x1: x + width,
          y1: y + Math.max(2, height * 0.25)
        }
      };
    })
    .filter(Boolean);
}

function groupPdfTextItemsByRow(items) {
  const rows = [];
  (Array.isArray(items) ? items : [])
    .sort((left, right) => {
      if (Math.abs(left.y - right.y) > 3) return left.y - right.y;
      return left.x - right.x;
    })
    .forEach((item) => {
      let row = rows.find((entry) => Math.abs(entry.y - item.y) <= 4);
      if (!row) {
        row = { y: item.y, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    });
  return rows.map((row) => {
    const sorted = row.items.sort((left, right) => left.x - right.x);
    return {
      text: sorted.map((item) => item.text).join(" "),
      items: sorted,
      bbox: unionBbox(sorted.map((item) => item.bbox))
    };
  });
}

function pdfTextFromBinBbox(row, rawValue) {
  const rawCompact = compactOcrFieldValue(rawValue);
  const direct = (row.items || []).find((item) => compactOcrFieldValue(item.text) === rawCompact);
  if (direct) return direct.bbox;

  for (let start = 0; start < (row.items || []).length; start += 1) {
    let text = "";
    const boxes = [];
    for (let end = start; end < Math.min(row.items.length, start + 4); end += 1) {
      text += row.items[end].text;
      boxes.push(row.items[end].bbox);
      if (compactOcrFieldValue(text) === rawCompact) return unionBbox(boxes);
    }
  }
  return null;
}

async function recognizePickingFromBinRecheckCrop(worker, crop, rawValue, dpi) {
  const variants = createPickingFromBinRecheckVariants(crop);
  const observations = [];
  setOcrWorkerStage(worker, "Zell-Recheck");
  await setOcrWorkerDpi(worker, dpi || OCR_PRECISE_RENDER_DPI);
  await worker.setParameters({
    preserve_interword_spaces: "0",
    tessedit_char_whitelist: PICKING_FROM_BIN_RECHECK_WHITELIST,
    tessedit_pageseg_mode: window.Tesseract.PSM?.SINGLE_WORD || "8"
  });
  try {
    for (const variant of variants) {
      const result = await worker.recognize(variant.canvas, {}, { text: true, tsv: true });
      observations.push(...pickingFromBinRecheckCandidatesFromText(result?.data?.text || "", rawValue, {
        method: variant.label,
        source: "ocr-crop",
        confidence: tesseractTextConfidence(result?.data?.tsv, result?.data?.confidence)
      }));
    }
  } finally {
    variants.forEach((variant) => {
      if (variant.canvas !== crop) {
        variant.canvas.width = 0;
        variant.canvas.height = 0;
      }
    });
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_char_whitelist: "",
      tessedit_pageseg_mode: window.Tesseract.PSM?.AUTO || "3"
    });
  }
  return observations;
}

function createPickingFromBinRecheckVariants(crop) {
  return [
    { label: "crop-normal", canvas: crop },
    { label: "crop-threshold", canvas: thresholdCanvas(crop) },
    { label: "crop-upscale", canvas: scaleCanvas(crop, 2) }
  ];
}

function cropCanvas(sourceCanvas, bbox, padding = 0) {
  const left = Math.max(0, Math.floor(Number(bbox.x0 || 0) - padding));
  const top = Math.max(0, Math.floor(Number(bbox.y0 || 0) - padding));
  const right = Math.min(sourceCanvas.width, Math.ceil(Number(bbox.x1 || 0) + padding));
  const bottom = Math.min(sourceCanvas.height, Math.ceil(Number(bbox.y1 || 0) + padding));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = Math.max(1, right - left);
  canvas.height = Math.max(1, bottom - top);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sourceCanvas, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function isReasonablePickingFromBinRecheckCrop(canvas) {
  const width = Number(canvas?.width || 0);
  const height = Number(canvas?.height || 0);
  return width > 0
    && height > 0
    && width <= PICKING_FROM_BIN_RECHECK_MAX_CROP_WIDTH
    && height <= PICKING_FROM_BIN_RECHECK_MAX_CROP_HEIGHT
    && width * height <= PICKING_FROM_BIN_RECHECK_MAX_CROP_PIXELS;
}

function thresholdCanvas(sourceCanvas) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  context.drawImage(sourceCanvas, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const gray = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114;
    const value = gray < 185 ? 0 : 255;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function scaleCanvas(sourceCanvas, factor = 2) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = Math.max(1, Math.ceil(sourceCanvas.width * factor));
  canvas.height = Math.max(1, Math.ceil(sourceCanvas.height * factor));
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function pickingFromBinRecheckCandidatesFromText(text, rawValue, info = {}) {
  const candidates = [];
  const source = String(text || "").toUpperCase();
  const tokens = uniqueStrings(
    source
      .replace(/[^\w-]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
  tokens.concat([source.replace(/[^A-Z0-9-]+/g, "")]).forEach((token) => {
    normalizePickingFromBinRecheckToken(token, rawValue, info).forEach((value) => {
      if (!value) return;
      const shape = pickingFromBinShapeDiagnostic(value);
      candidates.push({
        value,
        rawText: String(text || "").trim(),
        source: info.source || "",
        method: info.method || "",
        confidence: Number.isFinite(Number(info.confidence)) ? Math.max(0, Math.round(Number(info.confidence))) : 0,
        valid: isValidPickingFromBinRecheckCandidate(value),
        shapeStatus: shape.status,
        autoApplied: false
      });
    });
  });
  return uniqueRecheckCandidates(candidates);
}

function normalizePickingFromBinRecheckToken(token, rawValue, info = {}) {
  const compact = String(token || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[â€â€‘â€’â€“â€”]/g, "-")
    .replace(/[^A-Z0-9-]/g, "");
  const values = [];
  const full = compact.match(/(?:002|022)-?H\d{1,2}-?(?:S[A-Z0-9]{4}|R\d{1,3})/g) || [];
  full.forEach((value) => {
    const match = value.match(/^((?:002|022))-?H(\d{1,2})-?([A-Z0-9]+)$/);
    if (match) values.push(`${match[1]}-H${match[2]}-${match[3]}`);
  });

  const rawPrefix = String(rawValue || "").toUpperCase().match(/^((?:002|022)-H\d{1,2})-/);
  if (info.allowTail !== false && rawPrefix && /^S[A-Z0-9]{4}$/.test(compact)) {
    values.push(`${rawPrefix[1]}-${compact}`);
  }
  return uniqueStrings(values);
}

function isValidPickingFromBinRecheckCandidate(value) {
  return /^002-H3-S[O-Z](?:[1-9]|1[0-2])[A-D][1-3]$/i.test(String(value || ""));
}

function uniqueRecheckCandidates(candidates) {
  const map = new Map();
  candidates.forEach((candidate) => {
    const key = `${candidate.value}|${candidate.method}|${candidate.source}`;
    if (!map.has(key) || Number(candidate.confidence || 0) > Number(map.get(key).confidence || 0)) {
      map.set(key, candidate);
    }
  });
  return [...map.values()];
}

function choosePickingFromBinRecheckSuggestion(recheck, rawValue) {
  const grouped = groupPickingFromBinRecheckCandidates(recheck.candidates);
  const visualGrouped = groupPickingFromBinRecheckCandidates(
    Array.isArray(recheck.visualCandidates) ? recheck.visualCandidates : []
  );
  const valid = grouped
    .filter((candidate) => candidate.valid && candidate.value !== rawValue)
    .sort((left, right) => {
      if (right.occurrences !== left.occurrences) return right.occurrences - left.occurrences;
      return right.confidence - left.confidence;
    });
  const best = valid[0] || null;
  const uniqueValidValues = uniqueStrings(valid.map((candidate) => candidate.value));
  const confident = best && (best.confidence >= PICKING_FROM_BIN_RECHECK_MIN_CONFIDENCE || best.occurrences >= 2);
  const suggestion = uniqueValidValues.length === 1 && confident ? best.value : "";
  const visualBest = visualGrouped
    .slice()
    .sort((left, right) => {
      if (right.valid !== left.valid) return right.valid ? 1 : -1;
      if (right.occurrences !== left.occurrences) return right.occurrences - left.occurrences;
      return right.confidence - left.confidence;
    })[0] || null;
  return {
    ...recheck,
    candidates: grouped,
    suggestion,
    confidence: suggestion ? best.confidence : 0,
    autoApplied: false,
    visualCandidates: visualGrouped,
    visualBestCandidate: visualBest ? visualBest.value : "",
    visualConfidence: visualBest ? visualBest.confidence : 0,
    visualAutoApplied: false,
    visualReason: recheck.visualReason || recheck.reason || "",
    reason: suggestion
      ? `${recheck.reason} Sicherer Diagnosevorschlag aus gezieltem Cell-Recheck.`
      : `${recheck.reason} Kein eindeutiger gueltiger Recheck-Vorschlag.`
  };
}

function groupPickingFromBinRecheckCandidates(candidates) {
  const map = new Map();
  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    if (!candidate.value) return;
    const existing = map.get(candidate.value) || {
      value: candidate.value,
      valid: candidate.valid === true,
      shapeStatus: candidate.shapeStatus || "",
      confidence: 0,
      occurrences: 0,
      methods: [],
      sources: [],
      autoApplied: false
    };
    existing.valid = existing.valid || candidate.valid === true;
    existing.confidence = Math.max(existing.confidence, Number(candidate.confidence || 0));
    existing.occurrences += 1;
    existing.methods = uniqueStrings(existing.methods.concat(candidate.method || ""));
    existing.sources = uniqueStrings(existing.sources.concat(candidate.source || ""));
    map.set(candidate.value, existing);
  });
  return [...map.values()];
}

function tesseractTextConfidence(tsv, fallback) {
  const rows = parseTesseractTsvRows(tsv).filter((row) => row.level === 5 && row.text && Number(row.confidence) >= 0);
  if (rows.length) {
    return rows.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / rows.length;
  }
  return Number(fallback || 0);
}

function unionBbox(boxes) {
  const valid = (Array.isArray(boxes) ? boxes : []).filter((box) => box && Number.isFinite(Number(box.x0)) && Number.isFinite(Number(box.y0)));
  if (!valid.length) return null;
  return {
    x0: Math.min(...valid.map((box) => Number(box.x0))),
    y0: Math.min(...valid.map((box) => Number(box.y0))),
    x1: Math.max(...valid.map((box) => Number(box.x1))),
    y1: Math.max(...valid.map((box) => Number(box.y1)))
  };
}
/* eslint-enable no-unused-vars */

function compactOcrFieldValue(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function uniqueStrings(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function pickingOcrScaleCandidates() {
  const seen = new Set();
  return PICKING_OCR_SCALE_CANDIDATES.filter((candidate) => {
    const key = `${candidate.scale}|${candidate.dpi}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Number(candidate.scale) > 0;
  });
}

function pickingOcrCandidateKey(scaleConfig, rotation) {
  return `${scaleConfig.scale}|${scaleConfig.dpi}|${rotation}`;
}

function pickingOcrCandidateLabel(scaleConfig, rotation) {
  return `${scaleConfig.label || "ocr"} scale ${scaleConfig.scale}, ${scaleConfig.dpi} dpi, rotation ${rotation}`;
}

async function setOcrWorkerDpi(worker, dpi) {
  const value = String(dpi || OCR_RENDER_DPI);
  if (worker.__hlogistikDpi === value) return;
  await worker.setParameters({ user_defined_dpi: value });
  worker.__hlogistikDpi = value;
}

function countNonEmptyTextLines(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .length;
}

function buildPickingOcrCandidate(entry) {
  const text = (entry.pages || []).join("\n");
  const parsed = sanitizeBestellscheinHandlingUnitDuplicates(parseOrderText(text), text);
  const issues = validatePickingImport(text, parsed);
  const metrics = pickingOcrCandidateMetrics(text, parsed, issues);
  const score = scorePickingOcrCandidate(metrics);
  return {
    ...entry,
    text,
    parsed,
    issues,
    metrics,
    score
  };
}

function pickingOcrCandidateMetrics(text, parsed, issues = []) {
  const parsedLines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const normalLines = parsedLines.filter((line) => line?.lineType !== "loading-slip");
  const rawLineCount = countNonEmptyTextLines(text);
  const sourceLines = String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const pickingLines = parseLoadingSlipLines(sourceLines).length ? linesBeforeLoadingSlip(sourceLines) : sourceLines;
  const pickingSource = pickingLines.join("\n");
  const warehouseLike = isWarehouseLikeText(pickingSource);
  const bestellscheinLike = isBestellscheinText(pickingSource);
  const expectedWarehouseRows = warehouseLike ? countWarehouseCandidateRows(pickingLines) : 0;
  const expectedBestellscheinRows = countBestellscheinCandidateRows(pickingLines);
  const warehouseOrderCount = normalLines.filter((line) => /^\d{6,14}$/.test(String(line.warehouseOrder || ""))).length;
  const handlingUnitCount = normalLines.filter((line) => String(line.fromHandlingUnit || "").trim()).length;
  const fromBinCount = normalLines.filter((line) => String(line.fromBin || "").trim()).length;
  const productCount = normalLines.filter((line) => String(line.product || "").trim()).length;
  const quantityCount = normalLines.filter((line) => {
    const quantity = parseImportQuantityValue(line.targetQty);
    return Number.isFinite(quantity) && quantity > 0;
  }).length;
  const unitCount = normalLines.filter((line) => String(line.unit || "").trim()).length;
  const toBinCount = normalLines.filter((line) => String(line.toBin || "").trim()).length;
  const completeRequiredCount = normalLines.filter((line) => {
    const quantity = parseImportQuantityValue(line.targetQty);
    return String(line.warehouseOrder || "").trim()
      && String(line.fromBin || "").trim()
      && String(line.product || "").trim()
      && Number.isFinite(quantity)
      && quantity > 0
      && String(line.toBin || "").trim();
  }).length;
  const fromBinShapeDiagnostics = normalLines.map((line) => pickingFromBinShapeDiagnostic(line.fromBin));
  const suspiciousFromBinShapeCount = fromBinShapeDiagnostics
    .filter((diagnostic) => diagnostic.status === "suspicious")
    .length;
  const invalidFromBinShapeCount = fromBinShapeDiagnostics
    .filter((diagnostic) => diagnostic.status === "invalid")
    .length;
  const missingFromBinCount = normalLines.filter((line) => !String(line.fromBin || "").trim()).length;
  const suspiciousSourceFieldCount = normalLines.filter((line) => isSuspiciousImportedSourceBin(line)).length;
  const bestellscheinCompleteCount = bestellscheinLike ? normalLines.filter(isCompleteImportLine).length : 0;
  const bestellscheinOrderDetected = bestellscheinLike && Boolean(String(parsed?.orderNumber || "").trim());
  const bestellscheinCustomerDetected = bestellscheinLike && (
    Boolean(String(parsed?.customerName || "").trim()) ||
    /030\s*\/\s*012|hummel\s+logistik|schwan\s+international/i.test(pickingSource)
  );
  const expectedRows = Math.max(expectedWarehouseRows, expectedBestellscheinRows);

  return {
    rawLineCount,
    textLength: String(text || "").length,
    parsedLineCount: normalLines.length,
    expectedWarehouseRows,
    expectedBestellscheinRows,
    bestellscheinLike,
    expectedRows,
    discardedRows: Math.max(0, expectedRows - normalLines.length),
    warehouseOrderCount,
    handlingUnitCount,
    fromBinCount,
    productCount,
    quantityCount,
    unitCount,
    toBinCount,
    completeRequiredCount,
    suspiciousFromBinShapeCount,
    invalidFromBinShapeCount,
    bestellscheinCompleteCount,
    bestellscheinOrderDetected,
    bestellscheinCustomerDetected,
    missingFromBinCount,
    suspiciousSourceFieldCount,
    issueCount: Array.isArray(issues) ? issues.length : 0
  };
}

function isSuspiciousImportedSourceBin(line) {
  const fromBin = String(line?.fromBin || "").trim();
  if (!fromBin) return false;
  if (String(line?.toBin || "").trim() && fromBin === String(line.toBin || "").trim()) return true;
  if (String(line?.fromHandlingUnit || "").trim() && fromBin === String(line.fromHandlingUnit || "").trim()) return true;
  if (String(line?.product || "").trim() && fromBin === String(line.product || "").trim()) return true;
  if (String(line?.targetQty || "").trim() && fromBin === String(line.targetQty || "").trim()) return true;
  return false;
}

function scorePickingOcrCandidate(metrics) {
  if (metrics.bestellscheinLike && metrics.bestellscheinCompleteCount > 0) {
    return metrics.bestellscheinCompleteCount * 3200
      + metrics.parsedLineCount * 500
      + metrics.productCount * 250
      + metrics.quantityCount * 250
      + metrics.handlingUnitCount * 150
      + (metrics.bestellscheinOrderDetected ? 400 : 0)
      + (metrics.bestellscheinCustomerDetected ? 300 : 0)
      + Math.min(metrics.textLength || 0, 800)
      - metrics.issueCount * 4000
      - metrics.discardedRows * 800
      - metrics.suspiciousSourceFieldCount * 3000
      - Number(metrics.suspiciousFromBinShapeCount || 0) * 1200
      - Number(metrics.invalidFromBinShapeCount || 0) * 2500;
  }

  return metrics.completeRequiredCount * 4000
    + metrics.parsedLineCount * 600
    + metrics.warehouseOrderCount * 250
    + metrics.handlingUnitCount * 150
    + metrics.fromBinCount * 450
    + metrics.productCount * 250
    + metrics.quantityCount * 250
    + metrics.toBinCount * 250
    + Math.min(metrics.textLength || 0, 800)
    - metrics.issueCount * 4000
    - metrics.discardedRows * 800
    - metrics.missingFromBinCount * 1000
    - metrics.suspiciousSourceFieldCount * 3000
    - Number(metrics.suspiciousFromBinShapeCount || 0) * 1200
    - Number(metrics.invalidFromBinShapeCount || 0) * 2500;
}

function isUsablePickingOcrSelection(selection) {
  return Number(selection?.score ?? selection?.qualityScore ?? 0) >= PICKING_OCR_MINIMUM_SCORE
    && Number(selection?.metrics?.parsedLineCount || selection?.selectedCandidate?.metrics?.parsedLineCount || 0) > 0;
}

function pickingOcrCandidateDiagnostic(candidate) {
  return window.HLogistikImportDiagnostics.pickingOcrCandidateDiagnostic(candidate);
}

async function readPdfWithOcr(pdf, parseCandidate = parseOrderText, scoreCandidate = scoreOcrCandidate) {
  if (!window.Tesseract?.createWorker) {
    throw new Error("OCR-Modul konnte nicht geladen werden. Internetverbindung prüfen und Seite neu laden.");
  }

  const worker = await createOcrWorker(
    pdf.numPages * (OCR_ROTATIONS.length + BESTELLSCHEIN_PRECISE_OCR_SCALES.length),
    OCR_RENDER_DPI
  );
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setImportStatus(`OCR Seite ${pageNumber}/${pdf.numPages} vorbereiten ...`, "", Math.round(((pageNumber - 1) / pdf.numPages) * 100));
      const baseCanvas = await renderPdfPageToCanvas(pdf, pageNumber);
      const candidates = [];

      for (let index = 0; index < OCR_ROTATIONS.length; index += 1) {
        const rotation = OCR_ROTATIONS[index];
        const canvas = rotation ? rotateCanvas(baseCanvas, rotation) : baseCanvas;
        const rotationLabel = rotation ? `, Drehung ${rotation} Grad` : "";
        setImportStatus(`OCR Seite ${pageNumber}/${pdf.numPages}${rotationLabel} ...`);
        const result = await worker.recognize(canvas);
        const text = result.data.text || "";
        const parsed = parseCandidate(text);
        const candidate = { text, parsed, score: scoreCandidate(text, parsed), rotation };
        candidates.push(candidate);

        if (canvas !== baseCanvas) {
          canvas.width = 0;
          canvas.height = 0;
        }

        if (isStrongOcrCandidate(candidate) && !isBestellscheinOcrCandidate(candidate, parseCandidate)) break;
      }

      const best = candidates.sort((a, b) => b.score - a.score)[0] || { text: "", rotation: 0 };
      const refined = await refineBestellscheinOcrCandidate(pdf, pageNumber, best, worker, parseCandidate);
      pages.push(refined.text);
      baseCanvas.width = 0;
      baseCanvas.height = 0;
    }
  } finally {
    await worker.terminate();
  }

  return pages.join("\n");
}

async function createOcrWorker(totalSteps, dpi = OCR_RENDER_DPI) {
  let currentStep = 1;
  const progressState = { stageLabel: "OCR" };
  const worker = await window.Tesseract.createWorker(OCR_LANGUAGE, 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0",
    langPath: "https://tessdata.projectnaptha.com/4.0.0",
    logger: (message) => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        const percent = Math.round(message.progress * 100);
        const overallPercent = Math.min(99, Math.round(((currentStep - 1 + message.progress) / totalSteps) * 100));
        setImportStatus(`OCR ${progressState.stageLabel} ${currentStep}/${totalSteps}: ${percent}%`, "", overallPercent);
      }
    }
  });
  worker.__hlogistikOcrProgress = progressState;

  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: window.Tesseract.PSM?.AUTO || "3",
    user_defined_dpi: dpi
  });

  const originalRecognize = worker.recognize.bind(worker);
  worker.recognize = async (...args) => {
    const result = await originalRecognize(...args);
    currentStep += 1;
    return result;
  };

  return worker;
}

async function refineBestellscheinOcrCandidate(pdf, pageNumber, candidate, worker, parseCandidate) {
  if (!isBestellscheinOcrCandidate(candidate, parseCandidate)) return candidate;

  try {
    let mergedLines = candidate.parsed?.lines || [];

    for (const scale of BESTELLSCHEIN_PRECISE_OCR_SCALES) {
      const preciseCanvas = await renderPdfPageToCanvas(pdf, pageNumber, scale);
      const rotatedCanvas = candidate.rotation ? rotateCanvas(preciseCanvas, candidate.rotation) : preciseCanvas;
      const preciseResult = await worker.recognize(rotatedCanvas);
      const preciseText = preciseResult.data.text || "";
      const preciseParsed = parseCandidate(preciseText);
      mergedLines = mergeBestellscheinOcrLines(mergedLines, preciseParsed.lines || []);

      if (rotatedCanvas !== preciseCanvas) {
        rotatedCanvas.width = 0;
        rotatedCanvas.height = 0;
      }
      preciseCanvas.width = 0;
      preciseCanvas.height = 0;
    }

    if (!mergedLines.length) return candidate;
    return {
      ...candidate,
      parsed: { ...candidate.parsed, lines: mergedLines },
      text: buildBestellscheinOcrText(candidate.text, mergedLines)
    };
  } catch (error) {
    console.warn("Bestellschein-HU-Pruefung fehlgeschlagen.", error);
    return candidate;
  }
}

function isBestellscheinOcrCandidate(candidate, parseCandidate) {
  return parseCandidate === parseOrderText
    && /bestellschein|entnahmeanweisungen/i.test(String(candidate?.text || ""))
    && Array.isArray(candidate?.parsed?.lines)
    && candidate.parsed.lines.length > 0;
}

function mergeBestellscheinOcrLines(baseLines, preciseLines) {
  const normalizedBaseLines = Array.isArray(baseLines) ? baseLines : [];
  const normalizedPreciseLines = Array.isArray(preciseLines) ? preciseLines : [];
  const baseSignatureCounts = countBestellscheinLineSignatures(normalizedBaseLines);
  const preciseUsed = new Set();
  return normalizedBaseLines.map((line, lineIndex) => {
    const signature = bestellscheinLineSignature(line);
    const baseHandlingUnit = cleanBestellscheinBarcode(line?.fromHandlingUnit);
    const isAmbiguousWeakHu = (!baseHandlingUnit || !isLikelyHandlingUnit(baseHandlingUnit))
      && baseSignatureCounts.get(signature) > 1;
    const preciseIndex = findBestellscheinPreciseLineIndex(
      line,
      normalizedPreciseLines,
      preciseUsed,
      lineIndex,
      isAmbiguousWeakHu
    );
    if (preciseIndex === -1) return line;

    preciseUsed.add(preciseIndex);
    const preciseLine = normalizedPreciseLines[preciseIndex];
    const fromHandlingUnit = chooseBestellscheinHandlingUnit(line.fromHandlingUnit, preciseLine.fromHandlingUnit);
    if (fromHandlingUnit === line.fromHandlingUnit) return line;
    return { ...line, fromHandlingUnit, fromHandlingUnitEditable: !fromHandlingUnit };
  });
}

function countBestellscheinLineSignatures(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((counts, line) => {
    const signature = bestellscheinLineSignature(line);
    counts.set(signature, (counts.get(signature) || 0) + 1);
    return counts;
  }, new Map());
}

function findBestellscheinPreciseLineIndex(line, preciseLines, preciseUsed, baseIndex, skipAmbiguousWeakHu) {
  const matches = (Array.isArray(preciseLines) ? preciseLines : [])
    .map((candidate, index) => ({ candidate, index }))
    .filter((entry) => !preciseUsed.has(entry.index) && isSameBestellscheinOcrLine(line, entry.candidate));

  if (!matches.length || skipAmbiguousWeakHu) return -1;

  const sameIndex = matches.find((entry) => entry.index === baseIndex);
  if (sameIndex) return sameIndex.index;

  matches.sort((left, right) => Math.abs(left.index - baseIndex) - Math.abs(right.index - baseIndex));
  return matches[0].index;
}

function isSameBestellscheinOcrLine(left, right) {
  if (!left || !right) return false;
  return bestellscheinLineSignature(left) === bestellscheinLineSignature(right);
}

function bestellscheinLineSignature(line) {
  if (!line) return "";
  return [
    String(line.product || "").trim(),
    normalizeQuantity(line.targetQty),
    bestellscheinDescriptionKey(line.description)
  ].join("|");
}

function bestellscheinDescriptionKey(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 28);
}

function chooseBestellscheinHandlingUnit(baseValue, preciseValue) {
  const base = cleanBestellscheinBarcode(baseValue);
  const precise = cleanBestellscheinBarcode(preciseValue);
  if (!base && precise) return precise;
  if (!precise || precise === base) return base;
  if (!isLikelyHandlingUnit(base) && isLikelyHandlingUnit(precise)) return precise;
  return base;
}

function cleanBestellscheinBarcode(value) {
  return String(value || "")
    .replace(/\D/g, "")
    .trim();
}

function buildBestellscheinOcrText(sourceText, lines) {
  const header = bestellscheinOcrHeaderText(sourceText);
  const body = (Array.isArray(lines) ? lines : [])
    .filter((line) => line?.product && line?.targetQty)
    .map(bestellscheinLineToOcrText)
    .join("\n");
  return [header, body].filter(Boolean).join("\n");
}

function bestellscheinOcrHeaderText(sourceText) {
  const lines = String(sourceText || "")
    .replace(/\r/g, "\n")
    .split("\n");
  const firstBodyIndex = lines.findIndex((line) => isBestellscheinRowStart(line));
  const headerLines = firstBodyIndex >= 0 ? lines.slice(0, firstBodyIndex) : lines;
  const headerText = headerLines.join("\n").trim();
  const orderHintText = bestellscheinOrderHintContextText(lines, headerText);
  return [headerText, orderHintText].filter(Boolean).join("\n");
}

function bestellscheinOrderHintContextText(lines, headerText) {
  if (/\bbestell\s*-?\s*hinweis\b/i.test(headerText)) return "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || "").replace(/\s+/g, " ").trim();
    if (!/\bbestell\s*-?\s*hinweis\b/i.test(line)) continue;

    const context = [line];
    const labelMatch = line.match(/\bbestell\s*-?\s*hinweis\b\s*[:#-]?\s*(.*)$/i);
    const hasSameLineValue = Boolean(String(labelMatch?.[1] || "").trim());
    const nextLine = String(lines[index + 1] || "").replace(/\s+/g, " ").trim();
    if (!hasSameLineValue && nextLine && !isBestellscheinRowStart(nextLine)) context.push(nextLine);
    return context.join("\n");
  }

  return "";
}

function bestellscheinLineToOcrText(line) {
  const parts = [
    `${line.product} ${line.description || ""} ${line.targetQty} ${line.unit || "ST"}`.trim(),
    `Lagerplatz: 012/${line.product}`
  ];
  const handlingUnit = cleanBestellscheinBarcode(line.fromHandlingUnit);
  if (handlingUnit) parts.push(handlingUnit);
  return parts.join("\n");
}

function sanitizeBestellscheinHandlingUnitDuplicates(parsed, sourceText = "") {
  if (!isBestellscheinText(sourceText) || !Array.isArray(parsed?.lines)) return parsed;

  const lastIndexByHandlingUnit = new Map();
  parsed.lines.forEach((line, index) => {
    if (line?.lineType === "loading-slip") return;
    const key = normalizeHandlingUnitLookup(line.fromHandlingUnit);
    if (key) lastIndexByHandlingUnit.set(key, index);
  });

  let cleared = 0;
  const lines = parsed.lines.map((line, index) => {
    const key = normalizeHandlingUnitLookup(line?.fromHandlingUnit);
    if (!key || line?.lineType === "loading-slip") return line;

    const isDuplicate = lastIndexByHandlingUnit.get(key) !== index;
    if (!isDuplicate) return line;

    cleared += 1;
    return {
      ...line,
      fromHandlingUnit: "",
      fromHandlingUnitEditable: true
    };
  });

  return cleared ? { ...parsed, lines, bestellscheinHuWarnings: cleared } : parsed;
}

function isBestellscheinText(value) {
  return /bestellschein|entnahmeanweisungen/i.test(String(value || ""));
}

function isSiBestellscheinText(value) {
  const source = String(value || "");
  return isBestellscheinText(source)
    && /030\s*\/\s*012|hummel\s+logistik|schwan\s+international|\bauslagerung\b|\bSI\b/i.test(source);
}

async function renderPdfPageToCanvas(pdf, pageNumber, scale = OCR_RENDER_SCALE) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

function rotateCanvas(sourceCanvas, degrees) {
  const rotation = ((degrees % 360) + 360) % 360;
  if (!rotation) return sourceCanvas;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const quarterTurn = rotation === 90 || rotation === 270;
  canvas.width = quarterTurn ? sourceCanvas.height : sourceCanvas.width;
  canvas.height = quarterTurn ? sourceCanvas.width : sourceCanvas.height;

  if (rotation === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  }

  context.drawImage(sourceCanvas, 0, 0);
  return canvas;
}

function scoreOcrCandidate(text, parsed) {
  const parsedLines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const completeLines = parsedLines.filter(isCompleteImportLine).length;
  const incompleteLines = parsedLines.length - completeLines;
  const warehouseHits = (text.match(/\b\d{6,}\b/g) || []).length;
  const handlingUnitHits = (text.match(/\b\d{10,}\b/g) || []).length;
  const binHits = (text.match(/\b\d{3}-[A-Z0-9]+-[A-Z0-9]+\b/gi) || []).length;
  return completeLines * 1500
    + parsedLines.length * 100
    + warehouseHits * 20
    + handlingUnitHits * 10
    + binHits * 10
    + Math.min(text.length, 500)
    - incompleteLines * 900;
}

function isCompleteImportLine(line) {
  if (!line || !String(line.product || "").trim()) return false;
  const quantity = parseImportQuantityValue(line.targetQty);
  return Number.isFinite(quantity) && quantity > 0;
}

function scoreStorageOcrCandidate(text, parsed) {
  const materialHits = (text.match(/\b\d{7}\b/g) || []).length;
  const containerHits = (text.match(/\bC\s*\d+\b/gi) || []).length;
  return parsed.lines.length * 1000 + materialHits * 50 + containerHits * 25 + Math.min(text.length, 500);
}

function isStrongOcrCandidate(candidate) {
  return Array.isArray(candidate?.parsed?.lines)
    && candidate.parsed.lines.length > 0
    && Number(candidate.score || 0) >= OCR_STRONG_CANDIDATE_SCORE;
}

function bestellscheinPageNotice(text, pdfPageCount) {
  if (!/bestellschein|entnahmeanweisungen/i.test(text)) return "";

  const pageMatches = [...String(text || "").matchAll(/Seite\s*:?\s*(\d+)\s*\(?\s*von\s*(\d+)\s*\)?/gi)];
  const pagesSeen = new Set(pageMatches.map((match) => Number(match[1])).filter(Number.isFinite));
  const declaredTotal = Math.max(0, ...pageMatches.map((match) => Number(match[2])).filter(Number.isFinite));
  const checkedPages = Math.max(Number(pdfPageCount) || 0, pagesSeen.size);

  if (declaredTotal > checkedPages) {
    return `Achtung: Bestellschein nennt ${declaredTotal} Seiten, PDF enthaelt ${checkedPages} Seite${checkedPages === 1 ? "" : "n"}.`;
  }

  if (checkedPages > 1 || declaredTotal > 1) {
    return `Mehrseitiger Bestellschein geprueft: ${checkedPages}${declaredTotal ? ` von ${declaredTotal}` : ""} Seiten.`;
  }

  return "";
}

function pickingImportDiagnostics(text, parsed = {}, info = {}) {
  return window.HLogistikImportDiagnostics.pickingImportDiagnostics(text, parsed, info, {
    parseLoadingSlipLines,
    linesBeforeLoadingSlip,
    isWarehouseLikeText,
    auditLoadingSlipImport,
    importDocumentType,
    countWarehouseCandidateRows,
    countBestellscheinCandidateRows,
    minimumQualityScore: PICKING_OCR_MINIMUM_SCORE
  });
}

function logPickingImportDiagnostics(reason, diagnostics) {
  return window.HLogistikImportDiagnostics.logPickingImportDiagnostics(reason, diagnostics);
}

function pickingImportNoLinesMessage(text, diagnostics) {
  return window.HLogistikImportDiagnostics.pickingImportNoLinesMessage(text, diagnostics);
}

function buildPickingImportLineDiagnostics(rawLines, finalLines = rawLines, context = {}) {
  return window.HLogistikImportDiagnostics.buildPickingImportLineDiagnostics(rawLines, finalLines, context);
}

// eslint-disable-next-line no-unused-vars
function pickingImportBinDiagnosticReason(rawFromBin, finalFromBin) {
  return window.HLogistikImportDiagnostics.pickingImportBinDiagnosticReason(rawFromBin, finalFromBin);
}

function logPickingImportLineDiagnostics(diagnostics, importDiagnostics = {}) {
  return window.HLogistikImportDiagnostics.logPickingImportLineDiagnostics(diagnostics, importDiagnostics, {
    minimumQualityScore: PICKING_OCR_MINIMUM_SCORE
  });
}

async function importText(text, fileName = "", parsed = parseOrderText(text), importDiagnostics = {}) {
  if (!Array.isArray(parsed.lines) || !parsed.lines.length) {
    const diagnostics = pickingImportDiagnostics(text, parsed, importDiagnostics);
    logPickingImportDiagnostics("no-position-lines", diagnostics);
    return {
      lines: 0,
      cancelled: true,
      type: "error",
      message: pickingImportNoLinesMessage(text, diagnostics),
      diagnostics
    };
  }

  const duplicate = await findDuplicateOrderForImport(parsed.orderNumber, "picking", text);
  if (duplicate) {
    return {
      lines: 0,
      cancelled: true,
      message: `Auftrag ${duplicate.orderNumber || duplicate.id} wurde bereits eingelesen und wird nicht doppelt angelegt.`
    };
  }

  const importIssues = validatePickingImport(text, parsed);
  if (importIssues.length) {
    return {
      lines: 0,
      cancelled: true,
      message: `Import abgebrochen: ${importIssues.slice(0, 3).join(" ")}${importIssues.length > 3 ? " Weitere Fehler vorhanden." : ""}`
    };
  }

  currentMode = "picking";
  localStorage.setItem(MODE_KEY, currentMode);
  clearCurrentOrder();
  state.orderType = "picking";
  state.rawText = text;
  state.originalFileName = String(fileName || "").trim();
  state.originalFilePath = "";
  state.originalArchivedAt = "";
  state.originalArchivePath = "";
  state.originalArchiveError = "";
  state.orderDate = new Date().toISOString().slice(0, 10);
  state.orderTime = currentTimeValue();
  state.awaitingRelease = true;
  state.createdBy = currentUser.name;
  state.lastEditedBy = currentUser.name;
  state.activeUser = "";
  state.activeUserAt = "";

  if (parsed.orderNumber) state.orderNumber = parsed.orderNumber;
  if (parsed.customerName && !state.customerName) state.customerName = parsed.customerName;
  state.customerGroupKey = parsed.customerGroupKey || customerGroupKeyForImport(state.customerName);

  const nextLines = parsed.lines;
  const isPickingXlsx = importDiagnostics.documentType === "picking-xlsx";
  const warehouseHint = await detectPickingWarehouse(nextLines, text);
  applyWarehouseHint(warehouseHint);
  const binResult = await applyStorageBinsFromArticleStock(nextLines, {
    allowSiFromBinFill: !isPickingXlsx && isSiSystemFromBinFillContext(text, parsed, importDiagnostics)
  });
  const reviewedLines = isPickingXlsx
    ? binResult.lines
    : applyFromBinReviewWarnings(binResult.lines);
  state.lines = await applyPackageNotesForImportedLines(reviewedLines);
  const lineDiagnostics = buildPickingImportLineDiagnostics(nextLines, state.lines, { text, diagnostics: importDiagnostics });
  logPickingImportLineDiagnostics(lineDiagnostics, importDiagnostics);
  applyDefaultDestinationCustomer(state.lines);
  applyCustomerOrderNumberRule();
  topControlsCollapsed = false;
  saveStateWithoutServer();
  render();
  return {
    lines: parsed.lines.length,
    loadingSlips: countLoadingSlipLines(state.lines),
    autoBins: binResult.applied,
    warehouseHint,
    binCorrections: Number(parsed.binCorrections || 0),
    binWarnings: countOpenBinWarnings(state.lines),
    importDiagnostics: lineDiagnostics,
    diagnostics: importDiagnostics,
    originalFileName: state.originalFileName
  };
}

async function detectPickingWarehouse(lines, text = "") {
  const materials = [...new Set((Array.isArray(lines) ? lines : [])
    .map((line) => String(line.product || "").trim())
    .filter(Boolean))]
    .slice(0, 80);

  const scores = {
    SSI: { articleHits: 0, stockHits: 0, textHits: 0, score: 0 },
    SI: { articleHits: 0, stockHits: 0, textHits: 0, score: 0 }
  };

  const source = String(text || "");
  if (/\bSSI\b/i.test(source)) scores.SSI.textHits += 1;
  if (/Schwan\s+International|030\s*\/\s*012|Hummel\s+Logistik\s+SI/i.test(source)) scores.SI.textHits += 1;

  if (serverOnline && materials.length) {
    await Promise.all(["SSI", "SI"].flatMap((warehouse) => materials.map(async (materialnummer) => {
      const headers = { "X-Warehouse": warehouse };
      try {
        await apiJson(`/api/articles/lookup/${encodeURIComponent(materialnummer)}`, { headers });
        scores[warehouse].articleHits += 1;
      } catch {
        // Missing in this article master is a useful signal for the other warehouse.
      }

      try {
        const locations = await apiJson(`/api/storage/locations?materialnummer=${encodeURIComponent(materialnummer)}`, { headers });
        if (Array.isArray(locations) && locations.length) scores[warehouse].stockHits += 1;
      } catch {
        // Stock lookup is best effort; article hits are still enough for a useful hint.
      }
    })));
  }

  Object.values(scores).forEach((entry) => {
    entry.score = entry.articleHits * 2 + entry.stockHits * 3 + entry.textHits * 4;
  });

  return warehouseHintFromScores(scores, {
    checkedMaterials: materials.length,
    offline: !serverOnline
  });
}

function warehouseHintFromScores(scores, info = {}) {
  const selectedWarehouse = currentWarehouse();
  const entries = ["SSI", "SI"].map((warehouse) => ({ warehouse, ...scores[warehouse] }))
    .sort((left, right) => right.score - left.score);
  const [best, second] = entries;
  const hasClearMatch = best.score >= 2 && best.score - second.score >= 2;

  if (!hasClearMatch) {
    const message = info.offline
      ? `Lagerhinweis: Offline konnte der Auftrag nicht gegen SSI/SI geprüft werden. Aktuell gewählt: ${selectedWarehouse}.`
      : `Lagerhinweis: Lager nicht eindeutig erkannt. ${warehouseScoreText("SSI", scores.SSI)}, ${warehouseScoreText("SI", scores.SI)}. Bitte Lager-Schalter oben prüfen.`;
    return {
      detectedWarehouse: "",
      selectedWarehouse,
      type: "warning",
      message,
      shortMessage: info.offline ? `Lager nicht geprüft, aktuell ${selectedWarehouse}.` : "Lager nicht eindeutig erkannt.",
      scores,
      checkedMaterials: info.checkedMaterials || 0
    };
  }

  const type = best.warehouse === selectedWarehouse ? "ok" : "warning";
  const base = `Lagerhinweis: Auftrag passt wahrscheinlich zu ${best.warehouse} (${warehouseScoreText(best.warehouse, best)}).`;
  const message = type === "ok"
    ? `${base} Der Lager-Schalter steht richtig.`
    : `${base} Der Auftrag wird beim Abschluss aus ${best.warehouse} gebucht. Oben ist aktuell ${selectedWarehouse} gewählt.`;

  return {
    detectedWarehouse: best.warehouse,
    selectedWarehouse,
    type,
    message,
    shortMessage: type === "ok"
      ? `Lager erkannt: ${best.warehouse}.`
      : `Buchungslager erkannt: ${best.warehouse}.`,
    scores,
    checkedMaterials: info.checkedMaterials || 0
  };
}

function countOpenBinWarnings(lines) {
  return (Array.isArray(lines) ? lines : [])
    .filter((line) => line?.lineType !== "loading-slip" && String(line.binWarning || "").trim())
    .length;
}

function clearBinWarnings(lines) {
  let cleared = 0;
  const nextLines = (Array.isArray(lines) ? lines : []).map((line) => {
    if (line?.lineType === "loading-slip" || !String(line?.binWarning || "").trim()) return line;
    cleared += 1;
    return {
      ...line,
      binWarning: "",
      binWarningValue: "",
      binWarningType: "",
      fromBinReviewRequired: false,
      fromBinReviewReason: "",
      fromBinReviewBlocksRelease: false,
      fromBinReviewBlocksExport: false,
      fromBinManualCorrectionClearsWarning: false,
      fromBinReviewConfirmedValue: ""
    };
  });

  return { lines: nextLines, cleared };
}

function shouldClearBinWarning(line, nextBin) {
  if (!String(line?.binWarning || "").trim() && line?.fromBinReviewRequired !== true) return false;
  const previous = normalizePickingBinText(line.binWarningValue || line.fromBin);
  const next = normalizePickingBinText(nextBin);
  return Boolean(next && next !== previous && isPlausiblePickingBin(next) && !suspiciousPickingBinWarning({ fromBin: next }));
}

function warehouseScoreText(warehouse, score) {
  const parts = [];
  if (score.articleHits) parts.push(`${score.articleHits} Artikel`);
  if (score.stockHits) parts.push(`${score.stockHits} Bestand`);
  if (score.textHits) parts.push(`${score.textHits} Texttreffer`);
  return `${warehouse}: ${parts.length ? parts.join(", ") : "0 Treffer"}`;
}

function applyWarehouseHint(hint) {
  const detectedWarehouse = normalizeOptionalWarehouse(hint?.detectedWarehouse);
  const selectedWarehouse = normalizeOptionalWarehouse(hint?.selectedWarehouse) || currentWarehouse();
  state.detectedWarehouse = detectedWarehouse;
  state.orderWarehouse = detectedWarehouse || selectedWarehouse;
  state.warehouseHint = hint?.message || "";
  state.warehouseHintType = hint?.type || "";
  renderWarehouseHint();
}

function isSiSystemFromBinFillContext(text = "", parsed = {}, importDiagnostics = {}) {
  if (currentOrderWarehouse() !== "SI") return false;
  const documentType = String(importDiagnostics?.documentType || importDocumentType(text, parsed)).toLowerCase();
  if (documentType === "si-bestellschein") return true;
  if (documentType === "bestellschein" && isSiBestellscheinText(text)) return true;
  const customerText = [parsed?.customerName, state.customerName, text].join(" ");
  return /030\s*\/\s*012|hummel\s+logistik|schwan\s+international|\bSI\b/i.test(customerText);
}

async function applyStorageBinsFromArticleStock(lines, options = {}) {
  if (!serverOnline || !Array.isArray(lines) || !lines.length) return { lines, applied: 0 };

  const materials = [...new Set(lines.map((line) => String(line.product || "").trim()).filter(Boolean))];
  if (!materials.length && options.allowSiFromBinFill !== true) return { lines, applied: 0 };

  const locationsByMaterial = new Map();
  const headers = { "X-Warehouse": currentOrderWarehouse() };
  await Promise.all(materials.map(async (materialnummer) => {
    try {
      const locations = await apiJson(`/api/storage/locations?materialnummer=${encodeURIComponent(materialnummer)}`, { headers });
      locationsByMaterial.set(materialnummer, Array.isArray(locations) ? locations : []);
    } catch {
      locationsByMaterial.set(materialnummer, []);
    }
  }));

  let applied = 0;
  const allowSiFromBinFill = options.allowSiFromBinFill === true && currentOrderWarehouse() === "SI";
  const enriched = lines.map((line) => {
    const materialnummer = String(line.product || "").trim();
    const handlingUnit = normalizeHandlingUnitLookup(line.fromHandlingUnit);
    const locations = materialnummer ? locationsByMaterial.get(materialnummer) || [] : [];
    const siFromBin = allowSiFromBinFill ? siSystemFromBinPatchForLine(line, locations) : emptySiSystemFromBinPatch();

    const match = materialnummer && handlingUnit
      ? findArticleStockLocationForLine(line, locations)
      : null;

    const stockQty = match ? Number(match.mengeStueck || match.menge_stueck || 0) || 0 : 0;
    const correctedQuantity = correctedOcrWarehouseQuantityFromStock(line, stockQty);
    const quantityLine = correctedQuantity
      ? { ...line, targetQty: correctedQuantity, actualQty: correctedQuantity }
      : line;
    const quantityRemark = storageQuantityRemarkForLine(quantityLine, stockQty);
    let nextAutoNotes = setAutoPositionNote(line.autoPositionNotes, "quantity", quantityRemark);
    nextAutoNotes = setAutoPositionNote(
      nextAutoNotes,
      "quantityCorrection",
      correctedQuantity ? `OCR-Menge korrigiert: ${line.targetQty} -> ${correctedQuantity}` : ""
    );
    nextAutoNotes = setAutoPositionNote(nextAutoNotes, "sourceBinSystem", siFromBin.note);
    const noteChanged = JSON.stringify(nextAutoNotes) !== JSON.stringify(normalizeAutoPositionNotes(line.autoPositionNotes));
    const quantityChanged = Boolean(correctedQuantity && correctedQuantity !== String(line.targetQty || "").trim());
    const stockQtyChanged = Boolean(match && Number(line.stockQty || 0) !== stockQty);
    const siFromBinChanged = siFromBin.changed === true;

    if (!noteChanged && !quantityChanged && !stockQtyChanged && !siFromBinChanged) return line;
    if (siFromBin.applied) applied += 1;

    return {
      ...line,
      targetQty: correctedQuantity || line.targetQty,
      actualQty: correctedQuantity && !lineWasManuallyQuantityEdited(line)
        ? correctedQuantity
        : line.actualQty,
      fromBin: line.fromBin,
      binWarning: line.binWarning || "",
      binWarningValue: line.binWarningValue || "",
      binWarningType: line.binWarningType || "",
      fromBinReviewRequired: line.fromBinReviewRequired === true,
      fromBinReviewReason: line.fromBinReviewReason || "",
      fromBinReviewBlocksRelease: line.fromBinReviewBlocksRelease === true,
      fromBinReviewBlocksExport: line.fromBinReviewBlocksExport === true,
      fromBinManualCorrectionClearsWarning: line.fromBinManualCorrectionClearsWarning === true,
      fromBinReviewConfirmedValue: line.fromBinReviewConfirmedValue || "",
      ...siFromBin.patch,
      autoPositionNotes: nextAutoNotes,
      ...(match ? { stockQty } : {})
    };
  });

  return { lines: enriched, applied };
}

function emptySiSystemFromBinPatch() {
  return { changed: false, applied: false, note: "", patch: {} };
}

function siSystemFromBinPatchForLine(line, locations) {
  if (!line || line.lineType === "loading-slip") return emptySiSystemFromBinPatch();
  const existingBin = normalizePickingBinText(line.fromBin);
  const materialnummer = String(line.product || "").trim();
  const handlingUnit = normalizeHandlingUnitLookup(line.fromHandlingUnit);
  const validExistingBin = isFormalValidPickingBin(existingBin);

  if (validExistingBin) {
    const lookup = materialnummer && handlingUnit
      ? findUniqueStockLocationByHandlingUnit(locations, handlingUnit)
      : { status: "", reason: "", candidates: [] };
    const systemBin = normalizePickingBinText(lookup.location?.lagerplatz);
    if (lookup.status === "unique" && systemBin && systemBin !== existingBin) {
      return {
        changed: true,
        applied: false,
        note: `LE/HU-Systemtreffer abweichend (${systemBin}); importierter Von-Lagerplatz ${existingBin} bleibt unveraendert.`,
        patch: {
          fromBinSystemLookupStatus: "kept-existing",
          fromBinSystemLookupReason: "bestehender Von-Lagerplatz ist formal gueltig; Systemwert weicht ab",
          fromBinSystemLookupValue: systemBin,
          fromBinSystemLookupCandidates: [stockLocationDiagnostic(lookup.location)],
          fromBinOcrRawValue: existingBin
        }
      };
    }
    return emptySiSystemFromBinPatch();
  }

  if (!materialnummer) {
    return siSystemFromBinReviewPatch(line, "missing-product", "kein Artikel fuer LE/HU-Systemabgleich", []);
  }
  if (!handlingUnit) {
    return siSystemFromBinReviewPatch(line, "missing-handling-unit", "keine LE/HU fuer Systemabgleich", []);
  }

  const lookup = findUniqueStockLocationByHandlingUnit(locations, handlingUnit);
  if (lookup.status === "none") {
    return siSystemFromBinReviewPatch(line, "no-match", "kein Systemtreffer fuer LE/HU", lookup.candidates);
  }
  if (lookup.status === "ambiguous") {
    return siSystemFromBinReviewPatch(line, "ambiguous", "mehrdeutiger Systemtreffer fuer LE/HU", lookup.candidates);
  }

  const systemBin = normalizePickingBinText(lookup.location?.lagerplatz);
  if (!systemBin) {
    return siSystemFromBinReviewPatch(line, "missing-system-bin", "Systemtreffer ohne Lagerplatz", [lookup.location]);
  }

  const ocrRawValue = existingBin;
  const reviewPatch = fromBinReviewPatchForValue(systemBin, {
    ...line,
    fromBinReviewRequired: true,
    binWarningType: "from-bin-review"
  });
  const reason = ocrRawValue
    ? `OCR-Rohwert ${ocrRawValue} durch eindeutigen LE/HU-Systemtreffer ${systemBin} ersetzt.`
    : `Von-Lagerplatz aus LE/HU-System eindeutig ergaenzt: ${systemBin}.`;
  return {
    changed: true,
    applied: true,
    note: ocrRawValue
      ? `Von-Lagerplatz aus LE/HU-System eindeutig ergaenzt (OCR-Rohwert: ${ocrRawValue}; Systemtreffer: ${systemBin}).`
      : "Von-Lagerplatz aus LE/HU-System eindeutig ergaenzt.",
    patch: {
      ...reviewPatch,
      fromBin: systemBin,
      fromBinSystemLookupStatus: "applied",
      fromBinSystemLookupReason: reason,
      fromBinSystemLookupValue: systemBin,
      fromBinSystemLookupCandidates: [stockLocationDiagnostic(lookup.location)],
      fromBinOcrRawValue: ocrRawValue
    }
  };
}

function findUniqueStockLocationByHandlingUnit(locations, handlingUnit) {
  const normalizedHandlingUnit = normalizeHandlingUnitLookup(handlingUnit);
  const matches = (Array.isArray(locations) ? locations : [])
    .filter((location) => normalizeHandlingUnitLookup(location.leNummer || location.le_nummer) === normalizedHandlingUnit)
    .filter((location) => String(location.lagerplatz || "").trim());
  if (!matches.length) return { status: "none", reason: "kein Systemtreffer fuer LE/HU", candidates: [] };
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      reason: "mehrdeutiger Systemtreffer fuer LE/HU",
      candidates: matches.map(stockLocationDiagnostic)
    };
  }
  return { status: "unique", reason: "eindeutiger Systemtreffer fuer LE/HU", location: matches[0], candidates: matches.map(stockLocationDiagnostic) };
}

function siSystemFromBinReviewPatch(line, status, reason, candidates) {
  const existingBin = normalizePickingBinText(line.fromBin);
  const message = `Von-Lagerplatz im SI-Import nicht eindeutig ergaenzt: ${reason}. Bitte anhand PDF/System pruefen.`;
  return {
    changed: true,
    applied: false,
    note: message,
    patch: {
      binWarning: message,
      binWarningValue: existingBin,
      binWarningType: "si-system-bin-review",
      fromBinReviewRequired: true,
      fromBinReviewReason: message,
      fromBinReviewBlocksRelease: true,
      fromBinReviewBlocksExport: true,
      fromBinManualCorrectionClearsWarning: true,
      fromBinSystemLookupStatus: status,
      fromBinSystemLookupReason: reason,
      fromBinSystemLookupValue: "",
      fromBinSystemLookupCandidates: (Array.isArray(candidates) ? candidates : []).map(stockLocationDiagnostic),
      fromBinOcrRawValue: existingBin
    }
  };
}

function stockLocationDiagnostic(location) {
  if (!location) return {};
  return {
    lagerplatz: String(location.lagerplatz || "").trim(),
    leNummer: String(location.leNummer || location.le_nummer || "").trim(),
    mengeStueck: Number(location.mengeStueck || location.menge_stueck || 0) || 0
  };
}

function findArticleStockLocationForLine(line, locations) {
  const candidates = Array.isArray(locations) ? locations : [];
  const handlingUnit = normalizeHandlingUnitLookup(line?.fromHandlingUnit);
  if (handlingUnit) {
    const handlingUnitMatch = candidates.find((location) => (
      normalizeHandlingUnitLookup(location.leNummer || location.le_nummer) === handlingUnit
    ));
    if (handlingUnitMatch) return handlingUnitMatch;
  }

  const fromBin = normalizePickingBinText(line?.fromBin);
  if (!fromBin) return null;

  const binMatches = candidates.filter((location) => (
    normalizePickingBinText(location.lagerplatz) === fromBin
  ));

  return binMatches.length === 1 ? binMatches[0] : null;
}

function correctedOcrWarehouseQuantityFromStock(line, stockQty) {
  const original = normalizeQuantity(line?.targetQty);
  const stockQuantity = Number(stockQty || 0);
  if (!isSuspiciousLeadingZeroOcrQuantity(original) || !Number.isInteger(stockQuantity) || stockQuantity <= 0) return "";

  const originalDigits = original.replace(/\D/g, "");
  const stockDigits = String(stockQuantity);
  const significantOriginalDigits = originalDigits.replace(/^0+/, "");
  if (!significantOriginalDigits) return "";

  if (stockDigits === significantOriginalDigits && stockDigits !== originalDigits) return stockDigits;
  if (stockDigits === `9${originalDigits.slice(1)}`) return stockDigits;
  return "";
}

function isSuspiciousLeadingZeroOcrQuantity(value) {
  return /^0\d{2,3}$/.test(String(value || "").trim());
}

function lineWasManuallyQuantityEdited(line) {
  const actual = String(line?.actualQty || "").trim();
  const target = String(line?.targetQty || "").trim();
  return Boolean(actual && target && actual !== target);
}

function storageQuantityRemarkForLine(line, stockQty) {
  const quantitySource = line?.actualQty !== undefined && line?.actualQty !== null && String(line.actualQty).trim() !== ""
    ? line.actualQty
    : line?.targetQty;
  const pickQty = parseImportQuantityValue(quantitySource);
  const availableQty = Number(stockQty || 0);

  if (!Number.isFinite(pickQty) || !Number.isFinite(availableQty) || pickQty <= 0 || availableQty <= 0) return "";
  if (pickQty === availableQty) return "1 Pal.";
  if (pickQty < availableQty) return "com";
  return "";
}

function normalizeHandlingUnitLookup(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function importStorageText(text, fileName = "", parsed = parseStorageSlipText(text, fileName)) {
  currentMode = "storage";
  localStorage.setItem(MODE_KEY, currentMode);
  clearCurrentOrder();
  state.orderType = "storage";
  state.orderWarehouse = currentWarehouse();
  state.rawText = text;
  state.originalFileName = String(fileName || "").trim();
  state.originalFilePath = "";
  state.originalArchivedAt = "";
  state.originalArchivePath = "";
  state.originalArchiveError = "";
  state.orderDate = new Date().toISOString().slice(0, 10);
  state.orderTime = currentTimeValue();
  state.orderNumber = parsed.orderNumber || await nextStorageOrderNumber();
  state.customerName = "SSI";
  state.customerGroupKey = parsed.customerGroupKey || customerGroupKeyForImport(state.customerName);
  state.lines = normalizeStorageHandlingUnits(parsed.lines.length ? parsed.lines : [createLine({ description: text.slice(0, 140) })], isSsiStorageOrderContext());
  topControlsCollapsed = state.lines.length > 0;
  markOrderTouched();
  saveAndRender();
  return { lines: parsed.lines.length, warnings: parsed.warnings || [], originalFileName: state.originalFileName };
}

async function nextStorageOrderNumber() {
  if (!serverOnline) return "1";
  try {
    const result = await apiJson("/api/orders/next-storage-number");
    return String(result.orderNumber || "1");
  } catch {
    return "1";
  }
}

async function findDuplicateOrderForImport(orderNumber, orderType, text = "") {
  const normalizedOrderNumber = String(orderNumber || "").trim().toLowerCase();
  const checkOrderNumber = normalizedOrderNumber && !isReusableOrderNumber(normalizedOrderNumber);
  const fingerprint = orderFingerprint(text);
  if (!serverOnline || (!checkOrderNumber && !fingerprint)) return null;
  try {
    const params = new URLSearchParams();
    if (checkOrderNumber) params.set("orderNumber", orderNumber);
    if (orderType) params.set("orderType", orderType);
    if (fingerprint) params.set("fingerprint", fingerprint);
    const duplicate = await apiJson(`/api/orders/duplicate-check?${params}`);
    if (duplicate?.duplicate) return duplicate.order;

    const orders = await apiJson("/api/orders?includeExported=1");
    if (!checkOrderNumber) return null;
    return orders.find((order) => {
      if (state.id && order.id === state.id) return false;
      return String(order.orderNumber || "").trim().toLowerCase() === normalizedOrderNumber &&
        String(order.orderType || "picking").trim().toLowerCase() === String(orderType || "picking").toLowerCase();
    }) || null;
  } catch {
    return null;
  }
}

function isReusableOrderNumber(orderNumber) {
  return String(orderNumber || "").trim().toLowerCase().startsWith("ssi");
}

function orderFingerprint(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .slice(0, 2000);
}

function setImportStatus(message, type = "", progress = null) {
  if (!elements.importStatus) return;
  if (elements.importProgressWrap) elements.importProgressWrap.hidden = false;
  elements.importStatus.textContent = message;
  elements.importStatus.classList.toggle("is-ok", type === "ok");
  elements.importStatus.classList.toggle("is-error", type === "error");
  elements.importStatus.classList.toggle("is-warning", type === "warning");

  const nextProgress = type === "ok" || type === "warning" ? 100 : progress;
  if (elements.importProgressBar && nextProgress !== null && nextProgress !== undefined) {
    const clampedProgress = Math.max(0, Math.min(100, Number(nextProgress) || 0));
    elements.importProgressBar.style.width = `${clampedProgress}%`;
  }
}

function importSuccessMessage(positionCount) {
  return `Auftrag erfolgreich importiert. Anzahl an Positionen: ${positionCount}.`;
}

function renderWarehouseHint() {
  if (!elements.warehouseHint) return;
  const message = String(state.warehouseHint || "").trim();
  elements.warehouseHint.hidden = !message;
  elements.warehouseHint.textContent = message;
  elements.warehouseHint.classList.toggle("is-warning", state.warehouseHintType === "warning");
  elements.warehouseHint.classList.toggle("is-error", state.warehouseHintType === "error");
}

function extractTextFromSimplePdf(arrayBuffer) {
  const source = new TextDecoder("latin1").decode(new Uint8Array(arrayBuffer));
  const rows = [];
  const pattern = /BT\s+\/F\d+\s+[\d.]+\s+Tf\s+([\d.]+)\s+([\d.]+)\s+Td\s+\((.*?)\)\s+Tj\s+ET/gs;
  let match;

  while ((match = pattern.exec(source))) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const text = unescapePdfText(match[3]).trim();
    let row = rows.find((entry) => Math.abs(entry.y - y) < 3);
    if (!row) {
      row = { y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, text });
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => row.cells.sort((a, b) => a.x - b.x).map((cell) => cell.text).join("\t"))
    .join("\n");
}

function unescapePdfText(value) {
  return value
    .replace(/\\\)/g, ")")
    .replace(/\\\(/g, "(")
    .replace(/\\\\/g, "\\");
}

function parseOrderText(text) {
  const cleanedLines = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const loadingSlipLines = parseLoadingSlipLines(cleanedLines);
  const pickingLines = loadingSlipLines.length ? linesBeforeLoadingSlip(cleanedLines) : cleanedLines;

  const printedOrderNumber = findFirst(text, [
    /Bestellschein\s*Nr\.?\s*[:.-]?\s*([A-Z0-9-]{4,}(?:\s*-\s*[^\n\t]{2,80})?)/i,
    /(?:^|\n)\s*(?:auftragsnr\.?|auftragsnummer|belegnr\.?)\s*[:#-]?\s*([A-Z0-9-]{4,}(?:\s*-\s*[^\n\t]{2,80})?)/i,
    /(?:^|\n)\s*(?:auftrag|kommission|lieferschein)\s*[:#-]\s*([A-Z0-9-]{4,}(?:\s*-\s*[^\n\t]{2,80})?)/i
  ]);
  const orderNumber = appendOrderHintFromText(printedOrderNumber, text);
  const explicitCustomerName = findFirst(text, [
    /Auslagerung\s*[:#-]?\s*([^\n\t]{3,80})/i,
    /(?:kunde|lieferadresse|empf.{0,3}nger)\s*[:#-]?\s*([^\n\t]{3,80})/i,
    /(?:kunde|lieferadresse|empfänger)\s*[:#-]?\s*([^\n\t]{3,80})/i
  ]);

  const tableRows = annotateDestinationExceptions(collectWarehouseRows(pickingLines));
  const stackedRows = tableRows.length ? [] : annotateDestinationExceptions(collectStackedWarehouseRows(pickingLines));
  const splitRows = tableRows.length || stackedRows.length ? [] : annotateDestinationExceptions(collectSplitWarehouseRows(pickingLines));
  const warehouseRows = tableRows.length ? tableRows : stackedRows.length ? stackedRows : splitRows;
  const headerCustomerName = cleanCustomerName(explicitCustomerName || findCustomerFromHeader(pickingLines));
  const destinationCustomerName = destinationToCustomerNameFallback(warehouseRows);
  const customerName = warehouseRows.length ? destinationCustomerName || headerCustomerName : headerCustomerName;
  const customerGroupKey = customerGroupKeyForImport(customerName, destinationCustomerName || destinationToCustomerGroupFallback(warehouseRows));

  if (warehouseRows.length) {
    return {
      orderNumber: orderNumber || "",
      customerName: customerName || "",
      customerGroupKey,
      lines: appendLoadingSlipLines(warehouseRows.map((line) => createLine({
        ...line,
        ...canonicalImportedQuantity(line.targetQty),
        fromHandlingUnitEditable: !String(line.fromHandlingUnit || "").trim()
      })), loadingSlipLines)
    };
  }

  const bestellscheinRows = collectBestellscheinRows(pickingLines);
  if (bestellscheinRows.length) {
    const bestellscheinCustomer = bestellscheinCustomerName(text, explicitCustomerName);
    return {
      orderNumber: orderNumber || "",
      customerName: bestellscheinCustomer,
      customerGroupKey: customerGroupKeyForImport(bestellscheinCustomer),
      lines: appendLoadingSlipLines(bestellscheinRows.map((line, index) => createLine({
        ...line,
        ...canonicalImportedQuantity(line.targetQty),
        warehouseOrder: String(index + 1),
        fromHandlingUnitEditable: !String(line.fromHandlingUnit || "").trim()
      })), loadingSlipLines)
    };
  }

  if (pickingLines.some((line) => /lageraufg/i.test(line))) {
    return {
      orderNumber: orderNumber || "",
      customerName: customerName || "",
      customerGroupKey,
      lines: []
    };
  }

  const candidates = [];
  let current = null;

  pickingLines.forEach((line) => {
    const starter = line.match(/^(\d{1,4})(?:[.)\s-]+)(.+)$/);
    const looksLikeArticle = /\b[A-Z0-9][A-Z0-9/-]{3,}\b/.test(line);
    const hasQuantity = /\b\d+(?:[,.]\d+)?\s*(?:stk|st|stück|pck|pak|ve|karton|kg|g|m|l|rolle|pal)\b/i.test(line);
    const isLikelyPosition = starter && (hasQuantity || looksLikeArticle || line.length > 18);

    if (isLikelyPosition) {
      if (current) candidates.push(current);
      current = parsePositionLine(starter[1], starter[2]);
      return;
    }

    if (current && line.length < 160 && !/^(summe|gesamt|mwst|steuer|netto|brutto)\b/i.test(line)) {
      current.description = [current.description, line].filter(Boolean).join(" ");
    }
  });

  if (current) candidates.push(current);

  return {
    orderNumber: orderNumber || "",
    customerName: customerName || "",
    customerGroupKey,
    lines: appendLoadingSlipLines(candidates.map((line, index) => createLine({
      ...line,
      ...canonicalImportedQuantity(line.targetQty),
      warehouseOrder: line.position || String(index + 1),
    })), loadingSlipLines)
  };
}

async function handlePickingXlsxUpload(file) {
  if (currentMode === "storage") {
    setImportStatus("XLSX-Kommissionierimporte sind nur im Modus Kommissionierung zulässig.", "error", 100);
    return;
  }
  if (!window.XLSX?.read || !window.HLogistikPickingXlsxImport?.previewWorkbook) {
    setImportStatus("XLSX-Modul konnte nicht geladen werden. Seite neu laden.", "error", 100);
    return;
  }

  setImportStatus(`Lese ${file.name} ...`, "", 0);
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellText: true, cellDates: false });
  const preview = window.HLogistikPickingXlsxImport.previewWorkbook(workbook);
  if (!preview.ok) {
    const firstError = preview.hardErrors?.[0];
    const detail = firstError ? ` Zeile ${firstError.rowNumber}: ${firstError.errors.join(", ")}.` : "";
    setImportStatus(`XLSX-Import abgebrochen.${detail}`, "error", 100);
    return;
  }

  const parsed = {
    orderNumber: "",
    customerName: "",
    customerGroupKey: "",
    lines: preview.lines.map((line) => createLine(line))
  };
  const diagnostics = {
    source: "xlsx",
    documentType: "picking-xlsx",
    sheetName: preview.sheetName,
    headerRow: preview.headerRow,
    inputRowCount: preview.inputRowCount,
    importedPositionCount: preview.lines.length,
    ignoredRowCount: preview.ignoredRows.length,
    hardErrorCount: preview.hardErrors.length
  };
  const result = await importText(`XLSX-Blatt ${preview.sheetName}`, file.name, parsed, diagnostics);
  if (result.cancelled) {
    setImportStatus(result.message || "XLSX-Import abgebrochen.", result.type || "warning", 100);
    return;
  }
  setImportStatus(
    `${result.lines} XLSX-Positionen importiert; ${preview.ignoredRows.length} Leer-/Summenzeile(n) begründet ignoriert.`,
    "ok",
    100
  );
}

function canonicalImportedQuantity(value) {
  const raw = String(value ?? "").trim();
  const parsed = window.HLogistikQuantityFormat?.parse(raw);
  if (!Number.isFinite(parsed)) return { targetQty: raw, actualQty: raw, quantitySourceText: "" };
  const canonical = String(parsed);
  return {
    targetQty: canonical,
    actualQty: canonical,
    quantitySourceText: /[xX×]/.test(raw) ? raw : ""
  };
}

function appendOrderHintFromText(orderNumber, text) {
  const rules = window.HLogistikOrderHintRules;
  if (!rules || typeof rules.extractOrderHint !== "function" || typeof rules.appendOrderHintToOrderNumber !== "function") {
    return String(orderNumber || "").trim();
  }
  return rules.appendOrderHintToOrderNumber(orderNumber, rules.extractOrderHint(text));
}

function bestellscheinCustomerName(text, explicitCustomerName = "") {
  const explicit = cleanCustomerName(explicitCustomerName);
  if (explicit && !/^auslagerung$/i.test(explicit)) return explicit;
  if (isSiBestellscheinText(text)) return "030 / 012 Hummel Logistik SI";
  return explicit || "Bestellschein";
}

function loadingSlipParserDependencies() {
  return {
    collectBestellscheinRows,
    isBestellscheinRowStart,
    createLine,
    setAutoPositionNote,
    normalizeUnit,
    normalizeQuantity,
    parseQuantity: parseImportQuantityValue
  };
}

function appendLoadingSlipLines(lines, loadingSlipLines) {
  return window.HLogistikPickingParser.appendLoadingSlipLines(lines, loadingSlipLines);
}

function appendAllLoadingSlipLines(lines, loadingSlipLines) {
  return window.HLogistikPickingParser.appendAllLoadingSlipLines(lines, loadingSlipLines);
}

function loadingSlipLineKey(line) {
  return window.HLogistikPickingParser.loadingSlipLineKey(line);
}

function countLoadingSlipLines(lines) {
  return window.HLogistikPickingParser.countLoadingSlipLines(lines);
}

function appendLoadingSlipLinesToParsed(parsed, loadingSlipLines) {
  return window.HLogistikPickingParser.appendLoadingSlipLinesToParsed(parsed, loadingSlipLines);
}

function collectLoadingSlipLinesFromOcrCandidates(candidates) {
  return window.HLogistikPickingParser.collectLoadingSlipLinesFromOcrCandidates(candidates, loadingSlipParserDependencies());
}

function mergeServerLoadingSlipLines(order, serverOrder) {
  if (!order || !Array.isArray(order.lines) || !Array.isArray(serverOrder?.lines)) return order;

  const serverLoadingSlipLines = serverOrder.lines
    .filter((line) => line?.lineType === "loading-slip" && String(line.barcode || "").trim());
  if (!serverLoadingSlipLines.length) return order;

  const previousByKey = new Map(
    order.lines
      .filter((line) => line?.lineType === "loading-slip" && String(line.barcode || "").trim())
      .map((line) => [loadingSlipLineKey(line), line])
  );
  const normalLines = order.lines.filter((line) => line?.lineType !== "loading-slip");
  const mergedLoadingSlipLines = serverLoadingSlipLines.map((line) => {
    const previous = previousByKey.get(loadingSlipLineKey(line));
    return {
      ...line,
      picked: previous?.picked ?? line.picked,
      positionNote: String(previous?.positionNote || "").trim() || line.positionNote || "",
      autoPositionNotes: normalizeAutoPositionNotes(previous?.autoPositionNotes || line.autoPositionNotes)
    };
  });

  return {
    ...order,
    lines: [...normalLines, ...mergedLoadingSlipLines]
  };
}

function parseLoadingSlipLines(lines) {
  return window.HLogistikPickingParser.parseLoadingSlipLines(lines, loadingSlipParserDependencies());
}

function auditLoadingSlipImport(lines, parsedLines = []) {
  return window.HLogistikPickingParser.auditLoadingSlipImport(lines, parsedLines, loadingSlipParserDependencies());
}

// eslint-disable-next-line no-unused-vars
function duplicateLoadingSlipBarcodes(entries) {
  return window.HLogistikPickingParser.duplicateLoadingSlipBarcodes(entries);
}

// eslint-disable-next-line no-unused-vars
function formatLoadingSlipIndexes(entries) {
  return window.HLogistikPickingParser.formatLoadingSlipIndexes(entries);
}

// eslint-disable-next-line no-unused-vars
function parseLoadingSlipBlock(lines) {
  return window.HLogistikPickingParser.parseLoadingSlipBlock(lines, loadingSlipParserDependencies());
}

function loadingSlipBlocksFrom(lines) {
  return window.HLogistikPickingParser.loadingSlipBlocksFrom(lines, loadingSlipParserDependencies());
}

function isLoadingSlipStartLine(line) {
  return window.HLogistikPickingParser.isLoadingSlipStartLine(line);
}

function isLoadingSlipHeaderBarcodeLine(line) {
  return window.HLogistikPickingParser.isLoadingSlipHeaderBarcodeLine(line);
}

function linesBeforeLoadingSlip(lines) {
  return window.HLogistikPickingParser.linesBeforeLoadingSlip(lines);
}

// eslint-disable-next-line no-unused-vars
function isLikelyLoadingSlip(lines) {
  return window.HLogistikPickingParser.isLikelyLoadingSlip(lines, loadingSlipParserDependencies());
}

// eslint-disable-next-line no-unused-vars
function parseStackedLoadingSlipRow(lines) {
  return window.HLogistikPickingParser.parseStackedLoadingSlipRow(lines, loadingSlipParserDependencies());
}

// eslint-disable-next-line no-unused-vars
function parseCompactLoadingSlipRow(lines) {
  return window.HLogistikPickingParser.parseCompactLoadingSlipRow(lines, loadingSlipParserDependencies());
}

// eslint-disable-next-line no-unused-vars
function normalizeLoadingSlipText(value) {
  return window.HLogistikPickingParser.normalizeLoadingSlipText(value);
}

// eslint-disable-next-line no-unused-vars
function cleanLoadingSlipDescription(value) {
  return window.HLogistikPickingParser.cleanLoadingSlipDescription(value);
}

// eslint-disable-next-line no-unused-vars
function normalizeLoadingSlipQuantity(value) {
  return window.HLogistikPickingParser.normalizeLoadingSlipQuantity(value, loadingSlipParserDependencies());
}

// eslint-disable-next-line no-unused-vars
function extractLoadingSlipHeaderBarcode(lines) {
  return window.HLogistikPickingParser.extractLoadingSlipHeaderBarcode(lines);
}

// eslint-disable-next-line no-unused-vars
function cleanLoadingSlipBarcode(value) {
  return window.HLogistikPickingParser.cleanLoadingSlipBarcode(value);
}

function isWarehouseLikeText(text) {
  return /lageraufg|von-handlin|von-lagerpla|nach-lagerplatz|produktbeschreibung/i.test(String(text || ""));
}

function validatePickingImport(text, parsed) {
  const issues = [];
  const source = String(text || "");
  const lines = source
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const pickingLines = parseLoadingSlipLines(lines).length ? linesBeforeLoadingSlip(lines) : lines;
  const pickingSource = pickingLines.join("\n");
  const bestellscheinExpectedRows = countBestellscheinCandidateRows(pickingLines);
  const warehouseExpectedRows = isWarehouseLikeText(pickingSource) ? countWarehouseCandidateRows(pickingLines) : 0;
  const loadingSlipAudit = auditLoadingSlipImport(lines, parsed.lines);

  loadingSlipAudit.issues.forEach((issue) => {
    issues.push(`Ladelisten pruefen: ${issue}`);
  });

  if (bestellscheinExpectedRows && parsed.lines.length < bestellscheinExpectedRows) {
    issues.push(`${bestellscheinExpectedRows} Bestellschein-Position(en) erkannt, aber nur ${parsed.lines.length} gelesen.`);
  }

  if (warehouseExpectedRows && parsed.lines.length < warehouseExpectedRows) {
    issues.push(`${warehouseExpectedRows} Lagerauftrag-Position(en) erkannt, aber nur ${parsed.lines.length} gelesen.`);
  }

  duplicateHandlingUnitConflicts(parsed.lines).forEach((conflict) => {
    issues.push(`LE/HU ${conflict.value} ist mehrfach vorhanden (${formatHandlingUnitPositions(conflict.positions)}).`);
  });

  parsed.lines.forEach((line, index) => {
    const label = `Position ${index + 1}`;
    const quantity = parseImportQuantityValue(line.targetQty);

    if (!String(line.product || "").trim()) issues.push(`${label}: Artikelnummer fehlt.`);
    if (!quantity || quantity <= 0) issues.push(`${label}: Menge fehlt oder ist ungueltig.`);
  });

  return issues;
}

function duplicateHandlingUnitConflicts(lines) {
  const byHandlingUnit = new Map();

  (Array.isArray(lines) ? lines : []).forEach((line, index) => {
    const rawValue = String(line?.fromHandlingUnit || "").trim();
    if (isIncompleteSsiStorageHandlingUnit(rawValue)) return;
    const key = normalizeHandlingUnitLookup(rawValue);
    if (!key) return;

    const entry = byHandlingUnit.get(key) || { value: rawValue, positions: [] };
    if (!entry.value && rawValue) entry.value = rawValue;
    entry.positions.push(index + 1);
    byHandlingUnit.set(key, entry);
  });

  return [...byHandlingUnit.values()].filter((entry) => entry.positions.length > 1);
}

function formatHandlingUnitPositions(positions) {
  return positions.map((position) => `Pos. ${position}`).join(", ");
}

function formatDuplicateHandlingUnitConflicts(conflicts) {
  return conflicts
    .slice(0, 3)
    .map((conflict) => `LE/HU ${conflict.value} mehrfach (${formatHandlingUnitPositions(conflict.positions)})`)
    .join("; ");
}

function countBestellscheinCandidateRows(lines) {
  return lines.filter((line) => /^\d{7}\b/.test(line) && /\b\d{1,4}(?:[,.]\d{3})*(?:[,.]\d+)?\s*(?:ST|Stk|Stueck|Stück|PC|PCS)\b/i.test(line)).length;
}

function countWarehouseCandidateRows(lines) {
  const rowTexts = [];
  let current = "";

  lines.forEach((line) => {
    if (isWarehouseRowStart(line)) {
      if (current) rowTexts.push(current);
      current = line;
      return;
    }

    if (current) current = `${current} ${line}`;
  });

  if (current) rowTexts.push(current);

  const plausibleRows = rowTexts.filter((rowText) => {
    const candidates = [rowText, ...splitPossibleMergedWarehouseRows(rowText)];
    return candidates.some((candidate) => parseWarehouseLine(candidate) || parseWarehouseHeader(candidate));
  });

  if (plausibleRows.length) return plausibleRows.length;

  return lines.filter((line) => {
    const normalizedLine = normalizeOcrWarehouseLine(line);
    return parseWarehouseLine(normalizedLine) || (
      /\b\d{6,}\b/.test(normalizedLine)
      && /\b\d{4,8}\b/.test(normalizedLine)
      && /\b\d{3}-[A-Z0-9]+-[A-Z0-9]+\b/i.test(normalizedLine)
    );
  }).length;
}

function parseImportQuantityValue(value) {
  return window.HLogistikQuantityFormat?.parse(value)
    ?? window.HLogistikImportLineHelpers.parseImportQuantityValue(value);
}

function collectBestellscheinRows(lines) {
  if (!lines.some((line) => /bestellschein|entnahmeanweisungen/i.test(line))) return [];

  const chunks = [];
  let current = [];

  lines.forEach((line) => {
    if (isBestellscheinRowStart(line)) {
      if (current.length) chunks.push(current.join("\n"));
      current = [line];
      return;
    }

    if (current.length) current.push(line);
  });

  if (current.length) chunks.push(current.join("\n"));

  const looseQuantities = extractLooseBestellscheinQuantities(chunks);
  let looseQuantityIndex = 0;

  return chunks
    .map((chunk) => {
      const parsed = parseBestellscheinRowStrict(chunk) || parseBestellscheinRow(chunk);
      if (parsed) return parsed;

      const looseQuantity = looseQuantities[looseQuantityIndex] || null;
      const fallback = parseBestellscheinRowFallback(chunk, looseQuantity);
      if (fallback && looseQuantity) looseQuantityIndex += 1;
      return fallback;
    })
    .filter(Boolean);
}

function isBestellscheinRowStart(line) {
  const normalized = normalizeBestellscheinText(line);
  if (!/^\d{6,8}\b/.test(normalized)) return false;

  const rest = normalized.replace(/^\d{6,8}\b/, "").trim();
  return /[A-Za-zÃ„Ã–ÃœÃ¤Ã¶Ã¼]/.test(rest) || /\b\d{1,4}(?:[,.]\d+)?\s*(?:ST|Stk|Stueck|StÃ¼ck|PC|PCS)\b/i.test(rest);
}

function bestellscheinRowParserDependencies() {
  return {
    normalizeQuantity,
    normalizeUnit,
    isLikelyHandlingUnit,
    bestellscheinHeaderText,
    splitTrailingBestellscheinQuantity,
    cleanBestellscheinDescription,
    extractBestellscheinBin,
    extractBestellscheinFirstBarcode,
    isBestellscheinOrderColumnNumber
  };
}

function parseBestellscheinRowStrict(chunk) {
  return window.HLogistikPickingParser.parseBestellscheinRowStrict(chunk, bestellscheinRowParserDependencies());
}

function parseBestellscheinRow(chunk) {
  return window.HLogistikPickingParser.parseBestellscheinRow(chunk, bestellscheinRowParserDependencies());
}

function parseBestellscheinRowFallback(chunk, looseQuantity = null) {
  return window.HLogistikPickingParser.parseBestellscheinRowFallback(chunk, looseQuantity, bestellscheinRowParserDependencies());
}

function bestellscheinHeaderText(value) {
  return window.HLogistikPickingParser.bestellscheinHeaderText(value);
}

function splitTrailingBestellscheinQuantity(value) {
  return window.HLogistikPickingParser.splitTrailingBestellscheinQuantity(value);
}

function extractLooseBestellscheinQuantities(chunks) {
  return chunks
    .flatMap((chunk) => String(chunk || "").replace(/\r/g, "\n").split("\n"))
    .map(normalizeBestellscheinText)
    .map((line) => line.match(/^(\d{1,4}(?:[,.]\d+)?)\s*(ST|Stk|Stueck|StÃ¼ck|PC|PCS)$/i))
    .filter(Boolean)
    .map((match) => ({ quantity: match[1], unit: match[2] }));
}

function normalizeBestellscheinText(value) {
  return window.HLogistikPickingParser.normalizeBestellscheinText(value);
}

function cleanBestellscheinDescription(value) {
  return window.HLogistikPickingParser.cleanBestellscheinDescription(value);
}

function extractBestellscheinBin() {
  return window.HLogistikPickingParser.extractBestellscheinBin();
}

function extractBestellscheinFirstBarcode(value, product) {
  return window.HLogistikPickingParser.extractBestellscheinFirstBarcode(value, product, bestellscheinRowParserDependencies());
}

function isBestellscheinOrderColumnNumber(text, candidate) {
  return window.HLogistikPickingParser.isBestellscheinOrderColumnNumber(text, candidate);
}

function isLikelyHandlingUnit(value) {
  return /^3\d{7,11}$/.test(String(value || ""));
}

function rebuildPageRows(items) {
  const rows = [];

  items
    .filter((item) => item.str && item.str.trim())
    .forEach((item) => {
      const x = item.transform[4];
      const y = item.transform[5];
      let row = rows.find((entry) => Math.abs(entry.y - y) < 3);
      if (!row) {
        row = { y, cells: [] };
        rows.push(row);
      }
      row.cells.push({ x, text: item.str.trim() });
    });

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => row.cells.sort((a, b) => a.x - b.x).map((cell) => cell.text).join("\t"))
    .join("\n");
}

function parseWarehouseLine(line) {
  if (/lagerauftrag|produktbeschreibung|basis|nach-lagerplatz/i.test(line)) return null;

  const normalizedLine = normalizeOcrWarehouseLine(line);
  const tokens = warehouseTokens(normalizedLine);

  const firstNumber = tokens.findIndex((token) => /^\d{6,}$/.test(token));
  if (firstNumber === -1) return null;

  const warehouseOrder = tokens[firstNumber];
  let cursor = firstNumber + 1;
  const handlingUnitInfo = parseHandlingUnitTokens(tokens, cursor);
  const fromHandlingUnit = handlingUnitInfo.value;
  cursor = handlingUnitInfo.next;
  const fromBin = extractBin(tokens[cursor] || "");
  if (fromBin) cursor += 1;
  const productInfo = parseProductTokens(tokens, cursor);
  const product = productInfo.value;
  cursor = productInfo.next;

  while (shouldSkipOcrQuantityPrefix(tokens[cursor], tokens[cursor + 1], tokens[cursor + 2])) cursor += 1;

  const quantity = parseWarehouseQuantityAt(tokens, cursor);
  const targetQty = quantity ? quantity.value : "";
  if (quantity) cursor = quantity.next;
  const unit = /^[A-Za-zÄÖÜäöü]{1,5}$/.test(tokens[cursor] || "") ? normalizeUnit(tokens[cursor++]) : "Stk";
  const remaining = tokens.slice(cursor);

  if (!product || !targetQty || remaining.length === 0) {
    return parseWarehouseLineByColumns(normalizedLine) || parseWarehouseLineWithoutBin(normalizedLine) || parseWarehouseLineLoose(normalizedLine);
  }
  if (isSuspiciousMultiplierQuantity(targetQty)) return null;

  const remainingText = remaining.join(" ");
  const toBin = extractDestinationBin(remainingText);
  const description = cleanProductDescription(remainingText, toBin);

  return {
    warehouseOrder,
    fromHandlingUnit,
    fromBin,
    product,
    description,
    targetQty,
    unit,
    toBin
  };
}

function parseWarehouseLineByColumns(line) {
  const tokens = warehouseTokens(normalizeOcrWarehouseLine(line));
  const firstNumber = tokens.findIndex((token) => /^\d{6,}$/.test(token));
  if (firstNumber === -1) return null;

  const warehouseOrder = tokens[firstNumber];
  const binIndex = tokens.findIndex((token, index) => index > firstNumber && Boolean(extractBin(token)));
  if (binIndex === -1) return null;
  if (!hasIntermediateWarehouseColumn(tokens, firstNumber, binIndex)) return null;

  const productInfo = parseProductTokens(tokens, binIndex + 1);
  const product = productInfo.value;
  if (!product) return null;

  const unitIndex = tokens.findIndex((token, index) => index >= productInfo.next && isUnitToken(token));
  if (unitIndex === -1) return null;

  const quantity = parseLastWarehouseQuantityInRange(tokens, productInfo.next, unitIndex);
  if (!quantity || isSuspiciousMultiplierQuantity(quantity.value)) return null;

  const fromHandlingUnit = extractHandlingUnit(tokens.slice(firstNumber + 1, binIndex).join(" "));
  const fromBin = extractBin(tokens[binIndex]);
  const unit = normalizeUnit(tokens[unitIndex]);
  const remainingText = tokens.slice(unitIndex + 1).join(" ");
  const toBin = extractDestinationBin(remainingText);
  const description = cleanProductDescription(remainingText, toBin);

  return {
    warehouseOrder,
    fromHandlingUnit,
    fromBin,
    product,
    description,
    targetQty: normalizeQuantity(quantity.value),
    unit,
    toBin
  };
}

function hasIntermediateWarehouseColumn(tokens, firstNumber, binIndex) {
  const intermediateTokens = tokens.slice(firstNumber + 1, binIndex);
  if (!intermediateTokens.length) return false;
  if (extractHandlingUnit(intermediateTokens.join(" "))) return false;
  return intermediateTokens.some((token) => /^\d{2,6}$/.test(String(token || "")));
}

function parseWarehouseLineWithoutBin(line) {
  const tokens = warehouseTokens(normalizeOcrWarehouseLine(line));
  const firstNumber = tokens.findIndex((token) => /^\d{6,}$/.test(token));
  if (firstNumber === -1) return null;

  const warehouseOrder = tokens[firstNumber];
  let cursor = firstNumber + 1;
  const handlingUnitInfo = parseHandlingUnitTokens(tokens, cursor);
  const fromHandlingUnit = handlingUnitInfo.value;
  cursor = handlingUnitInfo.next;
  const productStart = cursor;
  const productInfo = parseProductTokens(tokens, cursor);
  const product = productInfo.value;
  if (!product) return null;

  const beforeProductText = tokens.slice(firstNumber + 1, productStart).join(" ");
  if (extractBin(beforeProductText)) return null;

  let unitIndex = -1;
  let quantity = null;
  for (let index = productInfo.next + 1; index < tokens.length; index += 1) {
    if (!isUnitToken(tokens[index])) continue;
    const parsedQuantity = parseLastWarehouseQuantityInRange(tokens, productInfo.next, index);
    if (!parsedQuantity || isSuspiciousMultiplierQuantity(parsedQuantity.value)) continue;
    unitIndex = index;
    quantity = parsedQuantity;
    break;
  }
  if (unitIndex === -1 || !quantity) return null;

  const descriptionBeforeQuantity = tokens.slice(productInfo.next, quantity.start).join(" ");
  const afterUnit = tokens.slice(unitIndex + 1).join(" ");
  const toBin = extractDestinationBin(afterUnit);
  const description = cleanProductDescription([descriptionBeforeQuantity, afterUnit].filter(Boolean).join(" "), toBin);
  if (!description && !toBin) return null;

  return {
    warehouseOrder,
    fromHandlingUnit,
    fromBin: "",
    product,
    description,
    targetQty: normalizeQuantity(quantity.value),
    unit: normalizeUnit(tokens[unitIndex]),
    toBin
  };
}

function destinationToCustomerGroupFallback(lines) {
  return destinationCustomerNameForLines(lines);
}

function destinationToCustomerNameFallback(lines) {
  return destinationCustomerNameForLines(lines);
}

function defaultDestinationCustomerName(lines) {
  return destinationCustomerNameForLines(lines);
}

function destinationCustomerNameForLines(lines) {
  const destinations = destinationNamesForLines(lines);
  return destinations.includes(SSI_DESTINATION_CUSTOMER) ? SSI_DESTINATION_CUSTOMER : destinations[0] || "";
}

function destinationNamesForLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => line?.toBin)
    .map(normalizeDestinationName)
    .filter(Boolean);
}

function applyDefaultDestinationCustomer(lines) {
  const customerName = defaultDestinationCustomerName(lines);
  if (!customerName) return false;
  state.customerName = customerName;
  state.customerGroupKey = customerGroupKeyForImport(customerName);
  applyCustomerOrderNumberRule();
  return true;
}

function applyCustomerOrderNumberRule() {
  if (!requiresSsiOrderNumber(state.customerName)) return false;
  state.orderNumber = "SSI";
  if (elements.orderNumber) elements.orderNumber.value = state.orderNumber;
  return true;
}

function orderNumberForCustomer(orderNumber, customerName) {
  return requiresSsiOrderNumber(customerName) ? "SSI" : String(orderNumber || "");
}

function requiresSsiOrderNumber(customerName) {
  return normalizeDestinationName(customerName) === SSI_DESTINATION_CUSTOMER;
}

function annotateDestinationExceptions(lines) {
  const defaultDestination = destinationCustomerNameForLines(lines);
  if (!defaultDestination) return lines;

  return lines.map((line) => {
    const destination = normalizeDestinationName(line.toBin);
    if (!destination || destination === defaultDestination) return line;

    return {
      ...line,
      autoPositionNotes: setAutoPositionNote(line.autoPositionNotes, "destination", destination)
    };
  });
}

function normalizeDestinationName(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^(?:8021|9021|99021)-0?0?UT\b/, SSI_DESTINATION_CUSTOMER);
  if (new RegExp(`^${SSI_DESTINATION_CUSTOMER}\\b`).test(normalized)) return SSI_DESTINATION_CUSTOMER;
  return normalized;
}

function collectWarehouseRows(lines) {
  const rows = [];
  const seen = new Set();
  const seenHeaders = new Set();
  const rowTexts = [];
  const pendingHeaders = [];
  const pendingContinuations = [];
  let current = "";

  lines.forEach((line) => {
    if (isWarehouseRowStart(line)) {
      if (current) rowTexts.push(current);
      current = line;
      return;
    }

    if (current) current = `${current} ${line}`;
  });

  if (current) rowTexts.push(current);

  rowTexts.forEach((rowText) => {
    const splitRows = splitPossibleMergedWarehouseRows(rowText);
    const candidates = splitRows.length ? splitRows : [rowText];

    candidates.forEach((candidate) => {
      const parsed = parseWarehouseLine(candidate);
      const header = parseWarehouseHeader(candidate);
      const continuations = extractWarehouseContinuations(candidate);

      if (parsed && (!pendingHeaders.length || continuations.length <= 1)) {
        addWarehouseRow(rows, seen, parsed);
        return;
      }

      if (header) {
        const headerKey = warehouseHeaderKey(header);
        if (!seenHeaders.has(headerKey)) {
          pendingHeaders.push(header);
          seenHeaders.add(headerKey);
        }
      }

      continuations.forEach((continuation) => {
        if (pendingHeaders.length) {
          const line = { ...pendingHeaders.shift(), ...continuation };
          addWarehouseRow(rows, seen, line);
        } else {
          pendingContinuations.push(continuation);
        }
      });

      while (pendingHeaders.length && pendingContinuations.length) {
        const line = { ...pendingHeaders.shift(), ...pendingContinuations.shift() };
        addWarehouseRow(rows, seen, line);
      }
    });
  });

  return rows;
}

function collectStackedWarehouseRows(lines) {
  const rows = [];
  let index = 0;

  while (index < lines.length) {
    const warehouseOrder = String(lines[index] || "").trim();
    if (!/^\d{6,}$/.test(warehouseOrder)) {
      index += 1;
      continue;
    }

    const parsed = parseStackedWarehouseRow(lines, index);
    if (parsed) {
      rows.push(parsed.line);
      index = parsed.nextIndex;
      continue;
    }

    index += 1;
  }

  return rows;
}

function parseStackedWarehouseRow(lines, startIndex) {
  const warehouseOrder = String(lines[startIndex] || "").trim();
  let cursor = startIndex + 1;
  const fromHandlingUnit = extractHandlingUnit(lines[cursor] || "");
  if (fromHandlingUnit) cursor += 1;

  const fromBin = extractBin(lines[cursor] || "");
  if (!fromBin) return null;
  cursor += 1;

  const productInfo = parseProductTokens([lines[cursor] || ""], 0);
  if (!productInfo.value) return null;
  cursor += 1;

  if (isOcrQuantityMarker(lines[cursor] || "")) cursor += 1;
  const quantity = parseQuantityToken(lines[cursor] || "");
  if (!quantity || isSuspiciousMultiplierQuantity(quantity.value)) return null;
  cursor += 1;

  const unit = isUnitToken(lines[cursor] || "") ? normalizeUnit(lines[cursor] || "") : "Stk";
  if (isUnitToken(lines[cursor] || "")) cursor += 1;

  const descriptionParts = [];
  let toBin = "";
  while (cursor < lines.length) {
    const value = String(lines[cursor] || "").trim();
    const destination = extractDestinationBin(value);
    if (destination) {
      toBin = destination;
      cursor += 1;
      break;
    }
    if (/^\d{6,}$/.test(value)) break;
    descriptionParts.push(value);
    cursor += 1;
  }

  if (!descriptionParts.length && !toBin) return null;

  const remainingText = descriptionParts.join(" ");
  return {
    nextIndex: cursor,
    line: {
      warehouseOrder,
      fromHandlingUnit,
      fromBin,
      product: productInfo.value,
      description: cleanProductDescription(remainingText, toBin),
      targetQty: quantity.value,
      unit,
      toBin
    }
  };
}

function collectSplitWarehouseRows(lines) {
  const headers = [];
  const continuations = [];

  lines.forEach((line) => {
    const header = parseWarehouseHeader(line);
    if (header) headers.push(header);

    extractWarehouseContinuations(line).forEach((continuation) => {
      if (continuation.description || continuation.toBin) continuations.push(continuation);
    });
  });

  if (!headers.length || headers.length !== continuations.length) return [];

  return headers.map((header, index) => ({
    ...header,
    ...continuations[index]
  }));
}

function addWarehouseRow(rows, seen, line) {
  const key = warehouseLineKey(line);
  if (seen.has(key)) return false;
  rows.push(line);
  seen.add(key);
  return true;
}

function warehouseLineKey(line) {
  return [
    line.warehouseOrder,
    line.fromHandlingUnit,
    line.fromBin,
    line.product,
    line.targetQty,
    line.unit,
    line.toBin,
    line.description
  ].map((value) => String(value || "").trim().toUpperCase()).join("|");
}

function warehouseHeaderKey(line) {
  return [
    line.warehouseOrder,
    line.fromHandlingUnit,
    line.fromBin,
    line.product
  ].map((value) => String(value || "").trim().toUpperCase()).join("|");
}

function isWarehouseRowStart(line) {
  const normalizedLine = normalizeOcrWarehouseLine(line);
  const match = normalizedLine.match(/^[^\d]{0,12}(\d{6,14})\b/);
  if (!match) return false;

  const rest = normalizedLine.slice(match[0].length);
  const restTokens = warehouseTokens(rest);
  const handlingUnitInfo = parseHandlingUnitTokens(restTokens, 0);
  return Boolean(handlingUnitInfo.value || extractHandlingUnit(rest) || extractBin(rest) || findProductQuantityMatch(rest));
}

function splitPossibleMergedWarehouseRows(text) {
  const parts = normalizeOcrWarehouseLine(text)
    .split(/\s+(?=[^\d]{0,12}\d{6,14}\s+(?:[0-9OoQD]{10,}|\d{1,3}-[A-Z0-9]{1,4}-[A-Z0-9C]{2,8}|\d{4,8}\D{0,12}\d))/i)
    .filter((part) => part !== text);
  if (parts.length <= 1) return [];
  return parts.every(isPotentialWarehouseSplitPart) ? parts : [];
}

function isPotentialWarehouseSplitPart(text) {
  return Boolean(
    parseWarehouseLine(text)
    || parseWarehouseHeader(text)
    || extractWarehouseContinuations(text).length
  );
}

function normalizeOcrWarehouseLine(line) {
  return line
    .replace(/[|Â¦]/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/_+/g, " ")
    .replace(/[Â¢Â©]/g, "C")
    .replace(/[â€”â€“]/g, "-")
    .replace(/[â€š]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWarehouseLineLoose(line) {
  const normalizedLine = normalizeOcrWarehouseLine(line);
  const warehouseMatch = normalizedLine.match(/\b\d{6,}\b/);
  if (!warehouseMatch) return null;

  const warehouseOrder = warehouseMatch[0];
  const afterOrder = normalizedLine.slice(warehouseMatch.index + warehouseOrder.length);
  const productMatch = findProductQuantityMatch(afterOrder);
  if (!productMatch) return null;
  if (isSuspiciousMultiplierQuantity(productMatch.quantity)) return null;

  const beforeProduct = afterOrder.slice(0, productMatch.index);
  const afterUnit = afterOrder.slice(productMatch.index + productMatch.text.length);
  const fromHandlingUnit = extractHandlingUnit(beforeProduct);
  const fromBin = extractBin(beforeProduct);
  const toBin = extractDestinationBin(afterUnit);
  const description = cleanProductDescription(afterUnit, toBin);

  return {
    warehouseOrder,
    fromHandlingUnit,
    fromBin,
    product: productMatch.product,
    description,
    targetQty: normalizeQuantity(productMatch.quantity),
    unit: normalizeUnit(productMatch.unit),
    toBin
  };
}

function warehouseTokens(line) {
  return String(line || "")
    .replace(/\|/g, " ")
    .split(/\t+|\s{2,}/)
    .flatMap((part) => part.trim().split(/\s+/))
    .map((token) => token.replace(/^[,;]+|[,;]+$/g, ""))
    .filter(Boolean);
}

function parseWarehouseHeader(line) {
  const tokens = warehouseTokens(normalizeOcrWarehouseLine(line));
  const firstNumber = tokens.findIndex((token) => /^\d{6,}$/.test(token));
  if (firstNumber === -1) return null;

  const warehouseOrder = tokens[firstNumber];
  let cursor = firstNumber + 1;
  const handlingUnitInfo = parseHandlingUnitTokens(tokens, cursor);
  const fromHandlingUnit = handlingUnitInfo.value;
  cursor = handlingUnitInfo.next;
  const fromBin = extractBin(tokens[cursor] || "");
  if (fromBin) cursor += 1;
  const productInfo = parseProductTokens(tokens, cursor);

  if (!fromHandlingUnit || !fromBin || !productInfo.value) return null;

  return {
    warehouseOrder,
    fromHandlingUnit,
    fromBin,
    product: productInfo.value
  };
}

function parseHandlingUnitTokens(tokens, cursor) {
  const current = normalizeHandlingUnitToken(tokens[cursor] || "");
  const next = normalizeHandlingUnitToken(tokens[cursor + 1] || "");

  if (current.length >= 10 && next && isHandlingUnitContinuationToken(tokens[cursor + 1]) && `${current}${next}`.length <= 20) {
    return { value: `${current}${next}`, next: cursor + 2 };
  }
  if (current.length >= 8) return { value: current, next: cursor + 1 };

  return { value: "", next: cursor };
}

function isHandlingUnitContinuationToken(value) {
  return /^[0-9OoQD]{1,12}$/.test(String(value || ""));
}

function normalizeHandlingUnitToken(value) {
  return String(value || "").replace(/[OoQD]/g, "0").replace(/\D/g, "");
}

function parseProductTokens(tokens, cursor) {
  const current = tokens[cursor] || "";
  const next = tokens[cursor + 1] || "";

  if (/^\d{4}$/.test(current) && /^\d{3,4}$/.test(next)) {
    return { value: `${current}${next}`, next: cursor + 2 };
  }

  if (/^\d{4,}$/.test(current)) return { value: current, next: cursor + 1 };
  return { value: "", next: cursor };
}

function extractWarehouseContinuations(line) {
  const normalizedLine = normalizeOcrWarehouseLine(line);
  const unitPattern = "STK?|SI|S1|5T|KAR|PCK|PAK|VE|KG|G|M|L|PAL";
  const pattern = new RegExp(`(?:^|\\s)(?:[XVJ/\\\\]|7|71)?\\s*(\\d+(?:[,.]\\d+)?)\\s*(?:/|\\s)+\\s*(${unitPattern})\\b`, "gi");
  const matches = [...normalizedLine.matchAll(pattern)];

  return matches
    .map((match, index) => {
      const nextMatch = matches[index + 1];
      const descriptionText = normalizedLine.slice(match.index + match[0].length, nextMatch ? nextMatch.index : undefined);
      const toBin = extractDestinationBin(descriptionText);
      const description = cleanProductDescription(descriptionText, toBin);
      return {
        targetQty: match[1].replace(",", "."),
        unit: normalizeUnit(match[2]),
        description,
        toBin
      };
    })
    .filter((continuation) => continuation.targetQty && (continuation.description || continuation.toBin));
}

function findProductQuantityMatch(text) {
  const unitPattern = "ST|SI|S1|5T|STK|KAR|PCK|PAK|VE|KG|G|M|L|PAL";
  const quantityPattern = `(?:\\d+\\s*[xX]\\s*(?:\\d{1,4}(?:[,.]\\d{3})*|\\d+(?:[,.]\\d+)?)|\\d{1,4}(?:[,.]\\d{3})*|\\d+(?:[,.]\\d+)?)`;
  const matches = [...text.matchAll(new RegExp(`(?:^|\\D)(\\d{4,8})[^\\d]{0,12}(${quantityPattern})\\s*\\|?\\s*(${unitPattern})\\b`, "gi"))]
    .filter((entry) => {
      const productOffset = entry[0].indexOf(entry[1]);
      const productIndex = entry.index + productOffset;
      return !/[A-Za-z]/.test(text[productIndex - 1] || "");
    });
  const match = matches.find((entry) => entry[1].length <= 8) || matches.at(-1);
  if (!match) return null;
  const productOffset = match[0].indexOf(match[1]);
  const index = match.index + productOffset;

  return {
    index,
    text: text.slice(index, match.index + match[0].length),
    product: match[1],
    quantity: match[2],
    unit: match[3]
  };
}

function parseQuantityToken(value) {
  const compact = normalizeQuantityTokenText(value).replace(/\s+/g, "");
  if (!compact) return null;

  if (/^\d+[xX]\d+(?:[,.]\d+)?$/.test(compact)) {
    const [multiplier, quantity] = compact.split(/[xX]/);
    return { value: `${multiplier}x${normalizeQuantity(quantity)}` };
  }

  if (/^[\d.,]+$/.test(compact)) return { value: compact.replace(",", ".") };
  return null;
}

function parseWarehouseQuantityAt(tokens, cursor) {
  const splitMultiplier = parseSplitMultiplierQuantityTokens(tokens, cursor);
  if (splitMultiplier) return splitMultiplier;

  const combinedQuantity = parseQuantityWithUnitToken(tokens[cursor] || "");
  if (combinedQuantity) {
    return {
      ...combinedQuantity,
      start: cursor,
      next: cursor + 1
    };
  }

  const quantity = parseQuantityToken(tokens[cursor] || "");
  return quantity
    ? {
      ...quantity,
      start: cursor,
      next: cursor + 1
    }
    : null;
}

function parseSplitMultiplierQuantityTokens(tokens, cursor) {
  const first = compactWarehouseQuantityToken(tokens[cursor]);
  const second = compactWarehouseQuantityToken(tokens[cursor + 1]);
  const third = compactWarehouseQuantityToken(tokens[cursor + 2]);

  if (/^\d+[xX]$/.test(first) && isPlainWarehouseQuantityToken(second)) {
    return {
      value: `${first.slice(0, -1)}x${normalizeQuantity(second)}`,
      start: cursor,
      next: cursor + 2
    };
  }

  if (/^\d+$/.test(first) && /^[xX]$/.test(second) && isPlainWarehouseQuantityToken(third)) {
    return {
      value: `${first}x${normalizeQuantity(third)}`,
      start: cursor,
      next: cursor + 3
    };
  }

  return null;
}

function parseLastWarehouseQuantityInRange(tokens, start, end) {
  let quantity = null;
  for (let index = start; index < end; index += 1) {
    const parsed = parseWarehouseQuantityAt(tokens, index);
    if (!parsed || parsed.next > end) continue;
    quantity = parsed;
    index = parsed.next - 1;
  }
  return quantity;
}

function compactWarehouseQuantityToken(value) {
  return normalizeQuantityTokenText(value).replace(/\s+/g, "");
}

function isPlainWarehouseQuantityToken(value) {
  return /^\d+(?:[,.]\d+)?$/.test(String(value || ""));
}

function parseQuantityWithUnitToken(value) {
  const compact = normalizeQuantityTokenText(value).replace(/\s+/g, "");
  const match = compact.match(/^(\d+(?:[,.]\d+)?)[/ ]?([A-Za-zÄÖÜäöü]{1,5})$/);
  if (!match) return null;

  return {
    value: match[1].replace(",", "."),
    unit: normalizeUnit(match[2])
  };
}

function normalizeQuantityTokenText(value) {
  return String(value || "")
    .replace(/(\d):(\d{3})(?=\D|$)/g, "$1.$2")
    .replace(/[()[\]{}_|]/g, " ")
    .replace(/[^\d.,xXA-Za-zÃ„Ã–ÃœÃ¤Ã¶Ã¼ÃŸ/ ]+/g, " ")
    .trim();
}

function shouldSkipOcrQuantityPrefix(value, nextValue, nextUnitValue = "") {
  const nextHasQuantity = parseQuantityWithUnitToken(nextValue) || (parseQuantityToken(nextValue) && parseUnitToken(nextUnitValue));
  if (!nextHasQuantity) return false;
  const compact = String(value || "")
    .replace(/[()[\]{}_|]/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (!compact) return true;
  if (isOcrQuantityMarker(compact)) return true;
  return /^\d{1,2}$/.test(compact);
}

function isOcrQuantityMarker(value) {
  return /^(?:x|v|j|\/|\\|7|71|1)$/i.test(String(value || ""));
}

function isSuspiciousMultiplierQuantity(value) {
  const match = String(value || "").replace(/\s+/g, "").match(/^\d+x(\d+)$/i);
  return Boolean(match && match[1].length > 5);
}

function parseUnitToken(value) {
  const cleaned = String(value || "").replace(/[^A-Za-z]/g, "");
  if (!cleaned) return null;
  return { value: normalizeUnit(cleaned) };
}

function extractHandlingUnit(text) {
  const match = text.match(/[0-9OoQD]{10,}/);
  if (!match) return "";
  const value = match[0].replace(/[OoQD]/g, "0").replace(/\D/g, "");
  return value.length >= 10 ? value : "";
}

function extractBin(text) {
  const match = text.match(/\b\d{1,3}-[A-Z0-9]{1,4}-[A-Z0-9C]{2,8}\b/i);
  if (!match) return "";
  return cleanImportedWarehouseBin(match[0]);
}

function extractDestinationBin(text) {
  const source = String(text || "");
  const matches = [...source.matchAll(/9\d{3,4}\s*-\s*[A-Z0-9]+(?:[\s-]+[A-Z0-9]+){0,2}/gi)];
  const match = matches.at(-1);
  if (match) return normalizeDestinationName(trimDestinationFooterNoise(match[0], source.slice(match.index + match[0].length)));
  const fallback = source.match(/((?:9\d{3,4}|\d{4})[ -][A-Z0-9]+(?:[ -][A-Z0-9]+)*)\s*$/i);
  return fallback ? normalizeDestinationName(trimDestinationFooterNoise(fallback[1])) : "";
}

function trimDestinationFooterNoise(destination, followingText = "") {
  let value = String(destination || "").trim();
  if (/\s+\d{1,2}$/.test(value) && /^\s*[,.;:¢]/.test(String(followingText || ""))) {
    value = value.replace(/\s+\d{1,2}$/, "");
  }
  return trimDestinationWhitespaceSuffix(value);
}

function trimDestinationWhitespaceSuffix(destination) {
  const value = String(destination || "").trim();
  const match = value.match(/^((?:9\d{3,4}|\d{4})-[A-Z0-9]+(?:-[A-Z0-9]+)*)(?:\s+.+)$/i);
  return match ? match[1] : value;
}

function cleanProductDescription(value, toBin = "") {
  let description = String(value || "");
  if (toBin) {
    description = description.replace(new RegExp(`[A-Z]?${destinationPattern(toBin)}[\\s\\S]*$`, "i"), "");
  }
  description = description.replace(/[A-Z]?9\d{3,4}\s*-\s*[A-Z0-9]+(?:[\s-]+[A-Z0-9]+){0,2}[\s\S]*$/i, "");

  return description
    .replace(/^\s*[_|.-]+\s*/, "")
    .replace(/\(\s*-/g, "-")
    .replace(/[()[\]{}|_]+/g, " ")
    .replace(/^\s*(?:STK?|SI|S1|5T|KAR|PCK|PAK|VE)\b\s*/i, "")
    .replace(/^\s*(?:[\\/]+|[IVLJX17][\\/]+|[IVLJX])\s+(?=\d|[A-ZÄÖÜ])/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function destinationPattern(value) {
  return escapeRegExp(value)
    .replace(/\\-/g, "\\s*-\\s*")
    .replace(/\\ /g, "\\s+");
}

function normalizeQuantity(value) {
  return window.HLogistikImportLineHelpers.normalizeQuantity(value);
}

function parsePositionLine(position, content) {
  const quantityMatch = content.match(/(\d+(?:[,.]\d+)?)\s*(stk|st|stück|pck|pak|ve|karton|kg|g|m|l|rolle|pal)\b/i);
  const articleMatch = content.match(/\b([A-Z0-9][A-Z0-9/-]{3,})\b/);
  const targetQty = quantityMatch ? quantityMatch[1].replace(",", ".") : "";
  const unit = quantityMatch ? normalizeUnit(quantityMatch[2]) : "";
  const product = articleMatch ? articleMatch[1] : "";
  const description = content
    .replace(quantityMatch?.[0] || "", "")
    .replace(product, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { position, product, description, targetQty, unit };
}

function normalizeUnit(unit) {
  return window.HLogistikImportLineHelpers.normalizeUnit(unit);
}

function isUnitToken(value) {
  return window.HLogistikImportLineHelpers.isUnitToken(value);
}

function findCustomerFromHeader(lines) {
  const stopIndex = lines.findIndex((line) => /lagerauf/i.test(line));
  const headerLines = (stopIndex === -1 ? lines : lines.slice(0, stopIndex))
    .map((line) => line.trim())
    .filter((line) => line && !isNonCustomerHeaderLine(line));
  return headerLines[0] || "";
}

function isNonCustomerHeaderLine(line) {
  const value = String(line || "").trim();
  if (!value) return true;
  if (/^(seite|datum|druck|pdf|auftrag|auftragsnr|auftragsnummer|belegnr|kommission|lieferschein)\b/i.test(value)) return true;
  if (/hummel\s+logistik|kommissionierliste|lagerauftrag|bestellschein/i.test(value)) return true;
  if (/^\d{4,}[-\s]?\w*/.test(value)) return true;
  if (/^9\d{3}\s*-\s*[A-Z0-9]+$/i.test(value)) return true;
  if (/material|artikel|menge|lagerplatz|handling\s*unit/i.test(value)) return true;
  return false;
}

function cleanCustomerName(value) {
  return String(value || "")
    .replace(/\s*datum\s*:.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function customerGroupKeyForImport(customerName, fallback = "") {
  return normalizeCustomerGroupKey(customerName) || normalizeCustomerGroupKey(fallback);
}

function normalizeCustomerGroupKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\b(?:KUNDE|LIEFERADRESSE|EMPFAENGER|EMPFANGER)\b\s*[:#-]?/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function normalizeAutoPositionNotes(notes) {
  return window.HLogistikImportLineHelpers.normalizeAutoPositionNotes(notes);
}

function setAutoPositionNote(notes, key, value) {
  return window.HLogistikImportLineHelpers.setAutoPositionNote(notes, key, value);
}

// eslint-disable-next-line no-unused-vars
function autoPositionNoteValues(line) {
  return window.HLogistikImportLineHelpers.autoPositionNoteValues(line);
}

function combinedPositionNote(line) {
  return window.HLogistikImportLineHelpers.combinedPositionNote(line);
}

// eslint-disable-next-line no-unused-vars
function combineUniqueNoteParts(parts) {
  return window.HLogistikImportLineHelpers.combineUniqueNoteParts(parts);
}

async function applyPackageNotesForImportedLines(lines) {
  return Promise.all((Array.isArray(lines) ? lines : []).map(async (line) => {
    if (!line || line.lineType === "loading-slip") return line;
    const article = await articleForPackageNote(line.product);
    return {
      ...line,
      autoPositionNotes: setAutoPositionNote(line.autoPositionNotes, "package", packageNoteForLine(line, article))
    };
  }));
}

async function refreshPackageNoteForLine(line) {
  if (!line || line.lineType === "loading-slip") return false;
  const article = await articleForPackageNote(line.product);
  const next = setAutoPositionNote(line.autoPositionNotes, "package", packageNoteForLine(line, article));
  if (JSON.stringify(next) === JSON.stringify(normalizeAutoPositionNotes(line.autoPositionNotes))) return false;
  line.autoPositionNotes = next;
  return true;
}

async function articleForPackageNote(material) {
  const product = String(material || "").trim();
  if (!serverOnline || !product) return null;
  const warehouse = currentOrderWarehouse();
  const key = `${warehouse}:${product}`;
  if (!packageArticleLookupCache.has(key)) {
    const request = apiJson(`/api/articles/lookup/${encodeURIComponent(product)}`, {
      headers: { "X-Warehouse": warehouse }
    }).catch(() => null);
    packageArticleLookupCache.set(key, request);
  }
  return packageArticleLookupCache.get(key);
}

function packageNoteForLine(line, article) {
  const quantity = window.HLogistikQuantityFormat?.parse(line?.targetQty);
  const quantityPerPackage = Number(article?.mengeProKarton || 0);
  const packageType = String(article?.gebindeArt || "").trim().toUpperCase();
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(quantityPerPackage) || quantityPerPackage <= 0 || !packageType) return "";
  return `${Math.ceil(quantity / quantityPerPackage)}${packageType}`;
}

function findFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return "";
}

function createLine(overrides = {}) {
  return {
    id: createId(),
    warehouseOrder: "",
    fromHandlingUnit: "",
    fromHandlingUnitEditable: true,
    positionNote: "",
    autoPositionNotes: {},
    binWarning: "",
    binWarningValue: "",
    binWarningType: "",
    fromBinReviewConfirmedValue: "",
    fromBin: "",
    product: "",
    description: "",
    toBin: "",
    targetQty: "",
    actualQty: "",
    unit: "Stk",
    picked: false,
    ...overrides
  };
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function code128Svg(value) {
  return window.HLogistikUiHelpers.code128Svg(value);
}

// eslint-disable-next-line no-unused-vars
function escapeSvgText(value) {
  return window.HLogistikUiHelpers.escapeSvgText(value);
}

// eslint-disable-next-line no-unused-vars
function escapeHtmlAttribute(value) {
  return window.HLogistikUiHelpers.escapeHtmlAttribute(value);
}

function setHandlingUnitEditMode(input, canEdit, options = {}) {
  input.readOnly = !canEdit;
  input.classList.toggle("is-editable-hu", canEdit);
  input.inputMode = options.useSsiStorageHuPrefix ? "numeric" : "text";
  if (options.useSsiStorageHuPrefix) {
    input.pattern = "[0-9]*";
    input.maxLength = SSI_STORAGE_HU_LENGTH;
  } else {
    input.removeAttribute("pattern");
    input.removeAttribute("maxlength");
  }

  if (canEdit) {
    input.removeAttribute("readonly");
    input.placeholder = options.useSsiStorageHuPrefix ? `${SSI_STORAGE_HU_PREFIX} + 7 Stellen` : "HU eintragen";
    return;
  }

  input.setAttribute("readonly", "");
  input.placeholder = "Handling Unit";
}

function setNumericInputMode(input) {
  if (!input) return;
  input.inputMode = "numeric";
  input.pattern = "[0-9]*";
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isSsiStorageOrderContext(orderType = state.orderType || currentMode, customerName = state.customerName) {
  return orderType === "storage" && storageOrderUsesSsiCustomer(customerName);
}

function normalizeSsiStorageHandlingUnit(value) {
  return STORAGE_HU_RULES.normalizeHandlingUnit(value);
}

function isCompleteSsiStorageHandlingUnit(value) {
  return STORAGE_HU_RULES.isComplete(value);
}

function isIncompleteSsiStorageHandlingUnit(value) {
  return STORAGE_HU_RULES.isIncomplete(value);
}

function isMissingOrIncompleteHandlingUnit(value) {
  const text = String(value || "").trim();
  return !text || isIncompleteSsiStorageHandlingUnit(text);
}

function storageHandlingUnitDisplayValue(value, useSsiStorageHuPrefix) {
  return useSsiStorageHuPrefix ? normalizeSsiStorageHandlingUnit(value) : value || "";
}

function normalizeStorageHandlingUnits(lines, useSsiStorageHuPrefix) {
  return (Array.isArray(lines) ? lines : []).map((line) => {
    if (!line || line.lineType === "loading-slip") return line;
    if (!useSsiStorageHuPrefix) {
      const fromHandlingUnit = stripSsiStorageHandlingUnitPrefix(line.fromHandlingUnit);
      return fromHandlingUnit === line.fromHandlingUnit ? line : { ...line, fromHandlingUnit };
    }
    return {
      ...line,
      fromHandlingUnit: normalizeSsiStorageHandlingUnit(line.fromHandlingUnit),
      fromHandlingUnitEditable: true
    };
  });
}

function stripSsiStorageHandlingUnitPrefix(value) {
  return STORAGE_HU_RULES.stripPrefix(value);
}

function render() {
  renderModeControls();
  renderWarehouseHint();
  renderSaveOrderButton();
  renderReleaseButton();
  renderDiscardButton();
  renderTakeOverButton();
  renderDeleteOrderButton();
  syncFields();
  renderTopControls();
  elements.pickList.innerHTML = "";
  elements.emptyState.hidden = state.lines.length > 0;
  elements.pickHeader.hidden = state.lines.length === 0;

  const importOrder = new Map(state.lines.map((line, index) => [line.id, index]));

  // The picking view is sorted by storage location. Exports keep state.lines in import order.
  getPickingLines(importOrder).forEach((line) => {
    const isStorageLine = state.orderType === "storage";
    const isManualStorageLine = isStorageLine && line.manual === true;
    const useSsiStorageHuPrefix = isStorageLine && isSsiStorageOrderContext();
    const item = elements.lineTemplate.content.firstElementChild.cloneNode(true);
    item.dataset.id = line.id;
    item.dataset.product = String(line.product || "").trim();
    item.dataset.warehouseOrder = String(line.warehouseOrder || "").trim();
    item.classList.toggle("is-done", line.picked);
    item.classList.toggle("is-collapsed", line.picked);
    item.classList.toggle("is-loading-slip", line.lineType === "loading-slip");
    item.classList.toggle("is-manual-storage", isManualStorageLine);
    const binWarningText = String(line.binWarning || "").trim();
    item.classList.toggle("has-bin-warning", Boolean(binWarningText));

    const map = {
      picked: item.querySelector(".picked-button"),
      fromHandlingUnit: item.querySelector(".from-hu-input"),
      positionNote: item.querySelector(".position-note-input"),
      fromBin: item.querySelector(".from-bin-input"),
      product: item.querySelector(".product-input"),
      description: item.querySelector(".description-input"),
      targetQty: item.querySelector(".target-qty-input"),
      actualQty: item.querySelector(".actual-qty-input"),
      unit: item.querySelector(".unit-input")
    };
    const huLabel = item.querySelector(".hu-label");
    if (huLabel) huLabel.textContent = isStorageLine ? "HU" : "Von HU";

    if (line.lineType === "loading-slip") {
      renderLoadingSlipLine(item, map, line);
      elements.pickList.appendChild(item);
      return;
    }

    map.picked.setAttribute("aria-pressed", line.picked ? "true" : "false");
    const canEditHandlingUnit = isStorageLine || state.awaitingRelease || line.fromHandlingUnitEditable === true || isMissingOrIncompleteHandlingUnit(line.fromHandlingUnit);
    map.fromHandlingUnit.value = storageHandlingUnitDisplayValue(line.fromHandlingUnit, useSsiStorageHuPrefix);
    map.positionNote.value = combinedPositionNote(line);
    map.product.value = line.product || "";
    map.description.value = line.description;
    map.targetQty.value = formatLineQuantityForDisplay(line, line.targetQty);
    map.actualQty.value = formatLineQuantityForDisplay(line, line.actualQty);
    map.unit.value = line.unit;
    map.product.readOnly = !isManualStorageLine;
    setNumericInputMode(map.product);
    map.description.readOnly = !isManualStorageLine;
    setHandlingUnitEditMode(map.fromHandlingUnit, canEditHandlingUnit, { useSsiStorageHuPrefix });
    const canEditBin = isStorageLine || state.awaitingRelease || Boolean(binWarningText);
    const fullFromBin = line.fromBin || "";
    map.fromBin.value = !isStorageLine && !canEditBin ? formatPickingBinForDisplay(fullFromBin) : fullFromBin;
    map.fromBin.dataset.fullValue = !isStorageLine && !canEditBin && map.fromBin.value !== fullFromBin ? fullFromBin : "";
    map.fromBin.readOnly = !canEditBin;
    map.fromBin.placeholder = isStorageLine ? "Stellplatz" : "Lagerplatz";
    map.fromBin.setAttribute("autocapitalize", "characters");
    map.fromBin.classList.add("uppercase-input");
    map.fromBin.classList.toggle("is-warning", Boolean(binWarningText));
    map.fromBin.title = binWarningText || (!isStorageLine && map.fromBin.value !== fullFromBin ? fullFromBin : "");
    map.fromHandlingUnit.placeholder = isStorageLine
      ? (useSsiStorageHuPrefix ? `${SSI_STORAGE_HU_PREFIX} + 7 Stellen` : "HU eintragen")
      : map.fromHandlingUnit.placeholder;
    if (isManualStorageLine) {
      (map.targetQty.closest("label") || map.targetQty).remove();
      map.actualQty.placeholder = "Stückzahl";
      map.actualQty.setAttribute("aria-label", "Stückzahl");
    } else {
      map.targetQty.readOnly = true;
      map.actualQty.placeholder = "Ist";
      map.actualQty.setAttribute("aria-label", "Ist");
    }
    map.actualQty.readOnly = false;
    map.actualQty.classList.remove("readonly-input");
    map.unit.readOnly = !isManualStorageLine;

    const setPicked = (picked) => {
      if (picked && storageLineCompletionErrors(line).length) {
        setServerStatus(storageLineErrorMessage(line), "error");
        return;
      }
      map.picked.setAttribute("aria-pressed", picked ? "true" : "false");
      updateLine(line.id, { picked }, false);
      item.classList.toggle("is-done", picked);
      item.classList.toggle("is-collapsed", picked);
    };

    map.picked.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setPicked(map.picked.getAttribute("aria-pressed") !== "true");
    });
    map.fromHandlingUnit.addEventListener("input", () => {
      if (useSsiStorageHuPrefix) map.fromHandlingUnit.value = normalizeSsiStorageHandlingUnit(map.fromHandlingUnit.value);
      updateLine(line.id, { fromHandlingUnit: map.fromHandlingUnit.value, fromHandlingUnitEditable: canEditHandlingUnit }, false);
    });
    map.positionNote.addEventListener("input", () => updateLine(line.id, { positionNote: map.positionNote.value }, false));
    map.fromBin.addEventListener("input", () => {
      const skipFromBinReview = isPickingXlsxOrder();
      if (canEditBin && !skipFromBinReview) map.fromBin.value = map.fromBin.value.toUpperCase();
      const reviewWasConfirmed = !skipFromBinReview && isFromBinReviewConfirmedForValue(line.fromBin, line);
      const reviewPatch = skipFromBinReview
        ? noFromBinReviewPatch()
        : fromBinReviewPatchForValue(map.fromBin.value, line);
      const patch = { fromBin: map.fromBin.value, ...reviewPatch };
      const clearWarning = !skipFromBinReview && shouldClearBinWarning(line, map.fromBin.value);
      if (clearWarning) {
        patch.binWarning = "";
        patch.binWarningValue = "";
        patch.binWarningType = "";
        patch.fromBinReviewRequired = false;
        patch.fromBinReviewReason = "";
        patch.fromBinReviewBlocksRelease = false;
        patch.fromBinReviewBlocksExport = false;
        patch.fromBinManualCorrectionClearsWarning = false;
        patch.fromBinReviewConfirmedValue = "";
      }
      const reviewConfirmationInvalidated = reviewWasConfirmed && !isFromBinReviewConfirmedForValue(map.fromBin.value, patch);
      const reviewWarningChanged = Boolean(line.fromBinReviewRequired) !== Boolean(patch.fromBinReviewRequired)
        || String(line.binWarning || "") !== String(patch.binWarning || "");
      updateLine(line.id, patch, clearWarning || reviewConfirmationInvalidated || reviewWarningChanged);
    });
    map.product.addEventListener("input", () => {
      map.product.value = normalizeDigits(map.product.value);
      updateLine(line.id, { product: map.product.value }, false);
    });
    map.description.addEventListener("input", () => updateLine(line.id, { description: map.description.value }, false));
    if (!isManualStorageLine) {
      map.targetQty.addEventListener("input", () => updateLine(line.id, { targetQty: map.targetQty.value, quantitySourceText: "" }, false));
    }
    map.actualQty.addEventListener("input", () => {
      const patch = { actualQty: map.actualQty.value, quantitySourceText: "" };
      if (Number(line.stockQty || 0) > 0) {
        const quantityRemark = storageQuantityRemarkForLine({ ...line, actualQty: map.actualQty.value }, Number(line.stockQty || 0));
        patch.autoPositionNotes = setAutoPositionNote(line.autoPositionNotes, "quantity", quantityRemark);
      }
      updateLine(line.id, patch, false);
      map.positionNote.value = combinedPositionNote(line);
    });
    map.unit.addEventListener("input", () => updateLine(line.id, { unit: map.unit.value }, false));

    if (binWarningText) renderBinWarning(item, binWarningText, line);
    else if (isFromBinReviewConfirmedForValue(line.fromBin, line)) renderFromBinReviewConfirmation(item, line);
    if (isManualStorageLine) renderManualStorageDeleteButton(item, line);

    elements.pickList.appendChild(item);
  });

  renderStorageLineActions();
  updateCounts();
}

function renderStorageLineActions() {
  if (!elements.storageLineActions || !elements.addStorageLineButton) return;
  const isStorage = currentMode === "storage" || state.orderType === "storage";
  elements.storageLineActions.hidden = !isStorage;
  elements.addStorageLineButton.disabled = !isStorage;
  if (elements.manualStorageMaterialInput) elements.manualStorageMaterialInput.disabled = !isStorage;
  if (elements.manualStorageBinInput) elements.manualStorageBinInput.disabled = !isStorage;
  if (elements.manualStoragePositionCountInput) {
    elements.manualStoragePositionCountInput.disabled = !isStorage;
    elements.manualStoragePositionCountInput.min = String(MANUAL_STORAGE_POSITION_CREATE_COUNT_MIN);
    elements.manualStoragePositionCountInput.max = String(MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX);
  }
  if (elements.manualStorageQuantityInput) {
    elements.manualStorageQuantityInput.disabled = !isStorage;
    elements.manualStorageQuantityInput.min = "1";
  }
}

function renderBinWarning(item, message, line) {
  const body = item.querySelector(".line-body");
  if (!body) return;
  const warning = document.createElement("p");
  warning.className = "bin-warning";
  warning.textContent = message;
  body.appendChild(warning);
  if (!canConfirmFromBinReview(line)) return;
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "secondary-button";
  confirmButton.textContent = "Stellplatz geprüft";
  confirmButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    confirmFromBinReview(line.id);
  });
  body.appendChild(confirmButton);
}

function renderFromBinReviewConfirmation(item, line) {
  const body = item.querySelector(".line-body");
  if (!body) return;
  const note = document.createElement("p");
  note.className = "import-status is-ok";
  note.textContent = fromBinReviewConfirmationMessage(line.fromBin);
  body.appendChild(note);
}

function confirmFromBinReview(lineId) {
  const line = state.lines.find((entry) => entry.id === lineId);
  if (!line || line.lineType === "loading-slip") return;
  const bin = normalizePickingBinText(line.fromBin);
  if (!bin) {
    setServerStatus("Von-Lagerplatz fehlt und kann nicht als geprüft bestätigt werden.", "error");
    return;
  }
  if (!fromBinReviewDiagnosticForValue(bin).fromBinReviewRequired) {
    setServerStatus("Für diesen Von-Lagerplatz ist keine manuelle Prüfung offen.", "ok");
    return;
  }
  const message = fromBinReviewConfirmationMessage(bin);
  updateLine(line.id, {
    ...fromBinReviewConfirmedPatchForValue(bin)
  }, true);
  setImportStatus(message, "ok", 100);
  setServerStatus(message, "ok");
}

async function addManualStorageLine() {
  if (!requireCurrentUser()) return;
  const countResult = readManualStoragePositionCreateCount();
  if (!countResult.ok) {
    setServerStatus(countResult.error, "error");
    elements.manualStoragePositionCountInput?.focus();
    return;
  }
  const quantityResult = readManualStoragePositionQuantity();
  if (!quantityResult.ok) {
    setServerStatus(quantityResult.error, "error");
    elements.manualStorageQuantityInput?.focus();
    return;
  }
  const binResult = readManualStorageBin();
  if (!binResult.ok) {
    setServerStatus(binResult.error, "error");
    elements.manualStorageBinInput?.focus();
    return;
  }
  const material = normalizeDigits(elements.manualStorageMaterialInput?.value || "");
  const preset = await manualStorageLinePreset(material);

  currentMode = "storage";
  localStorage.setItem(MODE_KEY, currentMode);
  state.orderType = "storage";
  state.orderWarehouse = currentOrderWarehouse();
  state.orderDate = state.orderDate || new Date().toISOString().slice(0, 10);
  state.orderTime = state.orderTime || currentTimeValue();
  state.orderNumber = state.orderNumber || await nextStorageOrderNumber();
  state.customerName = "SSI";
  state.createdBy = state.createdBy || currentUser.name;
  state.awaitingRelease = state.awaitingRelease || !state.id;
  for (let index = 0; index < countResult.value; index += 1) {
    state.lines.push(createManualStorageLine(preset, { actualQty: quantityResult.value, fromBin: binResult.value }));
  }
  if (elements.manualStorageMaterialInput) elements.manualStorageMaterialInput.value = "";
  if (elements.manualStorageBinInput) elements.manualStorageBinInput.value = "";
  if (elements.manualStoragePositionCountInput) elements.manualStoragePositionCountInput.value = String(MANUAL_STORAGE_POSITION_CREATE_COUNT_DEFAULT);
  if (elements.manualStorageQuantityInput) elements.manualStorageQuantityInput.value = "1";
  topControlsCollapsed = false;
  markOrderTouched();
  saveAndRender();
  setServerStatus(`${countResult.value} manuelle Einlagerposition${countResult.value === 1 ? "" : "en"} angelegt.`, "ok");
}

function createManualStorageLine(preset = {}, options = {}) {
  return createLine({
    orderType: "storage",
    manual: true,
    warehouseOrder: nextManualStoragePosition(),
    fromHandlingUnit: isSsiStorageOrderContext() ? SSI_STORAGE_HU_PREFIX : "",
    fromHandlingUnitEditable: true,
    product: preset.product || "",
    description: preset.description || "",
    fromBin: options.fromBin || "",
    targetQty: "",
    actualQty: options.actualQty || "",
    unit: preset.unit || "Stk"
  });
}

function nextManualStoragePosition() {
  return MANUAL_STORAGE_RULES.nextPositionName(state.lines);
}

function readManualStoragePositionCreateCount() {
  const raw = String(elements.manualStoragePositionCountInput?.value || MANUAL_STORAGE_POSITION_CREATE_COUNT_DEFAULT).trim();
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MANUAL_STORAGE_POSITION_CREATE_COUNT_MIN) {
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
      error: `Anzahl Positionen darf maximal ${MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX} betragen.`
    };
  }
  return { ok: true, value, error: "" };
}

function readManualStoragePositionQuantity() {
  const raw = String(elements.manualStorageQuantityInput?.value || "").trim();
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value <= 0) {
    return {
      ok: false,
      value: "",
      error: "Stückzahl muss eine positive ganze Zahl sein."
    };
  }
  return { ok: true, value: String(value), error: "" };
}

function readManualStorageBin() {
  const raw = String(elements.manualStorageBinInput?.value || "").trim();
  if (!raw) return { ok: true, value: "", error: "" };
  const value = window.HLogistikStorageBinRules?.normalizeSsiStorageBin(raw) || "";
  if (!value) {
    return { ok: false, value: "", error: `Stellplatz "${raw}" ist für SSI nicht bekannt.` };
  }
  return { ok: true, value, error: "" };
}

async function manualStorageLinePreset(material) {
  const product = normalizeDigits(material);
  if (!product) return {};
  const preset = { product };
  try {
    const article = await apiJson(`/api/articles/lookup/${encodeURIComponent(product)}?warehouse=${encodeURIComponent(currentOrderWarehouse())}`);
    preset.product = String(article.materialnummer || product).trim();
    preset.description = String(article.materialbezeichnung || "").trim();
  } catch {
    // Artikelstamm-Lookup ist Komfort; unbekannte Artikel bleiben manuell erfassbar.
  }
  return preset;
}

function renderManualStorageDeleteButton(item, line) {
  const locationRow = item.querySelector(".location-row");
  if (!locationRow) return;
  locationRow.classList.add("has-manual-delete");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "danger-button manual-line-delete";
  button.textContent = "Zeile loeschen";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeManualStorageLine(line.id);
  });
  locationRow.appendChild(button);
}

function removeManualStorageLine(id) {
  const line = state.lines.find((entry) => entry.id === id);
  if (!line || line.manual !== true) return;
  if (manualStorageLineHasContent(line) && !confirm("Manuell hinzugefuegte Zeile wirklich loeschen?")) return;
  state.lines = state.lines.filter((entry) => entry.id !== id);
  markOrderTouched();
  saveState();
  render();
  setServerStatus("Manuelle Einlagerposition geloescht.", "ok");
}

function manualStorageLineHasContent(line) {
  const handlingUnit = isSsiStorageOrderContext()
    ? (isCompleteSsiStorageHandlingUnit(line.fromHandlingUnit) ? line.fromHandlingUnit : "")
    : line.fromHandlingUnit;
  return [
    line.product,
    line.description,
    line.actualQty,
    handlingUnit,
    line.fromBin,
    line.positionNote
  ].some((value) => String(value ?? "").trim());
}

function isEmptyManualStorageLine(line) {
  return line?.manual === true && !manualStorageLineHasContent(line);
}

function pruneEmptyManualStorageLines() {
  const before = state.lines.length;
  state.lines = state.lines.filter((line) => !isEmptyManualStorageLine(line));
  if (state.lines.length !== before) {
    markOrderTouched();
    saveState();
  }
}

function storageOrderExportMessage() {
  if ((state.orderType || currentMode) !== "storage") return "";
  const errors = [];
  state.lines.forEach((line, index) => {
    if (isEmptyManualStorageLine(line)) return;
    storageLineCompletionErrors(line).forEach((error) => {
      errors.push(`Pos. ${line.warehouseOrder || index + 1}: ${error}`);
    });
  });
  if (!errors.length) return "";
  return `Einlagerung unvollstaendig: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? "; weitere Fehler vorhanden" : ""}`;
}

function storageLineErrorMessage(line) {
  return `Position kann noch nicht erledigt werden: ${storageLineCompletionErrors(line).join(", ")}`;
}

function storageLineCompletionErrors(line) {
  if ((state.orderType || currentMode) !== "storage" || !line || line.lineType === "loading-slip" || isEmptyManualStorageLine(line)) return [];
  const errors = [];
  const product = String(line.product || "").trim();
  const handlingUnit = String(line.fromHandlingUnit || "").trim();
  if (!product) errors.push("Artikelnummer fehlt");
  else if (!/^\d+$/.test(product)) errors.push("Artikelnummer darf nur Zahlen enthalten");
  if (!String(line.fromBin || "").trim()) errors.push("Stellplatz fehlt");
  if (currentStorageRequiresHandlingUnit()) {
    if (isSsiStorageOrderContext()) {
      if (!isCompleteSsiStorageHandlingUnit(handlingUnit)) {
        errors.push(`HU muss mit ${SSI_STORAGE_HU_PREFIX} beginnen und danach ${SSI_STORAGE_HU_SUFFIX_LENGTH} Ziffern enthalten`);
      }
    } else if (!handlingUnit) {
      errors.push("HU fehlt");
    }
  }
  if (!readPositiveQuantity(line.actualQty || line.targetQty)) errors.push("Menge fehlt");
  return errors;
}

function readPositiveQuantity(value) {
  return window.HLogistikImportLineHelpers.readPositiveQuantity(value);
}

function parseStorageSlipText(text, _fileName = "", pageTexts = []) {
  const cleanedLines = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeStorageOcrLine(line))
    .filter(Boolean);

  const pageRows = collectStoragePageRows(pageTexts);
  const sourceRows = pageRows.rows.length || pageRows.warnings.length ? pageRows.rows : collectStorageRows(cleanedLines);
  const lines = sourceRows.flatMap((line) => expandStoragePalletRows(line)).map((line) => createLine({
    orderType: "storage",
    warehouseOrder: line.position,
    fromHandlingUnit: "",
    fromHandlingUnitEditable: true,
    fromBin: "",
    product: line.product,
    description: line.description || "",
    ...canonicalImportedQuantity(line.targetQty),
    unit: line.unit || "Stk",
    palletInfo: line.palletInfo,
    positionNote: "",
    autoPositionNotes: setAutoPositionNote({}, "storagePallet", line.palletInfo),
    picked: false
  }));

  return {
    orderNumber: "",
    customerName: "SSI",
    customerGroupKey: customerGroupKeyForImport("SSI"),
    lines,
    warnings: pageRows.warnings
  };
}

function collectStoragePageRows(pageTexts = []) {
  const rows = [];
  const warnings = [];
  const seen = new Set();

  (Array.isArray(pageTexts) ? pageTexts : []).forEach((pageText, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const rawLines = String(pageText || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    rawLines.forEach((line) => {
      const parsed = parseStoragePageLine(line, pageNumber);
      if (parsed?.row) {
        const row = parsed.row;
        const key = `${row.product}-${row.palletCount}-${row.containerCode}-${row.targetQty}-${row.description}-${pageNumber}`;
        if (seen.has(key)) return;
        row.position = String(rows.length + 1);
        rows.push(row);
        seen.add(key);
        return;
      }

      if (parsed?.warning) warnings.push(parsed.warning);
    });
  });

  return { rows, warnings };
}

function parseStoragePageLine(line, pageNumber) {
  if (isStorageFooterLine(line)) return null;

  const cells = splitStoragePageCells(line);
  if (!cells.length || !/^\d{6,8}$/.test(cells[0] || "")) return null;

  if (cells.length < 4) {
    return { warning: `Seite ${pageNumber}: Zeile ${cells[0]} hat weniger als 4 Spalten.` };
  }

  const product = cells[0];
  if (!isLikelyStorageProductCode(product)) return null;
  const palletInfo = parseStoragePalletCell(cells[1]);
  const rawQuantity = parseStorageQuantityNumber(cells[2]);
  const description = cells.slice(3).join(" ").trim();

  if (!palletInfo.palletCount) return { warning: `Seite ${pageNumber}, Artikel ${product}: Palettenanzahl fehlt oder ist ungueltig.` };
  if (!rawQuantity || rawQuantity <= 0) return { warning: `Seite ${pageNumber}, Artikel ${product}: Menge fehlt oder ist ungueltig.` };
  if (!description) return { warning: `Seite ${pageNumber}, Artikel ${product}: Artikelbezeichnung fehlt.` };

  let perPalletQty = rawQuantity;
  if (pageNumber === 1) {
    if (rawQuantity % palletInfo.palletCount !== 0) {
      return { warning: `Seite ${pageNumber}, Artikel ${product}: Gesamtstueckzahl ${rawQuantity} ist nicht durch ${palletInfo.palletCount} Palette(n) teilbar.` };
    }
    perPalletQty = rawQuantity / palletInfo.palletCount;
  }

  return {
    row: {
      position: "",
      product,
      palletCount: palletInfo.palletCount,
      containerCode: palletInfo.containerCode,
      palletUnit: palletInfo.palletUnit,
      palletInfo: storagePalletInfoText(palletInfo),
      targetQty: formatStorageQuantity(perPalletQty),
      unit: "Stk",
      description,
      isPerPalletQty: true
    }
  };
}

function splitStoragePageCells(line) {
  const cells = String(line || "")
    .split("\t")
    .map((cell) => normalizeStorageOcrLine(cell))
    .filter(Boolean);
  if (cells.length >= 4) return cells;
  return [];
}

function parseStoragePalletCell(value) {
  const text = String(value || "").trim();
  const containerCode = normalizeStorageContainerCode((text.match(/C\s*[0-9Iil|]/i) || [])[0]);
  const palletUnit = parseStoragePalletUnit(text);
  const withoutContainer = text
    .replace(/C\s*[0-9Iil|]/gi, " ")
    .replace(/kar\.?/gi, " ");
  const palletMatch = withoutContainer.match(/\b(\d{1,2})\s*(?:pal(?:ette|etten)?|pal\.|pallets?)?\b/i)
    || withoutContainer.match(/(\d{1,2})(?=\s*(?:pal|palette|paletten|pallets?))/i)
    || withoutContainer.match(/\b(\d{1,2})\b/);
  const palletCount = palletMatch ? Number(palletMatch[1]) : 0;
  return {
    palletCount: Number.isInteger(palletCount) && palletCount > 0 && palletCount <= 12 ? palletCount : 0,
    containerCode,
    palletUnit
  };
}

function parseStoragePalletUnit(value) {
  return /kar\.?/i.test(String(value || "")) ? "Kar." : "";
}

function storagePalletInfoText(palletInfo) {
  if (palletInfo.palletUnit) return `${palletInfo.palletCount} ${palletInfo.palletUnit}`;
  return `${palletInfo.palletCount} Palette${palletInfo.palletCount === 1 ? "" : "n"}`;
}

function collectStorageRows(lines) {
  const rows = [];
  const seen = new Set();

  for (const line of lines) {
    if (isStorageFooterLine(line)) continue;
    const row = parseStorageLine(line);
    if (!row || seen.has(`${row.product}-${row.palletCount}-${row.containerCode}-${row.targetQty}-${row.description}`)) continue;
    row.position = String(rows.length + 1);
    rows.push(row);
    seen.add(`${row.product}-${row.palletCount}-${row.containerCode}-${row.targetQty}-${row.description}`);
  }

  return rows;
}

function expandStoragePalletRows(row) {
  const palletCount = Math.max(row.palletCount || parsePalletCount(row.palletInfo), 1);
  const totalQty = parseStorageQuantityNumber(row.targetQty);
  const shouldSplitQty = !row.isPerPalletQty && totalQty && palletCount > 1 && !row.containerCode;
  const perPalletQty = shouldSplitQty ? totalQty / palletCount : totalQty;
  const formattedQty = formatStorageQuantity(perPalletQty || row.targetQty);
  const unitLabel = row.palletUnit || "Palette";

  return Array.from({ length: palletCount }, (_, index) => ({
    ...row,
    position: `${row.position}.${index + 1}`,
    targetQty: formattedQty,
    palletInfo: [
      palletCount > 1 ? `${unitLabel} ${index + 1}/${palletCount}` : row.palletInfo,
      row.containerCode
    ].filter(Boolean).join(" - ")
  }));
}

function parseStorageLine(line) {
  if (/material|artikelbezeichnung|summe|lieferschein|hummel logistik/i.test(line) || isStorageFooterLine(line)) return null;

  const fixedRow = parseStorageFixedOcrLine(line);
  if (fixedRow) return fixedRow;

  const materialMatch = line.match(/\b(\d{6,8})\b/);
  if (!materialMatch) return null;

  const product = materialMatch[1];
  if (!isLikelyStorageProductCode(product)) return null;
  const rest = line.slice(materialMatch.index + materialMatch[0].length).trim();
  const quantityMatch = findStorageQuantityMatch(rest);
  if (!quantityMatch) return null;

  const beforeQuantity = rest.slice(0, quantityMatch.index).trim();
  const afterQuantity = rest.slice(quantityMatch.index + quantityMatch.raw.length).trim();
  const context = `${beforeQuantity} ${afterQuantity}`.trim();
  const palletCount = parseStoragePalletCount(context);
  const containerCode = normalizeStorageContainerCode((context.match(/\bC\s*\d+\b/i) || [])[0]);
  const targetQty = normalizeStorageQuantity(quantityMatch.value);
  const targetQtyNumber = parseStorageQuantityNumber(targetQty);
  const description = cleanStorageDescription(beforeQuantity, palletCount);
  const unit = normalizeStorageUnit(quantityMatch.unit);

  if (!product || !targetQty || /^0+$/.test(targetQty.replace(/[^\d]/g, ""))) return null;
  if (!Number.isInteger(palletCount) || palletCount < 1 || palletCount > 12) return null;
  if (!Number.isFinite(targetQtyNumber) || targetQtyNumber < palletCount || targetQtyNumber > 150000) return null;

  return {
    position: "",
    product,
    palletCount,
    containerCode,
    palletInfo: `${palletCount} Palette${palletCount === 1 ? "" : "n"}`,
    targetQty,
    unit,
    description
  };
}

function parseStorageFixedOcrLine(line) {
  const normalizedLine = normalizeStorageOcrLine(line);
  const materialMatch = normalizedLine.match(/\b(\d{6,8})\b/);
  if (!materialMatch) return null;

  const product = materialMatch[1];
  if (!isLikelyStorageProductCode(product)) return null;
  const rest = normalizedLine.slice(materialMatch.index + materialMatch[0].length).trim();
  const tokens = rest.split(/\s+/).filter(Boolean);
  const quantityIndex = tokens.findIndex((token, index) => index > 0 && isStorageFixedQuantityToken(token));
  if (quantityIndex < 1) return null;

  const palletCell = tokens.slice(0, quantityIndex).join(" ");
  const palletInfo = parseStoragePalletCell(palletCell);
  if (!palletInfo.palletCount) return null;

  const quantity = parseStorageFixedQuantityToken(tokens[quantityIndex]);
  if (!quantity || quantity.value <= 0) return null;

  let descriptionIndex = quantityIndex + 1;
  let unit = quantity.unit || "";
  if (!unit && isStorageUnitToken(tokens[descriptionIndex])) {
    unit = tokens[descriptionIndex];
    descriptionIndex += 1;
  }

  const description = cleanStorageFixedDescription(tokens.slice(descriptionIndex).join(" "));
  if (!description) return null;

  return {
    position: "",
    product,
    palletCount: palletInfo.palletCount,
    containerCode: palletInfo.containerCode,
    palletUnit: palletInfo.palletUnit,
    palletInfo: storagePalletInfoText(palletInfo),
    targetQty: formatStorageQuantity(quantity.value),
    unit: normalizeStorageUnit(unit),
    description,
    isPerPalletQty: Boolean(palletInfo.containerCode || palletInfo.palletUnit)
  };
}

function isStorageFixedQuantityToken(token) {
  const parsed = parseStorageFixedQuantityToken(token);
  return Boolean(parsed && parsed.value >= 100);
}

function parseStorageFixedQuantityToken(token) {
  const match = String(token || "").match(/^(\d{1,3}(?:[.,]\d{3})+|\d{4,6})(?:\s*(st\.?|stk\.?|stueck|st.?ck|pcs))?$/i);
  if (!match) return null;
  return {
    value: parseStorageQuantityNumber(match[1]),
    unit: match[2] || ""
  };
}

function isStorageUnitToken(token) {
  return /^(st\.?|stk\.?|stueck|st.?ck|pcs)$/i.test(String(token || ""));
}

function cleanStorageFixedDescription(value) {
  return String(value || "")
    .replace(/^[^\dA-Za-zÄÖÜäöüß]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isStorageFooterLine(line) {
  const text = normalizeStorageOcrLine(line);
  if (!text) return false;
  if (/ware erhalten|fo.?_?mawi|erstellt|freigegeben|datum|berschneider|virduzzo/i.test(text)) return true;
  const dates = text.match(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g) || [];
  return dates.length >= 2;
}

function isLikelyStorageProductCode(value) {
  const product = String(value || "").trim();
  if (!/^\d{6,8}$/.test(product)) return false;
  if (/^\d{8}$/.test(product) && isCompactDateValue(product)) return false;
  return true;
}

function isCompactDateValue(value) {
  const text = String(value || "");
  const day = Number(text.slice(0, 2));
  const month = Number(text.slice(2, 4));
  const year = Number(text.slice(4, 8));
  return day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2099;
}

function findStorageQuantityMatch(text) {
  const matches = [...String(text || "").matchAll(/\b(\d{1,3}(?:[.,]\d{3})+|\d{1,6})(?:\s*(st\.?|stk\.?|stueck|st.?ck|pcs))?\b/gi)]
    .map((match) => ({
      raw: match[0],
      value: match[1],
      unit: match[2] || "",
      index: match.index
    }));
  if (!matches.length) return null;

  const withUnit = matches.filter((match) => match.unit);
  return (withUnit.length ? withUnit : matches).at(-1);
}

function parseStoragePalletCount(text) {
  const explicit = String(text || "").match(/\b(\d{1,2})\s*(?:pal(?:ette|etten)?|pal\.|pallets?)\b/i);
  if (explicit) return Number(explicit[1]) || 1;

  const withoutContainers = String(text || "").replace(/\bC\s*\d+\b/gi, " ");
  const smallNumbers = [...withoutContainers.matchAll(/\b([1-9]|1[0-2])\b/g)].map((match) => Number(match[1]));
  return smallNumbers.length ? smallNumbers.at(-1) : 1;
}

function cleanStorageDescription(value, palletCount) {
  let description = String(value || "")
    .replace(/\bC\s*\d+\b/gi, " ")
    .replace(/\b\d{1,2}\s*(?:pal(?:ette|etten)?|pal\.|pallets?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (palletCount) {
    const token = String(palletCount);
    description = description.replace(new RegExp(`\\b${token}\\b(?!.*\\b${token}\\b)`), " ").replace(/\s+/g, " ").trim();
  }

  return description;
}

function normalizeStorageUnit(value) {
  const unit = String(value || "").trim().toLowerCase();
  if (!unit || /^(st\.?|stk\.?|stueck|st.?ck|pcs)$/.test(unit)) return "Stk";
  return value;
}

function normalizeStorageOcrLine(line) {
  return String(line || "")
    .replace(/[|[\]{}()]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b5T\b/gi, "ST")
    .trim();
}

function normalizeStorageQuantity(value) {
  const normalized = String(value || "").replace(",", ".");
  if (/^\d{1,3}\.\d{3}$/.test(normalized)) return normalized;
  if (/^\d{4,6}$/.test(normalized)) return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return normalized;
}

function parsePalletCount(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) || 1 : 1;
}

function parseStorageQuantityNumber(value) {
  const compact = String(value || "").replace(/[.,\s]/g, "");
  return compact ? Number(compact) : 0;
}

function normalizeStorageContainerCode(value) {
  const code = String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/[IIL|]$/, "1");
  return /^C\d+$/.test(code) ? code : "";
}

function formatStorageQuantity(value) {
  if (typeof value === "string") return value.replace(/[.,\s]/g, "");
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000).replace(".", ",");
}

// eslint-disable-next-line no-unused-vars
function findStorageCustomer(lines) {
  const selection = lines.find((line) => /-\s*\d{4,}\b/.test(line) && !/material|artikel/i.test(line));
  if (selection) return selection.replace(/^.*?\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß -]+-\s*\d{4,})\b.*$/, "$1").trim();
  return "";
}

function renderModeControls() {
  const isStorage = currentMode === "storage";
  document.body.classList.toggle("is-storage-mode", isStorage);
  elements.appTitle.textContent = isStorage ? "Einlagerung" : "Kommissionierliste";
  elements.fileDrop.setAttribute("for", "pdfInput");
  elements.pdfInput.accept = isStorage
    ? ".pdf,application/pdf"
    : ".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";
  elements.fileDropTitle.textContent = isStorage ? "Lieferschein-PDF importieren" : "PDF oder XLSX importieren";
  elements.fileDrop.querySelector(".file-drop-copy").textContent = isStorage
    ? "PDF vom Einlager-Lieferschein importieren, Positionen pruefen und HU/Stellplatz eintragen."
    : "Auftrag auswählen, Positionen prüfen und digital abhaken.";
  elements.pickingModeButton.classList.toggle("is-active", !isStorage);
  elements.storageModeButton.classList.toggle("is-active", isStorage);
  const grid = elements.pickHeader.querySelector(".pick-column-grid");
  const manualStorageHeader = isManualStorageHeader();
  grid.classList.toggle("is-manual-storage-grid", manualStorageHeader);
  grid.innerHTML = isStorage
    ? (manualStorageHeader
      ? "<span>Material</span><span>Stellplatz</span><span>Artikelbezeichnung</span><span>Ist</span><span>Einheit</span>"
      : "<span>Material</span><span>Stellplatz</span><span>Artikelbezeichnung</span><span>Soll</span><span>Ist</span><span>Einheit</span>")
    : "<span>Produkt</span><span>Lagerplatz</span><span>Produktbeschreibung</span><span>Soll</span><span>Ist</span><span>Einheit</span>";
}

function isManualStorageHeader() {
  if ((state.orderType || currentMode) !== "storage") return false;
  const lines = Array.isArray(state.lines) ? state.lines.filter((line) => line?.lineType !== "loading-slip") : [];
  return !lines.length || lines.every((line) => line?.manual === true || isEmptyManualStorageLine(line));
}

function renderTakeOverButton() {
  if (!elements.takeOverOrderButton) return;
  elements.takeOverOrderButton.hidden = true;
  elements.takeOverOrderButton.disabled = true;
}

function renderReleaseButton() {
  if (!elements.releaseOrderButton) return;
  const isDraft = Boolean(
    currentUser.group === "buero" &&
    (state.orderType || currentMode) === "picking" &&
    state.awaitingRelease &&
    state.lines.length &&
    !state.id
  );
  elements.releaseOrderButton.hidden = !isDraft;
  elements.releaseOrderButton.disabled = !isDraft || !serverOnline || !currentUser.name;
}

function renderSaveOrderButton() {
  if (!elements.saveOrderButton) return;
  const canAppend = canAppendLoadingSlipToXlsxDraft();
  elements.saveOrderButton.textContent = canAppend
    ? "Ladeliste anhängen"
    : state.awaitingRelease
      ? "Entwurf lokal speichern"
      : "Auftrag speichern";
  elements.saveOrderButton.title = canAppend
    ? "PDF-Ladeliste an diesen XLSX-Entwurf anhängen"
    : "";
}

function hasCurrentOrderData() {
  return Boolean(
    state.id ||
    state.lines.length ||
    state.rawText ||
    state.orderNumber ||
    state.customerName ||
    state.euroPallets ||
    state.storageSpaces ||
    state.orderNote
  );
}

function renderDiscardButton() {
  if (elements.discardDraftButton) {
    const hasData = hasCurrentOrderData();
    const deletesSavedOrder = Boolean(state.id);
    elements.discardDraftButton.textContent = state.awaitingRelease
      ? "Entwurf verwerfen"
      : deletesSavedOrder
        ? "Auftrag abbrechen"
        : "Maske verwerfen";
    elements.discardDraftButton.hidden = !hasData;
    elements.discardDraftButton.disabled = !hasData;
    elements.discardDraftButton.classList.toggle("danger-button", deletesSavedOrder);
    elements.discardDraftButton.classList.toggle("secondary-button", !deletesSavedOrder);
    elements.discardDraftButton.title = state.id
      ? "Auftrag abbrechen und aus der Auftragsliste loeschen"
      : "Aktuelle Maske und lokalen Entwurf leeren";
  }
}

function renderDeleteOrderButton() {
  if (!elements.deleteOrderButton) return;
  const hasSavedOrder = Boolean(state.id);
  const canDelete = ["buero", "lager", "tablet", "verwaltung"].includes(currentUser.group);
  const isStorage = (state.orderType || currentMode) === "storage";
  elements.deleteOrderButton.textContent = isStorage ? "Einlager-Auftrag löschen" : "Auftrag löschen";
  elements.deleteOrderButton.hidden = !hasSavedOrder || !canDelete;
  elements.deleteOrderButton.disabled = !hasSavedOrder || !canDelete || Boolean(state.exportedAt);
  elements.deleteOrderButton.title = state.exportedAt
    ? "Abgeschlossene Aufträge können nicht gelöscht werden"
    : isStorage
      ? "Gespeicherten Einlager-Auftrag löschen"
      : "Gespeicherten Auftrag löschen";
}

function renderTopControls() {
  const canCollapse = state.lines.length > 0;
  topControlsCollapsed = canCollapse && topControlsCollapsed && !state.awaitingRelease;
  elements.topControls.classList.toggle("is-collapsed", topControlsCollapsed);
  elements.topToggleButton.hidden = !canCollapse;
  elements.topToggleButton.querySelector("span").textContent = topControlsCollapsed ? "v" : "^";
  elements.topToggleButton.title = topControlsCollapsed ? "Kopfleiste anzeigen" : "Kopfleiste einklappen";
  elements.topToggleButton.setAttribute("aria-label", elements.topToggleButton.title);
}

function setTopControlsCollapsed(collapsed) {
  topControlsCollapsed = collapsed;
  render();
}

function getPickingLines(importOrder) {
  return window.HLogistikStateHelpers.getPickingLines(state.lines, state.orderType, importOrder);
}

// eslint-disable-next-line no-unused-vars
function compareStorageBins(left, right, importOrder) {
  return window.HLogistikStateHelpers.compareStorageBins(left, right, importOrder);
}

function syncFields() {
  ["orderNumber", "customerName", "orderDate", "orderTime", "euroPallets", "storageSpaces", "orderNote"].forEach((id) => {
    if (elements[id].value !== state[id]) elements[id].value = state[id] || "";
  });
}

function renderLoadingSlipLine(item, map, line) {
  const barcodeWrap = document.createElement("div");
  barcodeWrap.className = "loading-slip-barcode";
  barcodeWrap.innerHTML = code128Svg(line.barcode || line.fromHandlingUnit || "");
  map.product.replaceWith(barcodeWrap);

  map.fromBin.value = line.product || "";
  map.fromBin.readOnly = true;
  map.fromBin.classList.add("short-input");
  map.description.value = line.description || "";
  map.description.readOnly = true;
  map.targetQty.value = formatLineQuantityForDisplay(line, line.targetQty);
  map.targetQty.readOnly = true;
  removeClosestLabelOrElement(map.actualQty);
  removeClosestLabelOrElement(map.unit);
  removeClosestLabelOrElement(map.fromHandlingUnit);
  map.positionNote.value = combinedPositionNote(line);
  map.positionNote.addEventListener("input", () => updateLine(line.id, { positionNote: map.positionNote.value }, false));

  map.picked.setAttribute("aria-pressed", line.picked ? "true" : "false");
  map.picked.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const picked = map.picked.getAttribute("aria-pressed") !== "true";
    map.picked.setAttribute("aria-pressed", picked ? "true" : "false");
    updateLine(line.id, { picked }, false);
    item.classList.toggle("is-done", picked);
    item.classList.toggle("is-collapsed", picked);
  });
}

function removeClosestLabelOrElement(element) {
  if (!element) return false;
  const container = typeof element.closest === "function" ? element.closest("label") : null;
  const target = container || element;
  if (!target || typeof target.remove !== "function") return false;
  target.remove();
  return true;
}

function syncStateFromFields() {
  ["orderNumber", "customerName", "orderDate", "orderTime", "euroPallets", "storageSpaces", "orderNote"].forEach((id) => {
    if (elements[id]) state[id] = elements[id].value;
  });
  state.customerGroupKey = customerGroupKeyForImport(state.customerName, state.customerGroupKey);
  syncLineFieldsFromDom();
}

function syncLineFieldsFromDom() {
  if (!elements.pickList || !Array.isArray(state.lines) || !state.lines.length) return;
  const lineById = new Map(state.lines.map((line) => [String(line.id || ""), line]));

  elements.pickList.querySelectorAll(".pick-item[data-id]").forEach((item) => {
    const line = lineById.get(String(item.dataset.id || ""));
    if (!line) return;

    const pickedButton = item.querySelector(".picked-button");
    if (pickedButton) line.picked = pickedButton.getAttribute("aria-pressed") === "true";

    const noteInput = item.querySelector(".position-note-input");
    if (noteInput) line.positionNote = noteInput.value;

    if (line.lineType === "loading-slip") return;

    const huInput = item.querySelector(".from-hu-input");
    const binInput = item.querySelector(".from-bin-input");
    const productInput = item.querySelector(".product-input");
    const descriptionInput = item.querySelector(".description-input");
    const targetQtyInput = item.querySelector(".target-qty-input");
    const actualQtyInput = item.querySelector(".actual-qty-input");
    const unitInput = item.querySelector(".unit-input");

    if (huInput) {
      line.fromHandlingUnit = isSsiStorageOrderContext()
        ? normalizeSsiStorageHandlingUnit(huInput.value)
        : huInput.value;
    }
    if (binInput) {
      const fromBinValue = binInput.readOnly && binInput.dataset.fullValue
        ? binInput.dataset.fullValue
        : binInput.value;
      const skipFromBinReview = isPickingXlsxOrder();
      line.fromBin = skipFromBinReview ? fromBinValue : fromBinValue.toUpperCase();
      Object.assign(line, skipFromBinReview ? noFromBinReviewPatch() : fromBinReviewPatchForValue(line.fromBin, line));
      if (!skipFromBinReview && shouldClearBinWarning(line, line.fromBin)) {
        line.binWarning = "";
        line.binWarningValue = "";
        line.binWarningType = "";
        line.fromBinReviewRequired = false;
        line.fromBinReviewReason = "";
        line.fromBinReviewBlocksRelease = false;
        line.fromBinReviewBlocksExport = false;
        line.fromBinManualCorrectionClearsWarning = false;
        line.fromBinReviewConfirmedValue = "";
      }
    }
    if (productInput) {
      productInput.value = normalizeDigits(productInput.value);
      line.product = productInput.value;
    }
    if (descriptionInput) line.description = descriptionInput.value;
    if (targetQtyInput) line.targetQty = targetQtyInput.value;
    if (actualQtyInput) line.actualQty = actualQtyInput.value;
    if (unitInput) line.unit = unitInput.value || "Stk";
  });
}

function updateLine(id, patch, rerender = true) {
  const line = state.lines.find((entry) => entry.id === id);
  if (!line) return;
  const refreshPackage = Object.prototype.hasOwnProperty.call(patch, "product") || Object.prototype.hasOwnProperty.call(patch, "targetQty");
  Object.assign(line, patch);
  markOrderTouched();
  saveState();
  updateCounts();
  if (rerender) render();
  if (refreshPackage) {
    refreshPackageNoteForLine(line).then((changed) => {
      if (!changed) return;
      saveState();
      render();
    });
  }
}

function markOrderTouched() {
  if (!currentUser.name) return;
  state.createdBy = state.createdBy || currentUser.name;
  state.lastEditedBy = currentUser.name;
  state.activeUser = currentUser.name;
  state.activeUserAt = new Date().toISOString();
  updateCompletionFields();
}

function updateCompletionFields() {
  if (state.awaitingRelease) {
    state.completedBy = "";
    state.completedAt = "";
    return;
  }

  const completionLines = state.lines.filter((line) => !isEmptyManualStorageLine(line));
  const isComplete = completionLines.length > 0 && completionLines.every((line) => line.picked);
  if (isComplete) {
    state.completedBy = state.completedBy || currentUser.name;
    state.completedAt = state.completedAt || new Date().toISOString();
    return;
  }

  state.completedBy = "";
  state.completedAt = "";
}

function updateCounts() {
  const picked = state.lines.filter((line) => line.picked).length;
  const changed = state.lines.filter((line) => isQuantityChanged(line)).length;
  elements.pickedCount.textContent = picked;
  elements.openCount.textContent = Math.max(state.lines.length - picked, 0);
  elements.changedCount.textContent = changed;
}

async function initializeServer({ showChecking = true } = {}) {
  if (connectionCheckInProgress && Date.now() - connectionCheckStartedAt < CONNECTION_CHECK_TIMEOUT_MS * 2) return;
  connectionCheckInProgress = true;
  connectionCheckStartedAt = Date.now();
  let timeoutId = null;

  try {
    if (showChecking) setConnectionStatus(null);
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), CONNECTION_CHECK_TIMEOUT_MS);
    const response = await fetch(`${API_BASE}/api/health`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Server antwortet nicht");
    const info = await response.json();
    const wasOffline = !serverOnline;
    serverOnline = true;
    setConnectionStatus(true);
    setServerStatus(`Server aktiv. PDFs: ${info.exportDir}`, "ok");
    if (wasOffline) await flushSyncQueue();
    await loadOrderList();
    startOrderListRefresh();
    startActivityHeartbeat();
  } catch {
    serverOnline = false;
    setConnectionStatus(false);
    const cached = await loadOrderListFromCache();
    setServerStatus(
      cached
        ? "Offline: Auftragsliste aus lokalem Cache geladen."
        : "Server nicht verbunden. Daten bleiben nur auf diesem Geraet.",
      "error"
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    connectionCheckInProgress = false;
    connectionCheckStartedAt = 0;
  }
}

async function flushSyncQueue() {
  if (!window.OfflineStore) return;
  try {
    const pending = await OfflineStore.getPending();
    if (!pending.length) return;

    // Dedup: nur die neueste Mutation je Queue-Schluessel behalten.
    const latestByKey = new Map();
    pending.forEach((item) => {
      const key = syncQueueEntryKey(item);
      const existing = latestByKey.get(key);
      if (!existing || item.timestamp > existing.timestamp) latestByKey.set(key, item);
    });

    let synced = 0;
    for (const [, item] of latestByKey) {
      try {
        const result = await apiJson(item.url, { method: item.method, body: item.body });
        await cacheSyncedQueueOrder(item, result);
        const itemKey = syncQueueEntryKey(item);
        await Promise.all(pending
          .filter((entry) => syncQueueEntryKey(entry) === itemKey)
          .map((entry) => OfflineStore.dequeue(entry.queueId)));
        synced++;
      } catch {
        // Einzelner Fehler blockiert nicht den Rest
      }
    }

    if (synced > 0) {
      setServerStatus(`${synced} Offline-Änderung${synced !== 1 ? "en" : ""} synchronisiert.`, "ok");
    }
  } catch {
    // Queue-Flush ist nicht kritisch
  }
}

function syncQueueEntryKey(item) {
  return String(item?.dedupeKey || item?.url || "");
}

function orderMutationDedupeKey(method, endpoint, order) {
  if (method === "PUT") return `PUT:${endpoint}`;
  if (method === "POST" && order?.id) return `POST:${endpoint}:${order.id}`;
  return "";
}

async function cacheSyncedQueueOrder(item, result) {
  if (!window.OfflineStore || item?.method !== "POST" || item.url !== "/api/orders" || !result?.order) return;
  let payload = {};
  try {
    payload = item.body ? JSON.parse(item.body) : {};
  } catch {
    return;
  }
  if (!payload.order?.id) return;
  try {
    await OfflineStore.saveOrder({ ...payload.order, ...result.order });
  } catch {
    // Cache-Aktualisierung ist best effort.
  }
}

async function loadOrderListFromCache() {
  if (!window.OfflineStore) return false;
  try {
    const cached = (await OfflineStore.loadOrderSummaries())
      .filter((o) => (o.orderType || "picking") === currentMode && isOpenOrderSummary(o));
    if (!cached.length) return false;
    renderOrderListItems(cached);
    return true;
  } catch {
    return false;
  }
}

function startConnectionMonitor() {
  if (connectionCheckTimer) return;
  connectionCheckTimer = setInterval(() => {
    initializeServer({ showChecking: false });
  }, CONNECTION_CHECK_MS);
}

function setConnectionStatus(isOnline) {
  HLogistikUi.setConnectionStatus(elements.connectionBadge, elements.connectionText, isOnline);
}

function startOrderListRefresh() {
  if (orderListTimer) return;
  orderListTimer = setInterval(() => {
    if (serverOnline) loadOrderList();
  }, ORDER_LIST_REFRESH_MS);
}

function startActivityHeartbeat() {
  if (activityTimer) return;
  activityTimer = setInterval(async () => {
    if (!serverOnline || !currentUser.name) return;
    if (state.id && state.lines.length && state.activeUser === currentUser.name) {
      const stillOpen = await ensureCurrentOrderStillOpen({ refreshList: false });
      if (!stillOpen) return;
      saveOrderNow(true);
      return;
    }
    loadOrderList();
  }, ACTIVITY_HEARTBEAT_MS);
}

async function loadOrderList() {
  if (!serverOnline) {
    await loadOrderListFromCache();
    return;
  }
  try {
    const orders = (await apiJson("/api/orders"))
      .filter((order) => (order.orderType || "picking") === currentMode && isOpenOrderSummary(order));
    const newOrders = findNewOrders(orders);
    rememberKnownOrders(orders);
    renderOrderListItems(orders);
    await ensureCurrentOrderStillOpen({ openOrders: orders, refreshList: false });
    if (!orders.length) {
      setServerStatus(`Server aktiv. Keine offenen ${modeLabel(currentMode).toLowerCase()}s-Aufträge gefunden.`, "ok");
    }
    if (newOrders.length) showNewOrderNotice(newOrders);
    try { if (window.OfflineStore) await OfflineStore.saveOrderSummaries(orders); } catch { /* non-critical */ }
  } catch (error) {
    setServerStatus(`Auftragsliste konnte nicht geladen werden: ${error.message}`, "error");
  }
}

function renderOrderListItems(orders) {
  elements.orderSelect.innerHTML = `<option value="">Kein gespeicherter Auftrag</option>`;
  orders.forEach((order) => {
    const option = document.createElement("option");
    option.value = order.id;
    const activity = orderActivityLabel(order);
    const createdTime = formatOrderCreatedAt(order.createdAt || order.updatedAt);
    const timeText = createdTime ? `${createdTime} - ` : "";
    const warehouseText = order.orderWarehouse ? ` - ${order.orderWarehouse}` : "";
    option.textContent = `${timeText}${order.orderNumber || order.id} - ${order.customerName || modeLabel(order.orderType).toLowerCase()}${warehouseText} (${order.picked}/${order.total}) - ${activity}`;
    if (order.id === state.id) option.selected = true;
    elements.orderSelect.appendChild(option);
  });
}

function isOpenOrderSummary(order) {
  return !order.exportedAt;
}

function findNewOrders(orders) {
  if (!orderListInitialized) {
    orderListInitialized = true;
    return [];
  }

  return orders.filter((order) => order.id && !knownOrderIds.has(order.id));
}

function rememberKnownOrders(orders) {
  orders.forEach((order) => {
    if (order.id) knownOrderIds.add(order.id);
  });
  localStorage.setItem(KNOWN_ORDERS_KEY, JSON.stringify([...knownOrderIds]));
}

function loadKnownOrderIds() {
  try {
    const saved = JSON.parse(localStorage.getItem(KNOWN_ORDERS_KEY) || "[]");
    knownOrderIds = new Set(Array.isArray(saved) ? saved.filter(Boolean) : []);
  } catch {
    knownOrderIds = new Set();
  }
}

function showNewOrderNotice(newOrders) {
  const firstOrder = newOrders[0];
  if (!firstOrder || !elements.orderNotice) return;

  notifiedOrderId = firstOrder.id;
  const label = orderNoticeLabel(firstOrder);
  const message = newOrders.length === 1
    ? `Ein neuer Auftrag wurde eingelesen: ${label}.`
    : `${newOrders.length} neue Aufträge wurden eingelesen. Neuester Auftrag: ${label}.`;

  elements.orderNoticeText.textContent = message;
  elements.orderNotice.hidden = false;
  window.clearTimeout(orderNoticeTimer);
  orderNoticeTimer = window.setTimeout(hideOrderNotice, ORDER_NOTICE_DURATION_MS);
}

function orderNoticeLabel(order) {
  return [order.orderNumber, order.customerName]
    .filter(Boolean)
    .join(" - ") || order.id || "ohne Nummer";
}

function hideOrderNotice() {
  notifiedOrderId = "";
  if (elements.orderNotice) elements.orderNotice.hidden = true;
  window.clearTimeout(orderNoticeTimer);
}

function orderActivityLabel(order) {
  if (order.completedAt && !order.exportedAt) return "fertig, PDF fehlt";

  const acceptedBy = String(order.acceptedBy || "").trim();
  if (acceptedBy) {
    if (sameUserName(acceptedBy, currentUser.name)) return "von dir uebernommen";
    return `von ${acceptedBy} uebernommen`;
  }

  if (isOrderRecentlyActive(order)) {
    if (order.id === state.id && order.activeUser === currentUser.name) return "bei dir geöffnet";
    return `in Bearbeitung: ${order.activeUser}`;
  }

  return "frei";
}

function formatOrderCreatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function currentTimeValue() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function isOrderRecentlyActive(order) {
  if (!order.activeUser || !order.activeUserAt) return false;
  const activeAt = Date.parse(order.activeUserAt);
  return Number.isFinite(activeAt) && Date.now() - activeAt < ACTIVE_ORDER_TIMEOUT_MS;
}

async function loadOrder(id) {
  if (!id) return;
  if (!requireCurrentUser()) return;

  if (!serverOnline) {
    if (!window.OfflineStore) return;
    try {
      const cached = await OfflineStore.loadOrder(id);
      if (!cached) {
        setServerStatus("Offline: Dieser Auftrag ist nicht im lokalen Cache vorhanden.", "error");
        return;
      }
      Object.assign(state, cached);
      applyLoadedOrderWarehouse(cached);
      state.awaitingRelease = false;
      currentMode = state.orderType === "storage" ? "storage" : "picking";
      localStorage.setItem(MODE_KEY, currentMode);
      state.collapseDone = true;
      topControlsCollapsed = state.lines.length > 0;
      saveStateWithoutServer();
      render();
      setServerStatus("Offline: Auftrag aus Cache geladen. Änderungen werden bei Verbindung synchronisiert.", "ok");
    } catch (error) {
      setServerStatus(`Offline-Cache konnte nicht gelesen werden: ${error.message}`, "error");
    }
    return;
  }

  try {
    if (state.id && state.id !== id) await releaseCurrentOrderActivity();
    const order = await apiJson(`/api/orders/${encodeURIComponent(id)}`);
    const cached = await loadCachedOrderForRecovery(id);
    const recovered = cached && isCachedOrderNewer(cached, order);
    const orderToLoad = recovered ? mergeServerLoadingSlipLines(cached, order) : order;
    Object.assign(state, orderToLoad);
    applyLoadedOrderWarehouse(orderToLoad);
    state.awaitingRelease = false;
    currentMode = state.orderType === "storage" ? "storage" : "picking";
    localStorage.setItem(MODE_KEY, currentMode);
    state.collapseDone = true;
    topControlsCollapsed = state.lines.length > 0;
    saveStateWithoutServer();
    render();
    const loadMessage = recovered
      ? "Auftrag aus lokaler Sicherung wiederhergestellt. Bitte weiterarbeiten oder speichern."
      : "Auftrag geladen.";
    setServerStatus(loadMessage, "ok");
    try { if (window.OfflineStore && !recovered) await OfflineStore.saveOrder(order); } catch { /* non-critical */ }
    await loadOrderList();
  } catch (error) {
    setServerStatus(`Auftrag konnte nicht geladen werden: ${error.message}`, "error");
  }
}

async function loadCachedOrderForRecovery(id) {
  const candidates = [];
  try {
    const recovery = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-recovery`) || "null");
    if (recovery?.id === id) candidates.push(recovery);
  } catch {
    // Ignore damaged local recovery payloads.
  }

  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (current?.id === id) candidates.push(current);
  } catch {
    // Ignore damaged state payloads.
  }

  if (window.OfflineStore?.loadOrder) {
    try {
      const cached = await OfflineStore.loadOrder(id);
      if (cached) candidates.push(cached);
    } catch {
      // IndexedDB cache is best effort.
    }
  }

  return candidates
    .filter((order) => order?.id === id && Array.isArray(order.lines))
    .sort((left, right) => cachedOrderTime(right) - cachedOrderTime(left))[0] || null;
}

function isCachedOrderNewer(cached, serverOrder) {
  const cachedAt = cachedOrderTime(cached);
  const serverAt = Date.parse(serverOrder?.updatedAt || serverOrder?.activeUserAt || serverOrder?.createdAt || "") || 0;
  return cachedAt > serverAt && JSON.stringify(cached.lines || []) !== JSON.stringify(serverOrder?.lines || []);
}

function cachedOrderTime(order) {
  return Date.parse(order?.cachedAt || order?.activeUserAt || order?.updatedAt || order?.createdAt || "") || 0;
}

async function takeOverCurrentOrder() {
  if (!requireCurrentUser()) return;
  setServerStatus("Auftraege werden nur auf der Tablet-Seite uebernommen.", "ok");
}

function scheduleServerSave() {
  if (state.awaitingRelease) return;
  if (!serverOnline || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveOrderNow(true);
  }, 700);
}

async function saveOrderNow(silent = false, { allowDraftRelease = false, touch = true } = {}) {
  if (!requireCurrentUser()) return false;
  syncStateFromFields();
  normalizeOrderQuantitiesForSave(state);

  if (state.awaitingRelease && !allowDraftRelease) {
    saveDraftState(silent ? "Entwurf lokal gespeichert." : "Entwurf lokal gespeichert. Mit \"Auftrag freigeben\" in die Auftragsliste übernehmen.");
    return false;
  }

  if (!state.lines.length) {
    if (!silent) setServerStatus("Leere Auftraege ohne Positionen werden nicht gespeichert.", "error");
    return false;
  }

  if (isBestellscheinText(state.rawText)) {
    const sanitized = sanitizeBestellscheinHandlingUnitDuplicates({ lines: state.lines }, state.rawText);
    if (sanitized.lines !== state.lines) {
      state.lines = sanitized.lines;
      saveStateWithoutServer();
      render();
    }
  }

  const handlingUnitConflicts = duplicateHandlingUnitConflicts(state.lines);
  if (handlingUnitConflicts.length) {
    if (!silent) {
      setServerStatus(`Speichern abgebrochen: ${formatDuplicateHandlingUnitConflicts(handlingUnitConflicts)}. LE/HU muss einmalig sein.`, "error");
    }
    return false;
  }

  if (!serverOnline) {
    if (window.OfflineStore) {
      try {
        const payload = currentOrderPayload({ touch });
        const endpoint = state.id ? `/api/orders/${encodeURIComponent(state.id)}` : "/api/orders";
        const method = state.id ? "PUT" : "POST";
        await OfflineStore.enqueue(method, endpoint, JSON.stringify({ order: payload, userName: currentUser.name }), orderMutationDedupeKey(method, endpoint, payload));
        if (state.id) await OfflineStore.saveOrder({ ...payload, id: state.id });
        if (!silent) setServerStatus("Offline gespeichert – wird synchronisiert, sobald der Server erreichbar ist.", "ok");
      } catch {
        if (!silent) setServerStatus("Offline: Lokales Speichern fehlgeschlagen.", "error");
      }
    } else {
      if (!silent) setServerStatus("Server nicht verbunden. Auftrag nur lokal gespeichert.", "error");
    }
    return false;
  }

  try {
    if (state.id) {
      const stillOpen = await ensureCurrentOrderStillOpen({ refreshList: false });
      if (!stillOpen) return false;
    }
    const payload = currentOrderPayload({ touch });
    const endpoint = state.id ? `/api/orders/${encodeURIComponent(state.id)}` : "/api/orders";
    const method = state.id ? "PUT" : "POST";
    const result = await apiJson(endpoint, { method, body: JSON.stringify({ order: payload, userName: currentUser.name }) });
    state.id = result.order.id;
    state.acceptedBy = result.order.acceptedBy || state.acceptedBy || "";
    state.acceptedAt = result.order.acceptedAt || state.acceptedAt || "";
    saveStateWithoutServer();
    if (!silent) setServerStatus("Auftrag gespeichert.", "ok");
    await loadOrderList();
    return true;
  } catch (error) {
    if (!silent) setServerStatus(`Speichern fehlgeschlagen: ${error.message}`, "error");
    return false;
  }
}

async function ensureCurrentOrderStillOpen({ openOrders = null, refreshList = true } = {}) {
  if (!serverOnline || !state.id) return true;
  if (Array.isArray(openOrders) && openOrders.some((order) => order.id === state.id)) return true;

  try {
    const serverOrder = await apiJson(`/api/orders/${encodeURIComponent(state.id)}`);
    if (isOpenOrderSummary(serverOrder) || isOwnCompletedOrder(serverOrder)) return true;

    resetCurrentOrderView();
    setServerStatus("Dieser Auftrag wurde auf einem anderen Gerät abgeschlossen oder exportiert und lokal geschlossen.", "ok");
    if (refreshList) await loadOrderList();
    return false;
  } catch {
    return false;
  }
}

function isOwnCompletedOrder(order) {
  if (!order.completedAt || order.exportedAt) return false;
  return Boolean(currentUser.name && order.completedBy === currentUser.name);
}

async function releaseCurrentOrder() {
  if (!requireCurrentUser()) return;
  syncStateFromFields();
  if (!state.awaitingRelease || !state.lines.length) {
    setServerStatus("Kein Entwurf zur Freigabe vorhanden.", "error");
    return;
  }
  if (!serverOnline) {
    setServerStatus("Server nicht verbunden. Der Auftrag bleibt als Entwurf lokal gespeichert.", "error");
    return;
  }
  if (hasOpenFromBinReviewWarnings(state.lines)) {
    const message = fromBinReviewBlockMessage();
    setImportStatus(message, "error", 100);
    setServerStatus(message, "error");
    render();
    return;
  }

  const duplicate = await findDuplicateOrderForImport(state.orderNumber, state.orderType || "picking", state.rawText);
  if (duplicate) {
    setServerStatus(`Auftrag ${duplicate.orderNumber || duplicate.id} wurde bereits eingelesen und wird nicht doppelt angelegt.`, "error");
    return;
  }

  state.awaitingRelease = false;
  state.createdBy = state.createdBy || currentUser.name;
  state.lastEditedBy = currentUser.name;
  state.activeUser = "";
  state.activeUserAt = "";
  state.completedBy = "";
  state.completedAt = "";
  const clearedWarnings = clearBinWarnings(state.lines);
  state.lines = clearedWarnings.lines;
  const saved = await saveOrderNow(false, { allowDraftRelease: true, touch: false });
  if (!saved) {
    state.awaitingRelease = true;
    saveStateWithoutServer();
    render();
    return;
  }

  setImportStatus("Auftrag freigegeben und in die Auftragsliste übernommen.", "ok", 100);
  setServerStatus("Auftrag freigegeben und in die Auftragsliste übernommen.", "ok");
  if (clearedWarnings.cleared) {
    const warningNotice = `${clearedWarnings.cleared} gepruefte Lagerplatz-Warnung(en) wurden bestaetigt.`;
    setImportStatus(`Auftrag freigegeben. ${warningNotice}`, "ok", 100);
    setServerStatus(`Auftrag freigegeben. ${warningNotice}`, "ok");
  }
  resetCurrentOrderView();
  await loadOrderList();
}

async function discardCurrentDraft() {
  if (!hasCurrentOrderData()) {
    resetCurrentOrderView();
    return;
  }

  const isSavedOrder = Boolean(state.id);
  if (isSavedOrder) {
    const isStorage = (state.orderType || currentMode) === "storage";
    const typeLabel = isStorage ? "Einlager-Auftrag" : "Auftrag";
    const label = orderNoticeLabel({
      id: state.id,
      orderNumber: state.orderNumber,
      customerName: state.customerName
    });
    await deleteCurrentOrder({
      confirmMessage: `${typeLabel} "${label}" abbrechen? Der angelegte Auftrag wird geloescht.`,
      successMessage: `${typeLabel} abgebrochen und geloescht.`,
      failurePrefix: "Abbrechen fehlgeschlagen"
    });
    return;
  }

  const question = "Aktuellen Entwurf verwerfen und Maske leeren?";
  if (!confirm(question)) return;

  await releaseCurrentOrderActivity();
  resetCurrentOrderView();
  setServerStatus(`Entwurf verworfen. Die ${modeLabel(currentMode)}-Seite wurde geleert.`, "ok");
  if (serverOnline) await loadOrderList();
}

async function deleteCurrentOrder(options = {}) {
  const {
    confirmMessage = "",
    successMessage = "",
    failurePrefix = "Loeschen fehlgeschlagen"
  } = options || {};

  if (!serverOnline) {
    setServerStatus("Pruefe Serververbindung vor dem Loeschen ...", "ok");
    await initializeServer({ showChecking: false });
    if (serverOnline) return deleteCurrentOrder(options);
    setServerStatus(`Server nicht verbunden. ${modeLabel(state.orderType || currentMode)} kann nicht gelöscht werden.`, "error");
    return;
  }

  if (!state.id) {
    setServerStatus("Kein gespeicherter Auftrag ausgewählt.", "error");
    return;
  }

  if (state.exportedAt) {
    setServerStatus("Abgeschlossene Aufträge können nicht gelöscht werden.", "error");
    return;
  }

  const isStorage = (state.orderType || currentMode) === "storage";
  const typeLabel = isStorage ? "Einlager-Auftrag" : "Auftrag";
  const label = orderNoticeLabel({
    id: state.id,
    orderNumber: state.orderNumber,
    customerName: state.customerName
  });
  const deleteQuestion = confirmMessage || `${typeLabel} "${label}" wirklich aus der Liste löschen?`;
  if (!confirm(deleteQuestion)) return;

  window.clearTimeout(saveTimer);
  saveTimer = null;

  try {
    await apiJson(`/api/orders/${encodeURIComponent(state.id)}`, { method: "DELETE" });
    await removeDeletedOrderFromLocalCaches(state.id);
    knownOrderIds.delete(state.id);
    localStorage.setItem(KNOWN_ORDERS_KEY, JSON.stringify([...knownOrderIds]));
    resetCurrentOrderView();
    setServerStatus(successMessage || `${typeLabel} gelöscht.`, "ok");
    await loadOrderList();
  } catch (error) {
    if (failurePrefix !== "Loeschen fehlgeschlagen") {
      setServerStatus(`${failurePrefix}: ${error.message}`, "error");
      return;
    }
    setServerStatus(`Löschen fehlgeschlagen: ${error.message}`, "error");
  }
}

async function removeDeletedOrderFromLocalCaches(orderId) {
  if (!orderId) return;

  try {
    const recovery = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-recovery`) || "null");
    if (String(recovery?.id || recovery?.cacheId || "") === String(orderId)) {
      localStorage.removeItem(`${STORAGE_KEY}-recovery`);
    }
  } catch {
    localStorage.removeItem(`${STORAGE_KEY}-recovery`);
  }

  if (!window.OfflineStore) return;
  try {
    if (OfflineStore.deleteOrder) await OfflineStore.deleteOrder(orderId);
    if (OfflineStore.deleteOrderSummary) await OfflineStore.deleteOrderSummary(orderId);
  } catch {
    // The server deletion already succeeded; local cache cleanup is best effort.
  }
}

async function releaseCurrentOrderActivity() {
  if (!serverOnline || !state.id || state.activeUser !== currentUser.name) return;

  try {
    const payload = currentOrderPayload({ touch: false });
    payload.activeUser = "";
    payload.activeUserAt = "";
    await apiJson(`/api/orders/${encodeURIComponent(state.id)}`, {
      method: "PUT",
      body: JSON.stringify({ order: payload, userName: currentUser.name })
    });
  } catch {
    // If release fails, the activity timeout will make the order free again.
  }
}

function currentOrderPayload({ touch = true } = {}) {
  if (touch) markOrderTouched();
  const orderType = state.orderType || currentMode;
  const orderWarehouse = normalizeOptionalWarehouse(state.orderWarehouse) || currentWarehouse();
  const lines = normalizeStorageHandlingUnits(state.lines, isSsiStorageOrderContext(orderType, state.customerName));
  const destinationCustomerName = orderType === "picking" ? defaultDestinationCustomerName(lines) : "";
  const customerName = destinationCustomerName || state.customerName;
  const customerGroupKey = destinationCustomerName
    ? customerGroupKeyForImport(destinationCustomerName)
    : state.customerGroupKey || customerGroupKeyForImport(customerName);

  return {
    id: state.id,
    orderNumber: orderNumberForCustomer(state.orderNumber, customerName),
    customerName,
    customerGroupKey,
    orderDate: state.orderDate,
    orderTime: state.orderTime,
    euroPallets: state.euroPallets,
    storageSpaces: state.storageSpaces,
    orderNote: state.orderNote,
    rawText: state.rawText,
    collapseDone: true,
    createdBy: state.createdBy,
    lastEditedBy: state.lastEditedBy,
    activeUser: state.activeUser,
    activeUserAt: state.activeUserAt,
    acceptedBy: state.acceptedBy || "",
    acceptedAt: state.acceptedAt || "",
    completedBy: state.completedBy,
    completedAt: state.completedAt,
    exportedAt: state.exportedAt || "",
    exportedPdfFile: state.exportedPdfFile || "",
    exportedPdfPath: state.exportedPdfPath || "",
    originalFileName: state.originalFileName || "",
    originalFilePath: state.originalFilePath || "",
    originalArchivedAt: state.originalArchivedAt || "",
    originalArchivePath: state.originalArchivePath || "",
    originalArchiveError: state.originalArchiveError || "",
    orderType,
    orderWarehouse,
    lines
  };
}

function saveStateWithoutServer() {
  writeLocalState(STORAGE_KEY, state);
  persistCurrentOrderCache();
}

async function apiJson(url, options = {}) {
  return HLogistikUi.apiJson(url, options);
}

function setServerStatus(message, type = "") {
  if (!elements.serverStatus) return;
  elements.serverStatus.textContent = message;
  elements.serverStatus.classList.toggle("is-ok", type === "ok");
  elements.serverStatus.classList.toggle("is-error", type === "error");
}

function saveAndRender() {
  saveState();
  render();
}

function saveState() {
  writeLocalState(STORAGE_KEY, state);
  persistCurrentOrderCache();
  scheduleServerSave();
}

function writeLocalState(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function persistCurrentOrderCache() {
  if (!state.lines?.length) return;
  const snapshot = currentOrderPayload({ touch: false });
  const cacheKey = state.id || `draft-${state.orderType || currentMode || "picking"}`;
  const cachedOrder = {
    ...snapshot,
    id: cacheKey,
    cacheId: cacheKey,
    cachedAt: new Date().toISOString(),
    isLocalRecovery: !state.id
  };
  try {
    writeLocalState(`${STORAGE_KEY}-recovery`, cachedOrder);
  } catch {
    // Safari private/low-storage modes may reject writes; the normal local state remains best effort.
  }
  if (window.OfflineStore?.saveOrder) {
    OfflineStore.saveOrder(cachedOrder).catch(() => {});
  }
}

function saveDraftState(message = "Entwurf lokal gespeichert. Bitte pruefen und dann freigeben.") {
  saveStateWithoutServer();
  setServerStatus(message, "ok");
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;
  try {
    const savedState = JSON.parse(saved);
    Object.assign(state, savedState);
    applyLoadedOrderWarehouse(savedState);
    state.id = state.id || "";
    const recovery = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-recovery`) || "null");
    if (
      recovery?.id === state.id &&
      Array.isArray(recovery.lines) &&
      cachedOrderTime(recovery) > cachedOrderTime(state) &&
      JSON.stringify(recovery.lines || []) !== JSON.stringify(state.lines || [])
    ) {
        Object.assign(state, recovery);
        applyLoadedOrderWarehouse(recovery);
    }
    if (appendMissingLoadingSlipFromRawText()) writeLocalState(STORAGE_KEY, state);
  } catch (error) {
    console.warn("Gespeicherte Daten konnten nicht geladen werden.", error);
  }
}

function appendMissingLoadingSlipFromRawText() {
  if ((state.orderType || currentMode) !== "picking" || !Array.isArray(state.lines) || !state.lines.length) return false;
  if (!String(state.rawText || "").trim()) return false;

  const parsed = parseOrderText(state.rawText);
  const rawLines = String(state.rawText || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const loadingSlipAudit = auditLoadingSlipImport(rawLines, parsed.lines);
  if (loadingSlipAudit.issues.length) {
    console.warn("Ladelisten konnten nicht automatisch aus dem Rohtext ergaenzt werden.", loadingSlipAudit.issues);
    return false;
  }

  const loadingSlipLines = parsed.lines.filter((line) => line.lineType === "loading-slip" && line.barcode);
  if (!loadingSlipLines.length) return false;

  const beforeCount = state.lines.length;
  state.lines = appendLoadingSlipLines(state.lines, loadingSlipLines);
  return state.lines.length > beforeCount;
}

function clearCurrentOrder() {
  Object.assign(state, {
    id: "",
    orderNumber: "",
    customerName: "",
    customerGroupKey: "",
    orderDate: new Date().toISOString().slice(0, 10),
    orderTime: "",
    euroPallets: "",
    storageSpaces: "",
    orderNote: "",
    rawText: "",
    collapseDone: true,
    createdBy: "",
    lastEditedBy: "",
    activeUser: "",
    activeUserAt: "",
    acceptedBy: "",
    acceptedAt: "",
    completedBy: "",
    completedAt: "",
    exportedAt: "",
    exportedPdfFile: "",
    exportedPdfPath: "",
    originalFileName: "",
    originalFilePath: "",
    originalArchivedAt: "",
    originalArchivePath: "",
    originalArchiveError: "",
    orderType: currentMode,
    orderWarehouse: "",
    awaitingRelease: false,
    detectedWarehouse: "",
    warehouseHint: "",
    warehouseHintType: "",
    lines: []
  });
}

function resetCurrentOrderView() {
  window.clearTimeout(saveTimer);
  saveTimer = null;
  clearCurrentOrder();
  topControlsCollapsed = false;
  if (elements.orderSelect) elements.orderSelect.value = "";
  if (elements.pdfInput) elements.pdfInput.value = "";
  if (elements.imageInput) elements.imageInput.value = "";
  if (elements.importProgressWrap) elements.importProgressWrap.hidden = true;
  if (elements.importStatus) {
    elements.importStatus.textContent = "";
    elements.importStatus.className = "status-line";
  }
  applyWarehouseHint(null);
  saveStateWithoutServer();
  render();
}

async function resetOrder() {
  if (!requireCurrentUser()) return;
  const hasData = state.lines.length || state.rawText || state.orderNumber || state.customerName;
  if (hasData && !confirm("Aktuellen Auftrag leeren?")) return;

  await releaseCurrentOrderActivity();
  resetCurrentOrderView();
}

function exportCsv() {
  if (!requireCurrentUser()) return;
  markOrderTouched();

  const rows = [
    ["Auftrag", state.orderNumber],
    ["Kunde", state.customerName],
    ["Datum", state.orderDate],
    ["Uhrzeit", state.orderTime],
    ["Erstellt von", state.createdBy],
    ["Zuletzt bearbeitet von", state.lastEditedBy],
    ["Abgeschlossen von", state.completedBy],
    ["Europaletten", state.euroPallets],
    ["Stellplätze", state.storageSpaces],
    ["Notiz", state.orderNote],
    [],
    ["Erledigt", "Lagerauftrag", "Barcode", "Von-Handling-Unit", "Zusatzbemerkung", "Lagerplatz", "Produkt", "Produktbeschreibung", "Soll", "Ist", "Ist geaendert", "Einheit", "Nach-Lagerplatz"]
  ];

  state.lines.forEach((line) => {
    rows.push([
      line.picked ? "ja" : "nein",
      line.warehouseOrder,
      line.barcode || "",
      line.fromHandlingUnit,
      combinedPositionNote(line),
      line.fromBin,
      line.product,
      line.description,
      line.targetQty,
      line.actualQty,
      isQuantityChanged(line) ? "ja" : "",
      line.unit,
      line.toBin
    ]);
  });

  const csv = rows.map((row) => row.map(escapeCsv).join(";")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `kommissionierung-${state.orderNumber || "auftrag"}.csv`, "CSV");
}

function isQuantityChanged(line) {
  return window.HLogistikStateHelpers.isQuantityChanged(line);
}

async function exportPdf() {
  if (!requireCurrentUser()) return;

  if (!serverOnline) {
    showExportMessage("PDF kann nur am Server ausgegeben werden. Bitte Verbindung zum Laptop-Server prüfen.");
    return;
  }

  if ((state.orderType || currentMode) === "storage") {
    pruneEmptyManualStorageLines();
  }

  const completionMessage = orderExportCompletionMessage(state);
  if (completionMessage) {
    showExportMessage(completionMessage);
    setServerStatus(completionMessage, "error");
    return;
  }

  if ((state.orderType || currentMode) === "storage") {
    const validationMessage = storageOrderExportMessage();
    if (validationMessage) {
      showExportMessage(validationMessage);
      setServerStatus(validationMessage, "error");
      return;
    }
  }

  const saved = await saveOrderNow(true);
  if (!saved || !state.id) {
    showExportMessage("PDF konnte nicht gespeichert werden, weil der Auftrag nicht auf dem Server gespeichert ist.");
    return;
  }

  try {
    showExportMessage("PDF wird auf dem Server erstellt...");
    const result = await apiJson(`/api/orders/${encodeURIComponent(state.id)}/export-pdf`, {
      method: "POST",
      body: JSON.stringify({ order: currentOrderPayload(), userName: currentUser.name })
    });
    state.exportedAt = result.exportedAt || new Date().toISOString();
    state.exportedPdfFile = result.file || "";
    state.exportedPdfPath = result.path || "";
    const exportedFile = result.file || "PDF";
    const exportedPath = result.path || "";
    const copyPath = result.copyPath || "";
    const stockText = state.orderType === "storage"
      ? stockReceiptSummary(result.stockReceipt, result.storageArticles)
      : stockIssueSummary(result.stockIssue, result.stockWarehouse);
    const archiveText = originalArchiveSummary(result.archiveOriginal);
    resetCurrentOrderView();
    showExportMessage(
      exportedPath
        ? `PDF gespeichert: ${exportedPath}${copyPath ? ` | Kopie: ${copyPath}` : ""}${stockText ? ` | ${stockText}` : ""}${archiveText ? ` | ${archiveText}` : ""}`
        : `${exportedFile} gespeichert.${archiveText ? ` ${archiveText}` : ""}`
    );
    showStockIssueErrors(result.stockIssue);
    await loadOrderList();
  } catch (error) {
    showExportMessage(`Server-PDF fehlgeschlagen: ${error.message}`);
  }
}

function orderExportCompletionMessage(order = state) {
  const lines = exportableOrderLines(order);
  if (!lines.length) return "Export gesperrt: Auftrag hat keine Positionen.";
  if (hasOpenFromBinReviewWarnings(lines)) return fromBinReviewBlockMessage();
  const openLines = lines.filter((line) => !line?.picked);
  if (!openLines.length) return "";
  return `Export gesperrt: Erst alle Positionen abhaken (${openLines.length} offen${openPositionListText(openLines)}).`;
}

function exportableOrderLines(order) {
  return (Array.isArray(order?.lines) ? order.lines : [])
    .filter((line) => !isEmptyManualStorageLine(line));
}

function openPositionListText(lines) {
  const positions = lines
    .slice(0, 5)
    .map((line, index) => String(line?.warehouseOrder || line?.position || index + 1).trim())
    .filter(Boolean);
  if (!positions.length) return "";
  return `: Pos. ${positions.join(", ")}${lines.length > positions.length ? ", ..." : ""}`;
}

function stockIssueSummary(stockIssue, stockWarehouse = "") {
  if (!stockIssue) return "";
  const booked = Number(stockIssue.booked || 0);
  const errors = Array.isArray(stockIssue.errors) ? stockIssue.errors.length : 0;
  if (!booked && !errors) return "Keine Bestandsbuchung";
  const warehouse = normalizeOptionalWarehouse(stockWarehouse);
  return `${booked} Bestandsbuchung(en)${warehouse ? ` aus ${warehouse}` : ""}${errors ? `, ${errors} Fehler` : ""}`;
}

function originalArchiveSummary(archiveOriginal) {
  if (!archiveOriginal || typeof archiveOriginal !== "object") return "";
  if (archiveOriginal.archived) {
    return `Original archiviert: ${archiveOriginal.archivePath || archiveOriginal.fileName || "Archiv"}`;
  }
  if (archiveOriginal.reason === "already-archived") return "Original war bereits archiviert.";
  if (archiveOriginal.reason === "missing-original-file") return "Original nicht archiviert: kein Originaldateiname am Auftrag.";
  if (archiveOriginal.error) return `Original nicht archiviert: ${archiveOriginal.error}`;
  return "";
}

function stockReceiptSummary(stockReceipt, storageArticles) {
  const booked = Number(stockReceipt?.booked || 0);
  const created = Array.isArray(storageArticles?.created) ? storageArticles.created.length : 0;
  const updated = Array.isArray(storageArticles?.updated) ? storageArticles.updated.length : 0;
  return `${booked} Wareneingangsbuchung(en) in SSI${created || updated ? `, ${created} Artikel angelegt, ${updated} aktualisiert` : ""}`;
}

function showStockIssueErrors(stockIssue) {
  const errors = Array.isArray(stockIssue?.errors) ? stockIssue.errors : [];
  if (!errors.length) return;
  const preview = errors
    .slice(0, 12)
    .map((error) => {
      const label = [error.position ? `Pos. ${error.position}` : "", error.materialnummer, error.lagerplatz, error.leNummer]
        .filter(Boolean)
        .join(" | ");
      return `${label}: ${error.message}`;
    })
    .join("\n");
  const suffix = errors.length > 12 ? `\n... und ${errors.length - 12} weitere Fehler` : "";
  alert(`PDF wurde erstellt, aber nicht alle Bestände konnten abgebucht werden:\n\n${preview}${suffix}`);
}

function downloadBlob(blob, fileName, label = "Datei") {
  if (activeDownloadUrl) URL.revokeObjectURL(activeDownloadUrl);
  const url = URL.createObjectURL(blob);
  activeDownloadUrl = url;
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";

  if (label !== "PDF") {
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  showExportLink(url, fileName, label);
}

function showExportLink(url, fileName, label) {
  if (!elements.exportStatus) return;
  elements.exportStatus.hidden = false;
  elements.exportStatus.innerHTML = "";
  const text = document.createTextNode(`${label} erstellt. `);
  const openLink = document.createElement("a");
  openLink.href = url;
  openLink.target = "_blank";
  openLink.rel = "noopener";
  openLink.textContent = label ? `${label} \u00f6ffnen` : "\u00d6ffnen";
  const spacer = document.createTextNode(" | ");
  const downloadLink = document.createElement("a");
  downloadLink.href = url;
  downloadLink.download = fileName;
  downloadLink.target = "_blank";
  downloadLink.rel = "noopener";
  downloadLink.textContent = fileName;
  elements.exportStatus.append(text, openLink, spacer, downloadLink);
}

function showExportMessage(message) {
  if (!elements.exportStatus) return;
  elements.exportStatus.hidden = false;
  elements.exportStatus.textContent = message;
}

function escapeCsv(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replace(/"/g, '""')}"`;
}
