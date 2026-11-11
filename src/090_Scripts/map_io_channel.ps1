# =====================================================================
# map_io_channel.ps1 - NOT SUPPORTED on TIA Portal.
# Params: {PROJECT_FILE_PATH} {DEVICE_PATH} {CHANNEL_PATH} {VARIABLE_NAME}
#         {CLEAR_BINDING}
# Openness exposes no fieldbus I/O channel binding API.
# Helpers required: _text_utils, ensure_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$DevicePath      = '{DEVICE_PATH}'
$ChannelPath     = '{CHANNEL_PATH}'
$VariableName    = '{VARIABLE_NAME}'
$ClearBinding    = ('{CLEAR_BINDING}' -eq '1')

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
} catch { }

$action = if ($ClearBinding) { 'clear binding at' } else { "bind to '$VariableName'" }
Write-Log "map_io_channel is not supported on TIA Portal."
Write-Log "Requested: '$DevicePath/$ChannelPath' $action."
Write-Log "Reason: TIA Portal Openness exposes no fieldbus I/O channel binding API."
Write-Log "Suggested alternative: configure the process image assignment in the TIA UI"
Write-Log "(device view > <module> > I/O addresses), or use PLC tags tables."
Write-Log "SCRIPT_ERROR: map_io_channel is not supported on TIA Portal."
