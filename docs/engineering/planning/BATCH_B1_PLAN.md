# Batch B1 — Core Spine

## Goal
Build the minimum serious spine of the F1 Insights system so every later feature lands on clean contracts instead of sludge.

## Included Tasks
- T2.1 Create web app shell
- T2.2 Add navigation layout
- T3.1 Define canonical event envelope
- T3.2 Define projection contracts
- T3.3 Define WebSocket contract
- T4.1 Define replay event log format
- T5.4 Add provider adapter abstraction
- T6.1 Define REST surface
- T6.2 Define WebSocket subscription surface
- T8.1 Add structured log schema

## Execution Order
1. Shared contracts
2. Replay/provider contracts
3. Gateway contracts
4. Frontend shell
5. Logging contract
6. Validation pass

## Expected Outputs
- `packages/schemas/*`
- `services/api-gateway/*`
- `services/replay-orchestrator/*`
- `services/ingest-openf1/*`
- `apps/web/*`
- docs updates

## Risks
- UI gets ahead of contracts
- provider payload leaks into app layer
- replay shape not aligned with live transport shape

## Guardrails
- no provider-specific fields outside adapters
- no UI consuming raw ingest payloads
- every contract gets a schema/type home
