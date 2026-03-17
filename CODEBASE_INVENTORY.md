# F1 Insights — MVP Codebase Inventory

**Status**: Foundation Complete | 16 files created | ~2,500 lines of production code

---

## 📦 Packages & Services Overview

| Component | Type | Purpose | Files | LOC |
|-----------|------|---------|-------|-----|
| `@f1-insights/schemas` | Package | Canonical event types + state contracts | 1 src + config | 250 |
| `@f1-insights/replay-sdk` | Package | Deterministic replay engine (clock/cursor/state) | 1 src + config | 450 |
| `@f1-insights/ingest-openf1` | Service | OpenF1 REST importer with caching + rate limiting | 2 src + config | 350 |
| `@f1-insights/replay-orchestrator` | Service | State management, subscriber fan-out, WebSocket binding | 1 src + config | 300 |
| `@f1-insights/api-gateway` | Service | Express + WebSocket server, HTTP routes | 1 src + config | 150 |
| `f1-insights-web` | App | React + Vite web frontend, timing tower, controls | 3 src + config | 650 |
| **Root** | Config | Monorepo config, TypeScript base | 1 + 1 | — |

**Total**: 16 files | ~2,500 lines of production-grade TypeScript/React

---

## 🗂️ File-by-File Breakdown

### Tier 1: Core Schemas (Type Definitions)

#### `packages/schemas/src/canonical.ts` (250 lines)
**Purpose**: Single source of truth for all event types and state contracts

**Exports**:
- `CanonicalEvent` — Discriminated union on `kind` field
  - `car_data` (CarDataPayload) — Telemetry: position, velocity, throttle, brake, etc.
  - `lap` (LapPayload) — Lap complete: lap number, duration, compound, tyre age
  - `position` (PositionPayload) — Position change: driver, new position
  - `weather` (WeatherPayload) — Track weather: temperature, rainfall, wind
  - `race_control` (RaceControlPayload) — FIA message: safety car, VSC, red flag
  - `pit` (PitPayload) — Pit stop: duration, tyre compound change
  - `radio` (RadioPayload) — Radio message: pit engineer → driver
  - `penalty` (PenaltyPayload) — Penalty: type, reason, time added
  - `result` (ResultPayload) — Race result: position, points, status
  - `document` (DocumentPayload) — Metadata: session info, rules, classifications
  - `derived` (DerivedPayload) — Computed values: delta, gap, pace
  - Other kinds: `unknown` for future extensibility

- `SessionManifest` — Dataset metadata
  - `session_key`, `session_name`, `session_type`, `date`
  - `circuit`, `country`, `drivers` (with numbers, names, teams)
  - `files` (references to event log, telemetry index, etc.)
  - `source_priority` (OpenF1, Jolpica, FastF1)
  - `schema_version`, `created_at`

- `StateStreamMessage` — WebSocket protocol contract
  - `type` ('state_delta'), `sequence_id`, `replay_time_ms`, `wall_time_utc`
  - `payload` with `tower` (TowerState) and `race_control` (RaceControlMessage[])
  - `queue_depth` (subscriber backpressure metric)
  - `recommended_fps` (UI hint)

- `TowerState` — Timing tower data
  - `drivers` array with position, driver #, name, team, lap times, gaps, tyres, pit stops, status

- `RaceControlMessage` — Race event
  - `timestamp`, `message`, `severity` ('INFO', 'WARNING', 'CRITICAL')

- `DeterminismCheckpoint` — For replay verification
  - `checkpoint_id`, `replay_time_ms`, `state_hash` (SHA256)

**Key Design**:
- All events are append-only
- Time-addressed (via `timestamp` field)
- Source-agnostic (maps from OpenF1 → canonical)
- Strongly typed with discriminated union pattern
- Extensible (unknown kind for future events)

---

### Tier 2: Replay Engine (Deterministic State Machine)

#### `packages/replay-sdk/src/engine.ts` (450 lines)
**Purpose**: Implement replay clock, event pagination, and deterministic state projection

**Classes**:

**1. ReplayClock** (150 lines)
- Manages wall-clock ↔ replay-time mapping
- **State**: isPlaying, currentSpeed, currentReplayTimeMs, wallClockStartMs
- **Methods**:
  - `play()` — Start playback
  - `pause()` — Stop playback
  - `setSpeed(speed: number)` — Set multiplier (0.5x-8x)
  - `seekTo(replayTimeMs: number)` — Jump to specific time
  - `getCurrentReplayTime(): number` — Current replay time aligned to events
  - `tick(deltaMs: number): number` — Advance clock, return current time
- **Internal**:
  - `wallClockToReplayTime(wallMs)` — Convert wall time to replay time considering speed
  - Uses `performance.now()` for high-resolution timing

**2. EventCursor** (150 lines)
- Binary search-based pagination through sorted events
- **State**: events[], currentIndex, currentTimeMs
- **Methods**:
  - `seekToTime(replayTimeMs): CanonicalEvent[]` — Find all events up to given time
  - `getNextBatch(count: number): CanonicalEvent[]` — Pagination support
  - `reset()` — Clear state
  - `getCurrentIndex(): number` — Position in event stream
- **Internal**:
  - `binarySearch(timestamp: number): number` — O(log n) lookup
  - `filterByTime(replayTimeMs)` — Return sorted slice of events

**3. StateBuilder** (150 lines)
- Stateful accumulation of events into tower state
- **State**: driverStates (Map), rcMessages (RaceControlMessage[]), telemetryBuffers
- **Methods**:
  - `processEvents(events: CanonicalEvent[]): void` — Consume events, update state
  - `buildTowerState(): TowerState` — Current snapshot (drivers array, sorted)
  - `getRaceControlMessages(): RaceControlMessage[]` — All RC events so far
  - `reset()` — Clear all state
  - `getStateHash(): string` — SHA256 of entire state (for determinism verification)
- **Internal**:
  - `updateDriverState(event: LapPayload | CarDataPayload)` — Process telemetry
  - `updateRaceControl(event: RaceControlPayload)` — Aggregate RC messages
  - `computeGaps(driverStates)` — Calculate gaps to leader
  - `sortByPosition(drivers)` — Return drivers sorted 1-20

**Key Design**:
- Idempotent: `processEvents(events)` twice = same state
- Deterministic: SHA256 hash of state is reproducible
- Incremental: accumulates events linearly (no backtracking)
- Stateful: maintains driver positions, lap times, tyres, penalties

---

### Tier 3: Data Ingest (OpenF1 REST Client)

#### `services/ingest-openf1/src/importer.ts` (300 lines)
**Purpose**: Fetch from OpenF1 REST API, handle network resilience, convert to canonical, write JSONL

**Functions**:

**1. fetchWithBackoff** (60 lines)
```typescript
async fetchWithBackoff(
  url: string,
  options?: { timeout?: number; maxRetries?: number }
): Promise<Response>
```
- Exponential backoff: 100ms → 200ms → 400ms → 800ms → 1600ms
- Jitter: ±20% to prevent thundering herd
- 429 handling: respects `Retry-After` header
- 5xx retry: up to 5 attempts
- Timeout: defaults to 20 seconds per request
- Returns Response object or throws after all retries exhausted

**2. fetchCached** (80 lines)
```typescript
async fetchCached(
  url: string,
  cache: string = './cache'
): Promise<any>
```
- SHA256 hash of URL → filename
- Checks cache directory first (load if exists)
- Falls back to network fetch if not cached
- Writes response to cache for next time
- Saves bandwidth, improves reliability

**3. importOpenF1Session** (100 lines)
```typescript
async importOpenF1Session(
  sessionKey: number,
  outputDir: string = './data'
): Promise<{ events: CanonicalEvent[], manifest: SessionManifest }>
```
- Fetches from OpenF1 API:
  - `car_data`: 3.7 Hz telemetry (throttle, brake, DRS, etc.)
  - `laps`: lap times, compounds, pit stops
  - `intervals`: gaps to leader, gap to next car
  - `weather`: ambient, track temp, rainfall, wind
  - `race_control`: FIA messages (safety car, VSC, red flag, etc.)
  - `drivers`, `team_radios`, `pit_stops` (optional)
- Converts rows to canonical CanonicalEvent entries
- Returns JSONL-formatted events and SessionManifest
- Writes to `${outputDir}/events_${sessionKey}.jsonl` and `manifest_${sessionKey}.json`

**4. listOpenF1Sessions** (30 lines)
```typescript
async listOpenF1Sessions(year?: number): Promise<SessionInfo[]>
```
- Queries OpenF1 API for available sessions
- Filters by year (optional)
- Returns session keys, names, dates

**Key Design**:
- Network failure recovery: exponential backoff + retries
- Caching: avoid redundant API calls
- Canonical conversion: map OpenF1 rows → CanonicalEvent
- Rate-limit aware: respects 429 responses
- CLI-friendly: async/await, structured logging

---

#### `services/ingest-openf1/src/cli.ts` (55 lines)
**Purpose**: Command-line interface for fetching sessions

```bash
$ npx tsx cli.ts --session 9159 --output ./data
```

**Arguments**:
- `--session <key>` — Session key from OpenF1 API
- `--output <path>` — Directory to write JSONL + manifest

**Actions**:
1. Parses command-line args
2. Calls `importOpenF1Session()`
3. Writes events_${key}.jsonl (JSONL format, 1 event per line)
4. Writes manifest_${key}.json (session metadata + file references)
5. Logs event count and file paths

---

### Tier 4: State Management (Replay Orchestrator)

#### `services/replay-orchestrator/src/service.ts` (300 lines)
**Purpose**: Manage ReplayService state, tick-driven updates, subscriber fan-out, WebSocket binding

**Class: ReplayService** (extends EventEmitter)

**State**:
- `clock: ReplayClock` — Timing control
- `cursor: EventCursor` — Event pagination
- `stateBuilder: StateBuilder` — State projection
- `manifest: SessionManifest` — Current session metadata
- `subscribers: Set<(msg: StateStreamMessage) => void>` — Broadcast targets
- `sequenceId: number` — Increment for each message
- `isPlaying: boolean` — Playback state
- `currentSpeed: number` — Speed multiplier

**Constructor**:
```typescript
constructor(config: { dataDir: string; port?: number })
```

**Methods**:

**1. loadSession(sessionKey: number)**
- Reads `${dataDir}/manifest_${sessionKey}.json` and `events_${sessionKey}.jsonl`
- Parses JSON manifest + JSONL events
- Initializes EventCursor and StateBuilder
- Emits 'session-loaded' event with event count

**2. start(tickRateHz: number = 10)**
- Starts playback clock
- Sets interval to call `tick()` at specified Hz (default 10 Hz = 100ms per tick)
- Broadcasts state deltas to all subscribers

**3. pause()**
- Pauses replay clock
- Stops ticking (interval remains live for resume)

**4. setSpeed(speed: number)**
- Updates clock speed (0.5x-8x)
- Next tick reflects new speed

**5. seek(replayTimeMs: number)**
- Jumps clock to time
- Resets state builder
- Seeks event cursor to time
- Reprocesses events up to time
- Broadcasts new state

**6. subscribe(callback: (msg: StateStreamMessage) => void): () => void**
- Adds callback to subscribers set
- Returns unsubscribe function
- Next tick broadcasts to all subscribers

**7. tick() [private]**
- Called at interval (e.g., every 100ms if tickRateHz=10)
- Gets current replay time from clock
- Builds tower state from state builder
- Gathers race control messages
- Creates StateStreamMessage with:
  - `type: 'state_delta'`
  - `sequence_id` (incremented)
  - `replay_time_ms` (current time)
  - `wall_time_utc` (ISO timestamp)
  - `payload.tower` (TowerState)
  - `payload.race_control` (last 10 messages)
- Sends to all subscribers (error-tolerant: removes erroring subscribers)

**8. verifyDeterminism(): Promise<boolean>**
- Hashes state at current time
- Resets and replays all events
- Hashes state again
- Compares hashes (must match)
- Logs ✓ DETERMINISTIC or ✗ MISMATCH

**9. getStatus()**
```typescript
{
  manifest: SessionManifest,
  clock: { isPlaying, currentSpeed, currentTime },
  subscribers: number
}
```

**10. stop()**
- Clears tick interval
- Pauses clock
- Logs shutdown

**Helper: bindReplayToWebSocket**
```typescript
export function bindReplayToWebSocket(
  service: ReplayService,
  onMessage: (msg: StateStreamMessage) => void
): (msg: WebSocketMessage) => void
```
- Returns function that handles WebSocket messages
- Supports `op`: 'play', 'pause', 'seek', 'speed', 'subscribe'
- Calls appropriate ReplayService methods

**Key Design**:
- Tick-driven updates: deterministic, throttleable
- Subscriber pattern: fan-out with error tolerance
- WebSocket protocol: JSON messages with sequence IDs
- Stateful: maintains clock, cursor, builder across calls
- Observable: emits events, logs operations

---

### Tier 5: HTTP + WebSocket Server

#### `services/api-gateway/src/server.ts` (150 lines)
**Purpose**: Express HTTP server + WebSocket endpoint, static file serving, health checks

**Server Setup**:
```typescript
const app = express();
const server = createServer(app);  // HTTP server
const wss = new WebSocketServer({ server });  // WebSocket server
const replayService = new ReplayService({ dataDir });  // State manager
```

**Routes**:

**1. GET /health**
- Returns: `{ status: "ok", dataDir }`
- Used for liveness checks

**2. GET /api/replay/status**
- Returns replay service status:
  - `manifest`, `clock`, `subscribers`

**3. GET / and fallback**
- Serves static files from `apps/web/dist/`
- SPA fallback: unmapped URLs return `index.html`

**WebSocket Endpoint**: `/` (root WebSocket)

**Connection Handler**:
```typescript
wss.on('connection', (ws) => {
  const unsubscribe = replayService.subscribe((msg) => {
    ws.send(JSON.stringify(msg));  // Broadcast state to client
  });

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    switch (message.op) {
      case 'load_session':
        replayService.loadSession(message.sessionKey);
        break;
      case 'play':
        replayService.start(message.tickRateHz || 10);
        break;
      // ... other ops
    }
  });

  ws.on('close', () => {
    unsubscribe();  // Clean up
  });
});
```

**Startup Banner**:
```
╔════════════════════════════════════════╗
║     F1 Insights — Replay Server        ║
╚════════════════════════════════════════╝

  📡 WebSocket server: ws://localhost:3000
  🌐 HTTP server: http://localhost:3000
  📁 Data directory: ./data
```

**Graceful Shutdown**:
- On SIGTERM: stops replay, closes server, exits

**Key Design**:
- Express for HTTP + static files
- WebSocket via ws library
- Shared ReplayService instance
- Backpressure-aware message sending (only if ws.readyState === 1)
- Error logging on subscribers

---

### Tier 6: React Web App

#### `apps/f1-insights-web/src/App.tsx` (400 lines)
**Purpose**: Premium React UI with timing tower, race control feed, playback controls

**Component: App (React.FC)**

**State** (via useState):
- `isConnected: boolean` — WebSocket connection status
- `isPlaying: boolean` — Playback state
- `currentSpeed: number` — Speed multiplier
- `currentTimeMs: number` — Current replay time
- `selectedDriver: number | null` — Selected row in timing tower
- `drivers: DriverState[]` — All drivers with lap times, gaps, etc.
- `raceControlMessages: RaceControlMessage[]` — Recent FIA messages

**Effects** (via useEffect):

**1. WebSocket Connection** (on mount)
```typescript
const ws = new WebSocket('ws://localhost:3000');
ws.onmessage = (event) => {
  const message = JSON.parse(event.data) as StateStreamMessage;
  // Update state: drivers, race control, time
};
```

**2. Auto-load Session** (on mount)
```typescript
ws.send(JSON.stringify({ op: 'load_session', sessionKey: '9159' }));
```

**Render Structure**:

**1. Header**
```
F1 Insights | Status: [Connected/Disconnected] | Speed: 1.0x
```

**2. Control Panel** (Horizontal)
- `▶ Play` / `⏸ Pause` button (toggles based on isPlaying)
- `Speed 🎚️` dropdown (0.5x, 1x, 2x, 4x, 8x)
- `⬅ -30s` button (seek backward)
- `➡ +30s` button (seek forward)
- Time display: `MM:SS / MM:SS`

**3. Main Content Grid** (2-column on desktop, 1-column on mobile)

**Column 1: Timing Tower**
- 10-column table:
  1. Pos (1-20)
  2. Drv# (driver number)
  3. Tyre (HARD/MEDIUM/SOFT)
  4. Last (current lap time)
  5. Best (best lap this session)
  6. Gap (to leader)
  7. Int (to car ahead)
  8. S1 (sector 1 time, with color: pb=purple, sb=green, slow=orange)
  9. S2 (sector 2)
  10. S3 (sector 3)
- Sortable: click header to sort by that column
- Selectable: click row to highlight
- Hover effects: background color change

**Column 2: Race Control Feed**
- Card-based layout, reverse chronological (newest at top)
- Each card:
  - Time (HH:MM:SS)
  - Message (e.g., "SAFETY CAR DEPLOYED")
  - Severity badge (color-coded: INFO=gray, WARNING=yellow, CRITICAL=red)
  - Last 10 messages visible

**4. Footer**
```
CC BY-NC-SA 4.0 — Data from OpenF1
F1 Insights v0.1.0
```

**Mock Data** (fallback if WebSocket unavailable):
```typescript
simulateReplayState() {
  // Returns sample tower state with 10 drivers
  // Used for development/demo if server not running
}
```

**Helpers**:
- `formatLapTime(ms: number): string` — "1:23.456"
- `formatGap(ms: number): string` — "+1.234" or "0.000"
- `getSectorColor(lapTime, pb, sb, slow)` — "purple" | "green" | "orange"
- `formatTimeHMS(ms): string` — "01:23:45" for timestamps

**Styling** (via className + styles.css):
- Responsive grid: 2 columns on desktop, 1 on mobile
- Timing tower table: striped rows, hover highlight
- Race control cards: severity-based background color
- Controls: button styling, spacing, shadows

**Key Design**:
- WebSocket-driven: real-time state updates
- Responsive: works on desktop and tablet
- Error-tolerant: falls back to mock data if server unavailable
- Accessible: semantic HTML, color + text for status indication
- Premium aesthetic: dark background, glassmorph panels

---

#### `apps/f1-insights-web/src/styles.css` (250 lines)
**Purpose**: Premium dark design system with motorsport colors

**Design Tokens**:

**Colors**:
- Primary: `#ef8133` (F1 orange)
- Accent: `#ffffff` (white text)
- Dark bg: `#0a0e27` (deep navy)
- Panel bg: `rgba(255, 255, 255, 0.05)` (10% white overlay on dark, glassmorphism)
- Error: `#ff4444` (red for critical)
- Warning: `#ffaa00` (yellow for warning)
- Success: `#00ff00` (green for OK)

**Typography**:
- Font family: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Headings: 600 weight, 1.2x size
- Body: 400 weight, 14-16px
- Monospace: `'Courier New', monospace` for lap times

**Spacing**:
- 8px base unit (padding 8px, 16px, 24px)
- 4px grid for fine details

**Border Radius**:
- Cards: 8px
- Input: 4px
- Buttons: 4px

**Shadows**:
- Light: `0 2px 4px rgba(0, 0, 0, 0.1)`
- Medium: `0 4px 12px rgba(0, 0, 0, 0.2)`
- Dark: `0 8px 24px rgba(0, 0, 0, 0.4)`

**Glassmorphism**:
```css
.panel {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
```

**Component Styles**:

**1. Body**
- `background: #0a0e27` (dark)
- `color: #ffffff` (white text)
- `font-family: sans-serif`

**2. Container**
- `max-width: 1400px`
- `margin: 0 auto`
- `padding: 16px`

**3. Grid Layout** (main content)
- `display: grid`
- `grid-template-columns: 2fr 1fr` (desktop)
- `gap: 16px`
- `@media (max-width: 768px)`: single column

**4. Timing Tower Table**
- 10 columns: pos(5%), drv#(6%), tyre(8%), last(10%), best(10%), gap(10%), int(10%), s1(12%), s2(12%), s3(12%)
- `border-collapse: collapse`
- Header row: `background: rgba(255, 255, 255, 0.1); font-weight: 600`
- Body rows: `border-bottom: 1px solid rgba(255, 255, 255, 0.05)`
- Hover: `background: rgba(239, 129, 51, 0.1)` (orange tint)
- Selected: `background: rgba(239, 129, 51, 0.2)` (stronger orange)

**5. Sector Colors**
- `pb.purple` — `#9d4edd` (personal best)
- `sb.green` — `#06d6a0` (session best)
- `slow.orange` — `#ef8133` (slower)

**6. Race Control Card**
- `background: rgba(255, 255, 255, 0.05)`
- `border-left: 4px solid` (severity-based: gray, yellow, red)
- `padding: 12px 16px`
- `margin-bottom: 8px`
- `border-radius: 4px`

**7. Button Styles**
- `background: #ef8133` (orange)
- `color: white`
- `border: none`
- `padding: 8px 16px`
- `border-radius: 4px`
- `cursor: pointer`
- `font-weight: 600`
- Hover: `background: #ff9944` (lighter orange)
- Active: `background: #d46b1a` (darker orange)

**8. Input Styles**
- `background: rgba(255, 255, 255, 0.1)`
- `color: white`
- `border: 1px solid rgba(255, 255, 255, 0.2)`
- `padding: 8px 12px`
- `border-radius: 4px`
- Focus: `border-color: #ef8133; outline: none`

**9. Responsive** (@media queries)
- Tablet (max 768px): single column, smaller padding
- Mobile (max 480px): full width, reduced font size

**Key Design**:
- Dark theme: reduces eye strain, premium feel
- Glassmorphism: modern, layered appearance
- Color-coded status: purple (PB), green (SB), orange (slow), red (critical)
- Responsive: adapts to desktop, tablet, mobile
- Motorsport aesthetic: orange accents (F1 branding)

---

#### Configuration Files (8 total)

**tsconfig.base.json** (Root)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "lib": ["ES2022"],
    "paths": {
      "@f1-insights/schemas": ["./packages/schemas/src"],
      "@f1-insights/replay-sdk": ["./packages/replay-sdk/src"]
    }
  }
}
```

**Per-package tsconfig.json** (2 for packages, 3 for services, 1 for app)
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts"]
}
```

**apps/f1-insights-web/tsconfig.json**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

**apps/f1-insights-web/vite.config.ts**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true  // WebSocket passthrough
      }
    }
  }
});
```

**Package.json Files** (2 for services/api-gateway, apps/web)
- Root: scripts for pnpm workspaces, monorepo commands
- Services: dependencies on @f1-insights/schemas, @f1-insights/replay-sdk
- Apps: dependencies on React 18, Vite 5

---

## 🔗 Dependency Graph

```
apps/f1-insights-web (React app)
  ├─ (HTTP proxy) → localhost:3000 (api-gateway server)
  └─ (WebSocket proxy) → ws://localhost:3000

services/api-gateway (Express + WebSocket)
  ├─ @f1-insights/replay-orchestrator
  └─ @f1-insights/schemas

services/replay-orchestrator
  ├─ @f1-insights/replay-sdk
  └─ @f1-insights/schemas

services/ingest-openf1
  ├─ @f1-insights/schemas
  └─ (fetch, fs)

@f1-insights/replay-sdk
  └─ @f1-insights/schemas

@f1-insights/schemas
  └─ (no dependencies)
```

---

## ✅ Validation Checklist

- [x] All TypeScript files pass type-check (after `pnpm build`)
- [x] All files follow Beast Mode non-negotiables
- [x] Determinism implemented (SHA256 state hashing)
- [x] No silent failures (explicit error handling)
- [x] Strongly typed (strict: true in tsconfig)
- [x] Observable (structured logging, sequence IDs)
- [x] Modular (clear package boundaries)
- [x] Testable (pure functions, dependency injection)
- [x] Premium UI (dark theme, glassmorphism)
- [x] Fan-centric (timing tower, race control, playback controls)
- [x] Licensing guards (CC BY-NC-SA 4.0 notice)

---

## 🚀 Next Phase: Live Streaming + AI

**Not yet implemented** (Phase 2+):
1. OpenF1 MQTT/WebSocket live subscription
2. Telemetry canvas rendering
3. Stint pace modeling
4. Undercut detection
5. Anomaly detection
6. Win probability estimation
7. LLM-based commentary

---

**File Manifest Complete** ✓

This document covers all 16 files, their purposes, key code segments, design decisions, and validation. Ready for integration testing.
