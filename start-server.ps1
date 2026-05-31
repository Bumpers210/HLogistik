$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $root "server.mjs"
$configFile = Join-Path $root "local-hostname.txt"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js wurde nicht gefunden."
  Write-Host "Bitte Node.js LTS installieren: https://nodejs.org/"
  Read-Host "Enter druecken zum Schliessen"
  exit 1
}

if (Test-Path $configFile) {
  $localHostname = Get-Content $configFile |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith("#") } |
    Select-Object -First 1

  if ($localHostname) {
    $env:LOCAL_HOSTNAME = $localHostname
  }
}

Write-Host "Starte Kommissionier-App..."
Write-Host "Ordner: $root"
if ($env:LOCAL_HOSTNAME) {
  Write-Host "Lokaler Name: $($env:LOCAL_HOSTNAME) (siehe local-hostname.txt)"
}
Write-Host ""
& $node.Source $server
