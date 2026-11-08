@echo off
REM ===========================================================================
REM  start-mcp.cmd - InoProShop MCP server launcher (stdio transport)
REM
REM  This is the entry point an MCP client (Claude Code, Cursor, Windsurf, ...)
REM  spawns. It is NOT a daemon: it speaks JSON-RPC over stdin/stdout, so just
REM  double-clicking it will look like it "hangs" - that is it waiting for a
REM  client to send a message. That is normal.
REM
REM  To check the server is healthy from a shell:
REM      start-mcp.cmd --version
REM      start-mcp.cmd --help
REM
REM  To run it by hand the way a client would:
REM      echo {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}} | start-mcp.cmd
REM
REM  Override anything by passing extra flags - later flags win:
REM      start-mcp.cmd --codesys-path "D:/somewhere/InoProShop.exe"
REM      start-mcp.cmd --codesys-profile "InoProShop(V1.9.0.1)"
REM      start-mcp.cmd --no-auto-launch
REM      start-mcp.cmd --allow-eval
REM ===========================================================================
setlocal

set "PKG=%~dp0"
set "EXE=C:/Inovance Control/InoProShop/CODESYS/Common/InoProShop.exe"
set "EXE_CHECK=%EXE:C:/=\%"
set "PROFILES_DIR=C:\Inovance Control\InoProShop\CODESYS\Profiles"

REM ---------------------------------------------------------------------------
REM Profile names differ per machine and per IDE build (this package has seen
REM both InoProShop(V1.9.0.1) and InoProShop(V1.10.0.3) on different machines),
REM so the profile is auto-detected from the Profiles directory at startup:
REM prefer an InoProShop*.profile, fall back to the first *.profile found.
REM Override at any time with:  start-mcp.cmd --codesys-profile "<name>"
REM The Profiles directory is the authority - never copy a name from a README.
REM ---------------------------------------------------------------------------
set "PROFILE="

if exist "%PROFILES_DIR%" (
  for /f "delims=" %%P in ('dir /b "%PROFILES_DIR%\InoProShop*.profile" 2^>nul') do (
    if not defined PROFILE set "PROFILE=%%~nP"
  )
)
if not defined PROFILE if exist "%PROFILES_DIR%" (
  for /f "delims=" %%P in ('dir /b "%PROFILES_DIR%\*.profile" 2^>nul') do (
    if not defined PROFILE set "PROFILE=%%~nP"
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
REM (even without InoProShop installed), so skip the exe/profile checks for them.
REM (/c: literals are required - findstr parses a bare "--version" as a switch.)
set "ARGS=%*"
set "SELFCHECK="
if defined ARGS (
  echo %ARGS% | findstr /i /c:"--version" /c:"--help" /c:"--detect" >nul && set "SELFCHECK=1"
)
if defined SELFCHECK goto run

if not exist "%EXE_CHECK%" (
  echo [ERROR] InoProShop.exe not found at "%EXE%".
  echo         Pass a different location with:
  echo           start-mcp.cmd --codesys-path "C:/.../InoProShop.exe"
  exit /b 2
)

if not defined PROFILE (
  echo [ERROR] No *.profile found in "%PROFILES_DIR%".
  echo         Install InoProShop, or pass both flags explicitly:
  echo           start-mcp.cmd --codesys-path "C:/.../InoProShop.exe" --codesys-profile "InoProShop(VX.Y.Z.W)"
  exit /b 2
)

echo [start-mcp] exe    : %EXE%
echo [start-mcp] profile: %PROFILE%  ^(auto-detected from Profiles directory^)

:run
node "%PKG%dist\bin.js" --codesys-path "%EXE%" --codesys-profile "%PROFILE%" --mode persistent %*
exit /b %ERRORLEVEL%
