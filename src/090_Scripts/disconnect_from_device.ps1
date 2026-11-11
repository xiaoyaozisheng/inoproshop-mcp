# =====================================================================
# disconnect_from_device.ps1 - Clear the recorded connection target.
# Params: {PROJECT_FILE_PATH}
# Helpers required: ensure_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
    $Global:TiaOnlineTarget = $null
    Write-Log "Disconnected (connection target cleared)."
    Write-Log "SCRIPT_SUCCESS: Disconnected."
} catch {
    Write-Log "Error during disconnect: $($_.Exception.Message)"
    throw "Error disconnecting from device: $($_.Exception.Message)"
}
