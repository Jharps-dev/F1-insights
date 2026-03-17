# VS Code AI usage guide for this repo

## Best way to use AI here

Use the AI in task-sized vertical slices, not giant prompts.

### Good prompt pattern
- objective
- architectural boundary
- files likely involved
- invariants to protect
- acceptance criteria
- test expectations

### Example
Implement the timing tower projection pipeline.

Constraints:
- use canonical schemas only
- no provider-specific payloads in UI
- output should support live and replay mode
- include stale-source handling
- add unit tests for sorting, interval formatting, and lapped state
- do not modify unrelated packages

Deliver:
- files changed
- explanation
- tests added
- assumptions

## Prompt templates

### Feature build
Implement <feature> in the F1 Insights repo.

Scope:
- packages/services/apps allowed to change: <list>

Rules:
- preserve architecture boundaries
- replay-safe only
- strict typing
- structured logging
- no silent fallbacks

Acceptance criteria:
- <criteria 1>
- <criteria 2>
- <criteria 3>

Testing:
- add unit tests and integration coverage where appropriate

### Refactor
Refactor <area> for maintainability.

Goals:
- reduce coupling
- preserve behaviour
- improve typing
- improve testability
- document risks

Do not:
- change external contracts unless necessary
- degrade observability
- remove useful diagnostics

### Bug hunt
Investigate and fix <bug>.

Need:
- root cause
- affected boundary
- minimal clean fix
- regression tests
- note whether replay tests are needed

### UI task
Implement/update <screen/component>.

Constraints:
- premium motorsport UI
- dark-first
- responsive
- handle degraded data states
- keep render path efficient
- separate state logic from presentation

Testing:
- add UI tests for loading, error, stale, and success states

## Anti-pattern prompts to avoid
- build the whole app
- just make it work
- fix everything
- improve codebase
- add AI

Those prompts produce mush.

Be surgical.
