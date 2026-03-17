# F1 Insights Research 03 — UI/UX and Product Positioning

## Product positioning
This product should not feel like:
- a plain stats site
- a generic admin dashboard
- a cloned timing page with different colours

It should feel like:
- a premium motorsport command center
- a live race engineering companion for fans
- a system that helps users understand what is happening, not just see numbers

## Design intent
Keywords:
- premium
- dark-first
- high-contrast
- telemetry-native
- information dense
- calm under pressure
- controllable
- replayable
- explainable

## Primary screen recommendations

### 1. Live Control Room
Main page for race weekend use.
Contains:
- timing tower
- track map
- race control feed
- source health
- AI insight cards
- quick driver filters
- top-line tyre/stint signals

### 2. Driver Inspector
Focused detail view:
- telemetry overlays
- lap traces
- pace trend
- sector decomposition
- compare to rival / teammate

### 3. Strategy Lab
Analytical workspace:
- stint trend lines
- pit windows
- undercut / overcut scenarios
- pace-normalised comparisons
- risk flags

### 4. Replay Studio
Built for:
- debugging
- post-race review
- training and demos
- jumping to incidents
- recreating narratives

### 5. Diagnostics / Operations
Internal but valuable:
- source freshness
- adapter health
- event throughput
- replay drift
- stale topic warnings
- contract/version markers

## UX principles

### Progressive disclosure
Show:
- immediate race state first
- deeper analytics when requested
- expert power without overwhelming the main live screen

### Graceful degradation
If telemetry or timing sources degrade:
- say so clearly
- retain usable functionality
- badge reduced-fidelity states
- avoid misleading confidence

### Fan-centric interpretation
The UI should constantly answer:
- who is gaining?
- who is losing?
- why?
- what changed?
- what is likely next?

### Customisation
Useful enhancements:
- favourite drivers
- custom columns
- layout presets
- compact vs expanded modes
- replay speed and delay controls

## Frontend architecture conclusions
The app should be organised around:
- app shell
- route-driven feature areas
- shared state hooks
- provider-agnostic data contracts
- data visualisation primitives
- diagnostics surfaces

Do not bury business logic in presentation components.

## Testing conclusions for UI
The UI requires:
- success state tests
- empty state tests
- stale-data state tests
- partial data tests
- websocket reconnect behaviour tests
- visual regression tests for key layouts

## Product conclusion
The UI should combine:
- the excitement of live F1
- the depth of engineering telemetry
- the trust signals of enterprise software
- the clarity of an explainable analytics platform
