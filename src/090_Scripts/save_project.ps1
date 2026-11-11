# =====================================================================
# save_project.ps1 - Save the currently open TIA Portal project.
# Params: {PROJECT_FILE_PATH}
# Helpers required: _text_utils, ensure_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'

try {
    $project = Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath
    Write-Log "Saving project: $($project.Path)"
    $project.Save()
    Write-Log "SCRIPT_SUCCESS: Project saved successfully."
} catch {
    Write-Log "Error saving project: $($_.Exception.Message)"
    throw "Error saving project: $($_.Exception.Message)"
}
