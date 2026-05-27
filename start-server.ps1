$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $root "server.mjs"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js wurde nicht gefunden."
  Write-Host "Bitte Node.js LTS installieren: https://nodejs.org/"
  Read-Host "Enter druecken zum Schliessen"
  exit 1
}

Write-Host "Starte Kommissionier-App..."
Write-Host "Ordner: $root"
Write-Host ""
& $node.Source $server
