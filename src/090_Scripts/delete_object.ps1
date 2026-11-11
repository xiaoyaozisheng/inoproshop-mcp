# =====================================================================
# delete_object.ps1 - Delete a block or PLC data type from the project.
# Params: {PROJECT_FILE_PATH} {OBJECT_PATH}
# Node side refuses system nodes; this script only deletes user blocks
# and types found by name (leaf of OBJECT_PATH).
# Helpers required: _text_utils, ensure_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$ObjectPath      = '{OBJECT_PATH}'

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

    $deleteMethod = $target.GetType().GetMethods() |
        Where-Object { $_.Name -eq 'Delete' -and $_.GetParameters().Count -eq 0 } |
        Select-Object -First 1
    if ($null -eq $deleteMethod) {
        throw "This TIA version does not support deleting objects via Openness (no Delete method on $kind)."
    }

    Write-Log "Deleting $kind '$leaf'..."
    Invoke-WithRetry { $deleteMethod.Invoke($target, $null) } -MaxAttempts 2 | Out-Null

    Save-ProjectQuiet
    Write-Log "Object '$ObjectPath' ($kind) deleted."
    Write-Log "SCRIPT_SUCCESS: Object deleted."
} catch {
    Write-Log "Error deleting object '$ObjectPath': $($_.Exception.Message)"
    throw "Error deleting object: $($_.Exception.Message)"
}
