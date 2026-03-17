import React from "react";
import { useNavigate } from "react-router-dom";
import { TimingTower } from "../components/TimingTower";
import { useReplay } from "../app/providers/ReplayProvider";

function formatLap(ms?: number | null): string {
  if (!ms || ms <= 0) {
    return "--";
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${minutes}:${seconds}`;
}

export function DriverInspectorPage() {
  const navigate = useNavigate();
  const { activeSession, tower, selectedDriver, setSelectedDriver } = useReplay();

  if (!activeSession || !tower) {
    return (
      <div className="page-surface page-surface--centered">
        <div className="empty-state-panel">
          <h1 className="page-title">Driver Inspector</h1>
          <p className="page-subtitle">
            Load a replay session first. This area is where driver-focused comparisons, pace detail, and telemetry overlays will live.
          </p>
          <button className="empty-state-action" onClick={() => navigate("/")}>
            Choose Session
          </button>
        </div>
      </div>
    );
  }

  const focusDriver =
    tower.drivers.find((driver) => driver.number === selectedDriver) ?? tower.drivers[0] ?? null;

  return (
    <div className="page-surface">
      <header className="page-header">
        <h1 className="page-title">Driver Inspector</h1>
        <p className="page-subtitle">
          Focus a single driver while keeping the live timing context visible. Telemetry overlays and rival compare sit naturally on top of this view.
        </p>
      </header>

      <div className="driver-inspector-grid">
        <section className="inspector-card inspector-card--hero">
          {focusDriver ? (
            <>
              <div className="inspector-kicker">Selected Driver</div>
              <div className="inspector-driver-row">
                <div className="inspector-driver-meta">
                  <h2 className="inspector-driver-name">{focusDriver.name || focusDriver.code}</h2>
                  <p className="inspector-driver-team">{focusDriver.team || "Team pending"}</p>
                </div>
                <div className="inspector-driver-position">P{focusDriver.position}</div>
              </div>

              <div className="inspector-stats-grid">
                <div className="metric-card">
                  <span className="metric-label">Last Lap</span>
                  <span className="metric-value">{formatLap(focusDriver.last_lap_ms)}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Best Lap</span>
                  <span className="metric-value">{formatLap(focusDriver.best_lap_ms)}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Gap To Leader</span>
                  <span className="metric-value">{focusDriver.gap_to_leader_ms ?? "--"} ms</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Tyre Window</span>
                  <span className="metric-value">{focusDriver.tyre_compound || "--"} · {focusDriver.tyre_age ?? 0} laps</span>
                </div>
              </div>
            </>
          ) : null}
        </section>

        <section className="inspector-card">
          <div className="inspector-kicker">Session Context</div>
          <TimingTower tower={tower} selectedDriver={selectedDriver} onSelectDriver={setSelectedDriver} />
        </section>
      </div>
    </div>
  );
}