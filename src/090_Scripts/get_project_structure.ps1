# =====================================================================
# get_project_structure.ps1 - Dump the project tree as indented text.
# Params: {PROJECT_FILE_PATH}
# Output: text between --- PROJECT STRUCTURE START --- / END markers.
# Helpers required: _text_utils, require_project_open
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'

try {
    $project = Require-ProjectOpen -ProjectFilePath $ProjectFilePath

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("Project: $($project.Path)")

    foreach ($device in $project.Devices) {
        $lines.Add("  Device: $($device.Name) [$($device.TypeIdentifier)]")
        foreach ($item in $device.DeviceItems) {
            $lines.Add("    DeviceItem: $($item.Name)")
            $container = Get-EngService $item ([Siemens.Engineering.HW.Features.SoftwareContainer])
            if ($null -ne $container -and $null -ne $container.Software) {
                $plc = $container.Software -as [Siemens.Engineering.SW.PlcSoftware]
                if ($null -ne $plc) {
                    $lines.Add("      PLC Software: $($plc.Name)")

                    # Program blocks (recursive)
                    $stack = New-Object System.Collections.Stack
                    $stack.Push(@('      ', $plc.BlockGroup))
                    while ($stack.Count -gt 0) {
                        $e = $stack.Pop()
                        $indent = $e[0]; $group = $e[1]
                        if ($indent -ne '      ') { $lines.Add("$indent Group: $($group.Name)") }
                        foreach ($block in $group.Blocks) {
                            $bt = try { $block.GetType().Name } catch { 'Block' }
                            $lang = try { $block.ProgrammingLanguage } catch { '' }
                            $lines.Add("$indent  Block: $($block.Name) ($bt, $lang)")
                        }
                        foreach ($sub in $group.Groups) { $stack.Push(@("$indent    ", $sub)) }
                    }

                    # PLC data types (recursive)
                    $stack = New-Object System.Collections.Stack
                    $stack.Push(@('      ', $plc.TypeGroup))
                    while ($stack.Count -gt 0) {
                        $e = $stack.Pop()
                        $indent = $e[0]; $group = $e[1]
                        if ($indent -ne '      ') { $lines.Add("$indent TypeGroup: $($group.Name)") }
                        foreach ($t in $group.Types) {
                            $lines.Add("$indent  Type: $($t.Name)")
                        }
                        foreach ($sub in $group.Groups) { $stack.Push(@("$indent    ", $sub)) }
                    }
                }
            }
        }
    }

    $tree = $lines -join "`n"
    Write-Log "--- PROJECT STRUCTURE START ---"
    Write-Log $tree
    Write-Log "--- PROJECT STRUCTURE END ---"
    Write-Log "SCRIPT_SUCCESS: Structure retrieved."
} catch {
    Write-Log "Error retrieving project structure: $($_.Exception.Message)"
    throw "Error retrieving project structure: $($_.Exception.Message)"
}
