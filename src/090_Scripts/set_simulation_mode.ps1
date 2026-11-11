# =====================================================================
# set_simulation_mode.ps1 - Start/stop a PLCSIM instance if supported.
# Params: {PROJECT_FILE_PATH} {ENABLE} ('true'/'false')
# TIA Openness download API can target PLCSIM; some versions expose
# StartPLSim-style methods. Probed via reflection; clear diagnostic when
# unavailable.
# Helpers required: _text_utils, ensure_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$Enable          = ('{ENABLE}' -ieq 'true')

try {
    $project = Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath

    $downloadProvider = Get-EngService $project ([Siemens.Engineering.Download.DownloadProvider])
    if ($null -eq $downloadProvider) {
        throw ("TIA Portal Openness on this installation provides no DownloadProvider service. " +
               "PLCSIM cannot be controlled via Openness; start PLCSIM from TIA Portal UI " +
               "(Online > Simulation > Start), then use download_to_device.")
    }

    $simMethods = @()
    foreach ($dlDevice in $downloadProvider.Devices) {
        $methods = $dlDevice.GetType().GetMethods() |
            Where-Object { $_.Name -match 'PLSim|PLCSim|Simulation' }
        foreach ($m in $methods) { $simMethods += @($dlDevice, $m) }
    }

    if ($simMethods.Count -eq 0) {
        Write-Log "Simulation control method not found in the download API of this TIA version."
        Write-Log "Start/stop PLCSIM from the TIA Portal UI; download_to_device will target the instance."
        Write-Log "Simulation After: manual (start PLCSIM from TIA UI)"
        Write-Log "SCRIPT_SUCCESS: simulation mode checked (manual control required)."
        return
    }

    $pair = $simMethods[0]
    $dlDevice = $pair[0]
    $method = $pair[1]
    Write-Log "Calling $($method.Name) on download device '$($dlDevice.Name)' (enable=$Enable)..."
    $args = @()
    foreach ($p in $method.GetParameters()) {
        if ($p.ParameterType -eq [bool]) { $args += $Enable }
        elseif ($p.ParameterType -eq [string]) { $args += 'PLCSIM' }
        else { $args += ($null -as $p.ParameterType) }
    }
    Invoke-WithRetry { $method.Invoke($dlDevice, $args) } -MaxAttempts 1 | Out-Null
    Write-Log "Simulation After: $($Enable)"
    Write-Log "SCRIPT_SUCCESS: simulation mode set."
} catch {
    Write-Log "Error setting simulation mode: $($_.Exception.Message)"
    throw "Error setting simulation mode: $($_.Exception.Message)"
}
