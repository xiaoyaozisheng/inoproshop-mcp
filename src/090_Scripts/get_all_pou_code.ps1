# =====================================================================
# get_all_pou_code.ps1 - Bulk read of all block code in the project.
# Params: {PROJECT_FILE_PATH}
# Output: JSON array between ### ALL_POU_CODE_START ### / END markers,
# items {path, type, declaration, implementation}.
# Helpers required: _text_utils, ensure_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
    $plc = Ensure-PlcSoftware

    $allCode = @()
    $stack = New-Object System.Collections.Stack
    $stack.Push(@('', $plc.BlockGroup))
    while ($stack.Count -gt 0) {
        $entry = $stack.Pop()
        $prefix = $entry[0]
        $group = $entry[1]
        foreach ($block in $group.Blocks) {
            $relPath = if ($prefix) { "$prefix/$($block.Name)" } else { $block.Name }
            try {
                $tmpXml = Join-Path $env:TEMP ("mcp_all_" + [Guid]::NewGuid().ToString('N').Substring(0,8) + ".xml")
                Export-BlockXml -Block $block -TargetPath $tmpXml | Out-Null
                $text = Read-BlockTextFromXml -XmlPath $tmpXml
                try { [System.IO.File]::Delete($tmpXml) } catch { }
                $allCode += [ordered]@{
                    path           = $relPath
                    type           = $text.type
                    declaration    = $text.declaration
                    implementation = $text.implementation
                }
            } catch {
                Write-Log "WARNING: skipped '$relPath': $($_.Exception.Message)"
            }
        }
        foreach ($sub in $group.Groups) {
            $subPrefix = if ($prefix) { "$prefix/$($sub.Name)" } else { $sub.Name }
            $stack.Push(@($subPrefix, $sub))
        }
    }

    $json = '{"items": ' + (ConvertTo-Json -InputObject @($allCode) -Depth 6 -Compress) + '}'
    Write-Log "### ALL_POU_CODE_START ###"
    Write-Log $json
    Write-Log "### ALL_POU_CODE_END ###"

    Write-Log "Collected $($allCode.Count) block(s)."
    Write-Log "SCRIPT_SUCCESS: Bulk code read complete."
} catch {
    Write-Log "Error reading all POU code: $($_.Exception.Message)"
    throw "Error reading all POU code: $($_.Exception.Message)"
}
