# =====================================================================
# require_project_open.ps1 - Strict variant of ensure_project_open.
# Fails when no project is already open in the attached TIA Portal;
# never opens a project implicitly (matches original require_project_open
# semantics, used by read-only resources).
#
# NOTE: keep this file ASCII-only.
# =====================================================================

function Require-ProjectOpen {
    param([string]$ProjectFilePath = "")

    if ($null -eq $Global:TiaPortal) {
        throw "TIA Portal not attached. Use launch/attach first."
    }
    if ($Global:TiaPortal.Projects.Count -eq 0) {
        throw "A project must already be open in TIA Portal (this operation does not open projects)."
    }

    if ($null -ne $Global:TiaProject) {
        try {
            if ([string]::IsNullOrWhiteSpace($ProjectFilePath) -or
                $Global:TiaProject.Path -ieq $ProjectFilePath) {
                return $Global:TiaProject
            }
        } catch {
            $Global:TiaProject = $null
        }
    }

    foreach ($p in $Global:TiaPortal.Projects) {
        if ([string]::IsNullOrWhiteSpace($ProjectFilePath) -or
            $p.Path -ieq $ProjectFilePath) {
            $Global:TiaProject = $p
            return $p
        }
    }

    $open = @()
    foreach ($p in $Global:TiaPortal.Projects) { $open += $p.Path }
    throw ("No open project matches '$ProjectFilePath'. Open projects: " + ($open -join ', '))
}
