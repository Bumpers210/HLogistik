import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set([".git", "Backups", "data", "Exporte", "node_modules", "tmp"]);
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const files = await collectSyntaxFiles(ROOT);
let failed = false;

for (const file of files) {
  const result = await nodeCheck(file);
  if (result.code !== 0) {
    failed = true;
    process.stderr.write(`\nnode --check failed: ${path.relative(ROOT, file)}\n`);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
}

if (failed) process.exit(1);

console.log(`Syntaxcheck bestanden: ${files.length} JS/MJS-Dateien.`);

async function collectSyntaxFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...await collectSyntaxFiles(path.join(dir, entry.name)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!/\.(?:mjs|js)$/i.test(entry.name)) continue;
    if (/\.min\.js$/i.test(entry.name)) continue;
    files.push(path.join(dir, entry.name));
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function nodeCheck(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", file], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
