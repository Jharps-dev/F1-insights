# F1 Insights Research 02 — Implementation Architecture and Live Analytics

## Purpose
This document captures the implementation-level research direction for building a live analytics platform inspired by existing F1 timing/analysis products, but designed to be more fan-centric and more enterprise-grade.

## Core architecture decision
Build the platform in three modes:

### 1. Historical Mode
Used for:
- backtesting
- analytics experiments
- season comparisons
- AI training/evaluation
- regression validation

### 2. Replay Mode
Used for:
- product development
- deterministic debugging
- CI validation
- demo sessions
- recreating race scenarios

### 3. Live Mode
Used for:
- race weekend usage
- streamed projections
- real-time UI updates
- AI insight cards
- operational monitoring

The key design principle:
all three modes should converge on the same downstream contracts.

## Recommended stack direction

### Frontend
Web-first premium app:
- React
- TypeScript
- app-shell architecture
- real-time subscriptions
- data-dense F1 UI
- possible later desktop wrapper

### Backend / services
Service-oriented monorepo or modular multi-package repo:
- API gateway
- provider ingestion services
- stream processor
- replay orchestrator
- AI insights service
- observability package
- shared schema package

### Storage / state
Use layered storage/state:
- raw event log
- online projection state
- time-series / analytics persistence
- replay metadata
- artifact storage for fixtures and logs

## Live analytics architecture

### Recommended flow
Provider -> Ingestion Adapter -> Canonical Event Bus -> Projection Builders -> API/WebSocket Gateway -> UI

### Why this matters
This creates:
- source independence
- replay compatibility
- testability
- observability
- ability to add AI and analytics later without rewriting the ingest layer

## Analytics layers identified

### Tier 1 — deterministic streaming analytics
These should be built early:
- timing tower projection
- interval calculation / formatting
- lap state and sector state
- tyre stint state
- stale source detection
- race control timeline

### Tier 2 — explainable analytics
Build after projections are stable:
- stint trend estimators
- pace residuals
- pit window scoring
- sector opportunity analysis
- teammate comparison
- performance anomaly flags

### Tier 3 — AI reasoning surfaces
Only after the first two tiers are solid:
- insight cards
- race narrative summaries
- confidence-scored recommendations
- scenario comparison commentary

## Main UI conclusions

### Products studied conceptually
The research direction was shaped by timing/analytics products that emphasise:
- precise timing tower presentation
- track map visibility
- gaps and intervals
- live/replay mode
- telemetry-style charts
- strategy and stint views
- race-control/event feeds

### Our UI should do better by focusing on:
- fan obsession and race understanding
- richer analytics context
- premium control-room design
- better replay and debugging experience
- stronger degraded-state communication
- better explainability for “why this matters”

## Enterprise-grade requirements identified

### Observability
Must exist from day one:
- structured logs
- source freshness monitoring
- event tracing
- projection latency measurement
- websocket delivery metrics
- replay drift reporting
- frontend diagnostics

### Testing
Must include:
- unit tests
- integration tests
- replay determinism tests
- UI state tests
- load tests
- degraded-source tests
- chaos/fault injection tests

### Governance
Should include:
- branch protections
- CI gates
- release automation
- artifact capture
- changelog/release notes discipline
- environment validation scripts

## Main implementation strategy
Do not try to build “all of FormulaTimer plus AI plus production infra” in one leap.

Instead:

### Batch B1 — Core Spine
- schemas
- provider contracts
- replay event format
- gateway contracts
- web app shell
- structured logging contract

### Batch B2 — First vertical slice
- timing tower page
- live/replay toggle
- health/freshness contracts
- diagnostics drawer
- stale/degraded UI

### Batch B3 — Adapter wiring and determinism
- OpenF1 adapter scaffold
- Jolpica scaffold
- replay harness
- projection tests
- trace propagation

### Batch B4 — enterprise hardening
- CI wiring
- observability helpers
- AI contract definitions
- policy docs
- release discipline

## Final conclusion
The optimal execution route is:
1. build the platform spine
2. prove replay + timing tower
3. wire source adapters
4. add analytics and AI
5. harden for enterprise behaviour
6. only then worry about broader live-scale polish

This avoids building a gorgeous but structurally haunted race dashboard.
