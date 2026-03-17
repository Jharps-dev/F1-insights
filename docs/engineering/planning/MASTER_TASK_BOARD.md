# F1 Insights — Master Task Board

## Mission
Build the F1 Insights platform in batch mode with replay-first architecture, enterprise observability, premium UI, and swappable data providers.

## Batch Execution Rules
- Work in vertical slices, not random fragments.
- Complete multiple related tasks per batch.
- Prefer shared contracts before UI wiring.
- Prefer replay-safe plumbing before live-only features.
- Every batch must leave the repo in a cleaner, more testable state.

---

## Task Groups

### T1 — Repository & Architecture Foundation
- [ ] T1.1 Finalize monorepo package boundaries
- [ ] T1.2 Finalize service boundaries and ownership
- [ ] T1.3 Add architecture decision records (ADRs)
- [ ] T1.4 Add env/config contract docs
- [ ] T1.5 Add dependency/versioning policy

### T2 — Frontend App Shell
- [ ] T2.1 Create web app shell
- [ ] T2.2 Add navigation layout
- [ ] T2.3 Add theme/token system
- [ ] T2.4 Add route structure for live/replay/analysis/admin
- [ ] T2.5 Add diagnostics drawer / status bar

### T3 — Shared Contracts & Schemas
- [ ] T3.1 Define canonical event envelope
- [ ] T3.2 Define projection contracts
- [ ] T3.3 Define WebSocket contract
- [ ] T3.4 Define AI insight card schema
- [ ] T3.5 Add validation strategy and examples

### T4 — Replay Backbone
- [ ] T4.1 Define replay event log format
- [ ] T4.2 Build replay clock contract
- [ ] T4.3 Build projection rebuild flow
- [ ] T4.4 Add replay session metadata schema
- [ ] T4.5 Add deterministic replay test harness

### T5 — Data Ingestion Adapters
- [ ] T5.1 Build OpenF1 adapter scaffold
- [ ] T5.2 Build Jolpica adapter scaffold
- [ ] T5.3 Build FIA docs ingestion scaffold
- [ ] T5.4 Add provider adapter abstraction
- [ ] T5.5 Add mapping tests and sample payload fixtures

### T6 — API Gateway & Transport
- [ ] T6.1 Define REST surface
- [ ] T6.2 Define WebSocket subscription surface
- [ ] T6.3 Add health and readiness endpoints
- [ ] T6.4 Add source freshness endpoint
- [ ] T6.5 Add trace propagation contract

### T7 — Timing Tower Vertical Slice
- [ ] T7.1 Build timing tower projection logic
- [ ] T7.2 Add timing tower page in web app
- [ ] T7.3 Add live/replay toggle
- [ ] T7.4 Add stale-source UI handling
- [ ] T7.5 Add tower tests

### T8 — Observability & Debug
- [ ] T8.1 Add structured log schema
- [ ] T8.2 Add OpenTelemetry helper package
- [ ] T8.3 Add debug panel contracts
- [ ] T8.4 Add source health indicators
- [ ] T8.5 Add replay drift reporting

### T9 — AI Layer Scaffold
- [ ] T9.1 Define insight generation pipeline
- [ ] T9.2 Define feature engineering interfaces
- [ ] T9.3 Define anomaly/strategy model contracts
- [ ] T9.4 Add explainability fields
- [ ] T9.5 Add offline evaluation hooks

### T10 — Automation & Quality Gates
- [ ] T10.1 Wire package-level scripts
- [ ] T10.2 Wire CI steps to real tasks
- [ ] T10.3 Add local ship workflow validation
- [ ] T10.4 Add replay regression policy
- [ ] T10.5 Add branch/release quality gates

---

## Batch Plan

### Batch B1 — Core Spine
Focus:
- T2.1
- T2.2
- T3.1
- T3.2
- T3.3
- T4.1
- T5.4
- T6.1
- T6.2
- T8.1

Definition of done:
- repo has a real app shell path
- canonical contracts exist
- replay/event formats exist
- provider adapter contract exists
- transport contract exists
- structured log schema exists

### Batch B2 — First Vertical Slice
Focus:
- T2.3
- T2.4
- T2.5
- T4.2
- T6.3
- T6.4
- T7.1
- T7.2
- T7.3
- T7.4
- T8.3
- T8.4

Definition of done:
- timing tower slice is visible in UI
- replay/live mode surface exists
- health + freshness contracts exist
- stale/degraded states are visible

### Batch B3 — Adapter Wiring & Determinism
Focus:
- T4.3
- T4.4
- T4.5
- T5.1
- T5.2
- T5.5
- T6.5
- T7.5
- T8.5

Definition of done:
- replay harness runs
- adapters map into canonical events
- tower projection tested from replay inputs
- traces can follow event -> projection -> UI

### Batch B4 — Enterprise Hardening
Focus:
- T1.*
- T5.3
- T8.2
- T9.*
- T10.*

Definition of done:
- architecture docs solid
- observability package in place
- AI contracts defined
- CI/automation wired to real checks

---

## Current Active Batch
**B1 — Core Spine**

## Notes
- Avoid touching advanced AI models before the data contracts are stable.
- Avoid live-only shortcuts that bypass replay compatibility.
- Avoid provider-specific payload leakage into app code.
