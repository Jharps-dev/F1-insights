# Batch Mode Working Agreement

## Principle
Work in batches that complete coherent slices of architecture.

## Per-batch output
Every batch should produce:
- code
- docs
- tests or test placeholders with explicit TODOs
- a completion summary
- next batch recommendation

## Batch completion review format
- what changed
- what stayed stable
- assumptions
- risks
- next steps

## Stop conditions
Pause batch escalation if:
- contracts are ambiguous
- provider assumptions drift
- replay and live models diverge
- tests reveal architectural coupling
