import { WebSocket } from "ws";

const HTTP_BASE = process.env.SMOKE_HTTP_BASE || "http://localhost:3000";
const WS_URL = process.env.SMOKE_WS_URL || "ws://localhost:3000";
const SESSION_KEY = parsePositiveInt(process.env.SMOKE_SESSION_KEY, 9465);
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SMOKE_REQUEST_TIMEOUT_MS, 20000);
const WS_TIMEOUT_MS = parsePositiveInt(process.env.SMOKE_WS_TIMEOUT_MS, 25000);

function parsePositiveInt(rawValue, fallback) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchJson(path, init) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${HTTP_BASE}${path}`, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runHttpSmoke() {
  const checks = [];

  const health = await fetchJson("/health");
  checks.push({ name: "GET /health", status: health.status });
  assert(health.status === 200, "GET /health expected 200");
  assert(health.body && health.body.status === "ok", "GET /health returned unexpected payload");

  const sessions = await fetchJson("/api/sessions");
  checks.push({ name: "GET /api/sessions", status: sessions.status });
  assert(sessions.status === 200, "GET /api/sessions expected 200");
  assert(Array.isArray(sessions.body), "GET /api/sessions expected array payload");
  assert(sessions.body.length > 0, "GET /api/sessions returned no sessions");

  const replayStatus = await fetchJson("/api/replay/status");
  checks.push({ name: "GET /api/replay/status", status: replayStatus.status });
  assert(replayStatus.status === 200, "GET /api/replay/status expected 200");
  assert(replayStatus.body && typeof replayStatus.body === "object", "GET /api/replay/status returned invalid payload");

  const calendar = await fetchJson("/api/calendar/2024");
  checks.push({ name: "GET /api/calendar/2024", status: calendar.status });
  assert(calendar.status === 200, "GET /api/calendar/2024 expected 200");

  const calendarDiff = await fetchJson("/api/calendar/diff?from=2023&to=2024");
  checks.push({ name: "GET /api/calendar/diff", status: calendarDiff.status });
  assert(calendarDiff.status === 200, "GET /api/calendar/diff expected 200");

  const invalidCalendarYear = await fetchJson("/api/calendar/1900");
  checks.push({ name: "GET /api/calendar/1900", status: invalidCalendarYear.status });
  assert(invalidCalendarYear.status === 400, "GET /api/calendar/1900 expected 400");

  const invalidCalendarDiff = await fetchJson("/api/calendar/diff?from=2024&to=2024");
  checks.push({ name: "GET /api/calendar/diff?from=2024&to=2024", status: invalidCalendarDiff.status });
  assert(invalidCalendarDiff.status === 400, "GET /api/calendar/diff?from=2024&to=2024 expected 400");

  const invalidLayout = await fetchJson("/api/sessions/not-a-number/layout");
  checks.push({ name: "GET /api/sessions/not-a-number/layout", status: invalidLayout.status });
  assert(invalidLayout.status === 400, "GET /api/sessions/not-a-number/layout expected 400");

  const layout = await fetchJson(`/api/sessions/${SESSION_KEY}/layout`);
  checks.push({ name: `GET /api/sessions/${SESSION_KEY}/layout`, status: layout.status });
  assert(layout.status === 200, `GET /api/sessions/${SESSION_KEY}/layout expected 200`);
  assert(Array.isArray(layout.body), `GET /api/sessions/${SESSION_KEY}/layout expected array payload`);

  return checks;
}

function waitFor(ws, predicate, description, timeoutMs, options = {}) {
  const { allowErrorMessages = false } = options;
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      ws.off("message", onMessage);
      ws.off("close", onClose);
      ws.off("error", onError);
    };

    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      cleanup();
      reject(error);
    };

    const settleResolve = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      cleanup();
      resolve(value);
    };

    const timeoutId = setTimeout(() => {
      settleReject(new Error(`Timed out waiting for ${description}`));
    }, timeoutMs);

    function onClose(code) {
      settleReject(new Error(`WebSocket closed while waiting for ${description} (code=${code})`));
    }

    function onError(err) {
      settleReject(err instanceof Error ? err : new Error(String(err)));
    }

    function onMessage(raw) {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg?.type === "error" && !allowErrorMessages) {
        settleReject(new Error(`Server reported error while waiting for ${description}: ${msg.message || "unknown"}`));
        return;
      }

      if (predicate(msg)) {
        settleResolve(msg);
      }
    }

    ws.on("message", onMessage);
    ws.on("close", onClose);
    ws.on("error", onError);
  });
}

async function runWsSmoke() {
  const ws = new WebSocket(WS_URL);
  const wsSummary = {
    opened: false,
    sessionLoaded: false,
    stateDeltaCount: 0,
    speedAck: false,
    negativeChecks: {
      emptySessionKeyError: false,
      invalidSessionKeyError: false,
      unknownOpError: false,
      invalidSeekError: false,
      malformedJsonError: false,
      speedClamped: false,
      tickRateClamped: false,
    },
  };

  await new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      ws.off("open", onOpen);
      ws.off("error", onError);
    };

    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      cleanup();
      reject(error);
    };

    const settleResolve = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      cleanup();
      resolve();
    };

    function onOpen() {
      wsSummary.opened = true;
      settleResolve();
    }

    function onError(err) {
      settleReject(err);
    }

    const timeoutId = setTimeout(() => {
      settleReject(new Error("Timed out opening WebSocket connection"));
    }, WS_TIMEOUT_MS);
    ws.once("open", onOpen);
    ws.once("error", onError);
  });

  ws.send(JSON.stringify({ op: "load_session", sessionKey: String(SESSION_KEY) }));
  await waitFor(
    ws,
    (msg) => msg?.type === "session_loaded" && String(msg?.sessionKey) === String(SESSION_KEY),
    "session_loaded",
    WS_TIMEOUT_MS
  );
  wsSummary.sessionLoaded = true;

  ws.send(JSON.stringify({ op: "load_session", sessionKey: "   " }));
  await waitFor(
    ws,
    (msg) => msg?.type === "error" && String(msg?.message || "").includes("non-empty 'sessionKey'"),
    "error for empty session key",
    WS_TIMEOUT_MS,
    { allowErrorMessages: true }
  );
  wsSummary.negativeChecks.emptySessionKeyError = true;

  ws.send(JSON.stringify({ op: "load_session", sessionKey: "abc" }));
  await waitFor(
    ws,
    (msg) => msg?.type === "error" && String(msg?.message || "").includes("positive integer 'sessionKey'"),
    "error for invalid session key",
    WS_TIMEOUT_MS,
    { allowErrorMessages: true }
  );
  wsSummary.negativeChecks.invalidSessionKeyError = true;

  ws.send(JSON.stringify({ op: "speed", speed: 1.5 }));
  await waitFor(ws, (msg) => msg?.type === "speed_set" && msg?.speed === 1.5, "speed_set", WS_TIMEOUT_MS);
  wsSummary.speedAck = true;

  ws.send(JSON.stringify({ op: "speed", speed: 100 }));
  const clampedSpeed = await waitFor(ws, (msg) => msg?.type === "speed_set", "clamped speed_set", WS_TIMEOUT_MS);
  wsSummary.negativeChecks.speedClamped = clampedSpeed?.speed === 16;

  ws.send(JSON.stringify({ op: "play", tickRateHz: 999 }));
  await waitFor(
    ws,
    (msg) => {
      if (msg?.type === "state_delta") {
        wsSummary.stateDeltaCount += 1;
      }
      return wsSummary.stateDeltaCount >= 1;
    },
    "state_delta after clamped play tick rate",
    WS_TIMEOUT_MS
  );
  wsSummary.negativeChecks.tickRateClamped = true;

  ws.send(JSON.stringify({ op: "play", tickRateHz: 10 }));
  await waitFor(
    ws,
    (msg) => {
      if (msg?.type === "state_delta") {
        wsSummary.stateDeltaCount += 1;
      }
      return wsSummary.stateDeltaCount >= 3;
    },
    "at least 3 state_delta messages",
    WS_TIMEOUT_MS
  );

  ws.send(JSON.stringify({ op: "seek", replayTimeMs: 5000 }));
  await waitFor(ws, (msg) => msg?.type === "state_delta", "state_delta after seek", WS_TIMEOUT_MS);
  wsSummary.stateDeltaCount += 1;

  ws.send(JSON.stringify({ op: "seek", replayTimeMs: "bad" }));
  await waitFor(
    ws,
    (msg) => msg?.type === "error" && String(msg?.message || "").includes("seek requires numeric 'replayTimeMs'"),
    "error for invalid seek payload",
    WS_TIMEOUT_MS,
    { allowErrorMessages: true }
  );
  wsSummary.negativeChecks.invalidSeekError = true;

  ws.send(JSON.stringify({ op: "not_real_op" }));
  await waitFor(
    ws,
    (msg) => msg?.type === "error" && String(msg?.message || "").includes("Unknown operation"),
    "error for unknown op",
    WS_TIMEOUT_MS,
    { allowErrorMessages: true }
  );
  wsSummary.negativeChecks.unknownOpError = true;

  ws.send("{not-json");
  await waitFor(
    ws,
    (msg) => msg?.type === "error" && String(msg?.message || "").includes("Malformed JSON"),
    "error for malformed JSON",
    WS_TIMEOUT_MS,
    { allowErrorMessages: true }
  );
  wsSummary.negativeChecks.malformedJsonError = true;

  assert(
    Object.values(wsSummary.negativeChecks).every(Boolean),
    "WebSocket negative checks failed"
  );

  ws.send(JSON.stringify({ op: "pause" }));
  ws.close();

  return wsSummary;
}

async function main() {
  const started = Date.now();
  const httpChecks = await runHttpSmoke();
  const wsChecks = await runWsSmoke();
  const durationMs = Date.now() - started;

  const output = {
    ok: true,
    httpBase: HTTP_BASE,
    wsUrl: WS_URL,
    sessionKey: SESSION_KEY,
    durationMs,
    httpChecks,
    wsChecks,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        httpBase: HTTP_BASE,
        wsUrl: WS_URL,
        sessionKey: SESSION_KEY,
      },
      null,
      2
    )
  );
  process.exit(1);
});
