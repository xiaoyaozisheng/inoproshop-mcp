# =====================================================================
# create_gvl.ps1 - Create a global variable list via SCL external source.
# Params: {PROJECT_FILE_PATH} {GVL_NAME} {PARENT_PATH} {DECLARATION_CONTENT}
# TIA: a global DB (or VAR_GLOBAL source) materializes the GVL.
# DECLARATION_CONTENT may be "VAR_GLOBAL ... END_VAR" or bare var lines.
# Helpers required: _text_utils, ensure_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$GvlName         = '{GVL_NAME}'
$ParentPath      = '{PARENT_PATH}'
$DeclContent     = '{DECLARATION_CONTENT:raw}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
    $plc = Ensure-PlcSoftware

    # Normalize declaration into VAR_GLOBAL ... END_VAR
    $decl = $DeclContent
    if ([string]::IsNullOrWhiteSpace($decl)) {
        $decl = "VAR_GLOBAL`n    dummy : Int;`nEND_VAR"
    } elseif ($decl -notmatch 'VAR_GLOBAL') {
        $decl = "VAR_GLOBAL`n$decl`nEND_VAR"
    }

    $srcName = $GvlName + '_mcp_gvl'
    $srcPath = Join-Path $env:TEMP ("mcp_gvl_" + [Guid]::NewGuid().ToString('N').Substring(0,8) + ".scl")
    Write-Utf8BomFile -Path $srcPath -Content $decl | Out-Null

    Write-Log "Generating global variable list '$GvlName' from external source..."
    Import-SclSourceAsBlocks -PlcSoftware $plc -SourceName $srcName -SourceFilePath $srcPath | Out-Null

    Save-ProjectQuiet
    Write-Log "GVL Created: $GvlName"
    Write-Log "Parent Path: $ParentPath"
    Write-Log "SCRIPT_SUCCESS: GVL created successfully."
} catch {
    Write-Log "Error creating GVL '$GvlName': $($_.Exception.Message)"
    throw "Error creating GVL '$GvlName': $($_.Exception.Message)"
}
