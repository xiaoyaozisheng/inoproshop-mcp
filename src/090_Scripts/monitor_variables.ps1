# =====================================================================
# monitor_variables.ps1 - NOT SUPPORTED on TIA Portal.
# Params: {PROJECT_FILE_PATH} {VARIABLES_JSON} {DURATION_MS} {INTERVAL_MS}
# Openness has no online process-value access; the original CODESYS
# timeseries sampler cannot be reproduced through Openness.
# Helpers required: _text_utils, ensure_project_open, ensure_online_connection
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$VariablesJson   = '{VARIABLES_JSON}'
$DurationMs      = '{DURATION_MS}'
$IntervalMs      = '{INTERVAL_MS}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
} catch { }

Write-Log "monitor_variables is not supported on TIA Portal."
Write-Log "Requested variables: $VariablesJson (duration=${DurationMs}ms, interval=${IntervalMs}ms)"
Write-Log "Reason: TIA Portal Openness exposes no online process-value API."
Write-Log "Suggested alternatives:"
Write-Log "  - Poll variables via OPC UA (S7-1200/1500 built-in server)."
Write-Log "  - Poll via snap7/Sharp7 S7comm against DB areas."
Write-Log "SCRIPT_ERROR: monitor_variables is not supported on TIA Portal."
