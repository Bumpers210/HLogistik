import { normalizeSsiStorageBin } from "../server/helpers.mjs";
import {
  MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX,
  normalizeManualStoragePositionCreateCount,
} from "../server/rules/order-rules.mjs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const BASE_URL = String(globalThis.process?.env?.QA_BASE_URL || "http://127.0.0.1:4175").replace(/\/+$/, "");
const ALLOW_LIVE = globalThis.process?.env?.QA_ALLOW_LIVE === "1";
const ROLE_HEADERS = { "content-type": "application/json; charset=utf-8", "x-user-group": "buero" };
const TABLET_HEADERS = { "content-type": "application/json; charset=utf-8", "x-user-group": "tablet" };
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
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  check("ssi H3 O-Y shorthand normalizes to direct H3 bin", normalizeSsiStorageBin("H3T1") === "002-H3-T1", normalizeSsiStorageBin("H3T1"));
  check("ssi H3 O-Y shorthand accepts hyphen", normalizeSsiStorageBin("H3-T1") === "002-H3-T1", normalizeSsiStorageBin("H3-T1"));
  check("ssi H3 direct bin remains stable", normalizeSsiStorageBin("002-H3-T1") === "002-H3-T1", normalizeSsiStorageBin("002-H3-T1"));
  check("ssi A shelf normalizes to H1", normalizeSsiStorageBin("AA8C3") === "002-H1-SAA8C3", normalizeSsiStorageBin("AA8C3"));
  check("ssi AT shelf normalizes to H1", normalizeSsiStorageBin("AT8A1") === "002-H1-SAT8A1", normalizeSsiStorageBin("AT8A1"));
  check("ssi AU shelf normalizes to H4", normalizeSsiStorageBin("AU8A1") === "002-H4-SAU8A1", normalizeSsiStorageBin("AU8A1"));
  check("manual storage count default is 1", normalizeManualStoragePositionCreateCount("").value === 1, JSON.stringify(normalizeManualStoragePositionCreateCount("")));
  check("manual storage invalid count rejected", normalizeManualStoragePositionCreateCount("0").ok === false, JSON.stringify(normalizeManualStoragePositionCreateCount("0")));
  check("manual storage max count accepted", normalizeManualStoragePositionCreateCount(String(MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX)).ok === true, String(MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX));

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
    "picking import corrects leading-zero OCR quantity from unique stock quantity",
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

  const pickingImportSource = extractFunctionSource(appSource, "async function chooseBestImportText");
  const pickingCandidateSource = extractFunctionSource(appSource, "async function buildPickingImportCandidate");
  const pickingOcrReaderSource = extractFunctionSource(appSource, "async function readPickingPdfWithOcrCandidate");
  const pickingOcrScoreSource = extractFunctionSource(appSource, "function scorePickingOcrCandidate");
  const pickingDiagnosticsSource = extractFunctionSource(appSource, "function pickingImportDiagnostics");
  const stockEnrichmentSource = extractFunctionSource(appSource, "async function applyStorageBinsFromArticleStock");
  check(
    "picking PDF import uses OCR-only candidate scoring",
    pickingImportSource.includes("readPickingPdfWithOcrCandidate(pdf)") &&
      !pickingImportSource.includes("pdf-text") &&
      !pickingImportSource.includes("chooseBestPickingImportCandidate"),
    pickingImportSource
  );
  check(
    "picking PDF import evaluates multiple OCR scale and rotation candidates",
    appSource.includes("PICKING_OCR_SCALE_CANDIDATES") &&
      pickingOcrReaderSource.includes("candidateMap") &&
      pickingOcrReaderSource.includes("OCR_ROTATIONS") &&
      pickingOcrReaderSource.includes("pickingOcrScaleCandidates") &&
      pickingOcrReaderSource.includes("pickingOcrCandidateDiagnostic"),
    pickingOcrReaderSource
  );
  check(
    "picking PDF import scores OCR candidates with measurable table quality",
    pickingOcrScoreSource.includes("completeRequiredCount") &&
      pickingOcrScoreSource.includes("missingFromBinCount") &&
      pickingOcrScoreSource.includes("suspiciousSourceFieldCount") &&
      pickingOcrScoreSource.includes("discardedRows"),
    pickingOcrScoreSource
  );
  check(
    "picking PDF import diagnostics expose candidate scores",
    pickingDiagnosticsSource.includes("selectedCandidate") &&
      pickingDiagnosticsSource.includes("ocrCandidates") &&
      pickingDiagnosticsSource.includes("qualityScore") &&
      pickingDiagnosticsSource.includes("qualityAccepted"),
    pickingDiagnosticsSource
  );
  check(
    "picking PDF import disables source-bin repair scan",
    pickingCandidateSource.includes("disabled: true") &&
      pickingCandidateSource.includes("Keine Stellplatzvalidierung oder -korrektur") &&
      !pickingCandidateSource.includes("refinePickingBinsWithPreciseScan"),
    pickingCandidateSource
  );
  check(
    "picking PDF import does not call SSI storage-bin rules",
    !appSource.includes("normalizeSsiStorageBin"),
    "app.js contains normalizeSsiStorageBin"
  );
  check(
    "picking stock enrichment does not replace imported source bin",
    !stockEnrichmentSource.includes("fromBin: binChanged") &&
      !stockEnrichmentSource.includes("applied += 1") &&
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

  for (const path of ["/", "/order-hint-rules.js", "/tablet.html", "/lager.html", "/artikel.html", "/auswertungen.html", "/api/health"]) {
    const response = await request(path);
    check(`static ${path}`, response.status === 200, `${response.status}`);
  }

  const tabletLegacySource = await readFile(new URL("../tablet-legacy.js", import.meta.url), "utf8");
  const tabletModernSource = await readFile(new URL("../tablet.js", import.meta.url), "utf8");
  const exportSource = await readFile(new URL("../server/export.mjs", import.meta.url), "utf8");
  const indexHtmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const tabletHtmlSource = await readFile(new URL("../tablet.html", import.meta.url), "utf8");
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
    "server export verifies pdf file before exported status",
    exportSource.includes("assertPdfCreated(pdfPath)") &&
      exportSource.includes("stat(filePath)") &&
      exportSource.includes("PDF wurde nicht erstellt") &&
      exportSource.indexOf("await run(browser") < exportSource.indexOf("await assertPdfCreated(pdfPath)") &&
      exportSource.indexOf("await assertPdfCreated(pdfPath)") < exportSource.indexOf("return {"),
    JSON.stringify({
      checksPdfPath: exportSource.includes("assertPdfCreated(pdfPath)"),
      checksFileStats: exportSource.includes("stat(filePath)"),
      checksAfterBrowserRun: exportSource.indexOf("await run(browser") < exportSource.indexOf("await assertPdfCreated(pdfPath)"),
      checksBeforeReturn: exportSource.indexOf("await assertPdfCreated(pdfPath)") < exportSource.indexOf("return {")
    })
  );
  check(
    "manual storage create fields keep new bins empty and quantity explicit",
    indexHtmlSource.includes("manualStorageQuantityInput") &&
      tabletHtmlSource.includes("manualStorageQuantityInput") &&
      appSource.includes("manualStorageQuantityInput") &&
      appSource.includes("fromBin: \"\"") &&
      !appSource.includes("preset.fromBin") &&
      tabletModernSource.includes("manualStorageQuantityInput") &&
      tabletModernSource.includes("fromBin: \"\"") &&
      !tabletModernSource.includes("preset.fromBin") &&
      tabletLegacySource.includes("manualStorageQuantityInput") &&
      tabletLegacySource.includes("fromBin: \"\"") &&
      !tabletLegacySource.includes("preset.fromBin"),
    JSON.stringify({
      desktopQuantityInput: indexHtmlSource.includes("manualStorageQuantityInput") && appSource.includes("manualStorageQuantityInput"),
      tabletQuantityInput: tabletHtmlSource.includes("manualStorageQuantityInput") && tabletModernSource.includes("manualStorageQuantityInput") && tabletLegacySource.includes("manualStorageQuantityInput"),
      desktopEmptyBin: appSource.includes("fromBin: \"\"") && !appSource.includes("preset.fromBin"),
      tabletEmptyBin: tabletModernSource.includes("fromBin: \"\"") && tabletLegacySource.includes("fromBin: \"\"") && !tabletModernSource.includes("preset.fromBin") && !tabletLegacySource.includes("preset.fromBin")
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
  check(
    "order create with 9021-0OUT customer rule",
    orderCreate.status === 200 && orderCreate.body.order.customerName === "9021-0OUT" && orderCreate.body.order.orderNumber === "SSI",
    `${orderCreate.status} ${JSON.stringify(orderCreate.body)}`
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
    "QA export tests leave no durable PDF/HTML artifacts",
    exportArtifacts.length === 0,
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
    await cleanupOriginalArchiveArtifacts(context, cleanupPaths);
  }

  const leftovers = await findOriginalArchiveArtifacts(context);
  check(
    "original archive QA files are cleaned up",
    leftovers.length === 0,
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

async function cleanupOriginalArchiveArtifacts(context, explicitPaths = new Set()) {
  for (const filePath of explicitPaths) {
    await rm(filePath, { force: true });
  }
  const artifacts = await findOriginalArchiveArtifacts(context);
  await Promise.all(artifacts.map((filePath) => rm(filePath, { force: true })));
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
  const artifactPattern = new RegExp(`^QA-.*${suffixPattern}.*\\.(pdf|html)$`, "i");

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
    for (const candidate of [body.path, body.copyPath]) {
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

  const appCode = await readFile(new URL("../app.js", import.meta.url), "utf8");
  vm.runInContext(`${appCode}\nglobalThis.__parseOrderText = parseOrderText; globalThis.__validatePickingImport = validatePickingImport; globalThis.__buildBestellscheinOcrText = buildBestellscheinOcrText; globalThis.__mergeBestellscheinOcrLines = mergeBestellscheinOcrLines; globalThis.__correctedOcrWarehouseQuantityFromStock = correctedOcrWarehouseQuantityFromStock; globalThis.__buildPickingImportLineDiagnostics = buildPickingImportLineDiagnostics; globalThis.__importText = importText; globalThis.__state = state;`, context, { filename: "app.js" });
  return context;
}

function pickingTextFixture(orderHintBlock, orderNumber = "60126") {
  return [
    `Bestellschein Nr.: ${orderNumber}`,
    orderHintBlock,
    "Kunde: QA Importkunde",
    "1 123456 Serviceartikel 5 Stk"
  ].filter(Boolean).join("\n");
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
    "(z. B. QA_BASE_URL=http://127.0.0.1:4175 npm run test:qa) oder bewusst QA_ALLOW_LIVE=1 setzen."
  );
}
