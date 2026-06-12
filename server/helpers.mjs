import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { writeFile } from "node:fs/promises";

// ── ID generators ─────────────────────────────────────────────────────────────

export function createId() {
  return `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createArticleId() {
  return `article-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createStorageId() {
  return `stock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createStorageMovementId() {
  return `move-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

export function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}

export function withLineContext(error, index, context = "") {
  const statusCode = error.statusCode || 400;
  const message = error.publicMessage || error.message || "Buchungszeile ist ungueltig";
  const contextText = context ? ` (${context})` : "";
  return httpError(statusCode, `Buchung ${index + 1}${contextText}: ${message}`);
}

export function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

export function sendText(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(value);
}

export function sendCsv(response, status, fileName, value) {
  response.writeHead(status, {
    "Content-Type": "text/csv; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="${sanitizeFileName(fileName)}"`,
  });
  response.end(value);
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".json", "application/json; charset=utf-8"],
]);

export async function sendFile(response, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not file");
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

export async function readBody(request, maxBodyBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw httpError(413, "Anfrage ist zu gross");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw httpError(400, "Ungueltige JSON-Daten");
  }
}

export async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// ── Path safety ───────────────────────────────────────────────────────────────

export function safeResolve(baseDir, requestPath) {
  const base = path.resolve(baseDir);
  const relative = path.normalize(requestPath).replace(/^([/\\])+/, "");
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const resolved = path.resolve(base, relative);
  const relation = path.relative(base, resolved);
  if (relation.startsWith("..") || path.isAbsolute(relation)) return null;
  return resolved;
}

// ── Data normalization ────────────────────────────────────────────────────────

export function readInteger(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

export function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["0", "false", "nein", "no", "inaktiv"].includes(text)) return false;
  return true;
}

export function normalizeWarehouse(value) {
  const text = String(value || "SSI").trim().toUpperCase();
  return text === "SI" ? "SI" : "SSI";
}

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

  match = text.match(/^002-H[1-7]-S([A-Z0-9]+)$/i);
  if (match) return normalizeSsiShelfBin(match[1]) || text;

  if (/^002-H[1-7]-S[A-Z0-9]+$/i.test(text)) return text;

  match = text.match(/^(\d{1,2})([A-Z0-9]*)$/i);
  if (match) {
    const number = Number(match[1]);
    if (number >= 1 && number <= 69) return `002-H7-S${text}`;
  }

  if (/^AN[A-Z0-9]*$/i.test(text)) return `002-H1-S${text}`;

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

function normalizeSsiShelfBin(shelfCode) {
  const text = String(shelfCode || "").trim().toUpperCase();
  if (!text) return "";
  const numeric = text.match(/^(\d{1,2})([A-Z0-9]*)$/i);
  if (numeric) {
    const number = Number(numeric[1]);
    if (number >= 1 && number <= 69) return `002-H7-S${text}`;
  }
  if (/^AN[A-Z0-9]*$/i.test(text)) return `002-H1-S${text}`;
  const alpha = text.match(/^([A-Z])([A-Z0-9]*)$/i);
  if (alpha) {
    const first = alpha[1];
    if (first >= "A" && first <= "N") return `002-H4-S${text}`;
    if (first >= "O" && first <= "Z") return `002-H3-S${text}`;
  }
  return null;
}

export function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (!/[;"\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

// ── String helpers ────────────────────────────────────────────────────────────

export function sanitizeFileName(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 140);
}

export function sanitizeFileNamePart(value) {
  return (
    String(value || "")
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "auftrag"
  );
}

export function sanitizeHostname(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

export function absoluteUrl(origin, pathname) {
  try {
    return new URL(pathname, origin).href;
  } catch {
    return pathname;
  }
}
