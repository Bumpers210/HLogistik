import { normalizeSsiStorageBin } from "../server/helpers.mjs";
import {
  MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX,
  normalizeManualStoragePositionCreateCount,
} from "../server/rules/order-rules.mjs";

const BASE_URL = String(globalThis.process?.env?.QA_BASE_URL || "http://127.0.0.1:4175").replace(/\/+$/, "");
const ALLOW_LIVE = globalThis.process?.env?.QA_ALLOW_LIVE === "1";
const ROLE_HEADERS = { "content-type": "application/json; charset=utf-8", "x-user-group": "buero" };
const TABLET_HEADERS = { "content-type": "application/json; charset=utf-8", "x-user-group": "tablet" };
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

guardAgainstAccidentalLiveWrites();

const checks = [];
const suffix = Date.now().toString().slice(-9);
const materialnummer = `77${suffix}`;
const hu = `QA-HU-${suffix}`;

await run();

async function run() {
  check("ssi H3 O-Y shorthand normalizes to direct H3 bin", normalizeSsiStorageBin("H3T1") === "002-H3-T1", normalizeSsiStorageBin("H3T1"));
  check("ssi H3 O-Y shorthand accepts hyphen", normalizeSsiStorageBin("H3-T1") === "002-H3-T1", normalizeSsiStorageBin("H3-T1"));
  check("ssi H3 direct bin remains stable", normalizeSsiStorageBin("002-H3-T1") === "002-H3-T1", normalizeSsiStorageBin("002-H3-T1"));
  check("ssi A shelf normalizes to H1", normalizeSsiStorageBin("AA8C3") === "002-H1-SAA8C3", normalizeSsiStorageBin("AA8C3"));
  check("ssi AT shelf normalizes to H1", normalizeSsiStorageBin("AT8A1") === "002-H1-SAT8A1", normalizeSsiStorageBin("AT8A1"));
  check("ssi AU shelf normalizes to H4", normalizeSsiStorageBin("AU8A1") === "002-H4-SAU8A1", normalizeSsiStorageBin("AU8A1"));
  check("manual storage count default is 1", normalizeManualStoragePositionCreateCount("").value === 1, JSON.stringify(normalizeManualStoragePositionCreateCount("")));
  check("manual storage invalid count rejected", normalizeManualStoragePositionCreateCount("0").ok === false, JSON.stringify(normalizeManualStoragePositionCreateCount("0")));
  check("manual storage max count accepted", normalizeManualStoragePositionCreateCount(String(MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX)).ok === true, String(MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX));

  for (const path of ["/", "/tablet.html", "/lager.html", "/artikel.html", "/auswertungen.html", "/api/health"]) {
    const response = await request(path);
    check(`static ${path}`, response.status === 200, `${response.status}`);
  }

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
  const storageExport = await request(`/api/orders/${encodeURIComponent(storageOrderId)}/export-pdf?warehouse=SSI`, {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({ order: storageOrderPayload })
  });
  check(
    "storage non-SSI customer exports without HU prefix",
    storageExport.status === 200 && storageExport.body.ok && storageExport.body.stockReceipt?.booked === 1,
    `${storageExport.status} ${JSON.stringify(storageExport.body)}`
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
  const manualMultiExport = await request(`/api/orders/${encodeURIComponent(manualMultiOrderId)}/export-pdf?warehouse=SSI`, {
    method: "POST",
    headers: ROLE_HEADERS,
    body: JSON.stringify({ order: manualMultiOrderPayload })
  });
  check(
    "manual storage multiple same-material export books separate lines",
    manualMultiExport.status === 200 && manualMultiExport.body.stockReceipt?.booked === 2,
    `${manualMultiExport.status} ${JSON.stringify(manualMultiExport.body)}`
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

  console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, passed: checks.length, checks }, null, 2));
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

function guardAgainstAccidentalLiveWrites() {
  const url = new URL(BASE_URL);
  const isDefaultServerPort = url.port === "4174";
  if (!isDefaultServerPort || ALLOW_LIVE) return;
  throw new Error(
    "QA-Matrix schreibt Testartikel und Testbuchungen. Bitte gegen eine isolierte Kopie starten " +
    "(z. B. QA_BASE_URL=http://127.0.0.1:4175 npm run test:qa) oder bewusst QA_ALLOW_LIVE=1 setzen."
  );
}
