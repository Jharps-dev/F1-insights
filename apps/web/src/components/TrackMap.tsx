import React, { useMemo, useState } from "react";
import type { DriverLocation, LayoutPoint, TowerState } from "../types";
import { getDriver } from "../data/drivers";
import { CircuitGraphic, buildCircuitGeometry, mod1 } from "./CircuitGraphic";

interface Props {
  layout: LayoutPoint[] | null;
  layoutLoading: boolean;
  tower: TowerState | null;
  locations: DriverLocation[];
  replayTimeMs: number;
  fallbackSeed?: string;
}

const SVG_W = 560;
const SVG_H = 420;
const PAD = 36;
const LAP_SAMPLE = 480;

interface MapSettings {
  showLabels: boolean;
  showTrails: boolean;
  showGlow: boolean;
  showPositionBadge: boolean;
  colorByTeam: boolean;
}

export function TrackMap({ layout, layoutLoading, tower, locations, replayTimeMs, fallbackSeed }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<MapSettings>({
    showLabels: true,
    showTrails: true,
    showGlow: true,
    showPositionBadge: true,
    colorByTeam: true,
  });

  const geometry = useMemo(
    () => buildCircuitGeometry(layout, { width: SVG_W, height: SVG_H, pad: PAD, maxPoints: LAP_SAMPLE, fallbackSeed }),
    [fallbackSeed, layout],
  );

  const { driverDots, hasRealLayout, livePositionCount } = useMemo(() => {
    if (!geometry) {
      return { driverDots: [], hasRealLayout: false, livePositionCount: 0 };
    }

    const drivers = tower?.drivers ?? [];
    const sorted = [...drivers].sort((a, b) => (a.position || 99) - (b.position || 99));
    const leader = sorted[0];
    const leaderLapMs = Math.max(65_000, Math.min(130_000, leader?.last_lap_ms || 90_000));
    const leaderPhase = mod1(replayTimeMs / leaderLapMs);
    const latestLocationByDriver = new Map(locations.map((entry) => [entry.driver_number, entry]));

    const centerX = SVG_W / 2;
    const centerY = SVG_H / 2;
    let livePositionCount = 0;

    const driverDots = sorted.map((driver, rank) => {
      const exactLocation = latestLocationByDriver.get(driver.number);
      const lapMs = Math.max(65_000, Math.min(130_000, driver.last_lap_ms || leaderLapMs));
      const gapMs = typeof driver.gap_to_leader_ms === "number" ? driver.gap_to_leader_ms : 0;
      const gapFraction = gapMs > 0 ? gapMs / lapMs : 0;
      const separationBias = rank * 0.0016;
      const fallbackPhase = mod1(leaderPhase - gapFraction - separationBias);

      const exactSvg = exactLocation ? geometry.toSvgPoint({ x: exactLocation.x, y: exactLocation.y }) : null;
      const phase = exactSvg ? geometry.nearestProgressForPoint(exactSvg) : fallbackPhase;
      const svg = exactSvg ? { ...geometry.pointAtProgress(phase), x: exactSvg.x, y: exactSvg.y } : geometry.pointAtProgress(phase);
      if (exactSvg) {
        livePositionCount += 1;
      }

      const info = getDriver(driver.number);
      const driverCode = driver.code || info.code;
      const teamColor = driver.team_color ? `#${driver.team_color.replace(/^#/, "")}` : info.color;
      const driverColor = settings.colorByTeam ? teamColor : "#d9e3ff";

      const vx = svg.x - centerX;
      const vy = svg.y - centerY;
      const vLen = Math.max(1, Math.hypot(vx, vy));
      const unitX = vx / vLen;
      const unitY = vy / vLen;
      const labelDistance = 12 + (rank % 3) * 4;

      const tangentLen = Math.max(1, Math.hypot(svg.tx, svg.ty));
      const nx = -svg.ty / tangentLen;
      const ny = svg.tx / tangentLen;
      const trail = settings.showTrails
        ? [1, 2, 3, 4].map((step) => {
            const point = geometry.pointAtProgress(mod1(phase - step * 0.007));
            return {
              x: point.x,
              y: point.y,
              opacity: Math.max(0.12, 0.42 - step * 0.08),
            };
          })
        : [];

      return {
        key: driver.number,
        x: svg.x,
        y: svg.y,
        color: driverColor,
        glow: settings.showGlow,
        trail,
        badge: settings.showPositionBadge ? `P${driver.position}` : undefined,
        badgeX: settings.showPositionBadge ? svg.x + nx * 12 : undefined,
        badgeY: settings.showPositionBadge ? svg.y + ny * 12 : undefined,
        label: settings.showLabels ? driverCode : undefined,
        labelX: settings.showLabels ? svg.x + unitX * labelDistance : undefined,
        labelY: settings.showLabels ? svg.y + unitY * labelDistance : undefined,
      };
    });

    return { driverDots, hasRealLayout: geometry.hasRealLayout, livePositionCount };
  }, [geometry, locations, replayTimeMs, settings.colorByTeam, settings.showGlow, settings.showLabels, settings.showPositionBadge, settings.showTrails, tower]);

  const toggle = (key: keyof MapSettings) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="track-map-panel">
      <div className="panel-header">
        <span>CIRCUIT MAP</span>
        <div className="track-map-header-actions">
          <button className="track-settings-btn" onClick={() => setShowSettings((s) => !s)}>
            {showSettings ? "Hide Settings" : "Map Settings"}
          </button>
          <span className={`panel-badge ${hasRealLayout ? "track-badge-fixed" : "approximate-badge"}`}>
            {hasRealLayout ? "fixed track" : "fallback track"}
          </span>
          <span className={`panel-badge ${livePositionCount > 0 ? "track-badge-fixed" : "approximate-badge"}`}>
            {livePositionCount > 0 ? `${livePositionCount} real positions` : "projected positions"}
          </span>
        </div>
      </div>

      {showSettings && (
        <div className="track-settings-panel">
          <label><input type="checkbox" checked={settings.showLabels} onChange={() => toggle("showLabels")} /> Driver labels</label>
          <label><input type="checkbox" checked={settings.showTrails} onChange={() => toggle("showTrails")} /> Motion trails</label>
          <label><input type="checkbox" checked={settings.showGlow} onChange={() => toggle("showGlow")} /> Car glow</label>
          <label><input type="checkbox" checked={settings.showPositionBadge} onChange={() => toggle("showPositionBadge")} /> Position badge</label>
          <label><input type="checkbox" checked={settings.colorByTeam} onChange={() => toggle("colorByTeam")} /> Team colors</label>
        </div>
      )}

      {layoutLoading && !hasRealLayout && (
        <div className="track-placeholder">
          <div className="track-spinner" />
          <p>Fetching circuit layout from OpenF1…</p>
        </div>
      )}

      {geometry && (
        <CircuitGraphic
          geometry={geometry}
          width={SVG_W}
          height={SVG_H}
          title="Circuit map"
          className="track-svg"
          variant="map"
          markers={driverDots}
        />
      )}
    </div>
  );
}
