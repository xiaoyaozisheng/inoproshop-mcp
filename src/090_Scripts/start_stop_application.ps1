# =====================================================================
# start_stop_application.ps1 - NOT SUPPORTED on TIA Portal.
# Params: {PROJECT_FILE_PATH} {APP_ACTION} ('start'|'stop')
# Openness has no online-session API to start/stop the CPU.
# Helpers required: ensure_project_open, ensure_online_connection
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$AppAction       = '{APP_ACTION}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
} catch { }

Write-Log "start_stop_application is not supported on TIA Portal."
Write-Log "Requested action: $AppAction"
Write-Log "Reason: TIA Portal Openness exposes no online session API for CPU control."
Write-Log "Suggested alternatives: TIA Portal UI (Online > Stop/Run), PLCSIM instance"
Write-Log "controls, or an OPC UA / S7 client for programmatic start-stop."
Write-Log "SCRIPT_ERROR: start_stop_application is not supported on TIA Portal."
