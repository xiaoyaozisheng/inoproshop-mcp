# =====================================================================
# write_variable.ps1 - NOT SUPPORTED on TIA Portal.
# Params: {PROJECT_FILE_PATH} {VARIABLE_PATH} {VARIABLE_VALUE}
# Openness has no online process-value access.
# Helpers required: ensure_project_open, ensure_online_connection
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$VariablePath    = '{VARIABLE_PATH}'
$VariableValue   = '{VARIABLE_VALUE}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
} catch { }

Write-Log "write_variable is not supported on TIA Portal."
Write-Log "Requested: '$VariablePath' := '$VariableValue'"
Write-Log "Reason: TIA Portal Openness exposes no online process-value (read/write/force) API."
Write-Log "Suggested alternatives: OPC UA (S7-1200/1500 built-in server), snap7/Sharp7 S7comm"
Write-Log "client, or a TIA Portal force/watch table in the UI."
Write-Log "SCRIPT_ERROR: write_variable is not supported on TIA Portal."
