export const SSI_DESTINATION_CUSTOMER = "9021-0OUT";
export const SSI_ORDER_NUMBER = "SSI";
export const MANUAL_STORAGE_POSITION_CREATE_COUNT_DEFAULT = 1;
export const MANUAL_STORAGE_POSITION_CREATE_COUNT_MIN = 1;
export const MANUAL_STORAGE_POSITION_CREATE_COUNT_MAX = 100;

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

export function orderNumberForCustomer(orderNumber, customerName) {
  return requiresSsiOrderNumber(customerName) ? SSI_ORDER_NUMBER : String(orderNumber || "");
}

export function requiresSsiOrderNumber(customerName) {
  return normalizeDestinationName(customerName) === SSI_DESTINATION_CUSTOMER;
}

export function isReusableOrderNumber(orderNumber) {
  return String(orderNumber || "").trim().toLowerCase().startsWith("ssi");
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
