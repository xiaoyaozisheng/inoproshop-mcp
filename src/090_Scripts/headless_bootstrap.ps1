# =====================================================================
# headless_bootstrap.ps1 - Bootstrap preamble for headless (spawn-per-command)
# execution. FB_HeadlessExecutor concatenates: this bootstrap + helper
# scripts + the command script, then runs the result via powershell.exe -File.
#
# Placeholders {PUBLIC_API_DLL} {SCRIPTS_DIR} are interpolated by Node.
# NOTE: keep this file ASCII-only.
# =====================================================================

$ErrorActionPreference = 'Continue'

# Load the Openness assembly (same auto-detect logic as watcher.ps1)
$PublicApiDll = "{PUBLIC_API_DLL}"
$ResolvedDll = ""
try {
    if (-not [string]::IsNullOrWhiteSpace($PublicApiDll) -and [System.IO.File]::Exists($PublicApiDll)) {
        $ResolvedDll = $PublicApiDll
    } else {
        $automationRoot = 'C:\Program Files\Siemens\Automation'
        if ([System.IO.Directory]::Exists($automationRoot)) {
            $candidates = Get-ChildItem -Path $automationRoot -Filter 'Siemens.Engineering.dll' -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match 'PublicAPI' } |
                Sort-Object FullName -Descending
            if ($candidates.Count -gt 0) { $ResolvedDll = $candidates[0].FullName }
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($ResolvedDll)) {
        Add-Type -Path $ResolvedDll
        Write-Host "[BOOTSTRAP] Openness assembly loaded: $ResolvedDll"
    } else {
        Write-Host "[BOOTSTRAP] WARNING: Siemens.Engineering.dll not found; project operations will fail."
    }
} catch {
    Write-Host "[BOOTSTRAP] WARNING: failed to load Openness assembly: $($_.Exception.Message)"
}

# Preload shared helper functions
$ScriptsDir = "{SCRIPTS_DIR}"
foreach ($helper in @('_text_utils.ps1','ensure_project_open.ps1','require_project_open.ps1','find_object_by_path.ps1','ensure_online_connection.ps1')) {
    $helperPath = Join-Path $ScriptsDir $helper
    if ([System.IO.File]::Exists($helperPath)) {
        try { . $helperPath } catch { Write-Host "[BOOTSTRAP] Helper load failed for ${helper}: $($_.Exception.Message)" }
    }
}

# In headless mode scripts must attach/create a portal per run
function Ensure-PortalForHeadless {
    if ($null -eq $Global:TiaPortal -and ('Siemens.Engineering.TiaPortal' -as [type])) {
        $procs = [Siemens.Engineering.TiaPortal]::GetProcesses()
        if ($procs.Count -gt 0) { $Global:TiaPortal = $procs[0].Attach() }
    }
    return $Global:TiaPortal
}
