# =====================================================================
# open_project.ps1 - Open a TIA Portal project (.apXX file) in the portal.
# Params: {PROJECT_FILE_PATH}
# Helpers required: _text_utils, ensure_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'

try {
    $project = Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath
    $projName = Split-Path -Path $ProjectFilePath -Leaf
    try { if ($project.Name) { $projName = $project.Name } } catch { }
    Write-Log "Project Opened: $projName"
    Write-Log "Path: $($project.Path)"
    Write-Log "SCRIPT_SUCCESS: Project opened successfully."
} catch {
    Write-Log "Error opening project ${ProjectFilePath}: $($_.Exception.Message)"
    throw "Error opening project: $($_.Exception.Message)"
}
