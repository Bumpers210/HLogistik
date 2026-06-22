export function normalizeSsiStorageBin(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  const text = raw.replace(/\s+/g, "").replace(/_/g, "-");

  let match = text.match(/^022-H([1-7])-R(\d+)$/i);
  if (match) return normalizeSsiBlockBin(match[1], match[2]);

  match = text.match(/^002-H([1-7])-R(\d+)$/i);
  if (match) return normalizeSsiBlockBin(match[1], match[2]);

  match = text.match(/^002-H[1-7]-SH([1-7])R(\d+)$/i);
  if (match) return normalizeSsiBlockBin(match[1], match[2]);

  match = text.match(/^H([1-7])-?R(\d+)$/i);
  if (match) return normalizeSsiBlockBin(match[1], match[2]);

  match = text.match(/^H3-?([O-Y][1-3])$/i);
  if (match) return normalizeSsiH3DirectBin(match[1]);

  match = text.match(/^002-H3-([O-Y][1-3])$/i);
  if (match) return normalizeSsiH3DirectBin(match[1]);

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

function normalizeSsiBlockBin(hall, blockNumber) {
  const hallNumber = Number(hall);
  const number = Number(blockNumber);
  if (!Number.isInteger(hallNumber) || hallNumber < 1 || hallNumber > 7 || !Number.isInteger(number) || number <= 0) {
    return null;
  }
  return `022-H${hallNumber}-R${number}`;
}

function normalizeSsiH3DirectBin(code) {
  const text = String(code || "").trim().toUpperCase();
  if (!/^[O-Y][1-3]$/.test(text)) return null;
  return `002-H3-${text}`;
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
