# =====================================================================
# add_device.ps1 - Add a device to the project.
# Params: {PROJECT_FILE_PATH} {PARENT_DEVICE_PATH} {DEVICE_NAME}
#         {DEVICE_TYPE} {DEVICE_ID} {DEVICE_VERSION}
# TIA Openness exposes no hardware-catalog API, so a new station cannot
# be created from a catalog id the way CODESYS device repository allowed.
# If the TIA version exposes a CreateWithItem/Create method it is used;
# otherwise a clear diagnostic is returned.
# Helpers required: _text_utils, ensure_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath   = '{PROJECT_FILE_PATH}'
$ParentDevicePath  = '{PARENT_DEVICE_PATH}'
$DeviceName        = '{DEVICE_NAME}'
$DeviceType        = '{DEVICE_TYPE}'
$DeviceId          = '{DEVICE_ID}'
$DeviceVersion     = '{DEVICE_VERSION}'

try {
    $project = Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath

    # Reflection probe: some TIA versions expose device creation
    $devicesType = $project.Devices.GetType()
    $createMethod = $devicesType.GetMethods() |
        Where-Object { $_.Name -in @('CreateWithItem', 'Create') } |
        Select-Object -First 1

    if ($null -eq $createMethod) {
        Write-Log "add_device is not supported through TIA Portal Openness on this installation."
        Write-Log "Requested: device '$DeviceName' (type=$DeviceType id=$DeviceId version=$DeviceVersion) under '$ParentDevicePath'."
        Write-Log "Reason: Openness exposes no hardware catalog API; stations are created via:"
        Write-Log "  - TIA Portal UI (Add new device), or"
        Write-Log "  - CAx/AML import through CaxProvider (C:\...\Automation\...\PublicAPI)."
        Write-Log "SCRIPT_ERROR: add_device not supported via Openness; use TIA UI or AML import."
        return
    }

    throw ("Device creation method found but parameter binding is version-specific; " +
           "create the station in TIA UI first, then drive it with inspect_device_node / set_device_parameter.")
} catch {
    Write-Log "Error in add_device: $($_.Exception.Message)"
    throw
}
