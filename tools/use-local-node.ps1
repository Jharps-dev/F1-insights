$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeDir = Join-Path $repoRoot ".tools/node"

if (-not (Test-Path (Join-Path $nodeDir "node.exe"))) {
  throw "Local Node.js runtime not found at $nodeDir"
}

$env:PATH = "$nodeDir;$env:PATH"

Write-Host "Using local Node.js runtime from $nodeDir"
Write-Host "node: $(node --version)"
Write-Host "pnpm: $(pnpm --version)"