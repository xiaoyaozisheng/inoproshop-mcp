# =====================================================================
# create_folder.ps1 - Create a block group (folder) in the PLC program.
# Params: {PROJECT_FILE_PATH} {FOLDER_NAME} {PARENT_PATH}
# TIA: folders exist as block user groups / type user groups; this script
# creates a block group under the PLC program root (or under a matching
# existing group).
# Helpers required: _text_utils, ensure_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$FolderName      = '{FOLDER_NAME}'
$ParentPath      = '{PARENT_PATH}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
    $plc = Ensure-PlcSoftware

    # Resolve parent group: walk PARENT_PATH segments under BlockGroup
    $parentGroup = $plc.BlockGroup
    $segments = @(($ParentPath -split '[/\\]') | Where-Object { $_ -and $_ -notin @('Application', 'Program blocks', 'ProgramBlocks') })
    foreach ($seg in $segments) {
        $next = $null
        foreach ($sub in $parentGroup.Groups) {
            if ($sub.Name -ieq $seg) { $next = $sub; break }
        }
        if ($null -eq $next) {
            throw "Parent group '$seg' not found under program blocks (path '$ParentPath'). Create intermediate folders first."
        }
        $parentGroup = $next
    }

    # Refuse duplicates
    foreach ($sub in $parentGroup.Groups) {
        if ($sub.Name -ieq $FolderName) {
            throw "Folder '$FolderName' already exists under '$ParentPath'."
        }
    }

    Write-Log "Creating block group '$FolderName' under '$ParentPath'..."
    $createMethod = $parentGroup.Groups.GetType().GetMethods() |
        Where-Object { $_.Name -eq 'Create' } |
        Select-Object -First 1
    if ($null -eq $createMethod) {
        throw "This TIA version does not support creating block groups via Openness."
    }
    if ($createMethod.GetParameters().Count -ge 1) {
        Invoke-WithRetry { $createMethod.Invoke($parentGroup.Groups, @($FolderName)) } -MaxAttempts 2 | Out-Null
    } else {
        Invoke-WithRetry { $createMethod.Invoke($parentGroup.Groups, $null) } -MaxAttempts 2 | Out-Null
    }

    Save-ProjectQuiet
    Write-Log "Folder '$FolderName' created in '$ParentPath'."
    Write-Log "SCRIPT_SUCCESS: Folder created successfully."
} catch {
    Write-Log "Error creating folder '$FolderName': $($_.Exception.Message)"
    throw "Error creating folder: $($_.Exception.Message)"
}
