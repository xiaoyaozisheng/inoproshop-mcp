# =====================================================================
# list_device_repository.ps1 - NOT SUPPORTED on TIA Portal.
# Params: {VENDOR_FILTER} {NAME_FILTER} {MAX_RESULTS}
# Openness exposes no hardware catalog / device repository API.
# Helpers required: _text_utils
# NOTE: keep this file ASCII-only.
# =====================================================================

$VendorFilter = '{VENDOR_FILTER}'
$NameFilter   = '{NAME_FILTER}'
$MaxResults   = '{MAX_RESULTS}'

Write-Log "list_device_repository is not supported on TIA Portal."
Write-Log "Filters requested: vendor='$VendorFilter' name='$NameFilter' max=$MaxResults"
Write-Log "Reason: TIA Portal Openness provides no hardware catalog API."
Write-Log "Suggested alternative: browse the TIA Portal hardware catalog UI, or install"
Write-Log "the device's GSD/HSP files, then add the station from the TIA UI."
Write-Log "SCRIPT_ERROR: list_device_repository is not supported on TIA Portal."
