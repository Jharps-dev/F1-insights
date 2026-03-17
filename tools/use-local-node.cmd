@echo off
setlocal
set "NODE_DIR=%~dp0..\.tools\node"
if not exist "%NODE_DIR%\node.exe" (
  echo Local Node.js runtime not found at "%NODE_DIR%"
  exit /b 1
)
set "PATH=%NODE_DIR%;%PATH%"
echo Using local Node.js runtime from %NODE_DIR%
node --version
pnpm --version