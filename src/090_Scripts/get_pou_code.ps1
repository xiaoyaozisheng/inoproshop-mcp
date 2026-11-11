# =====================================================================
# get_pou_code.ps1 - Read declaration/implementation of one block.
# Params: {PROJECT_FILE_PATH} {POU_FULL_PATH}
# Output: fenced sections
#   ### POU DECLARATION START ### ... ### POU DECLARATION END ###
#   ### POU IMPLEMENTATION START ### ... ### POU IMPLEMENTATION END ###
# Helpers required: _text_utils, require_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$PouFullPath     = '{POU_FULL_PATH}'

try {
    $project = Require-ProjectOpen -ProjectFilePath $ProjectFilePath
    $plc = Ensure-PlcSoftware

    $leaf = ($PouFullPath -split '[/\\]')[-1]
    $block = Find-BlockByName $plc $leaf
    if ($null -eq $block) {
        $block = Find-TypeByName $plc $leaf
    }
    if ($null -eq $block) {
        throw "Object '$leaf' not found in project."
    }

    $tmpXml = Join-Path $env:TEMP ("mcp_export_" + [Guid]::NewGuid().ToString('N').Substring(0,8) + ".xml")
    Export-BlockXml -Block $block -TargetPath $tmpXml | Out-Null
    $text = Read-BlockTextFromXml -XmlPath $tmpXml
    try { [System.IO.File]::Delete($tmpXml) } catch { }

    Write-Log "POU: $($text.name) (Type: $($text.type), Language: $($text.language))"
    Write-Log "### POU DECLARATION START ###"
    Write-Log $text.declaration
    Write-Log "### POU DECLARATION END ###"
    Write-Log "### POU IMPLEMENTATION START ###"
    Write-Log $text.implementation
    Write-Log "### POU IMPLEMENTATION END ###"
    Write-Log "SCRIPT_SUCCESS: POU code retrieved."
} catch {
    Write-Log "Error retrieving POU code for '$PouFullPath': $($_.Exception.Message)"
    throw "Error retrieving POU code: $($_.Exception.Message)"
}
