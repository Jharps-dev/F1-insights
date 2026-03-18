# Circuit Layout Strategy

## Problem

The current product has three different circuit needs:

1. archive cards need a stable circuit preview
2. replay/live pages need a stable track outline
3. replay/live maps need accurate car placement on top of that outline

These are not the same problem.

The current implementation mixes them together by trying to build everything from an on-demand OpenF1 location fetch per session. That is fragile.

## Verified source options

### 1. Local cached layouts from imported sessions

Current repo already contains many cached layout files in `data/layout_v2_<session>.json`.

Strengths:
- already in our workspace
- derived from OpenF1 location traces
- good for replay and archive previews
- no extra network call once cached

Limitations:
- coverage is session-dependent, not circuit-dependent
- if a specific session has no cache, cards/replay can fail unless we reuse another session from the same circuit
- does not solve accurate live car placement by itself

### 2. OpenF1 location data

Current backend already uses OpenF1 historical location data indirectly through:
- `GET /v1/location?session_key=<id>&driver_number=<n>`

Use case:
- derive a session-specific circuit trace from a real lap
- build exact per-car XY placement if location is ingested continuously

Strengths:
- most accurate source for car positions relative to the current session
- ideal for replay and live when available

Limitations:
- network dependency
- availability can vary by session/driver/topic
- not currently stored in canonical replay events
- current live ingest does not subscribe to location updates

### 3. Verified static circuit asset library

Verified public source:
- `julesr0y/f1-circuits-svg`

What it provides:
- SVG layouts for F1 circuits and layout evolutions
- `circuits.json` metadata with circuit ids, lat/lon, and season-to-layout mapping
- license reported by GitHub API: `CC-BY-4.0`

Why this is useful:
- best stable base outline for archive cards and page-level circuit rendering
- includes season/layout evolution mapping, which matters for historical accuracy
- removes reliance on ad hoc OpenF1 fetches for the base track shape

What it does not provide:
- per-car live position data
- direct alignment to our session timeline without mapping logic

## Recommended product model

### A. Separate base geometry from live car positions

Base geometry:
- use a canonical circuit outline asset per circuit/layout/year

Car positions:
- use session location data when available
- otherwise clearly mark car placement as approximate

This separation is mandatory if we want stable cards plus accurate maps.

### B. Fallback order for circuit outlines

Recommended backend fallback order:

1. session-specific cached layout in `data/layout_v2_<session>.json`
2. any cached layout from another imported session at the same circuit
3. canonical static circuit asset matched by circuit/year
4. generated fallback shape only as last resort, clearly labelled approximate

### C. Accurate replay/live car placement

To make the moving cars truly correct, we should add canonical location support:

1. add a `location` canonical event kind with `x`, `y`, optional `z`, and driver/session context
2. import historical OpenF1 location rows into replay datasets
3. subscribe to live OpenF1 location topic if available in the live feed
4. build driver dots from location events instead of lap-gap interpolation

Without this, the current dots are only a heuristic based on lap time and gap.

## Immediate implementation plan

### Phase 1 — stability now

- reuse circuit layouts from any locally imported session at the same circuit
- stop failing cards/replay maps when one session lacks a direct cache
- keep current driver-dot approximation, but only as a temporary overlay

### Phase 2 — canonical circuit assets

- vendor a curated subset of static circuit SVG/path data into the repo
- create a circuit mapping table from our `circuit_short_name` + `year` to canonical asset ids
- use those assets for archive cards and as the default map outline in replay/live

### Phase 3 — true positional accuracy

- extend schema and ingest pipelines with `location` events
- persist historical location during import
- subscribe to live location updates
- drive replay/live car dots from actual coordinates

## Current conclusion

For stable product behavior:
- archive cards and track outlines should use circuit-level assets or shared cached layouts

For true accuracy:
- car placement requires canonical location ingestion

Anything else will continue to be visually impressive but structurally unreliable.