import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PlaybackBar } from "../components/PlaybackBar";
import { RaceControlFeed } from "../components/RaceControlFeed";
import { TeamRadioFeed } from "../components/TeamRadioFeed";
import { TimingTower } from "../components/TimingTower";
import { TrackMap } from "../components/TrackMap";
import { useReplay } from "../app/providers/ReplayProvider";
import type { SessionManifest } from "../types";

const CIRCUIT_LABELS: Record<string, string> = {
  Singapore: "SG Singapore Grand Prix",
  Silverstone: "GB British Grand Prix",
  Monaco: "MC Monaco Grand Prix",
  Monza: "IT Italian Grand Prix",
  Spa: "BE Belgian Grand Prix",
  Suzuka: "JP Japanese Grand Prix",
  "Abu Dhabi": "AE Abu Dhabi Grand Prix",
  Austin: "US United States Grand Prix",
  Baku: "AZ Azerbaijan Grand Prix",
};

function getDisplaySessionType(session: SessionManifest): string {
  const name = (session.session_name || "").toLowerCase();
  if (name.includes("sprint qualifying") || name.includes("sprint shootout")) {
    return "Sprint Qualifying";
  }
  if (name.includes("sprint")) {
    return "Sprint";
  }
  return session.session_type;
}

export function ReplayStudioPage() {
  const navigate = useNavigate();
  const { sessionKey } = useParams();
  const {
    activeSession,
    layout,
    layoutLoading,
    tower,
    locations,
    raceControl,
    radios,
    sessionPhases,
    selectedDriver,
    setSelectedDriver,
    replayStatus,
    sessionError,
    sessionsError,
    layoutError,
    connected,
    isPlaying,
    liveStatus,
    liveBusy,
    lastStateUpdateAt,
    ensureSessionKey,
    clearActiveSession,
    play,
    pause,
    restart,
    seekBack,
    seekForward,
    seekTo,
    setSpeed,
    startLive,
    stopLive,
  } = useReplay();
  const mainRef = useRef<HTMLElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [rightPaneWidth, setRightPaneWidth] = useState(() => {
    if (typeof window === "undefined") {
      return 560;
    }

    try {
      const raw = window.localStorage.getItem("replay-right-pane-width");
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 420 ? parsed : 560;
    } catch {
      return 560;
    }
  });
  const [canResize, setCanResize] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(min-width: 1101px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(min-width: 1101px)");
    const onChange = () => setCanResize(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("replay-right-pane-width", String(Math.floor(rightPaneWidth)));
    } catch {
      // Best effort only.
    }
  }, [rightPaneWidth]);

  const onSplitterMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!canResize || event.button !== 0) {
      return;
    }

    dragCleanupRef.current?.();

    const startX = event.clientX;
    const startWidth = rightPaneWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const containerWidth = mainRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const min = 420;
      const max = Math.max(520, Math.floor(containerWidth * 0.62));
      const next = Math.min(max, Math.max(min, startWidth - deltaX));
      setRightPaneWidth(next);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      dragCleanupRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    dragCleanupRef.current = onMouseUp;
  };

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!sessionKey) {
      return;
    }
    const parsed = Number(sessionKey);
    if (Number.isInteger(parsed) && parsed > 0) {
      ensureSessionKey(parsed);
    }
  }, [ensureSessionKey, sessionKey]);

  // Tick every second so the stale badge re-evaluates without needing a WS message.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  if (!activeSession) {
    const archiveUnavailable = Boolean(sessionsError);

    if (sessionKey && Number.isInteger(Number(sessionKey)) && Number(sessionKey) > 0) {
      return (
        <div className="page-surface page-surface--centered">
          <div className="empty-state-panel">
            <h1 className="page-title">Replay Studio</h1>
            <p className="page-subtitle">Loading session {sessionKey}...</p>
          </div>
        </div>
      );
    }

    return (
      <div className="page-surface page-surface--centered">
        <div className="empty-state-panel">
          <h1 className="page-title">Replay Studio</h1>
          <p className="page-subtitle">
            {archiveUnavailable
              ? `Archive/API connection unavailable: ${sessionsError}`
              : "Choose a session from the archive to load the track map, timing tower, race control, and replay controls."}
          </p>
          <button className="empty-state-action" onClick={() => navigate("/")}>
            {archiveUnavailable ? "Check Archive" : "Open Archive"}
          </button>
        </div>
      </div>
    );
  }

  const circuitLabel = CIRCUIT_LABELS[activeSession.circuit_short_name] ?? activeSession.circuit_short_name;
  const sessionLabel = getDisplaySessionType(activeSession);
  const sessionYear = activeSession.year;

  // Stale: connected, session loaded, but no update for >5 seconds while playing.
  const dataAgeMs = lastStateUpdateAt !== null ? now - lastStateUpdateAt : null;
  const isStale = connected && isPlaying && dataAgeMs !== null && dataAgeMs > 5_000;
  // Partial: connected but tower hasn't arrived yet.
  const isPartial = connected && tower === null;
  const activePhaseKey = sessionPhases.find((phase) => {
    const phaseEnd = typeof phase.endReplayMs === "number" ? phase.endReplayMs : Number.POSITIVE_INFINITY;
    return replayStatus.currentReplayTimeMs >= phase.startReplayMs && replayStatus.currentReplayTimeMs < phaseEnd;
  })?.key;

  return (
    <div className="replay-root">
      <header className="replay-topbar">
        <button
          className="topbar-back"
          onClick={() => {
            clearActiveSession();
            navigate("/");
          }}
        >
          &#8592; Sessions
        </button>
        <div className="topbar-session">
          <div className="topbar-session-main">
            <span className="topbar-circuit">{circuitLabel}</span>
            {typeof sessionYear === "number" ? <span className="topbar-year">{sessionYear}</span> : null}
            <span className="topbar-type">{sessionLabel}</span>
            <span className="topbar-key">#{activeSession.session_key}</span>
            {isStale && (
              <span className="topbar-data-badge topbar-data-badge--stale" title={`No update for ${Math.round((dataAgeMs ?? 0) / 1000)}s`}>
                Stale
              </span>
            )}
            {!isStale && isPartial && (
              <span className="topbar-data-badge topbar-data-badge--partial" title="Waiting for first data snapshot">
                Loading
              </span>
            )}
          </div>
          {sessionPhases.length > 0 ? (
            <div className="topbar-phase-strip" aria-label="Session phases">
              {sessionPhases.map((phase) => (
                <button
                  key={phase.key}
                  className={`topbar-phase-chip ${activePhaseKey === phase.key ? "is-active" : ""}`}
                  onClick={() => seekTo(phase.startReplayMs)}
                  type="button"
                  title={`Jump to ${phase.label}`}
                >
                  {phase.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="topbar-live">
          <span className={`topbar-live-chip ${liveStatus?.connected ? "chip-on" : "chip-off"}`}>
            {liveStatus?.connected ? "Live On" : "Live Off"}
          </span>
          <button
            className="topbar-live-btn"
            onClick={liveStatus?.connected ? stopLive : startLive}
            disabled={liveBusy}
          >
            {liveBusy ? "Working..." : liveStatus?.connected ? "Stop Live" : "Start Live"}
          </button>
          {liveStatus ? <span className="topbar-live-metrics">{liveStatus.eventsEmitted} events</span> : null}
        </div>
        <div className={`topbar-status ${connected ? "status-on" : "status-off"}`}>
          <span className="status-dot" />
          {connected ? "WS Connected" : "WS Connecting..."}
        </div>
      </header>

      <main
        ref={mainRef}
        className="replay-main"
        style={
          canResize
            ? ({
                ["--replay-right-width" as string]: `${rightPaneWidth}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <section className="replay-left">
          <TrackMap
            layout={layout}
            layoutLoading={layoutLoading}
            tower={tower}
            locations={locations}
            replayTimeMs={replayStatus.currentReplayTimeMs}
            selectedDriver={selectedDriver}
            fallbackSeed={activeSession.circuit_short_name || String(activeSession.session_key)}
          />
        </section>
        <div
          className="replay-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize timing panel"
          onMouseDown={onSplitterMouseDown}
        />
        <section className="replay-right">
          {sessionsError || layoutError || sessionError ? (
            <div className="replay-right-errors">
              {sessionsError ? (
                <div className="replay-error-banner" role="alert">
                  Sessions error: {sessionsError}
                </div>
              ) : null}
              {layoutError ? (
                <div className="replay-error-banner" role="alert">
                  Layout error: {layoutError}
                </div>
              ) : null}
              {sessionError ? (
                <div className="replay-error-banner" role="alert">
                  Replay error: {sessionError}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="replay-right-panels">
            <TimingTower tower={tower} selectedDriver={selectedDriver} onSelectDriver={setSelectedDriver} />
            <TeamRadioFeed radios={radios} selectedDriver={selectedDriver} />
            <RaceControlFeed messages={raceControl} />
          </div>
        </section>
      </main>

      <PlaybackBar
        status={replayStatus}
        connected={connected}
        isPlaying={isPlaying}
        durationMs={replayStatus.durationMs}
        onPlay={play}
        onPause={pause}
        onRestart={restart}
        onSeekStart={() => seekTo(0)}
        onSeekEnd={() => seekTo(replayStatus.durationMs ?? replayStatus.currentReplayTimeMs)}
        onSeekBack={seekBack}
        onSeekForward={seekForward}
        onSeekTo={seekTo}
        onSpeedChange={setSpeed}
      />
    </div>
  );
}