import React from "react";
import type { TowerState, TowerDriver } from "../types";
import { getDriver } from "../data/drivers";

interface Props {
  tower: TowerState | null;
  selectedDriver: number | null;
  onSelectDriver: (num: number) => void;
}

function fmtMs(ms?: number | null): string {
  if (!ms || ms <= 0) return "–";
  const totalSeconds = ms / 1000;
  const mins = Math.floor(totalSeconds / 60);
  const secs = (totalSeconds % 60).toFixed(3).padStart(6, "0");
  return mins > 0 ? `${mins}:${secs}` : secs;
}

function fmtGap(ms?: number | null): string {
  if (ms == null) return "–";
  if (ms === 0) return "LEADER";
  const sign = ms < 0 ? "-" : "+";
  return `${sign}${fmtMs(Math.abs(ms))}`;
}

const TYRE_COLORS: Record<string, string> = {
  SOFT: "#E8002D",
  MEDIUM: "#FFF200",
  HARD: "#FFFFFF",
  INTERMEDIATE: "#39B54A",
  WET: "#005AFF",
};

function TyreChip({ compound, age }: { compound?: string; age?: number }) {
  if (!compound) return <span className="tyre-chip tyre-unknown">–</span>;
  const color = TYRE_COLORS[compound.toUpperCase()] ?? "#888";
  return (
    <span className="tyre-chip" style={{ borderColor: color, color }}>
      {compound[0]}
      {age != null && <sup>{age}</sup>}
    </span>
  );
}

function SectorDot({ state }: { state?: string }) {
  let cls = "sector-dot";
  if (state === "sb") cls += " sector-sb";
  else if (state === "pb") cls += " sector-pb";
  else if (state === "slow") cls += " sector-slow";
  return <span className={cls} />;
}

export function TimingTower({ tower, selectedDriver, onSelectDriver }: Props) {
  const drivers = tower?.drivers ?? [];

  return (
    <div className="tower-panel">
      <div className="panel-header">
        <span>LIVE TIMING</span>
        {tower?.lap && <span className="panel-badge">LAP {tower.lap}</span>}
      </div>

      {drivers.length === 0 && (
        <div className="tower-empty">Waiting for session data…</div>
      )}

      {drivers.length > 0 && (
        <div className="tower-table">
          <div className="tower-head">
            <span>POS</span>
            <span>DRIVER</span>
            <span>TYRE</span>
            <span>LAST LAP</span>
            <span>BEST</span>
            <span>GAP</span>
            <span>S1 S2 S3</span>
          </div>

          {drivers.map((d: TowerDriver) => {
            const info = getDriver(d.number);
            const driverCode = d.code || info.code;
            const driverName = d.name || info.name;
            const driverColor = d.team_color ? `#${d.team_color.replace(/^#/, "")}` : info.color;
            const isSelected = d.number === selectedDriver;
            return (
              <div
                key={d.number}
                className={`tower-row ${isSelected ? "tower-row-selected" : ""}`}
                onClick={() => onSelectDriver(d.number)}
                style={{ "--team-color": driverColor } as React.CSSProperties}
              >
                <span className="tower-pos">{d.position > 0 ? d.position : "–"}</span>
                <span className="tower-driver">
                  <span className="driver-num" style={{ color: driverColor }}>
                    {d.number}
                  </span>
                  <span className="driver-code">{driverCode}</span>
                  <span className="driver-name-short">{driverName.split(" ")[1] ?? driverName}</span>
                </span>
                <span className="tower-tyre">
                  <TyreChip compound={d.tyre_compound} age={d.tyre_age} />
                </span>
                <span className="tower-last">{fmtMs(d.last_lap_ms)}</span>
                <span className="tower-best">{fmtMs(d.best_lap_ms)}</span>
                <span className="tower-gap">{fmtGap(d.gap_to_leader_ms)}</span>
                <span className="tower-sectors">
                  {[0, 1, 2].map((i) => (
                    <SectorDot key={i} state={d.sectors_state?.[i]} />
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
