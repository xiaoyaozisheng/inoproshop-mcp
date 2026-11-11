# =====================================================================
# compile_project.ps1 - Compile the PLC software (HW+SW) of the project.
# Params: {PROJECT_FILE_PATH}
# Output: ### COMPILE_MESSAGES_START ### [{severity,text,object,line}]
#         ### COMPILE_MESSAGES_END ###
# Helpers required: _text_utils, ensure_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null

    # Compile each device that carries PLC software (HW + SW consistency)
    $project = $Global:TiaProject
    $compiled = 0
    $messages = @()

    foreach ($device in $project.Devices) {
        $hasPlc = $false
        foreach ($item in $device.DeviceItems) {
            $container = Get-EngService $item ([Siemens.Engineering.HW.Features.SoftwareContainer])
            if ($null -ne $container -and $null -ne $container.Software) {
                if ($container.Software -is [Siemens.Engineering.SW.PlcSoftware]) { $hasPlc = $true }
            }
        }
        if (-not $hasPlc) { continue }

        Write-Log "Compiling device '$($device.Name)' (HW + SW)..."
        $compilable = Get-EngService $device ([Siemens.Engineering.Compiler.ICompilable])
        if ($null -eq $compilable) {
            Write-Log "WARNING: device '$($device.Name)' provides no ICompilable service; skipped."
            continue
        }
        $result = Invoke-WithRetry { $compilable.Compile() } -MaxAttempts 2
        $compiled++

        $state = try { $result.State } catch { '' }
        $errCount = try { $result.ErrorCount } catch { 0 }
        $warnCount = try { $result.WarningCount } catch { 0 }
        Write-Log "Device '$($device.Name)': State=$state, Errors=$errCount, Warnings=$warnCount"

        $messages += ConvertFrom-CompilerResult -Result $result -DeviceName $device.Name
    }

    if ($compiled -eq 0) {
        throw "No PLC device found to compile. Add a PLC station first (add_device or TIA UI)."
    }

    # Cache for get_compile_messages
    $Global:TiaLastCompileMessages = $messages

    $msgJson = ConvertTo-Json -InputObject @($messages) -Depth 6 -Compress
    Write-Log "### COMPILE_MESSAGES_START ###"
    Write-Log $msgJson
    Write-Log "### COMPILE_MESSAGES_END ###"

    $hasErrors = @($messages | Where-Object { $_.severity -eq 'error' }).Count -gt 0
    Write-Log "Compiled $compiled device(s)."
    if ($hasErrors) {
        Write-Log "SCRIPT_SUCCESS: compile ran with errors (see messages)."
    } else {
        Write-Log "SCRIPT_SUCCESS: Compilation complete."
    }
} catch {
    Write-Log "Error compiling project: $($_.Exception.Message)"
    throw "Error compiling project: $($_.Exception.Message)"
}
