# =====================================================================
# inspect_device_node.ps1 - Introspect a device node's attributes/children.
# Params: {PROJECT_FILE_PATH} {DEVICE_PATH}
# Output: RESULT_JSON {name, type, attributes: [{name,value,access_mode}],
#         children: [{name, type}]}
# Helpers required: _text_utils, require_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$DevicePath      = '{DEVICE_PATH}'

try {
    $project = Require-ProjectOpen -ProjectFilePath $ProjectFilePath

    $leaf = ($DevicePath -split '[/\\]')[-1]
    $node = $null

    # Match a device or a device item by name
    foreach ($device in $project.Devices) {
        if ($device.Name -ieq $leaf) { $node = $device; break }
        foreach ($item in $device.DeviceItems) {
            if ($item.Name -ieq $leaf) { $node = $item; break }
        }
        if ($null -ne $node) { break }
    }
    if ($null -eq $node) {
        throw "Device node '$leaf' not found in project. Use get_project_structure to see the device tree."
    }

    $attributes = @()
    try {
        $infos = $node.GetAttributeInfos()
        foreach ($info in $infos) {
            $value = $null
            try { $value = [string]$node.GetAttribute($info.Name) } catch { }
            $access = try { [string]$info.AccessMode } catch { '' }
            $attributes += [ordered]@{
                name        = $info.Name
                value       = $value
                access_mode = $access
            }
        }
    } catch {
        Write-Log "WARNING: attribute enumeration failed: $($_.Exception.Message)"
    }

    $children = @()
    try {
        foreach ($item in $node.DeviceItems) {
            $children += [ordered]@{ name = $item.Name; type = $item.GetType().Name }
        }
    } catch { }

    $nodeName = $leaf
    try { if ($node.Name) { $nodeName = $node.Name } } catch { }
    $nodeType = $node.GetType().Name

    $payload = [ordered]@{
        name       = $nodeName
        type       = $nodeType
        attributes = $attributes
        children   = $children
    }
    Write-ResultJson $payload
    Write-Log "Node '$leaf': $($attributes.Count) attribute(s), $($children.Count) child item(s)."
    Write-Log "SCRIPT_SUCCESS: Node inspected."
} catch {
    Write-Log "Error inspecting device node '$DevicePath': $($_.Exception.Message)"
    throw "Error inspecting device node: $($_.Exception.Message)"
}
