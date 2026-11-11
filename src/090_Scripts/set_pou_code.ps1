# =====================================================================
# set_pou_code.ps1 - Set declaration and/or implementation of a block.
# Params: {PROJECT_FILE_PATH} {POU_FULL_PATH} {DECLARATION_CONTENT}
#         {IMPLEMENTATION_CONTENT} {UPDATE_DECL} {UPDATE_IMPL} ('1'/'0')
#
# Implementation strategy (TIA Openness cannot edit compiled blocks):
#   1. Export the existing block XML (to preserve the interface when only
#      the implementation changes, and to learn the block kind).
#   2. Compose a complete SCL source (header + interface + body).
#   3. Regenerate the block via an external source - same-name blocks are
#      overwritten by GenerateBlocksFromSource.
# Helpers required: _text_utils, ensure_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$PouFullPath     = '{POU_FULL_PATH}'
$DeclContent     = '{DECLARATION_CONTENT:raw}'
$ImplContent     = '{IMPLEMENTATION_CONTENT:raw}'
$UpdateDecl      = '{UPDATE_DECL}' -eq '1'
$UpdateImpl      = '{UPDATE_IMPL}' -eq '1'

try {
    if (-not $UpdateDecl -and -not $UpdateImpl) {
        throw "Nothing to update: both UPDATE_DECL and UPDATE_IMPL are off."
    }

    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
    $plc = Ensure-PlcSoftware

    $leaf = ($PouFullPath -split '[/\\]')[-1]
    $block = Find-BlockByName $plc $leaf
    if ($null -eq $block) {
        $block = Find-TypeByName $plc $leaf
    }
    if ($null -eq $block) {
        throw "Object '$leaf' not found in project (searched blocks and PLC data types). Use get_project_structure for the correct path."
    }

    # Snapshot the existing block (interface + body) from XML export
    $tmpXml = Join-Path $env:TEMP ("mcp_export_" + [Guid]::NewGuid().ToString('N').Substring(0,8) + ".xml")
    Export-BlockXml -Block $block -TargetPath $tmpXml | Out-Null
    $existing = Read-BlockTextFromXml -XmlPath $tmpXml
    try { [System.IO.File]::Delete($tmpXml) } catch { }

    # Determine the SCL header from the block kind
    $blockKind = $existing.type
    $headerKeyword = switch -Regex ($blockKind) {
        '^(OB|OrganizationBlock|Program)' { 'ORGANIZATION_BLOCK'; break }
        '^(FC|Function$)'                 { 'FUNCTION'; break }
        '^(FB|FunctionBlock)'             { 'FUNCTION_BLOCK'; break }
        '^(GlobalDB|DataBlock|DB)'        { 'DATA_BLOCK'; break }
        default                           { 'FUNCTION_BLOCK' }
    }
    $header = '{0} "{1}"' -f $headerKeyword, $existing.name

    $decl = $existing.declaration
    if ($UpdateDecl) { $decl = $DeclContent }
    $impl = $existing.implementation
    if ($UpdateImpl) { $impl = $ImplContent }

    $scl = Write-BlockSclSource -Header $header -Declaration $decl -Implementation $impl

    $srcName = $existing.name + '_mcp_edit'
    $srcPath = Join-Path $env:TEMP ("mcp_set_" + [Guid]::NewGuid().ToString('N').Substring(0,8) + ".scl")
    Write-Utf8BomFile -Path $srcPath -Content $scl | Out-Null

    Write-Log "Regenerating block '$($existing.name)' from modified SCL source..."
    Import-SclSourceAsBlocks -PlcSoftware $plc -SourceName $srcName -SourceFilePath $srcPath | Out-Null

    Save-ProjectQuiet

    Write-Log "Code set for '$PouFullPath' (declaration updated: $UpdateDecl, implementation updated: $UpdateImpl)."
    Write-Log "SCRIPT_SUCCESS: POU code updated."
} catch {
    Write-Log "Error setting POU code for '$PouFullPath': $($_.Exception.Message)"
    throw "Error setting POU code: $($_.Exception.Message)"
}
