# =====================================================================
# create_property.ps1 - NOT SUPPORTED on TIA Portal.
# Params: {PROJECT_FILE_PATH} {PARENT_POU_FULL_PATH} {PROPERTY_NAME}
#         {PROPERTY_TYPE}
# TIA SCL has no CODESYS-style property accessors on function blocks.
# Helpers required: _text_utils, ensure_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath   = '{PROJECT_FILE_PATH}'
$ParentPouFullPath = '{PARENT_POU_FULL_PATH}'
$PropertyName      = '{PROPERTY_NAME}'
$PropertyType      = '{PROPERTY_TYPE}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
} catch {
    # not fatal for the diagnostic below
}

Write-Log "create_property is not supported on TIA Portal."
Write-Log "Requested: property '$PropertyName' (type $PropertyType) on '$ParentPouFullPath'."
Write-Log "Reason: TIA Portal (SCL/LAD/FBD) has no CODESYS-style property accessors attached to POUs."
Write-Log "Suggested alternatives:"
Write-Log "  - Model the property as a pair of methods/FCs (Get_<name> / Set_<name>)."
Write-Log "  - Or expose the backing variable directly (VAR_INPUT/VAR_OUTPUT)."
Write-Log "SCRIPT_ERROR: create_property is not supported on TIA Portal."
