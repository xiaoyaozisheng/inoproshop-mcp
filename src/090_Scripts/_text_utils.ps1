# =====================================================================
# _text_utils.ps1 - Shared output helpers for the TIA Portal MCP watcher.
# Prepended to command scripts via ScriptManager.prepareScriptWithHelpers
# and dot-sourced once by watcher.ps1 at startup.
#
# All command scripts report output through Write-Log (buffered, captured
# into the result JSON) and structured data through Write-ResultJson
# (same "### RESULT_JSON ###" fenced-block protocol the Node side parses
# with FC_ResultParser.parseResultJson).
#
# NOTE: keep this file ASCII-only (PowerShell 5.1 reads non-BOM files as ANSI).
# =====================================================================

# Output buffer for the current command (reset by watcher before each command)
if ($null -eq $Global:__McpOutput -or $Global:__McpOutput -isnot [System.Text.StringBuilder]) {
    $Global:__McpOutput = New-Object System.Text.StringBuilder
}

function Write-Log {
    param([string]$Message)
    [void]$Global:__McpOutput.AppendLine($Message)
}

function Write-ResultJson {
    # Serialize a payload to JSON preserving single-element arrays.
    # PowerShell 5.1's ConvertTo-Json collapses 1-element arrays when input
    # is passed through the pipeline, which corrupts Node-side parsers that
    # expect arrays. JavaScriptSerializer (System.Web.Extensions, in the GAC)
    # does not have that defect.
    param([object]$Payload)
    if (-not ('System.Web.Script.Serialization.JavaScriptSerializer' -as [type])) {
        Add-Type -AssemblyName System.Web.Extensions
    }
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = [int]::MaxValue
    $serializer.RecursionLimit = 200
    $json = $serializer.Serialize($Payload)
    Write-Log "### RESULT_JSON ###"
    Write-Log $json
    Write-Log "### END_RESULT_JSON ###"
}

function Get-EngService {
    # Generic GetService<T>() cannot be called directly from PowerShell.
    # Resolve it via reflection: returns the engineering object implementing
    # service type $ServiceType, or $null if the object does not provide it.
    param([object]$EngineeringObject, [type]$ServiceType)
    if ($null -eq $EngineeringObject) { return $null }
    try {
        $method = $EngineeringObject.GetType().GetMethods() |
            Where-Object { $_.Name -eq 'GetService' -and $_.IsGenericMethod } |
            Select-Object -First 1
        if ($null -eq $method) { return $null }
        $generic = $method.MakeGenericMethod($ServiceType)
        return $generic.Invoke($EngineeringObject, $null)
    } catch {
        return $null
    }
}

function Invoke-WithRetry {
    # TIA Portal Openness objects are marshaled cross-process and can throw
    # transient COMTimeoutException / CommunicationException under load.
    param([scriptblock]$Action, [int]$MaxAttempts = 3, [int]$DelayMs = 500)
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            return & $Action
        } catch {
            if ($attempt -eq $MaxAttempts) { throw }
            Start-Sleep -Milliseconds $DelayMs
        }
    }
}

function Get-UnixTimestamp {
    return [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
}

# ---------------------------------------------------------------------
# Block text helpers (SCL round-trip via SimaticML XML export)
# TIA Openness cannot edit compiled blocks in place; the standard flow is
#   export XML -> modify -> re-import. These helpers extract SCL-style
#   declaration/implementation text from an exported block XML.
# ---------------------------------------------------------------------

function Export-BlockXml {
    param($Block, [string]$TargetPath)
    $fileInfo = New-Object System.IO.FileInfo($TargetPath)
    Invoke-WithRetry { $Block.Export($fileInfo, [Siemens.Engineering.ExportOptions]::WithDefaults) } -MaxAttempts 2 | Out-Null
    if (-not [System.IO.File]::Exists($TargetPath)) {
        throw "Block export produced no file: $TargetPath"
    }
    return $TargetPath
}

function Convert-InterfaceXmlToScl {
    # Convert a SimaticML <Interface> fragment into SCL VAR sections.
    param([string]$InterfaceXml)
    $sections = [regex]::Matches($InterfaceXml, '<Section\s+Name="([^"]+)"[^>]*>(?s)(.*?)</Section>')
    $map = @{
        'Input'    = 'VAR_INPUT'
        'Output'   = 'VAR_OUTPUT'
        'InOut'    = 'VAR_IN_OUT'
        'Static'   = 'VAR'
        'Temp'     = 'VAR_TEMP'
        'Constant' = 'CONST'
        'Local'    = 'VAR'
    }
    $out = New-Object System.Text.StringBuilder
    foreach ($sec in $sections) {
        $secName = $sec.Groups[1].Value
        if (-not $map.ContainsKey($secName)) { continue }
        $keyword = $map[$secName]
        $members = [regex]::Matches($sec.Groups[2].Value, '<Member\s+[^>]*Name="([^"]+)"[^>]*?(?:Datatype="([^"]+)")?[^>]*>')
        if ($members.Count -eq 0) { continue }
        [void]$out.AppendLine("$keyword")
        foreach ($m in $members) {
            $mName = $m.Groups[1].Value
            $mType = $m.Groups[2].Value
            if ([string]::IsNullOrEmpty($mType)) { $mType = 'Int' }
            [void]$out.AppendLine("    ${mName} : ${mType};")
        }
        [void]$out.AppendLine("END_${keyword}")
    }
    return $out.ToString().TrimEnd()
}

function Read-BlockTextFromXml {
    # Extract {name, type, language, declaration, implementation} from an
    # exported SimaticML block XML. Declaration is converted to SCL VAR
    # syntax; implementation is the raw StructuredText body.
    param([string]$XmlPath)
    $raw = [System.IO.File]::ReadAllText($XmlPath)

    $name = ''
    $m = [regex]::Match($raw, '<AttributeList>(?s).*?<Name>([^<]+)</Name>')
    if ($m.Success) { $name = $m.Groups[1].Value }

    $type = ''
    $m = [regex]::Match($raw, '<SecondaryType>([^<]+)</SecondaryType>')
    if ($m.Success) { $type = $m.Groups[1].Value }
    if ([string]::IsNullOrEmpty($type)) {
        $m = [regex]::Match($raw, '<SW\.(Blocks|Types)\.([A-Za-z]+)')
        if ($m.Success) { $type = $m.Groups[2].Value }
    }

    $language = ''
    $m = [regex]::Match($raw, '<ProgrammingLanguage>([^<]+)</ProgrammingLanguage>')
    if ($m.Success) { $language = $m.Groups[1].Value }

    # Declaration
    $declaration = ''
    $m = [regex]::Match($raw, '<Interface>(?s)(.*?)</Interface>')
    if ($m.Success) {
        $declaration = Convert-InterfaceXmlToScl $m.Groups[1].Value
    }

    # Implementation (StructuredText ObjectText -> Text, CDATA-wrapped)
    $implementation = ''
    $m = [regex]::Match($raw, '<StructuredText[^>]*>(?s).*?<Text>(?s)(.*?)</Text>')
    if ($m.Success) {
        $impl = $m.Groups[1].Value
        $impl = $impl -replace '(?s)^\s*<!\[CDATA\[', ''
        $impl = $impl -replace '(?s)\]\]>\s*$', ''
        # Decode the handful of XML entities that appear inside Text nodes
        $impl = $impl.Replace('&quot;', '"').Replace('&apos;', "'").Replace('&lt;', '<').Replace('&gt;', '>').Replace('&amp;', '&')
        $implementation = $impl.Trim()
    }

    return @{
        name           = $name
        type           = $type
        language       = $language
        declaration    = $declaration
        implementation = $implementation
    }
}

function Write-BlockSclSource {
    # Compose a complete SCL source text for external-source generation.
    param(
        [string]$Header,          # e.g. FUNCTION_BLOCK "FB_Motor"
        [string]$Declaration,     # SCL VAR sections (may be empty)
        [string]$Implementation   # body (may be empty)
    )
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine($Header)
    if (-not [string]::IsNullOrWhiteSpace($Declaration)) {
        [void]$sb.AppendLine($Declaration)
    }
    [void]$sb.AppendLine()
    if (-not [string]::IsNullOrWhiteSpace($Implementation)) {
        [void]$sb.AppendLine($Implementation)
    } else {
        [void]$sb.AppendLine('// (no implementation yet)')
    }
    return $sb.ToString()
}

function Import-SclSourceAsBlocks {
    # Register an SCL source with the PLC software and generate blocks.
    # Handles the GenerateBlocksFromSourceFile / GenerateBlocksFromSource
    # API rename across TIA versions via reflection.
    param($PlcSoftware, [string]$SourceName, [string]$SourceFilePath)
    $sources = $PlcSoftware.ExternalSourceGroup.ExternalSources
    $source = Invoke-WithRetry { $sources.CreateFromFile($SourceName, $SourceFilePath) } -MaxAttempts 2
    $genMethod = $source.GetType().GetMethods() |
        Where-Object { $_.Name -in @('GenerateBlocksFromSource', 'GenerateBlocksFromSourceFile') } |
        Select-Object -First 1
    if ($null -eq $genMethod) {
        throw "PlcExternalSource has no GenerateBlocksFromSource(File) method on this TIA version."
    }
    Invoke-WithRetry { $genMethod.Invoke($source, $null) } -MaxAttempts 2 | Out-Null
    return $source
}

function Write-Utf8BomFile {
    # TIA Openness requires UTF-8 with BOM for external source files that
    # contain non-ASCII text.
    param([string]$Path, [string]$Content)
    $dir = Split-Path -Path $Path -Parent
    if (-not [System.IO.Directory]::Exists($dir)) {
        [System.IO.Directory]::CreateDirectory($dir) | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($true)))
    return $Path
}

function ConvertFrom-CompilerResult {
    # Flatten a TIA CompilerResult (including nested messages) into the
    # structured message list consumed by FC_RegisterPouTools:
    # [{severity, text, object, line}]
    param($Result, [string]$DeviceName = '')
    $out = @()
    $stateMap = @{
        'Error'   = 'error'
        'Warning' = 'warning'
        'Info'    = 'info'
        'Success' = 'info'
    }
    function Walk([object]$Composition) {
        if ($null -eq $Composition) { return }
        foreach ($msg in $Composition) {
            $severity = 'info'
            try {
                $rawState = [string]$msg.State
                if ($stateMap.ContainsKey($rawState)) { $severity = $stateMap[$rawState] }
                elseif ($rawState -match 'Error') { $severity = 'error' }
                elseif ($rawState -match 'Warning') { $severity = 'warning' }
            } catch { }
            $text = try { [string]$msg.Description } catch { '' }
            $obj = try { [string]$msg.Path } catch { '' }
            if (-not [string]::IsNullOrWhiteSpace($text)) {
                $script:out += [ordered]@{
                    severity = $severity
                    text     = $text
                    object   = $obj
                    line     = $null
                }
            }
            try { Walk $msg.Messages } catch { }
        }
    }
    try { Walk $Result.Messages } catch { }
    return $script:out
}
