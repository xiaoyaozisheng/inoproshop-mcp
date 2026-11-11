# =====================================================================
# add_library.ps1 - Open/attach a global library to the session.
# Params: {PROJECT_FILE_PATH} {LIBRARY_NAME}
# TIA: libraries are .alXX files opened via TiaPortal.GlobalLibraries.
# Inserting master copies into the project is attempted via reflection
# when available.
# Helpers required: _text_utils, ensure_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$LibraryName     = '{LIBRARY_NAME}'

try {
    $project = Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath
    $portal = $Global:TiaPortal

    # Already open?
    $openLib = $null
    try {
        foreach ($lib in $portal.GlobalLibraries) {
            if ($lib.Name -ieq $LibraryName) { $openLib = $lib; break }
        }
    } catch {
        throw ("TiaPortal.GlobalLibraries is not available on this TIA version: " + $_.Exception.Message)
    }

    if ($null -eq $openLib) {
        # Search typical global library folders for a matching .alXX file
        $candidates = @()
        $roots = @(
            (Join-Path $env:USERPROFILE 'Documents\Siemens\Automation\Libraries'),
            (Join-Path $env:PUBLIC 'Documents\Siemens\Automation\Libraries')
        )
        foreach ($root in $roots) {
            if ([System.IO.Directory]::Exists($root)) {
                $candidates += Get-ChildItem -Path $root -Recurse -Filter ($LibraryName + '.al*') -File -ErrorAction SilentlyContinue
            }
        }
        if ($candidates.Count -eq 0) {
            throw ("Library '$LibraryName' not found in the global library folders. " +
                   "Install the library (TIA UI: Libraries > Open library) or adjust the name.")
        }
        $libFile = New-Object System.IO.FileInfo($candidates[0].FullName)
        Write-Log "Opening global library: $($candidates[0].FullName)"
        $openMethod = $portal.GlobalLibraries.GetType().GetMethods() |
            Where-Object { $_.Name -eq 'Open' } | Select-Object -First 1
        if ($null -eq $openMethod) {
            throw "GlobalLibraries.Open not available on this TIA version."
        }
        Invoke-WithRetry { $openMethod.Invoke($portal.GlobalLibraries, @($libFile)) } -MaxAttempts 2 | Out-Null
    } else {
        Write-Log "Library '$LibraryName' is already open in the session."
    }

    Save-ProjectQuiet
    Write-Log "Library '$LibraryName' available in the session."
    Write-Log "SCRIPT_SUCCESS: Library added."
} catch {
    Write-Log "Error adding library '$LibraryName': $($_.Exception.Message)"
    throw "Error adding library: $($_.Exception.Message)"
}
