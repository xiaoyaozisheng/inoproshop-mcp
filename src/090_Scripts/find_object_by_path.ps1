# =====================================================================
# find_object_by_path.ps1 - Object lookup helpers (replacement for the
# CODESYS find_object_by_path.py / find_object_by_path_robust helper).
#
# TIA Portal paths differ from CODESYS: blocks live under
#   <PLC>.BlockGroup (Groups / Blocks) and types under
#   <PLC>.TypeGroup (Groups / Types).
# Path forms accepted here: either a bare object name ("FB_Motor") or a
# group path ("MyGroup/SubGroup/BlockName").
#
# NOTE: keep this file ASCII-only.
# =====================================================================

function Find-BlockByName {
    # Recursive search for a block by name across all block groups.
    param([object]$PlcSoftware, [string]$Name)
    if ($null -eq $PlcSoftware) { return $null }

    $stack = New-Object System.Collections.Stack
    $stack.Push($PlcSoftware.BlockGroup)
    while ($stack.Count -gt 0) {
        $group = $stack.Pop()
        foreach ($block in $group.Blocks) {
            if ($block.Name -ieq $Name) { return $block }
        }
        foreach ($sub in $group.Groups) { $stack.Push($sub) }
    }
    return $null
}

function Find-TypeByName {
    # Recursive search for a PLC data type (UDT) by name.
    param([object]$PlcSoftware, [string]$Name)
    if ($null -eq $PlcSoftware) { return $null }

    $stack = New-Object System.Collections.Stack
    $stack.Push($PlcSoftware.TypeGroup)
    while ($stack.Count -gt 0) {
        $group = $stack.Pop()
        foreach ($type in $group.Types) {
            if ($type.Name -ieq $Name) { return $type }
        }
        foreach ($sub in $group.Groups) { $stack.Push($sub) }
    }
    return $null
}

function Find-DeviceByName {
    param([object]$Project, [string]$Name)
    foreach ($device in $Project.Devices) {
        if ($device.Name -ieq $Name) { return $device }
    }
    return $null
}

function Find-ObjectByPathRobust {
    # Compatible entry point used by translated scripts.
    # TIA has a single unified namespace per software container, so path
    # resolution first tries blocks, then PLC data types, then devices.
    param([object]$Project, [string]$Path, [string]$ExpectedKind = "")

    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    $leaf = ($Path -split '[/\\\.]')[-1]

    # Try every PLC software container in the project
    foreach ($device in $Project.Devices) {
        foreach ($item in $device.DeviceItems) {
            $container = Get-EngService $item ([Siemens.Engineering.HW.Features.SoftwareContainer])
            if ($null -eq $container -or $null -eq $container.Software) { continue }
            $plc = $container.Software -as [Siemens.Engineering.SW.PlcSoftware]
            if ($null -eq $plc) { continue }

            $block = Find-BlockByName $plc $leaf
            if ($null -ne $block) { return $block }
            $type = Find-TypeByName $plc $leaf
            if ($null -ne $type) { return $type }
        }
    }

    $device = Find-DeviceByName $Project $leaf
    if ($null -ne $device) { return $device }
    return $null
}
