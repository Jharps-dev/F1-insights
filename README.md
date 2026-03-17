# F1 Insights — Replay-Safe Live Analytics Platform

**Status**: MVP Foundation Complete — Ready for Integration Testing

## 🚀 Quick Start (5 minutes)

### Prerequisites
- Node.js 18+ 
- pnpm 8+ (`npm install -g pnpm`)

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Fetch OpenF1 Session Data
```bash
# Downloads a real 2024 F1 session (events + metadata)
pnpm import:openf1 -- --session 9159 --output ./data

# Expected output:
# ✓ events_9159.jsonl (1000+ telemetry events)
# ✓ manifest_9159.json (session metadata)
```

### 3. Start the API Gateway + WebSocket Server
```bash
pnpm dev:server

# You'll see:
# ╔════════════════════════════════════════╗
# ║     F1 Insights — Replay Server        ║
# ╚════════════════════════════════════════╝
#
#   📡 WebSocket: ws://localhost:3000
#   🌐 HTTP: http://localhost:3000
#   📁 Data: ./data
```

### 4. Start the React Web App (in another terminal)
```bash
pnpm dev:web

# Starts on http://localhost:5173
```

### 5. Open Browser
```
http://localhost:5173
```

You should see:
- ✅ Timing tower (10 drivers, lap times, gaps, stint info)
- ✅ Race control feed (penalties, crashes, safety cars)
- ✅ Playback controls (play/pause, speed 0.5x-8x, seek ±30s)
- ✅ Premium dark theme with glassmorphism

---

## 📊 Architecture

### Packages (TypeScript modules)

| Package | Purpose | Key Exports |
|---------|---------|------------|
| `@f1-insights/schemas` | Canonical event types, state contracts | `CanonicalEvent`, `SessionManifest`, `StateStreamMessage` |
| `@f1-insights/replay-sdk` | Deterministic replay engine | `ReplayClock`, `EventCursor`, `StateBuilder` |

### Services (Backend servers)

| Service | Purpose | Port |
|---------|---------|------|
| `@f1-insights/ingest-openf1` | Fetch OpenF1 REST API, convert to canonical | CLI only |
| `@f1-insights/api-gateway` | WebSocket + HTTP server, ReplayService | 3000 |
| `@f1-insights/replay-orchestrator` | State management, determinism | Embedded in api-gateway |

### Apps (Frontend)

| App | Purpose | Port |
|-----|---------|------|
| `f1-insights-web` | React UI (Vite) | 5173 |

---

## 🎯 What's Implemented

### ✅ Foundation (Complete)
- [x] Canonical schema (13 event kinds: car_data, lap, position, weather, race_control, pit, radio, penalty, result, document, derived)
- [x] Deterministic replay engine with clock/cursor/state-builder
- [x] OpenF1 REST importer with rate limiting + caching
- [x] Replay orchestrator service with WebSocket binding
- [x] React web app with timing tower, race control feed, playback controls
- [x] TypeScript monorepo with strict mode, path aliases

### ⏳ Next Phase (Live Streaming)
- [ ] OpenF1 MQTT/WebSocket live subscription (OAuth2 token flow)
- [ ] Telemetry canvas (ring buffers, decimation, high-frequency rendering)
- [ ] AI analytics (stint pace, undercut detection, anomaly detection, win probability)
- [ ] FIA PDF metadata (sessions, drivers, results)
- [ ] Foundry integration (LLM-based commentary, summarization)

---

## 🔧 Development Commands

```bash
# Build all packages + services
pnpm build

# Type-check all files
pnpm typecheck

# Run API + WebSocket smoke test (starts gateway automatically)
pnpm test:smoke:api

# Run smoke test against an already-running gateway
pnpm test:smoke:api:against

# Start API Gateway server (ws://localhost:3000)
pnpm dev:server

# Start React dev server (http://localhost:5173)
pnpm dev:web

# Fetch OpenF1 session data
pnpm import:openf1 -- --session <sessionKey> --output <dir>

# Examples:
pnpm import:openf1 -- --session 9159 --output ./data    # 2024 Abu Dhabi
pnpm import:openf1 -- --session 9160 --output ./data    # 2024 Saudi Arabia
pnpm import:openf1 -- --session 9120 --output ./data    # 2023 Abu Dhabi
```

### API + WS Smoke Test

The smoke test validates core HTTP endpoints and replay WebSocket controls (`load_session`, `play`, `pause`, `seek`, `speed`) and prints a JSON pass/fail summary.

```bash
# Recommended local flow (auto-starts and auto-stops gateway)
pnpm test:smoke:api

# Use when the gateway is already running
pnpm test:smoke:api:against
```

Optional environment variables:
- `SMOKE_HTTP_BASE` (default `http://localhost:3000`)
- `SMOKE_WS_URL` (default `ws://localhost:3000`)
- `SMOKE_SESSION_KEY` (default `9465`)
- `SMOKE_REQUEST_TIMEOUT_MS` (default `20000`)
- `SMOKE_WS_TIMEOUT_MS` (default `25000`)

---

## 📡 WebSocket API

**Connect**: `ws://localhost:3000/`

**Messages from Client** (JSON):
```json
{
  "op": "load_session",
  "sessionKey": "9159"
}
{
  "op": "play",
  "tickRateHz": 10
}
{
  "op": "pause"
}
{
  "op": "seek",
  "replayTimeMs": 3600000
}
{
  "op": "speed",
  "speed": 2.0
}
```

**Messages from Server** (JSON):
```json
{
  "type": "state_delta",
  "sequence_id": 1,
  "replay_time_ms": 1000,
  "wall_time_utc": "2024-01-21T10:30:00Z",
  "payload": {
    "tower": {
      "drivers": [
        {
          "position": 1,
          "driver_number": 1,
          "name": "Max Verstappen",
          "team": "RED BULL",
          "current_lap": 42,
          "current_lap_time": "1:23.456",
          "best_lap_time": "1:22.789",
          "gap_to_leader": "0.000",
          "interval": "0.000",
          "tyre_compound": "HARD",
          "tyre_age_laps": 15,
          "pit_stops": 1,
          "status": "RUNNING"
        }
      ]
    },
    "race_control": [
      {
        "timestamp": "2024-01-21T10:25:00Z",
        "message": "SAFETY CAR DEPLOYED",
        "severity": "HIGH"
      }
    ]
  },
  "queue_depth": 0,
  "recommended_fps": 60
}
```

---

## 🎨 UI Components

### Timing Tower
Displays all drivers in real-time with:
- Position, driver number, team
- Current lap time, best lap time
- Gap to leader, interval to car ahead
- Tyre compound and age (laps)
- Pit stops, status (RUNNING, RETIRED, PITTED)
- Sortable and selectable

### Race Control Feed
Real-time race events:
- Safety car deployments
- Crashes, retirements
- Penalties, disqualifications
- Weather changes
- FIA-issued notices

### Playback Controls
- Play/pause
- Speed adjustment (0.5x, 1x, 2x, 4x, 8x)
- Seek backward/forward (±30s)
- Current time display

---

## 🛡️ Licensing & Attribution

**F1 Insights** uses data from **OpenF1** — an unofficial, community-maintained F1 telemetry and data source.

**License**: CC BY-NC-SA 4.0 (Non-Commercial, Share-Alike)
- ✅ You can view, replay, and analyze F1 races
- ❌ You cannot commercialize or redistribute without attribution
- ⚠️ This is a fan project; F1 data belongs to Formula 1 Management

**Attribution**: Data sourced from [OpenF1](https://openf1.org)

---

## 🐛 Troubleshooting

### "Cannot find module '@f1-insights/...'"
```bash
# Make sure all packages are installed:
pnpm install

# Then rebuild:
pnpm build

# Or clean + reinstall:
pnpm clean
rm -rf node_modules
pnpm install
```

### WebSocket connection fails
```bash
# Check server is running:
curl http://localhost:3000/health

# Expected:
# {"status":"ok","dataDir":"./data"}

# Check firewall/ports:
netstat -an | grep 3000
```

### No data after loading session
```bash
# Verify session file exists:
ls -la ./data/events_9159.jsonl

# Check event count:
wc -l ./data/events_9159.jsonl

# Expected: 1000+ lines
```

### Build errors with TypeScript
```bash
# Verify tsconfig.json is correct:
cat tsconfig.base.json

# Clean and rebuild:
pnpm clean
pnpm install
pnpm build
```

---

## 📚 Project Structure

```
F1-insights/
├── packages/
│   ├── schemas/              # CanonicalEvent, SessionManifest types
│   │   └── src/canonical.ts  # 250 lines: event types + state contracts
│   └── replay-sdk/           # ReplayClock, EventCursor, StateBuilder
│       └── src/engine.ts     # 450 lines: deterministic replay engine
├── services/
│   ├── ingest-openf1/        # OpenF1 REST importer + caching
│   │   └── src/
│   │       ├── importer.ts   # Fetch, convert, cache logic
│   │       └── cli.ts        # CLI: --session, --output
│   ├── replay-orchestrator/  # ReplayService + WebSocket binding
│   │   └── src/service.ts    # 300 lines: state management
│   └── api-gateway/          # Express + WebSocket server
│       └── src/server.ts     # 150 lines: HTTP + WS handler
├── apps/
│   └── f1-insights-web/      # React + Vite frontend
│       ├── src/
│       │   ├── App.tsx       # 400 lines: timing tower + controls
│       │   └── styles.css    # 250 lines: design system
│       ├── vite.config.ts
│       └── package.json
├── tools/
│   └── release/              # CI/CD scripts (ship.ps1, release.ps1)
├── docs/                     # Research, architecture, AI docs
└── package.json              # Root monorepo config
```

---

## 🚦 Next Steps

### Phase 2: Live Streaming
1. Implement OpenF1 MQTT subscription (OAuth2 token flow)
2. Create live event broadcaster
3. Connect web app to live WebSocket stream

### Phase 3: AI Analytics
1. Stint pace modeling (lap time trends)
2. Undercut detection heuristics
3. Anomaly detection (z-score telemetry deviations)
4. Win probability Bayesian updating
5. LLM commentary summarization

### Phase 4: UI Enhancements
1. Telemetry canvas (high-frequency trace visualization)
2. Pit strategy analyzer
3. Head-to-head driver comparison
4. Historical race trends

### Phase 5: Hardening
1. Security review (CSP, token handling, CORS)
2. Performance tuning (RAIL budgets, accessibility)
3. Error observability (structured logging, tracing)
4. Desktop packaging (Tauri optional)

---

## 📞 Questions?

Refer to:
- `.github/copilot-instructions.md` — AI coding guidelines
- `docs/` — Research, architecture, and design docs
- `MASTER_HANDOVER_NOTES.md` — Session context and decisions

---

**F1 Insights** © 2024 | MIT License (for non-data code) | CC BY-NC-SA 4.0 (for data attribution)
