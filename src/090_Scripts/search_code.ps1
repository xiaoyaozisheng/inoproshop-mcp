# =====================================================================
# search_code.ps1 - Regex/substring search across all block code.
# Params: {PROJECT_FILE_PATH} {PATTERN} {USE_REGEX} {CASE_SENSITIVE}
#         {INCLUDE_DECL} {INCLUDE_IMPL} {MAX_HITS}
# Output: RESULT_JSON {hits: [{path, section, line, col, text, match}],
#         count, truncated, pattern}
# Helpers required: _text_utils, ensure_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$Pattern         = '{PATTERN}'
$UseRegex        = ('{USE_REGEX}' -eq '1')
$CaseSensitive   = ('{CASE_SENSITIVE}' -eq '1')
$IncludeDecl     = ('{INCLUDE_DECL}' -eq '1')
$IncludeImpl     = ('{INCLUDE_IMPL}' -eq '1')
$MaxHits         = 1000
try { $MaxHits = [int]('{MAX_HITS}') } catch { }

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
    $plc = Ensure-PlcSoftware

    # Build the matcher
    $regexOpts = [System.Text.RegularExpressions.RegexOptions]::Multiline
    if (-not $CaseSensitive) { $regexOpts = $regexOpts -bor [System.Text.RegularExpressions.RegexOptions]::IgnoreCase }
    $patternText = $Pattern
    if (-not $UseRegex) {
        $patternText = [regex]::Escape($Pattern)
    }
    $matcher = New-Object System.Text.RegularExpressions.Regex($patternText, $regexOpts)

    $hits = @()
    $truncated = $false

    $stack = New-Object System.Collections.Stack
    $stack.Push(@('', $plc.BlockGroup))
    while ($stack.Count -gt 0) {
        if ($hits.Count -ge $MaxHits) { $truncated = $true; break }
        $e = $stack.Pop()
        $prefix = $e[0]; $group = $e[1]

        foreach ($block in $group.Blocks) {
            if ($hits.Count -ge $MaxHits) { $truncated = $true; break }
            $relPath = if ($prefix) { "$prefix/$($block.Name)" } else { $block.Name }
            try {
                $tmpXml = Join-Path $env:TEMP ("mcp_search_" + [Guid]::NewGuid().ToString('N').Substring(0,8) + ".xml")
                Export-BlockXml -Block $block -TargetPath $tmpXml | Out-Null
                $text = Read-BlockTextFromXml -XmlPath $tmpXml
                try { [System.IO.File]::Delete($tmpXml) } catch { }

                $sections = @()
                if ($IncludeDecl -and $text.declaration) { $sections += @('declaration', $text.declaration) }
                if ($IncludeImpl -and $text.implementation) { $sections += @('implementation', $text.implementation) }

                for ($si = 0; $si -lt $sections.Count; $si += 2) {
                    $secName = $sections[$si]
                    $body = $sections[$si + 1]
                    $lineNo = 1
                    $col = 1
                    foreach ($m in $matcher.Matches($body)) {
                        if ($hits.Count -ge $MaxHits) { $truncated = $true; break }
                        # Compute line:col of the match
                        $before = $body.Substring(0, $m.Index)
                        $lineNo = ($before -split "`n").Count
                        $lastNl = $before.LastIndexOf("`n")
                        $col = $m.Index - $lastNl
                        $lineText = ''
                        $nlIdx = $body.IndexOf("`n", $m.Index)
                        if ($nlIdx -gt $m.Index) { $lineText = $body.Substring($m.Index, $nlIdx - $m.Index) }
                        else { $lineText = $body.Substring($m.Index) }
                        if ($lineText.Length -gt 200) { $lineText = $lineText.Substring(0, 200) }
                        $hits += [ordered]@{
                            path    = $relPath
                            section = $secName
                            line    = $lineNo
                            col     = $col
                            text    = $lineText
                            match   = $m.Value
                        }
                    }
                }
            } catch {
                Write-Log "WARNING: search skipped '$relPath': $($_.Exception.Message)"
            }
        }

        foreach ($sub in $group.Groups) {
            $subPrefix = if ($prefix) { "$prefix/$($sub.Name)" } else { $sub.Name }
            $stack.Push(@($subPrefix, $sub))
        }
    }

    $payload = [ordered]@{
        hits      = $hits
        count     = $hits.Count
        truncated = $truncated
        pattern   = $Pattern
    }
    Write-ResultJson $payload
    Write-Log "Search complete: $($hits.Count) match(es)."
    Write-Log "SCRIPT_SUCCESS: search complete."
} catch {
    Write-Log "Error searching code: $($_.Exception.Message)"
    throw "Error searching code: $($_.Exception.Message)"
}
