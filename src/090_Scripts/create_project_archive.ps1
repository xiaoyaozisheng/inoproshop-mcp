# =====================================================================
# create_project_archive.ps1 - Archive the open project to a .zap file.
# Params: {PROJECT_FILE_PATH} {ARCHIVE_PATH} {COMMENT}
#         {INCLUDE_LIBRARIES} {INCLUDE_COMPILED} ('1'/'0')
#
# TIA Portal Openness only added archiving in later versions; the script
# looks for an Archive method on the Project object via reflection and
# fails with a clear diagnostic when the installed version lacks it.
# Helpers required: _text_utils, require_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$ArchivePath     = '{ARCHIVE_PATH}'
$Comment         = '{COMMENT}'

try {
    $project = Require-ProjectOpen -ProjectFilePath $ProjectFilePath

    # Save first so the archive captures current state
    $project.Save()

    $archiveMethod = $project.GetType().GetMethods() |
        Where-Object { $_.Name -eq 'Archive' } |
        Select-Object -First 1

    if ($null -eq $archiveMethod) {
        throw ("TIA Portal Openness on this installation does not expose a project Archive method. " +
               "Create .zap archives via TIA Portal UI (Project > Archive) or upgrade TIA Portal. " +
               "Restoring a .zap IS supported (Projects.Retrieve).")
    }

    $outFull = [System.IO.Path]::GetFullPath($ArchivePath)
    $outDir = Split-Path -Path $outFull -Parent
    if (-not [System.IO.Directory]::Exists($outDir)) {
        [System.IO.Directory]::CreateDirectory($outDir) | Out-Null
    }
    $outFile = New-Object System.IO.FileInfo($outFull)

    Write-Log "Archiving project to $outFull ..."
    $params = $archiveMethod.GetParameters()
    $archiveArgs = @()
    if ($params.Count -ge 1) { $archiveArgs += $outFile }
    if ($params.Count -ge 2) { $archiveArgs += $Comment }
    Invoke-WithRetry { $archiveMethod.Invoke($project, $archiveArgs) } -MaxAttempts 1

    $size = 0
    if ([System.IO.File]::Exists($outFull)) { $size = (Get-Item $outFull).Length }
    if ($size -le 0) {
        throw "Archive call completed but no output file was produced at $outFull"
    }

    $payload = [ordered]@{
        archive_path = $outFull
        size_bytes   = $size
        comment      = if ([string]::IsNullOrWhiteSpace($Comment)) { $null } else { $Comment }
    }
    Write-ResultJson $payload
    Write-Log "SCRIPT_SUCCESS: Archive created."
} catch {
    Write-Log "Error creating archive: $($_.Exception.Message)"
    throw "Error creating project archive: $($_.Exception.Message)"
}
