# =====================================================================
# get_compile_messages.ps1 - Return the messages of the last compile run.
# Params: {PROJECT_FILE_PATH}
# Output: same fenced block as compile_project (when messages exist).
# Helpers required: _text_utils, ensure_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null

    $messages = $null
    if ($null -ne $Global:TiaLastCompileMessages) {
        $messages = $Global:TiaLastCompileMessages
    }

    if ($null -eq $messages -or @($messages).Count -eq 0) {
        Write-Log "No compile messages available. Run compile_project first."
        Write-Log "SCRIPT_SUCCESS: no cached compile messages."
        return
    }

    $msgJson = ConvertTo-Json -InputObject @($messages) -Depth 6 -Compress
    Write-Log "### COMPILE_MESSAGES_START ###"
    Write-Log $msgJson
    Write-Log "### COMPILE_MESSAGES_END ###"
    Write-Log "SCRIPT_SUCCESS: compile messages retrieved."
} catch {
    Write-Log "Error retrieving compile messages: $($_.Exception.Message)"
    throw "Error retrieving compile messages: $($_.Exception.Message)"
}
