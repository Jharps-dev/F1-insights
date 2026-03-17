# F1 Insights Master Instructions

This file is the canonical instruction source for AI-assisted coding in this repository.

## Scope and precedence
- Use this file as the single source of truth for coding behavior.
- Legacy guidance under `docs/ai/instructions/beast-mode-v2/` is reference material.
- If instructions conflict, this file wins.

## Mission
Build and maintain an enterprise-grade F1 analytics platform that is:
- replay-safe
- deterministic
- strongly typed
- observable
- modular
- testable
- premium and fan-centric in UI

## Non-negotiables
1. Respect repository and package/service boundaries.
2. Do not bypass canonical schemas or provider adapters.
3. Do not leak provider-specific payloads into app/UI contracts.
4. No silent fallbacks; failures must be explicit and diagnosable.
5. Prefer deterministic behavior over clever shortcuts.
6. Keep changes modular and reviewable.
7. Add tests for non-trivial behavior or state why tests are pending.
8. For AI features, include rationale, confidence band, and source context.
9. State tradeoffs and risks explicitly.
10. Never claim validation you did not run.

## Required workflow for meaningful tasks
1. Read relevant files first.
2. State goal, boundary, invariants, and assumptions.
3. Identify impacted contracts and exact files in scope.
4. Implement the smallest coherent vertical slice.
5. Validate and report exactly what ran:
	 - lint
	 - typecheck
	 - unit tests
	 - integration tests
	 - replay validation
6. Provide a handoff summary with risks and next step.

## Stop conditions
Pause and surface the issue if:
- contracts or schemas are ambiguous
- provider data cannot be mapped cleanly to canonical contracts
- replay/live paths diverge in incompatible ways
- requested work requires boundary-breaking changes not approved by scope

## Architecture and implementation rules
- Contract-first order when relevant:
	1) canonical schema
	2) projection schema
	3) transport/API contract
	4) service/backend logic
	5) UI wiring
	6) tests
	7) docs/runbooks
- Preserve public interfaces unless breakage is explicitly part of the task.
- Prefer extending existing structure over broad rewrites.
- Keep business logic out of presentation-only UI components.

## Observability and failure behavior
- Do not swallow exceptions.
- Use structured, contextual logging on critical paths.
- Make degraded or stale-source states visible when user-impacting.
- Keep major flows traceable: source -> event -> projection -> API -> UI.

## AI insight guardrails
- Never present speculation as race fact.
- Every insight should include:
	- timestamp
	- target entity
	- source context
	- rationale
	- confidence/certainty band
- Label insight type clearly:
	- rule-based inference
	- model-based prediction
	- uncertain hypothesis

## Delivery and handoff format
For substantial work, include:
- files read
- files changed
- files added
- what changed
- what stayed stable
- validation run (actual commands/status)
- assumptions
- risks
- next recommended step

## Decision priority
correctness > architecture > traceability > testability > maintainability > performance > polish > speed
