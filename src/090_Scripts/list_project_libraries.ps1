# =====================================================================
# list_project_libraries.ps1 - List open global + project libraries.
# Params: {PROJECT_FILE_PATH}
# Output: JSON array between ### LIBRARIES_START ### / END markers,
# items {name, version, company}.
# Helpers required: _text_utils, ensure_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'

try {
    $project = Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath
    $portal = $Global:TiaPortal

    $libraries = @()

    # Open global libraries
    try {
        foreach ($lib in $portal.GlobalLibraries) {
            $version = try { [string]$lib.Version } catch { '' }
            $company = try { [string]$lib.Company } catch { '' }
            $libraries += [ordered]@{ name = $lib.Name; version = $version; company = $company }
        }
    } catch {
        Write-Log "WARNING: GlobalLibraries enumeration failed: $($_.Exception.Message)"
    }

    # Project libraries
    try {
        foreach ($lib in $project.ProjectLibraries) {
            $version = try { [string]$lib.Version } catch { '' }
            $company = try { [string]$lib.Company } catch { '' }
            $libraries += [ordered]@{ name = $lib.Name; version = $version; company = $company }
        }
    } catch {
        Write-Log "NOTE: project libraries not accessible on this TIA version."
    }

    $json = ConvertTo-Json -InputObject @($libraries) -Depth 6 -Compress
    Write-Log "### LIBRARIES_START ###"
    Write-Log $json
    Write-Log "### LIBRARIES_END ###"
    Write-Log "Found $($libraries.Count) library/libraries."
    Write-Log "SCRIPT_SUCCESS: Library list retrieved."
} catch {
    Write-Log "Error listing libraries: $($_.Exception.Message)"
    throw "Error listing project libraries: $($_.Exception.Message)"
}
