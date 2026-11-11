@echo off
REM ===========================================================================
REM  start-mcp.cmd - TIA Portal MCP server launcher (stdio transport)
REM
REM  This is the entry point an MCP client (Claude Code, Cursor, Windsurf, ...)
REM  spawns. It is NOT a daemon: it speaks JSON-RPC over stdin/stdout, so just
REM  double-clicking it will look like it "hangs" - that is it waiting for a
REM  client to send a message. That is normal.
REM
REM  To check the server is healthy from a shell:
REM      start-mcp.cmd --version
REM      start-mcp.cmd --help
REM      start-mcp.cmd --detect        (scan TIA Portal installations)
REM
REM  To run it by hand the way a client would:
REM      echo {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}} | start-mcp.cmd
REM
REM  Override anything by passing extra flags - later flags win:
REM      start-mcp.cmd --tia-exe "C:/Program Files/Siemens/Automation/Portal V17/Bin/Siemens.Automation.Portal.exe"
REM      start-mcp.cmd --tia-version "V17"
REM      start-mcp.cmd --no-auto-launch
REM      start-mcp.cmd --allow-eval
REM ===========================================================================
setlocal

set "PKG=%~dp0"

REM ---------------------------------------------------------------------------
REM TIA Portal exe is OPTIONAL: the Openness watcher attaches to a running
REM TIA Portal instance or starts one itself. We auto-detect the newest
REM "Portal V*" installation only for the startup banner. Override with:
REM     start-mcp.cmd --tia-exe "<path>" --tia-version "VXX"
REM ---------------------------------------------------------------------------
set "TIA_ROOT=C:\Program Files\Siemens\Automation"
set "EXE="

if exist "%TIA_ROOT%" (
  for /f "delims=" %%D in ('dir /b /ad "%TIA_ROOT%\Portal V*" 2^>nul') do (
    if exist "%TIA_ROOT%\%%D\Bin\Siemens.Automation.Portal.exe" set "EXE=%TIA_ROOT%\%%D\Bin\Siemens.Automation.Portal.exe"
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found on PATH. Install Node.js ^>= 18 first.
  exit /b 2
)

if not exist "%PKG%dist\bin.js" (
  echo [ERROR] dist\bin.js not found - the package has not been built yet.
  echo         Run:  npm install  ^&^&  npm run build
  exit /b 3
)

REM --version / --help / --detect are self-checks and must work on any machine
REM (even without TIA Portal installed), so skip the exe check for them.
REM (/c: literals are required - findstr parses a bare "--version" as a switch.)
set "ARGS=%*"
set "SELFCHECK="
if defined ARGS (
  echo %ARGS% | findstr /i /c:"--version" /c:"--help" /c:"--detect" >nul && set "SELFCHECK=1"
)
if defined SELFCHECK goto run

if not defined EXE (
  echo [WARN] No TIA Portal installation found under "%TIA_ROOT%".
  echo        The watcher will still start; project commands need TIA Portal
  echo        (with Openness) installed. Override with:
  echo          start-mcp.cmd --tia-exe "C:/.../Siemens.Automation.Portal.exe"
)

echo [start-mcp] tia exe: %EXE%

:run
node "%PKG%dist\bin.js" --mode persistent %*
exit /b %ERRORLEVEL%
