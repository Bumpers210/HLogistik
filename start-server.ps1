#Requires -Version 5.1

# WinForms braucht STA. Falls MTA: Skript im STA-Modus neu starten.
if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne "STA") {
    Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", $MyInvocation.MyCommand.Path
    exit
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

try {
    if (-not ("ConsoleWindow" -as [type])) {
        Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ConsoleWindow {
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
    }
    $consoleHandle = [ConsoleWindow]::GetConsoleWindow()
    if ($consoleHandle -ne [IntPtr]::Zero) {
        [ConsoleWindow]::ShowWindow($consoleHandle, 0) | Out-Null
    }
} catch { }

$ErrorActionPreference = "Continue"
$root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostsPath = "$env:Windir\System32\drivers\etc\hosts"
$dataDir   = Join-Path $root "data"
$backupDir = Join-Path $root "Backups"
$databaseFile = Join-Path $dataDir "logistik.sqlite"
$logFile = Join-Path $dataDir "server.log"
$errorLogFile = Join-Path $dataDir "server-error.log"
$managerLogFile = Join-Path $dataDir "server-manager.log"
$dot       = [char]0x25CF

function Write-ManagerLog ([string]$message) {
    try {
        New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -Path $managerLogFile -Value "[$timestamp] $message" -Encoding UTF8
    } catch { }
}

Write-ManagerLog "Manager gestartet. ApartmentState=$([System.Threading.Thread]::CurrentThread.GetApartmentState())"

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

# ── Hilfsfunktionen ────────────────────────────────────────────────────────────

function Find-NodeExe {
    $candidates = @(
        "C:\Program Files\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\cursor\resources\app\resources\helpers\node.exe"
    )
    $nvmNode = Get-ChildItem "$env:APPDATA\nvm\*\node.exe" -ErrorAction SilentlyContinue |
               Sort-Object DirectoryName -Descending | Select-Object -First 1
    if ($nvmNode) { $candidates += $nvmNode.FullName }

    $n = Get-Command node -ErrorAction SilentlyContinue
    if ($n) { $candidates += $n.Source }

    foreach ($p in $candidates) {
        if (-not $p -or -not (Test-Path $p)) { continue }
        if ($p -like "*\WindowsApps\OpenAI.Codex_*") { continue }
        return $p
    }
    return $null
}

function Get-LocalHostname {
    $f = Join-Path $root "local-hostname.txt"
    if (-not (Test-Path $f)) { return "" }
    $line = Get-Content $f |
        Where-Object { $_.Trim() -and -not $_.Trim().StartsWith("#") } |
        Select-Object -First 1
    if ($line) { return $line.Trim() } else { return "" }
}

function Ensure-HostsEntry ([string]$hostname) {
    if (-not $hostname) { return }
    $content = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
    if ($content -match [regex]::Escape($hostname)) { return }
    $entry = "127.0.0.1`t$hostname"
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdmin) {
        Add-Content -Path $hostsPath -Value $entry -Encoding ascii
    } else {
        $bytes   = [System.Text.Encoding]::Unicode.GetBytes("Add-Content -Path '$hostsPath' -Value '$entry' -Encoding ascii")
        $encoded = [Convert]::ToBase64String($bytes)
        try { Start-Process powershell -ArgumentList "-NoProfile", "-EncodedCommand", $encoded -Verb RunAs -Wait } catch { }
    }
}

function Get-PortOwnerPid ([int]$port) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
    if ($conn -and $conn.OwningProcess -gt 0) { return $conn.OwningProcess }
    return 0
}

function Test-HLogistikServer {
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:4174/api/health" -TimeoutSec 2
        return [bool]$health.ok
    } catch {
        return $false
    }
}

function Stop-RunningServer {
    if ($script:existingServerPid -gt 0) {
        Stop-Process -Id $script:existingServerPid -Force -ErrorAction SilentlyContinue
        $script:existingServerPid = 0
        return
    }

    if ($global:serverProc -and -not $global:serverProc.HasExited) {
        $global:serverProc.Kill()
    }
}

function Backup-Database {
    if (-not (Test-Path $databaseFile)) {
        [System.Windows.Forms.MessageBox]::Show(
            "Keine Datenbank gefunden:`n$databaseFile",
            "HLogistik Backup",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return
    }

    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $target = Join-Path $backupDir "logistik-$timestamp.sqlite"
    Copy-Item -LiteralPath $databaseFile -Destination $target
    [System.Windows.Forms.MessageBox]::Show(
        "Backup erstellt:`n$target",
        "HLogistik Backup",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}

function New-AppIcon {
    $bitmap = New-Object System.Drawing.Bitmap 32, 32
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $greenBrush = New-Object System.Drawing.SolidBrush $cGreen
    $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $darkBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#17211b"))

    $graphics.FillRectangle($greenBrush, 2, 2, 28, 28)
    $graphics.FillRectangle($whiteBrush, 8, 8, 16, 14)
    $graphics.FillRectangle($greenBrush, 10, 10, 12, 2)
    $graphics.FillRectangle($greenBrush, 10, 15, 12, 2)
    $graphics.FillRectangle($greenBrush, 10, 20, 8, 2)
    $graphics.FillRectangle($darkBrush, 6, 24, 20, 3)

    $greenBrush.Dispose()
    $whiteBrush.Dispose()
    $darkBrush.Dispose()
    $graphics.Dispose()

    return [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
}

function Add-LogLine ([string]$text, [bool]$isError = $false) {
    if ($isError) { $script:queue.Enqueue("[ERR]$text") }
    else { $script:queue.Enqueue($text) }
}

function Read-NewLogLines ([string]$path, [ref]$position) {
    if (-not (Test-Path $path)) { return @() }

    try {
        $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            if ($position.Value -gt $stream.Length) { $position.Value = 0 }
            $stream.Seek($position.Value, [System.IO.SeekOrigin]::Begin) | Out-Null
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
            $text = $reader.ReadToEnd()
            $position.Value = $stream.Position
            if (-not $text) { return @() }
            return $text -split "\r?\n" | Where-Object { $_ }
        } finally {
            $stream.Dispose()
        }
    } catch {
        return @()
    }
}

# ── Voraussetzungen pruefen ────────────────────────────────────────────────────

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
Write-ManagerLog "Node gefunden: $nodeExe"

$localHostname = Get-LocalHostname
Write-ManagerLog "Lokaler Hostname: $localHostname"
Ensure-HostsEntry $localHostname
Write-ManagerLog "Hosts-Eintrag geprueft"

$script:existingServerPid = 0
$script:stopRequested = $false

$ownerPid = Get-PortOwnerPid 4174
Write-ManagerLog "Port 4174 OwnerPid: $ownerPid"
if ($ownerPid -gt 0) {
    $ownerProc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
    $procName  = if ($ownerProc) { $ownerProc.Name } else { "Unbekannt" }
    if (Test-HLogistikServer) {
        $script:existingServerPid = $ownerPid
    } else {
        $msg    = "Port 4174 wird bereits verwendet ($procName, PID $ownerPid).`nDieser Prozess antwortet nicht wie HLogistik.`nProzess beenden und HLogistik starten?"
        $answer = [System.Windows.Forms.MessageBox]::Show($msg, "HLogistik",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question)
        if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) {
            Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 700
        } else { exit 0 }
    }
}

# ── Log-Queue (thread-sicher, kein form.Invoke noetig) ─────────────────────────

$script:queue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
$script:serverExitedHandled = $false
$script:networkUrl = ""
$script:logPosition = 0L
$script:errorLogPosition = 0L
$script:appIcon = New-AppIcon
$script:reallyExit = $false
Write-ManagerLog "UI wird aufgebaut"

# ── Fenster ────────────────────────────────────────────────────────────────────

$form = New-Object System.Windows.Forms.Form
$form.Text          = "HLogistik Server"
$form.Size          = New-Object System.Drawing.Size(700, 560)
$form.MinimumSize   = New-Object System.Drawing.Size(520, 420)
$form.StartPosition = "CenterScreen"
$form.BackColor     = $cBg
$form.ForeColor     = $cText
$form.Font          = New-Object System.Drawing.Font("Segoe UI", 10)
$form.Icon          = $script:appIcon
$form.ShowInTaskbar = $true

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
$lblStatus.Location  = New-Object System.Drawing.Point(500, 24)
$pnlHeader.Controls.Add($lblStatus)

$pnlHeader.add_Resize({
    $lblStatus.Location = New-Object System.Drawing.Point(($pnlHeader.Width - $lblStatus.Width - 16), 24)
})

$form.Controls.Add($pnlHeader)

# -- URLs --
$urlCount          = if ($localHostname) { 3 } else { 2 }
$pnlUrls           = New-Object System.Windows.Forms.Panel
$pnlUrls.Dock      = "Top"
$pnlUrls.Height    = 10 + $urlCount * 26
$pnlUrls.BackColor = $cBg

function New-UrlLink ([string]$label, [int]$y, [bool]$primary) {
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

$lnkNet = New-UrlLink "Netzwerk: wird ermittelt..." 34 $false
$lnkNet.add_LinkClicked({ if ($script:networkUrl) { Start-Process $script:networkUrl } })

if ($localHostname) {
    $hnTarget = "http://${localHostname}:4174"
    $lnkHn = New-UrlLink $hnTarget 60 $false
    $lnkHn.add_LinkClicked([scriptblock]::Create("Start-Process '$hnTarget'"))
}

$form.Controls.Add($pnlUrls)

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

$btnBackup             = New-Object System.Windows.Forms.Button
$btnBackup.Text        = "Backup"
$btnBackup.Size        = New-Object System.Drawing.Size(100, 36)
$btnBackup.Location    = New-Object System.Drawing.Point(210, 10)
$btnBackup.FlatStyle   = "Flat"
$btnBackup.FlatAppearance.BorderSize = 0
$btnBackup.BackColor   = [System.Drawing.ColorTranslator]::FromHtml("#2a2a3a")
$btnBackup.ForeColor   = $cText
$btnBackup.add_Click({ Backup-Database })
$pnlBottom.Controls.Add($btnBackup)

$btnRestart             = New-Object System.Windows.Forms.Button
$btnRestart.Text        = "Neustart"
$btnRestart.Size        = New-Object System.Drawing.Size(110, 36)
$btnRestart.Location    = New-Object System.Drawing.Point(320, 10)
$btnRestart.FlatStyle   = "Flat"
$btnRestart.FlatAppearance.BorderSize = 0
$btnRestart.BackColor   = [System.Drawing.ColorTranslator]::FromHtml("#2a2a3a")
$btnRestart.ForeColor   = $cText
$btnRestart.add_Click({
    $script:reallyExit = $true
    $script:stopRequested = $true
    Stop-RunningServer
    Start-Process powershell -ArgumentList "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", $MyInvocation.MyCommand.Path
    $form.Close()
})
$pnlBottom.Controls.Add($btnRestart)

$btnStop             = New-Object System.Windows.Forms.Button
$btnStop.Text        = "Server stoppen"
$btnStop.Size        = New-Object System.Drawing.Size(150, 36)
$btnStop.FlatStyle   = "Flat"
$btnStop.FlatAppearance.BorderSize = 0
$btnStop.BackColor   = [System.Drawing.ColorTranslator]::FromHtml("#2a2a3a")
$btnStop.ForeColor   = $cRed
$btnStop.add_Click({
    $script:reallyExit = $true
    $script:stopRequested = $true
    Stop-RunningServer
    $form.Close()
})
$pnlBottom.Controls.Add($btnStop)

$trayMenu = New-Object System.Windows.Forms.ContextMenuStrip
$trayOpen = $trayMenu.Items.Add("Fenster anzeigen")
$trayOpen.add_Click({
    $form.Show()
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
    $form.Activate()
})
$trayBrowser = $trayMenu.Items.Add("App im Browser oeffnen")
$trayBrowser.add_Click({ Start-Process "http://localhost:4174" })
$trayBackup = $trayMenu.Items.Add("Backup erstellen")
$trayBackup.add_Click({ Backup-Database })
$trayRestart = $trayMenu.Items.Add("Server neu starten")
$trayRestart.add_Click({
    $script:reallyExit = $true
    $script:stopRequested = $true
    Stop-RunningServer
    Start-Process powershell -ArgumentList "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", $MyInvocation.MyCommand.Path
    $form.Close()
})
$trayStop = $trayMenu.Items.Add("Server stoppen und beenden")
$trayStop.add_Click({
    $script:reallyExit = $true
    $script:stopRequested = $true
    Stop-RunningServer
    $form.Close()
})

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = $script:appIcon
$notifyIcon.Text = "HLogistik Server"
$notifyIcon.ContextMenuStrip = $trayMenu
$notifyIcon.Visible = $true
$notifyIcon.add_DoubleClick({
    $form.Show()
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
    $form.Activate()
})

$pnlBottom.add_Resize({
    $btnStop.Location = New-Object System.Drawing.Point(($pnlBottom.Width - $btnStop.Width - 16), 10)
})

$form.Controls.Add($pnlBottom)

# -- Log --
$logBox             = New-Object System.Windows.Forms.RichTextBox
$logBox.Dock        = "Fill"
$logBox.ReadOnly    = $true
$logBox.BackColor   = $cLogBg
$logBox.ForeColor   = $cLogFg
$logBox.Font        = New-Object System.Drawing.Font("Cascadia Mono,Consolas,Courier New", 9)
$logBox.BorderStyle = "None"
$form.Controls.Add($logBox)

# ── Timer: verarbeitet Queue auf UI-Thread (kein Invoke noetig) ────────────────

$uiTimer          = New-Object System.Windows.Forms.Timer
$uiTimer.Interval = 150

$uiTimer.add_Tick({
    foreach ($logLine in (Read-NewLogLines $logFile ([ref]$script:logPosition))) {
        $script:queue.Enqueue($logLine)
    }
    foreach ($errorLine in (Read-NewLogLines $errorLogFile ([ref]$script:errorLogPosition))) {
        $script:queue.Enqueue("[ERR]$errorLine")
    }

    $line = $null
    while ($script:queue.TryDequeue([ref]$line)) {
        $isErr = $line.StartsWith("[ERR]")
        $text  = if ($isErr) { $line.Substring(5) } else { $line }
        $ts    = Get-Date -Format "HH:mm:ss"

        $logBox.SelectionStart  = $logBox.TextLength
        $logBox.SelectionLength = 0
        $logBox.SelectionColor  = if ($isErr) { $cLogErr } else { $cLogFg }
        $logBox.AppendText("[$ts] $text`n")
        $logBox.ScrollToCaret()

        if ($text -match "Im Netzwerk: (http://[\d.:]+/)") {
            $script:networkUrl = $Matches[1]
            $lnkNet.Text = $Matches[1]
        }
        if ($text -match "laeuft auf") {
            $lblStatus.Text      = "$dot Online"
            $lblStatus.ForeColor = $cGreenL
            $lblStatus.Location  = New-Object System.Drawing.Point(($pnlHeader.Width - $lblStatus.Width - 16), 24)
        }
    }

    if ($global:serverProc -and $global:serverProc.HasExited -and -not $script:serverExitedHandled) {
        $script:serverExitedHandled = $true
        Add-LogLine "Serverprozess wurde beendet. Exit-Code: $($global:serverProc.ExitCode)" $true
        $lblStatus.Text      = "$dot Gestoppt"
        $lblStatus.ForeColor = $cRed
        $lblStatus.Location  = New-Object System.Drawing.Point(($pnlHeader.Width - $lblStatus.Width - 16), 24)
        $btnStop.Text        = "Schliessen"
        $btnStop.ForeColor   = $cText
    }
})

$form.add_FormClosing({
    $uiTimer.Stop()
    $serverStillRunning =
        ($script:existingServerPid -gt 0 -and (Get-Process -Id $script:existingServerPid -ErrorAction SilentlyContinue)) -or
        ($global:serverProc -and -not $global:serverProc.HasExited)

    if ($serverStillRunning -and -not $script:stopRequested) {
        $answer = [System.Windows.Forms.MessageBox]::Show(
            "Der Server laeuft noch.`n`nJa: Server beenden`nNein: Im Hintergrund weiterlaufen lassen`nAbbrechen: Fenster offen lassen",
            "HLogistik Server",
            [System.Windows.Forms.MessageBoxButtons]::YesNoCancel,
            [System.Windows.Forms.MessageBoxIcon]::Question
        )

        if ($answer -eq [System.Windows.Forms.DialogResult]::Cancel) {
            $_.Cancel = $true
            $uiTimer.Start()
            return
        }

        if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) {
            $script:reallyExit = $true
            Stop-RunningServer
            return
        }

        if ($answer -eq [System.Windows.Forms.DialogResult]::No) {
            $_.Cancel = $true
            $form.Hide()
            $notifyIcon.Visible = $true
            $notifyIcon.ShowBalloonTip(2500, "HLogistik Server", "Der Server laeuft weiter. Doppelklick auf das Symbol oeffnet das Fenster wieder.", [System.Windows.Forms.ToolTipIcon]::Info)
            $uiTimer.Start()
            return
        }
    }

    if ($script:reallyExit -or -not $serverStillRunning) {
        $notifyIcon.Visible = $false
        $notifyIcon.Dispose()
    }
})

$uiTimer.Start()
if ($script:existingServerPid -gt 0) {
    Write-ManagerLog "Haenge mich an bestehenden Server: PID $script:existingServerPid"
    Add-LogLine "HLogistik laeuft bereits im Hintergrund. PID: $script:existingServerPid"
    Add-LogLine "laeuft auf http://localhost:4174/"
} else {
    try {
        Write-ManagerLog "Starte Node-Server"
        New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
        Remove-Item -LiteralPath $logFile, $errorLogFile -ErrorAction SilentlyContinue
        $script:logPosition = 0L
        $script:errorLogPosition = 0L
        $script:serverExitedHandled = $false
        $serverScript = Join-Path $root "server.mjs"
        $global:serverProc = Start-Process `
            -FilePath $nodeExe `
            -ArgumentList "`"$serverScript`"" `
            -WorkingDirectory $root `
            -WindowStyle Hidden `
            -RedirectStandardOutput $logFile `
            -RedirectStandardError $errorLogFile `
            -PassThru
        Write-ManagerLog "Node-Server gestartet: PID $($global:serverProc.Id)"
        Add-LogLine "Serverprozess gestartet. PID: $($global:serverProc.Id)"
    } catch {
        Write-ManagerLog "Serverstart fehlgeschlagen: $_"
        Add-LogLine "Server konnte nicht gestartet werden: $_" $true
        $lblStatus.Text      = "$dot Fehler"
        $lblStatus.ForeColor = $cRed
    }
}

[System.Windows.Forms.Application]::Run($form)
