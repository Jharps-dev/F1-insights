import React from "react";
import { useNavigate } from "react-router-dom";
import { TeamRadioFeed } from "../components/TeamRadioFeed";
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

  function formatGap(ms?: number | null): string {
    if (ms == null) {
      return "--";
    }
    if (ms === 0) {
      return "LEADER";
    }
    const sign = ms < 0 ? "-" : "+";
    return `${sign}${formatLap(Math.abs(ms))}`;
  }

export function DriverInspectorPage() {
  const navigate = useNavigate();
  const { activeSession, tower, radios, selectedDriver, setSelectedDriver, sessionsError } = useReplay();

  if (!activeSession || !tower) {
    return (
      <div className="page-surface page-surface--centered">
        <div className="empty-state-panel">
          <h1 className="page-title">Driver Inspector</h1>
          <p className="page-subtitle">
            {sessionsError
              ? `Archive/API connection unavailable: ${sessionsError}`
              : "Load a replay session first. This area is where driver-focused comparisons, pace detail, and telemetry overlays will live."}
          </p>
          <button className="empty-state-action" onClick={() => navigate("/")}>
            {sessionsError ? "Open Archive" : "Choose Session"}
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
                  <span className="metric-value">{formatGap(focusDriver.gap_to_leader_ms)}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Tyre Window</span>
                  <span className="metric-value">
                    {focusDriver.tyre_compound || "--"}
                    {focusDriver.tyre_age != null ? ` · ${focusDriver.tyre_age} laps` : ""}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Live Speed</span>
                  <span className="metric-value">{focusDriver.current_speed_kmh ? `${Math.round(focusDriver.current_speed_kmh)} km/h` : "--"}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Pit Count</span>
                  <span className="metric-value">{focusDriver.pit_count ?? 0}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Best Sectors</span>
                  <span className="metric-value">
                    {formatLap(focusDriver.best_sector_1_ms).replace(/^0:/, "")}
                    {" / "}
                    {formatLap(focusDriver.best_sector_2_ms).replace(/^0:/, "")}
                    {" / "}
                    {formatLap(focusDriver.best_sector_3_ms).replace(/^0:/, "")}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Speed Trap</span>
                  <span className="metric-value">{focusDriver.speed_trap_kmh ? `${Math.round(focusDriver.speed_trap_kmh)} km/h` : "--"}</span>
                </div>
              </div>
            </>
          ) : null}
        </section>

        <section className="inspector-card">
          <div className="inspector-kicker">Session Context</div>
          <TimingTower tower={tower} selectedDriver={selectedDriver} onSelectDriver={setSelectedDriver} />
        </section>

        <section className="inspector-card">
          <div className="inspector-kicker">Radio Sync</div>
          <TeamRadioFeed radios={radios} selectedDriver={selectedDriver} defaultMode="selected" />
        </section>
      </div>
    </div>
  );
}