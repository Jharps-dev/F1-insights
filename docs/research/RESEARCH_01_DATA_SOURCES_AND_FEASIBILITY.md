# F1 Insights Research 01 — Data Sources, Trackers, and Feasibility

## Purpose
This document captures the early research conclusions for building an F1 Insights product with live timing, telemetry-style views, analytics, and AI-assisted interpretation.

## Executive conclusion
A serious F1 analytics app is primarily a:
1. data source and licensing problem
2. real-time systems engineering problem
3. product UX problem

The AI layer only becomes trustworthy after the ingestion, replay, projection, and observability layers are stable.

## Main source categories identified

### 1. Open/community-accessible sources
These are the practical starting point for an MVP and internal development.

#### OpenF1
Best current starting point for:
- live-ish telemetry and timing style data
- laps
- positions / location
- weather
- race control
- radio links
- JSON/CSV access
- authenticated real-time streaming patterns

Why it matters:
- strong enough for a serious prototype
- useful for replay and historical modelling
- close enough to the target product shape

Caveat:
- suitable for development and non-commercial/research-oriented work
- do not assume it is the final commercial live-feed answer

#### Jolpica
Best for:
- historical results
- standings
- schedule-style data
- Ergast-compatible historical access patterns

Why it matters:
- great for season history, stats, and archival context
- useful in “analysis mode” and long-range comparisons

#### FIA official documents
Best for:
- official classifications
- steward decisions
- validation against authoritative event outcomes

Why it matters:
- useful as a truth/verification layer
- ideal for audit trails and post-session validation

### 2. Community live-timing ecosystems
Useful for architecture study and feature inspiration.

These products/projects helped shape the understanding of:
- live timing UI patterns
- timing towers
- driver tracking
- session replay
- delayed-sync viewing
- strategy pages
- race-control feeds
- telemetry overlays

Examples studied conceptually:
- FormulaTimer-style products
- community timing dashboards
- live timing visualisers
- FastF1 ecosystem tooling
- open source community viewers / replayers

### 3. Commercial / licensed data pathways
These appear necessary for true production commercial deployment.

Main conclusion:
- if the goal is a public, monetised, enterprise-grade live product, assume a future move to a licensed data provider or formal rights path

## Core technical conclusions

### A. Build replay-first
Every live feature should also work from recorded event logs.

Why:
- deterministic testing
- debug reproducibility
- CI validation
- no dependency on race-weekend timing for progress
- easier AI backtesting

### B. Define canonical contracts early
Never couple:
- UI components
- analytics logic
- AI logic

directly to raw provider payloads.

All providers should map into:
- canonical event envelopes
- canonical projections
- transport-safe frontend contracts

### C. Treat provider instability as normal
Expect:
- missing topics
- format drift
- delayed updates
- partial event consistency
- field changes over time

System implication:
- adapters isolate weirdness
- replay lets you test breakages
- degraded modes must exist in UI

## Feature opportunities identified

### Live fan features
- timing tower
- gaps and intervals
- tyre age / compound display
- live race control stream
- session health / source freshness
- track map
- telemetry comparison views
- replay scrubbing
- driver favourites

### Analytics opportunities
- stint degradation estimation
- pit window / undercut opportunities
- pace trend analysis
- sector gain/loss analysis
- anomaly detection
- team and driver comparison
- “why this matters” AI cards

### AI opportunities
- insight card generation
- race context summarisation
- anomaly explanation
- stint / pit suggestion framing
- confidence-labelled commentary

## Product conclusion
The system should be built so that:
- Open/community data can power development and MVP flows
- replay and testing work regardless of source
- provider swaps later do not break frontend or analytics contracts

That is the cleanest path to a real product instead of a fragile clone.
