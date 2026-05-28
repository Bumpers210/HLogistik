const STORAGE_KEY = "kommissionier-app-state-v1";
const USER_KEY = "kommissionier-app-user-v1";
const API_BASE = "";
const OCR_LANGUAGE = "deu+eng";
const OCR_RENDER_SCALE = 2.5;
const OCR_ROTATIONS = [0, 90, 270];

const state = {
  id: "",
  orderNumber: "",
  customerName: "",
  orderDate: new Date().toISOString().slice(0, 10),
  euroPallets: "",
  storageSpaces: "",
  orderNote: "",
  rawText: "",
  collapseDone: true,
  createdBy: "",
  lastEditedBy: "",
  activeUser: "",
  completedBy: "",
  completedAt: "",
  lines: []
};

const elements = {};
const currentUser = { name: "" };
let activeDownloadUrl = "";
let saveTimer = null;
let serverOnline = false;
let topControlsCollapsed = false;

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  loadCurrentUser();
  clearCurrentOrder();
  bindEvents();
  configurePdfJs();
  updateCurrentUserUi();
  render();
  initializeServer();
  showLoginIfNeeded();
});

function bindElements() {
  [
    "pdfInput",
    "orderNumber",
    "customerName",
    "orderDate",
    "euroPallets",
    "storageSpaces",
    "orderNote",
    "importStatus",
    "topControls",
    "topToggleButton",
    "newOrderButton",
    "printButton",
    "exportButton",
    "pdfExportButton",
    "exportStatus",
    "pdfPreview",
    "printReport",
    "orderSelect",
    "saveOrderButton",
    "refreshOrdersButton",
    "serverStatus",
    "clearDoneButton",
    "pickList",
    "pickHeader",
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
    "loginSubmitButton"
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.pdfInput.addEventListener("change", handlePdfUpload);
  elements.topToggleButton.addEventListener("click", () => {
    setTopControlsCollapsed(!topControlsCollapsed);
  });
  elements.newOrderButton.addEventListener("click", resetOrder);
  elements.printButton.addEventListener("click", () => window.print());
  elements.exportButton.addEventListener("click", exportCsv);
  elements.pdfExportButton.addEventListener("click", exportPdf);
  elements.saveOrderButton.addEventListener("click", saveOrderNow);
  elements.refreshOrdersButton.addEventListener("click", loadOrderList);
  elements.orderSelect.addEventListener("change", () => loadOrder(elements.orderSelect.value));
  elements.switchUserButton.addEventListener("click", () => showLogin(true));
  elements.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setCurrentUser(elements.loginNameInput.value);
  });
  window.addEventListener("afterprint", cleanupPrintReport);
  elements.clearDoneButton.addEventListener("click", () => {
    state.collapseDone = !state.collapseDone;
    updateCollapseButtonText();
    saveAndRender();
  });

  ["orderNumber", "customerName", "orderDate", "euroPallets", "storageSpaces", "orderNote"].forEach((id) => {
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

function loadCurrentUser() {
  currentUser.name = localStorage.getItem(USER_KEY) || "";
}

function setCurrentUser(value) {
  const name = String(value || "").trim();
  if (!name) return;

  currentUser.name = name;
  localStorage.setItem(USER_KEY, name);
  elements.loginOverlay.hidden = true;
  updateCurrentUserUi();

  if (state.lines.length || state.id) {
    markOrderTouched();
    saveAndRender();
  }
}

function showLogin(force = false) {
  elements.loginNameInput.value = force ? currentUser.name : "";
  elements.loginOverlay.hidden = false;
  elements.loginNameInput.focus();
  elements.loginNameInput.select();
}

function showLoginIfNeeded() {
  if (!currentUser.name) showLogin(false);
}

function requireCurrentUser() {
  if (currentUser.name) return true;
  showLogin(false);
  setServerStatus("Bitte zuerst mit Namen anmelden.", "error");
  return false;
}

function updateCurrentUserUi() {
  if (!elements.currentUserName) return;
  elements.currentUserName.textContent = currentUser.name || "Nicht angemeldet";
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
    setImportStatus(`Lese ${file.name} ...`);
    data = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    const fullText = await readPdfText(pdf);
    const imported = await chooseBestImportText(pdf, fullText);
    const result = importText(imported.text, file.name, imported.parsed);

    if (result.lines > 0) {
      const suffix = imported.source === "ocr" ? " per OCR" : "";
      setImportStatus(`${result.lines} Positionen${suffix} importiert.`, "ok");
    } else if (imported.text.trim()) {
      setImportStatus("Text gelesen, aber keine Tabellenzeilen erkannt.", "error");
    } else {
      setImportStatus("Keine lesbaren Inhalte gefunden.", "error");
    }
  } catch (error) {
    console.error(error);
    const fallbackText = data ? extractTextFromSimplePdf(data) : "";
    if (fallbackText.trim()) {
      const result = importText(fallbackText, file.name);
      setImportStatus(`Fallback genutzt: ${result.lines} Positionen importiert.`, result.lines ? "ok" : "error");
    } else {
      setImportStatus(error.message || "PDF konnte nicht ausgelesen werden.", "error");
    }
  } finally {
    event.target.value = "";
  }
}

async function readPdfText(pdf) {
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(rebuildPageRows(content.items));
  }

  return pages.join("\n");
}

async function chooseBestImportText(pdf, fullText) {
  let parsed = parseOrderText(fullText);
  if (parsed.lines.length) return { text: fullText, parsed, source: "pdf-text" };

  const reason = fullText.trim()
    ? "PDF-Text erkannt, aber keine Tabellenzeilen. Starte OCR ..."
    : "Scan erkannt. Starte OCR ...";
  setImportStatus(reason);

  const ocrText = await readPdfWithOcr(pdf);
  if (!ocrText.trim()) return { text: fullText, parsed, source: "pdf-text" };

  const combinedText = fullText.trim() ? `${fullText}\n${ocrText}` : ocrText;
  parsed = parseOrderText(combinedText);
  return { text: combinedText, parsed, source: "ocr" };
}

async function readPdfWithOcr(pdf) {
  if (!window.Tesseract?.createWorker) {
    throw new Error("OCR-Modul konnte nicht geladen werden. Internetverbindung pruefen und Seite neu laden.");
  }

  const worker = await createOcrWorker(pdf.numPages * OCR_ROTATIONS.length);
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setImportStatus(`OCR Seite ${pageNumber}/${pdf.numPages} vorbereiten ...`);
      const baseCanvas = await renderPdfPageToCanvas(pdf, pageNumber);
      const candidates = [];

      for (const rotation of OCR_ROTATIONS) {
        const canvas = rotation ? rotateCanvas(baseCanvas, rotation) : baseCanvas;
        const rotationLabel = rotation ? `, Drehung ${rotation} Grad` : "";
        setImportStatus(`OCR Seite ${pageNumber}/${pdf.numPages}${rotationLabel} ...`);
        const result = await worker.recognize(canvas);
        const text = result.data.text || "";
        const parsed = parseOrderText(text);
        candidates.push({ text, parsed, score: scoreOcrCandidate(text, parsed) });

        if (canvas !== baseCanvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }

      const best = candidates.sort((a, b) => b.score - a.score)[0] || { text: "" };
      pages.push(best.text);
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
        setImportStatus(`OCR ${currentStep}/${totalSteps}: ${percent}%`);
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

async function renderPdfPageToCanvas(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
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
  const warehouseHits = (text.match(/\b\d{6,}\b/g) || []).length;
  const handlingUnitHits = (text.match(/\b\d{10,}\b/g) || []).length;
  const binHits = (text.match(/\b\d{3}-[A-Z0-9]+-[A-Z0-9]+\b/gi) || []).length;
  return parsed.lines.length * 1000 + warehouseHits * 20 + handlingUnitHits * 10 + binHits * 10 + Math.min(text.length, 500);
}

function importText(text, fileName = "", parsed = parseOrderText(text)) {
  clearCurrentOrder();
  state.rawText = text;
  state.createdBy = currentUser.name;
  state.lastEditedBy = currentUser.name;
  state.activeUser = currentUser.name;

  if (parsed.orderNumber) state.orderNumber = parsed.orderNumber;
  if (parsed.customerName && !state.customerName) state.customerName = parsed.customerName;

  state.lines = parsed.lines.length ? parsed.lines : [createLine({ description: text.slice(0, 140) })];
  topControlsCollapsed = state.lines.length > 0;
  saveAndRender();
  return { lines: parsed.lines.length };
}

function setImportStatus(message, type = "") {
  if (!elements.importStatus) return;
  elements.importStatus.textContent = message;
  elements.importStatus.classList.toggle("is-ok", type === "ok");
  elements.importStatus.classList.toggle("is-error", type === "error");
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

  const orderNumber = findFirst(text, [
    /(?:^|\n)\s*(?:auftragsnr\.?|auftragsnummer|belegnr\.?)\s*[:#-]?\s*([A-Z0-9-]{4,})/i,
    /(?:^|\n)\s*(?:auftrag|kommission|lieferschein)\s*[:#-]\s*([A-Z0-9-]{4,})/i
  ]);
  const explicitCustomerName = findFirst(text, [
    /(?:kunde|lieferadresse|empfÃ¤nger)\s*[:#-]?\s*([^\n\t]{3,80})/i
  ]);

  const tableRows = collectWarehouseRows(cleanedLines);
  const destinationCustomerName = destinationToCustomerName(tableRows);
  const customerName = destinationCustomerName || cleanCustomerName(explicitCustomerName || findCustomerFromHeader(cleanedLines));

  if (tableRows.length) {
    return {
      orderNumber: "",
      customerName: customerName || "",
      lines: tableRows.map((line) => createLine({
        ...line,
        actualQty: line.targetQty,
        fromHandlingUnitEditable: !String(line.fromHandlingUnit || "").trim()
      }))
    };
  }

  const candidates = [];
  let current = null;

  cleanedLines.forEach((line) => {
    const starter = line.match(/^(\d{1,4})(?:[.)\s-]+)(.+)$/);
    const looksLikeArticle = /\b[A-Z0-9][A-Z0-9/-]{3,}\b/.test(line);
    const hasQuantity = /\b\d+(?:[,.]\d+)?\s*(?:stk|st|stÃ¼ck|pck|pak|ve|karton|kg|g|m|l|rolle|pal)\b/i.test(line);
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
    lines: candidates.map((line, index) => createLine({
      ...line,
      warehouseOrder: line.position || String(index + 1),
      actualQty: line.targetQty
    }))
  };
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

  while (isOcrQuantityMarker(tokens[cursor]) && canReadQuantityFrom(tokens[cursor + 1])) cursor += 1;

  const combinedQuantity = parseQuantityWithUnitToken(tokens[cursor] || "");
  const quantity = combinedQuantity || parseQuantityToken(tokens[cursor] || "");
  const targetQty = quantity ? quantity.value : "";
  if (quantity) cursor += 1;
  const unit = /^[A-Za-zÃ„Ã–ÃœÃ¤Ã¶Ã¼]{1,5}$/.test(tokens[cursor] || "") ? normalizeUnit(tokens[cursor++]) : "Stk";
  const remaining = tokens.slice(cursor);

  if (!product || !targetQty || remaining.length === 0) return parseWarehouseLineLoose(normalizedLine);
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

function destinationToCustomerName(lines) {
  const destinations = lines
    .map((line) => line.toBin)
    .map(normalizeDestinationName)
    .filter(Boolean);

  return destinations.find((value) => value === "9021-0OUT") || destinations[0] || "";
}

function normalizeDestinationName(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^9021-00UT$/, "9021-0OUT");
}

function collectWarehouseRows(lines) {
  const rows = [];
  const seen = new Set();
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

      if (parsed && !seen.has(parsed.warehouseOrder) && (!pendingHeaders.length || continuations.length <= 1)) {
        rows.push(parsed);
        seen.add(parsed.warehouseOrder);
        return;
      }

      if (header && !seen.has(header.warehouseOrder)) pendingHeaders.push(header);

      continuations.forEach((continuation) => {
        if (pendingHeaders.length) {
          const line = { ...pendingHeaders.shift(), ...continuation };
          if (!seen.has(line.warehouseOrder)) {
            rows.push(line);
            seen.add(line.warehouseOrder);
          }
        } else {
          pendingContinuations.push(continuation);
        }
      });

      while (pendingHeaders.length && pendingContinuations.length) {
        const line = { ...pendingHeaders.shift(), ...pendingContinuations.shift() };
        if (!seen.has(line.warehouseOrder)) {
          rows.push(line);
          seen.add(line.warehouseOrder);
        }
      }
    });
  });

  return rows;
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
    .replace(/[(){}\[\]]/g, " ")
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

  if (current.length >= 8 && next && `${current}${next}`.length <= 20) {
    return { value: `${current}${next}`, next: cursor + 2 };
  }
  if (current.length >= 10) return { value: current, next: cursor + 1 };

  return { value: "", next: cursor };
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
  const compact = String(value || "").replace(/\s+/g, "");
  if (!compact) return null;

  if (/^\d+[xX]\d+(?:[,.]\d+)?$/.test(compact)) {
    const [multiplier, quantity] = compact.split(/[xX]/);
    return { value: `${multiplier}x${normalizeQuantity(quantity)}` };
  }

  if (/^[\d.,]+$/.test(compact)) return { value: compact.replace(",", ".") };
  return null;
}

function parseQuantityWithUnitToken(value) {
  const compact = String(value || "").replace(/[_|]/g, "").trim();
  const match = compact.match(/^(\d+(?:[,.]\d+)?)[/ ]?([A-Za-zÃƒâ€žÃƒâ€“ÃƒÅ“ÃƒÂ¤ÃƒÂ¶ÃƒÂ¼]{1,5})$/);
  if (!match) return null;

  return {
    value: match[1].replace(",", "."),
    unit: normalizeUnit(match[2])
  };
}

function canReadQuantityFrom(value) {
  return Boolean(parseQuantityWithUnitToken(value) || parseQuantityToken(value));
}

function isOcrQuantityMarker(value) {
  return /^(?:x|v|j|\/|\\|7|71)$/i.test(String(value || ""));
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
  const matches = [...source.matchAll(/9\d{3,4}-[A-Z0-9]+/gi)];
  const match = matches.at(-1);
  if (match) return normalizeDestinationName(match[0]);
  const fallback = source.match(/(\d{3,5}-[A-Z0-9]+(?:[ -][A-Z0-9]+)*)\s*$/i);
  return fallback ? normalizeDestinationName(fallback[1]) : "";
}

function cleanProductDescription(value, toBin = "") {
  let description = String(value || "");
  if (toBin) {
    description = description.replace(new RegExp(`[A-Z]?${escapeRegExp(toBin)}[\\s\\S]*$`, "i"), "");
  }
  description = description.replace(/[A-Z]?9\d{3,4}-[A-Z0-9]+[\s\S]*$/i, "");

  return description
    .replace(/^\s*[_|.-]+\s*/, "")
    .replace(/\(\s*-/g, "-")
    .replace(/[(){}\[\]|_]+/g, " ")
    .replace(/^\s*(?:STK?|SI|S1|5T|KAR|PCK|PAK|VE)\b\s*/i, "")
    .replace(/^\s*(?:[\\/]+|[IVLJX17][\\/]+|[IVLJX])\s+(?=\d|[A-ZÃƒâ€žÃƒâ€“ÃƒÅ“])/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeQuantity(value) {
  const normalized = String(value || "").replace(",", ".");
  if (/^\d{1,3}\.\d{3}$/.test(normalized)) return normalized.replace(".", "");
  return normalized;
}

function parsePositionLine(position, content) {
  const quantityMatch = content.match(/(\d+(?:[,.]\d+)?)\s*(stk|st|stÃ¼ck|pck|pak|ve|karton|kg|g|m|l|rolle|pal)\b/i);
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
  if (["st", "si", "s1", "5t", "stk", "stÃ¼ck"].includes(value)) return "Stk";
  if (["pck", "pak"].includes(value)) return "Pck";
  if (value === "ve") return "VE";
  return unit;
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
  syncFields();
  renderTopControls();
  elements.pickList.innerHTML = "";
  elements.emptyState.hidden = state.lines.length > 0;
  elements.pickHeader.hidden = state.lines.length === 0;

  const importOrder = new Map(state.lines.map((line, index) => [line.id, index]));

  // The picking view is sorted by storage location. Exports keep state.lines in import order.
  getPickingLines(importOrder).forEach((line) => {
    const item = elements.lineTemplate.content.firstElementChild.cloneNode(true);
    item.dataset.id = line.id;
    item.classList.toggle("is-done", line.picked);
    item.classList.toggle("is-collapsed", state.collapseDone && line.picked);

    const map = {
      picked: item.querySelector(".picked-input"),
      fromHandlingUnit: item.querySelector(".from-hu-input"),
      positionNote: item.querySelector(".position-note-input"),
      fromBin: item.querySelector(".from-bin-input"),
      product: item.querySelector(".product-input"),
      description: item.querySelector(".description-input"),
      targetQty: item.querySelector(".target-qty-input"),
      actualQty: item.querySelector(".actual-qty-input"),
      unit: item.querySelector(".unit-input")
    };

    map.picked.checked = line.picked;
    const isMissingHandlingUnit = !String(line.fromHandlingUnit || "").trim();
    const canEditHandlingUnit = line.fromHandlingUnitEditable === true || isMissingHandlingUnit;
    map.fromHandlingUnit.value = line.fromHandlingUnit || "";
    map.positionNote.value = line.positionNote || "";
    map.fromBin.value = line.fromBin || "";
    map.product.value = line.product || "";
    map.description.value = line.description;
    map.targetQty.value = line.targetQty;
    map.actualQty.value = line.actualQty;
    map.unit.value = line.unit;
    map.product.readOnly = true;
    map.description.readOnly = true;
    setHandlingUnitEditMode(map.fromHandlingUnit, canEditHandlingUnit);
    map.fromBin.readOnly = true;
    map.targetQty.readOnly = true;
    map.unit.readOnly = true;

    map.picked.addEventListener("change", () => updateLine(line.id, { picked: map.picked.checked }));
    map.fromHandlingUnit.addEventListener("input", () => {
      map.fromHandlingUnit.value = map.fromHandlingUnit.value.replace(/[^0-9,]/g, "");
      updateLine(line.id, { fromHandlingUnit: map.fromHandlingUnit.value, fromHandlingUnitEditable: canEditHandlingUnit }, false);
    });
    map.positionNote.addEventListener("input", () => updateLine(line.id, { positionNote: map.positionNote.value }, false));
    map.fromBin.addEventListener("input", () => updateLine(line.id, { fromBin: map.fromBin.value }, false));
    map.product.addEventListener("input", () => updateLine(line.id, { product: map.product.value }, false));
    map.description.addEventListener("input", () => updateLine(line.id, { description: map.description.value }, false));
    map.targetQty.addEventListener("input", () => updateLine(line.id, { targetQty: map.targetQty.value }, false));
    map.actualQty.addEventListener("input", () => updateLine(line.id, { actualQty: map.actualQty.value }, false));
    map.unit.addEventListener("input", () => updateLine(line.id, { unit: map.unit.value }, false));

    elements.pickList.appendChild(item);
  });

  updateCounts();
  updateCollapseButtonText();
}

function renderTopControls() {
  const canCollapse = state.lines.length > 0;
  topControlsCollapsed = canCollapse && topControlsCollapsed;
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

function updateCollapseButtonText() {
  elements.clearDoneButton.textContent = state.collapseDone ? "HU bei erledigten anzeigen" : "HU bei erledigten ausblenden";
}

function getPickingLines(importOrder) {
  return [...state.lines].sort((left, right) => compareStorageBins(left, right, importOrder));
}

function compareStorageBins(left, right, importOrder) {
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
  ["orderNumber", "customerName", "orderDate", "euroPallets", "storageSpaces", "orderNote"].forEach((id) => {
    if (elements[id].value !== state[id]) elements[id].value = state[id] || "";
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
  updateCompletionFields();
}

function updateCompletionFields() {
  const isComplete = state.lines.length > 0 && state.lines.every((line) => line.picked);
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

async function initializeServer() {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    if (!response.ok) throw new Error("Server antwortet nicht");
    const info = await response.json();
    serverOnline = true;
    setServerStatus(`Server aktiv. PDFs: ${info.exportDir}`, "ok");
    await loadOrderList();
  } catch {
    serverOnline = false;
    setServerStatus("Server nicht verbunden. Daten bleiben nur auf diesem Geraet.", "error");
  }
}

async function loadOrderList() {
  if (!serverOnline) return;
  try {
    const orders = await apiJson("/api/orders");
    elements.orderSelect.innerHTML = `<option value="">Kein gespeicherter Auftrag</option>`;
    orders.forEach((order) => {
      const option = document.createElement("option");
      option.value = order.id;
      const worker = order.activeUser || order.lastEditedBy || order.createdBy || "ohne Bearbeiter";
      option.textContent = `${order.orderNumber || order.id} - ${order.customerName || "ohne Kunde"} (${order.picked}/${order.total}) - ${worker}`;
      if (order.id === state.id) option.selected = true;
      elements.orderSelect.appendChild(option);
    });
  } catch (error) {
    setServerStatus(`Auftragsliste konnte nicht geladen werden: ${error.message}`, "error");
  }
}

async function loadOrder(id) {
  if (!id || !serverOnline) return;
  if (!requireCurrentUser()) return;
  try {
    const order = await apiJson(`/api/orders/${encodeURIComponent(id)}`);
    Object.assign(state, order);
    state.activeUser = currentUser.name;
    state.lastEditedBy = currentUser.name;
    state.collapseDone = true;
    topControlsCollapsed = state.lines.length > 0;
    saveStateWithoutServer();
    render();
    setServerStatus("Auftrag geladen.", "ok");
    await saveOrderNow(true);
  } catch (error) {
    setServerStatus(`Auftrag konnte nicht geladen werden: ${error.message}`, "error");
  }
}

function scheduleServerSave() {
  if (!serverOnline || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveOrderNow(true);
  }, 700);
}

async function saveOrderNow(silent = false) {
  if (!requireCurrentUser()) return false;

  if (!serverOnline) {
    if (!silent) setServerStatus("Server nicht verbunden. Auftrag nur lokal gespeichert.", "error");
    return false;
  }

  try {
    const payload = currentOrderPayload();
    const endpoint = state.id ? `/api/orders/${encodeURIComponent(state.id)}` : "/api/orders";
    const method = state.id ? "PUT" : "POST";
    const result = await apiJson(endpoint, { method, body: JSON.stringify({ order: payload }) });
    state.id = result.order.id;
    saveStateWithoutServer();
    if (!silent) setServerStatus("Auftrag gespeichert.", "ok");
    await loadOrderList();
    return true;
  } catch (error) {
    if (!silent) setServerStatus(`Speichern fehlgeschlagen: ${error.message}`, "error");
    return false;
  }
}

function currentOrderPayload() {
  markOrderTouched();

  return {
    id: state.id,
    orderNumber: state.orderNumber,
    customerName: state.customerName,
    orderDate: state.orderDate,
    euroPallets: state.euroPallets,
    storageSpaces: state.storageSpaces,
    orderNote: state.orderNote,
    rawText: state.rawText,
    collapseDone: state.collapseDone,
    createdBy: state.createdBy,
    lastEditedBy: state.lastEditedBy,
    activeUser: state.activeUser,
    completedBy: state.completedBy,
    completedAt: state.completedAt,
    exportedAt: "",
    lines: state.lines
  };
}

function saveStateWithoutServer() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function apiJson(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleServerSave();
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;
  try {
    Object.assign(state, JSON.parse(saved));
    state.id = state.id || "";
  } catch (error) {
    console.warn("Gespeicherte Daten konnten nicht geladen werden.", error);
  }
}

function clearCurrentOrder() {
  Object.assign(state, {
    id: "",
    orderNumber: "",
    customerName: "",
    orderDate: new Date().toISOString().slice(0, 10),
    euroPallets: "",
    storageSpaces: "",
    orderNote: "",
    rawText: "",
    collapseDone: true,
    createdBy: "",
    lastEditedBy: "",
    activeUser: "",
    completedBy: "",
    completedAt: "",
    lines: []
  });
}

function resetOrder() {
  if (!requireCurrentUser()) return;
  const hasData = state.lines.length || state.rawText || state.orderNumber || state.customerName;
  if (hasData && !confirm("Aktuellen Auftrag leeren?")) return;

  clearCurrentOrder();
  topControlsCollapsed = false;
  elements.pdfInput.value = "";
  saveAndRender();
}

function exportCsv() {
  if (!requireCurrentUser()) return;
  markOrderTouched();

  const rows = [
    ["Auftrag", state.orderNumber],
    ["Kunde", state.customerName],
    ["Datum", state.orderDate],
    ["Erstellt von", state.createdBy],
    ["Zuletzt bearbeitet von", state.lastEditedBy],
    ["Abgeschlossen von", state.completedBy],
    ["Europaletten", state.euroPallets],
    ["Stellplaetze", state.storageSpaces],
    ["Notiz", state.orderNote],
    [],
    ["Erledigt", "Lagerauftrag", "Von-Handling-Unit", "Zusatzbemerkung", "Lagerplatz", "Produkt", "Produktbeschreibung", "Soll", "Ist", "Einheit", "Nach-Lagerplatz"]
  ];

  state.lines.forEach((line) => {
    rows.push([
      line.picked ? "ja" : "nein",
      line.warehouseOrder,
      line.fromHandlingUnit,
      line.positionNote,
      line.fromBin,
      line.product,
      line.description,
      line.targetQty,
      line.actualQty,
      line.unit,
      line.toBin
    ]);
  });

  const csv = rows.map((row) => row.map(escapeCsv).join(";")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `kommissionierung-${state.orderNumber || "auftrag"}.csv`, "CSV");
}

async function exportPdf() {
  if (!requireCurrentUser()) return;

  if (!serverOnline) {
    showExportMessage("PDF kann nur am Server ausgegeben werden. Bitte Verbindung zum Laptop-Server pruefen.");
    return;
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
      body: JSON.stringify({ order: currentOrderPayload() })
    });
    showServerPdfLink(result.url, result.file, result.path);
    await loadOrderList();
  } catch (error) {
    showExportMessage(`Server-PDF fehlgeschlagen: ${error.message}`);
  }
}

function showServerPdfLink(url, fileName, fullPath) {
  if (!elements.exportStatus) return;
  elements.exportStatus.hidden = false;
  elements.exportStatus.innerHTML = "";
  const text = document.createTextNode(`PDF gespeichert: ${fullPath} `);
  const link = document.createElement("a");
  link.href = new URL(url, window.location.origin).href;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = fileName;
  elements.exportStatus.append(text, link);
}

function renderPrintReport(fileName) {
  if (!elements.printReport) return;

  const picked = state.lines.filter((line) => line.picked).length;
  const rows = state.lines.map((line) => `
    <tr>
      <td>${escapeHtml(line.picked ? "ja" : "nein")}</td>
      <td>${escapeHtml(line.warehouseOrder)}</td>
      <td>${escapeHtml(line.fromHandlingUnit)}</td>
      <td>${escapeHtml(line.positionNote)}</td>
      <td>${escapeHtml(line.fromBin)}</td>
      <td>${escapeHtml(line.product)}</td>
      <td class="num">${escapeHtml(line.targetQty)}</td>
      <td class="num">${escapeHtml(line.actualQty)}</td>
      <td>${escapeHtml(line.unit)}</td>
      <td>${escapeHtml(line.description)}</td>
      <td>${escapeHtml(line.toBin)}</td>
    </tr>
  `).join("");

  elements.printReport.innerHTML = `
    <header>
      <div>
        <h1>Kommissionierabschluss</h1>
        <p><strong>Auftrag:</strong> ${escapeHtml(state.orderNumber || "-")}</p>
        <p><strong>Kunde:</strong> ${escapeHtml(state.customerName || "-")}</p>
        <p><strong>Bearbeiter:</strong> ${escapeHtml(state.lastEditedBy || "-")}</p>
      </div>
      <div>
        <p><strong>Datum:</strong> ${escapeHtml(formatDateForDisplay(state.orderDate))}</p>
        <p><strong>Erledigt:</strong> ${picked}/${state.lines.length}</p>
        <p><strong>Abgeschlossen:</strong> ${escapeHtml(state.completedBy || "-")}</p>
        <p><strong>Dateiname:</strong> ${escapeHtml(fileName)}</p>
      </div>
    </header>
    <section class="report-meta">
      <p><strong>Europaletten:</strong> ${escapeHtml(state.euroPallets || "0")}</p>
      <p><strong>Stellplaetze:</strong> ${escapeHtml(state.storageSpaces || "0")}</p>
      <p><strong>Korrigiert:</strong> ${escapeHtml(String(state.lines.filter((line) => String(line.actualQty).trim() !== String(line.targetQty).trim()).length))}</p>
    </section>
    <section class="report-note"><strong>Notiz:</strong> ${escapeHtml(state.orderNote || "-")}</section>
    <table>
      <thead>
        <tr>
          <th style="width: 4%;">OK</th>
          <th style="width: 8%;">Lagerauftrag</th>
          <th style="width: 11%;">Von-HU</th>
          <th style="width: 13%;">Bemerkung</th>
          <th style="width: 9%;">Lagerplatz</th>
          <th style="width: 7%;">Produkt</th>
          <th style="width: 5%;">Soll</th>
          <th style="width: 5%;">Ist</th>
          <th style="width: 4%;">Einh.</th>
          <th style="width: 23%;">Beschreibung</th>
          <th style="width: 11%;">Nach-Lagerplatz</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="11">Keine Positionen vorhanden.</td></tr>`}</tbody>
    </table>`;
  elements.printReport.hidden = false;
  elements.printReport.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-report-printing");
}

function cleanupPrintReport() {
  document.body.classList.remove("is-report-printing");
  if (!elements.printReport) return;
  elements.printReport.hidden = true;
  elements.printReport.setAttribute("aria-hidden", "true");
}

function createPdfDocument() {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 26;
  const lineHeight = 14;
  const columns = [
    { title: "OK", x: 26, width: 28 },
    { title: "Lagerauftrag", x: 58, width: 62 },
    { title: "Von-HU", x: 124, width: 86 },
    { title: "Bemerkung", x: 214, width: 92 },
    { title: "Lagerplatz", x: 310, width: 74 },
    { title: "Produkt", x: 388, width: 52 },
    { title: "Soll", x: 444, width: 38 },
    { title: "Ist", x: 486, width: 38 },
    { title: "Einh.", x: 528, width: 32 },
    { title: "Beschreibung", x: 564, width: 142 },
    { title: "Nach-Platz", x: 710, width: 106 }
  ];
  const pages = [];
  let ops = [];
  let y = 552;

  const addPage = () => {
    if (ops.length) pages.push(ops);
    ops = [];
    y = 552;
    text(ops, margin, y, "Kommissionierabschluss", 18);
    y -= 22;
    text(ops, margin, y, `Auftrag: ${state.orderNumber || "-"}`, 10);
    text(ops, 220, y, `Kunde: ${state.customerName || "-"}`, 10);
    text(ops, 430, y, `Datum: ${formatDateForDisplay(state.orderDate)}`, 10);
    y -= 18;
    text(ops, margin, y, `Europaletten: ${state.euroPallets || "0"}`, 10);
    text(ops, 220, y, `Stellplaetze: ${state.storageSpaces || "0"}`, 10);
    text(ops, 430, y, `Erledigt: ${state.lines.filter((line) => line.picked).length}/${state.lines.length}`, 10);
    y -= 18;
    text(ops, margin, y, `Notiz: ${state.orderNote || "-"}`, 9);
    y -= 22;
    drawTableHeader();
  };

  const drawTableHeader = () => {
    rect(ops, margin, y - 5, pageWidth - margin * 2, 20, "0.92 0.95 0.93");
    columns.forEach((column) => text(ops, column.x, y, column.title, 7));
    y -= 20;
  };

  addPage();

  state.lines.forEach((line) => {
    if (y < 52) addPage();

    const description = fitText(line.description, 40);
    const row = [
      line.picked ? "ja" : "nein",
      line.warehouseOrder,
      line.fromHandlingUnit,
      line.positionNote,
      line.fromBin,
      line.product,
      line.targetQty,
      line.actualQty,
      line.unit,
      description,
      line.toBin
    ];

    linePath(ops, margin, y + 6, pageWidth - margin, y + 6);
    row.forEach((cell, index) => {
      text(ops, columns[index].x, y - 7, fitText(cell, Math.floor(columns[index].width / 4.4)), 7);
    });
    y -= lineHeight;
  });

  pages.push(ops);
  return buildPdf(pages, pageWidth, pageHeight);
}

function buildPdf(pages, pageWidth, pageHeight) {
  const objects = [];
  const pageRefs = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(null);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  pages.forEach((pageOps) => {
    const content = ["q", "1 1 1 rg 0 0 842 595 re f", "0 0 0 rg", "0 0 0 RG", "0.6 w", ...pageOps, "Q"].join("\n");
    const pageObjectNumber = objects.length + 1;
    const contentObjectNumber = pageObjectNumber + 1;
    pageRefs.push(`${pageObjectNumber} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return {
    blob: new Blob([pdf], { type: "application/pdf" }),
    dataUrl: `data:application/pdf;base64,${btoa(pdf)}`
  };
}

function text(ops, x, y, value, size = 9) {
  ops.push(`BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(value)}) Tj ET`);
}

function rect(ops, x, y, width, height, fillColor) {
  ops.push(`${fillColor} rg ${x} ${y} ${width} ${height} re f 0 0 0 rg`);
}

function linePath(ops, x1, y1, x2, y2) {
  ops.push(`${x1} ${y1} m ${x2} ${y2} l S`);
}

function escapePdfText(value) {
  return normalizePdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function normalizePdfText(value) {
  return String(value ?? "")
    .replace(/Ã¤/g, "ae")
    .replace(/Ã¶/g, "oe")
    .replace(/Ã¼/g, "ue")
    .replace(/Ã„/g, "Ae")
    .replace(/Ã–/g, "Oe")
    .replace(/Ãœ/g, "Ue")
    .replace(/ÃŸ/g, "ss")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function fitText(value, maxLength) {
  const textValue = normalizePdfText(value);
  if (textValue.length <= maxLength) return textValue;
  return `${textValue.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatDateForDisplay(value) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function buildPdfFileName(order) {
  const orderNumber = sanitizeFileNamePart(order.orderNumber || order.id || "auftrag");
  const orderDate = sanitizeFileNamePart(order.orderDate || new Date().toISOString().slice(0, 10));
  return `kommissionierung-${orderNumber}-${orderDate}.pdf`;
}

function sanitizeFileNamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "auftrag";
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
  if (label === "PDF") showPdfPreview(url);
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
  openLink.textContent = "PDF oeffnen";
  const spacer = document.createTextNode(" | ");
  const downloadLink = document.createElement("a");
  downloadLink.href = url;
  downloadLink.download = fileName;
  downloadLink.target = "_blank";
  downloadLink.rel = "noopener";
  downloadLink.textContent = fileName;
  elements.exportStatus.append(text, openLink, spacer, downloadLink);
}

function showPdfExport(url, fileName) {
  if (!elements.exportStatus) return;
  elements.exportStatus.hidden = false;
  elements.exportStatus.innerHTML = "";

  const text = document.createTextNode("PDF erstellt. ");
  const openLink = document.createElement("a");
  openLink.href = url;
  openLink.target = "_blank";
  openLink.rel = "noopener";
  openLink.textContent = "PDF oeffnen";

  const spacer = document.createTextNode(" | ");
  const downloadLink = document.createElement("a");
  downloadLink.href = url;
  downloadLink.download = fileName;
  downloadLink.textContent = fileName;

  elements.exportStatus.append(text, openLink, spacer, downloadLink);
  showPdfPreview(url);
}

function showExportMessage(message) {
  if (!elements.exportStatus) return;
  elements.exportStatus.hidden = false;
  elements.exportStatus.textContent = message;
}

async function saveBlobWithPicker(blob, fileName) {
  if (!window.showSaveFilePicker) return false;

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [
        {
          description: "PDF-Datei",
          accept: { "application/pdf": [".pdf"] }
        }
      ]
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (error) {
    if (!["AbortError", "SecurityError"].includes(error?.name)) console.error(error);
    return false;
  }
}

function showPdfPreview(url) {
  if (!elements.pdfPreview) return;
  elements.pdfPreview.hidden = false;
  elements.pdfPreview.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.title = "PDF-Vorschau";
  iframe.src = url;
  elements.pdfPreview.appendChild(iframe);
}

function escapeCsv(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
