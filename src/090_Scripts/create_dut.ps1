# =====================================================================
# create_dut.ps1 - Create a PLC data type (DUT/UDT) via external source.
# Params: {PROJECT_FILE_PATH} {DUT_NAME} {DUT_TYPE_STR} {PARENT_PATH}
# DUT_TYPE_STR: Structure | Enumeration | Union | Alias
# A placeholder member/value is inserted so the type is syntactically
# valid; refine it with set_pou_code afterwards.
# Helpers required: _text_utils, ensure_project_open, find_object_by_path
# NOTE: keep this file ASCII-only.
# =====================================================================

$ProjectFilePath = '{PROJECT_FILE_PATH}'
$DutName         = '{DUT_NAME}'
$DutTypeStr      = '{DUT_TYPE_STR}'
$ParentPath      = '{PARENT_PATH}'

try {
    Ensure-ProjectOpen -ProjectFilePath $ProjectFilePath | Out-Null
    $plc = Ensure-PlcSoftware

    switch ($DutTypeStr) {
        'Structure' {
            $body = "TYPE `"$DutName`" :`nSTRUCT`n    dummy : Int;`nEND_STRUCT;`nEND_TYPE"
        }
        'Enumeration' {
            $body = "TYPE `"$DutName`" :`n(`n    value0 := 0,`n    value1 := 1`n);`nEND_TYPE"
        }
        'Union' {
            $body = "TYPE `"$DutName`" :`nUNION`n    asInt : Int;`n    asDWord : DWord;`nEND_UNION;`nEND_TYPE"
        }
        'Alias' {
            $body = "TYPE `"$DutName`" : Int;`nEND_TYPE"
        }
        default {
            throw "Invalid DUT type string: '$DutTypeStr'. Use Structure, Enumeration, Union, or Alias."
        }
    }

    $srcName = $DutName + '_mcp_udt'
    $srcPath = Join-Path $env:TEMP ("mcp_dut_" + [Guid]::NewGuid().ToString('N').Substring(0,8) + ".udt")
    Write-Utf8BomFile -Path $srcPath -Content $body | Out-Null

    Write-Log "Generating PLC data type '$DutName' ($DutTypeStr) from external source..."
    Import-SclSourceAsBlocks -PlcSoftware $plc -SourceName $srcName -SourceFilePath $srcPath | Out-Null

    Save-ProjectQuiet
    Write-Log "DUT Created: $DutName ($DutTypeStr)"
    Write-Log "Parent Path: $ParentPath"
    Write-Log "SCRIPT_SUCCESS: DUT created successfully."
} catch {
    Write-Log "Error creating DUT '$DutName': $($_.Exception.Message)"
    throw "Error creating DUT '$DutName': $($_.Exception.Message)"
}
