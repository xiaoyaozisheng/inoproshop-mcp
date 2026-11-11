# =====================================================================
# check_status.ps1 - Report watcher/TIA Portal connection status.
# Standalone template (loaded via loadTemplate) - no helpers required.
# NOTE: keep this file ASCII-only.
# =====================================================================

Write-Log "=== TIA Portal MCP Status ==="

if ($null -ne $Global:TiaPortal) {
    Write-Log "Portal: attached"
    try {
        Write-Log "Open projects: $($Global:TiaPortal.Projects.Count)"
        foreach ($p in $Global:TiaPortal.Projects) {
            Write-Log "  Project: $($p.Path)"
        }
    } catch {
        Write-Log "Open projects: <error reading: $($_.Exception.Message)>"
    }
} elseif ('Siemens.Engineering.TiaPortal' -as [type]) {
    try {
        $procs = [Siemens.Engineering.TiaPortal]::GetProcesses()
        Write-Log "Portal: not attached ($($procs.Count) running TIA Portal instance(s) detected)"
    } catch {
        Write-Log "Portal: not attached (Openness loaded, process query failed)"
    }
} else {
    Write-Log "Portal: not attached (Openness assembly not loaded)"
}

if ($null -ne $Global:TiaProject) {
    Write-Log "Active project: $($Global:TiaProject.Path)"
} else {
    Write-Log "Active project: none"
}

Write-Log "SCRIPT_SUCCESS: status collected."
