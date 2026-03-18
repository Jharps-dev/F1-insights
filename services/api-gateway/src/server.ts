import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import type { NextFunction, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";
import { ReplayService } from "@f1-insights/replay-orchestrator";
import { CanonicalEvent } from "@f1-insights/schemas";
import { OpenF1LiveIngest } from "@f1-insights/ingest-openf1";
import { backfillOpenF1Manifests, importOpenF1Session, type ImportProfile } from "@f1-insights/ingest-openf1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const webDistDir = path.join(repoRoot, "apps", "web", "dist");
const shouldServeWebDist = process.env.NODE_ENV === "production" || process.env.SERVE_WEB_DIST === "1";

// Load environment from repo root. .env.local can override .env values.
loadEnv({ path: path.join(repoRoot, ".env") });
loadEnv({ path: path.join(repoRoot, ".env.local"), override: true });

const app = express();
app.disable("x-powered-by");
function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

const port = parsePositiveIntEnv(process.env.PORT, 3000);
// Resolve DATA_DIR relative to repo root so `./data` works regardless of cwd
const rawDataDir = process.env.DATA_DIR || "data";
const dataDir = path.isAbsolute(rawDataDir) ? rawDataDir : path.join(repoRoot, rawDataDir);
const persistLiveEvents = process.env.LIVE_PERSIST_EVENTS === "1";
const liveMaxFileBytes = parsePositiveIntEnv(process.env.LIVE_MAX_FILE_MB, 256) * 1024 * 1024;
const wsMaxPayloadBytes = parsePositiveIntEnv(process.env.WS_MAX_PAYLOAD_KB, 256) * 1024;
const liveIngest = new OpenF1LiveIngest();
let liveSessionKey: number | null = null;
const liveProfile = (process.env.LIVE_IMPORT_PROFILE as ImportProfile) || "standard";
const liveCarDataCounter = new Map<number, number>();

interface LayoutPoint {
  x: number;
  y: number;
}

interface LayoutManifest {
  session_key?: number;
  meeting_key?: number;
  year?: number;
  circuit_short_name?: string;
  date_start_utc?: string;
  drivers?: Array<{ number?: number }>;
}

function isLayoutPointArray(value: unknown): value is LayoutPoint[] {
  return Array.isArray(value) && value.every((item) => {
    return item && typeof item === "object" && Number.isFinite((item as LayoutPoint).x) && Number.isFinite((item as LayoutPoint).y);
  });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readLayoutCache(sessionKey: number): Promise<LayoutPoint[] | null> {
  const candidateFiles = [
    path.join(dataDir, `layout_v2_${sessionKey}.json`),
    path.join(dataDir, `layout_${sessionKey}.json`),
  ];

  for (const filePath of candidateFiles) {
    const parsed = await readJsonFile<unknown>(filePath);
    if (isLayoutPointArray(parsed) && parsed.length >= 8) {
      return parsed;
    }
  }

  return null;
}

async function findCircuitLayoutFallback(targetSessionKey: number, targetManifest: LayoutManifest | null): Promise<LayoutPoint[] | null> {
  if (!targetManifest?.circuit_short_name) {
    return null;
  }

  const files = await fs.readdir(dataDir);
  const manifestFiles = files.filter((fileName) => fileName.startsWith("manifest_") && fileName.endsWith(".json"));
  const manifests = await Promise.all(
    manifestFiles.map(async (fileName) => {
      const manifest = await readJsonFile<LayoutManifest>(path.join(dataDir, fileName));
      return manifest;
    })
  );

  const candidates = manifests
    .filter((manifest): manifest is LayoutManifest => Boolean(manifest?.circuit_short_name && Number.isInteger(manifest.session_key)))
    .filter((manifest) => manifest.session_key !== targetSessionKey)
    .filter((manifest) => manifest.circuit_short_name === targetManifest.circuit_short_name)
    .sort((a, b) => {
      const meetingMatchA = a.meeting_key === targetManifest.meeting_key ? 1 : 0;
      const meetingMatchB = b.meeting_key === targetManifest.meeting_key ? 1 : 0;
      if (meetingMatchA !== meetingMatchB) {
        return meetingMatchB - meetingMatchA;
      }

      const yearDistanceA = Math.abs((a.year ?? 0) - (targetManifest.year ?? 0));
      const yearDistanceB = Math.abs((b.year ?? 0) - (targetManifest.year ?? 0));
      if (yearDistanceA !== yearDistanceB) {
        return yearDistanceA - yearDistanceB;
      }

      const timeA = new Date(a.date_start_utc || 0).getTime();
      const timeB = new Date(b.date_start_utc || 0).getTime();
      return timeB - timeA;
    });

  for (const candidate of candidates) {
    const layout = await readLayoutCache(candidate.session_key as number);
    if (layout) {
      return layout;
    }
  }

  return null;
}

async function fetchOpenF1Json<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) {
    throw new Error(`OpenF1 API returned ${response.status} for ${url}`);
  }
  return (await response.json()) as T;
}

function shouldPersistLiveEvent(event: CanonicalEvent): boolean {
  if (event.kind !== "car_data") {
    return true;
  }
  if (liveProfile === "full") {
    return true;
  }
  if (liveProfile === "lite") {
    return false;
  }

  const driver = event.driver?.number ?? -1;
  const current = liveCarDataCounter.get(driver) || 0;
  const next = current + 1;
  liveCarDataCounter.set(driver, next);
  return next % 5 === 0;
}

async function writeImportedDataset(outputDir: string, sessionKey: number, events: CanonicalEvent[], manifest: unknown) {
  await fs.mkdir(outputDir, { recursive: true });
  const eventsPath = path.join(outputDir, `events_${sessionKey}.jsonl`);
  const manifestPath = path.join(outputDir, `manifest_${sessionKey}.json`);
  const eventsJsonl = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await fs.writeFile(eventsPath, eventsJsonl, "utf8");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

app.use(express.json({ limit: "256kb" }));
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && "body" in (err as object)) {
    return res.status(400).json({ error: "Invalid JSON request body" });
  }
  next(err);
});

// Create HTTP server for WebSocket upgrade
const server = createServer(app);
const wss = new WebSocketServer({ server, maxPayload: wsMaxPayloadBytes });

// Initialize replay service
const replayService = new ReplayService({ dataDir });

liveIngest.on("event", async (event: CanonicalEvent) => {
  if (!liveSessionKey) {
    return;
  }

  if (!shouldPersistLiveEvent(event)) {
    return;
  }

  if (!persistLiveEvents) {
    return;
  }

  const filePath = path.join(dataDir, `live_events_${liveSessionKey}.jsonl`);
  try {
    await fs.mkdir(dataDir, { recursive: true });

    // Keep live cache bounded so long-running sessions don't grow unbounded on disk.
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > liveMaxFileBytes) {
        await fs.writeFile(filePath, "", "utf8");
      }
    } catch {
      // file may not exist yet
    }

    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
  } catch (err) {
    console.error("[LIVE] Failed to append event:", err);
  }
});

liveIngest.on("error", (err) => {
  console.error("[LIVE] Ingest error:", err);
});

/**
 * WebSocket handler
 */
wss.on("connection", async (ws) => {
  console.log("[WS] Client connected");

  const sendError = (message: string) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "error", message }));
    }
  };

  // Subscribe to replay state updates
  const unsubscribe = replayService.subscribe((msg) => {
    if (ws.readyState === 1) {
      // WebSocket.OPEN
      ws.send(JSON.stringify(msg));
    }
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (!message || typeof message !== "object") {
        sendError("Invalid message payload: expected JSON object");
        return;
      }

      const op = typeof message.op === "string" ? message.op : "";
      if (!op) {
        sendError("Missing operation 'op'");
        return;
      }

      console.log("[WS] Message:", op);

      switch (op) {
        case "load_session": {
          if (typeof message.sessionKey !== "string" && typeof message.sessionKey !== "number") {
            sendError("load_session requires 'sessionKey' as string or number");
            break;
          }
          if (typeof message.sessionKey === "string" && message.sessionKey.trim().length === 0) {
            sendError("load_session requires non-empty 'sessionKey'");
            break;
          }
          const normalizedSessionKey = Number(message.sessionKey);
          if (!Number.isInteger(normalizedSessionKey) || normalizedSessionKey <= 0) {
            sendError("load_session requires positive integer 'sessionKey'");
            break;
          }

          replayService
            .loadSession(normalizedSessionKey)
            .then(() => {
              const { sessionDurationMs } = replayService.getStatus();
              ws.send(
                JSON.stringify({
                  type: "session_loaded",
                  sessionKey: normalizedSessionKey,
                  session_duration_ms: sessionDurationMs,
                })
              );
            })
            .catch((err: unknown) => {
              const errMessage = err instanceof Error ? err.message : String(err);
              console.error(`[WS] loadSession failed: ${errMessage}`);
              ws.send(JSON.stringify({ type: "error", message: errMessage }));
            });
          break;
        }
        case "play": {
          const requestedTickRate =
            typeof message.tickRateHz === "number" && Number.isFinite(message.tickRateHz)
              ? message.tickRateHz
              : 10;
          const tickRateHz = Math.max(1, Math.min(60, Math.floor(requestedTickRate)));
          replayService.start(tickRateHz);
          break;
        }
        case "pause":
          replayService.pause();
          break;
        case "seek": {
          if (typeof message.replayTimeMs !== "number" || !Number.isFinite(message.replayTimeMs)) {
            sendError("seek requires numeric 'replayTimeMs'");
            break;
          }
          const replayTimeMs = Math.max(0, Math.floor(message.replayTimeMs));
          replayService.seek(replayTimeMs);
          break;
        }
        case "speed": {
          if (typeof message.speed !== "number" || !Number.isFinite(message.speed)) {
            sendError("speed requires numeric 'speed'");
            break;
          }
          const speed = Math.max(0.1, Math.min(16, Number(message.speed.toFixed(2))));
          replayService.setSpeed(speed);
          ws.send(JSON.stringify({ type: "speed_set", speed }));
          break;
        }
        default:
          console.warn("[WS] Unknown op:", op);
          sendError(`Unknown operation '${op}'`);
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.warn("[WS] Malformed JSON message");
      } else {
        console.error("[WS] Error:", err);
      }
      sendError("Malformed JSON message");
    }
  });

  ws.on("close", () => {
    console.log("[WS] Client disconnected");
    unsubscribe();
  });

  ws.on("error", (err) => {
    console.error("[WS] Error:", err);
  });
});

/**
 * REST API endpoints
 */

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", dataDir });
});

// Replay status
app.get("/api/replay/status", (req, res) => {
  res.json(replayService.getStatus());
});

// Live ingest status
app.get("/api/live/status", (req, res) => {
  const hasAuthConfig =
    Boolean(process.env.OPENF1_ACCESS_TOKEN) ||
    Boolean(process.env.OPENF1_USERNAME && process.env.OPENF1_PASSWORD);

  res.json({
    sessionKey: liveSessionKey,
    hasAuthConfig,
    mqttUrl: process.env.OPENF1_MQTT_URL || "mqtts://mqtt.openf1.org:8883",
    liveImportProfile: liveProfile,
    persistLiveEvents,
    liveMaxFileBytes,
    ...liveIngest.getStatus(),
  });
});

// On-demand backfill import
app.post("/api/sessions/:key/import", async (req, res) => {
  const sessionKey = Number(req.params.key);
  if (!Number.isInteger(sessionKey) || sessionKey <= 0) {
    return res.status(400).json({ error: "Invalid session key" });
  }

  const requestedProfile = req.body?.profile as ImportProfile | undefined;
  const profile: ImportProfile =
    requestedProfile === "lite" || requestedProfile === "standard" || requestedProfile === "full"
      ? requestedProfile
      : "standard";

  try {
    const { events, manifest } = await importOpenF1Session(sessionKey, { profile });
    await writeImportedDataset(dataDir, sessionKey, events, manifest);
    return res.json({ ok: true, sessionKey, profile, eventCount: events.length });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to import session",
      sessionKey,
      profile,
    });
  }
});

app.post("/api/sessions/backfill-manifests", async (req, res) => {
  const rawSessionKeys = Array.isArray(req.body?.sessionKeys) ? req.body.sessionKeys : undefined;
  const sessionKeys = rawSessionKeys
    ?.map((value: unknown) => Number(value))
    .filter((value: number) => Number.isInteger(value) && value > 0);

  try {
    const result = await backfillOpenF1Manifests(dataDir, {
      force: req.body?.force === true,
      sessionKeys: sessionKeys && sessionKeys.length > 0 ? sessionKeys : undefined,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to backfill manifests",
    });
  }
});

// Start live ingest
app.post("/api/live/start", async (req, res) => {
  try {
    const rawSessionKey = req.body?.sessionKey ?? process.env.OPENF1_LIVE_SESSION_KEY ?? 0;
    const sessionKey = Number(rawSessionKey);
    if (!Number.isInteger(sessionKey) || sessionKey <= 0) {
      return res.status(400).json({ error: "sessionKey is required" });
    }

    if (liveIngest.getStatus().connected) {
      await liveIngest.stop();
    }

    liveCarDataCounter.clear();
    liveSessionKey = sessionKey;
    await liveIngest.start({
      sessionKey,
      username: process.env.OPENF1_USERNAME,
      password: process.env.OPENF1_PASSWORD,
      accessToken: process.env.OPENF1_ACCESS_TOKEN,
    });

    res.json({ ok: true, sessionKey, status: liveIngest.getStatus() });
  } catch (err) {
    liveSessionKey = null;
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to start live ingest",
    });
  }
});

// Stop live ingest
app.post("/api/live/stop", async (req, res) => {
  try {
    await liveIngest.stop();
    liveSessionKey = null;
    res.json({ ok: true, status: liveIngest.getStatus() });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to stop live ingest",
    });
  }
});

// List available sessions
app.get("/api/sessions", async (req, res) => {
  try {
    const files = await fs.readdir(dataDir);
    const manifests = await Promise.all(
      files
        .filter((f) => f.startsWith("manifest_") && f.endsWith(".json"))
        .map(async (f) => {
          try {
            const json = await fs.readFile(path.join(dataDir, f), "utf8");
            return JSON.parse(json);
          } catch {
            return null;
          }
        })
    );
    const validManifests = manifests.filter((item): item is Record<string, any> => {
      return Boolean(item && Number.isFinite(Number(item.session_key)));
    });
    const sorted = validManifests.sort((a, b) => {
      const ta = new Date(a.date_start_utc || a.created_utc || 0).getTime();
      const tb = new Date(b.date_start_utc || b.created_utc || 0).getTime();
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) {
        return tb - ta;
      }
      return Number(b.session_key) - Number(a.session_key);
    });
    res.json(sorted);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("ENOENT")) {
      return res.json([]);
    }
    res.status(500).json({ error: "Failed to list sessions" });
  }
});

// Calendar for a season (tracks and dates)
app.get("/api/calendar/:year(\\d{4})", async (req, res) => {
  const year = Number(req.params.year);
  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    return res.status(400).json({ error: "Invalid year" });
  }

  try {
    const meetings = await fetchOpenF1Json<any[]>(`https://api.openf1.org/v1/meetings?year=${year}`);
    const sorted = meetings.sort((a, b) =>
      String(a.date_start || "").localeCompare(String(b.date_start || ""))
    );
    return res.json({
      year,
      count: sorted.length,
      meetings: sorted,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to fetch season calendar",
    });
  }
});

// Calendar diff: which circuits were added/removed between two seasons
app.get("/api/calendar/diff", async (req, res) => {
  const fromYear = Number(req.query.from);
  const toYear = Number(req.query.to);
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) {
    return res.status(400).json({ error: "Query params 'from' and 'to' are required" });
  }
  if (fromYear < 2020 || fromYear > 2100 || toYear < 2020 || toYear > 2100) {
    return res.status(400).json({ error: "Years must be between 2020 and 2100" });
  }
  if (fromYear === toYear) {
    return res.status(400).json({ error: "'from' and 'to' years must differ" });
  }

  try {
    const [fromMeetings, toMeetings] = await Promise.all([
      fetchOpenF1Json<any[]>(`https://api.openf1.org/v1/meetings?year=${fromYear}`),
      fetchOpenF1Json<any[]>(`https://api.openf1.org/v1/meetings?year=${toYear}`),
    ]);

    const normalize = (meeting: any) => ({
      circuit_key: meeting.circuit_key,
      circuit_short_name: meeting.circuit_short_name,
      country_name: meeting.country_name,
    });

    const fromCircuits = new Map<number, ReturnType<typeof normalize>>();
    for (const meeting of fromMeetings) {
      const circuitKey = Number(meeting.circuit_key);
      if (!Number.isFinite(circuitKey)) {
        continue;
      }
      fromCircuits.set(circuitKey, normalize(meeting));
    }

    const toCircuits = new Map<number, ReturnType<typeof normalize>>();
    for (const meeting of toMeetings) {
      const circuitKey = Number(meeting.circuit_key);
      if (!Number.isFinite(circuitKey)) {
        continue;
      }
      toCircuits.set(circuitKey, normalize(meeting));
    }

    const added: ReturnType<typeof normalize>[] = [];
    const removed: ReturnType<typeof normalize>[] = [];

    for (const [key, circuit] of toCircuits) {
      if (!fromCircuits.has(key)) {
        added.push(circuit);
      }
    }
    for (const [key, circuit] of fromCircuits) {
      if (!toCircuits.has(key)) {
        removed.push(circuit);
      }
    }

    return res.json({
      from: fromYear,
      to: toYear,
      added: added.sort((a, b) => a.circuit_short_name.localeCompare(b.circuit_short_name)),
      removed: removed.sort((a, b) => a.circuit_short_name.localeCompare(b.circuit_short_name)),
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to diff calendars",
    });
  }
});

// Track layout — circuit shape sampled from OpenF1 location data, cached to disk
app.get("/api/sessions/:key/layout", async (req, res) => {
  const key = Number(req.params.key);
  if (!Number.isInteger(key) || key <= 0) return res.status(400).json({ error: "Invalid session key" });

  const cacheFile = path.join(dataDir, `layout_v2_${key}.json`);

  const cachedLayout = await readLayoutCache(key);
  if (cachedLayout) {
    return res.json(cachedLayout);
  }

  const manifestPath = path.join(dataDir, `manifest_${key}.json`);
  const targetManifest = await readJsonFile<LayoutManifest>(manifestPath);

  const localFallbackLayout = await findCircuitLayoutFallback(key, targetManifest);
  if (localFallbackLayout) {
    await fs.writeFile(cacheFile, JSON.stringify(localFallbackLayout), "utf8");
    return res.json(localFallbackLayout);
  }

  // Build a priority-ordered list of driver numbers to try.
  // Prefer drivers from the session manifest; fall back to common numbers.
  let candidateDrivers: number[] = [55, 1, 44, 16, 4, 63, 14, 11];
  try {
    const manifest = targetManifest;
    if (Array.isArray(manifest?.drivers) && manifest.drivers.length > 0) {
      const manifestNums: number[] = manifest.drivers
        .map((d: any) => Number(d.number))
        .filter((n: number) => Number.isFinite(n) && n > 0);
      // Put 55 first if present, then the rest of the manifest drivers.
      const preferred = manifestNums.includes(55)
        ? [55, ...manifestNums.filter((n) => n !== 55)]
        : manifestNums;
      if (preferred.length > 0) {
        candidateDrivers = preferred.slice(0, 6);
      }
    }
  } catch {
    // Manifest not available; use hardcoded fallback candidates.
  }

  let lastError: Error = new Error("No location data found for any candidate driver");

  for (const driverNumber of candidateDrivers) {
    try {
      const apiUrl = `https://api.openf1.org/v1/location?session_key=${key}&driver_number=${driverNumber}`;
      console.log(`[LAYOUT] Trying driver ${driverNumber} for session ${key}…`);
      const response = await fetch(apiUrl, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        lastError = new Error(`OpenF1 API returned ${response.status} for driver ${driverNumber}`);
        continue;
      }
      const data = (await response.json()) as Array<{ x: number; y: number; date: string }>;
      if (!Array.isArray(data) || data.length < 100) {
        lastError = new Error(`Insufficient data for driver ${driverNumber} (${data?.length ?? 0} pts)`);
        continue;
      }

      // Extract first complete lap by detecting return near the starting point.
      const start = data[0];
      let endIndex = Math.min(data.length - 1, 2400);
      const minSamplesBeforeClose = 350;
      const closeThreshold = 180;
      for (let i = minSamplesBeforeClose; i < data.length; i++) {
        const dx = data[i].x - start.x;
        const dy = data[i].y - start.y;
        if (Math.sqrt(dx * dx + dy * dy) <= closeThreshold) {
          endIndex = i;
          break;
        }
      }

      const lapSlice = data.slice(0, endIndex + 1);
      const step = Math.max(1, Math.floor(lapSlice.length / 500));
      const layout = lapSlice.filter((_, i) => i % step === 0).map((d) => ({ x: d.x, y: d.y }));

      await fs.writeFile(cacheFile, JSON.stringify(layout), "utf8");
      console.log(`[LAYOUT] Cached ${layout.length} points from driver ${driverNumber} for session ${key}`);
      return res.json(layout);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  console.error("[LAYOUT] All candidates failed:", lastError.message);
  res.status(500).json({ error: lastError.message });
});

if (shouldServeWebDist) {
  // Static files (serve built React app)
  app.use(express.static(webDistDir));

  // SPA fallback
  app.get("*", (req, res) => {
    res.sendFile(path.join(webDistDir, "index.html"));
  });
} else {
  // In local dev, the web UI runs on Vite (5173). Keep 3000 API-only to avoid stale UI confusion.
  app.get("/", (req, res) => {
    res.type("text/plain").send("F1 Insights API is running on :3000. Open http://localhost:5173 for the web UI.");
  });
}

// Start server
server.listen(port, () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║     F1 Insights — Replay Server        ║`);
  console.log(`╚════════════════════════════════════════╝`);
  console.log(`\n  📡 WebSocket server: ws://localhost:${port}`);
  console.log(`  🌐 HTTP server: http://localhost:${port}`);
  console.log(`  📁 Data directory: ${dataDir}`);
  console.log(`\n  Repo-local toolchain:`);
  console.log(`    .\\tools\\use-local-node.cmd`);
  console.log(`\n  Live mode config:`);
  console.log(`    copy .env.example .env`);
  console.log(`    fill OPENF1 credentials/token`);
  console.log(`    POST /api/live/start`);
  console.log(`\n  Import another session if needed:`);
  console.log(`    pnpm import:openf1 -- --session 9159 --output ./data`);
  if (shouldServeWebDist) {
    console.log(`\n  Then open http://localhost:${port} in your browser\n`);
  } else {
    console.log(`\n  Dev UI: http://localhost:5173`);
    console.log(`  API only on :${port}\n`);
  }
});

// Graceful shutdown
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log("Shutting down...");
  void liveIngest.stop();
  replayService.stop();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
