# VS Code AI Usage Guide (Beast Mode v2)

## Preferred prompt structure

1. Goal
2. Boundary
3. Invariants
4. Validation
5. Handoff format

## Example prompt

Implement the timing tower projection builder.

Boundary:
- packages/schemas
- services/stream-processor
- services/api-gateway

Invariants:
- no provider-specific payloads outside adapters
- replay-safe
- deterministic ordering
- degraded source state must remain visible

Validation:
- add unit tests for sort order, interval formatting, and stale state
- if tests are not run, say so explicitly

Handoff:
- files read
- files changed
- files added
- validation run
- assumptions
- risks
- next recommended step

## Anti-pattern prompts to avoid
- “build everything”
- “make it work”
- “improve the repo”
- “add AI”
- “clean up all files”
