@echo off
setlocal

cd /d "%~dp0"

set "NODE_DIR=%~dp0.tools\node"
if not exist "%NODE_DIR%\node.exe" (
  echo Local Node.js runtime not found at "%NODE_DIR%"
  echo Expected repo-local toolchain under .tools\node
  pause
  exit /b 1
)

set "PATH=%NODE_DIR%;%PATH%"

echo Starting F1 Insights from %CD%
echo Using local Node.js runtime from %NODE_DIR%
echo.

call "%NODE_DIR%\pnpm.cmd" dev
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo F1 Insights exited with code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%