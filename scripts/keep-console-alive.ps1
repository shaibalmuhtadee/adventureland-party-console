<#
.SYNOPSIS
  Keeps Adventureland Party Console running: restarts it on exit and can
  install a Windows Scheduled Task so it also restarts after logon or if the
  watchdog itself dies.

.DESCRIPTION
  Runs `node tools/hosting/local.mts` in a loop with stdout/stderr captured
  to `.build/keep-alive/`, exponential backoff between restarts, and optional
  sleep prevention while the console runs.

  Run `.\scripts\start-console.ps1` once first for setup and builds; this
  script only keeps already-built services up.

.EXAMPLE
  powershell -File scripts\keep-console-alive.ps1 -InstallTask
  Registers the scheduled task, starts it hidden, and returns. Safe to close
  this window afterwards.

.EXAMPLE
  powershell -File scripts\keep-console-alive.ps1 -Stop
  Removes the scheduled task and stops the watchdog and console processes.
#>
[CmdletBinding(DefaultParameterSetName = 'Run')]
param(
    [switch]$ProductionDashboard,
    [switch]$DevDashboard,
    [switch]$CoordinatorOnly,
    [switch]$InstallTask,
    [switch]$UninstallTask,
    [switch]$Stop,
    [switch]$DryRun,
    [switch]$AllowSleep,
    [string]$TaskName = 'AdventurelandPartyConsole'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$caracalRoot = Join-Path $repoRoot '.caracal'
$sessionPath = Join-Path $caracalRoot 'session.clixml'
$logDir = Join-Path $repoRoot '.build/keep-alive'
$localMts = Join-Path $repoRoot 'tools/hosting/local.mts'
$scriptPath = Join-Path $PSScriptRoot 'keep-console-alive.ps1'

$consoleTokens = @(
    'tools\hosting\local.mts',
    'tools\dashboard\supervisor.mts',
    'tools\dashboard\build.mts',
    'tools\game\build.mts',
    'tools\game\watch.mts',
    '.caracal\main.js'
)

function Write-KeepAliveEvent {
    param([Parameter(Mandatory)][string]$Message)
    $line = '{0:u} {1}' -f (Get-Date), $Message
    Add-Content -LiteralPath (Join-Path $logDir 'keep-alive.log') -Value $line -ErrorAction SilentlyContinue
    Write-Host $line
}

function Get-ConsoleProcessTree {
    $repoToken = [IO.Path]::GetFullPath($repoRoot).ToLowerInvariant()
    $self = $PID
    $procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessId -ne $self -and $_.Name -in @('node.exe', 'pwsh.exe', 'powershell.exe') -and
        -not [string]::IsNullOrWhiteSpace($_.CommandLine)
    })
    $mine = @()
    foreach ($p in $procs) {
        $cmd = $p.CommandLine.ToLowerInvariant()
        if ($cmd.Contains($scriptPath.ToLowerInvariant()) -and $p.Name -ne 'node.exe') { $mine += $p; continue }
        if (-not $cmd.Contains($repoToken)) { continue }
        foreach ($token in $consoleTokens) {
            if ($cmd.Contains($token)) { $mine += $p; break }
        }
    }
    return $mine
}

function Stop-ConsoleProcesses {
    $targets = @(Get-ConsoleProcessTree)
    if ($targets.Count -eq 0) { return }
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $childrenByParent = @{}
    foreach ($p in $all) {
        $parentId = [int]$p.ParentProcessId
        if (-not $childrenByParent.ContainsKey($parentId)) {
            $childrenByParent[$parentId] = [System.Collections.Generic.List[int]]::new()
        }
        $childrenByParent[$parentId].Add([int]$p.ProcessId)
    }
    $ordered = [System.Collections.Generic.List[int]]::new()
    $visited = @{}
    $addPostOrder = $null
    $addPostOrder = {
        param([int]$ProcessId)
        if ($visited.ContainsKey($ProcessId)) { return }
        $visited[$ProcessId] = $true
        if ($childrenByParent.ContainsKey($ProcessId)) {
            foreach ($childId in $childrenByParent[$ProcessId]) { & $addPostOrder $childId }
        }
        $ordered.Add($ProcessId)
    }
    foreach ($t in $targets) { & $addPostOrder ([int]$t.ProcessId) }
    foreach ($id in $ordered) {
        if ($id -eq $PID) { continue }
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Stopped $($targets.Count) stale console process(es)."
}

function Get-SavedSession {
    if (-not (Test-Path -LiteralPath $sessionPath)) {
        throw 'No saved game session. Run .\scripts\start-console.ps1 once to connect your account first.'
    }
    $secureSession = Import-Clixml -LiteralPath $sessionPath
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSession)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Get-ForwardedSwitches {
    $names = @()
    if ($ProductionDashboard) { $names += '-ProductionDashboard' }
    if ($DevDashboard) { $names += '-DevDashboard' }
    if ($CoordinatorOnly) { $names += '-CoordinatorOnly' }
    if ($AllowSleep) { $names += '-AllowSleep' }
    return $names
}

function Get-LocalArgs {
    $args = @()
    if ($CoordinatorOnly) { $args += '--coordinator-only' }
    if ($DevDashboard) { $args += '--development' }
    elseif ($ProductionDashboard) { $args += '--production' }
    return $args
}

function Get-TaskHost {
    $pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
    if ($pwsh) { return $pwsh }
    return (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
}

if ($UninstallTask) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Scheduled task '$TaskName' removed (if it existed)."
    return
}

if ($Stop) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Stop-ConsoleProcesses
    Write-Host "Console stopped and scheduled task '$TaskName' removed (if it existed)."
    return
}

if ($DryRun) {
    Write-Host "Repository : $repoRoot"
    Write-Host "Launch     : node `"$localMts`" $(Get-LocalArgs)"
    Write-Host "Logs       : $logDir"
    Write-Host "Session    : $(if (Test-Path -LiteralPath $sessionPath) { 'found (value not shown)' } else { 'MISSING - run start-console.ps1 first' })"
    Write-Host "Task action: $(Get-TaskHost) -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" $(Get-ForwardedSwitches)"
    Write-Host "Stale console processes now: $((Get-ConsoleProcessTree).Count)"
    return
}

if ($InstallTask) {
    $hostExe = Get-TaskHost
    $taskArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" $(Get-ForwardedSwitches)".Trim()
    $action = New-ScheduledTaskAction -Execute $hostExe -Argument $taskArgs -WorkingDirectory $repoRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
        -RestartCount 9999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force `
        -Description 'Keeps Adventureland Party Console running; restarts it if it stops.' | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Scheduled task '$TaskName' installed and started. It runs hidden and restarts the console if it stops."
    Write-Host "Stop it any time with: powershell -File scripts\keep-console-alive.ps1 -Stop"
    return
}

# --- Watchdog loop ---
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$session = Get-SavedSession
Stop-ConsoleProcesses

$sleepHeld = $false
try {
    if (-not $AllowSleep) {
        Add-Type -Namespace Power -Name KeepAwake -MemberDefinition @'
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@ -ErrorAction Stop
        [Power.KeepAwake]::SetThreadExecutionState(0x80000000 -bor 0x00000001) | Out-Null
        $sleepHeld = $true
    }
    Write-KeepAliveEvent "Watchdog started (pid $PID). Sleep prevention: $(if ($sleepHeld) { 'on' } else { 'off' })."
    $backoffSeconds = 5
    $lastBeat = Get-Date
    while ($true) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $outLog = Join-Path $logDir "console-$stamp.log"
        $errLog = Join-Path $logDir "console-$stamp.err.log"
        $env:AL_SESSION = $session
        $started = Get-Date
        Write-KeepAliveEvent "Starting party services: node $localMts $(Get-LocalArgs)"
        $proc = Start-Process -FilePath 'node' -ArgumentList (@($localMts) + (Get-LocalArgs)) `
            -WorkingDirectory $repoRoot -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
            -WindowStyle Hidden -Wait -PassThru
        $uptime = (Get-Date) - $started
        Write-KeepAliveEvent "Party services exited with code $($proc.ExitCode) after $([int]$uptime.TotalSeconds)s."
        Get-ChildItem -LiteralPath $logDir -Filter 'console-*.log' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -Skip 20 |
            Remove-Item -Force -ErrorAction SilentlyContinue
        if ($uptime.TotalSeconds -ge 300) { $backoffSeconds = 5 }
        else { $backoffSeconds = [Math]::Min($backoffSeconds * 2, 60) }
        if (((Get-Date) - $lastBeat).TotalMinutes -ge 60) {
            Write-KeepAliveEvent 'Watchdog heartbeat: still watching.'
            $lastBeat = Get-Date
        }
        Start-Sleep -Seconds $backoffSeconds
    }
} finally {
    if ($sleepHeld) {
        [Power.KeepAwake]::SetThreadExecutionState(0x80000000) | Out-Null
    }
    Remove-Item Env:\AL_SESSION -ErrorAction SilentlyContinue
}
