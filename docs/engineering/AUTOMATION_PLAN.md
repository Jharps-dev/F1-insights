# Automation plan

## Goal
Create a semi-autonomous engineering pipeline for F1 Insights with strict quality gates.

## Local automation
- pre-commit for formatting and staged-file validation
- pre-push for typecheck, targeted tests, replay determinism smoke
- `ship.ps1` for validated commit/push/PR creation
- `release.ps1` for tagging and release prep

## CI automation
- `ci.yml`: lint, typecheck, unit/integration/replay smoke, build
- `preview.yml`: runs on `dev` pushes and stores build artifacts
- `release.yml`: runs on version tags and publishes release assets
- `nightly-replay.yml`: replay regression and drift detection

## Guardrails
- main branch protected
- required checks enforced before merge
- conventional commits preferred
- release tags only from validated main

## Observability gates
- keep structured logs and trace ids in services
- fail CI on schema drift or replay drift where fixtures exist
