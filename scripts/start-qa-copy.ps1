param(
  [int]$Port = 4175,
  [switch]$PrepareOnly
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$qaRoot = Join-Path $repoRoot "tmp\qa-workspace-$timestamp"

New-Item -ItemType Directory -Force -Path $qaRoot | Out-Null

$excludeDirs = @(".git", "node_modules", "data", "Backups", "tmp", "Exporte", "Archiv", "Import")
$excludeFiles = @("*.log", "export-path.txt", "import-path.txt", "archive-path.txt", "*.pdf", "*.xlsx", "*.csv", "qa-*.html", "*-export-test.*")
$robocopyArgs = @($repoRoot, $qaRoot, "/E", "/XD") + $excludeDirs + @("/XF") + $excludeFiles + @("/NFL", "/NDL", "/NJH", "/NJS", "/NP")

& robocopy @robocopyArgs | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw "Robocopy konnte die QA-Kopie nicht erstellen. Exitcode: $LASTEXITCODE"
}

$qaExportDir = Join-Path $qaRoot "Exporte"
$qaImportDir = Join-Path $qaRoot "Import"
$qaArchiveDir = Join-Path $qaImportDir "Archiv"

New-Item -ItemType Directory -Force -Path $qaExportDir, $qaImportDir, $qaArchiveDir | Out-Null

Set-Content -LiteralPath (Join-Path $qaRoot "export-path.txt") -Value $qaExportDir -Encoding UTF8
Set-Content -LiteralPath (Join-Path $qaRoot "import-path.txt") -Value $qaImportDir -Encoding UTF8

Write-Host "QA-Kopie erstellt: $qaRoot"
Write-Host "QA-Port: $Port"
Write-Host "Exportordner: $qaExportDir"
Write-Host "Importordner: $qaImportDir"
Write-Host "Archivordner: $qaArchiveDir"
Write-Host ""
Write-Host "QA-Matrix in einem zweiten PowerShell-Fenster:"
Write-Host ('$env:QA_BASE_URL = "http://127.0.0.1:{0}"' -f $Port)
Write-Host "npm.cmd run test:qa"
Write-Host "Remove-Item Env:\QA_BASE_URL -ErrorAction SilentlyContinue"
Write-Host ""

if ($PrepareOnly) {
  Write-Host "PrepareOnly aktiv: Server wurde nicht gestartet."
  exit 0
}

Push-Location $qaRoot
try {
  $env:PORT = [string]$Port
  $env:HLOGISTIK_EXPORT_DIR = $qaExportDir
  $env:HLOGISTIK_IMPORT_DIR = $qaImportDir
  $env:HLOGISTIK_ARCHIVE_DIR = $qaArchiveDir
  $env:ARTICLE_DELETE_PASSWORD = "QA-Article-Delete-Password"
  npm.cmd start
} finally {
  Pop-Location
  Remove-Item Env:\PORT -ErrorAction SilentlyContinue
  Remove-Item Env:\HLOGISTIK_EXPORT_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:\HLOGISTIK_IMPORT_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:\HLOGISTIK_ARCHIVE_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:\ARTICLE_DELETE_PASSWORD -ErrorAction SilentlyContinue
}
