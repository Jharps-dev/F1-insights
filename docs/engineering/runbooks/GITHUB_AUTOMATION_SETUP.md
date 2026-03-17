# GitHub automation setup

## 1. Create repo
Create a private repository named `f1-insights` under `Jharps-dev`.

## 2. Push bootstrap
```bash
git init
git branch -M main
git remote add origin https://github.com/Jharps-dev/f1-insights.git
git add .
git commit -m "chore: bootstrap monorepo automation scaffold"
git push -u origin main
```

## 3. Create integration branch
```bash
git checkout -b dev
git push -u origin dev
```

## 4. Set branch protection
Protect `main` and require:
- CI / Lint Typecheck Test Build
- Replay Determinism Smoke

## 5. Local prerequisites
- Node 20+
- pnpm 10+
- Git
- GitHub CLI (`gh`)
- PowerShell 7+

## 6. Authenticate GitHub CLI
```bash
gh auth login
```

## 7. Daily flow
- work on `feature/*`
- run `pwsh ./tools/release/ship.ps1 -TargetBranch dev`
- review PR
- merge to `dev`
- stabilize
- release from `main`
