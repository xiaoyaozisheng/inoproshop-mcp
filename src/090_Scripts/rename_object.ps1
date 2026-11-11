# =====================================================================
# rename_object.ps1 - Rename a block or PLC data type.
# Params: {PROJECT_FILE_PATH} {OBJECT_PATH} {NEW_NAME}
# TIA Openness: block.Name is settable (preserves the block number).
# Helpers required: _text_utils, ensure_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$ObjectPath      = '{OBJECT_PATH}'
$NewName         = '{NEW_NAME}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
    $plc = Ensure-PlcSoftware

    $leaf = ($ObjectPath -split '[/\\]')[-1]
    $target = Find-BlockByName $plc $leaf
    $kind = 'Block'
    if ($null -eq $target) {
        $target = Find-TypeByName $plc $leaf
        $kind = 'Type'
    }
    if ($null -eq $target) {
        throw "Object '$leaf' not found in project blocks or PLC data types."
    }

    Write-Log "Renaming $kind '$leaf' -> '$NewName'..."
    try {
        $target.Name = $NewName
    } catch {
        throw ("Rename via Openness failed on this TIA version: " + $_.Exception.Message)
    }

    Save-ProjectQuiet
    Write-Log "Object '$ObjectPath' renamed to '$NewName'."
    Write-Log "SCRIPT_SUCCESS: Object renamed."
} catch {
    Write-Log "Error renaming object '$ObjectPath': $($_.Exception.Message)"
    throw "Error renaming object: $($_.Exception.Message)"
}
