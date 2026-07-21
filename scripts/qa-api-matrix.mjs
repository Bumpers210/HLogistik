import { normalizeSsiStorageBin } from "../server/helpers.mjs";
import ExcelJS from "exceljs";
import { ORDER_EXCEL_HEADERS, ORDER_EXCEL_SHEET_NAME } from "../server/order-excel-export.mjs";
import { printableHtml } from "../server/export.mjs";
import {
  detectSiStockColumns,
  previewSiStockImportRows,
  SI_STOCK_IMPORT_SHEET_NAME,
  SI_STOCK_REPLACE_CONFIRMATION,
} from "../server/si-stock-import.mjs";
import {
  destinationCustomerNameForLines,
  MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX,
  MANUAL_STORAGE_POSITION_PREFIX,
  normalizeManualStoragePositionCreateCount,
} from "../server/rules/order-rules.mjs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const BASE_URL = String(globalThis.process?.env?.QA_BASE_URL || "http://127.0.0.1:4175").replace(/\/+$/, "");
const ALLOW_LIVE = globalThis.process?.env?.QA_ALLOW_LIVE === "1";
const ROLE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-user-group": "buero",
  "x-qa-preserve-artifacts": "1"
};
const TABLET_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-user-group": "tablet",
  "x-qa-preserve-artifacts": "1"
};
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const QA_EXPORT_HEADERS = { ...ROLE_HEADERS, "x-qa-discard-export": "1" };
const QA_TABLET_EXPORT_HEADERS = { ...TABLET_HEADERS, "x-qa-discard-export": "1" };

guardAgainstAccidentalLiveWrites();

const checks = [];
const exportResponses = [];
const suffix = Date.now().toString().slice(-9);
const materialnummer = `77${suffix}`;
const hu = `QA-HU-${suffix}`;
let appParserContext = null;
let parserUuidCounter = 0;

await run();

async function run() {
  await guardAgainstUnsafeQaServerContext();

  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const importDiagnosticsSource = await readFile(new URL("../app-import-diagnostics.js", import.meta.url), "utf8");
  const importLineHelpersSource = await readFile(new URL("../app-import-line-helpers.js", import.meta.url), "utf8");
  const storageBinRulesSource = await readFile(new URL("../shared/storage-bin-rules.js", import.meta.url), "utf8");
  const quantityFormatSource = await readFile(new URL("../shared/quantity-format.js", import.meta.url), "utf8");
  const pickingXlsxSource = await readFile(new URL("../app-picking-xlsx-import.js", import.meta.url), "utf8");
  const browserModuleContext = vm.createContext({ window: {} });
  vm.runInContext(quantityFormatSource, browserModuleContext, { filename: "shared/quantity-format.js" });
  vm.runInContext(importLineHelpersSource, browserModuleContext, { filename: "app-import-line-helpers.js" });
  vm.runInContext(pickingXlsxSource, browserModuleContext, { filename: "app-picking-xlsx-import.js" });
  const quantityFormat = browserModuleContext.window.HLogistikQuantityFormat;
  const importLineHelpers = browserModuleContext.window.HLogistikImportLineHelpers;
  const pickingXlsx = browserModuleContext.window.HLogistikPickingXlsxImport;
  const legacyTabletQuantityRender = await legacyTabletQuantityRenderFixture();
  const desktopPositionNoteDedupe = await desktopPositionNoteDedupeFixture();
  const tabletModernPositionNoteDedupe = await tabletPositionNoteDedupeFixture("tablet.js");
  const tabletLegacyPositionNoteDedupe = await tabletPositionNoteDedupeFixture("tablet-legacy.js");
  const sharedPositionNoteDedupe = positionNoteDedupeScenario({
    combinedPositionNote: importLineHelpers.combinedPositionNote,
    manualPositionNoteFromInput: importLineHelpers.manualPositionNoteFromInput,
    normalizePositionNotesForSave: (order) => {
      (Array.isArray(order?.lines) ? order.lines : []).forEach((line) => {
        line.positionNote = importLineHelpers.manualPositionNoteFromInput(line.positionNote, line);
      });
      return order;
    }
  });

  const storagePdfHtml = printableHtml({
    orderNumber: `QA-PDF-ST-${suffix}`,
    orderType: "storage",
    lines: [
      {
        warehouseOrder: "10",
        product: materialnummer,
        description: "Nicht in der Einlagerliste anzeigen",
        fromHandlingUnit: "340063810001234567",
        fromBin: "002-H4-SH4C4",
        targetQty: "5",
        actualQty: "5",
        unit: "ST",
        picked: true,
        manual: true
      },
      {
        warehouseOrder: "20",
        product: `${materialnummer}-ABW`,
        fromHandlingUnit: "340063810009999999",
        fromBin: "002-H4-SH4C5",
        targetQty: "5",
        actualQty: "4",
        unit: "ST",
        picked: true
      }
    ]
  }, "QA-Einlagerung.pdf");
  const pickingPdfHtml = printableHtml({
    orderNumber: `QA-PDF-PK-${suffix}`,
    orderType: "picking",
    lines: [{
      warehouseOrder: "10",
      product: materialnummer,
      fromHandlingUnit: "340063810001234567",
      fromBin: "002-H4-SH4C4",
      toBin: "9021-0OUT",
      targetQty: "5",
      actualQty: "5",
      unit: "ST",
      picked: true
    }, {
      lineType: "loading-slip",
      barcode: "QA-LS-PDF",
      product: "QA-LS-PDF-MARKER",
      description: "Diese Ladeliste darf nicht im PDF stehen",
      targetQty: "9",
      actualQty: "9",
      unit: "ST",
      picked: true
    }]
  }, "QA-Kommissionierung.pdf");
  const storagePdfHeaders = tableHeadersFromHtml(storagePdfHtml);

  check("quantity parser reads German thousands", quantityFormat.parse("85.000") === 85000, String(quantityFormat.parse("85.000")));
  check(
    "legacy tablet renders all quantity lines without Intl or Number.isFinite",
    legacyTabletQuantityRender.numberIsFiniteAvailable === false &&
      legacyTabletQuantityRender.intlAvailable === false &&
      legacyTabletQuantityRender.renderedLineCount === 2 &&
      legacyTabletQuantityRender.inputValues.includes("15.960"),
    JSON.stringify(legacyTabletQuantityRender)
  );
  check(
    "automatic position notes stay separate from manual text and deduplicate idempotently",
    [sharedPositionNoteDedupe, desktopPositionNoteDedupe, tabletModernPositionNoteDedupe, tabletLegacyPositionNoteDedupe].every((result) =>
      result.automaticText === "com - 3A1" &&
        result.afterInputManual === "" &&
        result.afterInputText === "com - 3A1" &&
        result.appendedManualStored === "Bitte pruefen" &&
        result.appendedManualText === "Bitte pruefen - com - 3A1" &&
        result.duplicateStored === "" &&
        result.duplicateText === "com - 3A1" &&
        result.manualStored === "Bitte prüfen" &&
        result.manualText === "Bitte prüfen - com - 3A1" &&
        result.repeatedStored === result.manualStored &&
        result.repeatedText === result.manualText &&
        result.automaticOrder === "Ziel - Menge - Korrektur - Palette - System - Gebinde"
    ),
    JSON.stringify({
      shared: sharedPositionNoteDedupe,
      desktop: desktopPositionNoteDedupe,
      modern: tabletModernPositionNoteDedupe,
      legacy: tabletLegacyPositionNoteDedupe
    })
  );
  check(
    "storage PDF uses portrait A4 with exactly the six storage columns",
    storagePdfHtml.includes("@page { size: A4 portrait; margin: 10mm; }") &&
      JSON.stringify(storagePdfHeaders) === JSON.stringify(["Pos.", "Artikelnummer", "HU / LE", "Soll", "Ist", "Einlagerplatz"]),
    JSON.stringify(storagePdfHeaders)
  );
  check(
    "storage PDF excludes article description and picking columns",
    !storagePdfHtml.includes("Artikelbezeichnung") &&
      !["Lagerauftrag", "Von-HU", "Nach-Lagerplatz", "Beschreibung"].some((header) => storagePdfHeaders.includes(header)),
    JSON.stringify(storagePdfHeaders)
  );
  check(
    "picking PDF remains landscape A4",
    pickingPdfHtml.includes("@page { size: A4 landscape; margin: 12mm; }") &&
      tableHeadersFromHtml(pickingPdfHtml).includes("Lagerauftrag"),
    JSON.stringify(tableHeadersFromHtml(pickingPdfHtml))
  );
  check(
    "picking PDF excludes loading-slip positions, their totals and attachments",
    !pickingPdfHtml.includes("QA-LS-PDF") &&
      !pickingPdfHtml.includes("Ladeliste darf nicht") &&
      pickingPdfHtml.includes("Erledigt:</strong> 1/1") &&
      !pickingPdfHtml.includes("loading-slip"),
    pickingPdfHtml
  );
  check(
    "storage PDF keeps full bin, deviation marker and white manual rows",
    storagePdfHtml.includes("002-H4-SH4C4") &&
      storagePdfHtml.includes('<tr class="manual-line">') &&
      storagePdfHtml.includes('<tr class="changed-qty">') &&
      storagePdfHtml.includes(".storage-table .manual-line:not(.changed-qty):not(.missing-line) td { background: #fff; }") &&
      storagePdfHtml.includes(".storage-table .changed-qty td:nth-child(5) { border: 2px solid #111; }"),
    storagePdfHtml
  );
  check("quantity parser reads decimal comma", quantityFormat.parse("4,5") === 4.5, String(quantityFormat.parse("4,5")));
  check(
    "quantity parser supports x X and multiplication sign",
    quantityFormat.parse("4x85000") === 340000 &&
      quantityFormat.parse("4 X 85000") === 340000 &&
      quantityFormat.parse("4\u00d785000") === 340000,
    [quantityFormat.parse("4x85000"), quantityFormat.parse("4 X 85000"), quantityFormat.parse("4\u00d785000")].join(",")
  );
  check(
    "quantity formatter groups large integers in German notation",
    [1000, 85000, 720000].map(quantityFormat.format).join("|") === "1.000|85.000|720.000",
    [1000, 85000, 720000].map(quantityFormat.format).join("|")
  );
  check(
    "quantity display preserves matching multiplication source",
    quantityFormat.displayLineQuantity({ quantitySourceText: "4x85000", targetQty: "340000" }, "340000") === "4x85000",
    quantityFormat.displayLineQuantity({ quantitySourceText: "4x85000", targetQty: "340000" }, "340000")
  );
  check(
    "quantity display ignores stale multiplication source",
    quantityFormat.displayLineQuantity({ quantitySourceText: "4x85000", targetQty: "340001" }, "340001") === "340.001",
    quantityFormat.displayLineQuantity({ quantitySourceText: "4x85000", targetQty: "340001" }, "340001")
  );
  check(
    "quantity formatter leaves non-quantity text unchanged",
    Number.isNaN(quantityFormat.parse("Position A1")) && quantityFormat.format("Position A1") === "Position A1",
    quantityFormat.format("Position A1")
  );
  const quantityRegressionPosition = { position: "001", quantitySourceText: "4x85000", targetQty: "340000" };
  check(
    "quantity regression covers grouped display, source formula and unchanged position values",
    quantityFormat.format(999) === "999" &&
      quantityFormat.format(1000) === "1.000" &&
      quantityFormat.format(85000) === "85.000" &&
      quantityFormat.format(720000) === "720.000" &&
      quantityFormat.displayLineQuantity(quantityRegressionPosition, "340000") === "4x85000" &&
      quantityFormat.displayLineQuantity({ quantitySourceText: "4x85000", targetQty: "340001" }, "340001") === "340.001" &&
      quantityRegressionPosition.position === "001",
    JSON.stringify({
      values: [999, 1000, 85000, 720000].map(quantityFormat.format),
      source: quantityFormat.displayLineQuantity(quantityRegressionPosition, "340000"),
      stale: quantityFormat.displayLineQuantity({ quantitySourceText: "4x85000", targetQty: "340001" }, "340001"),
      position: quantityRegressionPosition.position
    })
  );

  let sheetToJsonOptions = null;
  browserModuleContext.window.XLSX = {
    utils: {
      sheet_to_json: (sheet, options) => {
        sheetToJsonOptions = { ...options };
        return sheet;
      }
    }
  };
  const pickingXlsxRows = [
    ["Lageraufgabe", "Von-Handling-Unit", "Von-Lagerplatz", "Produkt", "HU-Lageraufgabe", "Von-Zielmenge BME", "Basismengeneinheit", "Produktbeschreibung", "Nach-Lagerplatz"],
    ["000000000001", "000000000000000101", "002-H3-S01A1", "000000012345", "HU-AUF-1", "3882", "ST", "Produktbeschreibung 1", "9021-0OUT"],
    ["000000000002", "000000000000000102", "002-H3-S01A1", "000000012345", "HU-AUF-2", "150", "ST", "Produktbeschreibung 2", "9021-0OUT"],
    ["000000000003", "000000000000000103", "002-H3-S01A1", "000000012345", "HU-AUF-3", "400", "ST", "Produktbeschreibung 3", "9021-0OUT"],
    ["000000000004", "000000000000000104", "002-H3-S01A1", "000000012345", "HU-AUF-4", "300", "ST", "Produktbeschreibung 4", "9021-0OUT"],
    ["", "", "002-H3-S01A1", "000000012345", "HU-AUF-SUMME", "4732", "ST", "Pruefsumme", "9021-0OUT"]
  ];
  const pickingXlsxWorkbook = {
    SheetNames: ["Hinweise", "Data"],
    Sheets: { Hinweise: [["Keine Importdaten"]], Data: pickingXlsxRows }
  };
  const pickingXlsxSourceBefore = JSON.stringify(pickingXlsxWorkbook);
  const pickingXlsxHeader = pickingXlsx.findHeader(pickingXlsxRows);
  const pickingXlsxPreview = pickingXlsx.previewWorkbook(pickingXlsxWorkbook);
  const pickingXlsxQuantityWorkbook = new ExcelJS.Workbook();
  const pickingXlsxQuantitySheet = pickingXlsxQuantityWorkbook.addWorksheet("Tabelle1");
  const numeric1700Cell = pickingXlsxQuantitySheet.getCell("F2");
  numeric1700Cell.value = 1700;
  numeric1700Cell.numFmt = "#,##0";
  const numeric675Cell = pickingXlsxQuantitySheet.getCell("F3");
  numeric675Cell.value = 675;
  numeric675Cell.numFmt = "#,##0";
  const formula1700Cell = pickingXlsxQuantitySheet.getCell("F7");
  formula1700Cell.value = { formula: "1700", result: 1700 };
  const pickingXlsxNumericRows = [
    pickingXlsxRows[0],
    ["101107234", "", "022-H4-R3", "1011054", "", numeric1700Cell.value, "ST", "Teil 1700", "9020-DETTELSAU"],
    ["101107235", "340063810001948463", "002-H4-SJ1B3", "1014812", "", numeric675Cell.value, "ST", "Teil 675", "9020-DETTELSAU"],
    ["101107236", "340063810001948464", "002-H4-SJ1B4", "1014813", "", "1.700", "ST", "Text deutsch", "9020-DETTELSAU"],
    ["101107237", "340063810001948465", "002-H4-SJ1B5", "1014814", "", "1,7", "ST", "Text komma", "9020-DETTELSAU"],
    ["101107238", "340063810001948466", "002-H4-SJ1B6", "1014815", "", "4x85000", "ST", "Text multiplikation", "9020-DETTELSAU"],
    ["101107239", "340063810001948467", "002-H4-SJ1B7", "1014816", "", formula1700Cell.value, "ST", "Formel", "9020-DETTELSAU"]
  ];
  const pickingXlsxNumericSourceBefore = JSON.stringify(pickingXlsxNumericRows);
  const pickingXlsxNumericPreview = pickingXlsx.previewRows(pickingXlsxNumericRows, pickingXlsx.findHeader([pickingXlsxNumericRows[0]]));
  const pickingXlsxDraftRelease = await pickingXlsxDraftReleaseFixture(pickingXlsxNumericPreview.lines.slice(0, 2));
  const pickingXlsxSsiDestinationPreview = pickingXlsx.previewRows([
    pickingXlsxRows[0],
    ["101107240", "340063810001948468", "002-H4-SJ1B8", "1014816", "", "12", "ST", "XLSX abweichendes Ziel", "9020-ANSBACH"],
    ["101107241", "340063810001948469", "002-H4-SJ1B9", "1014817", "", "24", "ST", "XLSX SSI-Standardziel", "9021-0OUT"]
  ], pickingXlsx.findHeader([pickingXlsxRows[0]]));
  const pickingXlsxSsiDestinationDraftRelease = await pickingXlsxDraftReleaseFixture(
    pickingXlsxSsiDestinationPreview.lines,
    { release: true, applyDestinationExceptions: true }
  );
  const loadingSlipXlsxAttachment = await loadingSlipXlsxAttachmentFixture(pickingXlsxNumericPreview.lines.slice(0, 1));
  const loadingSlipXlsxDraftRelease = await pickingXlsxDraftReleaseFixture(loadingSlipXlsxAttachment.lines, { release: true });
  const pdfImportHandlerSource = extractFunctionSource(appSource, "async function handlePdfUpload(");
  const xlsxImportHandlerSource = extractFunctionSource(appSource, "async function handlePickingXlsxUpload(");
  const loadingSlipAttachmentHandlerSource = extractFunctionSource(appSource, "async function handleLoadingSlipPdfUpload(");
  const loadingSlipAttachmentReaderSource = extractFunctionSource(appSource, "async function readLoadingSlipAttachmentPdf(");
  const loadingSlipAppendButtonSource = extractFunctionSource(appSource, "function renderSaveOrderButton(");
  const importTextSource = extractFunctionSource(appSource, "async function importText(");
  const releaseButtonSource = extractFunctionSource(appSource, "function renderReleaseButton(");
  const releaseActionSource = extractFunctionSource(appSource, "async function releaseCurrentOrder(");
  const pickingXlsxLegacyRows = [
    ["Lagerauftrag", "Von HU", "Von Lagerplatz", "Materialnummer", "Beschreibung", "Menge", "Einheit", "Nach Lagerplatz"],
    ["1", "", "002-H3-S1A1", "100", "Teil A", "4x85000", "", "9021-0OUT"],
    ["2", "4711", "002-H3-S1A2", "100", "Teil A", "12", "ST", "9021-0OUT"],
    [],
    ["Gesamt"]
  ];
  const pickingXlsxLegacyHeader = pickingXlsx.findHeader(pickingXlsxLegacyRows);
  const pickingXlsxLegacyPreview = pickingXlsx.previewRows(pickingXlsxLegacyRows, pickingXlsxLegacyHeader);
  const unusualXlsxBin = "XLSX-Sonderplatz/42";
  const pickingXlsxUnusualBinPreview = pickingXlsx.previewRows([
    pickingXlsxLegacyRows[0],
    ["3", "", unusualXlsxBin, "100", "Sonderplatz unveraendert", "7", "ST", "9021-0OUT"]
  ], pickingXlsxLegacyHeader);
  const pickingXlsxUnusualBinRelease = await pickingXlsxDraftReleaseFixture(pickingXlsxUnusualBinPreview.lines, { release: true });
  const pickingPdfBinReview = await pickingPdfBinReviewFixture("002-H4-XYZ");
  const pickingXlsxInvalid = pickingXlsx.previewRows([
    pickingXlsxLegacyRows[0],
    ["1", "", "", "100", "Teil A", "0", "ST", ""]
  ], pickingXlsx.findHeader([pickingXlsxLegacyRows[0]]));
  const mandatoryPickingKeys = ["fromHandlingUnit", "fromBin", "product", "targetQty", "description", "toBin"];
  check(
    "picking XLSX maps SAP Data headers, raw quantities and source data safely",
    pickingXlsxPreview.sheetName === "Data" &&
      pickingXlsxHeader.index === 0 &&
      mandatoryPickingKeys.every((key) => pickingXlsxHeader.mapping[key] != null) &&
      pickingXlsxHeader.mapping.targetQty === 5 &&
      pickingXlsxHeader.missingRequired.length === 0 &&
      pickingXlsxPreview.ok === true &&
      !pickingXlsxPreview.hardErrors.some((error) => error.errors.some((message) => message.includes("Pflichtspalten fehlen: targetQty"))) &&
      !Object.values(pickingXlsxHeader.labels).includes("HU-Lageraufgabe") &&
      pickingXlsxLegacyHeader.missingRequired.length === 0 &&
      pickingXlsx.normalizeHeader("  VON\u2011ZIELMENGE   BME  ") === "vonzielmengebme" &&
      JSON.stringify(pickingXlsxWorkbook) === pickingXlsxSourceBefore &&
      sheetToJsonOptions?.raw === true &&
      numeric1700Cell.value === 1700 && numeric1700Cell.numFmt === "#,##0" &&
      numeric675Cell.value === 675 && numeric675Cell.numFmt === "#,##0" &&
      pickingXlsxNumericPreview.lines.map((line) => line.targetQty).join(",") === "1700,675,1700,1.7,340000,1700" &&
      pickingXlsxNumericPreview.lines.map((line) => line.actualQty).join(",") === "1700,675,1700,1.7,340000,1700" &&
      pickingXlsxNumericPreview.lines[0]?.quantitySourceText === "" &&
      pickingXlsxNumericPreview.lines[1]?.quantitySourceText === "" &&
      pickingXlsxNumericPreview.lines[4]?.quantitySourceText === "4x85000" &&
      pickingXlsxNumericPreview.lines[5]?.quantitySourceText === "" &&
      quantityFormat.format(pickingXlsxNumericPreview.lines[0]?.targetQty) === "1.700" &&
      JSON.stringify(pickingXlsxNumericRows) === pickingXlsxNumericSourceBefore &&
      pickingXlsxDraftRelease.result?.cancelled !== true &&
      pickingXlsxDraftRelease.state.lines?.length === 2 &&
      pickingXlsxDraftRelease.state.id === "" &&
      pickingXlsxDraftRelease.state.awaitingRelease === true &&
      pickingXlsxDraftRelease.state.activeUser === "" &&
      pickingXlsxDraftRelease.state.acceptedBy === "" &&
      pickingXlsxDraftRelease.state.completedAt === "" &&
      pickingXlsxDraftRelease.state.exportedAt === "" &&
      pickingXlsxDraftRelease.releaseButton.hidden === false &&
      pickingXlsxDraftRelease.releaseButton.disabled === false &&
      pickingXlsxDraftRelease.serverRequests === 0 &&
      pickingXlsxDraftRelease.saveStateCalls === 1 &&
      pickingXlsxDraftRelease.renderCalls === 1 &&
      pdfImportHandlerSource.includes("await importText(imported.text, file.name, imported.parsed, imported.diagnostics)") &&
      xlsxImportHandlerSource.includes("await importText(pickingXlsxImportText(preview), file.name, parsed, diagnostics)") &&
      pickingXlsxDraftRelease.sourceText.includes("XLSX-Fingerprint:") &&
      pickingXlsxDraftRelease.sourceText.includes("101107234") &&
      importTextSource.includes("state.awaitingRelease = true") &&
      importTextSource.includes("saveStateWithoutServer()") &&
      importTextSource.includes("render()") &&
      releaseButtonSource.includes("state.awaitingRelease") &&
      releaseActionSource.includes("saveOrderNow(false, { allowDraftRelease: true, touch: false })"),
    JSON.stringify({
      sheetName: pickingXlsxPreview.sheetName,
      header: pickingXlsxHeader,
      mapping: pickingXlsxPreview.mapping,
      sheetToJsonOptions,
      excelCells: {
        numeric1700: { value: numeric1700Cell.value, numberFormat: numeric1700Cell.numFmt },
        numeric675: { value: numeric675Cell.value, numberFormat: numeric675Cell.numFmt },
        formula1700: formula1700Cell.value
      },
      numericLines: pickingXlsxNumericPreview.lines,
      draftRelease: pickingXlsxDraftRelease
    })
  );
  check(
    "picking XLSX keeps source rows as separate positions",
    pickingXlsxPreview.lines.length === 4 &&
      pickingXlsxPreview.lines.every((line) => line.product === "000000012345" && line.fromBin === "002-H3-S01A1" && line.toBin === "9021-0OUT"),
    JSON.stringify(pickingXlsxPreview.lines)
  );
  check(
    "picking XLSX stores only SSI destination exceptions and retains them after release",
    pickingXlsxSsiDestinationDraftRelease.result?.cancelled !== true &&
      pickingXlsxSsiDestinationDraftRelease.releaseRequests === 1 &&
      pickingXlsxSsiDestinationDraftRelease.savedOrder?.customerName === "9021-0OUT" &&
      pickingXlsxSsiDestinationDraftRelease.savedOrder?.orderNumber === "SSI" &&
      pickingXlsxSsiDestinationDraftRelease.savedLines?.length === 2 &&
      pickingXlsxSsiDestinationDraftRelease.savedLines?.[0]?.toBin === "9020-ANSBACH" &&
      pickingXlsxSsiDestinationDraftRelease.savedLines?.[0]?.autoPositionNotes?.destination === "9020-ANSBACH" &&
      pickingXlsxSsiDestinationDraftRelease.savedLines?.[0]?.positionNote === "" &&
      !pickingXlsxSsiDestinationDraftRelease.savedLines?.[1]?.autoPositionNotes?.destination &&
      pickingXlsxSsiDestinationDraftRelease.savedLines?.[1]?.toBin === "9021-0OUT" &&
      pickingXlsxSsiDestinationDraftRelease.reopenedOrder?.lines?.[0]?.autoPositionNotes?.destination === "9020-ANSBACH" &&
      !pickingXlsxSsiDestinationDraftRelease.reopenedOrder?.lines?.[1]?.autoPositionNotes?.destination &&
      countSourceOccurrences(xlsxImportHandlerSource, "annotateDestinationExceptions(preview.lines)") === 1,
    JSON.stringify(pickingXlsxSsiDestinationDraftRelease)
  );
  check(
    "picking XLSX draft appends every loading-slip position without server save or deduplication",
    loadingSlipXlsxAttachment.button.textContent === "Ladeliste anhängen" &&
      !loadingSlipXlsxAttachment.button.textContent.includes("Entwurf lokal speichern") &&
      loadingSlipXlsxAttachment.canAppend === true &&
      loadingSlipXlsxAttachment.pages.map((page) => page.rotation).join(",") === "0,90" &&
      loadingSlipXlsxAttachment.loadingSlipCount === 3 &&
      loadingSlipXlsxAttachment.lines.length === 5 &&
      loadingSlipXlsxAttachment.regularLinesUnchanged === true &&
      loadingSlipXlsxAttachment.loadingLines.every((line) => line.lineType === "loading-slip") &&
      loadingSlipXlsxAttachment.loadingLines.map((line) => line.product).join(",") === "1066526,1066526,1072595,1072598" &&
      new Set(loadingSlipXlsxAttachment.loadingLines.map((line) => line.loadingSlipAttachmentId)).size === 1 &&
      loadingSlipXlsxAttachment.loadingLines.map((line) => line.loadingSlipAttachmentPage).join(",") === "1,1,2,2" &&
      loadingSlipXlsxDraftRelease.result?.cancelled !== true &&
      loadingSlipXlsxDraftRelease.releaseRequests === 1 &&
      loadingSlipXlsxDraftRelease.savedLines?.length === 5 &&
      loadingSlipXlsxDraftRelease.savedLines?.slice(1).every((line) => line.lineType === "loading-slip") &&
      loadingSlipAttachmentHandlerSource.includes("appendAllLoadingSlipLines(state.lines, attachment.lines)") &&
      !loadingSlipAttachmentHandlerSource.includes("saveStateWithoutServer()") &&
      !loadingSlipAttachmentHandlerSource.includes("saveOrderNow(") &&
      !loadingSlipAttachmentHandlerSource.includes("releaseCurrentOrder(") &&
      loadingSlipAttachmentReaderSource.includes("for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1)") &&
      loadingSlipAttachmentReaderSource.includes("for (const rotation of OCR_ROTATIONS)") &&
      loadingSlipAppendButtonSource.includes("Ladeliste anhängen") &&
      loadingSlipAppendButtonSource.includes("canAppend"),
    JSON.stringify({
      attachment: loadingSlipXlsxAttachment,
      release: loadingSlipXlsxDraftRelease,
      handler: loadingSlipAttachmentHandlerSource,
      reader: loadingSlipAttachmentReaderSource,
      button: loadingSlipAppendButtonSource
    })
  );
  check(
    "picking XLSX preserves multiplication source text",
    pickingXlsxLegacyPreview.lines[0]?.targetQty === "340000" && pickingXlsxLegacyPreview.lines[0]?.quantitySourceText === "4x85000",
    JSON.stringify(pickingXlsxLegacyPreview.lines[0])
  );
  check(
    "picking XLSX accounts for blank and summary rows",
    pickingXlsxPreview.inputRowCount === 5 &&
      pickingXlsxPreview.accountedRowCount === 5 &&
      pickingXlsxPreview.ignoredRows.length === 1 &&
      pickingXlsxPreview.ignoredRows[0]?.reason.includes("Lageraufgabe") &&
      pickingXlsxLegacyPreview.inputRowCount === 4 &&
      pickingXlsxLegacyPreview.accountedRowCount === 4 &&
      pickingXlsxLegacyPreview.ignoredRows.length === 2,
    JSON.stringify(pickingXlsxPreview)
  );
  check(
    "picking XLSX reports invalid required cells as hard errors",
    pickingXlsxInvalid.lines.length === 0 && pickingXlsxInvalid.hardErrors.length === 1 && pickingXlsxInvalid.hardErrors[0].errors.length === 3,
    JSON.stringify(pickingXlsxInvalid)
  );
  check(
    "picking XLSX marks missing HU editable",
    pickingXlsxLegacyPreview.lines[0]?.fromHandlingUnitEditable === true && pickingXlsxLegacyPreview.lines[1]?.fromHandlingUnitEditable === false,
    JSON.stringify(pickingXlsxLegacyPreview.lines)
  );
  check(
    "picking XLSX defaults missing unit to Stk",
    pickingXlsxLegacyPreview.lines[0]?.unit === "Stk" && pickingXlsxLegacyPreview.lines[1]?.unit === "ST",
    JSON.stringify(pickingXlsxLegacyPreview.lines)
  );
  check(
    "picking XLSX retains original worksheet row numbers",
    pickingXlsxPreview.lines.map((line) => line.sourceRow).join(",") === "2,3,4,5" &&
      pickingXlsxPreview.lines.map((line) => line.targetQty).join(",") === "3882,150,400,300" &&
      pickingXlsxPreview.lines.map((line) => line.warehouseOrder).join(",") === "000000000001,000000000002,000000000003,000000000004" &&
      pickingXlsxPreview.lines.map((line) => line.fromHandlingUnit).join(",") === "000000000000000101,000000000000000102,000000000000000103,000000000000000104" &&
      pickingXlsxPreview.lines.map((line) => line.description).join("|") === "Produktbeschreibung 1|Produktbeschreibung 2|Produktbeschreibung 3|Produktbeschreibung 4",
    JSON.stringify(pickingXlsxPreview.lines)
  );
  check(
    "picking XLSX keeps unusual source bins without review and permits release",
    pickingXlsxUnusualBinPreview.hardErrors.length === 0 &&
      pickingXlsxUnusualBinPreview.lines[0]?.fromBin === unusualXlsxBin &&
      pickingXlsxUnusualBinRelease.importedLine?.fromBin === unusualXlsxBin &&
      pickingXlsxUnusualBinRelease.storageBinOptions?.allowSiFromBinFill === false &&
      !pickingXlsxUnusualBinRelease.importedLine?.binWarning &&
      pickingXlsxUnusualBinRelease.importedLine?.fromBinReviewRequired !== true &&
      pickingXlsxUnusualBinRelease.hasOpenReviewBeforeRelease === false &&
      pickingXlsxUnusualBinRelease.releaseRequests === 1 &&
      pickingXlsxUnusualBinRelease.savedLine?.fromBin === unusualXlsxBin &&
      !pickingXlsxUnusualBinRelease.savedLine?.binWarning &&
      pickingXlsxUnusualBinRelease.savedLine?.fromBinReviewRequired !== true,
    JSON.stringify(pickingXlsxUnusualBinRelease)
  );
  check(
    "picking PDF and OCR source-bin review remains active",
    pickingPdfBinReview.review.fromBinReviewRequired === true && pickingPdfBinReview.blocked === true,
    JSON.stringify(pickingPdfBinReview)
  );

  const siStockHeader = ["Datum", "Bereich", "Material", "Materialbezeichnung", "Menge", "Lagerplatz", "LE", "Paletten"];
  const siStockRows = [
    siStockHeader,
    ["2026-07-17", "SI", "100", "Teil A", "10", "001-A", "4711", "1"],
    ["2026-07-17", "SI", "100", "Teil A", "10", "001-A", "4711", "1"],
    ["2026-07-17", "SI", "200", "Teil B", "4", "002-B", "", "1"],
    ["2026-07-17", "SI", "200", "Teil B", "6", "002-B", "", "2"],
    ["2026-07-17", "SI", "300", "Teil C", "3", "003-C", "LE-X", "0"]
  ];
  const siStockPreview = previewSiStockImportRows({ sheetName: SI_STOCK_IMPORT_SHEET_NAME, fileName: "synthetic.xlsx", rows: siStockRows });
  const siWrongSheet = previewSiStockImportRows({ sheetName: "Data", fileName: "synthetic.xlsx", rows: siStockRows });
  const siColumnDetection = detectSiStockColumns(siStockHeader);
  const siConflictingLe = previewSiStockImportRows({
    sheetName: SI_STOCK_IMPORT_SHEET_NAME,
    rows: [siStockHeader,
      ["2026-07-17", "SI", "400", "Teil D", "5", "004-D", "9900", "1"],
      ["2026-07-17", "SI", "400", "Teil D", "6", "004-D", "9900", "1"]]
  });
  const siConflictingEmptyLe = previewSiStockImportRows({
    sheetName: SI_STOCK_IMPORT_SHEET_NAME,
    rows: [siStockHeader,
      ["2026-07-17", "SI", "500", "Teil E", "5", "005-E", "", "1"],
      ["2026-07-17", "SI", "500", "Teil F", "6", "005-E", "", "1"]]
  });
  const siArticleConflict = previewSiStockImportRows({
    sheetName: SI_STOCK_IMPORT_SHEET_NAME,
    rows: [siStockHeader,
      ["2026-07-17", "SI", "600", "Teil G", "5", "006-G", "1", "1"],
      ["2026-07-17", "SI", "600", "Teil H", "6", "006-H", "2", "1"]]
  });
  check(
    "SI preview rejects a workbook without Bestandsdetail",
    siWrongSheet.ok === false && siWrongSheet.hardErrors.some((error) => error.code === "sheet"),
    JSON.stringify(siWrongSheet.hardErrors)
  );
  check(
    "SI preview detects required Bestandsdetail columns",
    siColumnDetection.missing.length === 0 && siColumnDetection.columns.le === 6,
    JSON.stringify(siColumnDetection)
  );
  check(
    "SI preview discards and reports exact non-empty LE duplicate",
    siStockPreview.counts.discardedExactDuplicates === 1 && siStockPreview.discardedExactDuplicates[0]?.keptRowNumber === 2,
    JSON.stringify(siStockPreview.discardedExactDuplicates)
  );
  check(
    "SI preview blocks conflicting non-empty LE duplicate",
    siConflictingLe.ok === false && siConflictingLe.hardErrors.some((error) => error.code === "conflicting-le"),
    JSON.stringify(siConflictingLe.hardErrors)
  );
  check(
    "SI preview permits blank LE with warning",
    siStockPreview.warnings.filter((warning) => warning.code === "missing-le").length === 2,
    JSON.stringify(siStockPreview.warnings)
  );
  check(
    "SI preview merges structurally equal blank-LE rows",
    siStockPreview.counts.mergedEmptyLeGroups === 1 && siStockPreview.stockRows.find((row) => row.materialnummer === "200")?.mengeStueck === 10,
    JSON.stringify(siStockPreview.mergedEmptyLeGroups)
  );
  check(
    "SI preview blocks structurally conflicting blank-LE rows",
    siConflictingEmptyLe.ok === false && siConflictingEmptyLe.hardErrors.some((error) => error.code === "conflicting-empty-le"),
    JSON.stringify(siConflictingEmptyLe.hardErrors)
  );
  check(
    "SI preview preserves unusual nonnumeric LE as warning",
    siStockPreview.stockRows.find((row) => row.materialnummer === "300")?.leNummer === "LE-X" &&
      siStockPreview.warnings.some((warning) => warning.code === "unusual-le"),
    JSON.stringify(siStockPreview.warnings)
  );
  check(
    "SI preview blocks conflicting article descriptions",
    siArticleConflict.ok === false && siArticleConflict.hardErrors.some((error) => error.code === "article-conflict"),
    JSON.stringify(siArticleConflict.hardErrors)
  );
  check(
    "SI preview balances source, duplicate and merged row counts",
    siStockPreview.ok === true && siStockPreview.counts.validSourceRows === 5 &&
      siStockPreview.counts.importStockRows === 3 && siStockPreview.counts.importArticles === 3,
    JSON.stringify(siStockPreview.counts)
  );
  check("ssi H3 O-Y shorthand normalizes to direct H3 bin", normalizeSsiStorageBin("H3T1") === "002-H3-T1", normalizeSsiStorageBin("H3T1"));
  check("ssi H3 O-Y shorthand accepts hyphen", normalizeSsiStorageBin("H3-T1") === "002-H3-T1", normalizeSsiStorageBin("H3-T1"));
  check("ssi H3 direct bin remains stable", normalizeSsiStorageBin("002-H3-T1") === "002-H3-T1", normalizeSsiStorageBin("002-H3-T1"));
  check("ssi A shelf normalizes to H1", normalizeSsiStorageBin("AA8C3") === "002-H1-SAA8C3", normalizeSsiStorageBin("AA8C3"));
  check("ssi AT shelf normalizes to H1", normalizeSsiStorageBin("AT8A1") === "002-H1-SAT8A1", normalizeSsiStorageBin("AT8A1"));
  check("ssi AU shelf normalizes to H4", normalizeSsiStorageBin("AU8A1") === "002-H4-SAU8A1", normalizeSsiStorageBin("AU8A1"));
  check(
    "picking source-bin rule accepts valid H7 shelf without review",
    (await pickingBinShapeFixture("002-H7-S12A3")).shape.status === "valid" &&
      (await pickingBinShapeFixture("002-H7-S12A3")).review.fromBinReviewRequired === false,
    JSON.stringify(await pickingBinShapeFixture("002-H7-S12A3"))
  );
  check(
    "picking source-bin rule keeps OCR-suspicious H3 shelf under review",
    (await pickingBinShapeFixture("002-H3-SOSA3")).shape.status === "suspicious" &&
      (await pickingBinShapeFixture("002-H3-SOSA3")).shape.suggestedCandidates.includes("002-H3-SO5A3") &&
      (await pickingBinShapeFixture("002-H3-SOSA3")).review.fromBinReviewRequired === true,
    JSON.stringify(await pickingBinShapeFixture("002-H3-SOSA3"))
  );
  check(
    "destination customer rule prefers 9021-0OUT from any line",
    destinationCustomerNameForLines([{ toBin: "9020-ANSBACH" }, { toBin: "9021-0OUT" }]) === "9021-0OUT",
    destinationCustomerNameForLines([{ toBin: "9020-ANSBACH" }, { toBin: "9021-0OUT" }])
  );
  check("manual storage count default is 1", normalizeManualStoragePositionCreateCount("").value === 1, JSON.stringify(normalizeManualStoragePositionCreateCount("")));
  check("manual storage invalid count rejected", normalizeManualStoragePositionCreateCount("0").ok === false, JSON.stringify(normalizeManualStoragePositionCreateCount("0")));
  check("manual storage max count accepted", normalizeManualStoragePositionCreateCount(String(MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX)).ok === true, String(MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX));
  check("manual storage position prefix remains M", MANUAL_STORAGE_POSITION_PREFIX === "M", MANUAL_STORAGE_POSITION_PREFIX);

  const storageMissingDescriptionCompletion = await storageMissingDescriptionCompletionFixture();
  check(
    "storage completion accepts line without article description",
    storageMissingDescriptionCompletion.completeErrors.length === 0 &&
      storageMissingDescriptionCompletion.exportMessage === "",
    JSON.stringify(storageMissingDescriptionCompletion)
  );
  check(
    "storage completion still requires article number",
    storageMissingDescriptionCompletion.missingProductErrors.some((error) => /Artikelnummer fehlt/i.test(error)),
    JSON.stringify(storageMissingDescriptionCompletion)
  );

  const tabletModernMissingDescriptionCompletion = await tabletMissingDescriptionCompletionFixture("tablet.js");
  const tabletLegacyMissingDescriptionCompletion = await tabletMissingDescriptionCompletionFixture("tablet-legacy.js");
  check(
    "tablet storage completion accepts line without article description",
    tabletModernMissingDescriptionCompletion.completeErrors.length === 0 &&
      tabletLegacyMissingDescriptionCompletion.completeErrors.length === 0 &&
      tabletModernMissingDescriptionCompletion.exportMessage === "" &&
      tabletLegacyMissingDescriptionCompletion.exportMessage === "",
    JSON.stringify({ modern: tabletModernMissingDescriptionCompletion, legacy: tabletLegacyMissingDescriptionCompletion })
  );
  check(
    "tablet storage completion still requires article number",
    tabletModernMissingDescriptionCompletion.missingProductErrors.some((error) => /Artikelnummer fehlt/i.test(error)) &&
      tabletLegacyMissingDescriptionCompletion.missingProductErrors.some((error) => /Artikelnummer fehlt/i.test(error)),
    JSON.stringify({ modern: tabletModernMissingDescriptionCompletion, legacy: tabletLegacyMissingDescriptionCompletion })
  );

  const tabletModernDetailLoading = await tabletDetailLoadingFixture("tablet.js");
  const tabletLegacyDetailLoading = await tabletDetailLoadingFixture("tablet-legacy.js");
  check(
    "tablet order summaries load a complete detail with rendered positions and an active takeover",
    [tabletModernDetailLoading, tabletLegacyDetailLoading].every((result) =>
      result.summaryHasNoLines === true &&
      result.detailRequestPath === "/api/orders/qa-tablet-detail" &&
      result.loadedOrderId === "qa-tablet-detail" &&
      result.renderedLineCount === 3 &&
      result.takeOver.hidden === false &&
      result.takeOver.disabled === false &&
      result.loadedAcceptedBy === ""
    ),
    JSON.stringify({ modern: tabletModernDetailLoading, legacy: tabletLegacyDetailLoading })
  );
  check(
    "tablet detail API error preserves the previous rendered order instead of a false empty selection",
    [tabletModernDetailLoading, tabletLegacyDetailLoading].every((result) =>
      result.failure.selectedOrderId === "qa-tablet-detail" &&
      result.failure.currentOrderId === "qa-tablet-detail" &&
      result.failure.renderedLineCount === 3 &&
      /Auftrag konnte nicht geladen werden: Detailtest fehlgeschlagen/.test(result.failure.message)
    ),
    JSON.stringify({ modern: tabletModernDetailLoading.failure, legacy: tabletLegacyDetailLoading.failure })
  );
  check(
    "tablet modern and legacy keep identical takeover status rules",
    JSON.stringify(tabletModernDetailLoading.statusRules) === JSON.stringify(tabletLegacyDetailLoading.statusRules),
    JSON.stringify({ modern: tabletModernDetailLoading.statusRules, legacy: tabletLegacyDetailLoading.statusRules })
  );

  const orderHintSameLine = await parsePickingTextFixture(pickingTextFixture("Bestellhinweis: Service Ecke"));
  check(
    "picking import appends same-line order hint",
    orderHintSameLine.orderNumber === "60126-Service Ecke",
    JSON.stringify({ orderNumber: orderHintSameLine.orderNumber, lines: orderHintSameLine.lines })
  );

  const orderHintNextLine = await parsePickingTextFixture(pickingTextFixture("Bestellhinweis:\nService Ecke"));
  check(
    "picking import appends next-line order hint",
    orderHintNextLine.orderNumber === "60126-Service Ecke",
    JSON.stringify({ orderNumber: orderHintNextLine.orderNumber })
  );

  const orderWithoutHint = await parsePickingTextFixture(pickingTextFixture(""));
  check(
    "picking import without order hint keeps order number",
    orderWithoutHint.orderNumber === "60126",
    JSON.stringify({ orderNumber: orderWithoutHint.orderNumber })
  );

  const orderHintAlreadyAppended = await parsePickingTextFixture(pickingTextFixture("Bestellhinweis: Service Ecke", "60126-Service Ecke"));
  check(
    "picking import avoids duplicate order hint suffix",
    orderHintAlreadyAppended.orderNumber === "60126-Service Ecke",
    JSON.stringify({ orderNumber: orderHintAlreadyAppended.orderNumber })
  );

  const orderHintHeaderRejected = await parsePickingTextFixture(pickingTextFixture("Bestellhinweis:\nArtikelnummer"));
  check(
    "picking import ignores table header as order hint",
    orderHintHeaderRejected.orderNumber === "60126",
    JSON.stringify({ orderNumber: orderHintHeaderRejected.orderNumber })
  );

  const refinedOcrOrderHint = await parseRefinedBestellscheinOcrFixture();
  check(
    "picking import keeps order hint when OCR wraps order number",
    refinedOcrOrderHint.orderNumber === "60130-Service Ecke",
    JSON.stringify({ orderNumber: refinedOcrOrderHint.orderNumber, lines: refinedOcrOrderHint.lines })
  );

  const refinedLateOrderHint = await parseRefinedBestellscheinLateOrderHintFixture();
  check(
    "picking import keeps late Bestellschein order hint after OCR refinement",
    refinedLateOrderHint.orderNumber === "59033-com",
    JSON.stringify({ orderNumber: refinedLateOrderHint.orderNumber, lines: refinedLateOrderHint.lines })
  );

  const siBestellscheinOcrCandidate = await siBestellscheinOcrCandidateFixture();
  check(
    "picking OCR candidate accepts SI Bestellschein without source bin",
    siBestellscheinOcrCandidate.accepted === true &&
      siBestellscheinOcrCandidate.score >= 2500 &&
      siBestellscheinOcrCandidate.parsed.lines.length === 1 &&
      siBestellscheinOcrCandidate.parsed.lines[0]?.fromBin === "" &&
      siBestellscheinOcrCandidate.parsed.customerName === "030 / 012 Hummel Logistik SI" &&
      siBestellscheinOcrCandidate.parsed.customerGroupKey === "030 012 HUMMEL LOGISTIK SI",
    JSON.stringify(siBestellscheinOcrCandidate)
  );

  const siBestellscheinOrientation = await siBestellscheinOrientationProbeFixture();
  check(
    "picking image-only SI Bestellschein orientation probe selects rotated page without source bin",
    siBestellscheinOrientation.selectedOrientation === 90 &&
      siBestellscheinOrientation.selectedCandidate?.siLike === true &&
      siBestellscheinOrientation.selectedCandidate?.bestellscheinCompleteCount === 5 &&
      siBestellscheinOrientation.pageNotice.includes("Bestellschein nennt 2 Seiten") &&
      siBestellscheinOrientation.pageNotice.includes("PDF enthaelt 1 Seite"),
    JSON.stringify(siBestellscheinOrientation)
  );

  const siBestellscheinTieBreak = await siBestellscheinOrientationTieBreakFixture();
  check(
    "picking image-only SI Bestellschein orientation tie-break uses parser quality",
    siBestellscheinTieBreak.probeSelectedOrientation === "" &&
      siBestellscheinTieBreak.selectedRotation === 180 &&
      siBestellscheinTieBreak.selectedAccepted === true &&
      siBestellscheinTieBreak.selectedLines === 2 &&
      siBestellscheinTieBreak.selectedOrderNumber === "60390-Service Ecke" &&
      siBestellscheinTieBreak.pageNotice.includes("Bestellschein nennt 2 Seiten"),
    JSON.stringify(siBestellscheinTieBreak)
  );

  const siSystemBinUnique = await siSystemFromBinFillFixture("unique");
  check(
    "SI Bestellschein fills missing source bin from unique LE/HU system match",
    siSystemBinUnique.patch.fromBin === "002-H7-S12A3" &&
      siSystemBinUnique.patch.fromBinSystemLookupStatus === "applied" &&
      siSystemBinUnique.patch.fromBinReviewRequired === false,
    JSON.stringify(siSystemBinUnique)
  );
  const siSystemBinAmbiguous = await siSystemFromBinFillFixture("ambiguous");
  check(
    "SI Bestellschein keeps source bin empty and review open for ambiguous LE/HU system match",
    !String(siSystemBinAmbiguous.patch.fromBin || "").trim() &&
      siSystemBinAmbiguous.patch.fromBinSystemLookupStatus === "ambiguous" &&
      siSystemBinAmbiguous.patch.fromBinReviewRequired === true,
    JSON.stringify(siSystemBinAmbiguous)
  );
  const siSystemBinMissing = await siSystemFromBinFillFixture("missing");
  check(
    "SI Bestellschein keeps source bin empty and review open when LE/HU has no system match",
    !String(siSystemBinMissing.patch.fromBin || "").trim() &&
      siSystemBinMissing.patch.fromBinSystemLookupStatus === "no-match" &&
      siSystemBinMissing.patch.fromBinReviewRequired === true,
    JSON.stringify(siSystemBinMissing)
  );
  const siSystemBinKeepsValid = await siSystemFromBinFillFixture("valid-existing");
  check(
    "SI Bestellschein does not overwrite an already valid source bin",
    !Object.prototype.hasOwnProperty.call(siSystemBinKeepsValid.patch, "fromBin") &&
      siSystemBinKeepsValid.patch.fromBinSystemLookupStatus === "kept-existing" &&
      siSystemBinKeepsValid.applied === false,
    JSON.stringify(siSystemBinKeepsValid)
  );

  const pdfTextFastAccept = await pdfTextFastAcceptFixture();
  check(
    "picking import accepts clean PDF text before OCR",
    pdfTextFastAccept.accepted === true &&
      pdfTextFastAccept.parsed.lines.length === 1 &&
      pdfTextFastAccept.parsed.lines[0]?.fromBin === "002-H4-SAA8C3" &&
      pdfTextFastAccept.parsed.lines[0]?.toBin === "9021-0OUT" &&
      pdfTextFastAccept.issues.length === 0,
    JSON.stringify(pdfTextFastAccept)
  );

  const weakPdfTextFastAccept = await weakPdfTextFastAcceptFixture();
  check(
    "picking import rejects weak PDF text fast path",
    weakPdfTextFastAccept.accepted === false &&
      weakPdfTextFastAccept.parsed.lines.length === 1 &&
      !String(weakPdfTextFastAccept.parsed.lines[0]?.fromBin || "").trim(),
    JSON.stringify(weakPdfTextFastAccept)
  );

  const loadingSlipFromSecondaryOcr = await loadingSlipFromSecondaryOcrCandidateFixture();
  check(
    "picking import appends loading slip from secondary OCR candidate",
    loadingSlipFromSecondaryOcr.normalCount === 1 &&
      loadingSlipFromSecondaryOcr.loadingCount === 1 &&
      loadingSlipFromSecondaryOcr.loadingLine?.barcode === "A1234567890" &&
      loadingSlipFromSecondaryOcr.loadingLine?.product === "1076846" &&
      loadingSlipFromSecondaryOcr.loadingLine?.targetQty === "12",
    JSON.stringify(loadingSlipFromSecondaryOcr)
  );

  const loadingSlipThreePositions = await loadingSlipThreePositionsFixture();
  check(
    "picking loading slip keeps three consecutive positions with one barcode",
    loadingSlipThreePositions.normalCount === 1 &&
      loadingSlipThreePositions.loadingLines.length === 3 &&
      loadingSlipThreePositions.loadingLines.every((line) => line.lineType === "loading-slip") &&
      loadingSlipThreePositions.loadingLines.map((line) => line.product).join(",") === "1066526,1072595,1072598" &&
      loadingSlipThreePositions.loadingLines.map((line) => line.description).join("|") === "Sicherheitsstreifen fuer 7015-01|PET-Etui fuer 7015/02-05|PET-Etui fuer 7015-01" &&
      loadingSlipThreePositions.loadingLines.map((line) => line.targetQty).join(",") === "15960,5625,5625" &&
      loadingSlipThreePositions.loadingLines.map((line) => line.actualQty).join(",") === "15960,5625,5625" &&
      loadingSlipThreePositions.loadingLines.map((line) => line.loadingSlipPosition).join(",") === "1,2,3" &&
      loadingSlipThreePositions.audit.expected === 3 &&
      loadingSlipThreePositions.audit.attached === 3 &&
      loadingSlipThreePositions.audit.issues.length === 0 &&
      loadingSlipThreePositions.reappendedLineCount === 4,
    JSON.stringify(loadingSlipThreePositions)
  );

  check(
    "picking loading-slip imports leave position notes empty",
    loadingSlipXlsxAttachment.loadingLines.concat(loadingSlipThreePositions.loadingLines).every((line) =>
      !String(line.positionNote || "").trim() &&
        !String(line.autoPositionNotes?.loadingSlip || "").trim()
    ),
    JSON.stringify({
      xlsxAttachmentNotes: loadingSlipXlsxAttachment.loadingLines.map((line) => ({
        positionNote: line.positionNote || "",
        autoLoadingSlipNote: line.autoPositionNotes?.loadingSlip || ""
      })),
      automaticImportNotes: loadingSlipThreePositions.loadingLines.map((line) => ({
        positionNote: line.positionNote || "",
        autoLoadingSlipNote: line.autoPositionNotes?.loadingSlip || ""
      }))
    })
  );

  const rotatedLoadingSlipFallback = await rotatedLoadingSlipFallbackFixture();
  check(
    "picking import starts rotated loading-slip OCR for an unrecognised second page",
    rotatedLoadingSlipFallback.fallbackNeeded === true &&
      rotatedLoadingSlipFallback.normalCount === 1 &&
      rotatedLoadingSlipFallback.loadingLines.length === 3 &&
      rotatedLoadingSlipFallback.loadingLines.map((line) => line.product).join(",") === "1066526,1072595,1072598" &&
      rotatedLoadingSlipFallback.loadingLines.map((line) => line.targetQty).join(",") === "15960,5625,5625",
    JSON.stringify(rotatedLoadingSlipFallback)
  );

  const mergedBestellscheinHu = await mergeBestellscheinHuFixture();
  check(
    "picking import does not overwrite differing Bestellschein HU during OCR refinement",
    mergedBestellscheinHu[0]?.fromHandlingUnit === "30684310"
      && mergedBestellscheinHu[1]?.fromHandlingUnit === "30684311",
    JSON.stringify(mergedBestellscheinHu)
  );

  const ambiguousMissingBestellscheinHu = await mergeAmbiguousMissingBestellscheinHuFixture();
  check(
    "picking import leaves ambiguous missing Bestellschein HU editable",
    ambiguousMissingBestellscheinHu[0]?.fromHandlingUnit === ""
      && ambiguousMissingBestellscheinHu[0]?.fromHandlingUnitEditable === true,
    JSON.stringify(ambiguousMissingBestellscheinHu)
  );

  const ambiguousWeakBestellscheinHu = await mergeAmbiguousWeakBestellscheinHuFixture();
  check(
    "picking import does not complete ambiguous weak Bestellschein HU from another line",
    ambiguousWeakBestellscheinHu[0]?.fromHandlingUnit === "3068431",
    JSON.stringify(ambiguousWeakBestellscheinHu)
  );

  const warehouseQuantityCorrection = await warehouseQuantityCorrectionFixture();
  check(
    "picking import keeps existing leading-zero stock quantity correction",
    warehouseQuantityCorrection.corrected === "938"
      && warehouseQuantityCorrection.normal === ""
      && warehouseQuantityCorrection.unrelated === "",
    JSON.stringify(warehouseQuantityCorrection)
  );

  const missingBinWarehouseImport = await parseWarehouseMissingBinFixture();
  check(
    "picking import keeps warehouse positions without clear source bin",
    missingBinWarehouseImport.parsed.lines.length === 1 &&
      missingBinWarehouseImport.parsed.lines[0]?.warehouseOrder === "80015595" &&
      missingBinWarehouseImport.parsed.lines[0]?.fromHandlingUnit === "30684317" &&
      missingBinWarehouseImport.parsed.lines[0]?.product === "1076846" &&
      missingBinWarehouseImport.parsed.lines[0]?.targetQty === "938" &&
      !String(missingBinWarehouseImport.parsed.lines[0]?.fromBin || "").trim() &&
      !String(missingBinWarehouseImport.parsed.lines[0]?.binWarning || "").trim() &&
      !missingBinWarehouseImport.issues.some((issue) => /Von-Lagerplatz|Lagerplatz unklar/i.test(issue)),
    JSON.stringify(missingBinWarehouseImport)
  );

  const splitMultiplierWithoutHuImport = await parseWarehouseSplitMultiplierWithoutHuFixture();
  check(
    "picking import keeps SSI row without HU and OCR-split multiplier quantity",
    splitMultiplierWithoutHuImport.parsed.lines.length === 1 &&
      splitMultiplierWithoutHuImport.parsed.lines[0]?.warehouseOrder === "101097251" &&
      splitMultiplierWithoutHuImport.parsed.lines[0]?.fromHandlingUnit === "" &&
      splitMultiplierWithoutHuImport.parsed.lines[0]?.fromBin === "022-H4-R8" &&
      splitMultiplierWithoutHuImport.parsed.lines[0]?.product === "1014678" &&
      splitMultiplierWithoutHuImport.parsed.lines[0]?.targetQty === "2x33000" &&
      splitMultiplierWithoutHuImport.parsed.lines[0]?.unit === "Stk" &&
      splitMultiplierWithoutHuImport.parsed.lines[0]?.toBin === "4000-KAPPE" &&
      splitMultiplierWithoutHuImport.issues.length === 0,
    JSON.stringify(splitMultiplierWithoutHuImport)
  );

  const adjacentSameProductImport = await parseWarehouseAdjacentSameProductSplitMultiplierFixture();
  check(
    "picking import keeps adjacent SSI rows with same product and different tasks",
    adjacentSameProductImport.parsed.lines.length === 2 &&
      adjacentSameProductImport.parsed.lines[0]?.warehouseOrder === "101097250" &&
      adjacentSameProductImport.parsed.lines[1]?.warehouseOrder === "101097251" &&
      adjacentSameProductImport.parsed.lines.every((line) => line.product === "1014678") &&
      adjacentSameProductImport.parsed.lines[0]?.fromBin === "022-H4-R7" &&
      adjacentSameProductImport.parsed.lines[1]?.fromBin === "022-H4-R8" &&
      adjacentSameProductImport.parsed.lines[0]?.targetQty === "6x33000" &&
      adjacentSameProductImport.parsed.lines[1]?.targetQty === "2x33000" &&
      adjacentSameProductImport.diagnostics.expectedTableRows === 2 &&
      adjacentSameProductImport.diagnostics.importedPositionCount === 2 &&
      adjacentSameProductImport.diagnostics.unimportedCandidateLines.length === 0 &&
      adjacentSameProductImport.issues.length === 0,
    JSON.stringify(adjacentSameProductImport)
  );

  const longWarehouseTaskImport = await parseWarehouseLongTaskFixture();
  check(
    "picking import reads Lageraufgabe table rows with long task numbers",
    longWarehouseTaskImport.parsed.lines.length === 1 &&
      longWarehouseTaskImport.parsed.lines[0]?.warehouseOrder === "20260625080515" &&
      longWarehouseTaskImport.parsed.lines[0]?.fromHandlingUnit === "340063810002111" &&
      longWarehouseTaskImport.parsed.lines[0]?.fromBin === "002-H4-SAA8C3" &&
      longWarehouseTaskImport.parsed.lines[0]?.product === "1063588" &&
      longWarehouseTaskImport.parsed.lines[0]?.targetQty === "938" &&
      longWarehouseTaskImport.parsed.lines[0]?.unit === "Stk" &&
      longWarehouseTaskImport.parsed.lines[0]?.toBin === "9021-0OUT" &&
      longWarehouseTaskImport.issues.length === 0,
    JSON.stringify(longWarehouseTaskImport)
  );

  const rawBinWarehouseImport = await parseWarehouseRawBinFixture();
  check(
    "picking import reads raw Von-Lagerplatz from the correct table column",
    rawBinWarehouseImport.parsed.lines.length === 2 &&
      rawBinWarehouseImport.parsed.lines.every((line) => line.product === "1060610") &&
      rawBinWarehouseImport.parsed.lines.every((line) => line.fromBin === "002-H3-SO4D1") &&
      rawBinWarehouseImport.parsed.lines.every((line) => line.toBin === "9021-0OUT") &&
      rawBinWarehouseImport.parsed.lines.some((line) => line.fromHandlingUnit === "340063810002072174") &&
      rawBinWarehouseImport.parsed.lines.some((line) => line.fromHandlingUnit === "340063810002072181") &&
      !JSON.stringify(rawBinWarehouseImport.parsed.lines).includes("002-H3-SOO4D1") &&
      rawBinWarehouseImport.issues.length === 0,
    JSON.stringify(rawBinWarehouseImport)
  );

  check(
    "picking import diagnostics expose raw and final source bins",
    rawBinWarehouseImport.diagnostics.length === 2 &&
      rawBinWarehouseImport.diagnostics.every((entry) => entry.rawFromBin === "002-H3-SO4D1") &&
      rawBinWarehouseImport.diagnostics.every((entry) => entry.finalFromBin === "002-H3-SO4D1") &&
      rawBinWarehouseImport.diagnostics.every((entry) => entry.changed === false) &&
      rawBinWarehouseImport.diagnostics.every((entry) => /Rohwert unveraendert/i.test(entry.reason || "")),
    JSON.stringify(rawBinWarehouseImport.diagnostics)
  );

  const diagnosticExpansion = await pickingDiagnosticExpansionFixture();
  check(
    "picking import diagnostics expose raw rows, parser path and field safety",
    diagnosticExpansion.diagnostics.parserPath === "lageraufgabe-normal-or-columns" &&
      diagnosticExpansion.diagnostics.expectedTableRows === 2 &&
      diagnosticExpansion.diagnostics.importedPositionCount === 2 &&
      diagnosticExpansion.diagnostics.positionFieldDiagnostics.length === 2 &&
      diagnosticExpansion.diagnostics.positionFieldDiagnostics[0]?.rawSegment.includes("002-H3-SO4D1") &&
      diagnosticExpansion.diagnostics.positionFieldDiagnostics[0]?.fieldSafety?.fromBin === "sicher" &&
      diagnosticExpansion.diagnostics.loadingSlipDiagnostics.detectedInSecondaryCandidate === true &&
      diagnosticExpansion.lineDiagnostics[0]?.parserPath === "lageraufgabe-normal-or-columns" &&
      diagnosticExpansion.lineDiagnostics[0]?.fieldSafety?.product === "sicher" &&
      !Object.prototype.hasOwnProperty.call(diagnosticExpansion.parsed.lines[0], "rawSegment") &&
      !Object.prototype.hasOwnProperty.call(diagnosticExpansion.parsed.lines[0], "fieldSafety"),
    JSON.stringify({
      diagnostics: diagnosticExpansion.diagnostics,
      lineDiagnostics: diagnosticExpansion.lineDiagnostics,
      parsedLine: diagnosticExpansion.parsed.lines[0]
    })
  );

  const suspiciousBinDiagnostic = await pickingSuspiciousBinDiagnosticFixture();
  check(
    "picking import diagnostics mark suspicious SSI source-bin shape without changing import value",
    suspiciousBinDiagnostic.parsed.lines[0]?.product === "806713" &&
      suspiciousBinDiagnostic.parsed.lines[0]?.fromBin === "002-H3-SOSA3" &&
      !String(suspiciousBinDiagnostic.parsed.lines[0]?.binWarning || "").trim() &&
      !Object.prototype.hasOwnProperty.call(suspiciousBinDiagnostic.parsed.lines[0], "fromBinSuggestedCandidates") &&
      suspiciousBinDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinShapeStatus === "suspicious" &&
      suspiciousBinDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinSuggestedCandidates.includes("002-H3-SO5A3") &&
      suspiciousBinDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinReviewRequired === true &&
      suspiciousBinDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinReviewBlocksRelease === true &&
      suspiciousBinDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinReviewBlocksExport === true &&
      suspiciousBinDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinManualCorrectionClearsWarning === true &&
      suspiciousBinDiagnostic.diagnostics.importWarningReasons.includes("verdaechtiger-von-lagerplatz") &&
      suspiciousBinDiagnostic.lineDiagnostics[0]?.fromBinShapeStatus === "suspicious" &&
      suspiciousBinDiagnostic.lineDiagnostics[0]?.fromBinSuggestedCandidates.includes("002-H3-SO5A3") &&
      suspiciousBinDiagnostic.lineDiagnostics[0]?.fromBinReviewRequired === true &&
      suspiciousBinDiagnostic.lineDiagnostics[0]?.fromBinReviewBlocksRelease === true &&
      suspiciousBinDiagnostic.lineDiagnostics[0]?.fromBinReviewBlocksExport === true &&
      suspiciousBinDiagnostic.lineDiagnostics[0]?.fromBinManualCorrectionClearsWarning === true &&
      suspiciousBinDiagnostic.lineDiagnostics[0]?.fieldSafety?.fromBin === "verdaechtig",
    JSON.stringify(suspiciousBinDiagnostic)
  );

  const suspiciousReviewLines = appParserContext.__applyFromBinReviewWarnings(suspiciousBinDiagnostic.parsed.lines);
  const correctedReviewLines = appParserContext.__applyFromBinReviewWarnings([
    { ...suspiciousReviewLines[0], fromBin: "002-H3-SO9A3" }
  ]);
  const confirmedReviewLines = appParserContext.__applyFromBinReviewWarnings([
    { ...suspiciousReviewLines[0], fromBinReviewConfirmedValue: "002-H3-SOSA3" }
  ]);
  const changedAfterConfirmReviewLines = appParserContext.__applyFromBinReviewWarnings([
    { ...confirmedReviewLines[0], fromBin: "002-H3-SOSB3" }
  ]);
  const multipleReviewLines = appParserContext.__applyFromBinReviewWarnings([
    { ...suspiciousReviewLines[0], id: "qa-review-a", fromBinReviewConfirmedValue: "002-H3-SOSA3" },
    { ...suspiciousReviewLines[0], id: "qa-review-b", fromBin: "002-H3-SOSB3", fromBinReviewConfirmedValue: "" }
  ]);
  const emptyReviewLine = { ...suspiciousReviewLines[0], fromBin: "", fromBinReviewConfirmedValue: "", fromBinReviewRequired: true };
  const pickedSuspiciousReviewLines = suspiciousReviewLines.map((line) => ({ ...line, picked: true }));
  const pickedCorrectedReviewLines = correctedReviewLines.map((line) => ({ ...line, picked: true }));
  const pickedConfirmedReviewLines = confirmedReviewLines.map((line) => ({ ...line, picked: true }));
  const pickedChangedAfterConfirmReviewLines = changedAfterConfirmReviewLines.map((line) => ({ ...line, picked: true }));
  const pickedMultipleReviewLines = multipleReviewLines.map((line) => ({ ...line, picked: true }));
  check(
    "picking import marks suspicious source bin for manual review and keeps raw value",
    suspiciousReviewLines[0]?.fromBin === "002-H3-SOSA3" &&
      suspiciousReviewLines[0]?.fromBinReviewRequired === true &&
      suspiciousReviewLines[0]?.fromBinReviewBlocksRelease === true &&
      suspiciousReviewLines[0]?.fromBinReviewBlocksExport === true &&
      suspiciousReviewLines[0]?.fromBinManualCorrectionClearsWarning === true &&
      suspiciousReviewLines[0]?.binWarningType === "from-bin-review" &&
      /OCR-unsicher: 002-H3-SOSA3/.test(suspiciousReviewLines[0]?.binWarning || "") &&
      appParserContext.__orderExportCompletionMessage({ lines: pickedSuspiciousReviewLines }) === appParserContext.__fromBinReviewBlockMessage(),
    JSON.stringify({
      reviewLine: suspiciousReviewLines[0],
      exportMessage: appParserContext.__orderExportCompletionMessage({ lines: pickedSuspiciousReviewLines })
    })
  );
  check(
    "manual source-bin correction clears OCR review warning without auto-changing import fields",
    correctedReviewLines[0]?.fromBin === "002-H3-SO9A3" &&
      correctedReviewLines[0]?.fromBinReviewRequired === false &&
      !String(correctedReviewLines[0]?.binWarning || "").trim() &&
      appParserContext.__orderExportCompletionMessage({ lines: pickedCorrectedReviewLines }) === "",
    JSON.stringify({
      correctedLine: correctedReviewLines[0],
      exportMessage: appParserContext.__orderExportCompletionMessage({ lines: pickedCorrectedReviewLines })
    })
  );
  check(
    "manual source-bin review confirmation clears only the unchanged confirmed bin block",
    suspiciousReviewLines[0]?.fromBin === "002-H3-SOSA3" &&
      appParserContext.__canConfirmFromBinReview(suspiciousReviewLines[0]) === true &&
      confirmedReviewLines[0]?.fromBin === "002-H3-SOSA3" &&
      confirmedReviewLines[0]?.fromBinReviewConfirmedValue === "002-H3-SOSA3" &&
      confirmedReviewLines[0]?.fromBinReviewRequired === false &&
      confirmedReviewLines[0]?.fromBinReviewBlocksRelease === false &&
      confirmedReviewLines[0]?.fromBinReviewBlocksExport === false &&
      !String(confirmedReviewLines[0]?.binWarning || "").trim() &&
      /manuell gepr/.test(confirmedReviewLines[0]?.fromBinReviewReason || "") &&
      appParserContext.__isFromBinReviewConfirmedForValue("002-H3-SOSA3", confirmedReviewLines[0]) === true &&
      appParserContext.__orderExportCompletionMessage({ lines: pickedConfirmedReviewLines }) === "",
    JSON.stringify({
      confirmedLine: confirmedReviewLines[0],
      exportMessage: appParserContext.__orderExportCompletionMessage({ lines: pickedConfirmedReviewLines })
    })
  );
  check(
    "manual source-bin review confirmation is invalidated when the source bin value changes",
    changedAfterConfirmReviewLines[0]?.fromBin === "002-H3-SOSB3" &&
      changedAfterConfirmReviewLines[0]?.fromBinReviewConfirmedValue === "" &&
      changedAfterConfirmReviewLines[0]?.fromBinReviewRequired === true &&
      changedAfterConfirmReviewLines[0]?.fromBinReviewBlocksRelease === true &&
      changedAfterConfirmReviewLines[0]?.fromBinReviewBlocksExport === true &&
      appParserContext.__isFromBinReviewConfirmedForValue("002-H3-SOSB3", changedAfterConfirmReviewLines[0]) === false &&
      appParserContext.__orderExportCompletionMessage({ lines: pickedChangedAfterConfirmReviewLines }) === appParserContext.__fromBinReviewBlockMessage(),
    JSON.stringify({
      changedLine: changedAfterConfirmReviewLines[0],
      exportMessage: appParserContext.__orderExportCompletionMessage({ lines: pickedChangedAfterConfirmReviewLines })
    })
  );
  check(
    "manual source-bin review confirmation does not clear other open review positions or empty bins",
    multipleReviewLines[0]?.fromBinReviewRequired === false &&
      multipleReviewLines[1]?.fromBinReviewRequired === true &&
      appParserContext.__orderExportCompletionMessage({ lines: pickedMultipleReviewLines }) === appParserContext.__fromBinReviewBlockMessage() &&
      appParserContext.__canConfirmFromBinReview(emptyReviewLine) === false,
    JSON.stringify({
      multipleReviewLines,
      emptyCanConfirm: appParserContext.__canConfirmFromBinReview(emptyReviewLine),
      exportMessage: appParserContext.__orderExportCompletionMessage({ lines: pickedMultipleReviewLines })
    })
  );

  const suspiciousBinWithoutRecheckDiagnostic = await pickingSuspiciousBinWithoutRecheckDiagnosticFixture();
  check(
    "picking import diagnostics keep suspicious source-bin review without cell recheck",
    suspiciousBinWithoutRecheckDiagnostic.parsed.lines[0]?.fromBin === "002-H3-SOSA3" &&
      !Object.prototype.hasOwnProperty.call(suspiciousBinWithoutRecheckDiagnostic.parsed.lines[0], "fromBinRecheckSuggestion") &&
      suspiciousBinWithoutRecheckDiagnostic.diagnostics.fromBinRechecks.length === 0 &&
      suspiciousBinWithoutRecheckDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinRecheckAttempted === false &&
      suspiciousBinWithoutRecheckDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinRecheckSuggestion === "" &&
      suspiciousBinWithoutRecheckDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinRecheckAutoApplied === false &&
      /Richtlinie deaktiviert/.test(suspiciousBinWithoutRecheckDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinRecheckReason || "") &&
      suspiciousBinWithoutRecheckDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinVisualRecheckAttempted === false &&
      suspiciousBinWithoutRecheckDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinVisualRecheckBestCandidate === "" &&
      suspiciousBinWithoutRecheckDiagnostic.diagnostics.positionFieldDiagnostics[0]?.fromBinReviewRequired === true &&
      suspiciousBinWithoutRecheckDiagnostic.lineDiagnostics[0]?.fromBinRecheckAttempted === false &&
      suspiciousBinWithoutRecheckDiagnostic.lineDiagnostics[0]?.fromBinRecheckSuggestion === "" &&
      /Richtlinie deaktiviert/.test(suspiciousBinWithoutRecheckDiagnostic.lineDiagnostics[0]?.fromBinRecheckReason || "") &&
      suspiciousBinWithoutRecheckDiagnostic.lineDiagnostics[0]?.fromBinVisualRecheckAttempted === false &&
      suspiciousBinWithoutRecheckDiagnostic.lineDiagnostics[0]?.fromBinVisualRecheckBestCandidate === "" &&
      suspiciousBinWithoutRecheckDiagnostic.lineDiagnostics[0]?.finalFromBin === "002-H3-SOSA3" &&
      suspiciousBinWithoutRecheckDiagnostic.lineDiagnostics[0]?.fromBinReviewRequired === true,
    JSON.stringify(suspiciousBinWithoutRecheckDiagnostic)
  );

  const ocrConfusedBinImport = await parseWarehouseOcrConfusedBinFixture();
  check(
    "picking import keeps OCR-confused SSI source bins unchanged",
    ocrConfusedBinImport.parsed.lines.length === 2 &&
      ocrConfusedBinImport.parsed.lines[0]?.fromBin === "002-H3-5010A2" &&
      ocrConfusedBinImport.parsed.lines[1]?.fromBin === "002-H3-5Z2D1" &&
      ocrConfusedBinImport.parsed.lines.every((line) => line.toBin === "9021-0OUT") &&
      ocrConfusedBinImport.parsed.lines.every((line) => !String(line.binWarning || "").trim()) &&
      ocrConfusedBinImport.issues.length === 0,
    JSON.stringify(ocrConfusedBinImport)
  );

  const ansbachDestinationImport = await parseWarehouseAnsbachDestinationFixture();
  check(
    "picking import trims OCR words after Ansbach destination bin",
    ansbachDestinationImport.parsed.lines.length === 2 &&
      ansbachDestinationImport.parsed.lines.every((line) => line.toBin === "9020-ANSBACH") &&
      ansbachDestinationImport.parsed.lines[0]?.targetQty === "633" &&
      ansbachDestinationImport.parsed.lines[1]?.targetQty === "250" &&
      !ansbachDestinationImport.parsed.lines.some((line) => /(?:\bCO\b|\bPA\b|ZOOS|633\s*$)/i.test(String(line.description || ""))),
    JSON.stringify(ansbachDestinationImport)
  );

  const inselDestinationImport = await parseWarehouseInselDestinationFixture();
  check(
    "picking import trims OCR words after Insel destination bin without changing quantity",
    inselDestinationImport.parsed.lines.length === 1 &&
      inselDestinationImport.parsed.lines[0]?.toBin === "9020-INSEL-ROTH" &&
      inselDestinationImport.parsed.lines[0]?.targetQty === "1.000" &&
      inselDestinationImport.parsed.lines[0]?.actualQty === "1.000",
    JSON.stringify(inselDestinationImport)
  );

  const mixedSsiDestinationImport = await parseWarehouseMixedSsiDestinationFixture();
  check(
    "picking import uses 9021-0OUT as customer when any destination matches",
    mixedSsiDestinationImport.parsed.customerName === "9021-0OUT" &&
      mixedSsiDestinationImport.parsed.customerGroupKey === "9021 0OUT" &&
      mixedSsiDestinationImport.parsed.lines.length === 2 &&
      mixedSsiDestinationImport.parsed.lines[0]?.autoPositionNotes?.destination === "9020-ANSBACH" &&
      !String(mixedSsiDestinationImport.parsed.lines[1]?.autoPositionNotes?.destination || "").trim(),
    JSON.stringify(mixedSsiDestinationImport.parsed)
  );

  const mixedNonSsiDestinationImport = await parseWarehouseMixedNonSsiDestinationFixture();
  check(
    "picking import keeps first destination customer when no 9021-0OUT is present",
    mixedNonSsiDestinationImport.parsed.customerName === "9020-ANSBACH" &&
      mixedNonSsiDestinationImport.parsed.customerGroupKey === "9020 ANSBACH" &&
      mixedNonSsiDestinationImport.parsed.lines.length === 2 &&
      !String(mixedNonSsiDestinationImport.parsed.lines[0]?.autoPositionNotes?.destination || "").trim() &&
      mixedNonSsiDestinationImport.parsed.lines[1]?.autoPositionNotes?.destination === "9030-KUNDE",
    JSON.stringify(mixedNonSsiDestinationImport.parsed)
  );

  const pickingImportSource = extractFunctionSource(appSource, "async function chooseBestImportText");
  const pickingCandidateSource = extractFunctionSource(appSource, "async function buildPickingImportCandidate");
  const pickingOcrReaderSource = extractFunctionSource(appSource, "async function readPickingPdfWithOcrCandidate");
  const pickingOcrCandidateSetSource = extractFunctionSource(appSource, "async function readPickingPdfOcrCandidateSet");
  const pickingOcrScoreSource = extractFunctionSource(appSource, "function scorePickingOcrCandidate");
  const pickingDiagnosticsSource = extractFunctionSource(importDiagnosticsSource, "function pickingImportDiagnostics");
  const loadingSlipFallbackSource = extractFunctionSource(appSource, "async function readLoadingSlipOcrFallbackIfNeeded");
  const pickingNoCellRecheckSource = extractFunctionSource(appSource, "function pickingOcrSelectionWithoutFromBinCellRecheck");
  const fromBinCellRecheckSetSource = extractFunctionSource(appSource, "async function readPickingFromBinCellRechecks(");
  const fromBinCellRecheckSource = extractFunctionSource(appSource, "async function readPickingFromBinCellRecheck(");
  const loadingSlipRenderSource = extractFunctionSource(appSource, "function renderLoadingSlipLine");
  const removeClosestLabelOrElementSource = extractFunctionSource(appSource, "function removeClosestLabelOrElement");
  const storageImportSource = extractFunctionSource(appSource, "async function chooseBestStorageImportText");
  const stockEnrichmentSource = extractFunctionSource(appSource, "async function applyStorageBinsFromArticleStock");
  const loadingSlipCleanupGuard = await loadingSlipCleanupGuardFixture();
  check(
    "picking loading-slip render cleanup tolerates missing optional label elements",
    loadingSlipCleanupGuard.nullSafe === true &&
      loadingSlipCleanupGuard.noLabelRemovedElement === true &&
      loadingSlipCleanupGuard.labelRemovedContainer === true &&
      loadingSlipCleanupGuard.noStateMutation === true &&
      loadingSlipCleanupGuard.noLocalStorageWrites === true &&
      loadingSlipRenderSource.includes("removeClosestLabelOrElement(map.actualQty)") &&
      loadingSlipRenderSource.includes("removeClosestLabelOrElement(map.unit)") &&
      loadingSlipRenderSource.includes("removeClosestLabelOrElement(map.fromHandlingUnit)") &&
      !loadingSlipRenderSource.includes('.closest("label").remove()') &&
      removeClosestLabelOrElementSource.includes('typeof element.closest === "function"') &&
      removeClosestLabelOrElementSource.includes('typeof target.remove !== "function"') &&
      importDiagnosticsSource.includes("logPickingImportDiagnostics"),
    JSON.stringify(loadingSlipCleanupGuard)
  );
  check(
    "picking PDF import keeps OCR scoring and permits SI Bestellschein PDF text",
    pickingImportSource.includes("readPickingPdfWithOcrCandidate(pdf,") &&
      pickingImportSource.includes("imageOnlyPdf") &&
      pickingImportSource.includes("isAcceptedSiBestellscheinImportCandidate") &&
      pickingImportSource.includes("isAcceptedPdfTextImportCandidate") &&
      pickingImportSource.includes("pdf-text") &&
      pickingImportSource.includes("chooseBestPickingImportCandidate"),
    pickingImportSource
  );
  check(
    "picking PDF import evaluates multiple OCR scale and rotation candidates",
    appSource.includes("PICKING_OCR_SCALE_CANDIDATES") &&
      appSource.includes("PICKING_OCR_UPRIGHT_ROTATIONS") &&
      pickingOcrReaderSource.includes("readPickingPdfOcrCandidateSet") &&
      pickingOcrReaderSource.includes("isFastAcceptedPickingOcrCandidate") &&
      pickingOcrReaderSource.includes("isStableUprightPickingOcrResult") &&
      pickingOcrReaderSource.includes("readLoadingSlipOcrFallbackIfNeeded") &&
      appSource.includes("PICKING_OCR_FAST_ACCEPT_SCORE") &&
      pickingOcrReaderSource.includes("createOcrWorker") &&
      pickingOcrReaderSource.includes("candidateMap") &&
      pickingOcrReaderSource.includes("createPickingOcrBudget") &&
      pickingOcrReaderSource.includes("shouldRunPickingRotationFallback") &&
      pickingOcrReaderSource.includes("worker.terminate") &&
      pickingOcrCandidateSetSource.includes("candidateMap") &&
      pickingOcrCandidateSetSource.includes("rotationCandidates") &&
      pickingOcrCandidateSetSource.includes("processedPages") &&
      pickingOcrCandidateSetSource.includes("assertPickingOcrBudget") &&
      appSource.includes("pickingOcrCandidateDiagnostic"),
    `${pickingOcrReaderSource}\n${pickingOcrCandidateSetSource}`
  );
  check(
    "picking PDF import checks precise upright OCR before rotation fallback",
    pickingOcrReaderSource.includes("uprightResult") &&
      pickingOcrReaderSource.includes("rotations-fallback") &&
      pickingOcrReaderSource.includes("const preciseResult") &&
      pickingOcrReaderSource.includes("shouldRunPickingRotationFallback") &&
      pickingOcrReaderSource.includes("const fallbackRotations") &&
      pickingOcrReaderSource.includes("const fullResult") &&
      pickingOcrReaderSource.indexOf("const preciseResult") < pickingOcrReaderSource.indexOf("shouldRunPickingRotationFallback") &&
      pickingOcrReaderSource.indexOf("shouldRunPickingRotationFallback") < pickingOcrReaderSource.indexOf("const fallbackRotations") &&
      pickingOcrReaderSource.indexOf("const fallbackRotations") < pickingOcrReaderSource.indexOf("const fullResult"),
    pickingOcrReaderSource
  );
  check(
    "picking PDF import can scan rotations only for loading slips",
    loadingSlipFallbackSource.includes("shouldRunLoadingSlipOcrFallback") &&
      loadingSlipFallbackSource.includes("readPickingPdfOcrCandidateSet") &&
      loadingSlipFallbackSource.includes("PICKING_OCR_LOADING_SLIP_ROTATIONS") &&
      loadingSlipFallbackSource.includes("ladeliste-gezielt") &&
      loadingSlipFallbackSource.includes("loadingSlipWarning") &&
      appSource.includes("collectLoadingSlipLinesFromOcrCandidates") &&
      appSource.includes("appendLoadingSlipLinesToParsed"),
    loadingSlipFallbackSource
  );
  check(
    "picking PDF import has adaptive OCR budget diagnostics",
    appSource.includes("PICKING_OCR_MAX_STEPS") &&
      appSource.includes("PICKING_OCR_MAX_MS") &&
      appSource.includes("ocrSkippedSteps") &&
      appSource.includes("ocrBudget") &&
      appSource.includes("budgetExceeded") &&
      pickingDiagnosticsSource.includes("ocrStepCount") &&
      pickingDiagnosticsSource.includes("ocrSkippedSteps") &&
      pickingDiagnosticsSource.includes("ocrBudget") &&
      pickingDiagnosticsSource.includes("ocrAbortReason"),
    `${pickingOcrReaderSource}\n${pickingDiagnosticsSource}`
  );
  check(
    "storage PDF import accepts clean PDF text before OCR",
    storageImportSource.includes("isAcceptedStoragePdfTextImportCandidate") &&
      storageImportSource.includes("readPdfWithOcr") &&
      storageImportSource.indexOf("isAcceptedStoragePdfTextImportCandidate") < storageImportSource.indexOf("readPdfWithOcr"),
    storageImportSource
  );
  check(
    "picking PDF import scores OCR candidates with measurable table quality",
    pickingOcrScoreSource.includes("completeRequiredCount") &&
      pickingOcrScoreSource.includes("bestellscheinCompleteCount") &&
      pickingOcrScoreSource.includes("missingFromBinCount") &&
      pickingOcrScoreSource.includes("suspiciousSourceFieldCount") &&
      pickingOcrScoreSource.includes("discardedRows"),
    pickingOcrScoreSource
  );
  check(
    "picking PDF import diagnostics expose candidate scores",
    pickingDiagnosticsSource.includes("selectedCandidate") &&
      pickingDiagnosticsSource.includes("ocrCandidates") &&
      pickingDiagnosticsSource.includes("loadingSlipCandidates") &&
      pickingDiagnosticsSource.includes("loadingSlipAttached") &&
      pickingDiagnosticsSource.includes("qualityScore") &&
      pickingDiagnosticsSource.includes("qualityAccepted") &&
      pickingDiagnosticsSource.includes("parserPath") &&
      pickingDiagnosticsSource.includes("positionFieldDiagnostics") &&
      pickingDiagnosticsSource.includes("imageOnlyPdf") &&
      pickingDiagnosticsSource.includes("orientationProbeAttempted") &&
      pickingDiagnosticsSource.includes("orientationProbeCandidates") &&
      pickingDiagnosticsSource.includes("selectedOrientation") &&
      pickingDiagnosticsSource.includes("bestellscheinPageNotice") &&
      pickingDiagnosticsSource.includes("siBestellscheinAccepted") &&
      importDiagnosticsSource.includes("fromBinShapeStatus") &&
      importDiagnosticsSource.includes("pickingFromBinShapeDiagnostic") &&
      importDiagnosticsSource.includes("fromBinSuggestedCandidates") &&
      importDiagnosticsSource.includes("fromBinReviewRequired") &&
      importDiagnosticsSource.includes("fromBinReviewBlocksRelease") &&
      importDiagnosticsSource.includes("fromBinReviewBlocksExport") &&
      importDiagnosticsSource.includes("fromBinManualCorrectionClearsWarning") &&
      importDiagnosticsSource.includes("fromBinRecheckAttempted") &&
      importDiagnosticsSource.includes("fromBinRecheckCandidates") &&
      importDiagnosticsSource.includes("fromBinRecheckSuggestion") &&
      importDiagnosticsSource.includes("fromBinVisualRecheckAttempted") &&
      importDiagnosticsSource.includes("fromBinVisualRecheckBestCandidate") &&
      pickingDiagnosticsSource.includes("fromBinRechecks") &&
      pickingDiagnosticsSource.includes("loadingSlipDiagnostics") &&
      pickingDiagnosticsSource.includes("loadingSlipFallbackStatus") &&
      pickingDiagnosticsSource.includes("importWarningReasons"),
    pickingDiagnosticsSource
  );
  check(
    "picking UI blocks release and PDF export while OCR source-bin review is open",
    appSource.includes("FROM_BIN_REVIEW_BLOCK_MESSAGE") &&
      appSource.includes("fromBinReviewPatchForValue") &&
      appSource.includes("applyFromBinReviewWarnings") &&
      appSource.includes("hasOpenFromBinReviewWarnings") &&
      appSource.includes("fromBinReviewBlockMessage") &&
      appSource.includes("fromBinReviewConfirmedValue") &&
      appSource.includes("isFromBinReviewConfirmedForValue") &&
      appSource.includes("Stellplatz geprüft") &&
      appSource.includes("Export/Freigabe gesperrt: OCR-unsichere Von-Lagerplätze prüfen."),
    "source-bin review block markers missing"
  );
  check(
    "picking PDF import has targeted SI Bestellschein orientation probe",
    appSource.includes("readSiBestellscheinOrientationProbe") &&
      appSource.includes("SI_BESTELLSCHEIN_ORIENTATION_PROBE_ROTATIONS") &&
      appSource.includes("selectSiBestellscheinOrientationCandidate") &&
      appSource.includes("selectedOrientation") &&
      appSource.includes("siBestellscheinAccepted") &&
      appSource.includes("PDF enthaelt"),
    "SI Bestellschein orientation probe markers missing"
  );
  check(
    "picking PDF import disables source-bin OCR cell recheck",
    pickingOcrReaderSource.includes("pickingOcrSelectionWithoutFromBinCellRecheck") &&
      !pickingOcrReaderSource.includes("readPickingFromBinCellRechecks") &&
      !pickingOcrReaderSource.includes("enrichPickingOcrSelectionWithFromBinRechecks") &&
      !appSource.includes("OCR Zell-Recheck Von-Lagerplatz") &&
      pickingNoCellRecheckSource.includes("selection.fromBinRechecks = []") &&
      fromBinCellRecheckSetSource.includes("return [];") &&
      fromBinCellRecheckSource.includes('method: "disabled"') &&
      fromBinCellRecheckSource.includes("durch Richtlinie deaktiviert") &&
      !fromBinCellRecheckSource.includes("worker.recognize") &&
      countSourceOccurrences(appSource, "readPickingFromBinCellRechecks(") === 1 &&
      countSourceOccurrences(appSource, "readPickingFromBinCellRecheck(") === 1 &&
      importDiagnosticsSource.includes("fromBinRecheckAutoApplied: false") &&
      importDiagnosticsSource.includes("fromBinVisualRecheckAutoApplied: false"),
    `${pickingOcrReaderSource}\n${pickingNoCellRecheckSource}\n${fromBinCellRecheckSetSource}\n${fromBinCellRecheckSource}`
  );
  check(
    "picking PDF import disables source-bin repair scan",
    pickingCandidateSource.includes("disabled: true") &&
      pickingCandidateSource.includes("Keine Stellplatzvalidierung oder -korrektur") &&
      !pickingCandidateSource.includes("refinePickingBinsWithPreciseScan"),
    pickingCandidateSource
  );
  check(
    "picking source-bin review uses shared browser storage-bin rules",
    appSource.includes("HLogistikStorageBinRules") &&
      importDiagnosticsSource.includes("storageBinRules") &&
      storageBinRulesSource.includes("normalizeSsiStorageBin") &&
      storageBinRulesSource.includes("002-H7-S") &&
      storageBinRulesSource.includes("pickingFromBinShapeDiagnostic"),
    "shared storage-bin rule markers missing"
  );
  check(
    "picking stock enrichment only fills source bin through gated SI system-fill path",
    stockEnrichmentSource.includes("allowSiFromBinFill") &&
      stockEnrichmentSource.includes("currentOrderWarehouse() === \"SI\"") &&
      stockEnrichmentSource.includes("siSystemFromBinPatchForLine") &&
      stockEnrichmentSource.includes("fromBin: line.fromBin"),
    stockEnrichmentSource
  );

  const noPositionImport = await importNoPositionPickingFixture();
  check(
    "picking import without positions keeps current state untouched",
    noPositionImport.result.cancelled === true &&
      noPositionImport.result.type === "error" &&
      noPositionImport.after.orderNumber === noPositionImport.before.orderNumber &&
      noPositionImport.after.customerName === noPositionImport.before.customerName &&
      noPositionImport.after.lineCount === noPositionImport.before.lineCount,
    JSON.stringify(noPositionImport)
  );

  check(
    "picking import order hint fixture still parses positions",
    orderHintSameLine.lines.length >= 1 && JSON.stringify(orderHintSameLine.lines).includes("123456") && JSON.stringify(orderHintSameLine.lines).includes("5"),
    JSON.stringify(orderHintSameLine.lines)
  );

  const serverOrderHintNumber = `QA-HINT-${suffix}`;
  const serverOrderHintCreate = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({
      orderNumber: serverOrderHintNumber,
      customerName: "QA Importkunde",
      customerGroupKey: "QA IMPORTKUNDE",
      orderDate: "2026-06-23",
      orderTime: "10:10",
      orderType: "picking",
      rawText: pickingTextFixture("Bestellhinweis:\nService Ecke", serverOrderHintNumber),
      lines: [{
        position: "1",
        product: "123456",
        description: "Serviceartikel",
        targetQty: "5",
        actualQty: "5",
        unit: "ST",
        fromBin: "",
        fromHandlingUnit: "",
        toBin: "",
        picked: false,
        positionNote: ""
      }]
    })
  });
  const serverOrderHintId = serverOrderHintCreate.body.order?.id;
  check(
    "server appends order hint from raw text",
    serverOrderHintCreate.status === 200 && serverOrderHintCreate.body.order?.orderNumber === `${serverOrderHintNumber}-Service Ecke`,
    `${serverOrderHintCreate.status} ${JSON.stringify(serverOrderHintCreate.body)}`
  );
  if (serverOrderHintId) {
    await request(`/api/orders/${encodeURIComponent(serverOrderHintId)}`, {
      method: "DELETE",
      headers: ROLE_HEADERS
    });
  }

  const duplicateImportBase = {
    customerName: "QA Importkunde",
    customerGroupKey: "QA IMPORTKUNDE",
    orderDate: "2026-06-23",
    orderTime: "10:10",
    orderType: "picking",
    lines: [{
      position: "1",
      product: `QA-DUP-${suffix}`,
      description: "QA Dublettenpruefung",
      targetQty: "1",
      actualQty: "1",
      unit: "ST",
      fromBin: "002-H3-QA1",
      fromHandlingUnit: "",
      toBin: "9020-QA",
      picked: false,
      positionNote: ""
    }]
  };
  const uniqueOrderA = {
    ...duplicateImportBase,
    orderNumber: `QA-DUP-A-${suffix}`,
    rawText: "Gemeinsamer Importrohtext"
  };
  const uniqueOrderB = {
    ...duplicateImportBase,
    orderNumber: `QA-DUP-B-${suffix}`,
    rawText: "Gemeinsamer Importrohtext"
  };
  const uniqueOrderCreateA = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(uniqueOrderA)
  });
  const uniqueOrderCreateB = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(uniqueOrderB)
  });
  const uniqueOrderRepeatB = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(uniqueOrderB)
  });
  const reusableXlsxLegacy = {
    ...duplicateImportBase,
    orderNumber: "SSI",
    rawText: "XLSX-Blatt Data",
    lines: [{
      ...duplicateImportBase.lines[0],
      warehouseOrder: `QA-OLD-${suffix}`,
      product: `QA-OLD-${suffix}`,
      toBin: "9021-0OUT"
    }]
  };
  const reusableXlsxNew = {
    ...duplicateImportBase,
    orderNumber: "SSI",
    rawText: `XLSX-Blatt Data\nXLSX-Fingerprint: qa${suffix}\nQA-NEW-${suffix} | 002-H3-QA2 | QA-NEW-${suffix} | 1 | ST | 9021-0OUT`,
    lines: [{
      ...duplicateImportBase.lines[0],
      warehouseOrder: `QA-NEW-${suffix}`,
      product: `QA-NEW-${suffix}`,
      fromBin: "002-H3-QA2",
      toBin: "9021-0OUT"
    }]
  };
  const reusableXlsxLegacyCreate = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(reusableXlsxLegacy)
  });
  const reusableXlsxProbe = await request(`/api/orders/duplicate-check?orderType=picking&fingerprint=${encodeURIComponent(reusableXlsxNew.rawText)}`);
  const reusableXlsxCreate = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(reusableXlsxNew)
  });
  const reusableXlsxRepeat = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(reusableXlsxNew)
  });
  check(
    "picking import deduplication accepts distinct orders and blocks only the same import",
    uniqueOrderCreateA.status === 200 &&
      uniqueOrderCreateB.status === 200 &&
      uniqueOrderRepeatB.status === 409 &&
      reusableXlsxLegacyCreate.status === 200 &&
      reusableXlsxProbe.status === 200 &&
      reusableXlsxProbe.body?.duplicate === false &&
      reusableXlsxCreate.status === 200 &&
      reusableXlsxRepeat.status === 409,
    JSON.stringify({
      unique: [uniqueOrderCreateA.status, uniqueOrderCreateB.status, uniqueOrderRepeatB.status],
      reusableXlsx: [reusableXlsxLegacyCreate.status, reusableXlsxProbe.status, reusableXlsxProbe.body, reusableXlsxCreate.status, reusableXlsxRepeat.status]
    })
  );
  for (const id of [
    uniqueOrderCreateA.body?.order?.id,
    uniqueOrderCreateB.body?.order?.id,
    reusableXlsxLegacyCreate.body?.order?.id,
    reusableXlsxCreate.body?.order?.id
  ].filter(Boolean)) {
    await request(`/api/orders/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: ROLE_HEADERS
    });
  }

  for (const path of ["/", "/order-hint-rules.js", "/shared/storage-hu-rules.js", "/shared/manual-storage-rules.js", "/app-import-line-helpers.js", "/app-import-diagnostics.js", "/app-state-helpers.js", "/app-ui-helpers.js", "/app-picking-parser.js", "/tablet.html", "/lager.html", "/artikel.html", "/auswertungen.html", "/api/health"]) {
    const response = await request(path);
    check(`static ${path}`, response.status === 200, `${response.status}`);
  }

  const tabletLegacySource = await readFile(new URL("../tablet-legacy.js", import.meta.url), "utf8");
  const tabletModernSource = await readFile(new URL("../tablet.js", import.meta.url), "utf8");
  const tabletCssSource = await readFile(new URL("../tablet.css", import.meta.url), "utf8");
  const serviceWorkerSource = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
  const manifestSource = await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8");
  const exportSource = await readFile(new URL("../server/export.mjs", import.meta.url), "utf8");
  const indexHtmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const tabletHtmlSource = await readFile(new URL("../tablet.html", import.meta.url), "utf8");
  const articleHtmlSource = await readFile(new URL("../artikel.html", import.meta.url), "utf8");
  const articleJsSource = await readFile(new URL("../artikel.js", import.meta.url), "utf8");
  const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const storageSource = await readFile(new URL("../server/storage.mjs", import.meta.url), "utf8");
  const tabletLegacyServiceWorkerSource = extractFunctionSource(tabletLegacySource, "function registerTabletServiceWorker(");
  const tabletModernServiceWorkerSource = extractFunctionSource(tabletModernSource, "function registerTabletServiceWorker(");
  const duplicateImportSource = extractFunctionSource(appSource, "async function findDuplicateOrderForImport(");
  check(
    "tablet legacy detail loader validates complete orders without unsupported iPad syntax",
    tabletLegacySource.includes("function isCompleteOrderDetail(order, id)") &&
      tabletLegacySource.includes("function handleOrderLoadFailure(message)") &&
      tabletLegacySource.includes("isCompleteOrderDetail(cached, id)") &&
      tabletLegacySource.includes("xhr.onerror") &&
      tabletLegacySource.includes("xhr.ontimeout") &&
      !/=>|\?\.|\?\?|\basync\b|\bawait\b|\bconst\b|\blet\b/.test(tabletLegacySource),
    "legacy detail validation and Safari syntax"
  );
  check(
    "picking import duplicate preflight delegates one matching rule to the server",
    duplicateImportSource.includes('const fingerprint = checkOrderNumber ? "" : orderFingerprint(text);') &&
      duplicateImportSource.includes("/api/orders/duplicate-check?") &&
      !duplicateImportSource.includes("/api/orders?includeExported=1") &&
      serverSource.includes("if (checkOrderNumber) {") &&
      serverSource.includes("const fingerprint = orderFingerprint(order.rawText);"),
    duplicateImportSource
  );
  check(
    "tablet PWA update hardening is explicit, versioned and non-disruptive",
    tabletLegacyServiceWorkerSource.includes("updateViaCache: \"none\"") &&
      tabletModernServiceWorkerSource.includes("updateViaCache: \"none\"") &&
      countSourceOccurrences(tabletLegacyServiceWorkerSource, "registration.update()") === 1 &&
      countSourceOccurrences(tabletModernServiceWorkerSource, "registration.update()") === 1 &&
      tabletHtmlSource.includes("tablet-legacy.js?v=20260721-2") &&
      tabletHtmlSource.includes("tablet.css?v=20260720-1") &&
      serviceWorkerSource.includes("const CACHE_VERSION = \"1.5.192\"") &&
      manifestSource.includes("\"version\": \"1.5.192\"") &&
      !tabletLegacyServiceWorkerSource.includes("location.reload") &&
      !tabletModernServiceWorkerSource.includes("location.reload") &&
      !tabletLegacyServiceWorkerSource.includes("unregister") &&
      !tabletModernServiceWorkerSource.includes("unregister") &&
      !tabletLegacyServiceWorkerSource.includes("setInterval") &&
      !tabletModernServiceWorkerSource.includes("setInterval") &&
      countSourceOccurrences(serviceWorkerSource, "caches.delete(") === 1 &&
      countSourceOccurrences(serviceWorkerSource, "skipWaiting()") === 2 &&
      !tabletLegacySource.includes("indexedDB.deleteDatabase") &&
      !tabletModernSource.includes("indexedDB.deleteDatabase"),
    JSON.stringify({
      legacy: tabletLegacyServiceWorkerSource,
      modern: tabletModernServiceWorkerSource,
      cacheVersion: serviceWorkerSource.match(/CACHE_VERSION\s*=\s*"([^"]+)"/)?.[1] || "",
      manifestVersion: JSON.parse(manifestSource).version,
      legacyAsset: tabletHtmlSource.match(/tablet-legacy\.js\?v=[^"]+/)?.[0] || ""
    })
  );
  check(
    "tablet picking columns leave room for six-digit target and actual quantities",
    /\.pick-column-grid span:nth-child\(3\),\s*\.line-top label:nth-child\(3\)\s*\{\s*width: 25%;\s*\}/.test(tabletCssSource) &&
      /\.pick-column-grid span:nth-child\(4\),\s*\.line-top label:nth-child\(4\),\s*\.pick-column-grid span:nth-child\(5\),\s*\.line-top label:nth-child\(5\)\s*\{\s*width: 14%;\s*\}/.test(tabletCssSource),
    "description=25%, target=14%, actual=14%"
  );
  check(
    "quantity and picking XLSX browser modules load before their consumers",
    indexHtmlSource.indexOf("shared/quantity-format.js") < indexHtmlSource.indexOf("app.js") &&
      indexHtmlSource.indexOf("app-picking-xlsx-import.js") < indexHtmlSource.indexOf("app.js") &&
      tabletHtmlSource.indexOf("shared/quantity-format.js") < tabletHtmlSource.indexOf("tablet-legacy.js"),
    "browser module order"
  );
  check(
    "XLSX draft exposes the loading-slip PDF chooser without changing normal actions",
    indexHtmlSource.includes('id="loadingSlipPdfInput"') &&
      indexHtmlSource.includes('accept=".pdf,application/pdf"') &&
      appSource.includes("handleSaveOrderButtonClick") &&
      appSource.includes("handleLoadingSlipPdfUpload") &&
      appSource.includes("canAppendLoadingSlipToXlsxDraft") &&
      storageSource.includes('if (line?.lineType === "loading-slip") return;') &&
      appSource.includes("refreshOrdersButton") &&
      appSource.includes("discardDraftButton") &&
      appSource.includes("releaseOrderButton"),
    "loading-slip XLSX draft controls"
  );
  check(
    "desktop and both tablet clients share quantity display rules",
    appSource.includes("HLogistikQuantityFormat?.displayLineQuantity") &&
      tabletModernSource.includes("HLogistikQuantityFormat?.displayLineQuantity") &&
      tabletLegacySource.includes("HLogistikQuantityFormat.displayLineQuantity"),
    "shared quantity formatter markers"
  );
  check(
    "short picking bin display keeps full value for DOM synchronization",
    appSource.includes("map.fromBin.dataset.fullValue") &&
      appSource.includes("binInput.readOnly && binInput.dataset.fullValue") &&
      appSource.includes("? binInput.dataset.fullValue"),
    "full source-bin preservation markers"
  );
  check(
    "SI article UI enforces preview and exact confirmation before replace",
    articleHtmlSource.includes("siStockImportPanel") &&
      articleHtmlSource.includes(SI_STOCK_REPLACE_CONFIRMATION) &&
      articleJsSource.includes("currentWarehouse() === \"SI\"") &&
      articleJsSource.includes("/api/articles/si-stock-import/preview") &&
      articleJsSource.includes("/api/articles/si-stock-import/replace") &&
      articleJsSource.indexOf("previewSiStockImportFile") < articleJsSource.indexOf("replaceSiStockImport"),
    "SI article UI markers"
  );
  check(
    "SI API routes are role-gated, warehouse-gated and use dedicated body limit",
    serverSource.includes("siStockImportMaxBodyBytes = 25 * 1024 * 1024") &&
      countSourceOccurrences(serverSource, "requireSiWarehouse(warehouse)") === 3 &&
      serverSource.includes("previewSiStockImportRows(body)") &&
      serverSource.includes("replaceSiStockImportRows(body") &&
      serverSource.indexOf("requireGroup(request, ROLE_PERMISSIONS.articleMutation)", serverSource.indexOf("/api/articles/si-stock-import/preview")) > 0,
    "SI route guard markers"
  );
  check(
    "tablet export scripts require online save and export guard",
      tabletLegacySource.includes("allowOffline: false") &&
      tabletLegacySource.includes("CONNECTION_CHECK_MS") &&
      tabletLegacySource.includes("startConnectionMonitor") &&
      tabletLegacySource.includes("ensureServerOnlineForPdf") &&
      tabletLegacySource.indexOf("return saveOrderToOfflineStore(currentOrder)") < tabletLegacySource.indexOf("OfflineStore.enqueue(\"PUT\"") &&
      tabletLegacySource.includes("exportingPdf") &&
      tabletLegacySource.includes("reloadCurrentOrderFromServer") &&
      tabletLegacySource.includes("var exportOrderId = currentOrder.id") &&
      tabletLegacySource.indexOf("return exportCurrentOrderPdfOnServer();") < tabletLegacySource.indexOf("removeQueuedOrderMutations(exportOrderId)") &&
      tabletModernSource.includes("allowOffline: false") &&
      tabletModernSource.includes("CONNECTION_CHECK_MS") &&
      tabletModernSource.includes("startConnectionMonitor") &&
      tabletModernSource.includes("ensureServerOnlineForPdf") &&
      tabletModernSource.indexOf("await saveOrderToOfflineStore(currentOrder)") < tabletModernSource.indexOf("await OfflineStore.enqueue(\"PUT\"") &&
      tabletModernSource.includes("exportingPdf") &&
      tabletModernSource.includes("reloadCurrentOrderFromServer") &&
      tabletModernSource.includes("const exportOrderId = currentOrder.id") &&
      tabletModernSource.indexOf("/export-pdf") < tabletModernSource.indexOf("removeQueuedOrderMutations(exportOrderId)"),
    JSON.stringify({
      legacyAllowOfflineFalse: tabletLegacySource.includes("allowOffline: false"),
      legacyConnectionMonitor: tabletLegacySource.includes("CONNECTION_CHECK_MS") && tabletLegacySource.includes("startConnectionMonitor"),
      legacyReconnectBeforePdfError: tabletLegacySource.includes("ensureServerOnlineForPdf"),
      legacyLocalSaveBeforeQueue: tabletLegacySource.indexOf("return saveOrderToOfflineStore(currentOrder)") < tabletLegacySource.indexOf("OfflineStore.enqueue(\"PUT\""),
      legacyExportGuard: tabletLegacySource.includes("exportingPdf"),
      legacyCleanupAfterExport: tabletLegacySource.indexOf("return exportCurrentOrderPdfOnServer();") < tabletLegacySource.indexOf("removeQueuedOrderMutations(exportOrderId)"),
      modernAllowOfflineFalse: tabletModernSource.includes("allowOffline: false"),
      modernConnectionMonitor: tabletModernSource.includes("CONNECTION_CHECK_MS") && tabletModernSource.includes("startConnectionMonitor"),
      modernReconnectBeforePdfError: tabletModernSource.includes("ensureServerOnlineForPdf"),
      modernLocalSaveBeforeQueue: tabletModernSource.indexOf("await saveOrderToOfflineStore(currentOrder)") < tabletModernSource.indexOf("await OfflineStore.enqueue(\"PUT\""),
      modernExportGuard: tabletModernSource.includes("exportingPdf"),
      modernCleanupAfterExport: tabletModernSource.indexOf("/export-pdf") < tabletModernSource.indexOf("removeQueuedOrderMutations(exportOrderId)")
    })
  );
  check(
    "server export verifies temporary PDF and XLSX before final artifacts",
    exportSource.includes("assertExportArtifactCreated(tempPdfPath, \"PDF\")") &&
      exportSource.includes("exportOrderExcel(order, tempXlsxPath") &&
      exportSource.includes("assertExportArtifactCreated(tempXlsxPath, \"Excel-Datei\")") &&
      exportSource.includes("stat(filePath)") &&
      exportSource.includes("wurde nicht erstellt") &&
      exportSource.indexOf("await run(browser") < exportSource.indexOf("await assertExportArtifactCreated(tempPdfPath, \"PDF\")") &&
      exportSource.indexOf("await assertExportArtifactCreated(tempPdfPath, \"PDF\")") < exportSource.indexOf("await exportOrderExcel(order, tempXlsxPath") &&
      exportSource.indexOf("await assertExportArtifactCreated(tempXlsxPath, \"Excel-Datei\")") < exportSource.indexOf("await copyFile(tempPdfPath, pdfPath)") &&
      exportSource.indexOf("await copyFile(tempXlsxPath, xlsxPath)") < exportSource.indexOf("return {"),
    JSON.stringify({
      checksTempPdf: exportSource.includes("assertExportArtifactCreated(tempPdfPath, \"PDF\")"),
      checksTempXlsx: exportSource.includes("assertExportArtifactCreated(tempXlsxPath, \"Excel-Datei\")"),
      writesXlsx: exportSource.includes("exportOrderExcel(order, tempXlsxPath"),
      checksFileStats: exportSource.includes("stat(filePath)"),
      checksAfterBrowserRun: exportSource.indexOf("await run(browser") < exportSource.indexOf("await assertExportArtifactCreated(tempPdfPath, \"PDF\")"),
      copiesAfterChecks: exportSource.indexOf("await assertExportArtifactCreated(tempXlsxPath, \"Excel-Datei\")") < exportSource.indexOf("await copyFile(tempPdfPath, pdfPath)"),
      checksBeforeReturn: exportSource.indexOf("await copyFile(tempXlsxPath, xlsxPath)") < exportSource.indexOf("return {")
    })
  );
  check(
    "manual storage create fields keep an empty common bin and quantity explicit",
    indexHtmlSource.includes("manualStorageQuantityInput") &&
      tabletHtmlSource.includes("manualStorageQuantityInput") &&
      appSource.includes("manualStorageQuantityInput") &&
      appSource.includes("fromBin: options.fromBin || \"\"") &&
      !appSource.includes("preset.fromBin") &&
      tabletModernSource.includes("manualStorageQuantityInput") &&
      tabletModernSource.includes("fromBin: options.fromBin || \"\"") &&
      !tabletModernSource.includes("preset.fromBin") &&
      tabletLegacySource.includes("manualStorageQuantityInput") &&
      tabletLegacySource.includes("fromBin: options.fromBin || \"\"") &&
      !tabletLegacySource.includes("preset.fromBin"),
    JSON.stringify({
      desktopQuantityInput: indexHtmlSource.includes("manualStorageQuantityInput") && appSource.includes("manualStorageQuantityInput"),
      tabletQuantityInput: tabletHtmlSource.includes("manualStorageQuantityInput") && tabletModernSource.includes("manualStorageQuantityInput") && tabletLegacySource.includes("manualStorageQuantityInput"),
      desktopEmptyBin: appSource.includes("fromBin: options.fromBin || \"\"") && !appSource.includes("preset.fromBin"),
      tabletEmptyBin: tabletModernSource.includes("fromBin: options.fromBin || \"\"") && tabletLegacySource.includes("fromBin: options.fromBin || \"\"") && !tabletModernSource.includes("preset.fromBin") && !tabletLegacySource.includes("preset.fromBin")
    })
  );
  const manualStorageSharedBin = await manualStorageSharedBinFixture();
  check(
    "manual storage common bin initializes desktop and tablets independently",
    indexHtmlSource.includes("manualStorageBinInput") &&
      tabletHtmlSource.includes("manualStorageBinInput") &&
      tabletHtmlSource.indexOf("shared/storage-bin-rules.js") < tabletHtmlSource.indexOf("tablet-legacy.js") &&
      manualStorageSharedBin.desktop.valid.value === "002-H4-SH4C4" &&
      manualStorageSharedBin.desktop.full.value === "002-H4-SH4C4" &&
      manualStorageSharedBin.desktop.empty.value === "" &&
      manualStorageSharedBin.desktop.invalid.ok === false &&
      manualStorageSharedBin.desktop.invalidKeepsExistingLines &&
      manualStorageSharedBin.desktop.lines.length === 5 &&
      manualStorageSharedBin.desktop.lines.every((line) => line.product === "1051515" && line.fromBin === "002-H4-SH4C4" && line.actualQty === "5000" && line.targetQty === "" && line.manual === true) &&
      new Set(manualStorageSharedBin.desktop.lines.map((line) => line.id)).size === 5 &&
      manualStorageSharedBin.desktop.lines.map((line) => line.warehouseOrder).join("|") === "M1|M2|M3|M4|M5" &&
      manualStorageSharedBin.desktop.emptyLine.fromBin === "" &&
      manualStorageSharedBin.desktop.articleBinIgnored &&
      manualStorageSharedBin.desktop.individualChangeIndependent &&
      appSource.includes("(map.targetQty.closest(\"label\") || map.targetQty).remove()") &&
      [manualStorageSharedBin.modern, manualStorageSharedBin.legacy].every((tablet) =>
        tablet.valid.value === "002-H4-SH4C4" &&
        tablet.full.value === "002-H4-SH4C4" &&
        tablet.empty.value === "" &&
        tablet.si.value === "SI-A1" &&
        tablet.invalid.ok === false &&
        tablet.lines.length === 5 &&
        tablet.lines.every((line) => line.product === "1051515" && line.fromBin === "002-H4-SH4C4" && line.actualQty === "5000" && line.targetQty === "" && line.manual === true) &&
        tablet.emptyLine.fromBin === "" &&
        tablet.articleBinIgnored &&
        tablet.individualChangeIndependent &&
        tablet.queuePayloadHasAllBins
      ) &&
      JSON.stringify(manualStorageSharedBin.modern.lines.map((line) => ({ product: line.product, fromBin: line.fromBin, targetQty: line.targetQty, actualQty: line.actualQty, manual: line.manual }))) === JSON.stringify(manualStorageSharedBin.legacy.lines.map((line) => ({ product: line.product, fromBin: line.fromBin, targetQty: line.targetQty, actualQty: line.actualQty, manual: line.manual }))),
    JSON.stringify(manualStorageSharedBin)
  );

  const siApiMaterialA = `SI-A-${suffix}`;
  const siApiMaterialB = `SI-B-${suffix}`;
  const siApiPayload = {
    fileName: `qa-si-${suffix}.xlsx`,
    sheetName: SI_STOCK_IMPORT_SHEET_NAME,
    rows: [
      siStockHeader,
      ["2026-07-17", "SI", siApiMaterialA, "SI API Teil A", "5", "001-QA", `LE-${suffix}`, "1"],
      ["2026-07-17", "SI", siApiMaterialA, "SI API Teil A", "5", "001-QA", `LE-${suffix}`, "1"],
      ["2026-07-17", "SI", siApiMaterialB, "SI API Teil B", "4", "002-QA", "", "1"],
      ["2026-07-17", "SI", siApiMaterialB, "SI API Teil B", "6", "002-QA", "", "2"]
    ]
  };
  const siPreviewRoleGuard = await request("/api/articles/si-stock-import/preview?warehouse=SI", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(siApiPayload)
  });
  check(
    "SI preview API rejects missing article role",
    siPreviewRoleGuard.status === 403,
    `${siPreviewRoleGuard.status} ${JSON.stringify(siPreviewRoleGuard.body)}`
  );
  const siPreviewWarehouseGuard = await request("/api/articles/si-stock-import/preview?warehouse=SSI", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(siApiPayload)
  });
  check(
    "SI preview API rejects SSI warehouse context",
    siPreviewWarehouseGuard.status === 400 && /nur.*SI/i.test(siPreviewWarehouseGuard.body?.error || ""),
    `${siPreviewWarehouseGuard.status} ${JSON.stringify(siPreviewWarehouseGuard.body)}`
  );
  const siWrongSheetApi = await request("/api/articles/si-stock-import/preview?warehouse=SI", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({ ...siApiPayload, sheetName: "Data" })
  });
  check(
    "SI preview API returns auditable hard error for wrong sheet",
    siWrongSheetApi.status === 200 && siWrongSheetApi.body?.ok === true && siWrongSheetApi.body?.preview?.ok === false &&
      siWrongSheetApi.body?.preview?.hardErrors?.some((error) => error.code === "sheet"),
    `${siWrongSheetApi.status} ${JSON.stringify(siWrongSheetApi.body)}`
  );
  const siPreviewApi = await request("/api/articles/si-stock-import/preview?warehouse=SI", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(siApiPayload)
  });
  check(
    "SI preview API reports duplicate, merge and replacement counts",
    siPreviewApi.status === 200 && siPreviewApi.body?.ok === true && siPreviewApi.body?.preview?.ok === true &&
      siPreviewApi.body?.preview?.counts?.discardedExactDuplicates === 1 &&
      siPreviewApi.body?.preview?.counts?.mergedEmptyLeGroups === 1 &&
      siPreviewApi.body?.preview?.counts?.importArticles === 2 &&
      siPreviewApi.body?.preview?.counts?.importStockRows === 2,
    `${siPreviewApi.status} ${JSON.stringify(siPreviewApi.body?.preview?.counts || siPreviewApi.body)}`
  );
  const siWrongConfirmation = await request("/api/articles/si-stock-import/replace?warehouse=SI", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({ ...siApiPayload, confirmation: "si-bestand ersetzen" })
  });
  check(
    "SI replace API requires exact confirmation phrase",
    siWrongConfirmation.status === 400 && siWrongConfirmation.body?.error?.includes(SI_STOCK_REPLACE_CONFIRMATION),
    `${siWrongConfirmation.status} ${JSON.stringify(siWrongConfirmation.body)}`
  );

  const siProtectedMaterial = `SI-PROTECT-${suffix}`;
  const siProtectedArticle = await request("/api/articles?warehouse=SSI", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({
      materialnummer: siProtectedMaterial,
      materialbezeichnung: "SSI Schutzartikel",
      gebindeArt: "STK",
      mengeProKarton: 0,
      mengeProPalette: 0
    })
  });
  const siProtectedReceipt = await request("/api/storage/receipts?warehouse=SSI", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({
      materialnummer: siProtectedMaterial,
      lagerplatz: "002-H3-SQA",
      leNummer: `SI-PROTECT-HU-${suffix}`,
      mengeStueck: 9,
      referenz: `SI protection ${suffix}`
    })
  });
  const siReplaceApi = await request("/api/articles/si-stock-import/replace?warehouse=SI", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({ ...siApiPayload, confirmation: SI_STOCK_REPLACE_CONFIRMATION })
  });
  const siArticlesAfterReplace = await request("/api/articles?warehouse=SI");
  const ssiArticlesAfterReplace = await request("/api/articles?warehouse=SSI");
  const ssiLocationsAfterReplace = await request(`/api/storage/locations?warehouse=SSI&materialnummer=${encodeURIComponent(siProtectedMaterial)}`);
  const protectedCountKeys = ["ssiStock", "orders", "movements", "issueErrors", "ssiArticles"];
  check(
    "SI replace API swaps only SI article and stock data transactionally",
    siProtectedArticle.status === 200 && siProtectedReceipt.status === 200 &&
      siReplaceApi.status === 200 && siReplaceApi.body?.replaced?.articles === 2 && siReplaceApi.body?.replaced?.stockRows === 2 &&
      protectedCountKeys.every((key) => siReplaceApi.body?.before?.[key] === siReplaceApi.body?.after?.[key]) &&
      Array.isArray(siArticlesAfterReplace.body) && siArticlesAfterReplace.body.length === 2 &&
      [siApiMaterialA, siApiMaterialB].every((material) => siArticlesAfterReplace.body.some((article) => article.materialnummer === material)) &&
      Array.isArray(ssiArticlesAfterReplace.body) && ssiArticlesAfterReplace.body.some((article) => article.materialnummer === siProtectedMaterial) &&
      Array.isArray(ssiLocationsAfterReplace.body) && ssiLocationsAfterReplace.body.some((location) => Number(location.mengeStueck) === 9),
    JSON.stringify({
      protectedArticle: siProtectedArticle.status,
      protectedReceipt: siProtectedReceipt.status,
      replace: siReplaceApi.body,
      siArticles: siArticlesAfterReplace.body,
      protectedLocations: ssiLocationsAfterReplace.body
    })
  );

  const invalidArticle = await request("/api/articles?warehouse=SSI", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({
      materialnummer: `98${suffix}`,
      materialbezeichnung: "QA invalid",
      gebindeArt: "KRT",
      mengeProKarton: 0,
      mengeProPalette: 0
    })
  });
  check(
    "article invalid quantity returns 400",
    invalidArticle.status === 400,
    `${invalidArticle.status} ${JSON.stringify(invalidArticle.body)}`
  );

  const article = await request("/api/articles?warehouse=SSI", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({
      materialnummer,
      materialbezeichnung: "QA ÄÖÜ äöüß",
      gebindeArt: "STK",
      mengeProKarton: 0,
      mengeProPalette: 0,
      bemerkung: "Fußnote Ü"
    })
  });
  check(
    "article create with utf8",
    [200, 201].includes(article.status) && JSON.stringify(article.body).includes("Fußnote"),
    `${article.status} ${JSON.stringify(article.body)}`
  );

  const receipt = await request("/api/storage/receipts?warehouse=SSI", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({
      materialnummer,
      lagerplatz: "002-H1-SQA",
      leNummer: hu,
      mengeStueck: 10,
      referenz: `QA ${suffix}`
    })
  });
  check("ssi receipt normalizes known bin", receipt.status === 200 && receipt.body.ok, `${receipt.status} ${JSON.stringify(receipt.body)}`);

  const issue = await request("/api/storage/issues?warehouse=SSI", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({
      materialnummer,
      lagerplatz: "002-H1-SQA",
      leNummer: hu,
      mengeStueck: 3,
      referenz: `QA issue ${suffix}`
    })
  });
  check("ssi issue accepts same normalized bin as receipt", issue.status === 200 && issue.body.ok, `${issue.status} ${JSON.stringify(issue.body)}`);

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const bookingExport = await request(`/api/articles/bookings/export?from=${today}&to=${today}`, {
    headers: ROLE_HEADERS
  });
  const bookingExportRows = Array.isArray(bookingExport.body?.items) ? bookingExport.body.items : [];
  const receiptBooking = bookingExportRows.find((row) => row.referenz === `QA ${suffix}`);
  const issueBooking = bookingExportRows.find((row) => row.referenz === `QA issue ${suffix}`);
  check(
    "article booking export returns expected columns and QA movements",
    bookingExport.status === 200 &&
      JSON.stringify(bookingExport.body.columns) === JSON.stringify([
        "Buchungsrichtung",
        "Datum/Uhrzeit",
        "Lager",
        "Stellplatz",
        "HU/LE-Nummer",
        "Menge",
        "Referenz"
      ]) &&
      receiptBooking?.buchungsrichtung === "EIN" &&
      issueBooking?.buchungsrichtung === "AUS" &&
      receiptBooking?.lager === "SSI" &&
      issueBooking?.lager === "SSI" &&
      Number(receiptBooking?.menge) === 10 &&
      Number(issueBooking?.menge) === 3,
    `${bookingExport.status} ${JSON.stringify({ columns: bookingExport.body?.columns, receiptBooking, issueBooking })}`
  );

  const invalidBookingExport = await request(`/api/articles/bookings/export?from=${today}&to=${yesterday}`, {
    headers: ROLE_HEADERS
  });
  check(
    "article booking export invalid range returns 400",
    invalidBookingExport.status === 400 && /Zeitraum/i.test(invalidBookingExport.body?.error || ""),
    `${invalidBookingExport.status} ${JSON.stringify(invalidBookingExport.body)}`
  );

  const bookingExportRoleGuard = await request(`/api/articles/bookings/export?from=${today}&to=${today}`, {
    headers: JSON_HEADERS
  });
  check(
    "article booking export without role rejected",
    bookingExportRoleGuard.status === 403,
    `${bookingExportRoleGuard.status} ${JSON.stringify(bookingExportRoleGuard.body)}`
  );

  const bookingExportAgain = await request(`/api/articles/bookings/export?from=${today}&to=${today}`, {
    headers: ROLE_HEADERS
  });
  check(
    "article booking export is read-only",
    bookingExportAgain.status === 200 &&
      Array.isArray(bookingExportAgain.body?.items) &&
      bookingExportAgain.body.items.length === bookingExportRows.length,
    `${bookingExportAgain.status} ${JSON.stringify({ first: bookingExportRows.length, second: bookingExportAgain.body?.items?.length })}`
  );

  const locations = await request(`/api/storage/locations?warehouse=SSI&materialnummer=${encodeURIComponent(materialnummer)}`);
  const location = Array.isArray(locations.body)
    ? locations.body.find((row) => row.leNummer === hu || row.le_nummer === hu)
    : null;
  check(
    "ssi issue reduced normalized stock",
    location && location.lagerplatz === "002-H3-SQA" && Number(location.mengeStueck) === 7,
    JSON.stringify(locations.body)
  );

  const roleGuard = await request("/api/storage/issues?warehouse=SSI", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ materialnummer, lagerplatz: "002-H1-SQA", leNummer: hu, mengeStueck: 1 })
  });
  check("storage mutation without role rejected", roleGuard.status === 403, `${roleGuard.status} ${JSON.stringify(roleGuard.body)}`);

  const orderPayload = {
    orderNumber: `QA-${suffix}`,
    customerName: "Pruefkunde",
    orderDate: "2026-06-22",
    orderTime: "07:35",
    orderType: "picking",
    orderWarehouse: "SSI",
    lines: [{
      position: "1",
      product: materialnummer,
      description: "QA Position",
      targetQty: "1",
      unit: "ST",
      fromBin: "002-H3-SQA",
      fromHandlingUnit: hu,
      toBin: "9021-0OUT",
      picked: false
    }]
  };
  const orderCreate = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(orderPayload)
  });
  const xlsxExplicitReleasePayload = {
    orderNumber: `QA-XLSX-RELEASE-${suffix}`,
    customerName: "9020-DETTELSAU",
    orderDate: "2026-06-22",
    orderTime: "07:36",
    orderType: "picking",
    orderWarehouse: "SSI",
    lines: pickingXlsxDraftRelease.state.lines.map((line, index) => ({
      position: String(index + 1),
      product: line.product,
      description: line.description,
      targetQty: line.targetQty,
      actualQty: line.actualQty,
      unit: line.unit,
      fromBin: line.fromBin,
      fromHandlingUnit: line.fromHandlingUnit,
      toBin: line.toBin,
      picked: false
    }))
  };
  const xlsxExplicitRelease = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(xlsxExplicitReleasePayload)
  });
  const xlsxExplicitReleaseReload = xlsxExplicitRelease.body.order?.id
    ? await request(`/api/orders/${encodeURIComponent(xlsxExplicitRelease.body.order.id)}`)
    : { status: 0, body: null };
  const xlsxSsiDestinationReleasePayload = {
    ...pickingXlsxSsiDestinationDraftRelease.savedOrder,
    id: "",
    orderNumber: "SSI",
    customerName: "9021-0OUT",
    orderWarehouse: "SSI"
  };
  const xlsxSsiDestinationRelease = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(xlsxSsiDestinationReleasePayload)
  });
  const xlsxSsiDestinationReleaseReload = xlsxSsiDestinationRelease.body.order?.id
    ? await request(`/api/orders/${encodeURIComponent(xlsxSsiDestinationRelease.body.order.id)}`)
    : { status: 0, body: null };
  check(
    "order create preserves destination rules and explicit XLSX draft release state",
    orderCreate.status === 200 && orderCreate.body.order.customerName === "9021-0OUT" && orderCreate.body.order.orderNumber === "SSI" &&
      xlsxExplicitRelease.status === 200 &&
      xlsxExplicitReleaseReload.status === 200 &&
      xlsxExplicitReleaseReload.body?.lines?.length === 2 &&
      xlsxExplicitReleaseReload.body?.lines?.map((line) => String(line.targetQty)).join(",") === "1700,675" &&
      xlsxExplicitReleaseReload.body?.lines?.map((line) => String(line.actualQty)).join(",") === "1700,675" &&
      !xlsxExplicitReleaseReload.body?.acceptedBy &&
      !xlsxExplicitReleaseReload.body?.activeUser &&
      !xlsxExplicitReleaseReload.body?.completedAt &&
      !xlsxExplicitReleaseReload.body?.exportedAt,
    JSON.stringify({
      orderCreate: orderCreate.body,
      xlsxExplicitRelease: xlsxExplicitRelease.body,
      xlsxExplicitReleaseReload: xlsxExplicitReleaseReload.body
    })
  );
  check(
    "released SSI XLSX destination exception persists after reopening",
    xlsxSsiDestinationRelease.status === 200 &&
      xlsxSsiDestinationReleaseReload.status === 200 &&
      xlsxSsiDestinationReleaseReload.body?.customerName === "9021-0OUT" &&
      xlsxSsiDestinationReleaseReload.body?.orderNumber === "SSI" &&
      xlsxSsiDestinationReleaseReload.body?.lines?.[0]?.toBin === "9020-ANSBACH" &&
      xlsxSsiDestinationReleaseReload.body?.lines?.[0]?.autoPositionNotes?.destination === "9020-ANSBACH" &&
      !xlsxSsiDestinationReleaseReload.body?.lines?.[1]?.autoPositionNotes?.destination,
    JSON.stringify({
      created: xlsxSsiDestinationRelease.body,
      reopened: xlsxSsiDestinationReleaseReload.body
    })
  );

  const mixedDestinationPayload = {
    ...orderPayload,
    orderNumber: `QA-MIX-${suffix}`,
    customerName: "Pruefkunde",
    lines: [
      {
        ...orderPayload.lines[0],
        position: "1",
        toBin: "9020-ANSBACH"
      },
      {
        ...orderPayload.lines[0],
        position: "2",
        fromHandlingUnit: `${hu}-2`,
        toBin: "9021-0OUT"
      }
    ]
  };
  const mixedDestinationOrderCreate = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(mixedDestinationPayload)
  });
  check(
    "order create prefers 9021-0OUT customer from later destination line",
    mixedDestinationOrderCreate.status === 200 &&
      mixedDestinationOrderCreate.body.order.customerName === "9021-0OUT" &&
      mixedDestinationOrderCreate.body.order.orderNumber === "SSI",
    `${mixedDestinationOrderCreate.status} ${JSON.stringify(mixedDestinationOrderCreate.body)}`
  );

  const orderId = orderCreate.body.order.id;
  const exportBlocked = await request(`/api/orders/${encodeURIComponent(orderId)}/export-pdf?warehouse=SSI`, {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({ order: orderPayload })
  });
  check(
    "incomplete order export blocked",
    exportBlocked.status === 400 && /Export gesperrt|abhaken/i.test(exportBlocked.body.error || ""),
    `${exportBlocked.status} ${JSON.stringify(exportBlocked.body)}`
  );

  await runOriginalArchiveChecks();

  const cr002Payload = {
    ...orderPayload,
    orderNumber: `QA-CR002-${suffix}`,
    customerName: "QA-CR002",
    customerGroupKey: "QA CR002",
    lines: [{
      position: "1",
      product: `NO-STOCK-${suffix}`,
      description: "QA CR-002 Bestandsfehler bleibt erlaubt",
      targetQty: "1",
      actualQty: "1",
      unit: "ST",
      fromBin: `QA-NOSTOCK-${suffix}`,
      fromHandlingUnit: `QA-MISSING-${suffix}`,
      toBin: "QA-ZIEL",
      picked: true,
      positionNote: ""
    }]
  };
  const cr002Create = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(cr002Payload)
  });
  const cr002Id = cr002Create.body.order?.id;
  const cr002Export = noteExportResponse(await request(`/api/orders/${encodeURIComponent(cr002Id)}/export-pdf?warehouse=SSI`, {
    method: "POST",
    headers: QA_EXPORT_HEADERS,
    body: JSON.stringify({ order: cr002Payload })
  }));
  check(
    "CR-002 unchanged: picked order exports despite stock issue errors",
    cr002Create.status === 200 && cr002Export.status === 200 && cr002Export.body.ok && isDiscardedExport(cr002Export.body) && Array.isArray(cr002Export.body.stockIssue?.errors) && cr002Export.body.stockIssue.errors.length >= 1,
    `${cr002Create.status}/${cr002Export.status} ${JSON.stringify(cr002Export.body)}`
  );
  const bookingErrorExportDate = new Date().toISOString().slice(0, 10);
  const bookingErrorExport = await request(`/api/articles/bookings/export?from=${bookingErrorExportDate}&to=${bookingErrorExportDate}`, {
    headers: ROLE_HEADERS
  });
  const bookingErrorRows = Array.isArray(bookingErrorExport.body?.items) ? bookingErrorExport.body.items : [];
  const bookingErrorRow = bookingErrorRows.find((row) =>
    String(row.referenz || "") === `Kommissionierung QA-CR002-${suffix}`
  );
  check(
    "article booking export maps stock issue errors to order reference",
    bookingErrorExport.status === 200 &&
      bookingErrorRow?.buchungsrichtung === "AUS" &&
      bookingErrorRow?.lager === "SSI" &&
      bookingErrorRow?.stellplatz === `QA-NOSTOCK-${suffix}` &&
      Number(bookingErrorRow?.menge) === 1 &&
      !String(bookingErrorRow?.referenz || "").includes("Buchungsfehler") &&
      !String(bookingErrorRow?.referenz || "").includes("Fehler:"),
    `${bookingErrorExport.status} ${JSON.stringify({ bookingErrorRow })}`
  );

  const deleteOrder = await request(`/api/orders/${encodeURIComponent(orderId)}`, {
    method: "DELETE",
    headers: ROLE_HEADERS
  });
  check("delete unexported order", deleteOrder.status === 200 && deleteOrder.body.ok, `${deleteOrder.status} ${JSON.stringify(deleteOrder.body)}`);

  const tabletUser = `QA-Tablet-${suffix}`;
  const tabletGroupKey = `QA-GROUP-${suffix}`;
  const tabletGroupOrderPayloads = ["A", "B"].map((label) => ({
    orderNumber: `QA-GRP-${label}-${suffix}`,
    customerName: "QA Gruppenkunde",
    customerGroupKey: tabletGroupKey,
    orderDate: "2026-06-22",
    orderTime: label === "A" ? "08:05" : "08:10",
    orderType: "picking",
    orderWarehouse: "SI",
    lines: [{
      position: "1",
      product: `${materialnummer}-${label}`,
      description: `QA Gruppenposition ${label}`,
      targetQty: "1",
      actualQty: "",
      unit: "ST",
      fromBin: `QA-${label}`,
      fromHandlingUnit: "",
      toBin: "QA-ZIEL",
      picked: false,
      positionNote: ""
    }]
  }));
  const tabletGroupCreates = [];
  for (const payload of tabletGroupOrderPayloads) {
    tabletGroupCreates.push(await request("/api/orders", {
      method: "POST",
      headers: ROLE_HEADERS,
      body: JSON.stringify(payload)
    }));
  }
  const tabletGroupIds = tabletGroupCreates.map((response) => response.body.order?.id).filter(Boolean);
  check(
    "tablet group fixture creates two same-customer orders",
    tabletGroupCreates.every((response) => response.status === 200) && tabletGroupIds.length === 2,
    JSON.stringify(tabletGroupCreates.map((response) => ({ status: response.status, body: response.body })))
  );

  const tabletAccept = await request(`/api/orders/${encodeURIComponent(tabletGroupIds[0])}/accept`, {
    method: "POST",
    headers: TABLET_HEADERS,
    body: JSON.stringify({ userName: tabletUser })
  });
  const acceptedDetails = Array.isArray(tabletAccept.body.acceptedOrderDetails) ? tabletAccept.body.acceptedOrderDetails : [];
  const acceptedSummaries = Array.isArray(tabletAccept.body.acceptedOrders) ? tabletAccept.body.acceptedOrders : [];
  const acceptedDetailIds = acceptedDetails.map((order) => order.id).sort();
  check(
    "tablet accept takes over same customer group",
    tabletAccept.status === 200 && tabletAccept.body.acceptedCount === 2 && JSON.stringify(acceptedDetailIds) === JSON.stringify(tabletGroupIds.slice().sort()),
    `${tabletAccept.status} ${JSON.stringify(tabletAccept.body)}`
  );
  check(
    "tablet accept returns both group summaries and details",
    acceptedSummaries.length === 2 && acceptedDetails.length === 2 && acceptedDetails.every((order) => order.acceptedBy === tabletUser && Array.isArray(order.lines)),
    JSON.stringify({ acceptedSummaries, acceptedDetails })
  );

  const groupOrderA = acceptedDetails.find((order) => order.id === tabletGroupIds[0]);
  const groupOrderB = acceptedDetails.find((order) => order.id === tabletGroupIds[1]);
  let groupUpdateA = { status: 0, body: {} };
  let groupUpdateB = { status: 0, body: {} };
  let groupReloadA = { status: 0, body: {} };
  let groupReloadB = { status: 0, body: {} };
  if (groupOrderA && groupOrderB) {
    groupOrderA.lines[0].picked = true;
    groupOrderA.lines[0].actualQty = "1";
    groupOrderA.lines[0].positionNote = "Offline A";
    groupOrderB.lines[0].picked = false;
    groupOrderB.lines[0].actualQty = "";
    groupOrderB.lines[0].positionNote = "Offline B";

    groupUpdateA = await request(`/api/orders/${encodeURIComponent(groupOrderA.id)}`, {
      method: "PUT",
      headers: TABLET_HEADERS,
      body: JSON.stringify({ order: groupOrderA, userName: tabletUser })
    });
    groupUpdateB = await request(`/api/orders/${encodeURIComponent(groupOrderB.id)}`, {
      method: "PUT",
      headers: TABLET_HEADERS,
      body: JSON.stringify({ order: groupOrderB, userName: tabletUser })
    });
    groupReloadA = await request(`/api/orders/${encodeURIComponent(groupOrderA.id)}`);
    groupReloadB = await request(`/api/orders/${encodeURIComponent(groupOrderB.id)}`);
  }
  check(
    "tablet group offline-style changes stay per order",
    groupUpdateA.status === 200 &&
      groupUpdateB.status === 200 &&
      groupReloadA.body.lines?.[0]?.picked === true &&
      groupReloadA.body.lines?.[0]?.positionNote === "Offline A" &&
      groupReloadB.body.lines?.[0]?.picked === false &&
      groupReloadB.body.lines?.[0]?.positionNote === "Offline B",
    JSON.stringify({ groupUpdateA: groupUpdateA.body, groupUpdateB: groupUpdateB.body, groupReloadA: groupReloadA.body, groupReloadB: groupReloadB.body })
  );
  for (const id of tabletGroupIds) {
    await request(`/api/orders/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: ROLE_HEADERS
    });
  }

  const tabletDirectExportPayload = {
    orderNumber: `QA-TABEXP-${suffix}`,
    customerName: `QA Tablet Export ${suffix}`,
    customerGroupKey: `QA-TABEXP-${suffix}`,
    orderDate: "2026-06-22",
    orderTime: "08:30",
    orderType: "picking",
    orderWarehouse: "SSI",
    lines: [{
      position: "1",
      product: materialnummer,
      description: "QA Tablet Direktexport",
      targetQty: "1",
      actualQty: "",
      unit: "ST",
      fromBin: "002-H3-SQA",
      fromHandlingUnit: hu,
      toBin: `QA-TAB-ZIEL-${suffix}`,
      picked: false,
      positionNote: ""
    }]
  };
  const tabletDirectCreate = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(tabletDirectExportPayload)
  });
  const tabletDirectId = tabletDirectCreate.body.order?.id;
  const tabletDirectAccept = await request(`/api/orders/${encodeURIComponent(tabletDirectId)}/accept`, {
    method: "POST",
    headers: TABLET_HEADERS,
    body: JSON.stringify({ userName: tabletUser })
  });
  const tabletDirectOrder = tabletDirectAccept.body.order || {};
  if (Array.isArray(tabletDirectOrder.lines) && tabletDirectOrder.lines[0]) {
    tabletDirectOrder.lines[0].picked = true;
    tabletDirectOrder.lines[0].actualQty = "1";
    tabletDirectOrder.completedBy = tabletUser;
    tabletDirectOrder.completedAt = new Date().toISOString();
  }
  const tabletDirectSave = await request(`/api/orders/${encodeURIComponent(tabletDirectId)}`, {
    method: "PUT",
    headers: TABLET_HEADERS,
    body: JSON.stringify({ order: tabletDirectOrder, userName: tabletUser })
  });
  const tabletDirectReload = await request(`/api/orders/${encodeURIComponent(tabletDirectId)}`);
  const tabletDirectExport = noteExportResponse(await request(`/api/orders/${encodeURIComponent(tabletDirectId)}/export-pdf?warehouse=SSI`, {
    method: "POST",
    headers: QA_TABLET_EXPORT_HEADERS,
    body: JSON.stringify({ order: tabletDirectReload.body, userName: tabletUser })
  }));
  check(
    "tablet direct export uses saved server state without reload workaround",
    tabletDirectCreate.status === 200 &&
      tabletDirectAccept.status === 200 &&
      tabletDirectSave.status === 200 &&
      tabletDirectReload.body.lines?.[0]?.picked === true &&
      tabletDirectExport.status === 200 &&
      tabletDirectExport.body.ok &&
      isDiscardedExport(tabletDirectExport.body) &&
      Boolean(tabletDirectExport.body.exportedAt),
    JSON.stringify({
      create: tabletDirectCreate.status,
      accept: tabletDirectAccept.status,
      save: tabletDirectSave.status,
      reloadedLine: tabletDirectReload.body.lines?.[0],
      export: { status: tabletDirectExport.status, body: tabletDirectExport.body }
    })
  );

  const storageOrderPayload = {
    orderNumber: `QA-ST-${suffix}`,
    customerName: "Fremdkunde",
    customerGroupKey: "FREMDKUNDE",
    orderDate: "2026-06-22",
    orderTime: "07:45",
    orderType: "storage",
    orderWarehouse: "SSI",
    lines: [{
      warehouseOrder: "1",
      product: materialnummer,
      description: "QA Einlagerung ohne HU",
      targetQty: "2",
      actualQty: "2",
      unit: "ST",
      fromBin: "H3T1",
      fromHandlingUnit: "",
      picked: true,
      manual: true
    }]
  };
  const storageCreate = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(storageOrderPayload)
  });
  check(
    "storage non-SSI customer can save without HU",
    storageCreate.status === 200 && storageCreate.body.order?.customerName === "Fremdkunde" && !String(storageCreate.body.order?.lines?.[0]?.fromHandlingUnit || ""),
    `${storageCreate.status} ${JSON.stringify(storageCreate.body)}`
  );

  const storageOrderId = storageCreate.body.order?.id;
  const storageExport = noteExportResponse(await request(`/api/orders/${encodeURIComponent(storageOrderId)}/export-pdf?warehouse=SSI`, {
    method: "POST",
    headers: QA_EXPORT_HEADERS,
    body: JSON.stringify({ order: storageOrderPayload })
  }));
  check(
    "storage non-SSI customer exports without HU prefix",
    storageExport.status === 200 && storageExport.body.ok && isDiscardedExport(storageExport.body) && storageExport.body.stockReceipt?.booked === 1,
    `${storageExport.status} ${JSON.stringify(storageExport.body)}`
  );

  const storageMissingDescriptionPayload = {
    ...storageOrderPayload,
    orderNumber: `QA-ST-NODESC-${suffix}`,
    customerName: "SSI",
    customerGroupKey: "SSI",
    lines: [{
      warehouseOrder: "101097251",
      product: materialnummer,
      description: "",
      targetQty: "33000",
      actualQty: "33000",
      unit: "ST",
      fromBin: "H3T3",
      fromHandlingUnit: "340063810001234567",
      picked: true,
      manual: false
    }]
  };
  const storageMissingDescriptionCreate = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(storageMissingDescriptionPayload)
  });
  const storageMissingDescriptionId = storageMissingDescriptionCreate.body.order?.id;
  const storageMissingDescriptionExport = noteExportResponse(await request(`/api/orders/${encodeURIComponent(storageMissingDescriptionId)}/export-pdf?warehouse=SSI`, {
    method: "POST",
    headers: QA_EXPORT_HEADERS,
    body: JSON.stringify({ order: storageMissingDescriptionPayload })
  }));
  check(
    "storage SSI export accepts line without article description",
    storageMissingDescriptionCreate.status === 200 &&
      storageMissingDescriptionExport.status === 200 &&
      storageMissingDescriptionExport.body.ok &&
      isDiscardedExport(storageMissingDescriptionExport.body) &&
      storageMissingDescriptionExport.body.stockReceipt?.booked === 1,
    `${storageMissingDescriptionCreate.status}/${storageMissingDescriptionExport.status} ${JSON.stringify(storageMissingDescriptionExport.body)}`
  );

  const storageExcelProduct = `00${materialnummer}`;
  const storageExcelPayload = {
    ...storageOrderPayload,
    orderNumber: `QA-XLSX-ST-${suffix}`,
    customerName: "Fremdkunde",
    customerGroupKey: "FREMDKUNDE",
    orderWarehouse: "SI",
    lines: [{
      warehouseOrder: "1",
      product: storageExcelProduct,
      description: "QA Excel Einlagerung",
      targetQty: "4",
      actualQty: "4",
      unit: "ST",
      fromBin: "H3T2",
      fromHandlingUnit: "000000123456",
      picked: true,
      manual: true
    }]
  };
  const storageExcelCreate = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(storageExcelPayload)
  });
  const storageExcelId = storageExcelCreate.body.order?.id;
  const storageExcelExport = noteExportResponse(await request(`/api/orders/${encodeURIComponent(storageExcelId)}/export-pdf?warehouse=SI`, {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({ order: storageExcelPayload })
  }));
  const storageExcelWorkbook = storageExcelExport.body?.xlsxPath
    ? await readOrderExportWorkbook(storageExcelExport.body)
    : { sheetName: "", headers: [], rows: [], error: "xlsxPath fehlt" };
  check(
    "storage export creates matching PDF and XLSX artifacts",
    storageExcelCreate.status === 200 &&
      storageExcelExport.status === 200 &&
      storageExcelExport.body.ok &&
      await pathExists(storageExcelExport.body.path) &&
      await pathExists(storageExcelExport.body.xlsxPath) &&
      path.parse(storageExcelExport.body.path).name === path.parse(storageExcelExport.body.xlsxPath).name,
    `${storageExcelCreate.status}/${storageExcelExport.status} ${JSON.stringify(storageExcelExport.body)}`
  );
  check(
    "storage order XLSX has expected sheet, headers, date and SI LE text",
    storageExcelWorkbook.sheetName === ORDER_EXCEL_SHEET_NAME &&
      JSON.stringify(storageExcelWorkbook.headers) === JSON.stringify(ORDER_EXCEL_HEADERS) &&
      storageExcelWorkbook.rows.length === 1 &&
      storageExcelWorkbook.rows[0].direction === "Ein" &&
      storageExcelWorkbook.rows[0].product === storageExcelProduct &&
      storageExcelWorkbook.rows[0].bin === "002-H3-T2" &&
      storageExcelWorkbook.rows[0].handlingUnit === "000000123456" &&
      storageExcelWorkbook.rows[0].quantity === 4 &&
      storageExcelWorkbook.rows[0].dateIsDate === true &&
      storageExcelWorkbook.rows[0].productIsText === true &&
      storageExcelWorkbook.rows[0].binIsText === true &&
      storageExcelWorkbook.rows[0].handlingUnitIsText === true &&
      storageExcelWorkbook.rows[0].quantityIsNumber === true,
    JSON.stringify(storageExcelWorkbook)
  );

  const pickingExcelPayload = {
    ...orderPayload,
    orderNumber: `QA-XLSX-PK-${suffix}`,
    customerName: "QA Excel Picking",
    customerGroupKey: "QA EXCEL PICKING",
    orderWarehouse: "SSI",
    lines: [
      {
        ...orderPayload.lines[0],
        actualQty: "1",
        picked: true,
        positionNote: ""
      },
      {
        lineType: "loading-slip",
        position: "2",
        product: `QA-LS-${suffix}`,
        description: "QA Ladeliste nicht in Excel",
        targetQty: "1",
        actualQty: "1",
        unit: "ST",
        fromBin: "",
        fromHandlingUnit: "",
        toBin: "",
        picked: true,
        barcode: `QA-LS-${suffix}`,
        positionNote: ""
      }
    ]
  };
  const pickingExcelCreate = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(pickingExcelPayload)
  });
  const pickingExcelId = pickingExcelCreate.body.order?.id;
  const pickingExcelExport = noteExportResponse(await request(`/api/orders/${encodeURIComponent(pickingExcelId)}/export-pdf?warehouse=SSI`, {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({ order: pickingExcelPayload })
  }));
  const pickingExcelReload = pickingExcelId
    ? await request(`/api/orders/${encodeURIComponent(pickingExcelId)}`)
    : { status: 0, body: null };
  const pickingExcelWorkbook = pickingExcelExport.body?.xlsxPath
    ? await readOrderExportWorkbook(pickingExcelExport.body)
    : { sheetName: "", headers: [], rows: [], error: "xlsxPath fehlt" };
  const pickingExcelPdfHtml = printableHtml(pickingExcelPayload, "QA-XLSX-Picking.pdf");
  check(
    "picking order XLSX uses source bin, keeps SSI LE empty and skips loading-slip lines",
    pickingExcelCreate.status === 200 &&
      pickingExcelExport.status === 200 &&
      pickingExcelExport.body.ok &&
      pickingExcelWorkbook.rows.length === 1 &&
      pickingExcelWorkbook.rows[0].direction === "Aus" &&
      pickingExcelWorkbook.rows[0].product === materialnummer &&
      pickingExcelWorkbook.rows[0].bin === "002-H3-SQA" &&
      pickingExcelWorkbook.rows[0].handlingUnit === "" &&
      pickingExcelWorkbook.rows[0].quantity === 1 &&
      !pickingExcelWorkbook.rows.some((row) => row.product === `QA-LS-${suffix}`) &&
      pickingExcelReload.status === 200 &&
      pickingExcelReload.body?.lines?.length === 2 &&
      pickingExcelReload.body?.lines?.some((line) => line.lineType === "loading-slip" && line.product === `QA-LS-${suffix}`) &&
      !pickingExcelPdfHtml.includes(`QA-LS-${suffix}`) &&
      !pickingExcelPdfHtml.includes("Ladeliste nicht in Excel") &&
      pickingExcelPdfHtml.includes("Erledigt:</strong> 1/1"),
    JSON.stringify({ export: pickingExcelExport.body, workbook: pickingExcelWorkbook, reload: pickingExcelReload.body, pdfHtml: pickingExcelPdfHtml })
  );
  check(
    "QA export mode preserves temporary artifacts without changing default cleanup",
    exportSource.includes("const preserveTempArtifacts = options?.preserveTempArtifacts === true") &&
      exportSource.includes("if (!preserveTempArtifacts)") &&
      serverSource.includes("isQaPreserveArtifactsRequest(request, order)") &&
      serverSource.includes("isLoopbackRequest(request) && isQaOrder(order)"),
    "QA artifact preservation markers"
  );

  const exportedStorageDelete = await request(`/api/orders/${encodeURIComponent(storageOrderId)}`, {
    method: "DELETE",
    headers: ROLE_HEADERS
  });
  check(
    "exported storage order delete rejected",
    exportedStorageDelete.status === 409 && /Abgeschlossene Auftraege/i.test(exportedStorageDelete.body.error || ""),
    `${exportedStorageDelete.status} ${JSON.stringify(exportedStorageDelete.body)}`
  );

  const manualMultiOrderPayload = {
    orderNumber: `QA-MST-${suffix}`,
    customerName: "Fremdkunde",
    customerGroupKey: "FREMDKUNDE",
    orderDate: "2026-06-22",
    orderTime: "07:55",
    orderType: "storage",
    orderWarehouse: "SSI",
    lines: [1, 2].map((position) => ({
      warehouseOrder: `M${position}`,
      product: materialnummer,
      description: "QA manuelle Einlagerung mehrfach",
      targetQty: "",
      actualQty: String(position + 1),
      unit: "ST",
      fromBin: `H3T${position}`,
      fromHandlingUnit: "",
      picked: true,
      manual: true
    }))
  };
  const manualMultiCreate = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(manualMultiOrderPayload)
  });
  check(
    "manual storage creates multiple same-material lines without target quantity",
    manualMultiCreate.status === 200 && manualMultiCreate.body.order?.total === 2,
    `${manualMultiCreate.status} ${JSON.stringify(manualMultiCreate.body)}`
  );
  const manualMultiOrderId = manualMultiCreate.body.order?.id;
  const manualMultiReload = await request(`/api/orders/${encodeURIComponent(manualMultiOrderId)}`);
  check(
    "manual storage keeps per-line quantity, empty target quantity and distinct bins",
    manualMultiReload.status === 200 &&
      Array.isArray(manualMultiReload.body.lines) &&
      manualMultiReload.body.lines.length === 2 &&
      manualMultiReload.body.lines.every((line) => String(line.targetQty || "") === "") &&
      manualMultiReload.body.lines.map((line) => String(line.actualQty || "")).join(",") === "2,3" &&
      new Set(manualMultiReload.body.lines.map((line) => String(line.fromBin || ""))).size === 2,
    `${manualMultiReload.status} ${JSON.stringify(manualMultiReload.body.lines || manualMultiReload.body)}`
  );
  const invalidManualStorageQuantityPayload = {
    ...manualMultiOrderPayload,
    orderNumber: `QA-MQTY-${suffix}`,
    lines: [{
      warehouseOrder: "M1",
      product: materialnummer,
      description: "QA ungueltige manuelle Stueckzahl",
      targetQty: "",
      actualQty: "0",
      unit: "ST",
      fromBin: "H3T1",
      fromHandlingUnit: "",
      picked: false,
      manual: true
    }]
  };
  const invalidManualStorageQuantity = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(invalidManualStorageQuantityPayload)
  });
  check(
    "manual storage invalid position quantity rejected as 400",
    invalidManualStorageQuantity.status === 400 && /St.ckzahl|positive/i.test(invalidManualStorageQuantity.body.error || ""),
    `${invalidManualStorageQuantity.status} ${JSON.stringify(invalidManualStorageQuantity.body)}`
  );
  const manualMultiExport = noteExportResponse(await request(`/api/orders/${encodeURIComponent(manualMultiOrderId)}/export-pdf?warehouse=SSI`, {
    method: "POST",
    headers: QA_EXPORT_HEADERS,
    body: JSON.stringify({ order: manualMultiOrderPayload })
  }));
  check(
    "manual storage multiple same-material export books separate lines",
    manualMultiExport.status === 200 && isDiscardedExport(manualMultiExport.body) && manualMultiExport.body.stockReceipt?.booked === 2,
    `${manualMultiExport.status} ${JSON.stringify(manualMultiExport.body)}`
  );

  const tabletManualDeletePayload = {
    ...manualMultiOrderPayload,
    orderNumber: `QA-TDEL-${suffix}`,
    customerName: "Tabletkunde",
    customerGroupKey: "TABLETKUNDE",
    createdBy: tabletUser,
    lastEditedBy: tabletUser,
    activeUser: tabletUser,
    acceptedBy: tabletUser,
    lines: [{
      warehouseOrder: "M1",
      product: materialnummer,
      description: "QA Tablet manuell loeschen",
      targetQty: "",
      actualQty: "1",
      unit: "ST",
      fromBin: "H3T1",
      fromHandlingUnit: "",
      picked: false,
      manual: true
    }]
  };
  const tabletManualDeleteCreate = await request("/api/orders", {
    method: "POST",
    headers: TABLET_HEADERS,
    body: JSON.stringify(tabletManualDeletePayload)
  });
  const tabletManualDeleteId = tabletManualDeleteCreate.body.order?.id;
  const tabletManualDelete = await request(`/api/orders/${encodeURIComponent(tabletManualDeleteId)}`, {
    method: "DELETE",
    headers: TABLET_HEADERS
  });
  const tabletManualDeleteReload = await request(`/api/orders/${encodeURIComponent(tabletManualDeleteId)}`);
  check(
    "tablet manual storage open order can be deleted",
    tabletManualDeleteCreate.status === 200 && tabletManualDelete.status === 200 && tabletManualDeleteReload.status === 404,
    JSON.stringify({
      create: tabletManualDeleteCreate.body,
      delete: tabletManualDelete.body,
      reloadStatus: tabletManualDeleteReload.status
    })
  );

  const tooManyManualStoragePayload = {
    ...manualMultiOrderPayload,
    orderNumber: `QA-MAX-${suffix}`,
    lines: Array.from({ length: MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX + 1 }, (_, index) => ({
      warehouseOrder: `M${index + 1}`,
      product: materialnummer,
      description: "QA zu viele manuelle Positionen",
      targetQty: "",
      actualQty: "1",
      unit: "ST",
      fromBin: "H3T1",
      fromHandlingUnit: "",
      picked: true,
      manual: true
    }))
  };
  const tooManyManualStorage = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(tooManyManualStoragePayload)
  });
  check(
    "manual storage too many positions rejected",
    tooManyManualStorage.status === 400 && /maximal 100 Positionen/i.test(tooManyManualStorage.body.error || ""),
    `${tooManyManualStorage.status} ${JSON.stringify(tooManyManualStorage.body)}`
  );

  const ssiStorageHuRulePayload = {
    ...manualMultiOrderPayload,
    orderNumber: `QA-HU-${suffix}`,
    customerName: "SSI",
    customerGroupKey: "SSI",
    lines: [{
      warehouseOrder: "M1",
      product: materialnummer,
      description: "QA SSI HU Pflicht",
      targetQty: "",
      actualQty: "1",
      unit: "ST",
      fromBin: "H3T3",
      fromHandlingUnit: "",
      picked: true,
      manual: true
    }]
  };
  const ssiStorageHuCreate = await request("/api/orders", {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify(ssiStorageHuRulePayload)
  });
  const ssiStorageHuOrderId = ssiStorageHuCreate.body.order?.id;
  const ssiStorageHuExport = await request(`/api/orders/${encodeURIComponent(ssiStorageHuOrderId)}/export-pdf?warehouse=SSI`, {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({ order: ssiStorageHuRulePayload })
  });
  check(
    "manual storage SSI HU rule unchanged",
    ssiStorageHuCreate.status === 200 && ssiStorageHuExport.status === 400 && /HU muss mit 34006381000|HU fehlt/i.test(ssiStorageHuExport.body.error || ""),
    `${ssiStorageHuCreate.status}/${ssiStorageHuExport.status} ${JSON.stringify(ssiStorageHuExport.body)}`
  );

  for (const report of ["article-movements", "top-articles", "slow-articles", "location-usage"]) {
    const response = await request(`/api/storage/reports/${report}?warehouse=SSI`);
    check(`report ${report}`, response.status === 200 && response.body.ok, `${response.status}`);
  }

  const missing = await request("/does-not-exist.html");
  check("missing static returns 404", missing.status === 404, `${missing.status}`);

  const malformed = await fetch(`${BASE_URL}/api/orders`, {
    method: "POST",
    headers: ROLE_HEADERS,
    body: "{not json"
  });
  check("malformed json returns 400", malformed.status === 400, `${malformed.status}`);

  const exportArtifacts = await findQaExportArtifacts();
  check(
    "QA export artifacts remain inside the isolated workspace",
    exportArtifacts.length >= 2 && exportArtifacts.every((filePath) => isPathInside(filePath, repoRootDir())),
    JSON.stringify(exportArtifacts)
  );

  console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, passed: checks.length, checks }, null, 2));
}

async function runOriginalArchiveChecks() {
  const context = await originalArchiveTestContext();
  const cleanupPaths = new Set();
  const track = (filePath) => {
    if (filePath) cleanupPaths.add(filePath);
    return filePath;
  };

  try {
    check(
      "health exposes import and archive directories",
      Boolean(context.importDir) && Boolean(context.archiveDir),
      JSON.stringify(context)
    );

    const successName = `QA-ORIG-${suffix}.pdf`;
    track(await writeOriginalImportFile(context, successName, "success"));
    const successPayload = archiveOrderPayload(`QA-ARCH-${suffix}`, successName, true);
    const successCreate = await request("/api/orders", {
      method: "POST",
      headers: ROLE_HEADERS,
      body: JSON.stringify(successPayload)
    });
    const successId = successCreate.body.order?.id;
    const successExport = noteExportResponse(await request(`/api/orders/${encodeURIComponent(successId)}/export-pdf?warehouse=SSI`, {
      method: "POST",
      headers: QA_EXPORT_HEADERS,
      body: JSON.stringify({ order: successPayload })
    }));
    const successArchive = successExport.body.archiveOriginal || {};
    track(successArchive.archivePath);
    const successReload = successId ? await request(`/api/orders/${encodeURIComponent(successId)}`) : { status: 0, body: {} };
    check(
      "original import file archived after successful export",
      successCreate.status === 200 &&
        successExport.status === 200 &&
        successArchive.archived === true &&
        !await pathExists(path.join(context.importDir, successName)) &&
        await pathExists(successArchive.archivePath) &&
        Boolean(successReload.body.originalArchivedAt) &&
        successReload.body.originalArchivePath === successArchive.archivePath,
      JSON.stringify({ create: successCreate.status, export: successExport.body, reload: successReload.body })
    );

    const repeatExport = noteExportResponse(await request(`/api/orders/${encodeURIComponent(successId)}/export-pdf?warehouse=SSI`, {
      method: "POST",
      headers: QA_EXPORT_HEADERS,
      body: JSON.stringify({ order: successReload.body })
    }));
    check(
      "already archived original file is not moved twice",
      repeatExport.status === 200 && repeatExport.body.archiveOriginal?.reason === "already-archived",
      `${repeatExport.status} ${JSON.stringify(repeatExport.body.archiveOriginal)}`
    );

    const blockedName = `QA-ORIG-BLOCK-${suffix}.pdf`;
    const blockedPath = track(await writeOriginalImportFile(context, blockedName, "blocked"));
    const blockedPayload = archiveOrderPayload(`QA-ARCH-BLOCK-${suffix}`, blockedName, false);
    const blockedCreate = await request("/api/orders", {
      method: "POST",
      headers: ROLE_HEADERS,
      body: JSON.stringify(blockedPayload)
    });
    const blockedId = blockedCreate.body.order?.id;
    const blockedExport = await request(`/api/orders/${encodeURIComponent(blockedId)}/export-pdf?warehouse=SSI`, {
      method: "POST",
      headers: QA_EXPORT_HEADERS,
      body: JSON.stringify({ order: blockedPayload })
    });
    check(
      "original file stays in import folder when export validation fails",
      blockedCreate.status === 200 && blockedExport.status === 400 && await pathExists(blockedPath),
      `${blockedCreate.status}/${blockedExport.status} ${JSON.stringify(blockedExport.body)}`
    );

    const collisionName = `QA-ORIG-COLL-${suffix}.pdf`;
    const existingArchivePath = track(path.join(context.archiveDir, collisionName));
    await mkdir(context.archiveDir, { recursive: true });
    await writeFile(existingArchivePath, "pre-existing", "utf8");
    track(await writeOriginalImportFile(context, collisionName, "collision"));
    const collisionPayload = archiveOrderPayload(`QA-ARCH-COLL-${suffix}`, collisionName, true);
    const collisionCreate = await request("/api/orders", {
      method: "POST",
      headers: ROLE_HEADERS,
      body: JSON.stringify(collisionPayload)
    });
    const collisionId = collisionCreate.body.order?.id;
    const collisionExport = noteExportResponse(await request(`/api/orders/${encodeURIComponent(collisionId)}/export-pdf?warehouse=SSI`, {
      method: "POST",
      headers: QA_EXPORT_HEADERS,
      body: JSON.stringify({ order: collisionPayload })
    }));
    const collisionArchive = collisionExport.body.archiveOriginal || {};
    track(collisionArchive.archivePath);
    check(
      "archive name collision does not overwrite existing file",
      collisionCreate.status === 200 &&
        collisionExport.status === 200 &&
        collisionArchive.archived === true &&
        collisionArchive.archivePath !== existingArchivePath &&
        await pathExists(collisionArchive.archivePath) &&
        await readFile(existingArchivePath, "utf8") === "pre-existing",
      JSON.stringify({ existingArchivePath, collisionArchive })
    );

    const noOriginalPayload = archiveOrderPayload(`QA-ARCH-NOFILE-${suffix}`, "", true);
    const noOriginalCreate = await request("/api/orders", {
      method: "POST",
      headers: ROLE_HEADERS,
      body: JSON.stringify(noOriginalPayload)
    });
    const noOriginalId = noOriginalCreate.body.order?.id;
    const noOriginalExport = noteExportResponse(await request(`/api/orders/${encodeURIComponent(noOriginalId)}/export-pdf?warehouse=SSI`, {
      method: "POST",
      headers: QA_EXPORT_HEADERS,
      body: JSON.stringify({ order: noOriginalPayload })
    }));
    check(
      "missing original metadata does not fail export",
      noOriginalCreate.status === 200 &&
        noOriginalExport.status === 200 &&
        noOriginalExport.body.archiveOriginal?.reason === "missing-original-file",
      `${noOriginalCreate.status}/${noOriginalExport.status} ${JSON.stringify(noOriginalExport.body.archiveOriginal)}`
    );

    const missingName = `QA-ORIG-MISSING-${suffix}.pdf`;
    const missingPayload = archiveOrderPayload(`QA-ARCH-MISSING-${suffix}`, missingName, true);
    const missingCreate = await request("/api/orders", {
      method: "POST",
      headers: ROLE_HEADERS,
      body: JSON.stringify(missingPayload)
    });
    const missingId = missingCreate.body.order?.id;
    const missingExport = noteExportResponse(await request(`/api/orders/${encodeURIComponent(missingId)}/export-pdf?warehouse=SSI`, {
      method: "POST",
      headers: QA_EXPORT_HEADERS,
      body: JSON.stringify({ order: missingPayload })
    }));
    check(
      "missing original file reports archive error without failing export",
      missingCreate.status === 200 &&
        missingExport.status === 200 &&
        /nicht gefunden/i.test(missingExport.body.archiveOriginal?.error || ""),
      `${missingCreate.status}/${missingExport.status} ${JSON.stringify(missingExport.body.archiveOriginal)}`
    );

    const invalidCreate = await request("/api/orders", {
      method: "POST",
      headers: ROLE_HEADERS,
      body: JSON.stringify(archiveOrderPayload(`QA-ARCH-BAD-${suffix}`, "../evil.pdf", true))
    });
    check(
      "invalid original file name is rejected",
      invalidCreate.status === 400 && /Originaldateiname|ungueltig/i.test(invalidCreate.body.error || ""),
      `${invalidCreate.status} ${JSON.stringify(invalidCreate.body)}`
    );
  } finally {
    // QA-Artefakte bleiben gemaess Wiederherstellungsvorgabe in der isolierten Arbeitskopie erhalten.
  }

  const leftovers = await findOriginalArchiveArtifacts(context);
  check(
    "original archive QA files remain auditable in isolated directories",
    leftovers.length >= 4 && leftovers.every((filePath) =>
      isPathInside(filePath, context.importDir) || isPathInside(filePath, context.archiveDir)
    ),
    JSON.stringify(leftovers)
  );
}

async function originalArchiveTestContext() {
  const health = await request("/api/health");
  return {
    importDir: String(health.body?.importDir || "").trim(),
    archiveDir: String(health.body?.archiveDir || "").trim()
  };
}

function archiveOrderPayload(orderNumber, originalFileName, picked) {
  return {
    orderNumber,
    customerName: "QA Archivkunde",
    customerGroupKey: "QA ARCHIVKUNDE",
    orderDate: "2026-06-23",
    orderTime: "11:00",
    orderType: "picking",
    orderWarehouse: "SSI",
    originalFileName,
    lines: [{
      position: "1",
      product: materialnummer,
      description: "QA Originalarchiv",
      targetQty: "1",
      actualQty: picked ? "1" : "",
      unit: "ST",
      fromBin: "002-H3-SQA",
      fromHandlingUnit: hu,
      toBin: `QA-ARCHIV-${suffix}`,
      picked,
      positionNote: ""
    }]
  };
}

async function writeOriginalImportFile(context, fileName, content) {
  await mkdir(context.importDir, { recursive: true });
  const filePath = path.join(context.importDir, fileName);
  await writeFile(filePath, `QA ${suffix} ${content}`, "utf8");
  return filePath;
}

async function findOriginalArchiveArtifacts(context) {
  const dirs = [...new Set([context.importDir, context.archiveDir].filter(Boolean))];
  const artifacts = [];
  const pattern = new RegExp(`^QA-ORIG.*${escapeRegExp(suffix)}.*\\.pdf$`, "i");
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && pattern.test(entry.name)) artifacts.push(path.join(dir, entry.name));
    }
  }
  return artifacts;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readOrderExportWorkbook(exportBody) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(exportBody.xlsxPath);
  const worksheet = workbook.getWorksheet(ORDER_EXCEL_SHEET_NAME);
  if (!worksheet) return { sheetName: "", headers: [], rows: [] };
  const headers = ORDER_EXCEL_HEADERS.map((_, index) => worksheet.getRow(1).getCell(index + 1).value);
  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (!row.hasValues) continue;
    const productCell = row.getCell(3);
    const binCell = row.getCell(4);
    const handlingUnitCell = row.getCell(5);
    const quantityCell = row.getCell(6);
    rows.push({
      direction: String(row.getCell(1).value || ""),
      exportedAt: row.getCell(2).value,
      dateIsDate: row.getCell(2).value instanceof Date,
      product: String(productCell.value || ""),
      productIsText: productCell.type === ExcelJS.ValueType.String || typeof productCell.value === "string",
      bin: String(binCell.value || ""),
      binIsText: binCell.type === ExcelJS.ValueType.String || typeof binCell.value === "string",
      handlingUnit: String(handlingUnitCell.value || ""),
      handlingUnitIsText: handlingUnitCell.type === ExcelJS.ValueType.String || typeof handlingUnitCell.value === "string",
      quantity: quantityCell.value,
      quantityIsNumber: quantityCell.type === ExcelJS.ValueType.Number && typeof quantityCell.value === "number"
    });
  }
  return { sheetName: worksheet.name, headers, rows };
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...(options.headers || {}) }
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function tableHeadersFromHtml(html) {
  const table = String(html || "").match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1] || "";
  return [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, "").trim());
}

function check(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) {
    const error = new Error(`${name} failed: ${detail}`);
    error.checks = checks;
    throw error;
  }
}

function extractFunctionSource(source, marker) {
  const text = String(source || "");
  const start = text.indexOf(marker);
  if (start === -1) return "";
  const signatureEnd = text.indexOf(") {", start);
  const bodyStart = signatureEnd === -1 ? text.indexOf("{", start) : signatureEnd + 2;
  if (bodyStart === -1) return text.slice(start);

  let depth = 0;
  for (let index = bodyStart; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return text.slice(start);
}

function countSourceOccurrences(source, marker) {
  const text = String(source || "");
  const needle = String(marker || "");
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function noteExportResponse(response) {
  if (response?.body && typeof response.body === "object") exportResponses.push(response.body);
  return response;
}

function isDiscardedExport(body) {
  return body?.discarded === true && !body.path && !body.copyPath && !body.url;
}

async function findQaExportArtifacts() {
  const dirs = await qaArtifactSearchDirs();
  const artifacts = [];
  const suffixPattern = escapeRegExp(suffix);
  const artifactPattern = new RegExp(`^QA-.*${suffixPattern}.*\\.(pdf|xlsx|csv|html)$`, "i");

  for (const dir of dirs) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && artifactPattern.test(entry.name)) {
        artifacts.push(path.join(dir, entry.name));
      }
    }
  }
  return artifacts;
}

async function qaArtifactSearchDirs() {
  const dirs = new Set();
  const health = await request("/api/health");
  if (typeof health.body?.exportDir === "string" && health.body.exportDir.trim()) {
    dirs.add(health.body.exportDir);
  }
  dirs.add(path.join(repoRootDir(), "Exporte"));
  dirs.add(path.join(repoRootDir(), "tmp"));

  for (const body of exportResponses) {
    for (const candidate of [body.path, body.copyPath, body.xlsxPath, body.xlsxCopyPath]) {
      if (typeof candidate === "string" && candidate.trim()) {
        dirs.add(path.dirname(candidate));
      }
    }
  }
  return [...dirs];
}

function repoRootDir() {
  return path.resolve(fileURLToPath(new URL("..", import.meta.url)));
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function parsePickingTextFixture(text) {
  if (!appParserContext) appParserContext = await createAppParserContext();
  return appParserContext.__parseOrderText(String(text || ""));
}

async function pickingXlsxDraftReleaseFixture(lines, { release = false, applyDestinationExceptions = false } = {}) {
  const context = await createAppParserContext();
  let serverRequests = 0;
  let saveStateCalls = 0;
  let renderCalls = 0;
  let storageBinOptions = null;
  context.__currentUser.name = "QA Buero";
  context.__currentUser.group = "buero";
  context.HLogistikUi = {
    currentWarehouse: () => "SSI",
    normalizeWarehouse: (value, fallback = "") => {
      const normalized = String(value || "").trim().toUpperCase();
      return normalized === "SI" || normalized === "SSI" ? normalized : fallback;
    }
  };
  context.__elements.releaseOrderButton = { hidden: true, disabled: true };
  context.__setServerOnline(true);
  context.apiJson = async () => {
    serverRequests += 1;
    throw new Error("XLSX-Entwurf darf vor ausdruecklicher Freigabe keinen Serverrequest senden.");
  };
  context.findDuplicateOrderForImport = async () => null;
  context.detectPickingWarehouse = async () => ({ warehouse: "SSI", type: "ok", shortMessage: "" });
  context.applyWarehouseHint = () => {
    context.__state.orderWarehouse = "SSI";
  };
  context.isSiSystemFromBinFillContext = () => false;
  context.applyStorageBinsFromArticleStock = async (nextLines, options = {}) => {
    storageBinOptions = { ...options };
    return { lines: nextLines, applied: 0 };
  };
  context.applyPackageNotesForImportedLines = async (nextLines) => nextLines;
  context.buildPickingImportLineDiagnostics = () => ({ source: "qa-xlsx" });
  context.logPickingImportLineDiagnostics = () => {};
  if (!applyDestinationExceptions) {
    context.applyDefaultDestinationCustomer = () => {
      context.__state.customerName = "9020-DETTELSAU";
      context.__state.customerGroupKey = "9020-DETTELSAU";
      return true;
    };
    context.applyCustomerOrderNumberRule = () => {};
  }
  context.saveStateWithoutServer = () => {
    saveStateCalls += 1;
  };
  context.render = () => {
    renderCalls += 1;
    context.__renderReleaseButton();
  };

  const sourceText = context.__pickingXlsxImportText({ sheetName: "Tabelle1", lines });
  const importedLines = applyDestinationExceptions
    ? context.__annotateDestinationExceptions(lines).map((line) => context.__createLine(line))
    : lines;
  const result = await context.__importText(
    sourceText,
    "synthetic-picking.xlsx",
    { lines: importedLines },
    { source: "xlsx", documentType: "picking-xlsx" }
  );
  const importedLine = cloneJson(context.__state.lines?.[0] || {});
  const hasOpenReviewBeforeRelease = context.__hasOpenFromBinReviewWarnings(context.__state.lines);
  let savedLine = null;
  let savedLines = null;
  let savedOrder = null;
  let releaseRequests = 0;
  if (release) {
    context.__state.lines.forEach((line) => {
      line.picked = true;
    });
    context.apiJson = async (_url, options = {}) => {
      releaseRequests += 1;
      const payload = JSON.parse(options.body || "{}");
      savedOrder = cloneJson(payload.order || {});
      savedLine = cloneJson(payload.order?.lines?.[0] || {});
      savedLines = cloneJson(payload.order?.lines || []);
      return { order: { id: "qa-xlsx-release" } };
    };
    context.setImportStatus = () => {};
    context.setServerStatus = () => {};
    context.resetCurrentOrderView = () => {};
    context.loadOrderList = async () => {};
    await context.__releaseCurrentOrder();
  }
  return {
    result,
    sourceText,
    state: JSON.parse(JSON.stringify(context.__state)),
    releaseButton: { ...context.__elements.releaseOrderButton },
    serverRequests,
    saveStateCalls,
    renderCalls,
    importedLine,
    storageBinOptions,
    hasOpenReviewBeforeRelease,
    releaseRequests,
    savedLine,
    savedLines,
    savedOrder,
    reopenedOrder: savedOrder ? cloneJson(savedOrder) : null
  };
}

async function loadingSlipXlsxAttachmentFixture(xlsxLines) {
  const context = await createAppParserContext();
  const regularLines = cloneJson(xlsxLines);
  const pages = [
    {
      pageNumber: 1,
      rotation: 0,
      text: [
        "Ladeschein",
        "Nummer: V26009624/0",
        "1066526 Sicherheitsstreifen fuer 7015-01 10 Stueck",
        "Ladeschein",
        "Nummer: V26009625/0",
        "1066526 Sicherheitsstreifen fuer 7015-01 10 Stueck"
      ].join("\n")
    },
    {
      pageNumber: 2,
      rotation: 90,
      text: [
        "Ladeschein",
        "Nummer: V26009626/0",
        "1072595 PET-Etui fuer 7015/02-05 5 Stueck",
        "1072598 PET-Etui fuer 7015-01 6 Stueck"
      ].join("\n")
    }
  ];
  const attachmentId = "qa-loading-slip-attachment";
  const loadingLines = pages.flatMap((page) => context.__parseLoadingSlipLines(page.text.split("\n"))
    .map((line) => ({
      ...line,
      loadingSlipAttachmentId: attachmentId,
      loadingSlipAttachmentPage: page.pageNumber
    })));
  Object.assign(context.__state, {
    id: "",
    orderType: "picking",
    originalFileName: "synthetic-picking.xlsx",
    awaitingRelease: true,
    lines: cloneJson(regularLines)
  });
  context.__elements.saveOrderButton = { textContent: "", title: "" };
  context.__renderSaveOrderButton();
  const lines = context.__appendAllLoadingSlipLines(context.__state.lines, loadingLines);
  const regularAfterAppend = lines.filter((line) => line.lineType !== "loading-slip");
  const loadingAfterAppend = lines.filter((line) => line.lineType === "loading-slip");
  const loadingSlipCount = new Set(loadingAfterAppend.map((line) => `${line.loadingSlipAttachmentPage}:${line.loadingSlipBlockIndex || 1}`)).size;
  return {
    canAppend: context.__canAppendLoadingSlipToXlsxDraft(),
    button: { ...context.__elements.saveOrderButton },
    pages: pages.map(({ pageNumber, rotation }) => ({ pageNumber, rotation })),
    lines,
    loadingLines: loadingAfterAppend,
    loadingSlipCount,
    regularLinesUnchanged: JSON.stringify(regularAfterAppend) === JSON.stringify(regularLines)
  };
}

async function pickingPdfBinReviewFixture(fromBin) {
  const context = await createAppParserContext();
  context.__state.orderType = "picking";
  context.__state.originalFileName = "source.pdf";
  context.__state.lines = [{ id: "pdf-bin-review", fromBin }];
  return {
    review: context.__fromBinReviewDiagnosticForValue(fromBin),
    blocked: context.__hasOpenFromBinReviewWarnings(context.__state.lines)
  };
}

async function storageMissingDescriptionCompletionFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const context = appParserContext;
  const stateBefore = JSON.stringify(context.__state);
  const completeLine = {
    warehouseOrder: "101097251",
    product: "1014678",
    description: "",
    targetQty: "33000",
    actualQty: "33000",
    unit: "ST",
    fromBin: "H3T3",
    fromHandlingUnit: "340063810001234567",
    picked: true,
    manual: false
  };

  try {
    Object.assign(context.__state, {
      orderType: "storage",
      customerName: "SSI",
      customerGroupKey: "SSI",
      lines: [completeLine]
    });
    const completeErrors = context.__storageLineCompletionErrors(completeLine);
    const exportMessage = context.__storageOrderExportMessage();
    const missingProductErrors = context.__storageLineCompletionErrors({
      ...completeLine,
      product: ""
    });
    return { completeErrors, missingProductErrors, exportMessage };
  } finally {
    Object.assign(context.__state, JSON.parse(stateBefore));
  }
}

async function tabletMissingDescriptionCompletionFixture(fileName) {
  const context = await createTabletValidationContext(fileName);
  const completeLine = {
    warehouseOrder: "101097251",
    product: "1014678",
    description: "",
    targetQty: "33000",
    actualQty: "33000",
    unit: "ST",
    fromBin: "H3T3",
    fromHandlingUnit: "340063810001234567",
    picked: false,
    manual: false
  };
  context.__setTabletOrder({
    orderType: "storage",
    customerName: "SSI",
    customerGroupKey: "SSI",
    lines: [completeLine]
  });
  const completeErrors = context.__storageLineCompletionErrors(completeLine);
  const exportMessage = context.__storageOrderExportMessage();
  const missingProductErrors = context.__storageLineCompletionErrors({
    ...completeLine,
    product: ""
  });
  return { fileName, completeErrors, missingProductErrors, exportMessage };
}

async function tabletDetailLoadingFixture(fileName) {
  const detailId = "qa-tablet-detail";
  const detailOrder = {
    id: detailId,
    orderNumber: "QA-Tablet-Detail",
    customerName: "SSI",
    orderType: "picking",
    acceptedBy: "",
    lines: [
      { id: "detail-1", product: "100001", fromBin: "002-H3-S01A1", targetQty: "1", actualQty: "1", unit: "ST", picked: false },
      { id: "detail-2", product: "100002", fromBin: "002-H3-S01A2", targetQty: "2", actualQty: "2", unit: "ST", picked: false },
      { id: "detail-3", product: "100003", fromBin: "002-H3-S01A3", targetQty: "3", actualQty: "3", unit: "ST", picked: false }
    ]
  };
  const summary = {
    id: detailId,
    orderNumber: detailOrder.orderNumber,
    customerName: detailOrder.customerName,
    orderType: "picking",
    acceptedBy: "",
    total: detailOrder.lines.length,
    picked: 0
  };
  const responses = [
    { status: 200, body: detailOrder },
    { status: 500, body: { ok: false, error: "Detailtest fehlgeschlagen" } }
  ];
  const requests = [];
  const context = await createTabletValidationContext(fileName);
  configureTabletDetailTransport(context, fileName, responses, requests);
  configureTabletDetailDom(context);
  context.__setTabletOnline(true);
  context.__rememberTabletOrders([summary]);
  context.__elements.orderSelect.value = detailId;
  await context.__loadTabletOrder(detailId);

  const loaded = {
    loadedOrderId: context.__getTabletOrder()?.id || "",
    loadedAcceptedBy: context.__getTabletOrder()?.acceptedBy || "",
    renderedLineCount: context.__elements.lineList.children.length,
    takeOver: buttonState(context.__elements.takeOverButton),
    detailRequestPath: requestPath(requests[0]?.url)
  };

  context.__elements.orderSelect.value = "qa-tablet-detail-error";
  await context.__loadTabletOrder("qa-tablet-detail-error");
  const failure = {
    selectedOrderId: context.__elements.orderSelect.value,
    currentOrderId: context.__getTabletOrder()?.id || "",
    renderedLineCount: context.__elements.lineList.children.length,
    message: context.__elements.message.innerHTML
  };

  context.__setTabletOnline(true);
  const statusRules = [
    { name: "frei", acceptedBy: "" },
    { name: "eigen", acceptedBy: "QA Tablet" },
    { name: "fremd", acceptedBy: "Andere Person" },
    { name: "abgeschlossen", acceptedBy: "", completedAt: "2026-07-20T10:00:00.000Z" },
    { name: "exportiert", acceptedBy: "", exportedAt: "2026-07-20T10:00:00.000Z" }
  ].map((status) => {
    context.__setTabletOrder({
      id: `qa-status-${status.name}`,
      orderType: "picking",
      acceptedBy: status.acceptedBy,
      completedAt: status.completedAt || "",
      exportedAt: status.exportedAt || "",
      lines: [{ id: `qa-status-line-${status.name}`, product: "100001", targetQty: "1", actualQty: "1", picked: false }]
    });
    context.__renderTabletTakeOver();
    return {
      name: status.name,
      takeOver: buttonState(context.__elements.takeOverButton),
      saveDisabled: context.__elements.saveButton.disabled,
      exportDisabled: context.__elements.exportPdfButton.disabled
    };
  });

  return {
    fileName,
    summaryHasNoLines: Array.isArray(summary.lines) === false,
    ...loaded,
    failure,
    statusRules
  };
}

function configureTabletDetailTransport(context, fileName, responses, requests) {
  let responseIndex = 0;
  const nextResponse = () => responses[responseIndex++] || { status: 500, body: { ok: false, error: "Unerwarteter Detailabruf" } };
  context.fetch = async (url, options = {}) => {
    const response = nextResponse();
    requests.push({ url: String(url), method: options.method || "GET" });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body
    };
  };
  if (fileName !== "tablet-legacy.js") return;
  context.XMLHttpRequest = function FakeXmlHttpRequest() {
    this.open = (method, url) => {
      this.method = method;
      this.url = url;
    };
    this.setRequestHeader = () => {};
    this.send = () => {
      const response = nextResponse();
      requests.push({ url: this.url, method: this.method || "GET" });
      this.status = response.status;
      this.responseText = JSON.stringify(response.body);
      this.readyState = 4;
      this.onreadystatechange();
    };
  };
}

function configureTabletDetailDom(context) {
  const element = () => ({
    value: "",
    innerHTML: "",
    textContent: "",
    className: "",
    hidden: false,
    disabled: false,
    title: "",
    setAttribute() {},
    removeAttribute() {},
    focus() {}
  });
  const lineList = element();
  lineList.children = [];
  Object.defineProperty(lineList, "innerHTML", {
    get() { return this._innerHtml || ""; },
    set(value) {
      this._innerHtml = value;
      this.children = [];
    }
  });
  lineList.appendChild = (child) => {
    lineList.children.push(child);
    return child;
  };
  Object.assign(context.__elements, {
    connectionStatus: element(),
    userNameInput: { ...element(), value: "QA Tablet" },
    orderSelect: element(),
    sortModeSelect: { ...element(), value: "fromBin" },
    takeOverButton: element(),
    leaveOrderButton: element(),
    discardOrderButton: element(),
    deleteStorageOrderButton: element(),
    saveButton: element(),
    exportPdfButton: element(),
    tabletListPanel: element(),
    pickHeader: element(),
    lineList,
    message: element()
  });
  vm.runInContext(`
    updateModeUi = function () {};
    renderCompletionFields = function () {};
    renderManualStorageStartButton = function () {};
    renderStorageLineActions = function () {};
    renderAcceptedGroupInfo = function () {};
    updateCounts = function () {};
    renderLine = function (line) { return { product: line.product }; };
  `, context, { filename: "tablet-detail-test-dom.js" });
}

function buttonState(button) {
  return { hidden: Boolean(button.hidden), disabled: Boolean(button.disabled) };
}

function requestPath(url) {
  return new URL(String(url || ""), "http://127.0.0.1:4175").pathname;
}

async function manualStorageSharedBinFixture() {
  const desktop = await createAppParserContext();
  const desktopInput = createInput("H4C4");
  Object.assign(desktop.__elements, { manualStorageBinInput: desktopInput });
  Object.assign(desktop.__state, {
    orderType: "storage",
    customerName: "SSI",
    customerGroupKey: "SSI",
    lines: [{ id: "existing-desktop", warehouseOrder: "Alt", fromBin: "BESTAND", product: "0000000" }]
  });
  const desktopValid = desktop.__readManualStorageBin();
  desktopInput.value = "002-H4-SH4C4";
  const desktopFull = desktop.__readManualStorageBin();
  desktopInput.value = "";
  const desktopEmpty = desktop.__readManualStorageBin();
  const desktopLineCountBeforeInvalid = desktop.__state.lines.length;
  desktopInput.value = "INVALID!";
  const desktopInvalid = desktop.__readManualStorageBin();
  const desktopInvalidKeepsExistingLines = desktop.__state.lines.length === desktopLineCountBeforeInvalid;
  desktopInput.value = "H4C4";
  const desktopBin = desktop.__readManualStorageBin();
  const desktopPreset = { product: "1051515", description: "QA Artikel", fromBin: "ARTIKELSTAMM" };
  for (let index = 0; index < 5; index += 1) {
    desktop.__state.lines.push(desktop.__createManualStorageLine(desktopPreset, { actualQty: "5000", fromBin: desktopBin.value }));
  }
  const desktopLines = desktop.__state.lines.filter((line) => line.manual === true);
  const desktopEmptyLine = desktop.__createManualStorageLine(desktopPreset, { actualQty: "5000", fromBin: desktopEmpty.value });
  const desktopArticleBinIgnored = desktopLines.every((line) => line.fromBin !== desktopPreset.fromBin) && desktopEmptyLine.fromBin === "";
  const desktopBeforeIndividualChange = cloneJson(desktopLines);
  desktopLines[1].fromBin = "EINZELN";
  desktopLines[1].fromHandlingUnit = "340063810001234567";
  const desktopIndividualChangeIndependent = desktopLines[0].fromBin === desktopBin.value &&
    desktopLines[2].fromBin === desktopBin.value &&
    desktopLines[0].fromHandlingUnit !== desktopLines[1].fromHandlingUnit &&
    new Set(desktopLines).size === 5;

  return {
    desktop: {
      valid: desktopValid,
      full: desktopFull,
      empty: desktopEmpty,
      invalid: desktopInvalid,
      invalidKeepsExistingLines: desktopInvalidKeepsExistingLines,
      lines: desktopBeforeIndividualChange,
      emptyLine: cloneJson(desktopEmptyLine),
      articleBinIgnored: desktopArticleBinIgnored,
      individualChangeIndependent: desktopIndividualChangeIndependent
    },
    modern: await manualStorageSharedBinTabletFixture("tablet.js"),
    legacy: await manualStorageSharedBinTabletFixture("tablet-legacy.js")
  };
}

async function manualStorageSharedBinTabletFixture(fileName) {
  const context = await createTabletValidationContext(fileName);
  const binInput = createInput("H4C4");
  Object.assign(context.__elements, { manualStorageBinInput: binInput });
  context.__setTabletOrder({ orderType: "storage", customerName: "SSI", customerGroupKey: "SSI", lines: [] });
  const valid = context.__readManualStorageBin();
  binInput.value = "002-H4-SH4C4";
  const full = context.__readManualStorageBin();
  binInput.value = "";
  const empty = context.__readManualStorageBin();
  binInput.value = "INVALID!";
  const invalid = context.__readManualStorageBin();
  context.__setTabletOrder({ orderType: "storage", customerName: "SI", customerGroupKey: "SI", lines: [] });
  binInput.value = "si-a1";
  const si = context.__readManualStorageBin();
  const existingLine = { id: "existing-tablet", warehouseOrder: "Alt", fromBin: "BESTAND", product: "0000000" };
  context.__setTabletOrder({ orderType: "storage", customerName: "SSI", customerGroupKey: "SSI", lines: [existingLine] });
  binInput.value = "H4C4";
  const bin = context.__readManualStorageBin();
  const preset = { product: "1051515", description: "QA Artikel", fromBin: "ARTIKELSTAMM" };
  for (let index = 0; index < 5; index += 1) {
    context.__setTabletOrder(context.__getTabletOrder());
    context.__getTabletOrder().lines.push(context.__createManualStorageLine(context.__getTabletOrder().lines, preset, { actualQty: "5000", fromBin: bin.value }));
  }
  const lines = context.__getTabletOrder().lines.filter((line) => line.manual === true);
  const emptyLine = context.__createManualStorageLine(context.__getTabletOrder().lines, preset, { actualQty: "5000", fromBin: empty.value });
  const articleBinIgnored = lines.every((line) => line.fromBin !== preset.fromBin) && emptyLine.fromBin === "";
  const serializedLines = cloneJson(lines);
  lines[1].fromBin = "EINZELN";
  lines[1].fromHandlingUnit = "340063810001234567";
  const individualChangeIndependent = lines[0].fromBin === bin.value &&
    lines[2].fromBin === bin.value &&
    lines[0].fromHandlingUnit !== lines[1].fromHandlingUnit &&
    new Set(lines).size === 5;
  const queuePayload = JSON.stringify({ order: { lines: serializedLines }, userName: "QA Tablet" });
  return {
    fileName,
    valid,
    full,
    empty,
    invalid,
    si,
    lines: serializedLines,
    emptyLine: cloneJson(emptyLine),
    articleBinIgnored,
    individualChangeIndependent,
    queuePayloadHasAllBins: JSON.parse(queuePayload).order.lines.every((line) => line.fromBin === bin.value)
  };
}

function createInput(value) {
  return {
    value,
    focused: false,
    focus() {
      this.focused = true;
    }
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function positionNoteDedupeScenario(api) {
  const autoNotes = { quantity: "com", package: "3A1" };
  const inputLine = { positionNote: "", autoPositionNotes: cloneJson(autoNotes) };
  const automaticText = api.combinedPositionNote(inputLine);
  inputLine.positionNote = api.manualPositionNoteFromInput(automaticText, inputLine);
  const afterInputManual = inputLine.positionNote;
  const afterInputText = api.combinedPositionNote(inputLine);

  const appendedManualLine = { positionNote: "", autoPositionNotes: cloneJson(autoNotes) };
  appendedManualLine.positionNote = api.manualPositionNoteFromInput("com - 3A1 - Bitte pruefen", appendedManualLine);
  const appendedManualStored = appendedManualLine.positionNote;
  const appendedManualText = api.combinedPositionNote(appendedManualLine);

  const duplicateLine = { positionNote: "com - 3A1 - com - 3A1", autoPositionNotes: cloneJson(autoNotes) };
  api.normalizePositionNotesForSave({ lines: [duplicateLine] });
  const duplicateStored = duplicateLine.positionNote;
  const duplicateText = api.combinedPositionNote(duplicateLine);

  const manualLine = { positionNote: "Bitte prüfen - com - 3A1", autoPositionNotes: cloneJson(autoNotes) };
  api.normalizePositionNotesForSave({ lines: [manualLine] });
  const manualStored = manualLine.positionNote;
  const manualText = api.combinedPositionNote(manualLine);
  api.normalizePositionNotesForSave({ lines: [manualLine] });

  return {
    automaticText,
    afterInputManual,
    afterInputText,
    appendedManualStored,
    appendedManualText,
    duplicateStored,
    duplicateText,
    manualStored,
    manualText,
    repeatedStored: manualLine.positionNote,
    repeatedText: api.combinedPositionNote(manualLine),
    automaticOrder: api.combinedPositionNote({
      positionNote: "",
      autoPositionNotes: {
        destination: "Ziel",
        quantity: "Menge",
        quantityCorrection: "Korrektur",
        storagePallet: "Palette",
        sourceBinSystem: "System",
        package: "Gebinde"
      }
    })
  };
}

async function desktopPositionNoteDedupeFixture() {
  const context = await createAppParserContext();
  return positionNoteDedupeScenario({
    combinedPositionNote: context.__combinedPositionNote,
    manualPositionNoteFromInput: context.__manualPositionNoteFromInput,
    normalizePositionNotesForSave: context.__normalizePositionNotesForSave
  });
}

async function tabletPositionNoteDedupeFixture(fileName) {
  const context = await createTabletValidationContext(fileName);
  return positionNoteDedupeScenario({
    combinedPositionNote: context.__combinedPositionNote,
    manualPositionNoteFromInput: context.__manualPositionNoteFromInput,
    normalizePositionNotesForSave: context.__normalizePositionNotesForSave
  });
}

async function createTabletValidationContext(fileName, options = {}) {
  const globals = {
    console,
    Date,
    Math,
    URLSearchParams,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    document: {
      addEventListener: () => {},
      getElementById: () => null,
      hidden: false
    },
    navigator: { onLine: true },
    location: { href: "http://127.0.0.1:4175/tablet.html" },
    fetch: async () => ({ ok: true, json: async () => ({}) })
  };
  if (options.legacySafari === true) {
    globals.Number = function LegacySafariNumber(value) {
      return Number(value);
    };
    globals.Intl = undefined;
  }
  const context = vm.createContext(globals);
  context.window = context;
  context.globalThis = context;

  const storageHuRulesCode = await readFile(new URL("../shared/storage-hu-rules.js", import.meta.url), "utf8");
  vm.runInContext(storageHuRulesCode, context, { filename: "shared/storage-hu-rules.js" });
  const storageBinRulesCode = await readFile(new URL("../shared/storage-bin-rules.js", import.meta.url), "utf8");
  vm.runInContext(storageBinRulesCode, context, { filename: "shared/storage-bin-rules.js" });
  const quantityFormatCode = await readFile(new URL("../shared/quantity-format.js", import.meta.url), "utf8");
  vm.runInContext(quantityFormatCode, context, { filename: "shared/quantity-format.js" });
  const manualStorageRulesCode = await readFile(new URL("../shared/manual-storage-rules.js", import.meta.url), "utf8");
  vm.runInContext(manualStorageRulesCode, context, { filename: "shared/manual-storage-rules.js" });
  const tabletCode = await readFile(new URL(`../${fileName}`, import.meta.url), "utf8");
  vm.runInContext(`${tabletCode}
globalThis.__setTabletOrder = (order) => { currentOrder = order; currentMode = order?.orderType || "picking"; };
globalThis.__getTabletOrder = () => currentOrder;
globalThis.__storageLineCompletionErrors = storageLineCompletionErrors;
globalThis.__storageOrderExportMessage = storageOrderExportMessage;
globalThis.__createManualStorageLine = createManualStorageLine;
globalThis.__readManualStorageBin = readManualStorageBin;
globalThis.__combinedPositionNote = combinedPositionNote;
globalThis.__manualPositionNoteFromInput = manualPositionNoteFromInput;
globalThis.__normalizePositionNotesForSave = normalizePositionNotesForSave;
globalThis.__elements = elements;
globalThis.__loadTabletOrder = loadOrder;
globalThis.__rememberTabletOrders = rememberListedOrders;
globalThis.__setTabletOnline = (value) => { serverOnline = Boolean(value); };
globalThis.__renderTabletTakeOver = renderTakeOverButton;`, context, { filename: fileName });
  return context;
}

async function legacyTabletQuantityRenderFixture() {
  const context = await createTabletValidationContext("tablet-legacy.js", { legacySafari: true });
  const lineList = createLegacyDomElement("section");
  Object.defineProperty(lineList, "innerHTML", {
    get() { return this._innerHtml || ""; },
    set(value) {
      this._innerHtml = value;
      this.children = [];
    }
  });
  context.document.createElement = createLegacyDomElement;
  context.document.createTextNode = (value) => ({ nodeName: "#text", textContent: String(value) });
  Object.assign(context.__elements, {
    lineList,
    userNameInput: { ...createLegacyDomElement("input"), value: "QA Tablet" },
    sortModeSelect: { ...createLegacyDomElement("select"), value: "fromBin", options: [] },
    takeOverButton: createLegacyDomElement("button"),
    saveButton: createLegacyDomElement("button"),
    exportPdfButton: createLegacyDomElement("button"),
    doneCount: createLegacyDomElement("strong"),
    openCount: createLegacyDomElement("strong"),
    changedCount: createLegacyDomElement("strong")
  });
  context.__setTabletOrder({
    id: "qa-legacy-quantity-render",
    orderType: "picking",
    acceptedBy: "",
    lines: [
      { id: "legacy-quantity-1", product: "100001", fromBin: "002-H3-S01A1", targetQty: "15960", actualQty: "15960", unit: "ST", picked: false },
      { id: "legacy-quantity-2", product: "100002", fromBin: "002-H3-S01A2", targetQty: "5625", actualQty: "5625", unit: "ST", picked: false }
    ]
  });
  vm.runInContext("renderOrder();", context, { filename: "tablet-legacy-quantity-render.js" });
  return {
    numberIsFiniteAvailable: typeof context.Number.isFinite === "function",
    intlAvailable: Boolean(context.Intl),
    renderedLineCount: lineList.children.length,
    inputValues: collectLegacyDomInputValues(lineList)
  };
}

function createLegacyDomElement(tagName) {
  return {
    tagName,
    className: "",
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    readOnly: false,
    title: "",
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    setAttribute() {},
    removeAttribute() {},
    querySelector(selector) {
      if (selector !== "input") return null;
      return findLegacyDomElement(this, "input");
    }
  };
}

function findLegacyDomElement(element, tagName) {
  const children = Array.isArray(element && element.children) ? element.children : [];
  for (const child of children) {
    if (child && child.tagName === tagName) return child;
    const nested = findLegacyDomElement(child, tagName);
    if (nested) return nested;
  }
  return null;
}

function collectLegacyDomInputValues(element, values = []) {
  if (element && element.tagName === "input") values.push(element.value);
  const children = Array.isArray(element && element.children) ? element.children : [];
  for (const child of children) collectLegacyDomInputValues(child, values);
  return values;
}

async function createAppParserContext() {
  const context = vm.createContext({
    console,
    Date,
    Math,
    URLSearchParams,
    setTimeout: () => 0,
    clearTimeout: () => {},
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    document: {
      addEventListener: () => {},
      getElementById: () => null
    },
    navigator: {},
    location: { hash: "" },
    crypto: {
      randomUUID: () => `qa-line-${++parserUuidCounter}`
    }
  });
  context.window = context;
  context.globalThis = context;

  const orderHintRulesCode = await readFile(new URL("../order-hint-rules.js", import.meta.url), "utf8");
  vm.runInContext(orderHintRulesCode, context, { filename: "order-hint-rules.js" });
  const storageHuRulesCode = await readFile(new URL("../shared/storage-hu-rules.js", import.meta.url), "utf8");
  vm.runInContext(storageHuRulesCode, context, { filename: "shared/storage-hu-rules.js" });
  const storageBinRulesCode = await readFile(new URL("../shared/storage-bin-rules.js", import.meta.url), "utf8");
  vm.runInContext(storageBinRulesCode, context, { filename: "shared/storage-bin-rules.js" });
  const manualStorageRulesCode = await readFile(new URL("../shared/manual-storage-rules.js", import.meta.url), "utf8");
  vm.runInContext(manualStorageRulesCode, context, { filename: "shared/manual-storage-rules.js" });
  const importLineHelpersCode = await readFile(new URL("../app-import-line-helpers.js", import.meta.url), "utf8");
  vm.runInContext(importLineHelpersCode, context, { filename: "app-import-line-helpers.js" });
  const importDiagnosticsCode = await readFile(new URL("../app-import-diagnostics.js", import.meta.url), "utf8");
  vm.runInContext(importDiagnosticsCode, context, { filename: "app-import-diagnostics.js" });
  const stateHelpersCode = await readFile(new URL("../app-state-helpers.js", import.meta.url), "utf8");
  vm.runInContext(stateHelpersCode, context, { filename: "app-state-helpers.js" });
  const uiHelpersCode = await readFile(new URL("../app-ui-helpers.js", import.meta.url), "utf8");
  vm.runInContext(uiHelpersCode, context, { filename: "app-ui-helpers.js" });
  const pickingParserCode = await readFile(new URL("../app-picking-parser.js", import.meta.url), "utf8");
  vm.runInContext(pickingParserCode, context, { filename: "app-picking-parser.js" });

  const appCode = await readFile(new URL("../app.js", import.meta.url), "utf8");
  vm.runInContext(`${appCode}\nglobalThis.__parseOrderText = parseOrderText; globalThis.__validatePickingImport = validatePickingImport; globalThis.__buildBestellscheinOcrText = buildBestellscheinOcrText; globalThis.__buildPickingOcrCandidate = buildPickingOcrCandidate; globalThis.__isUsablePickingOcrSelection = isUsablePickingOcrSelection; globalThis.__isAcceptedPdfTextImportCandidate = isAcceptedPdfTextImportCandidate; globalThis.__isAcceptedSiBestellscheinOcrCandidate = isAcceptedSiBestellscheinOcrCandidate; globalThis.__scorePickingImportCandidate = scorePickingImportCandidate; globalThis.__collectLoadingSlipLinesFromOcrCandidates = collectLoadingSlipLinesFromOcrCandidates; globalThis.__shouldRunLoadingSlipOcrFallback = shouldRunLoadingSlipOcrFallback; globalThis.__appendLoadingSlipLinesToParsed = appendLoadingSlipLinesToParsed; globalThis.__mergeBestellscheinOcrLines = mergeBestellscheinOcrLines; globalThis.__correctedOcrWarehouseQuantityFromStock = correctedOcrWarehouseQuantityFromStock; globalThis.__pickingImportDiagnostics = pickingImportDiagnostics; globalThis.__buildPickingImportLineDiagnostics = buildPickingImportLineDiagnostics; globalThis.__pickingFromBinShapeDiagnostic = pickingFromBinShapeDiagnostic; globalThis.__fromBinReviewDiagnosticForValue = fromBinReviewDiagnosticForValue; globalThis.__fromBinReviewPatchForValue = fromBinReviewPatchForValue; globalThis.__isFromBinReviewConfirmedForValue = isFromBinReviewConfirmedForValue; globalThis.__canConfirmFromBinReview = canConfirmFromBinReview; globalThis.__siSystemFromBinPatchForLine = siSystemFromBinPatchForLine; globalThis.__siBestellscheinOrientationProbeCandidate = siBestellscheinOrientationProbeCandidate; globalThis.__selectSiBestellscheinOrientationCandidate = selectSiBestellscheinOrientationCandidate; globalThis.__selectSiBestellscheinOrientationTieBreakCandidate = selectSiBestellscheinOrientationTieBreakCandidate; globalThis.__bestellscheinPageNotice = bestellscheinPageNotice; globalThis.__applyFromBinReviewWarnings = applyFromBinReviewWarnings; globalThis.__orderExportCompletionMessage = orderExportCompletionMessage; globalThis.__fromBinReviewBlockMessage = fromBinReviewBlockMessage; globalThis.__removeClosestLabelOrElement = removeClosestLabelOrElement; globalThis.__pickingXlsxImportText = pickingXlsxImportText; globalThis.__importText = importText; globalThis.__state = state; globalThis.__currentUser = currentUser; globalThis.__elements = elements; globalThis.__renderReleaseButton = renderReleaseButton; globalThis.__setServerOnline = (value) => { serverOnline = Boolean(value); };`, context, { filename: "app.js" });
  vm.runInContext("globalThis.__hasOpenFromBinReviewWarnings = hasOpenFromBinReviewWarnings; globalThis.__releaseCurrentOrder = releaseCurrentOrder; globalThis.__auditLoadingSlipImport = auditLoadingSlipImport;", context, { filename: "app.js" });
  vm.runInContext("globalThis.__annotateDestinationExceptions = annotateDestinationExceptions; globalThis.__createLine = createLine;", context, { filename: "app.js" });
  vm.runInContext("globalThis.__combinedPositionNote = combinedPositionNote; globalThis.__manualPositionNoteFromInput = manualPositionNoteFromInput; globalThis.__normalizePositionNotesForSave = normalizePositionNotesForSave;", context, { filename: "app.js" });
  vm.runInContext("globalThis.__parseLoadingSlipLines = parseLoadingSlipLines; globalThis.__appendAllLoadingSlipLines = appendAllLoadingSlipLines; globalThis.__canAppendLoadingSlipToXlsxDraft = canAppendLoadingSlipToXlsxDraft; globalThis.__renderSaveOrderButton = renderSaveOrderButton;", context, { filename: "app.js" });
  vm.runInContext("globalThis.__createManualStorageLine = createManualStorageLine; globalThis.__readManualStorageBin = readManualStorageBin;", context, { filename: "app.js" });
  vm.runInContext("globalThis.__storageLineCompletionErrors = storageLineCompletionErrors; globalThis.__storageOrderExportMessage = storageOrderExportMessage;", context, { filename: "app.js" });
  return context;
}

async function loadingSlipCleanupGuardFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const context = appParserContext;
  const stateBefore = JSON.stringify(context.__state);
  const removals = [];
  let localStorageWrites = 0;
  const originalSetItem = context.localStorage.setItem;
  context.localStorage.setItem = () => {
    localStorageWrites += 1;
  };
  try {
    const labelContainer = { remove: () => removals.push("label") };
    const elementWithLabel = {
      closest: (selector) => selector === "label" ? labelContainer : null,
      remove: () => removals.push("element-with-label")
    };
    const elementWithoutLabel = {
      closest: () => null,
      remove: () => removals.push("element-without-label")
    };
    return {
      nullSafe: context.__removeClosestLabelOrElement(null) === false,
      noLabelRemovedElement: context.__removeClosestLabelOrElement(elementWithoutLabel) === true && removals.includes("element-without-label"),
      labelRemovedContainer: context.__removeClosestLabelOrElement(elementWithLabel) === true && removals.includes("label") && !removals.includes("element-with-label"),
      noStateMutation: JSON.stringify(context.__state) === stateBefore,
      noLocalStorageWrites: localStorageWrites === 0,
      removals
    };
  } finally {
    context.localStorage.setItem = originalSetItem;
  }
}

function pickingTextFixture(orderHintBlock, orderNumber = "60126") {
  return [
    `Bestellschein Nr.: ${orderNumber}`,
    orderHintBlock,
    "Kunde: QA Importkunde",
    "1 123456 Serviceartikel 5 Stk"
  ].filter(Boolean).join("\n");
}

async function pickingBinShapeFixture(value) {
  if (!appParserContext) appParserContext = await createAppParserContext();
  return {
    value,
    shape: appParserContext.__pickingFromBinShapeDiagnostic(value),
    review: appParserContext.__fromBinReviewDiagnosticForValue(value)
  };
}

async function siSystemFromBinFillFixture(mode) {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const line = {
    product: "1067349",
    fromHandlingUnit: "72638937",
    fromBin: mode === "valid-existing" ? "002-H7-S12A3" : "",
    targetQty: "85",
    actualQty: "85",
    unit: "Stk",
    autoPositionNotes: {}
  };
  const locations = {
    unique: [
      { materialnummer: "1067349", leNummer: "72638937", lagerplatz: "002-H7-S12A3", mengeStueck: 85 }
    ],
    ambiguous: [
      { materialnummer: "1067349", leNummer: "72638937", lagerplatz: "002-H7-S12A3", mengeStueck: 85 },
      { materialnummer: "1067349", leNummer: "72638937", lagerplatz: "002-H7-S13A1", mengeStueck: 85 }
    ],
    missing: [],
    "valid-existing": [
      { materialnummer: "1067349", leNummer: "72638937", lagerplatz: "002-H7-S13A1", mengeStueck: 85 }
    ]
  }[mode] || [];
  return appParserContext.__siSystemFromBinPatchForLine(line, locations);
}

async function parseRefinedBestellscheinOcrFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const context = appParserContext;
  const sourceText = [
    "Bestellschein Nr.:",
    "60130",
    "Auslagerung: 030 / 012 Hummel Logistik SI",
    "Bestellhinweis:",
    "Service Ecke",
    "Datum: 23.06.2026",
    "Entnahmeanweisungen: von 012 ( Hummel Logistik SI ) an 421 ( Palettierung )",
    "1000094 1/2 Holz-Einwegpalette 80x60 cm 20 ST 72634029 DE",
    "Lagerplatz: 012/1000094",
    "31366755 49484229"
  ].join("\n");
  const refinedText = context.__buildBestellscheinOcrText(sourceText, [{
    product: "1000094",
    description: "1/2 Holz-Einwegpalette 80x60 cm",
    targetQty: "20",
    unit: "ST",
    fromBin: "",
    fromHandlingUnit: "31366755"
  }]);
  return context.__parseOrderText(refinedText);
}

async function parseRefinedBestellscheinLateOrderHintFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const context = appParserContext;
  const sourceText = [
    "Bestellschein Nr.: 59033",
    "Auslagerung: 030 / 012 Hummel Logistik SI",
    "Datum: 23.06.2026",
    "1076846 Header start beginning 77/35 M 30 ST",
    "Lagerplatz: 012/1076846",
    "Bestellhinweis:",
    "com",
    "30684317"
  ].join("\n");
  const refinedText = context.__buildBestellscheinOcrText(sourceText, [{
    product: "1076846",
    description: "Header start beginning 77/35 M",
    targetQty: "30",
    unit: "ST",
    fromBin: "",
    fromHandlingUnit: "30684317"
  }]);
  return context.__parseOrderText(refinedText);
}

async function siBestellscheinOcrCandidateFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Bestellschein Nr.: 60210",
    "Auslagerung:",
    "030 / 012 Hummel Logistik SI",
    "Entnahmeanweisungen: von 012 ( Hummel Logistik SI ) an 421 ( Palettierung )",
    "1076846 Header start beginning 77/35 M 30 ST",
    "Lagerplatz: 012/1076846",
    "30684317"
  ].join("\n");
  const candidate = appParserContext.__buildPickingOcrCandidate({
    key: "qa-si-bestellschein",
    label: "qa SI Bestellschein",
    scale: 6,
    dpi: "1000",
    rotation: 0,
    pages: [text],
    pageRawLines: [7]
  });
  return {
    accepted: appParserContext.__isUsablePickingOcrSelection(candidate),
    score: candidate.score,
    metrics: candidate.metrics,
    parsed: candidate.parsed
  };
}

async function siBestellscheinOrientationProbeFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const rotatedText = [
    "Bestellschein Nr.: 60389",
    "Auslagerung: 030 / 012 Hummel Logistik SI",
    "Seite: 1 (von 2)",
    "Bestellhinweis: Service Ecke",
    "Entnahmeanweisungen: von 012 ( Hummel Logistik SI ) an 421 ( Palettierung )",
    "1067349 Korpus fuer 77/35 M - Vers.1 85 ST 72638937 DE",
    "1067350 Sockelschlitten fuer 77/35 M - Vers.1 10 ST 72638937 DE",
    "1067350 Sockelschlitten fuer 77/35 M - Vers.1 14 ST 72638937 DE",
    "1067353 Stuelpkarton fuer 77/35 M - Vers.1 250 ST 72638937 DE",
    "1075751 Umkarton XS Thekendisplay 600 ST 72638936 DE"
  ].join("\n");
  const garbledText = "sr SYS MY MAN ITI 1616/01/210 Ze|diabe 30 9E68E92 IS 009 Aejdsipuexeyl";
  const partialText = [
    "Bestellschein Nr.: 60389",
    "Auslagerung: 030 / 012 Hummel Logistik SI",
    "Seite: 1 (von 2)",
    "1067349 Korpus fuer 77/35 M - Vers.1 85 ST 72638937 DE"
  ].join("\n");
  const candidates = [
    appParserContext.__siBestellscheinOrientationProbeCandidate(garbledText, { rotation: 0, scale: 2, dpi: "180" }),
    appParserContext.__siBestellscheinOrientationProbeCandidate(rotatedText, { rotation: 90, scale: 2, dpi: "180" }),
    appParserContext.__siBestellscheinOrientationProbeCandidate(partialText, { rotation: 180, scale: 2, dpi: "180" })
  ];
  const selected = appParserContext.__selectSiBestellscheinOrientationCandidate(candidates);
  return {
    selectedOrientation: selected.selectedOrientation,
    selectedCandidate: selected.selectedCandidate,
    candidates: selected.candidates.map((candidate) => ({
      rotation: candidate.rotation,
      score: candidate.score,
      siLike: candidate.siLike,
      bestellscheinCompleteCount: candidate.bestellscheinCompleteCount
    })),
    pageNotice: appParserContext.__bestellscheinPageNotice(rotatedText, 1)
  };
}

async function siBestellscheinOrientationTieBreakFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const probe = appParserContext.__selectSiBestellscheinOrientationCandidate([
    {
      rotation: 90,
      score: 11450,
      markerScore: 8,
      siLike: true,
      bestellscheinLike: true,
      expectedRows: 2,
      bestellscheinCompleteCount: 1,
      markerHits: {
        bestellschein: true,
        entnahmeanweisungen: true,
        siWarehouse: true,
        siCustomer: true,
        articleNumbers: true,
        quantities: true,
        handlingUnits: true,
        pageNotice: true
      }
    },
    {
      rotation: 180,
      score: 11000,
      markerScore: 7,
      siLike: true,
      bestellscheinLike: true,
      expectedRows: 2,
      bestellscheinCompleteCount: 1,
      markerHits: {
        bestellschein: true,
        entnahmeanweisungen: true,
        siWarehouse: true,
        siCustomer: true,
        articleNumbers: true,
        quantities: true,
        handlingUnits: false,
        pageNotice: true
      }
    }
  ]);
  const partialRotation90 = [
    "Bestellschein Nr.: 60390",
    "Auslagerung: 030 / 012 Hummel Logistik SI",
    "Seite: 1 (von 2)",
    "Bestellhinweis: Service Ecke",
    "Entnahmeanweisungen: von 012 ( Hummel Logistik SI ) an 421 ( Palettierung )",
    "1047652 Sicherungseinlage vorne f. 77/35 M-Floor 138 ST 49494594 DE"
  ].join("\n");
  const fullRotation180 = [
    "Bestellschein Nr.: 60390",
    "Auslagerung: 030 / 012 Hummel Logistik SI",
    "Seite: 1 (von 2)",
    "Bestellhinweis: Service Ecke",
    "Entnahmeanweisungen: von 012 ( Hummel Logistik SI ) an 421 ( Palettierung )",
    "1047651 Stegeinsatz fuer 77/35 M-Floorstand 2x 718 ST 49494594 DE",
    "1047652 Sicherungseinlage vorne f. 77/35 M-Floor 138 ST 29562275 DE"
  ].join("\n");
  const result = {
    candidates: [
      appParserContext.__buildPickingOcrCandidate({
        key: "qa-si-tiebreak-90",
        label: "qa SI Tie-Break 90",
        scale: 3.5,
        dpi: "300",
        rotation: 90,
        pages: [partialRotation90],
        pageRawLines: [6]
      }),
      appParserContext.__buildPickingOcrCandidate({
        key: "qa-si-tiebreak-180",
        label: "qa SI Tie-Break 180",
        scale: 3.5,
        dpi: "300",
        rotation: 180,
        pages: [fullRotation180],
        pageRawLines: [7]
      })
    ]
  };
  const selected = appParserContext.__selectSiBestellscheinOrientationTieBreakCandidate(result, [90, 180]);
  return {
    probeSelectedOrientation: probe.selectedOrientation,
    probeRejectReason: probe.rejectReason,
    selectedRotation: selected.selectedCandidate?.rotation ?? "",
    selectedAccepted: appParserContext.__isAcceptedSiBestellscheinOcrCandidate(selected.selectedCandidate),
    selectedLines: selected.selectedCandidate?.parsed?.lines?.length || 0,
    selectedOrderNumber: selected.selectedCandidate?.parsed?.orderNumber || "",
    selectedCustomerName: selected.selectedCandidate?.parsed?.customerName || "",
    candidates: selected.candidates,
    pageNotice: appParserContext.__bestellscheinPageNotice(selected.selectedCandidate?.text || "", 1)
  };
}

async function pdfTextFastAcceptFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "80019999 340063810002111 002-H4-SAA8C3 1063588 938 ST Regranulat 9021-0OUT"
  ].join("\n");
  return pdfTextCandidateAcceptance(text);
}

async function weakPdfTextFastAcceptFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "80019999 340063810002111 1063588 Regranulat 938 ST 9021-0OUT"
  ].join("\n");
  return pdfTextCandidateAcceptance(text);
}

function pdfTextCandidateAcceptance(text) {
  const parsed = appParserContext.__parseOrderText(text);
  const issues = appParserContext.__validatePickingImport(text, parsed);
  const qualityScore = appParserContext.__scorePickingImportCandidate(text, parsed, issues);
  const candidate = {
    text,
    parsed,
    issues,
    qualityScore,
    documentType: "lageraufgabe"
  };
  return {
    accepted: appParserContext.__isAcceptedPdfTextImportCandidate(candidate),
    qualityScore,
    parsed,
    issues
  };
}

async function loadingSlipFromSecondaryOcrCandidateFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const mainText = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "80019999 340063810002111 002-H4-SAA8C3 1063588 938 ST Regranulat 9021-0OUT",
    "MMS 00 000 vT",
    "UI9Y9IS9IpP"
  ].join("\n");
  const rotatedLoadingSlipText = [
    "Nummer: A 12 34 56 78 90",
    "1076846 Zusatz Artikel 12 ST"
  ].join("\n");
  const mainCandidate = appParserContext.__buildPickingOcrCandidate({
    key: "main-upright",
    label: "main upright",
    scale: 6,
    dpi: "1000",
    rotation: 0,
    pages: [mainText],
    pageRawLines: [4]
  });
  const loadingCandidate = appParserContext.__buildPickingOcrCandidate({
    key: "loading-rotated",
    label: "loading rotated",
    scale: 6,
    dpi: "1000",
    rotation: 180,
    pages: [rotatedLoadingSlipText],
    pageRawLines: [2]
  });
  const loadingSlipResult = appParserContext.__collectLoadingSlipLinesFromOcrCandidates([mainCandidate, loadingCandidate]);
  const parsed = appParserContext.__appendLoadingSlipLinesToParsed(mainCandidate.parsed, loadingSlipResult.lines);
  const loadingLines = parsed.lines.filter((line) => line.lineType === "loading-slip");
  return {
    normalCount: parsed.lines.filter((line) => line.lineType !== "loading-slip").length,
    loadingCount: loadingLines.length,
    loadingLine: loadingLines[0] || null,
    diagnostics: loadingSlipResult.diagnostics
  };
}

async function loadingSlipThreePositionsFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const sourceText = [
    "Ladeschein",
    "Nummer: V260009624/0",
    "1066526 Sicherheitsstreifen fuer 7015-01 1072595 PET-Etui fuer 7015/02-05 1072598 PET-Etui fuer 7015-01 15.960,00 Stueck 5.625,00 Stueck 5.625,00 Stueck"
  ].join("\n");
  const loadingSlipResult = appParserContext.__collectLoadingSlipLinesFromOcrCandidates([{
    key: "loading-slip-three-positions",
    label: "loading slip three positions",
    scale: 6,
    dpi: "1000",
    rotation: 90,
    text: sourceText
  }]);
  const parsed = appParserContext.__appendLoadingSlipLinesToParsed({
    lines: [{ id: "normal-position", product: "1060000", targetQty: "1", actualQty: "1", unit: "ST" }]
  }, loadingSlipResult.lines);
  const loadingLines = parsed.lines.filter((line) => line.lineType === "loading-slip");
  const audit = appParserContext.__auditLoadingSlipImport(sourceText.split("\n"), parsed.lines);
  const reappended = appParserContext.__appendLoadingSlipLinesToParsed(parsed, loadingSlipResult.lines);
  return {
    normalCount: parsed.lines.filter((line) => line.lineType !== "loading-slip").length,
    loadingLines,
    audit,
    reappendedLineCount: reappended.lines.length
  };
}

async function rotatedLoadingSlipFallbackFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const pickingPage = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "80019999 340063810002111 002-H4-SAA8C3 1063588 938 ST Regranulat 9021-0OUT",
    "MMS 00 000 vT",
    "UI9Y9IS9IpP"
  ].join("\n");
  const rotatedLoadingSlipPage = [
    "Ladeschein",
    "Nummer: V260009624/0",
    "1066526 Sicherheitsstreifen fuer 7015-01 1072595 PET-Etui fuer 7015/02-05 1072598 PET-Etui fuer 7015-01 15.960,00 Stueck 5.625,00 Stueck 5.625,00 Stueck"
  ].join("\n");
  const uprightCandidate = appParserContext.__buildPickingOcrCandidate({
    key: "upright-picking-with-missing-page",
    label: "upright picking with missing page",
    scale: 6,
    dpi: "1000",
    rotation: 0,
    pages: [pickingPage, ""],
    pageRawLines: [4, 0]
  });
  const rotatedLoadingSlipCandidate = appParserContext.__buildPickingOcrCandidate({
    key: "rotated-loading-slip-page",
    label: "rotated loading slip page",
    scale: 6,
    dpi: "1000",
    rotation: 90,
    pages: ["", rotatedLoadingSlipPage],
    pageRawLines: [0, 3]
  });
  const loadingSlipResult = appParserContext.__collectLoadingSlipLinesFromOcrCandidates([uprightCandidate, rotatedLoadingSlipCandidate]);
  const parsed = appParserContext.__appendLoadingSlipLinesToParsed(uprightCandidate.parsed, loadingSlipResult.lines);
  return {
    fallbackNeeded: appParserContext.__shouldRunLoadingSlipOcrFallback({
      best: uprightCandidate,
      candidates: [uprightCandidate]
    }),
    normalCount: parsed.lines.filter((line) => line.lineType !== "loading-slip").length,
    loadingLines: parsed.lines.filter((line) => line.lineType === "loading-slip")
  };
}

async function mergeBestellscheinHuFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  return appParserContext.__mergeBestellscheinOcrLines([
    {
      product: "1076846",
      description: "Header start beginning 77/35 M",
      targetQty: "30",
      unit: "ST",
      fromHandlingUnit: "30684310"
    },
    {
      product: "1076846",
      description: "Header start beginning 77/35 M",
      targetQty: "30",
      unit: "ST",
      fromHandlingUnit: "30684311"
    }
  ], [
    {
      product: "1076846",
      description: "Header start beginning 77/35 M",
      targetQty: "30",
      unit: "ST",
      fromHandlingUnit: "30684311"
    },
    {
      product: "1076846",
      description: "Header start beginning 77/35 M",
      targetQty: "30",
      unit: "ST",
      fromHandlingUnit: "30684310"
    }
  ]);
}

async function mergeAmbiguousMissingBestellscheinHuFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  return appParserContext.__mergeBestellscheinOcrLines([
    {
      product: "1076846",
      description: "Header start beginning 77/35 M",
      targetQty: "30",
      unit: "ST",
      fromHandlingUnit: "",
      fromHandlingUnitEditable: true
    },
    {
      product: "1076846",
      description: "Header start beginning 77/35 M",
      targetQty: "30",
      unit: "ST",
      fromHandlingUnit: "30684311"
    }
  ], [
    {
      product: "1076846",
      description: "Header start beginning 77/35 M",
      targetQty: "30",
      unit: "ST",
      fromHandlingUnit: "30684311"
    }
  ]);
}

async function mergeAmbiguousWeakBestellscheinHuFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  return appParserContext.__mergeBestellscheinOcrLines([
    {
      product: "1076846",
      description: "Header start beginning 77/35 M",
      targetQty: "30",
      unit: "ST",
      fromHandlingUnit: "3068431"
    },
    {
      product: "1076846",
      description: "Header start beginning 77/35 M",
      targetQty: "30",
      unit: "ST",
      fromHandlingUnit: "30684311"
    }
  ], [
    {
      product: "1076846",
      description: "Header start beginning 77/35 M",
      targetQty: "30",
      unit: "ST",
      fromHandlingUnit: "30684311"
    }
  ]);
}

async function warehouseQuantityCorrectionFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  return {
    corrected: appParserContext.__correctedOcrWarehouseQuantityFromStock({ targetQty: "038" }, 938),
    normal: appParserContext.__correctedOcrWarehouseQuantityFromStock({ targetQty: "938" }, 938),
    unrelated: appParserContext.__correctedOcrWarehouseQuantityFromStock({ targetQty: "038" }, 1238)
  };
}

async function parseWarehouseMissingBinFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lagerauftrag Von-Handling-Unit Von-Lagerplatz Produkt Produktbeschreibung Soll Einheit Nach-Lagerplatz",
    "80015595 30684317 1076846 Header start beginning 77/35 M 938 ST 9021-0OUT"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  return {
    parsed,
    issues: appParserContext.__validatePickingImport(text, parsed)
  };
}

async function parseWarehouseSplitMultiplierWithoutHuFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "101097251 022-H4-R8 1014678 2x 33000 4000-KAPPE"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  return {
    parsed,
    issues: appParserContext.__validatePickingImport(text, parsed)
  };
}

async function parseWarehouseAdjacentSameProductSplitMultiplierFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "101097250 022-H4-R7 1014678 6x33000 4000-KAPPE",
    "101097251 022-H4-R8 1014678 2 x 33000 4000-KAPPE"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  return {
    parsed,
    issues: appParserContext.__validatePickingImport(text, parsed),
    diagnostics: appParserContext.__pickingImportDiagnostics(text, parsed, {
      source: "qa-split-multiplier"
    })
  };
}

async function parseWarehouseLongTaskFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "20260625080515 340063810002111 002-H4-SAA8C3 1063588 938 ST Regranulat 9021-0OUT"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  return {
    parsed,
    issues: appParserContext.__validatePickingImport(text, parsed)
  };
}

async function parseWarehouseRawBinFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "20260625080515 340063810002072174 002-H3-SO4D1 1060610 12 ST Referenzprodukt 9021-0OUT",
    "20260625080515 340063810002072181 002-H3-SO4D1 1060610 18 ST Referenzprodukt 9021-0OUT"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  return {
    parsed,
    issues: appParserContext.__validatePickingImport(text, parsed),
    diagnostics: appParserContext.__buildPickingImportLineDiagnostics(parsed.lines)
  };
}

async function pickingDiagnosticExpansionFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "20260625080515 340063810002072174 002-H3-SO4D1 1060610 12 ST Referenzprodukt 9021-0OUT",
    "20260625080515 340063810002072181 002-H3-SO4D1 1060610 18 ST Referenzprodukt 9021-0OUT"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  const diagnostics = appParserContext.__pickingImportDiagnostics(text, parsed, {
    source: "pdf-text",
    qualityAccepted: true,
    qualityScore: 6200,
    loadingSlipCandidates: [{
      label: "loading rotated",
      expected: 1,
      parsed: 1,
      added: ["A1234567890"]
    }]
  });
  const lineDiagnostics = appParserContext.__buildPickingImportLineDiagnostics(parsed.lines, parsed.lines, { text });
  return { parsed, diagnostics, lineDiagnostics };
}

async function pickingSuspiciousBinDiagnosticFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "101094595 340063810002093506 002-H3-SOSA3 806713 720 ST SPITZE BOSS 9021-0OUT"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  const diagnostics = appParserContext.__pickingImportDiagnostics(text, parsed, {
    source: "pdf-text",
    qualityAccepted: true,
    qualityScore: 6200
  });
  const lineDiagnostics = appParserContext.__buildPickingImportLineDiagnostics(parsed.lines, parsed.lines, { text, diagnostics });
  return { parsed, diagnostics, lineDiagnostics };
}

async function pickingSuspiciousBinWithoutRecheckDiagnosticFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "101094595 340063810002093506 002-H3-SOSA3 806713 720 ST SPITZE BOSS 9021-0OUT"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  const diagnostics = appParserContext.__pickingImportDiagnostics(text, parsed, {
    source: "ocr-candidate",
    qualityAccepted: true,
    qualityScore: 6200,
    fromBinRechecks: []
  });
  const lineDiagnostics = appParserContext.__buildPickingImportLineDiagnostics(parsed.lines, parsed.lines, { text, diagnostics });
  return { parsed, diagnostics, lineDiagnostics };
}

async function parseWarehouseOcrConfusedBinFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "101089273 340063810002088229 002-H3-5010A2 808650 39 ST SPEICHER BOSS XPE4369894 9021-00UT",
    "101089277 340063810002105926 002-H3-5Z2D1 751393 74250 ST SCHAFT FUER POINT88+PEN68 9021-00UT"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  return {
    parsed,
    issues: appParserContext.__validatePickingImport(text, parsed)
  };
}

async function parseWarehouseAnsbachDestinationFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "80015632 30684317 002-H1-SAM5C2 1076846 633 ST BOSS NatureColors umbra 70//9020-ANSBACH |",
    "Co pa 633",
    "80015631 30684318 002-H1-SAM5C3 1076847 250 ST Header star beginning 9020-ANSBACH",
    "ZOOS CA Oo)"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  return {
    parsed,
    issues: appParserContext.__validatePickingImport(text, parsed)
  };
}

async function parseWarehouseInselDestinationFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "80015585 30684319 002-H1-SAM5C4 1076846 1.000 ST Headercard Swing cool Demon H9020-INSEL-ROTH",
    "OF, 03.24"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  return {
    parsed,
    issues: appParserContext.__validatePickingImport(text, parsed)
  };
}

async function parseWarehouseMixedSsiDestinationFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "80015640 30684320 002-H1-SAM5C2 1076846 633 ST BOSS NatureColors umbra 9020-ANSBACH",
    "80015641 30684321 002-H1-SAM5C3 1076847 250 ST Header start beginning 9021-0OUT"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  return {
    parsed,
    issues: appParserContext.__validatePickingImport(text, parsed)
  };
}

async function parseWarehouseMixedNonSsiDestinationFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const text = [
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz",
    "80015642 30684322 002-H1-SAM5C2 1076846 633 ST BOSS NatureColors umbra 9020-ANSBACH",
    "80015643 30684323 002-H1-SAM5C3 1076847 250 ST Header start beginning 9030-KUNDE"
  ].join("\n");
  const parsed = appParserContext.__parseOrderText(text);
  return {
    parsed,
    issues: appParserContext.__validatePickingImport(text, parsed)
  };
}

async function importNoPositionPickingFixture() {
  if (!appParserContext) appParserContext = await createAppParserContext();
  const context = appParserContext;
  context.__state.orderNumber = "KEEP-ORDER";
  context.__state.customerName = "KEEP-CUSTOMER";
  context.__state.lines = [{
    product: "KEEP",
    fromBin: "KEEP-BIN"
  }];
  const before = {
    orderNumber: context.__state.orderNumber,
    customerName: context.__state.customerName,
    lineCount: context.__state.lines.length
  };
  const result = await context.__importText([
    "Auftragsnummer: SHOULD-NOT-APPLY",
    "Kunde: SHOULD-NOT-APPLY",
    "Lageraufgabe Von-Handling-Unit Von-Lagerplatz Produkt Menge Basis Produktbeschreibung Nach-Lagerplatz"
  ].join("\n"), "qa-no-position.pdf");
  const after = {
    orderNumber: context.__state.orderNumber,
    customerName: context.__state.customerName,
    lineCount: context.__state.lines.length
  };
  return { before, after, result };
}

function guardAgainstAccidentalLiveWrites() {
  const url = new URL(BASE_URL);
  const isDefaultServerPort = url.port === "4174";
  if (!isDefaultServerPort || ALLOW_LIVE) return;
  throw new Error(
    "QA-Matrix schreibt Testartikel und Testbuchungen. Bitte gegen eine isolierte Kopie starten " +
    "(PowerShell: $env:QA_BASE_URL = \"http://127.0.0.1:4175\"; npm.cmd run test:qa) " +
    "oder bewusst QA_ALLOW_LIVE=1 setzen."
  );
}

async function guardAgainstUnsafeQaServerContext() {
  if (ALLOW_LIVE) return;

  const health = await request("/api/health");
  if (health.status !== 200 || !health.body?.ok) {
    throw new Error(`QA-Server nicht erreichbar oder /api/health ungueltig: ${health.status} ${JSON.stringify(health.body)}`);
  }

  const root = repoRootDir();
  const tmpRoot = path.join(root, "tmp");
  const rootIsQaWorkspace = isQaWorkspaceRoot(root);
  const unsafeDirs = ["exportDir", "importDir", "archiveDir"]
    .map((key) => ({ key, value: String(health.body?.[key] || "").trim() }))
    .filter((entry) => {
      if (!entry.value || !isPathInside(entry.value, root)) return true;
      return !rootIsQaWorkspace && !isPathInside(entry.value, tmpRoot);
    });

  if (unsafeDirs.length) {
    throw new Error(
      "QA_BASE_URL zeigt nicht auf eine isolierte QA-Kopie unter tmp/ oder auf eine gestartete QA-Workspace-Kopie. " +
      `Unsichere Pfade: ${unsafeDirs.map((entry) => `${entry.key}=${entry.value}`).join(", ")}`
    );
  }
}

function isQaWorkspaceRoot(rootPath) {
  const base = path.basename(path.resolve(rootPath)).toLowerCase();
  const parent = path.basename(path.dirname(path.resolve(rootPath))).toLowerCase();
  return parent === "tmp" && /^qa-workspace-\d{8}-\d{6}$/.test(base);
}

function isPathInside(candidatePath, parentPath) {
  const candidate = path.resolve(candidatePath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, candidate);
  return relative === "" || Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
