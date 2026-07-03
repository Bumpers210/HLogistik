export const SSI_STORAGE_HU_PREFIX = "34006381000";
export const SSI_STORAGE_HU_SUFFIX_LENGTH = 7;
export const SSI_STORAGE_HU_LENGTH = SSI_STORAGE_HU_PREFIX.length + SSI_STORAGE_HU_SUFFIX_LENGTH;

export function normalizeSsiStorageHandlingUnit(value) {
  const digits = normalizeDigits(value);
  if (!digits) return SSI_STORAGE_HU_PREFIX;
  if (digits.startsWith(SSI_STORAGE_HU_PREFIX)) return digits.slice(0, SSI_STORAGE_HU_LENGTH);
  const suffix = digits.length <= SSI_STORAGE_HU_SUFFIX_LENGTH
    ? digits
    : digits.slice(-SSI_STORAGE_HU_SUFFIX_LENGTH);
  return SSI_STORAGE_HU_PREFIX + suffix;
}

export function isCompleteSsiStorageHandlingUnit(value) {
  const digits = normalizeDigits(value);
  return digits.startsWith(SSI_STORAGE_HU_PREFIX) && digits.length === SSI_STORAGE_HU_LENGTH;
}

export function isIncompleteSsiStorageHandlingUnit(value) {
  const digits = normalizeDigits(value);
  return digits.startsWith(SSI_STORAGE_HU_PREFIX) && digits.length < SSI_STORAGE_HU_LENGTH;
}

export function stripSsiStorageHandlingUnitPrefix(value) {
  const text = String(value || "").trim();
  const digits = normalizeDigits(text);
  if (!digits.startsWith(SSI_STORAGE_HU_PREFIX)) return text;
  return digits.slice(SSI_STORAGE_HU_PREFIX.length);
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}
