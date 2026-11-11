# =====================================================================
# list_project_templates.ps1 - List TIA Portal project template sources.
# Params: {EXTRA_TEMPLATE_DIR}
#
# TIA Portal has no ScriptEngine template registry; templates are found
# on disk in the public template folders. Returned payload keeps the
# original shape: {templates: [{name, path, source}], count,
# api_attempts, filesystem_hits}.
# Helpers required: _text_utils
# NOTE: keep this file ASCII-only.
# =====================================================================

$ExtraTemplateDir = '{EXTRA_TEMPLATE_DIR}'

try {
    $scanDirs = @()
    $programData = $env:ALLUSERSPROFILE
    if ([string]::IsNullOrWhiteSpace($programData)) { $programData = 'C:\ProgramData' }

    # Well-known TIA template locations (localized variants included)
    $scanDirs += (Join-Path $programData 'Siemens\Automation\Project Templates')
    $scanDirs += (Join-Path $env:PUBLIC 'Documents\Siemens\Automation\Project Templates')
    $scanDirs += (Join-Path $env:USERPROFILE 'Documents\Siemens\Automation\Project Templates')
    if (-not [string]::IsNullOrWhiteSpace($ExtraTemplateDir)) {
        $scanDirs += $ExtraTemplateDir
    }

    $templates = @()
    $filesystemHits = 0
    foreach ($dir in $scanDirs) {
        if (-not [System.IO.Directory]::Exists($dir)) { continue }
        # TIA templates are stored as directories containing .apXX project
        # files, or as .zap archives. Enumerate both.
        $projectFiles = Get-ChildItem -Path $dir -Recurse -Filter '*.ap*' -File -ErrorAction SilentlyContinue
        $archives = Get-ChildItem -Path $dir -Filter '*.zap*' -File -ErrorAction SilentlyContinue
        foreach ($f in ($projectFiles + $archives)) {
            $templates += [ordered]@{
                name   = $f.BaseName
                path   = $f.FullName
                source = 'filesystem'
            }
            $filesystemHits++
        }
    }

    $payload = [ordered]@{
        templates     = $templates
        count         = $templates.Count
        api_attempts  = @('TIA Portal has no template registry API; filesystem scan only')
        filesystem_hits = $filesystemHits
    }
    Write-ResultJson $payload
    Write-Log "Found $($templates.Count) template(s)."
    Write-Log "SCRIPT_SUCCESS: Template scan complete."
} catch {
    Write-Log "Error listing templates: $($_.Exception.Message)"
    throw "Error listing project templates: $($_.Exception.Message)"
}
