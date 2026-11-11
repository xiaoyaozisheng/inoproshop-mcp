# =====================================================================
# ensure_project_open.ps1 - Portal/project/PLC-software resolution helpers.
#
# State model (TIA Portal Openness):
#   $Global:TiaPortal  - attached or created TiaPortal session
#   $Global:TiaProject - currently open Project object
#
# ensure_project_open(PROJECT_FILE_PATH) semantics preserved: reuse the
# already-open project when it matches, otherwise open it in the portal.
#
# NOTE: keep this file ASCII-only.
# =====================================================================

function Ensure-Portal {
    if ($null -ne $Global:TiaPortal) {
        return $Global:TiaPortal
    }
    if (-not ('Siemens.Engineering.TiaPortal' -as [type])) {
        throw "Siemens.Engineering assembly not loaded. Check the TIA Portal Openness PublicAPI dll path."
    }
    # Prefer attaching to a running TIA Portal instance (avoids duplicate
    # sessions fighting over project lockfiles).
    $procs = [Siemens.Engineering.TiaPortal]::GetProcesses()
    if ($procs.Count -gt 0) {
        Write-Log "Attaching to running TIA Portal instance (PID $($procs[0].Id))..."
        $Global:TiaPortal = $procs[0].Attach()
    } else {
        Write-Log "No running TIA Portal found - starting a new instance (WithUserInterface)..."
        $Global:TiaPortal = New-Object Siemens.Engineering.TiaPortal([Siemens.Engineering.TiaPortalMode]::WithUserInterface)
    }
    return $Global:TiaPortal
}

function Ensure-ProjectOpen {
    param([string]$ProjectFilePath = "")
    $portal = Ensure-Portal

    # Reuse cached project when it still matches (and is alive)
    if ($null -ne $Global:TiaProject) {
        try {
            if ([string]::IsNullOrWhiteSpace($ProjectFilePath) -or
                $Global:TiaProject.Path -ieq $ProjectFilePath) {
                return $Global:TiaProject
            }
        } catch {
            # Cached project object is stale (project was closed) - drop it
            $Global:TiaProject = $null
        }
    }

    # Look for a matching project already open in this portal session
    foreach ($p in $portal.Projects) {
        if ([string]::IsNullOrWhiteSpace($ProjectFilePath) -or
            $p.Path -ieq $ProjectFilePath) {
            $Global:TiaProject = $p
            return $p
        }
    }

    if ([string]::IsNullOrWhiteSpace($ProjectFilePath)) {
        throw "No project is open in TIA Portal and no project file path was provided."
    }

    $fileInfo = New-Object System.IO.FileInfo($ProjectFilePath)
    if (-not $fileInfo.Exists) {
        throw "Project file not found: $ProjectFilePath"
    }
    Write-Log "Opening project: $ProjectFilePath"
    $Global:TiaProject = Invoke-WithRetry { $portal.Projects.Open($fileInfo) }
    return $Global:TiaProject
}

function Ensure-PlcSoftware {
    # Resolve the PlcSoftware (program container) of a PLC in the open project.
    # When $DeviceName is empty the first PLC with software is used.
    param([string]$DeviceName = "")

    $project = $Global:TiaProject
    if ($null -eq $project) {
        throw "No project open. Call open_project first."
    }
    $candidates = @()
    foreach ($device in $project.Devices) {
        if (-not [string]::IsNullOrWhiteSpace($DeviceName) -and
            $device.Name -ine $DeviceName) { continue }
        foreach ($item in $device.DeviceItems) {
            $container = Get-EngService $item ([Siemens.Engineering.HW.Features.SoftwareContainer])
            if ($null -ne $container -and $null -ne $container.Software) {
                $plc = $container.Software -as [Siemens.Engineering.SW.PlcSoftware]
                if ($null -ne $plc) { $candidates += $plc }
            }
        }
    }
    if ($candidates.Count -eq 0) {
        if ([string]::IsNullOrWhiteSpace($DeviceName)) {
            throw "No PLC with software container found in project. Add a PLC station first (add_device)."
        }
        throw "Device '$DeviceName' not found or has no PLC software container."
    }
    return $candidates[0]
}

function Save-ProjectQuiet {
    # Save when a project is open; failures are logged but not fatal.
    if ($null -ne $Global:TiaProject) {
        try {
            $Global:TiaProject.Save()
            Write-Log "Project saved."
        } catch {
            Write-Log "WARNING: project save failed: $($_.Exception.Message)"
        }
    }
}
