# =====================================================================
# create_pou.ps1 - Create a Program/FB/FC via SCL external source import.
# Params: {PROJECT_FILE_PATH} {POU_NAME} {POU_TYPE_STR} {IMPL_LANGUAGE_STR}
#         {PARENT_PATH}
#
# TIA Openness cannot create blocks directly; the documented flow is:
#   write .scl source file -> ExternalSources.CreateFromFile ->
#   GenerateBlocksFromSource -> block appears in Program blocks.
# Helpers required: _text_utils, ensure_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath   = '{PROJECT_FILE_PATH}'
$PouName           = '{POU_NAME}'
$PouTypeStr        = '{POU_TYPE_STR}'
$ImplLanguageStr   = '{IMPL_LANGUAGE_STR}'
$ParentPath        = '{PARENT_PATH}'

try {
    if ([string]::IsNullOrWhiteSpace($PouName)) { throw "POU name is empty." }

    $headerMap = @{
        'Program'       = 'ORGANIZATION_BLOCK'
        'FunctionBlock' = 'FUNCTION_BLOCK'
        'Function'      = 'FUNCTION'
    }
    if (-not $headerMap.ContainsKey($PouTypeStr)) {
        throw ("Invalid POU type string: '$PouTypeStr'. Use Program, FunctionBlock, or Function.")
    }
    if ($ImplLanguageStr -and $ImplLanguageStr -notin @('ST', 'SCL')) {
        Write-Log "WARNING: '$ImplLanguageStr' is not representable as an SCL source; the generated block will be SCL."
    }

    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
    $plc = Ensure-PlcSoftware

    $scl = Write-BlockSclSource -Header ('{0} "{1}"' -f $headerMap[$PouTypeStr], $PouName) -Declaration '' -Implementation ''

    $srcPath = Join-Path $env:TEMP ("mcp_" + $PouName + "_" + [Guid]::NewGuid().ToString('N').Substring(0,8) + ".scl")
    Write-Utf8BomFile -Path $srcPath -Content $scl | Out-Null

    Write-Log "Generating block '$PouName' ($PouTypeStr, SCL) from external source..."
    Import-SclSourceAsBlocks -PlcSoftware $plc -SourceName $PouName -SourceFilePath $srcPath | Out-Null

    Save-ProjectQuiet

    Write-Log "POU Created: $PouName"
    Write-Log "Type: $PouTypeStr (SCL)"
    Write-Log "Parent Path: $ParentPath"
    Write-Log "SCRIPT_SUCCESS: POU created successfully."
} catch {
    Write-Log "Error creating POU '$PouName': $($_.Exception.Message)"
    throw "Error creating POU '$PouName': $($_.Exception.Message)"
}
