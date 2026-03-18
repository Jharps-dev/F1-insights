import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type {
  DriverLocation,
  InsightCard,
  LayoutPoint,
  LiveStatus,
  RaceControlMessage,
  RadioMessage,
  ReplayStatus,
  SessionPhase,
  SessionManifest,
  StintState,
  TowerState,
} from "../../types";

interface ReplayContextValue {
  backendHttp: string;
  sessions: SessionManifest[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  activeSession: SessionManifest | null;
  layout: LayoutPoint[] | null;
  layoutLoading: boolean;
  layoutError: string | null;
  connected: boolean;
  isPlaying: boolean;
  replayStatus: ReplayStatus;
  sessionError: string | null;
  liveError: string | null;
  lastStateUpdateAt: number | null;
  tower: TowerState | null;
  locations: DriverLocation[];
  stints: StintState[];
  insights: InsightCard[];
  raceControl: RaceControlMessage[];
  radios: RadioMessage[];
  sessionPhases: SessionPhase[];
  selectedDriver: number | null;
  liveStatus: LiveStatus | null;
  liveBusy: boolean;
  selectSession: (session: SessionManifest) => void;
  ensureSessionKey: (sessionKey: number) => void;
  clearActiveSession: () => void;
  setSelectedDriver: React.Dispatch<React.SetStateAction<number | null>>;
  refreshLiveStatus: () => Promise<void>;
  play: () => void;
  pause: () => void;
  restart: () => void;
  seekBack: () => void;
  seekForward: () => void;
  seekTo: (ms: number) => void;
  setSpeed: (speed: number) => void;
  startLive: () => Promise<void>;
  stopLive: () => Promise<void>;
}

const ReplayContext = createContext<ReplayContextValue | null>(null);
const SESSION_POLL_MS = 5 * 60 * 1000;

async function getApiErrorMessage(response: Response, fallback: string): Promise<string> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    // Ignore body parse failures; the status fallback is enough.
  }

  const normalized = body.toLowerCase();
  if (
    response.status >= 500 &&
    (normalized.includes("econnrefused") ||
      normalized.includes("proxy error") ||
      normalized.includes("error occurred while trying to proxy"))
  ) {
    return "API gateway unavailable. Start ./.tools/node/pnpm.cmd dev or ./.tools/node/pnpm.cmd dev:server.";
  }

  return `${fallback} (${response.status})`;
}

function getBackendBase(): { http: string; ws: string } {
  const env = import.meta.env as Record<string, string | undefined>;
  const browserHttpOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const httpOrigin = env.VITE_BACKEND_ORIGIN || browserHttpOrigin;
  const wsUrlFromEnv = env.VITE_BACKEND_WS_URL;
  const wsPath = env.VITE_BACKEND_WS_PATH || "/ws";
  const wsProto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  const wsHost = typeof window !== "undefined" ? window.location.host : "localhost:3000";
  const sameOriginWs = `${wsProto}://${wsHost}${wsPath}`;
  return {
    http: httpOrigin,
    ws: wsUrlFromEnv || sameOriginWs,
  };
}

export function ReplayProvider({ children }: { children: React.ReactNode }) {
  const { http: backendHttp, ws: backendWs } = getBackendBase();
  const [sessions, setSessions] = useState<SessionManifest[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<SessionManifest | null>(null);
  const [layout, setLayout] = useState<LayoutPoint[] | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayStatus, setReplayStatus] = useState<ReplayStatus>({
    paused: true,
    speed: 1,
    currentReplayTimeMs: 0,
  });
  const [tower, setTower] = useState<TowerState | null>(null);
  const [locations, setLocations] = useState<DriverLocation[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [lastStateUpdateAt, setLastStateUpdateAt] = useState<number | null>(null);
  const [stints, setStints] = useState<StintState[]>([]);
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [raceControl, setRaceControl] = useState<RaceControlMessage[]>([]);
  const [radios, setRadios] = useState<RadioMessage[]>([]);
  const [sessionPhases, setSessionPhases] = useState<SessionPhase[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  // Deferred session key from URL navigation before sessions list loaded.
  const pendingSessionKeyRef = useRef<number | null>(null);
  const layoutRequestIdRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let currentController: AbortController | null = null;

    const loadSessions = async (initial: boolean) => {
      currentController?.abort();
      const controller = new AbortController();
      currentController = controller;

      if (initial) {
        setSessionsLoading(true);
        setSessionsError(null);
      }

      try {
        const response = await fetch(`${backendHttp}/api/sessions`, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, "Failed to load sessions"));
        }
        const data = (await response.json()) as SessionManifest[];
        if (!disposed) {
          setSessions(data);
          setSessionsError(null);
        }
      } catch (err) {
        if (controller.signal.aborted || disposed) {
          return;
        }
        if (initial) {
          setSessions([]);
        }
        setSessionsError(err instanceof Error ? err.message : "Failed to load sessions");
      } finally {
        if (!disposed && initial) {
          setSessionsLoading(false);
        }
      }
    };

    void loadSessions(true);
    const intervalId = window.setInterval(() => {
      void loadSessions(false);
    }, SESSION_POLL_MS);

    return () => {
      disposed = true;
      currentController?.abort();
      window.clearInterval(intervalId);
    };
  }, [backendHttp]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }
    const refreshed = sessions.find((session) => session.session_key === activeSession.session_key);
    if (refreshed) {
      setActiveSession(refreshed);
    }
  }, [activeSession, sessions]);

  const refreshLiveStatus = useCallback(async () => {
    try {
      const response = await fetch(`${backendHttp}/api/live/status`);
      if (!response.ok) {
        setLiveError(await getApiErrorMessage(response, "Live status unavailable"));
        return;
      }
      const status = (await response.json()) as LiveStatus;
      setLiveStatus(status);
      setLiveError(null);
    } catch {
      setLiveError("Live status request failed");
    }
  }, [backendHttp]);

  const resetReplayState = useCallback(() => {
    wsRef.current?.close(1000, "reset");
    wsRef.current = null;
    setConnected(false);
    setIsPlaying(false);
    setTower(null);
    setLocations([]);
    setSessionError(null);
    setLastStateUpdateAt(null);
    setStints([]);
    setInsights([]);
    setRaceControl([]);
    setRadios([]);
    setSessionPhases([]);
    setSelectedDriver(null);
    setReplayStatus({ paused: true, speed: 1, currentReplayTimeMs: 0 });
  }, []);

  const selectSession = useCallback(
    (session: SessionManifest) => {
      resetReplayState();
      setActiveSession(session);
      setLayout(null);
      setLiveStatus(null);
      setLayoutError(null);
      setLayoutLoading(true);
      const requestId = ++layoutRequestIdRef.current;
      fetch(`${backendHttp}/api/sessions/${session.session_key}/layout`)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Failed to load layout (${response.status})`);
          }
          return response.json();
        })
        .then((points: LayoutPoint[] | null) => {
          if (layoutRequestIdRef.current !== requestId) {
            return;
          }
          setLayout(points);
        })
        .catch((err) => {
          if (layoutRequestIdRef.current !== requestId) {
            return;
          }
          setLayout(null);
          setLayoutError(err instanceof Error ? err.message : "Failed to load layout");
        })
        .finally(() => {
          if (layoutRequestIdRef.current === requestId) {
            setLayoutLoading(false);
          }
        });
    },
    [backendHttp, resetReplayState]
  );

  const buildFallbackSession = useCallback((sessionKey: number): SessionManifest => {
    return {
      schema_version: "1.0",
      session_key: sessionKey,
      meeting_key: 0,
      session_type: "Session",
      session_name: `Session ${sessionKey}`,
      circuit_short_name: "Unknown Circuit",
      drivers: [],
    };
  }, []);

  const ensureSessionKey = useCallback(
    (sessionKey: number) => {
      if (!Number.isInteger(sessionKey) || sessionKey <= 0) {
        return;
      }
      if (activeSession?.session_key === sessionKey) {
        return;
      }
      const session = sessions.find((item) => item.session_key === sessionKey);
      if (session) {
        selectSession(session);
      } else if (!sessionsLoading) {
        // Allow direct deep links even when a manifest is missing from /api/sessions.
        // Replay and layout endpoints can still resolve by session key.
        selectSession(buildFallbackSession(sessionKey));
      } else {
        // sessions may still be loading — defer until resolved
        pendingSessionKeyRef.current = sessionKey;
      }
    },
    [activeSession?.session_key, buildFallbackSession, selectSession, sessions, sessionsLoading]
  );

  // Resolve a deferred session key once the sessions list finishes loading.
  useEffect(() => {
    if (sessionsLoading || pendingSessionKeyRef.current === null) {
      return;
    }
    const pendingKey = pendingSessionKeyRef.current;
    pendingSessionKeyRef.current = null;
    const session = sessions.find((item) => item.session_key === pendingKey);
    if (session) {
      selectSession(session);
    } else {
      selectSession(buildFallbackSession(pendingKey));
    }
  }, [buildFallbackSession, sessions, sessionsLoading, selectSession]);

  const clearActiveSession = useCallback(() => {
    pendingSessionKeyRef.current = null;
    resetReplayState();
    setActiveSession(null);
    setLayout(null);
    setLiveStatus(null);
  }, [resetReplayState]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const ws = new WebSocket(backendWs);
    let expectedClose = false;
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      setSessionError(null);
      ws.send(JSON.stringify({ op: "load_session", sessionKey: activeSession.session_key }));
    };
    ws.onmessage = (event) => {
      try {
        const rawData = typeof event.data === "string" ? event.data : "";
        const message = JSON.parse(rawData);
        if (message.type === "session_loaded") {
          // State (tower, stints, insights, raceControl) was already populated by the
          // initial emitSnapshot() inside loadSession() -- before this message
          // arrives. Only reset the clock, playing flag, and capture session duration.
          setReplayStatus({
            paused: true,
            speed: 1,
            currentReplayTimeMs: 0,
            durationMs: typeof message.session_duration_ms === "number" ? message.session_duration_ms : undefined,
          });
          setSessionPhases(
            Array.isArray(message.session_phases)
              ? message.session_phases.filter(
                  (phase: unknown): phase is SessionPhase =>
                    Boolean(phase) &&
                    typeof (phase as SessionPhase).key === "string" &&
                    typeof (phase as SessionPhase).label === "string" &&
                    typeof (phase as SessionPhase).startReplayMs === "number"
                )
              : []
          );
          setIsPlaying(false);
          setSessionError(null);
          return;
        }
        if (message.type === "state_delta") {
          setSessionError(null);
          setLastStateUpdateAt(Date.now());
          setReplayStatus((previous) => ({
            ...previous,
            currentReplayTimeMs: message.replay_time_ms ?? previous.currentReplayTimeMs,
          }));
          if (message.payload?.tower) {
            setTower(message.payload.tower);
          }
          if (Array.isArray(message.payload?.locations)) {
            setLocations(message.payload.locations);
          }
          if (Array.isArray(message.payload?.stints)) {
            setStints(message.payload.stints);
          }
          if (Array.isArray(message.payload?.insights)) {
            setInsights(message.payload.insights);
          }
          if (Array.isArray(message.payload?.race_control)) {
            setRaceControl(message.payload.race_control);
          }
          if (Array.isArray(message.payload?.radios)) {
            setRadios(message.payload.radios);
          }
          return;
        }
        if (message.type === "speed_set") {
          setReplayStatus((previous) => ({ ...previous, speed: message.speed ?? previous.speed }));
          return;
        }
        if (message.type === "error") {
          console.error("[WS] Server error:", message.message);
          setSessionError(typeof message.message === "string" ? message.message : "Replay server error");
          return;
        }
      } catch {
        // ignore malformed messages
      }
    };
    ws.onclose = (event) => {
      setConnected(false);
      setIsPlaying(false);
      if (!expectedClose && event.code !== 1000) {
        setSessionError("WebSocket disconnected unexpectedly");
      }
    };
    return () => {
      expectedClose = true;
      ws.close(1000, "effect_cleanup");
      setConnected(false);
      setIsPlaying(false);
    };
  }, [activeSession, backendWs]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }
    void refreshLiveStatus();
    const id = window.setInterval(() => {
      void refreshLiveStatus();
    }, 2_000);
    return () => {
      window.clearInterval(id);
    };
  }, [activeSession, refreshLiveStatus]);

  const send = useCallback((message: object): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    setSessionError("WebSocket not connected");
    return false;
  }, []);

  const play = useCallback(() => {
    if (send({ op: "play" })) {
      setIsPlaying(true);
      setReplayStatus((previous) => ({ ...previous, paused: false }));
    }
  }, [send]);

  const pause = useCallback(() => {
    if (send({ op: "pause" })) {
      setIsPlaying(false);
      setReplayStatus((previous) => ({ ...previous, paused: true }));
    }
  }, [send]);

  const restart = useCallback(() => {
    const paused = send({ op: "pause" });
    const seeked = send({ op: "seek", replayTimeMs: 0 });
    if (paused && seeked) {
      setIsPlaying(false);
      setReplayStatus((previous) => ({ ...previous, paused: true, currentReplayTimeMs: 0 }));
    }
  }, [send]);

  const seekTo = useCallback(
    (replayTimeMs: number) => {
      send({ op: "seek", replayTimeMs });
    },
    [send]
  );

  const seekBack = useCallback(() => {
    const next = Math.max(0, replayStatus.currentReplayTimeMs - 30_000);
    send({ op: "seek", replayTimeMs: next });
  }, [replayStatus.currentReplayTimeMs, send]);

  const seekForward = useCallback(() => {
    send({ op: "seek", replayTimeMs: replayStatus.currentReplayTimeMs + 30_000 });
  }, [replayStatus.currentReplayTimeMs, send]);

  const setSpeed = useCallback(
    (speed: number) => {
      if (send({ op: "speed", speed })) {
        setReplayStatus((previous) => ({ ...previous, speed }));
      }
    },
    [send]
  );

  const startLive = useCallback(async () => {
    if (!activeSession) {
      return;
    }
    setLiveBusy(true);
    try {
      const response = await fetch(`${backendHttp}/api/live/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey: activeSession.session_key }),
      });
      if (!response.ok) {
        setLiveError(await getApiErrorMessage(response, "Failed to start live mode"));
      } else {
        setLiveError(null);
      }
    } catch {
      setLiveError("Live start request failed");
    } finally {
      setLiveBusy(false);
      void refreshLiveStatus();
    }
  }, [activeSession, backendHttp, refreshLiveStatus]);

  const stopLive = useCallback(async () => {
    setLiveBusy(true);
    try {
      const response = await fetch(`${backendHttp}/api/live/stop`, { method: "POST" });
      if (!response.ok) {
        setLiveError(await getApiErrorMessage(response, "Failed to stop live mode"));
      } else {
        setLiveError(null);
      }
    } catch {
      setLiveError("Live stop request failed");
    } finally {
      setLiveBusy(false);
      void refreshLiveStatus();
    }
  }, [backendHttp, refreshLiveStatus]);

  return (
    <ReplayContext.Provider
      value={{
        backendHttp,
        sessions,
        sessionsLoading,
        sessionsError,
        activeSession,
        layout,
        layoutLoading,
        layoutError,
        connected,
        isPlaying,
        replayStatus,
        sessionError,
        liveError,
        lastStateUpdateAt,
        tower,
        locations,
        stints,
        insights,
        raceControl,
        radios,
        sessionPhases,
        selectedDriver,
        liveStatus,
        liveBusy,
        selectSession,
        ensureSessionKey,
        clearActiveSession,
        setSelectedDriver,
        refreshLiveStatus,
        play,
        pause,
        restart,
        seekBack,
        seekForward,
        seekTo,
        setSpeed,
        startLive,
        stopLive,
      }}
    >
      {children}
    </ReplayContext.Provider>
  );
}

export function useReplay() {
  const context = useContext(ReplayContext);
  if (!context) {
    throw new Error("useReplay must be used within ReplayProvider");
  }
  return context;
}
