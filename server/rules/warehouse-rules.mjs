export const DEFAULT_WAREHOUSE = "SSI";
export const WAREHOUSES = Object.freeze(["SSI", "SI"]);
export const ARTICLE_DATABASE_FILES = Object.freeze({
  SSI: "artikel-ssi.sqlite",
  SI: "artikel-si.sqlite",
});

export function normalizeWarehouse(value) {
  const text = String(value || DEFAULT_WAREHOUSE).trim().toUpperCase();
  return text === "SI" ? "SI" : DEFAULT_WAREHOUSE;
}

export function normalizeOptionalWarehouse(value) {
  const text = String(value || "").trim().toUpperCase();
  return WAREHOUSES.includes(text) ? normalizeWarehouse(text) : "";
}

export function articleDatabaseFileName(warehouse) {
  return ARTICLE_DATABASE_FILES[normalizeWarehouse(warehouse)];
}
