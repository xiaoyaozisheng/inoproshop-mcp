# =====================================================================
# read_variable.ps1 - NOT SUPPORTED on TIA Portal.
# Params: {PROJECT_FILE_PATH} {VARIABLE_PATH}
# Openness has no online process-value access.
# Helpers required: _text_utils, ensure_project_open, ensure_online_connection
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$VariablePath    = '{VARIABLE_PATH}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
} catch { }

Write-Log "read_variable is not supported on TIA Portal."
Write-Log "Requested variable: $VariablePath"
Write-Log "Reason: TIA Portal Openness exposes no online process-value (read/write/force) API."
Write-Log "Suggested alternatives:"
Write-Log "  - OPC UA server of the S7-1200/1500 CPU (programmatic, recommended)."
Write-Log "  - S7comm clients (e.g. snap7 / Sharp7) against the PLC ethernet port."
Write-Log "  - TIA Portal watch tables in the UI for manual inspection."
Write-Log "SCRIPT_ERROR: read_variable is not supported on TIA Portal."
