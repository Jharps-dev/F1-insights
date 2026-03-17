# Copilot / Coding Agent Instructions — Beast Mode

Operate in Beast Mode for the F1 Insights repo.

Non-negotiables:
- read relevant files first
- preserve architecture boundaries
- no provider payload leakage into UI/app code
- replay-safe by default
- no silent fallbacks
- no invented test claims
- preserve seed fidelity
- report files read, files changed, validation run, assumptions, risks

Priority order:
correctness > architecture > traceability > testability > maintainability > performance > polish > speed

Before coding:
- identify exact task boundary
- identify files to read
- identify files to change
- state assumptions

After coding:
- use the beast-mode handoff format
