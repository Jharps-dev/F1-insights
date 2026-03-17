import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type {
  InsightCard,
  LayoutPoint,
  LiveStatus,
  RaceControlMessage,
  ReplayStatus,
  SessionManifest,
  StintState,
  TowerState,
} from "../../types";

interface ReplayContextValue {
  backendHttp: string;
  sessions: SessionManifest[];
  sessionsLoading: boolean;
  activeSession: SessionManifest | null;
  layout: LayoutPoint[] | null;
  layoutLoading: boolean;
  connected: boolean;
  isPlaying: boolean;
  replayStatus: ReplayStatus;
  sessionError: string | null;
  lastStateUpdateAt: number | null;
  tower: TowerState | null;
  stints: StintState[];
  insights: InsightCard[];
  raceControl: RaceControlMessage[];
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

function getBackendBase(): { http: string; ws: string } {
  const env = import.meta.env as Record<string, string | undefined>;
  const httpOrigin = env.VITE_BACKEND_ORIGIN || window.location.origin;
  const wsUrlFromEnv = env.VITE_BACKEND_WS_URL;
  const wsPath = env.VITE_BACKEND_WS_PATH || "/ws";
  const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
  const sameOriginWs = `${wsProto}://${window.location.host}${wsPath}`;
  return {
    http: httpOrigin,
    ws: wsUrlFromEnv || sameOriginWs,
  };
}

export function ReplayProvider({ children }: { children: React.ReactNode }) {
  const { http: backendHttp, ws: backendWs } = getBackendBase();
  const [sessions, setSessions] = useState<SessionManifest[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeSession, setActiveSession] = useState<SessionManifest | null>(null);
  const [layout, setLayout] = useState<LayoutPoint[] | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayStatus, setReplayStatus] = useState<ReplayStatus>({
    paused: true,
    speed: 1,
    currentReplayTimeMs: 0,
  });
  const [tower, setTower] = useState<TowerState | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [lastStateUpdateAt, setLastStateUpdateAt] = useState<number | null>(null);
  const [stints, setStints] = useState<StintState[]>([]);
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [raceControl, setRaceControl] = useState<RaceControlMessage[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  // Deferred session key from URL navigation before sessions list loaded.
  const pendingSessionKeyRef = useRef<number | null>(null);

  useEffect(() => {
    setSessionsLoading(true);
    fetch(`${backendHttp}/api/sessions`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data: SessionManifest[]) => setSessions(data))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }, [backendHttp]);

  const refreshLiveStatus = useCallback(async () => {
    try {
      const response = await fetch(`${backendHttp}/api/live/status`);
      if (!response.ok) {
        return;
      }
      const status = (await response.json()) as LiveStatus;
      setLiveStatus(status);
    } catch {
      // ignore transient polling issues
    }
  }, [backendHttp]);

  const resetReplayState = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setIsPlaying(false);
    setTower(null);
    setSessionError(null);
    setLastStateUpdateAt(null);
    setStints([]);
    setInsights([]);
    setRaceControl([]);
    setSelectedDriver(null);
    setReplayStatus({ paused: true, speed: 1, currentReplayTimeMs: 0 });
  }, []);

  const selectSession = useCallback(
    (session: SessionManifest) => {
      resetReplayState();
      setActiveSession(session);
      setLayout(null);
      setLiveStatus(null);
      setLayoutLoading(true);
      fetch(`${backendHttp}/api/sessions/${session.session_key}/layout`)
        .then((response) => (response.ok ? response.json() : null))
        .then((points: LayoutPoint[] | null) => setLayout(points))
        .catch(() => setLayout(null))
        .finally(() => setLayoutLoading(false));
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
      if (!Number.isFinite(sessionKey)) {
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
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ op: "load_session", sessionKey: activeSession.session_key }));
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string);
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
          if (Array.isArray(message.payload?.stints)) {
            setStints(message.payload.stints);
          }
          if (Array.isArray(message.payload?.insights)) {
            setInsights(message.payload.insights);
          }
          if (Array.isArray(message.payload?.race_control)) {
            setRaceControl(message.payload.race_control);
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
    ws.onclose = () => {
      setConnected(false);
      setIsPlaying(false);
    };
    return () => {
      ws.close();
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

  const send = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const play = useCallback(() => {
    send({ op: "play" });
    setIsPlaying(true);
    setReplayStatus((previous) => ({ ...previous, paused: false }));
  }, [send]);

  const pause = useCallback(() => {
    send({ op: "pause" });
    setIsPlaying(false);
    setReplayStatus((previous) => ({ ...previous, paused: true }));
  }, [send]);

  const restart = useCallback(() => {
    send({ op: "pause" });
    send({ op: "seek", replayTimeMs: 0 });
    setIsPlaying(false);
    setReplayStatus((previous) => ({ ...previous, paused: true, currentReplayTimeMs: 0 }));
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
      send({ op: "speed", speed });
      setReplayStatus((previous) => ({ ...previous, speed }));
    },
    [send]
  );

  const startLive = useCallback(async () => {
    if (!activeSession) {
      return;
    }
    setLiveBusy(true);
    try {
      await fetch(`${backendHttp}/api/live/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey: activeSession.session_key }),
      });
    } finally {
      setLiveBusy(false);
      void refreshLiveStatus();
    }
  }, [activeSession, backendHttp, refreshLiveStatus]);

  const stopLive = useCallback(async () => {
    setLiveBusy(true);
    try {
      await fetch(`${backendHttp}/api/live/stop`, { method: "POST" });
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
        activeSession,
        layout,
        layoutLoading,
        connected,
        isPlaying,
        replayStatus,
        sessionError,
        lastStateUpdateAt,
        tower,
        stints,
        insights,
        raceControl,
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
