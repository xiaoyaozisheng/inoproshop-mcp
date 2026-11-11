# =====================================================================
# get_application_state.ps1 - NOT SUPPORTED on TIA Portal.
# Params: {PROJECT_FILE_PATH}
# Openness has no online-session API, so the CPU run/stop state cannot
# be queried without an OPC UA / S7 comm channel.
# Helpers required: ensure_project_open, ensure_online_connection
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
} catch { }

Write-Log "get_application_state is not supported on TIA Portal."
Write-Log "Reason: TIA Portal Openness exposes no online session / CPU diagnostics API."
Write-Log "Suggested alternatives:"
Write-Log "  - Read the CPU status in the TIA Portal UI (Online & diagnostics)."
Write-Log "  - Integrate an OPC UA or S7 client (e.g. snap7) for programmatic state."
Write-Log "SCRIPT_ERROR: get_application_state is not supported on TIA Portal."
