import React, { useMemo, useState } from "react";
import type { DriverLocation, LayoutPoint, TowerDriver, TowerState } from "../types";
import { getDriver } from "../data/drivers";
import { CircuitAnnotation, CircuitGraphic, buildCircuitGeometry, mod1 } from "./CircuitGraphic";

interface Props {
  layout: LayoutPoint[] | null;
  layoutLoading: boolean;
  tower: TowerState | null;
  locations: DriverLocation[];
  replayTimeMs: number;
  selectedDriver?: number | null;
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
  focusSelectedDriver: boolean;
  showCornerMarkers: boolean;
  showSectorMarkers: boolean;
  showSpeedTrap: boolean;
  showSectorLeaders: boolean;
}

function formatSectorMs(ms?: number): string {
  if (!ms || ms <= 0) {
    return "--.---";
  }
  return (ms / 1000).toFixed(3);
}

function getFastestBy<T extends keyof TowerDriver>(drivers: TowerDriver[], key: T, direction: "min" | "max") {
  const valid = drivers.filter((driver) => typeof driver[key] === "number" && Number(driver[key]) > 0);
  if (valid.length === 0) {
    return null;
  }
  return [...valid].sort((a, b) => {
    const av = Number(a[key]);
    const bv = Number(b[key]);
    return direction === "min" ? av - bv : bv - av;
  })[0];
}

function deriveCornerAnnotations(geometry: ReturnType<typeof buildCircuitGeometry>, limit = 8): CircuitAnnotation[] {
  if (!geometry || geometry.points.length < 12) {
    return [];
  }

  const points = geometry.points;
  const candidates: Array<{ index: number; score: number }> = [];
  for (let index = 2; index < points.length - 2; index += 1) {
    const prev = points[index - 2];
    const point = points[index];
    const next = points[index + 2];
    const ax = point.x - prev.x;
    const ay = point.y - prev.y;
    const bx = next.x - point.x;
    const by = next.y - point.y;
    const al = Math.max(1, Math.hypot(ax, ay));
    const bl = Math.max(1, Math.hypot(bx, by));
    const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (al * bl)));
    const score = Math.abs(Math.acos(dot));
    if (score > 0.28) {
      candidates.push({ index, score });
    }
  }

  const minSpacing = Math.max(10, Math.floor(points.length / 10));
  const selected: Array<{ index: number; score: number }> = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (selected.every((entry) => Math.abs(entry.index - candidate.index) >= minSpacing)) {
      selected.push(candidate);
    }
    if (selected.length >= limit) {
      break;
    }
  }

  return selected
    .sort((a, b) => a.index - b.index)
    .map((entry, cornerIndex) => ({
      key: `corner-${entry.index}`,
      x: points[entry.index].x,
      y: points[entry.index].y,
      label: `T${cornerIndex + 1}`,
      color: "#9ad7ff",
      muted: true,
    }));
}

export function TrackMap({ layout, layoutLoading, tower, locations, replayTimeMs, selectedDriver, fallbackSeed }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<MapSettings>({
    showLabels: true,
    showTrails: true,
    showGlow: true,
    showPositionBadge: true,
    colorByTeam: true,
    focusSelectedDriver: true,
    showCornerMarkers: true,
    showSectorMarkers: true,
    showSpeedTrap: true,
    showSectorLeaders: true,
  });

  const geometry = useMemo(
    () => buildCircuitGeometry(layout, { width: SVG_W, height: SVG_H, pad: PAD, maxPoints: LAP_SAMPLE, fallbackSeed }),
    [fallbackSeed, layout],
  );

  const { annotations, driverDots, hasRealLayout, livePositionCount, selectedSummary } = useMemo(() => {
    if (!geometry) {
      return { annotations: [], driverDots: [], hasRealLayout: false, livePositionCount: 0, selectedSummary: null as string | null };
    }

    const drivers = tower?.drivers ?? [];
    const sorted = [...drivers].sort((a, b) => (a.position || 99) - (b.position || 99));
    const leader = sorted[0];
    const leaderLapMs = Math.max(65_000, Math.min(130_000, leader?.last_lap_ms || 90_000));
    const leaderPhase = mod1(replayTimeMs / leaderLapMs);
    const latestLocationByDriver = new Map(locations.map((entry) => [entry.driver_number, entry]));

    const centerX = SVG_W / 2;
    const centerY = SVG_H / 2;
    let realPositionCount = 0;
    const focusedDriver = selectedDriver != null ? sorted.find((driver) => driver.number === selectedDriver) ?? null : null;
    const focusSummary = focusedDriver
      ? `${focusedDriver.code} · P${focusedDriver.position} · ${focusedDriver.current_speed_kmh ? `${Math.round(focusedDriver.current_speed_kmh)}k` : "no live speed"}`
      : null;

    const markers = sorted.map((driver, rank) => {
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
        realPositionCount += 1;
      }

      const info = getDriver(driver.number);
      const driverCode = driver.code || info.code;
      const teamColor = driver.team_color ? `#${driver.team_color.replace(/^#/, "")}` : info.color;
      const driverColor = settings.colorByTeam ? teamColor : "#d9e3ff";
      const isSelected = selectedDriver != null && driver.number === selectedDriver;
      const isDimmed = settings.focusSelectedDriver && selectedDriver != null && !isSelected;

      const vx = svg.x - centerX;
      const vy = svg.y - centerY;
      const vLen = Math.max(1, Math.hypot(vx, vy));
      const unitX = vx / vLen;
      const unitY = vy / vLen;
      const labelDistance = 12 + (rank % 3) * 4;

      const tangentLen = Math.max(1, Math.hypot(svg.tx, svg.ty));
      const nx = -svg.ty / tangentLen;
      const ny = svg.tx / tangentLen;
      const trail = settings.showTrails && !isDimmed
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
        glow: settings.showGlow && !isDimmed,
        trail,
        badge: settings.showPositionBadge ? `P${driver.position}` : undefined,
        badgeX: settings.showPositionBadge ? svg.x + nx * 12 : undefined,
        badgeY: settings.showPositionBadge ? svg.y + ny * 12 : undefined,
        label: settings.showLabels ? driverCode : undefined,
        labelX: settings.showLabels ? svg.x + unitX * labelDistance : undefined,
        labelY: settings.showLabels ? svg.y + unitY * labelDistance : undefined,
        opacity: isDimmed ? 0.26 : 1,
        emphasized: isSelected,
      };
    });

    const nextAnnotations: CircuitAnnotation[] = [];
    if (settings.showCornerMarkers) {
      nextAnnotations.push(...deriveCornerAnnotations(geometry, 8));
    }

    const s1Leader = getFastestBy(sorted, "best_sector_1_ms", "min");
    const s2Leader = getFastestBy(sorted, "best_sector_2_ms", "min");
    const s3Leader = getFastestBy(sorted, "best_sector_3_ms", "min");
    const trapLeader = getFastestBy(sorted, "speed_trap_kmh", "max");

    if (settings.showSectorMarkers) {
      const sectorDefs = [
        { key: "s1", label: "S1", progress: 0.333, leader: s1Leader, detail: s1Leader ? `${s1Leader.code} ${formatSectorMs(s1Leader.best_sector_1_ms)}` : undefined, color: "#69f0c4" },
        { key: "s2", label: "S2", progress: 0.666, leader: s2Leader, detail: s2Leader ? `${s2Leader.code} ${formatSectorMs(s2Leader.best_sector_2_ms)}` : undefined, color: "#8cc8ff" },
        { key: "s3", label: "S3", progress: 0.02, leader: s3Leader, detail: s3Leader ? `${s3Leader.code} ${formatSectorMs(s3Leader.best_sector_3_ms)}` : undefined, color: "#ffd36b" },
      ];

      for (const sector of sectorDefs) {
        const point = geometry.pointAtProgress(sector.progress);
        nextAnnotations.push({
          key: sector.key,
          x: point.x,
          y: point.y,
          label: sector.label,
          detail: settings.showSectorLeaders ? sector.detail : undefined,
          color: sector.color,
        });
      }
    }

    if (settings.showSpeedTrap) {
      const point = geometry.pointAtProgress(0.92);
      nextAnnotations.push({
        key: "speed-trap",
        x: point.x,
        y: point.y,
        label: "TRAP",
        detail: trapLeader ? `${trapLeader.code} ${Math.round(trapLeader.speed_trap_kmh ?? 0)}k` : undefined,
        color: "#ff8f7c",
      });
    }

    return {
      annotations: nextAnnotations,
      driverDots: markers,
      hasRealLayout: geometry.hasRealLayout,
      livePositionCount: realPositionCount,
      selectedSummary: focusSummary,
    };
  }, [geometry, locations, replayTimeMs, selectedDriver, settings.colorByTeam, settings.focusSelectedDriver, settings.showCornerMarkers, settings.showGlow, settings.showLabels, settings.showPositionBadge, settings.showSectorLeaders, settings.showSectorMarkers, settings.showSpeedTrap, settings.showTrails, tower]);

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
          {selectedSummary ? <span className="track-focus-pill">Focus: {selectedSummary}</span> : null}
        </div>
      </div>

      {showSettings && (
        <div className="track-settings-panel">
          <label><input type="checkbox" checked={settings.showLabels} onChange={() => toggle("showLabels")} /> Driver labels</label>
          <label><input type="checkbox" checked={settings.showTrails} onChange={() => toggle("showTrails")} /> Motion trails</label>
          <label><input type="checkbox" checked={settings.showGlow} onChange={() => toggle("showGlow")} /> Car glow</label>
          <label><input type="checkbox" checked={settings.showPositionBadge} onChange={() => toggle("showPositionBadge")} /> Position badge</label>
          <label><input type="checkbox" checked={settings.colorByTeam} onChange={() => toggle("colorByTeam")} /> Team colors</label>
          <label><input type="checkbox" checked={settings.focusSelectedDriver} onChange={() => toggle("focusSelectedDriver")} /> Driver focus mode</label>
          <label><input type="checkbox" checked={settings.showCornerMarkers} onChange={() => toggle("showCornerMarkers")} /> Corner markers</label>
          <label><input type="checkbox" checked={settings.showSectorMarkers} onChange={() => toggle("showSectorMarkers")} /> Sector splits</label>
          <label><input type="checkbox" checked={settings.showSectorLeaders} onChange={() => toggle("showSectorLeaders")} /> Sector leaders</label>
          <label><input type="checkbox" checked={settings.showSpeedTrap} onChange={() => toggle("showSpeedTrap")} /> Speed trap</label>
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
          annotations={annotations}
          markers={driverDots}
        />
      )}
    </div>
  );
}