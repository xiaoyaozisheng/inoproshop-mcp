# =====================================================================
# rename_symbol.ps1 - Best-effort textual rename across block code.
# Params: {PROJECT_FILE_PATH} {OLD_NAME} {NEW_NAME} {DRY_RUN}
#         {INCLUDE_DECL} {INCLUDE_IMPL} ('1'/'0')
#
# TIA cannot edit compiled blocks; changed blocks are regenerated from
# modified SCL sources (same flow as set_pou_code). Types (UDTs) are
# regenerated through a .udt source. Object nodes themselves are NOT
# renamed (use rename_object).
# Output: RESULT_JSON {old_name,new_name,dry_run,changes,total_matches,
#         applied_count}
# Helpers required: _text_utils, ensure_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$OldName         = '{OLD_NAME}'
$NewName         = '{NEW_NAME}'
$DryRun          = ('{DRY_RUN}' -eq '1')
$IncludeDecl     = ('{INCLUDE_DECL}' -eq '1')
$IncludeImpl     = ('{INCLUDE_IMPL}' -eq '1')

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
    $plc = Ensure-PlcSoftware

    $matcher = New-Object System.Text.RegularExpressions.Regex(
        ('\b' + [regex]::Escape($OldName) + '\b'),
        [System.Text.RegularExpressions.RegexOptions]::Multiline)

    $changes = @()
    $totalMatches = 0
    $appliedCount = 0

    $stack = New-Object System.Collections.Stack
    $stack.Push(@('', $plc.BlockGroup))
    while ($stack.Count -gt 0) {
        $e = $stack.Pop()
        $prefix = $e[0]; $group = $e[1]

        foreach ($block in $group.Blocks) {
            $relPath = if ($prefix) { "$prefix/$($block.Name)" } else { $block.Name }
            try {
                $tmpXml = Join-Path $env:TEMP ("mcp_ren_" + [Guid]::NewGuid().ToString('N').Substring(0,8) + ".xml")
                Export-BlockXml -Block $block -TargetPath $tmpXml | Out-Null
                $text = Read-BlockTextFromXml -XmlPath $tmpXml
                try { [System.IO.File]::Delete($tmpXml) } catch { }

                $declMatches = 0
                $implMatches = 0
                $newDecl = $text.declaration
                $newImpl = $text.implementation

                if ($IncludeDecl -and $text.declaration) {
                    $declMatches = $matcher.Matches($text.declaration).Count
                    if ($declMatches -gt 0 -and -not $DryRun) {
                        $newDecl = $matcher.Replace($text.declaration, $NewName)
                    }
                }
                if ($IncludeImpl -and $text.implementation) {
                    $implMatches = $matcher.Matches($text.implementation).Count
                    if ($implMatches -gt 0 -and -not $DryRun) {
                        $newImpl = $matcher.Replace($text.implementation, $NewName)
                    }
                }
                $matchCount = $declMatches + $implMatches
                if ($matchCount -le 0) { continue }
                $totalMatches += $matchCount

                $applied = $false
                if (-not $DryRun) {
                    $headerKeyword = switch -Regex ($text.type) {
                        '^(OB|OrganizationBlock|Program)' { 'ORGANIZATION_BLOCK'; break }
                        '^(FC|Function$)'                 { 'FUNCTION'; break }
                        '^(FB|FunctionBlock)'             { 'FUNCTION_BLOCK'; break }
                        '^(GlobalDB|DataBlock|DB)'        { 'DATA_BLOCK'; break }
                        default                           { 'FUNCTION_BLOCK' }
                    }
                    $header = '{0} "{1}"' -f $headerKeyword, $text.name
                    $scl = Write-BlockSclSource -Header $header -Declaration $newDecl -Implementation $newImpl
                    $srcName = $text.name + '_mcp_rename'
                    $srcPath = Join-Path $env:TEMP ("mcp_rensrc_" + [Guid]::NewGuid().ToString('N').Substring(0,8) + ".scl")
                    Write-Utf8BomFile -Path $srcPath -Content $scl | Out-Null
                    Import-SclSourceAsBlocks -PlcSoftware $plc -SourceName $srcName -SourceFilePath $srcPath | Out-Null
                    $applied = $true
                    $appliedCount++
                }
                $changes += [ordered]@{
                    path        = $relPath
                    section     = 'declaration+implementation'
                    match_count = $matchCount
                    applied     = $applied
                }
            } catch {
                Write-Log "WARNING: rename skipped '$relPath': $($_.Exception.Message)"
            }
        }

        foreach ($sub in $group.Groups) {
            $subPrefix = if ($prefix) { "$prefix/$($sub.Name)" } else { $sub.Name }
            $stack.Push(@($subPrefix, $sub))
        }
    }

    # PLC data types (UDTs)
    $typeStack = New-Object System.Collections.Stack
    $typeStack.Push(@('', $plc.TypeGroup))
    while ($typeStack.Count -gt 0) {
        $e = $typeStack.Pop()
        $prefix = $e[0]; $group = $e[1]
        foreach ($t in $group.Types) {
            $relPath = if ($prefix) { "$prefix/$($t.Name)" } else { $t.Name }
            try {
                $tmpXml = Join-Path $env:TEMP ("mcp_rent_" + [Guid]::NewGuid().ToString('N').Substring(0,8) + ".xml")
                Export-BlockXml -Block $t -TargetPath $tmpXml | Out-Null
                $raw = [System.IO.File]::ReadAllText($tmpXml)
                try { [System.IO.File]::Delete($tmpXml) } catch { }
                $m = [regex]::Match($raw, '<Interface>(?s)(.*?)</Interface>')
                if (-not $m.Success) { continue }
                $declText = Convert-InterfaceXmlToScl $m.Groups[1].Value
                $matchCount = $matcher.Matches($declText).Count
                if ($matchCount -le 0) { continue }
                $totalMatches += $matchCount
                $applied = $false
                if (-not $DryRun) {
                    $newDecl = $matcher.Replace($declText, $NewName)
                    $header = 'TYPE "' + $t.Name + '" :'
                    $scl = $header + "`n" + $newDecl + "`nEND_TYPE"
                    $srcName = $t.Name + '_mcp_rename'
                    $srcPath = Join-Path $env:TEMP ("mcp_rentsrc_" + [Guid]::NewGuid().ToString('N').Substring(0,8) + ".udt")
                    Write-Utf8BomFile -Path $srcPath -Content $scl | Out-Null
                    Import-SclSourceAsBlocks -PlcSoftware $plc -SourceName $srcName -SourceFilePath $srcPath | Out-Null
                    $applied = $true
                    $appliedCount++
                }
                $changes += [ordered]@{
                    path        = $relPath
                    section     = 'type'
                    match_count = $matchCount
                    applied     = $applied
                }
            } catch {
                Write-Log "WARNING: type rename skipped '$relPath': $($_.Exception.Message)"
            }
        }
        foreach ($sub in $group.Groups) {
            $subPrefix = if ($prefix) { "$prefix/$($sub.Name)" } else { $sub.Name }
            $typeStack.Push(@($subPrefix, $sub))
        }
    }

    if (-not $DryRun) { Save-ProjectQuiet }

    $payload = [ordered]@{
        old_name      = $OldName
        new_name      = $NewName
        dry_run       = $DryRun
        changes       = $changes
        total_matches = $totalMatches
        applied_count = $appliedCount
    }
    Write-ResultJson $payload
    Write-Log "Rename complete: $totalMatches match(es), $appliedCount applied."
    Write-Log "SCRIPT_SUCCESS: rename_symbol complete."
} catch {
    Write-Log "Error renaming symbol: $($_.Exception.Message)"
    throw "Error renaming symbol: $($_.Exception.Message)"
}
