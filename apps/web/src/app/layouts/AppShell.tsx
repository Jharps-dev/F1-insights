import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useReplay } from "../providers/ReplayProvider";

function getNavClassName({ isActive }: { isActive: boolean }) {
  return `app-shell-link${isActive ? " app-shell-link--active" : ""}`;
}

export function AppShell() {
  const { activeSession, connected, liveStatus, sessionsError } = useReplay();

  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <NavLink to="/" className="app-shell-brand">
          <span className="app-shell-brand-f1">F1</span>
          <span className="app-shell-brand-text">Insights</span>
        </NavLink>

        <nav className="app-shell-nav" aria-label="Primary">
          <NavLink to="/" end className={getNavClassName}>
            Home
          </NavLink>
          <NavLink to={activeSession ? `/replay/${activeSession.session_key}` : "/replay"} className={getNavClassName}>
            Replay Studio
          </NavLink>
          <NavLink to="/drivers" className={getNavClassName}>
            Driver Inspector
          </NavLink>
          <NavLink to="/strategy" className={getNavClassName}>
            Strategy Lab
          </NavLink>
          <NavLink to="/diagnostics" className={getNavClassName}>
            Diagnostics
          </NavLink>
        </nav>

        <div className="app-shell-statusbar">
          <span className={`app-shell-chip ${connected ? "app-shell-chip--good" : "app-shell-chip--warn"}`}>
            {connected ? "Replay Linked" : "Replay Idle"}
          </span>
          <span className={`app-shell-chip ${liveStatus?.connected ? "app-shell-chip--good" : "app-shell-chip--muted"}`}>
            {liveStatus?.connected ? "Live Active" : "Live Off"}
          </span>
          {activeSession ? (
            <span className="app-shell-session-ref">
              {activeSession.circuit_short_name} #{activeSession.session_key}
            </span>
          ) : (
            <span className="app-shell-session-ref">Archive Mode</span>
          )}
        </div>
      </header>

      {sessionsError ? (
        <div className="app-shell-alert" role="alert">
          Archive/API connection issue: {sessionsError}
        </div>
      ) : null}

      <div className="app-shell-main">
        <Outlet />
      </div>
    </div>
  );
}