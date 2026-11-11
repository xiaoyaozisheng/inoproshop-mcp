# =====================================================================
# set_credentials.ps1 - Store credentials for the session.
# Params: {USERNAME} {PASSWORD}
# TIA download/protection dialogs must be answered in the UI; the stored
# credentials are kept in the watcher session for future integrations.
# NOTE: keep this file ASCII-only.
# =====================================================================

$Username = '{USERNAME}'
$Password = '{PASSWORD}'

try {
    $Global:TiaCredentials = @{ username = $Username; password = $Password }
    Write-Log "Default credentials set (user='$Username')."
    Write-Log "NOTE: TIA Portal protection dialogs (download access protection) are"
    Write-Log "answered in the TIA UI; Openness does not inject credentials automatically."
    Write-Log "SCRIPT_SUCCESS: Credentials recorded for this session."
} catch {
    Write-Log "Error setting credentials: $($_.Exception.Message)"
    throw "Error setting credentials: $($_.Exception.Message)"
}
