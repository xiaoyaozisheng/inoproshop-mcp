# =====================================================================
# create_method.ps1 - NOT SUPPORTED on TIA Portal.
# Params: {PROJECT_FILE_PATH} {PARENT_POU_FULL_PATH} {METHOD_NAME}
#         {RETURN_TYPE}
# TIA SCL has no CODESYS-style methods attached to POUs (no access
# modifiers / overloading on FB members). Structured alternatives exist.
# Helpers required: _text_utils, ensure_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath   = '{PROJECT_FILE_PATH}'
$ParentPouFullPath = '{PARENT_POU_FULL_PATH}'
$MethodName        = '{METHOD_NAME}'
$ReturnType        = '{RETURN_TYPE}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
} catch {
    # not fatal for the diagnostic below
}

$parentName = ($ParentPouFullPath -split '[/\\]')[-1]

Write-Log "create_method is not supported on TIA Portal."
Write-Log "Requested: method '$MethodName' (return: ${ReturnType}) on '$ParentPouFullPath'."
Write-Log "Reason: TIA Portal POUs have no CODESYS-style method members."
Write-Log "Suggested alternatives:"
Write-Log ("  - Create a standalone FC and call it from '" + $parentName + "':")
Write-Log ("      create_pou(name='" + $MethodName + "', type='Function', language='ST') then set_pou_code.")
Write-Log "SCRIPT_ERROR: create_method is not supported on TIA Portal."
