export const DEFAULT_GEBINDE_ART = "STK";
export const ARTICLE_GEBINDE_TYPES = Object.freeze(["C1", "C2", "A1", "KRT", "STK"]);
export const PACKAGE_QUANTITY_REQUIRED_TYPES = Object.freeze(["KRT"]);
export const PACKAGE_QUANTITY_SUPPORTED_TYPES = Object.freeze(["KRT", "A1"]);

export function normalizeGebindeArt(value) {
  const text = String(value || DEFAULT_GEBINDE_ART).trim().toUpperCase();
  return ARTICLE_GEBINDE_TYPES.includes(text) ? text : DEFAULT_GEBINDE_ART;
}

export function requiresPackageQuantity(gebindeArt) {
  return PACKAGE_QUANTITY_REQUIRED_TYPES.includes(String(gebindeArt || "").trim().toUpperCase());
}

export function supportsPackageQuantity(gebindeArt) {
  return PACKAGE_QUANTITY_SUPPORTED_TYPES.includes(String(gebindeArt || "").trim().toUpperCase());
}

