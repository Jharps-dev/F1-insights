param(
  [string]$TargetBranch = "dev",
  [string]$CommitMessage = "chore: validated workspace update"
)

$ErrorActionPreference = "Stop"

Write-Host "==> lint"
pnpm lint
Write-Host "==> typecheck"
pnpm typecheck
Write-Host "==> test"
pnpm test
Write-Host "==> replay"
pnpm test:replay
Write-Host "==> build"
pnpm build

if (-not (git rev-parse --is-inside-work-tree 2>$null)) {
  throw "Not inside a git repository."
}

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -eq "HEAD") {
  throw "Detached HEAD. Checkout a branch first."
}

git add .
$hasChanges = git diff --cached --name-only
if (-not $hasChanges) {
  Write-Host "No staged changes to commit."
  exit 0
}

git commit -m $CommitMessage
git push origin $branch

if ($branch -ne $TargetBranch -and (Get-Command gh -ErrorAction SilentlyContinue)) {
  gh pr create --fill --base $TargetBranch --head $branch
}
