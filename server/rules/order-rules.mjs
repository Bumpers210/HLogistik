export const SSI_DESTINATION_CUSTOMER = "9021-0OUT";
export const SSI_ORDER_NUMBER = "SSI";
export const MANUAL_STORAGE_POSITION_CREATE_COUNT_DEFAULT = 1;
export const MANUAL_STORAGE_POSITION_CREATE_COUNT_MIN = 1;
export const MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX = 100;
export const ORDER_HINT_MAX_LENGTH = 80;

const ORDER_HINT_LABEL_PATTERN = /\bbestell\s*-?\s*hinweis\b\s*[:#-]?\s*/i;
const ORDER_HINT_STOP_LABEL_PATTERN = /\b(?:datum|uhrzeit|zeit|kunde|lieferadresse|empfaenger|empfanger|auftragsnr\.?|auftragsnummer|belegnr\.?|auftrag|position|pos\.?|artikelnummer|artikel|material|produkt|produktbeschreibung|menge|soll|ist|einheit|barcode|ean|lagerplatz|von-lagerplatz|nach-lagerplatz|hu|le|bearbeiter|benutzer)\b\s*[:#-].*$/i;
const ORDER_HINT_REJECT_PATTERNS = [
  /^(?:datum|uhrzeit|zeit|kunde|lieferadresse|empfaenger|empfanger|auftragsnr\.?|auftragsnummer|belegnr\.?|auftrag|position|pos\.?|artikelnummer|artikel|material|produkt|produktbeschreibung|menge|soll|ist|einheit|barcode|ean|lagerplatz|von-lagerplatz|nach-lagerplatz|hu|le|bearbeiter|benutzer)\b/i,
  /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/,
  /^\d{1,2}:\d{2}(?::\d{2})?\b/,
  /^\d{6,8}\s+.+\s+\d+(?:[,.]\d+)?\s*(?:stk|st|kg|g|m|l|pal|palette|karton|krt|ve|pck)\b/i,
  /^\d+(?:[,.]\d+)?\s*(?:stk|st|stueck|stück|kg|g|m|l|pal|palette|karton|krt|ve|pck)\b/i,
  /^\d{6,}$/,
  /^(?=.*\d)[A-Z0-9][A-Z0-9/-]{5,}$/i,
  /^(?:0{0,3}\d{1,3}-H\d|H\d[A-Z]\d|R\d|AN?[A-Z0-9]*|[A-Z]\d{2,})/i
];

export function normalizeManualStoragePositionCreateCount(value) {
  const number = Number(String(value ?? "").trim() || MANUAL_STORAGE_POSITION_CREATE_COUNT_DEFAULT);
  if (!Number.isInteger(number) || number < MANUAL_STORAGE_POSITION_CREATE_COUNT_MIN) {
    return {
      ok: false,
      error: `Anzahl Positionen muss eine positive ganze Zahl sein.`,
      value: MANUAL_STORAGE_POSITION_CREATE_COUNT_DEFAULT
    };
  }
  if (number > MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX) {
    return {
      ok: false,
      error: `Anzahl Positionen darf maximal ${MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX} betragen.`,
      value: MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX
    };
  }
  return { ok: true, value: number, error: "" };
}

export function normalizeDestinationName(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^(?:8021|9021|99021)-0?0?UT\b/, SSI_DESTINATION_CUSTOMER);
  if (new RegExp(`^${SSI_DESTINATION_CUSTOMER}\\b`).test(normalized)) return SSI_DESTINATION_CUSTOMER;
  return normalized;
}

export function firstDestinationName(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => line?.toBin)
    .map(normalizeDestinationName)
    .find(Boolean) || "";
}

export function destinationCustomerNameForLines(lines) {
  const destinations = (Array.isArray(lines) ? lines : [])
    .map((line) => line?.toBin)
    .map(normalizeDestinationName)
    .filter(Boolean);
  return destinations.includes(SSI_DESTINATION_CUSTOMER) ? SSI_DESTINATION_CUSTOMER : destinations[0] || "";
}

export function orderNumberForCustomer(orderNumber, customerName) {
  return requiresSsiOrderNumber(customerName) ? SSI_ORDER_NUMBER : String(orderNumber || "");
}

export function requiresSsiOrderNumber(customerName) {
  return normalizeDestinationName(customerName) === SSI_DESTINATION_CUSTOMER;
}

export function isReusableOrderNumber(orderNumber) {
  return String(orderNumber || "").trim().toLowerCase().startsWith("ssi");
}

export function appendOrderHintFromRawText(orderNumber, rawText) {
  return appendOrderHintToOrderNumber(orderNumber, extractOrderHint(rawText));
}

export function extractOrderHint(text) {
  const lines = orderHintLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(ORDER_HINT_LABEL_PATTERN);
    if (!match) continue;

    const sameLineValue = line.slice((match.index || 0) + match[0].length);
    const sameLineHint = normalizeOrderHint(sameLineValue);
    if (isValidOrderHint(sameLineHint)) return sameLineHint;

    const nextLineHint = normalizeOrderHint(lines[index + 1] || "");
    if (isValidOrderHint(nextLineHint)) return nextLineHint;
  }
  return "";
}

export function normalizeOrderHint(value) {
  const normalized = String(value || "")
    .replace(/\r?\n+/g, " ")
    .replace(ORDER_HINT_STOP_LABEL_PATTERN, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s:;,.#-]+|[\s:;,.#-]+$/g, "");

  if (normalized.length <= ORDER_HINT_MAX_LENGTH) return normalized;
  return normalized.slice(0, ORDER_HINT_MAX_LENGTH).trim().replace(/[\s:;,.#-]+$/g, "");
}

export function appendOrderHintToOrderNumber(orderNumber, orderHint) {
  const base = String(orderNumber || "").trim();
  const hint = normalizeOrderHint(orderHint);
  if (!base || isReusableOrderNumber(base) || !isValidOrderHint(hint)) return base;
  if (orderNumberAlreadyHasHint(base, hint)) return base;
  const completedPartialSuffix = completePartialOrderHintSuffix(base, hint);
  if (completedPartialSuffix) return completedPartialSuffix;
  return `${base}-${hint}`;
}

export function orderFingerprint(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .slice(0, 2000);
}

export function normalizeCustomerGroupKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\b(?:KUNDE|LIEFERADRESSE|EMPFAENGER|EMPFANGER)\b\s*[:#-]?/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function orderHintLines(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isValidOrderHint(value) {
  const text = String(value || "").trim();
  if (text.length < 2) return false;
  return !ORDER_HINT_REJECT_PATTERNS.some((pattern) => pattern.test(text));
}

function orderNumberAlreadyHasHint(orderNumber, orderHint) {
  const numberKey = normalizeCompareText(orderNumber);
  const hintKey = normalizeCompareText(orderHint);
  return Boolean(hintKey && numberKey.endsWith(`-${hintKey}`));
}

function completePartialOrderHintSuffix(orderNumber, orderHint) {
  const text = String(orderNumber || "").trim();
  const dashIndex = text.lastIndexOf("-");
  if (dashIndex < 0) return "";
  const prefix = text.slice(0, dashIndex).trim();
  const partialSuffix = text.slice(dashIndex + 1).trim();
  if (!prefix || !/[A-Z]/i.test(partialSuffix)) return "";
  const partialKey = normalizeCompareText(partialSuffix);
  const hintKey = normalizeCompareText(orderHint);
  if (partialKey.length < 2 || !hintKey.startsWith(partialKey)) return "";
  return `${prefix}-${orderHint}`;
}

function normalizeCompareText(value) {
  return String(value || "")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("de-DE");
}
