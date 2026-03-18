import React, { useEffect, useState } from "react";
import { useReplay } from "../app/providers/ReplayProvider";

interface ReplayBackendStatus {
  manifest?: { session_key?: number; circuit_short_name?: string; session_type?: string };
  clock?: { paused?: boolean; speed?: number; currentReplayTimeMs?: number };
  subscribers?: number;
}

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
    return "Replay backend unavailable. Start ./.tools/node/pnpm.cmd dev or ./.tools/node/pnpm.cmd dev:server.";
  }

  return `${fallback} (${response.status})`;
}

function formatAge(timestamp?: string): string {
  if (!timestamp) {
    return "No timestamp";
  }
  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return timestamp;
  }
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes}m ago`;
}

export function DiagnosticsPage() {
  const { backendHttp, activeSession, connected, liveStatus, liveError, sessionsError, layoutError, replayStatus, refreshLiveStatus } = useReplay();
  const [replayBackendStatus, setReplayBackendStatus] = useState<ReplayBackendStatus | null>(null);
  const [backendStatusError, setBackendStatusError] = useState<string | null>(null);

  useEffect(() => {
    void refreshLiveStatus();
    let cancelled = false;
    let activeController: AbortController | null = null;

    function fetchBackendStatus() {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;

      fetch(`${backendHttp}/api/replay/status`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(await getApiErrorMessage(response, "Replay status unavailable"));
          }
          return response.json();
        })
        .then((data: ReplayBackendStatus) => {
          if (cancelled) {
            return;
          }
          setReplayBackendStatus(data);
          setBackendStatusError(null);
        })
        .catch((err) => {
          if (cancelled || controller.signal.aborted) {
            return;
          }
          setReplayBackendStatus(null);
          setBackendStatusError(err instanceof Error ? err.message : "Replay status request failed");
        });
    }

    fetchBackendStatus();
    const id = window.setInterval(fetchBackendStatus, 3_000);
    return () => {
      cancelled = true;
      activeController?.abort();
      window.clearInterval(id);
    };
  }, [backendHttp, refreshLiveStatus]);

  return (
    <div className="page-surface">
      <header className="page-header">
        <h1 className="page-title">Diagnostics</h1>
        <p className="page-subtitle">
          First trust surface: replay link state, live ingest health, and the currently loaded session contract. Stale-source badges and drawer UX build from here.
        </p>
      </header>

      <div className="diagnostics-grid">
        <section className="inspector-card">
          <div className="inspector-kicker">Replay Link</div>
          <div className="stats-grid">
            <div className="metric-card">
              <span className="metric-label">WebSocket</span>
              <span className="metric-value">{connected ? "Connected" : "Disconnected"}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Speed</span>
              <span className="metric-value">{replayStatus.speed}x</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Clock</span>
              <span className="metric-value">{Math.round(replayStatus.currentReplayTimeMs / 1000)}s</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Session</span>
              <span className="metric-value">{activeSession ? `#${activeSession.session_key}` : "None loaded"}</span>
            </div>
          </div>
        </section>

        <section className="inspector-card">
          <div className="inspector-kicker">Live Ingest</div>
          <div className="stats-grid">
            <div className="metric-card">
              <span className="metric-label">Connected</span>
              <span className="metric-value">{liveStatus?.connected ? "Yes" : "No"}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Topics</span>
              <span className="metric-value">{liveStatus?.topicCount ?? 0}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Messages Seen</span>
              <span className="metric-value">{liveStatus?.messagesSeen ?? 0}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Events Emitted</span>
              <span className="metric-value">{liveStatus?.eventsEmitted ?? 0}</span>
            </div>
          </div>
          <div className="diagnostics-note">
            Last source message: {formatAge(liveStatus?.lastMessageAtUtc)}
          </div>
          {liveStatus?.lastError ? <div className="diagnostics-error">{liveStatus.lastError}</div> : null}
          {liveError ? <div className="diagnostics-error">{liveError}</div> : null}
        </section>

        <section className="inspector-card">
          <div className="inspector-kicker">Backend Snapshot</div>
          <div className="list-stack">
            <div className="list-row">
              <span className="list-row-title">Replay Subscribers</span>
              <span className="list-row-meta">{replayBackendStatus?.subscribers ?? 0}</span>
            </div>
            <div className="list-row">
              <span className="list-row-title">Backend Session</span>
              <span className="list-row-meta">
                {replayBackendStatus?.manifest?.circuit_short_name
                  ? `${replayBackendStatus.manifest.circuit_short_name} #${replayBackendStatus.manifest.session_key}`
                  : "No session loaded"}
              </span>
            </div>
            <div className="list-row">
              <span className="list-row-title">Backend Speed</span>
              <span className="list-row-meta">{replayBackendStatus?.clock?.speed ?? 1}x</span>
            </div>
            <div className="list-row">
              <span className="list-row-title">Backend Paused</span>
              <span className="list-row-meta">{replayBackendStatus?.clock?.paused ? "Yes" : "No"}</span>
            </div>
          </div>
          {backendStatusError ? <div className="diagnostics-error">{backendStatusError}</div> : null}
          {sessionsError ? <div className="diagnostics-error">Sessions: {sessionsError}</div> : null}
          {layoutError ? <div className="diagnostics-error">Layout: {layoutError}</div> : null}
        </section>
      </div>
    </div>
  );
}