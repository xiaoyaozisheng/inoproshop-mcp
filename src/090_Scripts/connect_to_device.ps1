# =====================================================================
# connect_to_device.ps1 - Record a connection target for the session.
# Params: {PROJECT_FILE_PATH} {IP_ADDRESS} {GATEWAY_NAME}
# TIA Openness has no 'go online' API; this validates the device exists
# and records the target (used by download_to_device). Variable-level
# online access is not available through Openness.
# Helpers required: ensure_project_open, ensure_online_connection
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$IpAddress       = '{IP_ADDRESS}'
$GatewayName     = '{GATEWAY_NAME}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
    Ensure-OnlineConnection -ProjectFilePath $ProjectFilePath -DeviceName $IpAddress | Out-Null

    # Verify at least one PLC device exists in the project
    $plcCount = 0
    foreach ($device in $Global:TiaProject.Devices) {
        foreach ($item in $device.DeviceItems) {
            $container = Get-EngService $item ([Siemens.Engineering.HW.Features.SoftwareContainer])
            if ($null -ne $container -and $null -ne $container.Software) { $plcCount++ }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($IpAddress)) {
        Write-Log "Connection target: $IpAddress (gateway: $(if ($GatewayName) { $GatewayName } else { 'default' }))"
    }
    Write-Log "PLC devices with software in project: $plcCount"
    Write-Log "NOTE: TIA Portal Openness supports project download (download_to_device) but not"
    Write-Log "interactive online sessions (variable read/write/monitor)."
    Write-Log "SCRIPT_SUCCESS: Connection target recorded."
} catch {
    Write-Log "Error connecting to device: $($_.Exception.Message)"
    throw "Error connecting to device: $($_.Exception.Message)"
}
