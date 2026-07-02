import { copyFile, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

export function resolveOriginalImportFile(fileName, importDir) {
  const normalizedFileName = normalizeOriginalFileName(fileName);
  if (!normalizedFileName) {
    return {
      ok: false,
      error: "Originaldateiname ist ungueltig.",
      fileName: "",
      filePath: ""
    };
  }

  const baseDir = path.resolve(importDir || "");
  const filePath = path.resolve(baseDir, normalizedFileName);
  if (!isPathInside(filePath, baseDir)) {
    return {
      ok: false,
      error: "Originaldatei liegt nicht im verwalteten Importordner.",
      fileName: normalizedFileName,
      filePath: ""
    };
  }

  return {
    ok: true,
    error: "",
    fileName: normalizedFileName,
    filePath
  };
}

export async function archiveOriginalImportFile(order, { importDir, archiveDir } = {}) {
  if (order?.originalArchivedAt) {
    return {
      attempted: false,
      archived: false,
      skipped: true,
      reason: "already-archived",
      fileName: order.originalFileName || "",
      sourcePath: order.originalFilePath || "",
      archivePath: order.originalArchivePath || "",
      archivedAt: order.originalArchivedAt || "",
      error: ""
    };
  }

  const fileName = String(order?.originalFileName || "").trim();
  if (!fileName) {
    return {
      attempted: false,
      archived: false,
      skipped: true,
      reason: "missing-original-file",
      fileName: "",
      sourcePath: "",
      archivePath: "",
      archivedAt: "",
      error: ""
    };
  }

  const resolvedImport = resolveOriginalImportFile(fileName, importDir);
  if (!resolvedImport.ok) {
    return archiveError(fileName, "", resolvedImport.error);
  }

  const sourcePath = managedSourcePath(order.originalFilePath, resolvedImport.filePath, importDir);
  if (!sourcePath) {
    return archiveError(fileName, "", "Originaldatei liegt nicht im verwalteten Importordner.");
  }

  try {
    const sourceStats = await stat(sourcePath);
    if (!sourceStats.isFile()) {
      return archiveError(fileName, sourcePath, "Originaldatei ist keine Datei.");
    }

    const targetDir = path.resolve(archiveDir || path.join(path.dirname(sourcePath), "Archiv"));
    await mkdir(targetDir, { recursive: true });
    const targetPath = await uniqueArchivePath(targetDir, resolvedImport.fileName);
    await safeMoveFileToArchive(sourcePath, targetPath, sourceStats.size);
    return {
      attempted: true,
      archived: true,
      skipped: false,
      reason: "",
      fileName: resolvedImport.fileName,
      sourcePath,
      archivePath: targetPath,
      archivedAt: new Date().toISOString(),
      error: ""
    };
  } catch (error) {
    const message = error?.code === "ENOENT"
      ? "Originaldatei wurde nicht gefunden."
      : `Originaldatei konnte nicht archiviert werden: ${error?.message || error}`;
    return archiveError(fileName, sourcePath, message);
  }
}

export function normalizeOriginalFileName(value) {
  const fileName = String(value || "").trim();
  if (!fileName || fileName === "." || fileName === "..") return "";
  if (fileName.includes("\0") || fileName.includes("/") || fileName.includes("\\") || fileName.includes(":")) return "";
  if (path.basename(fileName) !== fileName) return "";
  return fileName;
}

export function isManagedImportPath(filePath, importDir) {
  return isPathInside(path.resolve(filePath || ""), path.resolve(importDir || ""));
}

async function safeMoveFileToArchive(sourcePath, targetPath, expectedSize) {
  try {
    await rename(sourcePath, targetPath);
    await assertFileSize(targetPath, expectedSize);
    return;
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
  }

  try {
    await copyFile(sourcePath, targetPath);
    await assertFileSize(targetPath, expectedSize);
    const handle = await open(targetPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await unlink(sourcePath);
  } catch (error) {
    await safeUnlink(targetPath);
    throw error;
  }
}

async function assertFileSize(filePath, expectedSize) {
  const targetStats = await stat(filePath);
  if (!targetStats.isFile() || targetStats.size !== expectedSize) {
    throw new Error("Archivkopie konnte nicht verifiziert werden.");
  }
}

async function uniqueArchivePath(archiveDir, fileName) {
  const parsed = path.parse(fileName);
  const timestamp = timestampSuffix();
  const firstCandidate = path.join(archiveDir, fileName);
  if (!await fileExists(firstCandidate)) return firstCandidate;

  for (let index = 1; index <= 999; index += 1) {
    const suffix = index === 1 ? timestamp : `${timestamp}-${index}`;
    const candidate = path.join(archiveDir, `${parsed.name}-${suffix}${parsed.ext}`);
    if (!await fileExists(candidate)) return candidate;
  }
  throw new Error("Kein freier Archivdateiname gefunden.");
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function timestampSuffix() {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function managedSourcePath(candidatePath, fallbackPath, importDir) {
  const candidate = String(candidatePath || "").trim();
  if (candidate && isManagedImportPath(candidate, importDir)) return path.resolve(candidate);
  return fallbackPath;
}

function isPathInside(filePath, baseDir) {
  const relation = path.relative(baseDir, filePath);
  return Boolean(relation) && !relation.startsWith("..") && !path.isAbsolute(relation);
}

function archiveError(fileName, sourcePath, error) {
  return {
    attempted: true,
    archived: false,
    skipped: false,
    reason: "error",
    fileName,
    sourcePath,
    archivePath: "",
    archivedAt: "",
    error
  };
}

async function safeUnlink(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
