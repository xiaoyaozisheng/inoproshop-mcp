# =====================================================================
# download_to_device.ps1 - Download (load) the compiled program to the PLC.
# Params: {PROJECT_FILE_PATH} {MODE} ('auto'|'online_change'|'full')
# Uses the Openness download API (Siemens.Engineering.Download). Note:
# TIA may show confirmation dialogs (e.g. certificate/licence prompts) -
# answer them in the TIA UI. MODE is advisory; Openness download is a
# full load per device.
# Helpers required: ensure_project_open, ensure_online_connection
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$Mode            = '{MODE}'

try {
    $project = Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath

    # Make sure the software is compiled before download
    $compilable = $null
    $plcDevices = @()
    foreach ($device in $project.Devices) {
        $hasPlc = $false
        foreach ($item in $device.DeviceItems) {
            $container = Get-EngService $item ([Siemens.Engineering.HW.Features.SoftwareContainer])
            if ($null -ne $container -and $null -ne $container.Software) { $hasPlc = $true }
        }
        if ($hasPlc) { $plcDevices += $device }
    }
    if ($plcDevices.Count -eq 0) {
        throw "No PLC device in project to download."
    }

    Write-Log "Compiling before download (mode=$Mode)..."
    foreach ($device in $plcDevices) {
        $comp = Get-EngService $device ([Siemens.Engineering.Compiler.ICompilable])
        if ($null -ne $comp) {
            $result = Invoke-WithRetry { $comp.Compile() } -MaxAttempts 2
            $errCount = try { $result.ErrorCount } catch { 0 }
            if ($errCount -gt 0) {
                throw "Compile failed with $errCount error(s) on device '$($device.Name)'; download aborted. Run compile_project for details."
            }
        }
    }

    $downloadProvider = Get-EngService $project ([Siemens.Engineering.Download.DownloadProvider])
    if ($null -eq $downloadProvider) {
        throw ("Openness download API (DownloadProvider) unavailable on this TIA version. " +
               "Download from the TIA Portal UI, or upgrade TIA Portal.")
    }

    $downloaded = 0
    foreach ($device in $plcDevices) {
        $dlDevice = $null
        foreach ($candidate in $downloadProvider.Devices) {
            if ($candidate.Name -ieq $device.Name) { $dlDevice = $candidate; break }
        }
        if ($null -eq $dlDevice) {
            Write-Log "WARNING: no download target for device '$($device.Name)'; skipped."
            continue
        }

        $dlMethods = $dlDevice.GetType().GetMethods() |
            Where-Object { $_.Name -match '^Download' } |
            Sort-Object Name
        if ($dlMethods.Count -eq 0) {
            Write-Log "WARNING: device '$($device.Name)' exposes no Download method; skipped."
            continue
        }

        $method = $dlMethods[0]
        Write-Log "Downloading to '$($device.Name)' via $($method.Name)..."
        $args = @()
        foreach ($p in $method.GetParameters()) {
            if ($p.ParameterType -eq [string]) { $args += $Mode }
            elseif ($p.ParameterType -eq [bool]) { $args += $true }
            else { $args += ($null -as $p.ParameterType) }
        }
        try {
            Invoke-WithRetry { $method.Invoke($dlDevice, $args) } -MaxAttempts 1 | Out-Null
            $downloaded++
            Write-Log "Download completed for '$($device.Name)'."
        } catch {
            Write-Log "ERROR: download to '$($device.Name)' failed: $($_.Exception.Message)"
            Write-Log "Note: TIA may be waiting for a confirmation dialog (certificate of origin,"
            Write-Log "IP conflict, etc.) - answer it in the TIA Portal UI and retry."
        }
    }

    if ($downloaded -eq 0) {
        throw "No device accepted the download. Check TIA UI dialogs and PLC reachability."
    }
    Write-Log "Application downloaded to $downloaded device(s) for $ProjectFilePath (mode=$Mode)."
    Write-Log "SCRIPT_SUCCESS: Download complete."
} catch {
    Write-Log "Error downloading to device: $($_.Exception.Message)"
    throw "Error downloading to device: $($_.Exception.Message)"
}
