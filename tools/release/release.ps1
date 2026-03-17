param(
  [string]$Version
)

$ErrorActionPreference = "Stop"
if (-not $Version) {
  throw "Pass -Version x.y.z"
}

pnpm lint
pnpm typecheck
pnpm test
pnpm test:replay
pnpm build

git checkout main
git pull origin main
git tag "v$Version"
git push origin "v$Version"
Write-Host "Release tag pushed: v$Version"
