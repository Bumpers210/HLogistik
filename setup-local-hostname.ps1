$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$configFile = Join-Path $root "local-hostname.txt"

if (-not (Test-Path $configFile)) {
  Write-Host "Datei fehlt: $configFile"
  exit 1
}

$hostname = Get-Content $configFile |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -and -not $_.StartsWith("#") } |
  Select-Object -First 1

if (-not $hostname) {
  Write-Host "Kein Hostname in local-hostname.txt gefunden."
  exit 1
}

$hostsPath = "$env:Windir\System32\drivers\etc\hosts"
$entry = "127.0.0.1`t$hostname"
$existing = Get-Content $hostsPath -ErrorAction Stop

if ($existing -match [regex]::Escape($hostname)) {
  Write-Host "Eintrag fuer '$hostname' existiert bereits in hosts."
  exit 0
}

Write-Host "Trage '$hostname' in $hostsPath ein (Administrator noetig)."
Add-Content -Path $hostsPath -Value $entry -Encoding ascii
Write-Host "Fertig. App unter http://${hostname}:4174/ oeffnen."
