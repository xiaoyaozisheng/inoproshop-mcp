# =====================================================================
# set_device_parameter.ps1 - Set a writable attribute on a device item.
# Params: {PROJECT_FILE_PATH} {DEVICE_PATH} {PARAMETER_ID} {VALUE}
# Uses Openness SetAttribute (works only for ReadWrite attributes; many
# fieldbus parameters are GUI-only and will fail with a clear error).
# Helpers required: _text_utils, ensure_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$DevicePath      = '{DEVICE_PATH}'
$ParameterId     = '{PARAMETER_ID}'
$Value           = '{VALUE}'

try {
    $project = Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath

    $leaf = ($DevicePath -split '[/\\]')[-1]
    $node = $null
    foreach ($device in $project.Devices) {
        if ($device.Name -ieq $leaf) { $node = $device; break }
        foreach ($item in $device.DeviceItems) {
            if ($item.Name -ieq $leaf) { $node = $item; break }
        }
        if ($null -ne $node) { break }
    }
    if ($null -eq $node) {
        throw "Device node '$leaf' not found. Use inspect_device_node to discover attribute names."
    }

    # Check the attribute exists and is writable before writing
    $writable = $false
    try {
        $infos = $node.GetAttributeInfos()
        foreach ($info in $infos) {
            if ($info.Name -ieq $ParameterId) {
                if ([string]$info.AccessMode -match 'ReadWrite|Write') { $writable = $true }
                break
            }
        }
    } catch { }

    if (-not $writable) {
        throw ("Attribute '$ParameterId' not found or not writable on '$leaf'. " +
               "Use inspect_device_node to list attributes with access_mode ReadWrite.")
    }

    Write-Log "Setting attribute '$ParameterId' = '$Value' on '$leaf'..."
    Invoke-WithRetry { $node.SetAttribute($ParameterId, $Value) } -MaxAttempts 2 | Out-Null

    Save-ProjectQuiet
    Write-Log "Parameter '$ParameterId' on '$leaf' set to '$Value'."
    Write-Log "SCRIPT_SUCCESS: Parameter set."
} catch {
    Write-Log "Error setting device parameter: $($_.Exception.Message)"
    throw "Error setting device parameter: $($_.Exception.Message)"
}
