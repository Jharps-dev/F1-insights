# F1 Insights — Quick Start Guide

**Time to first run**: ~5 minutes (after dependencies install)

---

## ✅ Prerequisites

Before starting, ensure you have:
- **Node.js 18 or higher** (`node --version`)
- **pnpm 8 or higher** (`npm install -g pnpm@latest`)
- **A terminal/shell** (PowerShell, bash, zsh, etc.)
- **Git** (optional, for version control)

---

## 🚀 Step 1: Install Dependencies (2 minutes)

From the repository root:

```bash
pnpm install
```

**What this does**:
- Installs Node packages for all workspaces (packages/, services/, apps/)
- Links monorepo packages together using pnpm's `workspace: *` protocol
- Creates `node_modules/` in the root and each workspace

**Expected output**:
```
Progress: resolved 150, reused 120, downloaded 30
```

If you see dependency errors, try:
```bash
pnpm clean  # Clears cache
pnpm install  # Reinstalls
```

---

## 🌐 Step 2: Fetch OpenF1 Session Data (1 minute)

Download real 2024 F1 telemetry data:

```bash
pnpm import:openf1 -- --session 9159 --output ./data
```

**What this does**:
- Connects to OpenF1 REST API
- Downloads car telemetry, lap times, weather, race control messages
- Converts to canonical event format (JSONL)
- Creates session manifest (JSON metadata)

**Expected output**:
```
[IMPORT] Fetching session 9159...
  ✓ car_data: 1,234 rows (3.7 Hz telemetry)
  ✓ laps: 58 rows
  ✓ intervals: 1,200 rows
  ✓ weather: 120 rows
  ✓ race_control: 12 rows
[IMPORT] Writing events_9159.jsonl (1,624 events)
[IMPORT] Writing manifest_9159.json
✅ Session ready at ./data/
```

**Verify it worked**:
```bash
ls -la ./data/
```

You should see:
```
events_9159.jsonl      (1-2 MB)
manifest_9159.json     (5-10 KB)
```

---

## 🖥️ Step 3: Start the Backend Server (Terminal 1)

Open a **new terminal** and run:

```bash
pnpm dev:server
```

**What this does**:
- Starts Express + WebSocket server on `localhost:3000`
- Serves API Gateway with replay control
- Waits for frontend connection

**Expected output**:
```
╔════════════════════════════════════════╗
║     F1 Insights — Replay Server        ║
╚════════════════════════════════════════╝

  📡 WebSocket: ws://localhost:3000
  🌐 HTTP: http://localhost:3000
  📁 Data: ./data

```

**Don't close this terminal**. Leave it running.

---

## ⚛️ Step 4: Start the Frontend Server (Terminal 2)

Open a **second terminal** and run:

```bash
pnpm dev:web
```

**What this does**:
- Starts Vite development server on `localhost:5173`
- Hot-reloads React components as you edit
- Proxies WebSocket to backend on `localhost:3000`

**Expected output**:
```
  VITE v5.0.0  ready in 234 ms

  ➜  Local:   http://localhost:5173/
  ➜  press h to show help
```

**Don't close this terminal**. Leave it running.

---

## 🌍 Step 5: Open in Browser

Navigate to:
```
http://localhost:5173
```

You should see:
- ✅ **Timing Tower** — All drivers with lap times, gaps, stint info
- ✅ **Race Control Feed** — Real-time race events
- ✅ **Playback Controls** — Play/pause, speed, seek buttons
- ✅ **Premium Dark Theme** — Glassmorphism, motorsport colors

---

## 🎮 Step 6: Play With the Replay

### Load the Session
Click the "🔄 Load Session" button (or it auto-loads on startup).

### Play/Pause
Click the **▶ Play** button to start the replay.

### Adjust Speed
Use the **Speed 🎚️** dropdown:
- 0.5x — Half speed (slow motion)
- 1.0x — Real-time
- 2x — Double speed
- 4x — 4x speed
- 8x — Ultra-fast

### Seek Forward/Backward
- **⬅ -30s** — Rewind 30 seconds
- **➡ +30s** — Fast-forward 30 seconds
- **⏱ Seek Input** — Jump to specific time

### View Driver Details
- **Click a row** in the timing tower to select a driver
- **Hover** to see full team name and status
- **Sort** by clicking column headers

### Read Race Events
- **Race Control Feed** shows live incidents:
  - Safety car deployments
  - Penalties
  - Retirements
  - Weather changes
  - FIA notices

---

## 🔧 Development Tips

### Rebuild TypeScript
If you make code changes:
```bash
pnpm build
```

### Type-check Everything
```bash
pnpm typecheck
```

### Check Server Health
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{"status":"ok","dataDir":"./data"}
```

### View WebSocket Messages
Open browser DevTools (F12):
1. Network tab
2. Filter by `WS`
3. Click the WebSocket connection to `localhost:3000`
4. Messages tab shows all state updates

---

## 📊 What You're Seeing

### Timing Tower Columns
| Column | Meaning |
|--------|---------|
| **Pos** | Position in race (1-20) |
| **Drv#** | Driver number (1-63) |
| **Tyre** | Hard/Medium/Soft |
| **Last** | Current lap time |
| **Best** | Best lap time this race |
| **Gap** | Gap to leader |
| **Int** | Interval to car ahead |
| **S1/S2/S3** | Sector times |

### Tyre Colors
- 🟣 **Purple** — Personal Best sector
- 🟢 **Green** — Session Best sector
- 🟠 **Orange** — Slower sector

### Status Indicators
- 🟢 **RUNNING** — On track
- 🔵 **PITTED** — In pit stop
- 🔴 **RETIRED** — Finished race
- ⚫ **DNF** — Did not finish

---

## 🐛 Troubleshooting

### "WebSocket failed to connect"
```
Error in console:
  WebSocket is closed before the connection is established
```

**Solution**:
1. Check server is running: `curl http://localhost:3000/health`
2. Restart server: Press `Ctrl+C` in terminal 1, run `pnpm dev:server` again
3. Refresh browser: Press `Ctrl+R` or `Cmd+R`

### "No data in timing tower"
1. Check session was imported: `ls ./data/events_*.jsonl`
2. Check server logs for errors
3. Reload page in browser

### "Cannot find module '@f1-insights/...'"
```bash
# Clear and reinstall:
pnpm clean
pnpm install
pnpm build
```

### Port 3000 or 5173 already in use
Use different ports:
```bash
PORT=3001 pnpm dev:server
VITE_PORT=5174 pnpm dev:web
```

---

## 📚 API Reference (For Developers)

### WebSocket Endpoint
```
ws://localhost:3000/
```

### Load Session
```json
{
  "op": "load_session",
  "sessionKey": "9159"
}
```

### Play/Pause
```json
{ "op": "play", "tickRateHz": 10 }
{ "op": "pause" }
```

### Seek
```json
{
  "op": "seek",
  "replayTimeMs": 3600000
}
```

### Change Speed
```json
{
  "op": "speed",
  "speed": 2.0
}
```

### Server Response
```json
{
  "type": "state_delta",
  "sequence_id": 42,
  "replay_time_ms": 5000,
  "wall_time_utc": "2024-01-21T10:30:00Z",
  "payload": {
    "tower": {
      "drivers": [
        {
          "position": 1,
          "driver_number": 1,
          "name": "Max Verstappen",
          "team": "RED BULL RACING",
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

## 🎯 Next Steps

After you get the MVP running:

1. **Explore the codebase**:
   ```bash
   cat packages/schemas/src/canonical.ts  # Event types
   cat packages/replay-sdk/src/engine.ts  # Replay logic
   cat apps/f1-insights-web/src/App.tsx  # UI components
   ```

2. **Try different sessions**:
   ```bash
   # 2024 Saudi Arabia
   pnpm import:openf1 -- --session 9160 --output ./data

   # 2023 Abu Dhabi
   pnpm import:openf1 -- --session 9120 --output ./data
   ```

3. **Enable debug logging**:
   ```bash
   DEBUG=* pnpm dev:server
   ```

4. **Read the architecture docs**:
   - `.github/copilot-instructions.md` — Coding guidelines
   - `MASTER_HANDOVER_NOTES.md` — Design decisions
   - `docs/` — Research and specs

---

## 📞 Getting Help

1. **Check the full README**: `README.md`
2. **Check project structure**: `cat package.json` (root)
3. **Review TypeScript definitions**: `packages/schemas/src/canonical.ts`
4. **Check server logs**: Terminal where `pnpm dev:server` is running
5. **Check browser console**: F12 → Console tab (DevTools)

---

## ✅ Congratulations! 🎉

You now have a **fully functional F1 replay platform** with:
- ✅ Deterministic replay engine
- ✅ Real OpenF1 telemetry data
- ✅ Premium UI with timing tower
- ✅ WebSocket-driven state broadcasting
- ✅ Playback controls (play/pause/seek/speed)

**Next phase**: Live streaming + AI analytics (stint pace, undercut detection, win probability, commentary).

Happy racing! 🏁
