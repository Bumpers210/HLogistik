#Requires -Version 5.1
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$ErrorActionPreference = "Stop"
$root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostsPath = "$env:Windir\System32\drivers\etc\hosts"

# ── Farben ─────────────────────────────────────────────────────────────────────

$cBg     = [System.Drawing.ColorTranslator]::FromHtml("#0f1117")
$cPanel  = [System.Drawing.ColorTranslator]::FromHtml("#161b27")
$cGreen  = [System.Drawing.ColorTranslator]::FromHtml("#167a58")
$cGreenL = [System.Drawing.ColorTranslator]::FromHtml("#1db88a")
$cRed    = [System.Drawing.ColorTranslator]::FromHtml("#e05252")
$cOrange = [System.Drawing.Color]::Orange
$cText   = [System.Drawing.Color]::White
$cMuted  = [System.Drawing.ColorTranslator]::FromHtml("#6b7688")
$cLogBg  = [System.Drawing.ColorTranslator]::FromHtml("#070b10")
$cLogFg  = [System.Drawing.ColorTranslator]::FromHtml("#4dde9f")
$cLogErr = [System.Drawing.ColorTranslator]::FromHtml("#ff6b6b")

# Bullet-Zeichen als Char (nicht im Source-Code, damit ASCII-kompatibel)
$dot = [char]0x25CF

# ── Node.js finden ─────────────────────────────────────────────────────────────

function Find-NodeExe {
    $n = Get-Command node -ErrorAction SilentlyContinue
    if ($n) { return $n.Source }
    $candidates = @(
        "C:\Program Files\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\cursor\resources\app\resources\helpers\node.exe"
    )
    $nvmNode = Get-ChildItem "$env:APPDATA\nvm\*\node.exe" -ErrorAction SilentlyContinue |
               Sort-Object DirectoryName -Descending | Select-Object -First 1
    if ($nvmNode) { $candidates += $nvmNode.FullName }
    foreach ($p in $candidates) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

# ── Lokalen Hostnamen lesen ────────────────────────────────────────────────────

function Get-LocalHostname {
    $f = Join-Path $root "local-hostname.txt"
    if (-not (Test-Path $f)) { return "" }
    $line = Get-Content $f |
        Where-Object { $_.Trim() -and -not $_.Trim().StartsWith("#") } |
        Select-Object -First 1
    if ($line) { return $line.Trim() }
    return ""
}

# ── Hosts-Eintrag sicherstellen ────────────────────────────────────────────────

function Ensure-HostsEntry {
    param([string]$hostname)
    if (-not $hostname) { return }
    $content = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
    if ($content -match [regex]::Escape($hostname)) { return }
    $entry   = "127.0.0.1`t$hostname"
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdmin) {
        Add-Content -Path $hostsPath -Value $entry -Encoding ascii
    } else {
        $bytes   = [System.Text.Encoding]::Unicode.GetBytes("Add-Content -Path '$hostsPath' -Value '$entry' -Encoding ascii")
        $encoded = [Convert]::ToBase64String($bytes)
        try { Start-Process powershell -ArgumentList "-NoProfile", "-EncodedCommand", $encoded -Verb RunAs -Wait } catch { }
    }
}

# ── Port-Pruefer (Get-NetTCPConnection ist zuverlaessiger als netstat-Parsing) ──

function Get-PortOwnerPid {
    param([int]$port)
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
    if ($conn -and $conn.OwningProcess -gt 0) { return $conn.OwningProcess }
    return 0
}

# ── Voraussetzungen ────────────────────────────────────────────────────────────

$nodeExe = Find-NodeExe
if (-not $nodeExe) {
    [System.Windows.Forms.MessageBox]::Show(
        "Node.js nicht gefunden.`nBitte von https://nodejs.org/ installieren.",
        "HLogistik",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}

$localHostname = Get-LocalHostname
Ensure-HostsEntry $localHostname

$ownerPid = Get-PortOwnerPid 4174
if ($ownerPid -gt 0) {
    $ownerProc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
    $procName  = if ($ownerProc) { $ownerProc.Name } else { "Unbekannt" }
    $msg = "Port 4174 wird bereits verwendet ($procName, PID $ownerPid).`nVorhandenen Server beenden und neu starten?"
    $answer = [System.Windows.Forms.MessageBox]::Show(
        $msg,
        "HLogistik",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question
    )
    if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) {
        Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 600
    } else {
        exit 0
    }
}

# ── Fenster aufbauen ───────────────────────────────────────────────────────────

$form = New-Object System.Windows.Forms.Form
$form.Text          = "HLogistik Server"
$form.Size          = New-Object System.Drawing.Size(700, 560)
$form.MinimumSize   = New-Object System.Drawing.Size(520, 420)
$form.StartPosition = "CenterScreen"
$form.BackColor     = $cBg
$form.ForeColor     = $cText
$form.Font          = New-Object System.Drawing.Font("Segoe UI", 10)

# -- Header --
$pnlHeader           = New-Object System.Windows.Forms.Panel
$pnlHeader.Dock      = "Top"
$pnlHeader.Height    = 66
$pnlHeader.BackColor = $cPanel

$lblTitle            = New-Object System.Windows.Forms.Label
$lblTitle.Text       = "HLogistik"
$lblTitle.Font       = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor  = $cGreenL
$lblTitle.Location   = New-Object System.Drawing.Point(16, 10)
$lblTitle.AutoSize   = $true
$pnlHeader.Controls.Add($lblTitle)

$lblSub              = New-Object System.Windows.Forms.Label
$lblSub.Text         = "Kommissionier-Server"
$lblSub.Font         = New-Object System.Drawing.Font("Segoe UI", 9)
$lblSub.ForeColor    = $cMuted
$lblSub.Location     = New-Object System.Drawing.Point(18, 40)
$lblSub.AutoSize     = $true
$pnlHeader.Controls.Add($lblSub)

$lblStatus           = New-Object System.Windows.Forms.Label
$lblStatus.Text      = "$dot Startet..."
$lblStatus.Font      = New-Object System.Drawing.Font("Segoe UI", 10)
$lblStatus.ForeColor = $cOrange
$lblStatus.AutoSize  = $true
$pnlHeader.Controls.Add($lblStatus)

$pnlHeader.add_Layout({
    $lblStatus.Location = New-Object System.Drawing.Point(($pnlHeader.Width - $lblStatus.Width - 16), 24)
})

$form.Controls.Add($pnlHeader)

# -- URLs --
$urlCount          = if ($localHostname) { 3 } else { 2 }
$pnlUrls           = New-Object System.Windows.Forms.Panel
$pnlUrls.Dock      = "Top"
$pnlUrls.Height    = 10 + $urlCount * 26
$pnlUrls.BackColor = $cBg

function New-UrlLink {
    param([string]$label, [int]$y, [bool]$primary)
    $lnk                  = New-Object System.Windows.Forms.LinkLabel
    $lnk.Text             = $label
    $lnk.Location         = New-Object System.Drawing.Point(20, $y)
    $lnk.AutoSize         = $true
    $lnk.BackColor        = $cBg
    $lnk.LinkColor        = if ($primary) { $cGreenL } else { $cMuted }
    $lnk.ActiveLinkColor  = $cText
    $lnk.VisitedLinkColor = if ($primary) { $cGreenL } else { $cMuted }
    $pnlUrls.Controls.Add($lnk)
    return $lnk
}

$lnkLocal = New-UrlLink "http://localhost:4174" 8 $true
$lnkLocal.add_LinkClicked({ Start-Process "http://localhost:4174" })

$script:networkUrl = ""
$lnkNet            = New-UrlLink "Netzwerk: wird ermittelt..." 34 $false
$lnkNet.add_LinkClicked({ if ($script:networkUrl) { Start-Process $script:networkUrl } })

if ($localHostname) {
    $hnTarget = "http://${localHostname}:4174"
    $lnkHn    = New-UrlLink $hnTarget 60 $false
    $capturedHnTarget = $hnTarget
    $lnkHn.add_LinkClicked([scriptblock]::Create("Start-Process '$capturedHnTarget'"))
}

$form.Controls.Add($pnlUrls)

# -- Trennlinie --
$sep           = New-Object System.Windows.Forms.Panel
$sep.Dock      = "Top"
$sep.Height    = 1
$sep.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#252d3d")
$form.Controls.Add($sep)

# -- Untere Leiste --
$pnlBottom           = New-Object System.Windows.Forms.Panel
$pnlBottom.Dock      = "Bottom"
$pnlBottom.Height    = 56
$pnlBottom.BackColor = $cPanel

$btnOpen             = New-Object System.Windows.Forms.Button
$btnOpen.Text        = "Im Browser oeffnen"
$btnOpen.Size        = New-Object System.Drawing.Size(180, 36)
$btnOpen.Location    = New-Object System.Drawing.Point(16, 10)
$btnOpen.BackColor   = $cGreen
$btnOpen.ForeColor   = $cText
$btnOpen.FlatStyle   = "Flat"
$btnOpen.FlatAppearance.BorderSize = 0
$btnOpen.add_Click({ Start-Process "http://localhost:4174" })
$pnlBottom.Controls.Add($btnOpen)

$btnStop             = New-Object System.Windows.Forms.Button
$btnStop.Text        = "Server stoppen"
$btnStop.Size        = New-Object System.Drawing.Size(150, 36)
$btnStop.FlatStyle   = "Flat"
$btnStop.FlatAppearance.BorderSize = 0
$btnStop.BackColor   = [System.Drawing.ColorTranslator]::FromHtml("#2a2a3a")
$btnStop.ForeColor   = $cRed
$btnStop.add_Click({
    if ($global:serverProc -and -not $global:serverProc.HasExited) { $global:serverProc.Kill() }
    $form.Close()
})
$pnlBottom.Controls.Add($btnStop)

$pnlBottom.add_Layout({
    $btnStop.Location = New-Object System.Drawing.Point(($pnlBottom.Width - $btnStop.Width - 16), 10)
})

$form.Controls.Add($pnlBottom)

# -- Log-Bereich --
$logBox             = New-Object System.Windows.Forms.RichTextBox
$logBox.Dock        = "Fill"
$logBox.ReadOnly    = $true
$logBox.BackColor   = $cLogBg
$logBox.ForeColor   = $cLogFg
$logBox.Font        = New-Object System.Drawing.Font("Cascadia Mono,Consolas,Courier New", 9)
$logBox.BorderStyle = "None"
$form.Controls.Add($logBox)

# ── Hilfsfunktionen ────────────────────────────────────────────────────────────

function Append-Log {
    param([string]$line, [bool]$isError = $false)
    if (-not $form.IsHandleCreated) { return }
    $ts    = Get-Date -Format "HH:mm:ss"
    $color = if ($isError) { $cLogErr } else { $cLogFg }
    $form.Invoke([Action]{
        $logBox.SelectionStart  = $logBox.TextLength
        $logBox.SelectionLength = 0
        $logBox.SelectionColor  = $color
        $logBox.AppendText("[$ts] $line`n")
        $logBox.ScrollToCaret()
    })
}

function Set-StatusText {
    param([string]$text, $color)
    if (-not $form.IsHandleCreated) { return }
    $form.Invoke([Action]{
        $lblStatus.Text      = $text
        $lblStatus.ForeColor = $color
        $lblStatus.Location  = New-Object System.Drawing.Point(($pnlHeader.Width - $lblStatus.Width - 16), 24)
    })
}

# ── Server-Prozess vorbereiten ─────────────────────────────────────────────────

$pinfo = New-Object System.Diagnostics.ProcessStartInfo
$pinfo.FileName               = $nodeExe
$pinfo.Arguments              = "`"$(Join-Path $root 'server.mjs')`""
$pinfo.WorkingDirectory       = $root
$pinfo.UseShellExecute        = $false
$pinfo.CreateNoWindow         = $true
$pinfo.RedirectStandardOutput = $true
$pinfo.RedirectStandardError  = $true
$pinfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$pinfo.StandardErrorEncoding  = [System.Text.Encoding]::UTF8

$global:serverProc                     = New-Object System.Diagnostics.Process
$global:serverProc.StartInfo           = $pinfo
$global:serverProc.EnableRaisingEvents = $true

$global:serverProc.add_OutputDataReceived({
    param($sender, $e)
    if ([string]::IsNullOrEmpty($e.Data)) { return }
    Append-Log $e.Data $false

    if ($e.Data -match "Im Netzwerk: (http://[\d.:]+/)") {
        $url               = $Matches[1]
        $script:networkUrl = $url
        if ($form.IsHandleCreated) {
            $form.Invoke([Action]{ $lnkNet.Text = $url })
        }
    }
    if ($e.Data -match "laeuft auf") {
        Set-StatusText "$dot Online" $cGreenL
    }
})

$global:serverProc.add_ErrorDataReceived({
    param($sender, $e)
    if ([string]::IsNullOrEmpty($e.Data)) { return }
    Append-Log $e.Data $true
    Set-StatusText "$dot Fehler" $cRed
})

$global:serverProc.add_Exited({
    Set-StatusText "$dot Gestoppt" $cRed
    if ($form.IsHandleCreated) {
        $form.Invoke([Action]{
            Append-Log "[Server wurde beendet]" $true
            $btnStop.Text      = "Schliessen"
            $btnStop.ForeColor = $cText
        })
    }
})

$form.add_Shown({
    $global:serverProc.Start()               | Out-Null
    $global:serverProc.BeginOutputReadLine()
    $global:serverProc.BeginErrorReadLine()
})

$form.add_FormClosing({
    if ($global:serverProc -and -not $global:serverProc.HasExited) { $global:serverProc.Kill() }
})

[System.Windows.Forms.Application]::Run($form)
