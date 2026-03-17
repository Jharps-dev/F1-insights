# Task Execution Protocol (Beast Mode)

## Required steps for every meaningful task
1. Read the exact files most relevant to the change first.
2. State goal, boundary, invariants, and files in/out of scope.
3. State assumptions, unknowns, and likely breakpoints.
4. Implement the smallest coherent vertical slice.
5. Validate and label exactly what ran:
   - linted / not linted
   - typechecked / not typechecked
   - unit tested / not unit tested
   - integration tested / not integration tested
   - replay validated / not replay validated
6. Use the beast-mode handoff format.

## Stop conditions
Stop and surface the issue if:
- schemas are ambiguous
- provider payloads do not fit canonical contracts
- replay and live paths diverge
- the task requires boundary-breaking changes
- evidence contradicts the intended implementation
