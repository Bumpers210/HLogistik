const STORAGE_KEY = "kommissionier-app-state-v1";
const USER_KEY = "kommissionier-app-user-v1";
const USER_GROUP_KEY = "kommissionier-app-user-group-v1";
const WAREHOUSE_KEY = "hlogistik-warehouse-v1";
const KNOWN_ORDERS_KEY = "kommissionier-app-known-orders-v1";
const MODE_KEY = "kommissionier-app-mode-v1";
const API_BASE = "";
const OCR_LANGUAGE = "deu+eng";
const OCR_RENDER_SCALE = 2.5;
const OCR_PRECISE_RENDER_SCALE = 4;
const BESTELLSCHEIN_PRECISE_OCR_SCALES = [3, OCR_PRECISE_RENDER_SCALE];
const OCR_ROTATIONS = [0, 90, 180, 270];
const STORAGE_IMAGE_ROTATIONS = [0, -2, 2, -4, 4];
const OCR_STRONG_CANDIDATE_SCORE = 6500;
const MAX_PRECISE_BIN_SCAN_PAGES = 4;
const ACTIVE_ORDER_TIMEOUT_MS = 10 * 60 * 1000;
const ORDER_LIST_REFRESH_MS = 30 * 1000;
const ACTIVITY_HEARTBEAT_MS = 60 * 1000;
const ORDER_NOTICE_DURATION_MS = 12000;
const CONNECTION_CHECK_MS = 30 * 1000;
const CONNECTION_CHECK_TIMEOUT_MS = 5000;

const state = {
  id: "",
  orderNumber: "",
  customerName: "",
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
    "clearDoneButton",
    "pickList",
    "pickHeader",
    "storageLineActions",
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
  elements.saveOrderButton.addEventListener("click", saveOrderNow);
  elements.releaseOrderButton.addEventListener("click", releaseCurrentOrder);
  elements.discardDraftButton.addEventListener("click", discardCurrentDraft);
  elements.takeOverOrderButton.addEventListener("click", takeOverCurrentOrder);
  elements.refreshOrdersButton.addEventListener("click", loadOrderList);
  elements.deleteOrderButton.addEventListener("click", deleteCurrentOrder);
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
  window.addEventListener("pagehide", persistCurrentOrderCache);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistCurrentOrderCache();
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
  elements.clearDoneButton.addEventListener("click", () => {
    state.collapseDone = !state.collapseDone;
    updateCollapseButtonText();
    saveAndRender();
  });

  ["orderNumber", "customerName", "orderDate", "orderTime", "euroPallets", "storageSpaces", "orderNote"].forEach((id) => {
    elements[id].addEventListener("input", () => {
      state[id] = elements[id].value;
      markOrderTouched();
      saveState();
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
  navigator.serviceWorker.register("/service-worker.js").catch(() => {
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
  return normalizeWarehouse(localStorage.getItem(WAREHOUSE_KEY));
}

function saveCurrentWarehouse() {
  if (!elements.warehouseSelect) return;
  localStorage.setItem(WAREHOUSE_KEY, normalizeWarehouse(elements.warehouseSelect.value));
}

function applyWarehouseSelection() {
  if (!elements.warehouseSelect) return;
  elements.warehouseSelect.value = currentWarehouse();
}

function normalizeWarehouse(value) {
  return String(value || "SSI").trim().toUpperCase() === "SI" ? "SI" : "SSI";
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
  if (!elements.currentUserName) return;
  const group = userGroupLabel(currentUser.group);
  elements.currentUserName.textContent = currentUser.name ? `${currentUser.name}${group ? ` - ${group}` : ""}` : "Nicht angemeldet";
}

function normalizeUserGroup(value) {
  return value === "lager" || value === "buero" || value === "tablet" ? value : "";
}

function userGroupLabel(group) {
  if (group === "lager") return "Lager";
  if (group === "buero") return "Büro";
  if (group === "tablet") return "Tablet";
  return "";
}

function storageNavLabel(group) {
  return group === "buero" ? "Buchung" : "Einlagern";
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
        setImportStatus(result.message || "Import abgebrochen.", "warning", 100);
      } else if (result.lines > 0) {
        const suffix = imported.source === "ocr" ? " per OCR" : "";
        const skippedNotice = result.warnings?.length ? ` ${result.warnings.length} Tabellenzeile(n) nicht uebernommen.` : "";
        setImportStatus(`${result.lines} Einlagerungspositionen${suffix} als Entwurf importiert.${skippedNotice} Bitte pruefen und freigeben. HU und Stellplatz koennen am Tablet eingetragen werden.`, result.warnings?.length ? "warning" : "ok", 100);
      } else if (result.warnings?.length) {
        setImportStatus(`Keine Einlagerungspositionen importiert. ${result.warnings.length} Tabellenzeile(n) nicht uebernommen: ${result.warnings[0]}`, "warning", 100);
      } else if (imported.text.trim()) {
        setImportStatus("Text gelesen, aber keine Lieferscheinpositionen erkannt.", "error");
      } else {
        setImportStatus("Keine lesbaren Inhalte gefunden.", "error");
      }
      return;
    }

    const imported = await chooseBestImportText(pdf, fullText, pageTexts);
    const result = await importText(imported.text, file.name, imported.parsed);

    if (result.cancelled) {
      setImportStatus(result.message || "Import abgebrochen.", "warning", 100);
    } else if (result.lines > 0) {
      const suffix = imported.source === "ocr" ? " per OCR" : "";
      const pageNotice = imported.pageNotice ? ` ${imported.pageNotice}` : "";
      const binNotice = result.autoBins ? ` ${result.autoBins} Stellplatz(e) automatisch gesetzt.` : "";
      const preciseBinNotice = result.binCorrections ? ` ${result.binCorrections} Stellplatz(e) per genauer Pruefung korrigiert.` : "";
      const binWarningNotice = result.binWarnings ? ` ${result.binWarnings} Stellplatz(e) bitte pruefen.` : "";
      const warehouseNotice = result.warehouseHint?.shortMessage ? ` ${result.warehouseHint.shortMessage}` : "";
      const statusType = imported.pageNotice?.startsWith("Achtung") || result.warehouseHint?.type === "warning" || result.binWarnings ? "warning" : "ok";
      setImportStatus(`${result.lines} Positionen${suffix} als Entwurf importiert.${binNotice}${preciseBinNotice}${binWarningNotice} Bitte pruefen und freigeben.${pageNotice}${warehouseNotice}`, statusType, 100);
    } else if (imported.text.trim()) {
      setImportStatus("Text gelesen, aber keine Tabellenzeilen erkannt.", "error");
    } else {
      setImportStatus("Keine lesbaren Inhalte gefunden.", "error");
    }
  } catch (error) {
    console.error(error);
    const fallbackText = data ? extractTextFromSimplePdf(data) : "";
    if (fallbackText.trim()) {
      const result = currentMode === "storage"
        ? await importStorageText(fallbackText, file.name)
        : await importText(fallbackText, file.name);
      const warehouseNotice = currentMode === "storage" ? "" : result.warehouseHint?.shortMessage ? ` ${result.warehouseHint.shortMessage}` : "";
      setImportStatus(
        result.cancelled ? result.message || "Import abgebrochen." : `Fallback genutzt: ${result.lines} Positionen als Entwurf importiert. Bitte prüfen und freigeben.${warehouseNotice}`,
        result.cancelled || result.warehouseHint?.type === "warning" ? "warning" : result.lines ? "ok" : "error",
        result.cancelled || result.lines ? 100 : null
      );
    } else {
      setImportStatus(error.message || "PDF konnte nicht ausgelesen werden.", "error");
    }
  } finally {
    event.target.value = "";
  }
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

async function chooseBestImportText(pdf, fullText, pageTexts = []) {
  let parsed = parseOrderText(fullText);
  if (parsed.lines.length) {
    const binScan = await refinePickingBinsWithPreciseScan(pdf, pageTexts, parsed);
    const sanitizedParsed = sanitizeBestellscheinHandlingUnitDuplicates(binScan.parsed, fullText);
    return {
      text: fullText,
      parsed: sanitizedParsed,
      source: "pdf-text",
      pageNotice: bestellscheinPageNotice(fullText, pdf.numPages),
      binScan
    };
  }

  const reason = fullText.trim()
    ? "PDF-Text erkannt, aber keine Tabellenzeilen. Starte OCR ..."
    : "Scan erkannt. Starte OCR ...";
  setImportStatus(reason, "", 5);

  const ocrText = await readPdfWithOcr(pdf);
  if (!ocrText.trim()) return { text: fullText, parsed, source: "pdf-text" };

  const combinedText = fullText.trim() ? `${fullText}\n${ocrText}` : ocrText;
  parsed = parseOrderText(combinedText);
  const binScan = await refinePickingBinsWithPreciseScan(pdf, pageTexts, parsed);
  const sanitizedParsed = sanitizeBestellscheinHandlingUnitDuplicates(binScan.parsed, combinedText);
  return {
    text: combinedText,
    parsed: sanitizedParsed,
    source: "ocr",
    pageNotice: bestellscheinPageNotice(combinedText, pdf.numPages),
    binScan
  };
}

async function chooseBestStorageImportText(pdf, fullText, fileName = "", pageTexts = []) {
  let parsed = parseStorageSlipText(fullText, fileName, pageTexts);
  if (parsed.lines.length) return {
    text: fullText,
    parsed,
    source: "pdf-text"
  };

  const reason = fullText.trim()
    ? "PDF-Text erkannt, aber keine Lieferscheinpositionen. Starte OCR ..."
    : "Scan erkannt. Starte OCR ...";
  setImportStatus(reason, "", 5);

  const ocrText = await readPdfWithOcr(pdf, (text) => parseStorageSlipText(text, fileName), scoreStorageOcrCandidate);
  if (!ocrText.trim()) return { text: fullText, parsed, source: "pdf-text" };

  const combinedText = fullText.trim() ? `${fullText}\n${ocrText}` : ocrText;
  parsed = parseStorageSlipText(combinedText, fileName);
  return {
    text: combinedText,
    parsed,
    source: "ocr"
  };
}

async function refinePickingBinsWithPreciseScan(pdf, pageTexts = [], parsed = {}) {
  const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const targets = lines
    .map((line, index) => ({ line, index, warning: suspiciousPickingBinWarning(line) }))
    .filter((entry) => entry.warning);

  if (!targets.length) {
    return { parsed, corrected: 0, warnings: 0, scannedPages: 0 };
  }

  const pageNumbers = pageNumbersForPickingBinScan(pageTexts, targets);
  let ocrLines = [];

  if (pageNumbers.length) {
    try {
      setImportStatus(`Pruefe ${targets.length} auffaellige(n) Lagerplatz/Lagerplaetze genauer ...`, "", 70);
      const preciseText = await readPdfPagesWithPreciseOcr(pdf, pageNumbers);
      ocrLines = parseOrderText(preciseText).lines.filter((line) => line?.lineType !== "loading-slip");
    } catch (error) {
      console.warn("Genauer Lagerplatz-Scan fehlgeschlagen.", error);
    }
  }

  let corrected = 0;
  let warnings = 0;
  const nextLines = [...lines];

  targets.forEach(({ line, index, warning }) => {
    const originalBin = normalizePickingBinText(line.fromBin);
    const candidates = [
      preciseScanBinCandidate(line, ocrLines),
      ...pickingBinCorrectionCandidates(originalBin)
    ]
      .map(normalizePickingBinText)
      .filter((value) => value && value !== originalBin && isPlausiblePickingBin(value) && !suspiciousPickingBinWarning({ fromBin: value }));

    const uniqueCandidates = [...new Set(candidates)];
    if (uniqueCandidates.length === 1) {
      nextLines[index] = {
        ...line,
        fromBin: uniqueCandidates[0],
        binWarning: "",
        binWarningValue: ""
      };
      corrected += 1;
      return;
    }

    nextLines[index] = {
      ...line,
      binWarning: `${warning} Bitte pruefen.`,
      binWarningValue: originalBin || String(line.fromBin || "").trim()
    };
    warnings += 1;
  });

  return {
    parsed: { ...parsed, lines: nextLines, binCorrections: corrected, binWarnings: warnings },
    corrected,
    warnings,
    scannedPages: pageNumbers.length
  };
}

function suspiciousPickingBinWarning(line) {
  if (!line || line.lineType === "loading-slip") return "";
  const bin = normalizePickingBinText(line.fromBin);
  if (!bin) return "";
  if (!isPlausiblePickingBin(bin)) return `Lagerplatz unklar: ${bin}.`;

  const h1LetterInNumberSlot = bin.match(/^002-H1-SA[A-Z]([A-Z])[A-D]\d$/i);
  if (h1LetterInNumberSlot) return `Lagerplatz unklar: ${bin}.`;

  return "";
}

function isPlausiblePickingBin(value) {
  const bin = normalizePickingBinText(value);
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

function pickingBinCorrectionCandidates(value) {
  const bin = normalizePickingBinText(value);
  const h1Match = bin.match(/^(002-H1-SA[A-Z])([A-Z])([A-D]\d)$/i);
  if (!h1Match) return [];

  const digit = ocrDigitForBin(h1Match[2]);
  if (digit === "") return [];
  return [`${h1Match[1]}${digit}${h1Match[3]}`];
}

function ocrDigitForBin(value) {
  const text = String(value || "").trim().toUpperCase();
  const map = {
    O: "0",
    D: "0",
    Q: "0",
    I: "1",
    L: "1",
    Z: "2",
    S: "5",
    E: "5",
    B: "8"
  };
  return /^\d$/.test(text) ? text : map[text] || "";
}

function pageNumbersForPickingBinScan(pageTexts, targets) {
  const pages = Array.isArray(pageTexts) ? pageTexts : [];
  const pageNumbers = new Set();

  targets.forEach(({ line }) => {
    const needles = [
      line.warehouseOrder,
      line.fromHandlingUnit,
      line.product,
      line.fromBin
    ].map((value) => normalizeSearchNeedle(value)).filter(Boolean);

    pages.forEach((pageText, index) => {
      const haystack = normalizeSearchNeedle(pageText);
      const hits = needles.filter((needle) => haystack.includes(needle)).length;
      if (hits >= 2 || (needles[0] && haystack.includes(needles[0]))) pageNumbers.add(index + 1);
    });
  });

  if (!pageNumbers.size && pages.length) {
    pages.slice(0, MAX_PRECISE_BIN_SCAN_PAGES).forEach((_, index) => pageNumbers.add(index + 1));
  }

  return [...pageNumbers].sort((a, b) => a - b).slice(0, MAX_PRECISE_BIN_SCAN_PAGES);
}

function normalizeSearchNeedle(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "");
}

async function readPdfPagesWithPreciseOcr(pdf, pageNumbers) {
  const pages = [...new Set(pageNumbers)]
    .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= pdf.numPages);
  if (!pages.length || !window.Tesseract?.createWorker) return "";

  const worker = await createOcrWorker(pages.length);
  const texts = [];
  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: window.Tesseract.PSM?.AUTO || "3",
      user_defined_dpi: "450"
    });

    for (const pageNumber of pages) {
      setImportStatus(`Genauer Lagerplatz-Scan Seite ${pageNumber}/${pdf.numPages} ...`);
      const canvas = await renderPdfPageToCanvas(pdf, pageNumber, OCR_PRECISE_RENDER_SCALE);
      const result = await worker.recognize(canvas);
      texts.push(result.data.text || "");
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await worker.terminate();
  }
  return texts.join("\n");
}

function preciseScanBinCandidate(line, ocrLines) {
  const candidates = (Array.isArray(ocrLines) ? ocrLines : [])
    .filter((candidate) => lineMatchesPickingBinTarget(line, candidate))
    .map((candidate) => candidate.fromBin)
    .map(normalizePickingBinText)
    .filter(Boolean);

  const uniqueCandidates = [...new Set(candidates)];
  if (uniqueCandidates.length === 1) return uniqueCandidates[0];
  return "";
}

function lineMatchesPickingBinTarget(target, candidate) {
  if (!candidate || candidate.lineType === "loading-slip") return false;
  const targetOrder = normalizeSearchNeedle(target.warehouseOrder);
  const targetHu = normalizeSearchNeedle(target.fromHandlingUnit);
  const targetProduct = normalizeSearchNeedle(target.product);
  let hits = 0;

  if (targetOrder && normalizeSearchNeedle(candidate.warehouseOrder) === targetOrder) hits += 1;
  if (targetHu && normalizeSearchNeedle(candidate.fromHandlingUnit) === targetHu) hits += 1;
  if (targetProduct && normalizeSearchNeedle(candidate.product) === targetProduct) hits += 1;

  return hits >= 2 || Boolean(targetOrder && normalizeSearchNeedle(candidate.warehouseOrder) === targetOrder);
}

async function readPdfWithOcr(pdf, parseCandidate = parseOrderText, scoreCandidate = scoreOcrCandidate) {
  if (!window.Tesseract?.createWorker) {
    throw new Error("OCR-Modul konnte nicht geladen werden. Internetverbindung prüfen und Seite neu laden.");
  }

  const worker = await createOcrWorker(pdf.numPages * OCR_ROTATIONS.length);
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

async function createOcrWorker(totalSteps) {
  let currentStep = 1;
  const worker = await window.Tesseract.createWorker(OCR_LANGUAGE, 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0",
    langPath: "https://tessdata.projectnaptha.com/4.0.0",
    logger: (message) => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        const percent = Math.round(message.progress * 100);
        const overallPercent = Math.min(99, Math.round(((currentStep - 1 + message.progress) / totalSteps) * 100));
        setImportStatus(`OCR ${currentStep}/${totalSteps}: ${percent}%`, "", overallPercent);
      }
    }
  });

  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: window.Tesseract.PSM?.AUTO || "3",
    user_defined_dpi: "300"
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
  const preciseUsed = new Set();
  return (Array.isArray(baseLines) ? baseLines : []).map((line) => {
    const preciseIndex = (Array.isArray(preciseLines) ? preciseLines : []).findIndex((candidate, index) => (
      !preciseUsed.has(index) && isSameBestellscheinOcrLine(line, candidate)
    ));
    if (preciseIndex === -1) return line;

    preciseUsed.add(preciseIndex);
    const preciseLine = preciseLines[preciseIndex];
    const fromHandlingUnit = chooseBestellscheinHandlingUnit(line.fromHandlingUnit, preciseLine.fromHandlingUnit);
    if (fromHandlingUnit === line.fromHandlingUnit) return line;
    return { ...line, fromHandlingUnit, fromHandlingUnitEditable: !fromHandlingUnit };
  });
}

function isSameBestellscheinOcrLine(left, right) {
  if (!left || !right) return false;
  return String(left.product || "").trim() === String(right.product || "").trim()
    && normalizeQuantity(left.targetQty) === normalizeQuantity(right.targetQty)
    && bestellscheinDescriptionKey(left.description) === bestellscheinDescriptionKey(right.description);
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
  if (base.length === precise.length && base.slice(0, 6) === precise.slice(0, 6)) return precise;
  return base;
}

function cleanBestellscheinBarcode(value) {
  return String(value || "")
    .replace(/\D/g, "")
    .trim();
}

function buildBestellscheinOcrText(sourceText, lines) {
  const headerMatch = String(sourceText || "").match(/^[\s\S]*?(?=\n\s*\d{6,8}\b)/);
  const header = headerMatch ? headerMatch[0].trim() : "";
  const body = (Array.isArray(lines) ? lines : [])
    .filter((line) => line?.product && line?.targetQty)
    .map(bestellscheinLineToOcrText)
    .join("\n");
  return [header, body].filter(Boolean).join("\n");
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
    return `Achtung: Bestellschein nennt ${declaredTotal} Seiten, in dieser PDF wurden nur ${checkedPages} Seiten geprueft.`;
  }

  if (checkedPages > 1 || declaredTotal > 1) {
    return `Mehrseitiger Bestellschein geprueft: ${checkedPages}${declaredTotal ? ` von ${declaredTotal}` : ""} Seiten.`;
  }

  return "";
}

async function importText(text, _fileName = "", parsed = parseOrderText(text)) {
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
  state.orderDate = new Date().toISOString().slice(0, 10);
  state.orderTime = currentTimeValue();
  state.awaitingRelease = true;
  state.createdBy = currentUser.name;
  state.lastEditedBy = currentUser.name;
  state.activeUser = "";
  state.activeUserAt = "";

  if (parsed.orderNumber) state.orderNumber = parsed.orderNumber;
  if (parsed.customerName && !state.customerName) state.customerName = parsed.customerName;

  const fallbackLine = parsed.lines.length ? null : fallbackImportLine(text);
  if (!parsed.lines.length && !fallbackLine) {
    clearCurrentOrder();
    render();
    return {
      lines: 0,
      cancelled: true,
      message: "Lagerauftrag erkannt, aber keine vollstaendige Position gelesen. Import abgebrochen."
    };
  }

  const nextLines = parsed.lines.length ? parsed.lines : [fallbackLine];
  const warehouseHint = await detectPickingWarehouse(nextLines, text);
  applyWarehouseHint(warehouseHint);
  const binResult = await applyStorageBinsFromArticleStock(nextLines);
  state.lines = binResult.lines;
  topControlsCollapsed = false;
  saveStateWithoutServer();
  render();
  return {
    lines: parsed.lines.length,
    autoBins: binResult.applied,
    warehouseHint,
    binCorrections: Number(parsed.binCorrections || 0),
    binWarnings: countOpenBinWarnings(state.lines)
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
  if (/Schwan\s+International/i.test(source)) scores.SI.textHits += 1;

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
      binWarningValue: ""
    };
  });

  return { lines: nextLines, cleared };
}

function shouldClearBinWarning(line, nextBin) {
  if (!String(line?.binWarning || "").trim()) return false;
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

async function applyStorageBinsFromArticleStock(lines) {
  if (!serverOnline || !Array.isArray(lines) || !lines.length) return { lines, applied: 0 };

  const materials = [...new Set(lines.map((line) => String(line.product || "").trim()).filter(Boolean))];
  if (!materials.length) return { lines, applied: 0 };

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
  const enriched = lines.map((line) => {
    const materialnummer = String(line.product || "").trim();
    const handlingUnit = normalizeHandlingUnitLookup(line.fromHandlingUnit);
    if (!materialnummer || !handlingUnit) return line;

    const match = (locationsByMaterial.get(materialnummer) || []).find((location) => (
      normalizeHandlingUnitLookup(location.leNummer || location.le_nummer) === handlingUnit
    ));
    if (!match?.lagerplatz) return line;

    const nextBin = String(match.lagerplatz || "").trim();
    const stockQty = Number(match.mengeStueck || match.menge_stueck || 0) || 0;
    const quantityRemark = storageQuantityRemarkForLine(line, stockQty);
    const nextNote = updateStorageQuantityRemark(line.positionNote, quantityRemark);
    const binChanged = Boolean(nextBin && String(line.fromBin || "").trim().toUpperCase() !== nextBin.toUpperCase());
    const noteChanged = nextNote !== String(line.positionNote || "").trim();

    if (!binChanged && !noteChanged && Number(line.stockQty || 0) === stockQty) return line;

    if (binChanged) applied += 1;
    return {
      ...line,
      fromBin: binChanged ? nextBin : line.fromBin,
      binWarning: binChanged ? "" : line.binWarning || "",
      binWarningValue: binChanged ? "" : line.binWarningValue || "",
      positionNote: nextNote,
      stockQty
    };
  });

  return { lines: enriched, applied };
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

function updateStorageQuantityRemark(note, remark) {
  const cleanedParts = String(note || "")
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^1\s*Pal\.?$/i.test(part) && !/^com$/i.test(part));

  const nextRemark = String(remark || "").trim();
  if (nextRemark) cleanedParts.push(nextRemark);
  return cleanedParts.join("; ");
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
  state.rawText = text;
  state.orderDate = new Date().toISOString().slice(0, 10);
  state.orderTime = currentTimeValue();
  state.orderNumber = parsed.orderNumber || await nextStorageOrderNumber();
  state.customerName = "SSI";
  state.lines = parsed.lines.length ? parsed.lines : [createLine({ description: text.slice(0, 140) })];
  topControlsCollapsed = state.lines.length > 0;
  markOrderTouched();
  saveAndRender();
  return { lines: parsed.lines.length, warnings: parsed.warnings || [] };
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

  const orderNumber = findFirst(text, [
    /Bestellschein\s*Nr\.?\s*[:.-]?\s*([A-Z0-9-]{4,})/i,
    /(?:^|\n)\s*(?:auftragsnr\.?|auftragsnummer|belegnr\.?)\s*[:#-]?\s*([A-Z0-9-]{4,})/i,
    /(?:^|\n)\s*(?:auftrag|kommission|lieferschein)\s*[:#-]\s*([A-Z0-9-]{4,})/i
  ]);
  const explicitCustomerName = findFirst(text, [
    /Auslagerung\s*[:#-]?\s*([^\n\t]{3,80})/i,
    /(?:kunde|lieferadresse|empfänger)\s*[:#-]?\s*([^\n\t]{3,80})/i
  ]);

  const tableRows = annotateDestinationExceptions(collectWarehouseRows(pickingLines));
  const stackedRows = tableRows.length ? [] : annotateDestinationExceptions(collectStackedWarehouseRows(pickingLines));
  const splitRows = tableRows.length || stackedRows.length ? [] : annotateDestinationExceptions(collectSplitWarehouseRows(pickingLines));
  const warehouseRows = tableRows.length ? tableRows : stackedRows.length ? stackedRows : splitRows;
  const destinationCustomerName = destinationToCustomerName(warehouseRows);
  const customerName = destinationCustomerName || cleanCustomerName(explicitCustomerName || findCustomerFromHeader(pickingLines));

  if (warehouseRows.length) {
    return {
      orderNumber: "",
      customerName: customerName || "",
      lines: appendLoadingSlipLines(warehouseRows.map((line) => createLine({
        ...line,
        actualQty: line.targetQty,
        fromHandlingUnitEditable: !String(line.fromHandlingUnit || "").trim()
      })), loadingSlipLines)
    };
  }

  const bestellscheinRows = collectBestellscheinRows(pickingLines);
  if (bestellscheinRows.length) {
    return {
      orderNumber: orderNumber || "",
      customerName: cleanCustomerName(explicitCustomerName || "Bestellschein"),
      lines: appendLoadingSlipLines(bestellscheinRows.map((line, index) => createLine({
        ...line,
        warehouseOrder: String(index + 1),
        actualQty: line.targetQty,
        fromHandlingUnitEditable: !String(line.fromHandlingUnit || "").trim()
      })), loadingSlipLines)
    };
  }

  if (pickingLines.some((line) => /lageraufg/i.test(line))) {
    return {
      orderNumber: orderNumber || "",
      customerName: customerName || "",
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
    lines: appendLoadingSlipLines(candidates.map((line, index) => createLine({
      ...line,
      warehouseOrder: line.position || String(index + 1),
      actualQty: line.targetQty
    })), loadingSlipLines)
  };
}

function appendLoadingSlipLines(lines, loadingSlipLines) {
  if (!Array.isArray(lines)) return lines;
  const additions = (Array.isArray(loadingSlipLines) ? loadingSlipLines : [])
    .filter((line) => line?.lineType === "loading-slip" && String(line.barcode || "").trim());
  if (!additions.length) return lines;

  const result = [...lines];
  additions.forEach((loadingSlipLine) => {
    const barcode = String(loadingSlipLine.barcode || "").trim();
    const exists = result.some((line) => line.lineType === "loading-slip" && String(line.barcode || "").trim() === barcode);
    if (!exists) result.push(loadingSlipLine);
  });
  return result;
}

function mergeServerLoadingSlipLines(order, serverOrder) {
  if (!order || !Array.isArray(order.lines) || !Array.isArray(serverOrder?.lines)) return order;

  const serverLoadingSlipLines = serverOrder.lines
    .filter((line) => line?.lineType === "loading-slip" && String(line.barcode || "").trim());
  if (!serverLoadingSlipLines.length) return order;

  const previousByBarcode = new Map(
    order.lines
      .filter((line) => line?.lineType === "loading-slip" && String(line.barcode || "").trim())
      .map((line) => [String(line.barcode || "").trim(), line])
  );
  const normalLines = order.lines.filter((line) => line?.lineType !== "loading-slip");
  const mergedLoadingSlipLines = serverLoadingSlipLines.map((line) => {
    const previous = previousByBarcode.get(String(line.barcode || "").trim());
    return {
      ...line,
      picked: previous?.picked ?? line.picked,
      positionNote: String(previous?.positionNote || "").trim() || line.positionNote || ""
    };
  });

  return {
    ...order,
    lines: [...normalLines, ...mergedLoadingSlipLines]
  };
}

function parseLoadingSlipLines(lines) {
  const blocks = loadingSlipBlocksFrom(lines);
  const seen = new Set();

  return blocks
    .map(parseLoadingSlipBlock)
    .filter(Boolean)
    .filter((line) => {
      const barcode = String(line.barcode || "").trim();
      if (!barcode || seen.has(barcode)) return false;
      seen.add(barcode);
      return true;
    });
}

function parseLoadingSlipBlock(lines) {
  if (!isLikelyLoadingSlip(lines)) return null;

  const rows = collectBestellscheinRows(lines);
  const row = rows[0] || parseStackedLoadingSlipRow(lines);
  if (!row) return null;

  const barcode = extractLoadingSlipHeaderBarcode(lines) || row.fromHandlingUnit || "";
  if (!barcode) return null;

  return createLine({
    lineType: "loading-slip",
    warehouseOrder: "Ladeschein",
    barcode,
    product: row.product || "",
    description: row.description || "Ladeschein",
    targetQty: row.targetQty || "",
    actualQty: row.targetQty || "",
    unit: row.unit || "",
    positionNote: rows.length > 1 ? `Ladeschein mit ${rows.length} Positionen` : "",
    fromHandlingUnit: "",
    fromHandlingUnitEditable: false,
    fromBin: "",
    toBin: ""
  });
}

function loadingSlipBlocksFrom(lines) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const startIndexes = sourceLines
    .map((line, index) => (isLoadingSlipStartLine(line) ? index : -1))
    .filter((index) => index !== -1);

  return startIndexes.map((startIndex, index) => {
    const nextStart = startIndexes[index + 1] ?? sourceLines.length;
    return sourceLines.slice(startIndex, nextStart);
  });
}

function isLoadingSlipStartLine(line) {
  return /lad[ce](?:schein|liste)|lade(?:schein|liste)/i.test(String(line || ""));
}

function linesBeforeLoadingSlip(lines) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const startIndex = sourceLines.findIndex(isLoadingSlipStartLine);
  return startIndex === -1 ? sourceLines : sourceLines.slice(0, startIndex);
}

function isLikelyLoadingSlip(lines) {
  const source = Array.isArray(lines) ? lines.join("\n") : String(lines || "");
  return /lad[ce](?:schein|liste)|lade(?:schein|liste)|bestellschein|entnahmeanweisungen/i.test(source) && (
    collectBestellscheinRows(lines).length > 0 || Boolean(parseStackedLoadingSlipRow(lines))
  );
}

function parseStackedLoadingSlipRow(lines) {
  const normalized = normalizeLoadingSlipText(Array.isArray(lines) ? lines.join(" ") : String(lines || ""));
  if (!/lad[ce](?:schein|liste)|lade(?:schein|liste)/i.test(normalized)) return null;

  const rowMatch = normalized.match(/\b(\d{6,8})\b\s+(.+?)\s+(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:[,.]\d+)?)\s*(St(?:ü|ue|u|ii|i)ck|STK?|PC|PCS|KG|G|KAR|PCK|PAK|VE|PAL)\b/i);
  if (!rowMatch) return null;

  const description = cleanLoadingSlipDescription(rowMatch[2]);
  const targetQty = normalizeLoadingSlipQuantity(rowMatch[3]);
  if (!description || !targetQty) return null;

  return {
    fromHandlingUnit: extractLoadingSlipHeaderBarcode(lines),
    fromBin: "",
    product: rowMatch[1],
    description,
    targetQty,
    unit: normalizeUnit(rowMatch[4]),
    toBin: ""
  };
}

function normalizeLoadingSlipText(value) {
  return String(value || "")
    .replace(/[|[\]{}]/g, " ")
    .replace(/\bArtikeI\b/g, "Artikel")
    .replace(/\bBezeichnunq\b/g, "Bezeichnung")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLoadingSlipDescription(value) {
  return String(value || "")
    .replace(/\b(?:Menge|Verpackung|Artikel|Bezeichnung)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoadingSlipQuantity(value) {
  const raw = String(value || "").trim();
  const withoutDecimalZeros = raw.replace(/,\s*0+$/, "");
  if (/^\d{1,3}(?:[.\s]\d{3})+$/.test(withoutDecimalZeros)) {
    return withoutDecimalZeros.replace(/\s+/g, ".");
  }
  return normalizeQuantity(raw);
}

function extractLoadingSlipHeaderBarcode(lines) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const firstRowIndex = sourceLines.findIndex((line) => /^\d{6,8}\b/.test(String(line || "").trim()));
  const headerText = (firstRowIndex === -1 ? sourceLines.slice(0, 20) : sourceLines.slice(0, firstRowIndex)).join(" ");
  const sourceText = headerText || sourceLines.slice(0, 20).join(" ");
  const numberMatch = sourceText.match(/\b(?:Nummer|Numm(?:e|c)r|Nr\.?)\s*[:.-]?\s*([A-Z]\s*\d[\d\s./-]{5,}\d)\b/i);
  if (numberMatch) return cleanLoadingSlipBarcode(numberMatch[1]);

  const candidates = [...sourceText.matchAll(/\b[A-Z]\s*\d[\d\s./-]{5,}\d\b|\b[A-Z0-9]{8,24}\b/g)]
    .map((match) => match[0])
    .map(cleanLoadingSlipBarcode)
    .filter((value) => /\d/.test(value))
    .filter((value) => !/^\d{6,8}$/.test(value))
    .filter((value) => !/^(?:20\d{6}|19\d{6})$/.test(value));
  return candidates.find((value) => value.length >= 12) || candidates[0] || "";
}

function cleanLoadingSlipBarcode(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[|]/g, "/")
    .replace(/[^A-Z0-9/.-]/gi, "")
    .toUpperCase();
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
    if (line.lineType !== "loading-slip" && isWarehouseLikeText(source) && !String(line.fromBin || "").trim()) {
      issues.push(`${label}: Von-Lagerplatz fehlt.`);
    }
  });

  return issues;
}

function duplicateHandlingUnitConflicts(lines) {
  const byHandlingUnit = new Map();

  (Array.isArray(lines) ? lines : []).forEach((line, index) => {
    const rawValue = String(line?.fromHandlingUnit || "").trim();
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
  const normalized = normalizeQuantity(String(value || "").replace(",", "."));
  const multiplier = normalized.match(/^(\d+)x(\d+(?:\.\d+)?)$/i);
  if (multiplier) return Number(multiplier[1]) * Number(multiplier[2]);
  return Number(normalized);
}

function fallbackImportLine(text) {
  if (isWarehouseLikeText(text)) return null;
  return createLine({ description: String(text || "").slice(0, 140) });
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

function parseBestellscheinRowStrict(chunk) {
  const fullText = normalizeBestellscheinText(chunk);
  const headerText = bestellscheinHeaderText(fullText);
  const rowMatch = headerText.match(/^(\d{6,8})\s+(.+?)\s+(\d{1,4}(?:[,.]\d{3})*|\d+(?:[,.]\d+)?)\s*(ST|Stk|Stueck|StÃ¼ck|PC|PCS)\b/i);
  if (!rowMatch) return null;

  const product = rowMatch[1];
  const description = cleanBestellscheinDescription(rowMatch[2]);
  const targetQty = normalizeQuantity(rowMatch[3]);
  const unit = normalizeUnit(rowMatch[4]);
  const fromBin = extractBestellscheinBin(fullText);
  const fromHandlingUnit = extractBestellscheinFirstBarcode(fullText, product);

  if (!description || !targetQty) return null;

  return {
    fromHandlingUnit,
    fromBin,
    product,
    description,
    targetQty,
    unit,
    toBin: ""
  };
}

function parseBestellscheinRow(chunk) {
  const fullText = normalizeBestellscheinText(chunk);
  const normalized = bestellscheinHeaderText(fullText);
  const rowMatch = normalized.match(/^(\d{7})\s+(.+?)\s+(\d{1,4}(?:[,.]\d{3})*|\d+(?:[,.]\d+)?)\s*(ST|Stk|Stueck|Stück|PC|PCS)\b/i);
  if (!rowMatch) return null;

  const product = rowMatch[1];
  const description = cleanBestellscheinDescription(rowMatch[2]);
  const targetQty = normalizeQuantity(rowMatch[3]);
  const unit = normalizeUnit(rowMatch[4]);
  const fromBin = extractBestellscheinBin(fullText);
  const fromHandlingUnit = extractBestellscheinFirstBarcode(fullText, product);

  if (!description || !targetQty) return null;

  return {
    fromHandlingUnit,
    fromBin,
    product,
    description,
    targetQty,
    unit,
    toBin: ""
  };
}

function parseBestellscheinRowFallback(chunk, looseQuantity = null) {
  const normalized = normalizeBestellscheinText(chunk);
  const headerText = bestellscheinHeaderText(normalized);
  const headerMatch = headerText.match(/^(\d{6,8})\s+(.+?)$/i);
  if (!headerMatch) return null;

  const product = headerMatch[1];
  const quantityFromDescription = splitTrailingBestellscheinQuantity(headerMatch[2]);
  const targetQty = quantityFromDescription.quantity || looseQuantity?.quantity || "";
  const description = cleanBestellscheinDescription(quantityFromDescription.description || headerMatch[2]);
  if (!description || !targetQty) return null;

  return {
    fromHandlingUnit: extractBestellscheinFirstBarcode(normalized, product),
    fromBin: extractBestellscheinBin(normalized),
    product,
    description,
    targetQty: normalizeQuantity(targetQty),
    unit: normalizeUnit(quantityFromDescription.unit || looseQuantity?.unit || "ST"),
    toBin: ""
  };
}

function bestellscheinHeaderText(value) {
  return String(value || "")
    .split(/\bLagerp?l?atz\s*[:.]?/i)[0]
    .trim();
}

function splitTrailingBestellscheinQuantity(value) {
  const source = String(value || "").trim();
  const match = source.match(/^(.+?\D)\s+(\d{1,4}(?:[,.]\d+)?)$/);
  if (!match) return { description: source, quantity: "", unit: "" };

  return {
    description: match[1].trim(),
    quantity: match[2],
    unit: "ST"
  };
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
  return String(value || "")
    .replace(/[|[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(\d+)8T\b/gi, "$1 ST")
    .replace(/\b5T\b/gi, "ST")
    .replace(/\bS7\b/gi, "ST")
    .trim();
}

function cleanBestellscheinDescription(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\bLagerp?l?atz\b.*$/i, "")
    .trim();
}

function extractBestellscheinBin() {
  return "";
}

function extractBestellscheinFirstBarcode(value, product) {
  const afterBin = String(value || "").match(/Lagerp?l?atz\s*[:.]?\s*\d{2,4}\s*\/\s*\d{7}\D+(.+)$/i);
  const source = String(value || "");
  const productIndex = source.indexOf(String(product || ""));
  const searchText = afterBin ? afterBin[1] : source.slice(productIndex === -1 ? 0 : productIndex + String(product || "").length);

  const candidates = [...searchText.matchAll(/\b\d{8,12}\b/g)]
    .map((match) => ({ value: match[0], index: match.index || 0 }))
    .filter((candidate) => candidate.value !== product)
    .filter((candidate) => !isBestellscheinOrderColumnNumber(searchText, candidate));

  return candidates.find((candidate) => isLikelyHandlingUnit(candidate.value))?.value || candidates[0]?.value || "";
}

function isBestellscheinOrderColumnNumber(text, candidate) {
  const afterNumber = String(text || "").slice(candidate.index + candidate.value.length, candidate.index + candidate.value.length + 8);
  return /^\s+[A-Z]{2}\b/.test(afterNumber);
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
  const fromBin = tokens[cursor] && /-/.test(tokens[cursor]) ? tokens[cursor++] : "";
  const productInfo = parseProductTokens(tokens, cursor);
  const product = productInfo.value;
  cursor = productInfo.next;

  while (shouldSkipOcrQuantityPrefix(tokens[cursor], tokens[cursor + 1], tokens[cursor + 2])) cursor += 1;

  const combinedQuantity = parseQuantityWithUnitToken(tokens[cursor] || "");
  const quantity = combinedQuantity || parseQuantityToken(tokens[cursor] || "");
  const targetQty = quantity ? quantity.value : "";
  if (quantity) cursor += 1;
  const unit = /^[A-Za-zÄÖÜäöü]{1,5}$/.test(tokens[cursor] || "") ? normalizeUnit(tokens[cursor++]) : "Stk";
  const remaining = tokens.slice(cursor);

  if (!product || !targetQty || remaining.length === 0) {
    return parseWarehouseLineByColumns(normalizedLine) || parseWarehouseLineLoose(normalizedLine);
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

  const quantityTokens = tokens
    .slice(productInfo.next, unitIndex)
    .map(parseQuantityToken)
    .filter(Boolean);
  const quantity = quantityTokens.at(-1);
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

function destinationToCustomerName(lines) {
  const destinations = lines
    .map((line) => line.toBin)
    .map(normalizeDestinationName)
    .filter(Boolean);

  return destinations.find((value) => value === "9021-0OUT") || destinations[0] || "";
}

function annotateDestinationExceptions(lines) {
  const defaultDestination = "9021-0OUT";
  const hasDefaultDestination = lines.some((line) => normalizeDestinationName(line.toBin) === defaultDestination);
  if (!hasDefaultDestination) return lines;

  return lines.map((line) => {
    const destination = normalizeDestinationName(line.toBin);
    if (!destination || destination === defaultDestination) return line;

    return {
      ...line,
      positionNote: appendPositionNote(line.positionNote, destination)
    };
  });
}

function appendPositionNote(note, addition) {
  const current = String(note || "").trim();
  const value = String(addition || "").trim();
  if (!value) return current;
  if (current.toUpperCase().includes(value.toUpperCase())) return current;
  return current ? `${current}; ${value}` : value;
}

function normalizeDestinationName(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^9021-00UT$/, "9021-0OUT");
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
    const candidates = [rowText, ...splitPossibleMergedWarehouseRows(rowText)];

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
  const match = normalizedLine.match(/^[^\d]{0,12}(\d{6,})\b/);
  if (!match) return false;

  const rest = normalizedLine.slice(match[0].length);
  return /\b\d{10,}\b/.test(rest) || /\b\d{3}-[A-Z0-9]+-[A-Z0-9]+\b/i.test(rest);
}

function splitPossibleMergedWarehouseRows(text) {
  return normalizeOcrWarehouseLine(text)
    .split(/\s+(?=[^\d]{0,12}\d{6,}\s+\d{10,})/)
    .filter((part) => part !== text);
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
  const fromBin = tokens[cursor] && /-/.test(tokens[cursor]) ? tokens[cursor++] : "";
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

  if (current.length >= 8 && next && isHandlingUnitContinuationToken(tokens[cursor + 1]) && `${current}${next}`.length <= 20) {
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
  const match = text.match(/\b[0OQD]{0,2}\d{1,3}-[A-Z0-9]{1,4}-[A-Z0-9C]{2,8}\b/i);
  if (!match) return "";
  return match[0].replace(/^[OQD]/i, "0").toUpperCase();
}

function extractDestinationBin(text) {
  const source = String(text || "");
  const matches = [...source.matchAll(/9\d{3,4}\s*-\s*[A-Z0-9]+(?:[\s-]+[A-Z0-9]+){0,2}/gi)];
  const match = matches.at(-1);
  if (match) return normalizeDestinationName(match[0]);
  const fallback = source.match(/((?:9\d{3,4}|\d{4})[ -][A-Z0-9]+(?:[ -][A-Z0-9]+)*)\s*$/i);
  return fallback ? normalizeDestinationName(fallback[1]) : "";
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
  const normalized = String(value || "").replace(",", ".");
  if (/^\d{1,3}\.\d{3}$/.test(normalized)) return normalized.replace(".", "");
  return normalized;
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
  const value = unit.toLowerCase();
  if (["st", "si", "s1", "5t", "stk", "stück"].includes(value)) return "Stk";
  if (["pck", "pak"].includes(value)) return "Pck";
  if (value === "ve") return "VE";
  return unit;
}

function isUnitToken(value) {
  return /^(?:ST|SI|S1|5T|STK|STÃ¼CK|PCK|PAK|VE|KG|G|M|L|PAL)$/i.test(String(value || ""));
}

function findCustomerFromHeader(lines) {
  const stopIndex = lines.findIndex((line) => /lagerauf/i.test(line));
  const headerLines = (stopIndex === -1 ? lines : lines.slice(0, stopIndex))
    .map((line) => line.trim())
    .filter((line) => line && !/^(seite|datum|druck|pdf)/i.test(line));
  return headerLines[0] || "";
}

function cleanCustomerName(value) {
  return String(value || "")
    .replace(/\s*datum\s*:.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
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
    binWarning: "",
    binWarningValue: "",
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
  const barcode = String(value || "").trim();
  if (!barcode) return `<span class="loading-slip-empty">Kein Barcode</span>`;

  const patterns = [
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
  const codes = [104];
  for (const char of barcode) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) continue;
    codes.push(code - 32);
  }
  if (codes.length === 1) return `<span class="loading-slip-empty">Barcode ungueltig</span>`;

  const checksum = codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103;
  codes.push(checksum, 106);

  let x = 10;
  let bars = "";
  codes.forEach((code) => {
    const pattern = patterns[code];
    if (!pattern) return;
    [...pattern].forEach((widthText, index) => {
      const width = Number(widthText);
      if (index % 2 === 0) bars += `<rect x="${x}" y="0" width="${width}" height="44"></rect>`;
      x += width;
    });
  });

  const width = x + 10;
  return `<svg class="code128" viewBox="0 0 ${width} 58" role="img" aria-label="Barcode ${escapeHtmlAttribute(barcode)}">
    <g fill="#111">${bars}</g>
    <text x="${width / 2}" y="56" text-anchor="middle">${escapeSvgText(barcode)}</text>
  </svg>`;
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

function setHandlingUnitEditMode(input, canEdit) {
  input.readOnly = !canEdit;
  input.classList.toggle("is-editable-hu", canEdit);

  if (canEdit) {
    input.removeAttribute("readonly");
    input.placeholder = "HU eintragen";
    return;
  }

  input.setAttribute("readonly", "");
  input.placeholder = "Handling Unit";
}

function render() {
  renderModeControls();
  renderWarehouseHint();
  renderReleaseButton();
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
    const item = elements.lineTemplate.content.firstElementChild.cloneNode(true);
    item.dataset.id = line.id;
    item.classList.toggle("is-done", line.picked);
    item.classList.toggle("is-collapsed", state.collapseDone && line.picked);
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
    const isMissingHandlingUnit = !String(line.fromHandlingUnit || "").trim();
    const canEditHandlingUnit = isStorageLine || line.fromHandlingUnitEditable === true || isMissingHandlingUnit;
    map.fromHandlingUnit.value = line.fromHandlingUnit || "";
    map.positionNote.value = line.positionNote || "";
    map.fromBin.value = line.fromBin || "";
    map.product.value = line.product || "";
    map.description.value = line.description;
    map.targetQty.value = line.targetQty;
    map.actualQty.value = line.actualQty;
    map.unit.value = line.unit;
    map.product.readOnly = !isManualStorageLine;
    map.description.readOnly = !isManualStorageLine;
    setHandlingUnitEditMode(map.fromHandlingUnit, canEditHandlingUnit);
    const canEditBin = isStorageLine || state.awaitingRelease || Boolean(binWarningText);
    map.fromBin.readOnly = !canEditBin;
    map.fromBin.placeholder = isStorageLine ? "Stellplatz" : "Lagerplatz";
    map.fromBin.classList.toggle("is-warning", Boolean(binWarningText));
    if (binWarningText) map.fromBin.title = binWarningText;
    map.fromHandlingUnit.placeholder = isStorageLine ? "HU eintragen" : map.fromHandlingUnit.placeholder;
    map.targetQty.readOnly = !isManualStorageLine;
    map.actualQty.readOnly = isStorageLine && !isManualStorageLine;
    map.actualQty.classList.toggle("readonly-input", isStorageLine && !isManualStorageLine);
    map.unit.readOnly = !isManualStorageLine;

    const setPicked = (picked) => {
      if (picked && storageLineCompletionErrors(line).length) {
        setServerStatus(storageLineErrorMessage(line), "error");
        return;
      }
      map.picked.setAttribute("aria-pressed", picked ? "true" : "false");
      updateLine(line.id, { picked }, false);
      item.classList.toggle("is-done", picked);
      // Do not collapse the row immediately on touch; Safari can stall when the tapped row disappears.
      item.classList.remove("is-collapsed");
      updateCollapseButtonText();
    };

    map.picked.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setPicked(map.picked.getAttribute("aria-pressed") !== "true");
    });
    map.fromHandlingUnit.addEventListener("input", () => {
      map.fromHandlingUnit.value = isStorageLine
        ? map.fromHandlingUnit.value.toUpperCase().replace(/[^A-Z0-9,-]/g, "")
        : map.fromHandlingUnit.value.replace(/[^0-9,]/g, "");
      updateLine(line.id, { fromHandlingUnit: map.fromHandlingUnit.value, fromHandlingUnitEditable: canEditHandlingUnit }, false);
    });
    map.positionNote.addEventListener("input", () => updateLine(line.id, { positionNote: map.positionNote.value }, false));
    map.fromBin.addEventListener("input", () => {
      if (canEditBin) map.fromBin.value = map.fromBin.value.toUpperCase();
      const patch = { fromBin: map.fromBin.value };
      const clearWarning = shouldClearBinWarning(line, map.fromBin.value);
      if (clearWarning) {
        patch.binWarning = "";
        patch.binWarningValue = "";
      }
      updateLine(line.id, patch, clearWarning);
    });
    map.product.addEventListener("input", () => updateLine(line.id, { product: map.product.value }, false));
    map.description.addEventListener("input", () => updateLine(line.id, { description: map.description.value }, false));
    map.targetQty.addEventListener("input", () => {
      const patch = { targetQty: map.targetQty.value };
      if (isManualStorageLine && !String(map.actualQty.value || "").trim()) {
        map.actualQty.value = map.targetQty.value;
        patch.actualQty = map.targetQty.value;
      }
      updateLine(line.id, patch, false);
    });
    map.actualQty.addEventListener("input", () => {
      const patch = { actualQty: map.actualQty.value };
      if (Number(line.stockQty || 0) > 0) {
        const quantityRemark = storageQuantityRemarkForLine({ ...line, actualQty: map.actualQty.value }, Number(line.stockQty || 0));
        const nextNote = updateStorageQuantityRemark(map.positionNote.value, quantityRemark);
        if (nextNote !== String(map.positionNote.value || "").trim()) {
          map.positionNote.value = nextNote;
          patch.positionNote = nextNote;
        }
      }
      updateLine(line.id, patch, false);
    });
    map.unit.addEventListener("input", () => updateLine(line.id, { unit: map.unit.value }, false));

    if (binWarningText) renderBinWarning(item, binWarningText);
    if (isManualStorageLine) renderManualStorageDeleteButton(item, line);

    elements.pickList.appendChild(item);
  });

  renderStorageLineActions();
  updateCounts();
  updateCollapseButtonText();
}

function renderStorageLineActions() {
  if (!elements.storageLineActions || !elements.addStorageLineButton) return;
  const isStorage = currentMode === "storage" || state.orderType === "storage";
  elements.storageLineActions.hidden = !isStorage;
  elements.addStorageLineButton.disabled = !isStorage;
}

function renderBinWarning(item, message) {
  const body = item.querySelector(".line-body");
  if (!body) return;
  const warning = document.createElement("p");
  warning.className = "bin-warning";
  warning.textContent = message;
  body.appendChild(warning);
}

async function addManualStorageLine() {
  if (!requireCurrentUser()) return;

  currentMode = "storage";
  localStorage.setItem(MODE_KEY, currentMode);
  state.orderType = "storage";
  state.orderDate = state.orderDate || new Date().toISOString().slice(0, 10);
  state.orderTime = state.orderTime || currentTimeValue();
  state.orderNumber = state.orderNumber || await nextStorageOrderNumber();
  state.customerName = "SSI";
  state.createdBy = state.createdBy || currentUser.name;
  state.awaitingRelease = state.awaitingRelease || !state.id;
  state.lines.push(createLine({
    orderType: "storage",
    manual: true,
    warehouseOrder: nextManualStoragePosition(),
    fromHandlingUnitEditable: true,
    unit: "Stk"
  }));
  topControlsCollapsed = false;
  markOrderTouched();
  saveAndRender();
  setServerStatus("Manuelle Einlagerposition hinzugefuegt.", "ok");
}

function nextManualStoragePosition() {
  const existing = state.lines
    .map((line) => String(line.warehouseOrder || ""))
    .filter((value) => /^M\d+$/i.test(value))
    .map((value) => Number(value.replace(/\D/g, "")))
    .filter((value) => Number.isInteger(value) && value > 0);
  return `M${(existing.length ? Math.max(...existing) : 0) + 1}`;
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
  return [
    line.product,
    line.description,
    line.targetQty,
    line.actualQty,
    line.fromHandlingUnit,
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
  if (!String(line.product || "").trim()) errors.push("Artikelnummer fehlt");
  if (!String(line.description || "").trim()) errors.push("Artikelbezeichnung fehlt");
  if (!String(line.fromBin || "").trim()) errors.push("Stellplatz fehlt");
  if (!readPositiveQuantity(line.actualQty || line.targetQty)) errors.push("Menge fehlt");
  return errors;
}

function readPositiveQuantity(value) {
  const number = Number(String(value || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) && number > 0;
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
    targetQty: line.targetQty,
    actualQty: line.targetQty,
    unit: line.unit || "Stk",
    palletInfo: line.palletInfo,
    positionNote: line.palletInfo || "",
    picked: false
  }));

  return {
    orderNumber: "",
    customerName: "SSI",
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
  elements.fileDropTitle.textContent = isStorage ? "Lieferschein-PDF importieren" : "PDF importieren";
  elements.fileDrop.querySelector(".file-drop-copy").textContent = isStorage
    ? "PDF vom Einlager-Lieferschein importieren, Positionen pruefen und HU/Stellplatz eintragen."
    : "Auftrag auswählen, Positionen prüfen und digital abhaken.";
  elements.pickingModeButton.classList.toggle("is-active", !isStorage);
  elements.storageModeButton.classList.toggle("is-active", isStorage);
  elements.pickHeader.querySelector(".pick-column-grid").innerHTML = isStorage
    ? "<span>Material</span><span>Stellplatz</span><span>Artikelbezeichnung</span><span>Soll</span><span>Ist</span><span>Einheit</span>"
    : "<span>Produkt</span><span>Lagerplatz</span><span>Produktbeschreibung</span><span>Soll</span><span>Ist</span><span>Einheit</span>";
  elements.clearDoneButton.textContent = isStorage ? "Erledigte einklappen" : elements.clearDoneButton.textContent;
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
  if (elements.discardDraftButton) {
    elements.discardDraftButton.hidden = !isDraft;
    elements.discardDraftButton.disabled = !isDraft;
  }
}

function renderDeleteOrderButton() {
  if (!elements.deleteOrderButton) return;
  const hasSavedOrder = Boolean(state.id);
  const canDelete = ["buero", "lager", "tablet"].includes(currentUser.group);
  const isStorage = (state.orderType || currentMode) === "storage";
  elements.deleteOrderButton.textContent = isStorage ? "Einlager-Auftrag löschen" : "Auftrag löschen";
  elements.deleteOrderButton.hidden = !hasSavedOrder || !canDelete;
  elements.deleteOrderButton.disabled = !hasSavedOrder || !serverOnline || !canDelete || Boolean(state.exportedAt);
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
  elements.saveOrderButton.textContent = state.awaitingRelease ? "Entwurf lokal speichern" : "Auftrag speichern";
}

function setTopControlsCollapsed(collapsed) {
  topControlsCollapsed = collapsed;
  render();
}

function updateCollapseButtonText() {
  if (currentMode === "storage" || state.orderType === "storage") {
    elements.clearDoneButton.textContent = state.collapseDone ? "Details bei erledigten anzeigen" : "Details bei erledigten ausblenden";
    return;
  }
  elements.clearDoneButton.textContent = state.collapseDone ? "HU bei erledigten anzeigen" : "HU bei erledigten ausblenden";
}

function getPickingLines(importOrder) {
  if (state.orderType === "storage") return [...state.lines];
  return [...state.lines].sort((left, right) => compareStorageBins(left, right, importOrder));
}

function compareStorageBins(left, right, importOrder) {
  const leftLoadingSlip = left.lineType === "loading-slip";
  const rightLoadingSlip = right.lineType === "loading-slip";
  if (leftLoadingSlip && rightLoadingSlip) return 0;
  if (leftLoadingSlip && !rightLoadingSlip) return 1;
  if (!leftLoadingSlip && rightLoadingSlip) return -1;

  const leftBin = String(left.fromBin || "").trim();
  const rightBin = String(right.fromBin || "").trim();

  if (!leftBin && rightBin) return 1;
  if (leftBin && !rightBin) return -1;

  const byBin = leftBin.localeCompare(rightBin, "de", {
    numeric: true,
    sensitivity: "base"
  });
  if (byBin !== 0) return byBin;

  return (importOrder.get(left.id) ?? 0) - (importOrder.get(right.id) ?? 0);
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
  map.targetQty.value = line.targetQty || "";
  map.targetQty.readOnly = true;
  map.actualQty.closest("label").remove();
  map.unit.closest("label").remove();
  map.fromHandlingUnit.closest("label").remove();
  map.positionNote.value = line.positionNote || "";
  map.positionNote.addEventListener("input", () => updateLine(line.id, { positionNote: map.positionNote.value }, false));

  map.picked.setAttribute("aria-pressed", line.picked ? "true" : "false");
  map.picked.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const picked = map.picked.getAttribute("aria-pressed") !== "true";
    map.picked.setAttribute("aria-pressed", picked ? "true" : "false");
    updateLine(line.id, { picked }, false);
    item.classList.toggle("is-done", picked);
    item.classList.remove("is-collapsed");
    updateCollapseButtonText();
  });
}

function syncStateFromFields() {
  ["orderNumber", "customerName", "orderDate", "orderTime", "euroPallets", "storageSpaces", "orderNote"].forEach((id) => {
    if (elements[id]) state[id] = elements[id].value;
  });
}

function updateLine(id, patch, rerender = true) {
  const line = state.lines.find((entry) => entry.id === id);
  if (!line) return;
  Object.assign(line, patch);
  markOrderTouched();
  saveState();
  updateCounts();
  if (rerender) render();
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
  const changed = state.lines.filter((line) => String(line.actualQty).trim() !== String(line.targetQty).trim()).length;
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

    // Dedup: nur die neueste Mutation je URL behalten
    const latestByUrl = new Map();
    pending.forEach((item) => {
      const existing = latestByUrl.get(item.url);
      if (!existing || item.timestamp > existing.timestamp) latestByUrl.set(item.url, item);
    });

    let synced = 0;
    for (const [, item] of latestByUrl) {
      try {
        await apiJson(item.url, { method: item.method, body: item.body });
        synced++;
      } catch {
        // Einzelner Fehler blockiert nicht den Rest
      }
    }

    await OfflineStore.clearQueue();
    if (synced > 0) {
      setServerStatus(`${synced} Offline-Änderung${synced !== 1 ? "en" : ""} synchronisiert.`, "ok");
    }
  } catch {
    // Queue-Flush ist nicht kritisch
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
  if (!elements.connectionBadge || !elements.connectionText) return;
  elements.connectionBadge.classList.toggle("is-online", isOnline === true);
  elements.connectionBadge.classList.toggle("is-offline", isOnline === false);
  elements.connectionBadge.classList.toggle("is-checking", isOnline === null);
  elements.connectionText.textContent = isOnline === true ? "Online" : isOnline === false ? "Offline" : "Prüfe Verbindung";
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
        await OfflineStore.enqueue(method, endpoint, JSON.stringify({ order: payload, userName: currentUser.name }));
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

function discardCurrentDraft() {
  if (!state.awaitingRelease && !state.lines.length) {
    resetCurrentOrderView();
    return;
  }

  if (!confirm("Importierten Entwurf verwerfen und Seite leeren?")) return;
  resetCurrentOrderView();
  setServerStatus(`Entwurf verworfen. Die ${modeLabel(currentMode)}-Seite wurde geleert.`, "ok");
}

async function deleteCurrentOrder() {
  if (!serverOnline) {
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
  if (!confirm(`${typeLabel} "${label}" wirklich aus der Liste löschen?`)) return;

  window.clearTimeout(saveTimer);
  saveTimer = null;

  try {
    await apiJson(`/api/orders/${encodeURIComponent(state.id)}`, { method: "DELETE" });
    knownOrderIds.delete(state.id);
    localStorage.setItem(KNOWN_ORDERS_KEY, JSON.stringify([...knownOrderIds]));
    resetCurrentOrderView();
    setServerStatus(`${typeLabel} gelöscht.`, "ok");
    await loadOrderList();
  } catch (error) {
    setServerStatus(`Löschen fehlgeschlagen: ${error.message}`, "error");
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

  return {
    id: state.id,
    orderNumber: state.orderNumber,
    customerName: state.customerName,
    orderDate: state.orderDate,
    orderTime: state.orderTime,
    euroPallets: state.euroPallets,
    storageSpaces: state.storageSpaces,
    orderNote: state.orderNote,
    rawText: state.rawText,
    collapseDone: state.collapseDone,
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
    orderType: state.orderType || currentMode,
    orderWarehouse: normalizeOptionalWarehouse(state.orderWarehouse) || currentWarehouse(),
    lines: state.lines
  };
}

function saveStateWithoutServer() {
  writeLocalState(STORAGE_KEY, state);
  persistCurrentOrderCache();
}

async function apiJson(url, options = {}) {
  const userGroup = localStorage.getItem(USER_GROUP_KEY) || "";
  const warehouse = currentWarehouse();
  const { headers: extraHeaders, ...rest } = options;
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      "Content-Type": "application/json",
      "X-User-Group": userGroup,
      "X-Warehouse": warehouse,
      ...extraHeaders,
    },
    ...rest,
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "Serverfehler");
  return data;
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

  const loadingSlipLines = parseOrderText(state.rawText).lines.filter((line) => line.lineType === "loading-slip" && line.barcode);
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
      line.positionNote,
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
  return String(line?.actualQty || "").trim() !== String(line?.targetQty || "").trim();
}

async function exportPdf() {
  if (!requireCurrentUser()) return;

  if (!serverOnline) {
    showExportMessage("PDF kann nur am Server ausgegeben werden. Bitte Verbindung zum Laptop-Server prüfen.");
    return;
  }

  if ((state.orderType || currentMode) === "storage") {
    pruneEmptyManualStorageLines();
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
    resetCurrentOrderView();
    showExportMessage(
      exportedPath
        ? `PDF gespeichert: ${exportedPath}${copyPath ? ` | Kopie: ${copyPath}` : ""}${stockText ? ` | ${stockText}` : ""}`
        : `${exportedFile} gespeichert.`
    );
    showStockIssueErrors(result.stockIssue);
    await loadOrderList();
  } catch (error) {
    showExportMessage(`Server-PDF fehlgeschlagen: ${error.message}`);
  }
}

function stockIssueSummary(stockIssue, stockWarehouse = "") {
  if (!stockIssue) return "";
  const booked = Number(stockIssue.booked || 0);
  const errors = Array.isArray(stockIssue.errors) ? stockIssue.errors.length : 0;
  if (!booked && !errors) return "Keine Bestandsbuchung";
  const warehouse = normalizeOptionalWarehouse(stockWarehouse);
  return `${booked} Bestandsbuchung(en)${warehouse ? ` aus ${warehouse}` : ""}${errors ? `, ${errors} Fehler` : ""}`;
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
