export function normalizeSsiStorageBin(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  const text = raw.replace(/\s+/g, "").replace(/_/g, "-");

  const fixedHallBin = normalizeFixedHallBin(text);
  if (fixedHallBin !== undefined) return fixedHallBin;

  if (/^002-H2-S\d{4}$/i.test(text)) return text;

  let match = text.match(/^S(\d{4})$/i);
  if (match) return `002-H2-S${match[1]}`;

  match = text.match(/^(\d{4})$/);
  if (match) return `002-H2-S${match[1]}`;

  match = text.match(/^002-H[1-7]-S([A-Z0-9]+)$/i);
  if (match) return normalizeSsiShelfBin(match[1]) || text;

  if (/^002-H[1-7]-S[A-Z0-9]+$/i.test(text)) return text;

  match = text.match(/^(\d{1,2})([A-Z0-9]*)$/i);
  if (match) {
    const number = Number(match[1]);
    if (number >= 1 && number <= 69) return `002-H7-S${text}`;
  }

  if (/^A[A-T][A-Z0-9]*$/i.test(text)) return `002-H1-S${text}`;

  match = text.match(/^([A-Z])([A-Z0-9]*)$/i);
  if (match) {
    const first = match[1];
    if (first >= "A" && first <= "N") return `002-H4-S${text}`;
    if (first >= "O" && first <= "Z") return `002-H3-S${text}`;
  }

  return null;
}

function normalizeFixedHallBin(value) {
  const compact = String(value || "").replace(/-/g, "").toUpperCase();
  let match = compact.match(/^(?:022|002)?H1R(\d+)$/);
  if (match) return normalizeRangedHallBin("H1", "R", match[1], 1, 16);

  match = compact.match(/^(?:022)?H1(A[G-M]1)$/) || compact.match(/^002H1S(A[G-M]1)$/);
  if (match) return `022-H1-${match[1]}`;
  if (/^(?:022)?H1A[A-Z]1$/.test(compact) || /^H1SA[A-Z]1$/.test(compact)) return null;

  match = compact.match(/^(?:022|002)?H2R(\d+)$/);
  if (match) return normalizeRangedHallBin("H2", "R", match[1], 1, 56);

  match = compact.match(/^(?:022|002)?H3S?([P-Y][1-3])$/);
  if (match) return match[1] === "R3" || match[1] === "S3" ? null : `022-H3-${match[1]}`;
  if (/^(?:022|002)?H3S?[A-Z][1-3]$/.test(compact)) return null;

  match = compact.match(/^(?:022|002)?H4R(\d+)$/);
  if (match) return normalizeRangedHallBin("H4", "R", match[1], 1, 21);

  match = compact.match(/^(?:022|002)?H5R(\d+)$/);
  if (match) return normalizeRangedHallBin("H5", "R", match[1], 1, 50);

  match = compact.match(/^(?:022|002)?H7S?([2-5]R[1-3])$/);
  if (match) return `022-H7-${match[1]}`;
  if (/^(?:022|002)?H7S?\dR\d$/.test(compact)) return null;

  return undefined;
}

function normalizeRangedHallBin(hall, prefix, value, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return `022-${hall}-${prefix}${number}`;
}

function normalizeSsiShelfBin(shelfCode) {
  const text = String(shelfCode || "").trim().toUpperCase();
  if (!text) return "";
  const numeric = text.match(/^(\d{1,2})([A-Z0-9]*)$/i);
  if (numeric) {
    const number = Number(numeric[1]);
    if (number >= 1 && number <= 69) return `002-H7-S${text}`;
  }
  if (/^A[A-T][A-Z0-9]*$/i.test(text)) return `002-H1-S${text}`;
  const alpha = text.match(/^([A-Z])([A-Z0-9]*)$/i);
  if (alpha) {
    const first = alpha[1];
    if (first >= "A" && first <= "N") return `002-H4-S${text}`;
    if (first >= "O" && first <= "Z") return `002-H3-S${text}`;
  }
  return null;
}
