# =====================================================================
# create_project.ps1 - Create a new TIA Portal project.
# Params: {PROJECT_FILE_PATH} (template params are accepted for
#         contract compatibility but TIA projects are created from scratch)
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'

try {
    if ([string]::IsNullOrWhiteSpace($ProjectFilePath)) {
        throw "PROJECT_FILE_PATH is required."
    }
    $full = [System.IO.Path]::GetFullPath($ProjectFilePath)
    $dir = Split-Path -Path $full -Parent
    $name = [System.IO.Path]::GetFileNameWithoutExtension($full)

    $portal = Ensure-Portal

    # Refuse to silently overwrite an existing project file
    if ([System.IO.File]::Exists($full)) {
        throw "Target already exists: $full. Choose a different path."
    }
    if (-not [System.IO.Directory]::Exists($dir)) {
        [System.IO.Directory]::CreateDirectory($dir) | Out-Null
    }

    Write-Log "Creating project '$name' in '$dir'..."
    $dirInfo = New-Object System.IO.DirectoryInfo($dir)
    $project = Invoke-WithRetry { $portal.Projects.Create($dirInfo, $name) }
    $Global:TiaProject = $project

    Write-Log "Project created: $($project.Path)"
    Write-Log "SCRIPT_SUCCESS: Project created successfully."
} catch {
    Write-Log "Error creating project ${ProjectFilePath}: $($_.Exception.Message)"
    throw "Error creating project: $($_.Exception.Message)"
}
