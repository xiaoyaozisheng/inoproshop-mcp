# =====================================================================
# ensure_online_connection.ps1 - Online-connection helper.
#
# Platform note: TIA Portal Openness does NOT expose a "go online" session
# API (unlike the CODESYS scriptengine used previously). Operations that
# require a live online session (variable read/write/monitor, application
# state) are not supported through Openness and their scripts return a
# structured diagnostic instead. This helper records the requested target
# so translated scripts keep calling it without changes.
#
# NOTE: keep this file ASCII-only.
# =====================================================================

function Ensure-OnlineConnection {
    param([string]$ProjectFilePath = "", [string]$DeviceName = "")

    Write-Log "Online session: TIA Portal Openness provides no 'go online' API."
    if (-not [string]::IsNullOrWhiteSpace($DeviceName)) {
        $Global:TiaOnlineTarget = $DeviceName
        Write-Log "Connection target recorded: $DeviceName"
    } else {
        Write-Log "No explicit device target recorded."
    }
    return $null
}
