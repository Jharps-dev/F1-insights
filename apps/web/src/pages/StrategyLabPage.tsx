import React from "react";
import { useNavigate } from "react-router-dom";
import { useReplay } from "../app/providers/ReplayProvider";

function fmtMs(ms?: number | null): string {
  if (ms == null || ms <= 0) return "--";
  const totalSeconds = ms / 1000;
  const mins = Math.floor(totalSeconds / 60);
  const secs = (totalSeconds % 60).toFixed(3).padStart(6, "0");
  return mins > 0 ? `${mins}:${secs}` : secs;
}

function fmtInterval(ms?: number | null): string {
  if (ms == null) return "--";
  if (ms === 0) return "0.000s";
  return `${(ms / 1000).toFixed(3)}s`;
}

export function StrategyLabPage() {
  const navigate = useNavigate();
  const { activeSession, tower, stints, insights } = useReplay();

  if (!activeSession || !tower) {
    return (
      <div className="page-surface page-surface--centered">
        <div className="empty-state-panel">
          <h1 className="page-title">Strategy Lab</h1>
          <p className="page-subtitle">
            This route is ready for stint summaries and gaining-losing insights. Load a replay so the first analytics layer has a live state to read from.
          </p>
          <button className="empty-state-action" onClick={() => navigate("/")}>
            Choose Session
          </button>
        </div>
      </div>
    );
  }

  const tyreLeaders = [...tower.drivers]
    .filter((driver) => driver.tyre_compound)
    .sort((a, b) => (b.tyre_age ?? 0) - (a.tyre_age ?? 0))
    .slice(0, 6);

  const closestBattle = [...tower.drivers]
    .filter((driver) => typeof driver.interval_to_ahead_ms === "number")
    .sort((a, b) => (a.interval_to_ahead_ms ?? 999999) - (b.interval_to_ahead_ms ?? 999999))[0];

  const standoutStints = [...stints]
    .sort((a, b) => (a.degradation_rate ?? 0) - (b.degradation_rate ?? 0))
    .slice(0, 6);

  return (
    <div className="page-surface">
      <header className="page-header">
        <h1 className="page-title">Strategy Lab</h1>
        <p className="page-subtitle">
          First analytics layer from the replay engine: lap-window interval trends, stint summaries, and explainable gaining-losing cards generated from the deterministic event stream.
        </p>
      </header>

      <div className="strategy-grid">
        <section className="inspector-card inspector-card--hero">
          <div className="inspector-kicker">Insight Cards</div>
          <div className="insight-stack">
            {insights.length > 0 ? (
              insights.map((insight) => (
                <div className={`insight-card insight-card--${insight.kind}`} key={insight.id}>
                  <div className="insight-card-head">
                    <span className="insight-card-kind">{insight.kind.replace("_", " ")}</span>
                    <span className="insight-card-confidence">{insight.confidence}</span>
                  </div>
                  <div className="strategy-highlight-title">{insight.headline}</div>
                  <p className="strategy-highlight-copy">{insight.rationale}</p>
                </div>
              ))
            ) : closestBattle ? (
              <div className="strategy-highlight">
                <div className="strategy-highlight-title">
                  {closestBattle.code} is {fmtInterval(closestBattle.interval_to_ahead_ms)} behind the car ahead
                </div>
                <p className="strategy-highlight-copy">
                  Interval history has not formed yet. Once a few timed laps accumulate, this panel becomes stable gaining-losing analysis rather than a single snapshot.
                </p>
              </div>
            ) : (
              <div className="strategy-highlight-copy">No interval data yet for this replay segment.</div>
            )}
          </div>
        </section>

        <section className="inspector-card">
          <div className="inspector-kicker">Stint Summaries</div>
          <div className="list-stack">
            {standoutStints.length > 0
              ? standoutStints.map((stint) => {
                  const driver = tower.drivers.find((entry) => entry.number === stint.driver_number);
                  return (
                    <div className="list-row" key={`${stint.driver_number}-${stint.stint_number}`}>
                      <span className="list-row-title">
                        {driver?.code || stint.driver_number} stint {stint.stint_number}
                      </span>
                      <span className="list-row-meta">
                        {stint.tyre_compound} · avg {fmtMs(stint.pace_mean_ms)} · deg {stint.degradation_rate ?? "--"} ms/lap
                      </span>
                    </div>
                  );
                })
              : tyreLeaders.map((driver) => (
              <div className="list-row" key={driver.number}>
                <span className="list-row-title">{driver.code}</span>
                <span className="list-row-meta">{driver.tyre_compound} · {driver.tyre_age ?? 0} laps</span>
              </div>
                ))}
          </div>
        </section>
      </div>
    </div>
  );
}