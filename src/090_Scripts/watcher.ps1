# =====================================================================
# watcher.ps1 - Persistent IPC watcher for the TIA Portal MCP server.
#
# Replaces the IronPython watcher used with CODESYS. Unlike CODESYS,
# TIA Portal Openness is an external .NET API: this script runs as a
# standalone powershell.exe process (no in-IDE script injection needed),
# loads Siemens.Engineering.dll, and drives TIA Portal directly.
#
# Protocol (unchanged from the CODESYS version):
#   commands/<id>.command.json  - written by Node (contains scriptPath)
#   commands/<id>.ps1           - interpolated PowerShell command script
#   results/<id>.result.json    - result JSON written here by the watcher
#   ready.signal                - watcher alive marker (JSON)
#   terminate.signal            - request watcher shutdown
#
# Placeholders {IPC_BASE_DIR} {SCRIPTS_DIR} {PUBLIC_API_DLL} {TIA_EXE_PATH}
# are interpolated by Node (FB_TiaPortalLauncher) before launch.
#
# NOTE: keep this file ASCII-only (PS 5.1 reads non-BOM files as ANSI).
# =====================================================================

$ErrorActionPreference = 'Continue'

$IpcBaseDir   = "{IPC_BASE_DIR}"
$ScriptsDir   = "{SCRIPTS_DIR}"
$PublicApiDll = "{PUBLIC_API_DLL}"
$TiaExePath   = "{TIA_EXE_PATH}"

$WatcherVersion = "1.0.0"
$PollIntervalMs = 50

$CommandsDir = Join-Path $IpcBaseDir 'commands'
$ResultsDir  = Join-Path $IpcBaseDir 'results'
$LogFile     = Join-Path $IpcBaseDir 'watcher.log'
$ErrorFile   = Join-Path $IpcBaseDir 'watcher_error.txt'
$ReadyPath   = Join-Path $IpcBaseDir 'ready.signal'
$TermPath    = Join-Path $IpcBaseDir 'terminate.signal'

function Write-WatcherLog([string]$Message) {
    try {
        $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $Message
        Add-Content -Path $LogFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch { }
}

function Write-WatcherError([string]$Message) {
    try {
        $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $Message
        Add-Content -Path $ErrorFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch { }
}

function Write-AtomicFile([string]$Path, [string]$Content) {
    # Write to .tmp then move; retry to ride out transient AV/scanner locks.
    $tmp = "$Path.tmp"
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            [System.IO.File]::WriteAllText($tmp, $Content, (New-Object System.Text.UTF8Encoding($false)))
            if ([System.IO.File]::Exists($Path)) {
                [System.IO.File]::Replace($tmp, $Path, $null)
            } else {
                [System.IO.File]::Move($tmp, $Path)
            }
            return
        } catch {
            if ($attempt -eq 5) { throw }
            Start-Sleep -Milliseconds (50 * $attempt)
        }
    }
}

# --- Ensure IPC directories -------------------------------------------------
try {
    if (-not [System.IO.Directory]::Exists($CommandsDir)) {
        [System.IO.Directory]::CreateDirectory($CommandsDir) | Out-Null
    }
    if (-not [System.IO.Directory]::Exists($ResultsDir)) {
        [System.IO.Directory]::CreateDirectory($ResultsDir) | Out-Null
    }
} catch {
    Write-WatcherError ("FATAL: cannot create IPC directories: " + $_.Exception.Message)
    exit 1
}

# --- Load TIA Portal Openness assembly --------------------------------------
$ResolvedDll = ""
try {
    if (-not [string]::IsNullOrWhiteSpace($PublicApiDll) -and [System.IO.File]::Exists($PublicApiDll)) {
        $ResolvedDll = $PublicApiDll
    } else {
        # Auto-detect: newest PublicAPI under C:\Program Files\Siemens\Automation\Portal V*
        $candidates = @()
        $automationRoot = 'C:\Program Files\Siemens\Automation'
        if ([System.IO.Directory]::Exists($automationRoot)) {
            $candidates = Get-ChildItem -Path $automationRoot -Filter 'Siemens.Engineering.dll' -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match 'PublicAPI' } |
                Sort-Object FullName -Descending
        }
        if ($candidates.Count -gt 0) { $ResolvedDll = $candidates[0].FullName }
    }
    if (-not [string]::IsNullOrWhiteSpace($ResolvedDll)) {
        Add-Type -Path $ResolvedDll
        Write-WatcherLog "Openness assembly loaded: $ResolvedDll"
    } else {
        Write-WatcherError "FATAL: Siemens.Engineering.dll not found. Install TIA Portal with Openness, or pass the PublicAPI dll path."
    }
} catch {
    Write-WatcherError ("FATAL: failed to load Openness assembly: " + $_.Exception.Message)
}

# --- Preload shared helper functions (helper scripts define functions only) --
$HelperFiles = @(
    '_text_utils.ps1',
    'ensure_project_open.ps1',
    'require_project_open.ps1',
    'find_object_by_path.ps1',
    'ensure_online_connection.ps1'
)
foreach ($helper in $HelperFiles) {
    $helperPath = Join-Path $ScriptsDir $helper
    if ([System.IO.File]::Exists($helperPath)) {
        try { . $helperPath } catch { Write-WatcherError ("Helper load failed for " + $helper + ": " + $_.Exception.Message) }
    } else {
        Write-WatcherError "Helper script not found: $helperPath"
    }
}

# --- Write ready.signal EARLY (portal attach is lazy, on first command) ------
try {
    $portalAttached = $false
    try {
        if ('Siemens.Engineering.TiaPortal' -as [type]) {
            $procs = [Siemens.Engineering.TiaPortal]::GetProcesses()
            $portalAttached = ($procs.Count -gt 0)
        }
    } catch { }
    $info = [ordered]@{
        version         = $WatcherVersion
        host_version    = $PSVersionTable.PSVersion.ToString()
        platform        = 'windows'
        ipc_dir         = $IpcBaseDir
        timestamp       = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        pid             = $PID
        openness_dll    = $ResolvedDll
        tia_detected    = $portalAttached
        tia_exe         = $TiaExePath
    }
    Write-AtomicFile $ReadyPath (ConvertTo-Json -InputObject $info -Depth 4)
    Write-WatcherLog "Ready signal written: $ReadyPath"
} catch {
    Write-WatcherError ("FATAL: cannot write ready.signal: " + $_.Exception.Message)
    exit 2
}

# --- Command execution -------------------------------------------------------
function Invoke-McpCommandFile([string]$CommandFilePath) {
    $fileName = [System.IO.Path]::GetFileName($CommandFilePath)
    $requestId = $fileName -replace '\.command\.json$', ''
    $resultPath = Join-Path $ResultsDir ($requestId + '.result.json')

    $data = $null
    $scriptPath = ''
    try {
        $raw = [System.IO.File]::ReadAllText($CommandFilePath, (New-Object System.Text.UTF8Encoding($false)))
        $data = $raw | ConvertFrom-Json
        $scriptPath = [string]$data.scriptPath
    } catch {
        $err = "Read error: $($_.Exception.Message)"
        Write-WatcherLog "$requestId - $err"
        Write-AtomicFile $resultPath (ConvertTo-Json -InputObject @{
            requestId = $requestId; success = $false; output = ''; error = $err
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        } -Depth 4 -Compress)
        return
    }

    if ([string]::IsNullOrWhiteSpace($scriptPath) -or -not [System.IO.File]::Exists($scriptPath)) {
        Write-AtomicFile $resultPath (ConvertTo-Json -InputObject @{
            requestId = $requestId; success = $false; output = ''; error = "Script file not found: $scriptPath"
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        } -Depth 4 -Compress)
        return
    }

    Write-WatcherLog "Processing command: $requestId"

    # Reset the shared output buffer (Write-Log appends here)
    $Global:__McpOutput = New-Object System.Text.StringBuilder
    $success = $true
    $errorText = ''

    try {
        # ReadAllText auto-detects BOM; UTF-8 without BOM decodes as UTF-8.
        $code = [System.IO.File]::ReadAllText($scriptPath)
        # Dot-source in the watcher scope so $Global:TiaPortal / helper
        # functions persist across commands (same state model as the
        # CODESYS scriptengine exec loop).
        . ([scriptblock]::Create($code))
    } catch {
        $success = $false
        $errorText = "$($_.Exception.GetType().Name): $($_.Exception.Message)"
        if ($_.ScriptStackTrace) { $errorText += "`n" + $_.ScriptStackTrace }
    }

    $output = ''
    if ($null -ne $Global:__McpOutput) { $output = $Global:__McpOutput.ToString() }

    # Marker semantics identical to the CODESYS watcher:
    #  - exception          -> failure
    #  - SCRIPT_ERROR mark  -> failure
    #  - otherwise          -> success
    if ($output -match 'SCRIPT_ERROR') {
        $success = $false
        if ([string]::IsNullOrEmpty($errorText)) {
            $errorText = 'Script reported error via SCRIPT_ERROR marker'
        }
    }

    $result = [ordered]@{
        requestId = $requestId
        success   = $success
        output    = $output
        error     = $errorText
        timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    }
    try {
        Write-AtomicFile $resultPath (ConvertTo-Json -InputObject $result -Depth 6 -Compress)
        Write-WatcherLog "Result written: success=$success"
    } catch {
        Write-WatcherError ("Failed to write result for " + $requestId + ": " + $_.Exception.Message)
    }

    # Cleanup command + script files so the queue can move on
    foreach ($stale in @($CommandFilePath, $scriptPath)) {
        try {
            if ([System.IO.File]::Exists($stale)) { [System.IO.File]::Delete($stale) }
        } catch { }
    }
}

# --- Main polling loop -------------------------------------------------------
Write-WatcherLog "Background watcher v$WatcherVersion started (PID $PID). Polling $CommandsDir"

while ($true) {
    try {
        if ([System.IO.File]::Exists($TermPath)) {
            Write-WatcherLog 'Terminate signal received'
            break
        }
        $cmdFiles = @(Get-ChildItem -Path $CommandsDir -Filter '*.command.json' -ErrorAction SilentlyContinue |
            Sort-Object Name)
        foreach ($cmd in $cmdFiles) {
            try {
                Invoke-McpCommandFile $cmd.FullName
            } catch {
                # Never let a poisoned command stall the queue: report, drop, move on.
                $rid = [System.IO.Path]::GetFileName($cmd.FullName) -replace '\.command\.json$', ''
                Write-WatcherLog "process_command crashed for $rid : $($_.Exception.Message)"
                try {
                    Write-AtomicFile (Join-Path $ResultsDir ($rid + '.result.json')) (ConvertTo-Json -InputObject @{
                        requestId = $rid; success = $false; output = ''
                        error = "Watcher crashed while processing this command: $($_.Exception.Message)"
                        timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                    } -Depth 4 -Compress)
                } catch { }
                try { [System.IO.File]::Delete($cmd.FullName) } catch { }
            }
        }
    } catch {
        Write-WatcherLog "Worker loop error: $($_.Exception.Message)"
    }
    Start-Sleep -Milliseconds $PollIntervalMs
}

Write-WatcherLog 'Background watcher stopped'
exit 0
