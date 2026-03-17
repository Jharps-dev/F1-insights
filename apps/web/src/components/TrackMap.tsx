import React, { useMemo, useState } from "react";
import type { LayoutPoint, TowerState } from "../types";
import { getDriver } from "../data/drivers";

interface Props {
  layout: LayoutPoint[] | null;
  layoutLoading: boolean;
  tower: TowerState | null;
  replayTimeMs: number;
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

function simplifyLayout(points: LayoutPoint[], maxPoints = LAP_SAMPLE): LayoutPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }
  const step = Math.max(1, Math.floor(points.length / maxPoints));
  return points.filter((_, index) => index % step === 0);
}

function buildFallbackLayout(sampleCount = LAP_SAMPLE): LayoutPoint[] {
  const points: LayoutPoint[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = (i / sampleCount) * Math.PI * 2;
    const r = 1 + 0.22 * Math.sin(3 * t + 0.3) + 0.08 * Math.sin(7 * t);
    points.push({
      x: Math.cos(t) * r * 1000 + 120 * Math.sin(2 * t),
      y: Math.sin(t) * r * 760 + 80 * Math.sin(5 * t + 1.1),
    });
  }
  return points;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function mod1(value: number): number {
  return ((value % 1) + 1) % 1;
}

export function TrackMap({ layout, layoutLoading, tower, replayTimeMs }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<MapSettings>({
    showLabels: true,
    showTrails: true,
    showGlow: true,
    showPositionBadge: true,
    colorByTeam: true,
  });

  const { circuitPath, driverDots, hasRealLayout } = useMemo(() => {
    const sourceLayout = layout && layout.length > 8 ? layout : buildFallbackLayout();
    const simplifiedLayout = simplifyLayout(sourceLayout);
    const hasRealLayout = Boolean(layout && layout.length > 8);

    if (simplifiedLayout.length < 3) return { circuitPath: "", driverDots: [], hasRealLayout };

    // Bounding box
    const xs = simplifiedLayout.map((p) => p.x);
    const ys = simplifiedLayout.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    const scaleX = (SVG_W - PAD * 2) / rangeX;
    const scaleY = (SVG_H - PAD * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);

    // Center the circuit within viewport
    const offsetX = PAD + ((SVG_W - PAD * 2) - rangeX * scale) / 2;
    const offsetY = PAD + ((SVG_H - PAD * 2) - rangeY * scale) / 2;

    const toSvg = (p: LayoutPoint) => ({
      x: offsetX + (p.x - minX) * scale,
      // Flip Y: SVG Y increases downward, coordinate Y may increase upward
      y: SVG_H - offsetY - (p.y - minY) * scale,
    });

    // Build circuit polyline (closed loop).
    const pts = simplifiedLayout.map(toSvg);
    const pathParts = pts.map(({ x, y }, i) =>
      `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`
    );
    const circuitPath = pathParts.join(" ") + " Z";

    const cumulative: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      cumulative.push(cumulative[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const totalLength = cumulative[cumulative.length - 1] || 1;

    const pointAtProgress = (progress: number) => {
      const target = clamp01(progress) * totalLength;
      let lo = 0;
      let hi = cumulative.length - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (cumulative[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      const idx = Math.max(1, lo);
      const a = pts[idx - 1];
      const b = pts[idx] ?? a;
      const segLen = Math.max(1, cumulative[idx] - cumulative[idx - 1]);
      const segT = (target - cumulative[idx - 1]) / segLen;
      return {
        x: a.x + (b.x - a.x) * segT,
        y: a.y + (b.y - a.y) * segT,
        tx: b.x - a.x,
        ty: b.y - a.y,
      };
    };

    // Driver dots: leader sets global phase; others offset by gap-to-leader + ranking bias.
    const drivers = tower?.drivers ?? [];
    const sorted = [...drivers].sort((a, b) => (a.position || 99) - (b.position || 99));
    const leader = sorted[0];
    const leaderLapMs = Math.max(65_000, Math.min(130_000, leader?.last_lap_ms || 90_000));
    const leaderPhase = mod1(replayTimeMs / leaderLapMs);

    const centerX = SVG_W / 2;
    const centerY = SVG_H / 2;

    const driverDots = sorted.map((d, rank) => {
      const lapMs = Math.max(65_000, Math.min(130_000, d.last_lap_ms || leaderLapMs));
      const gapMs = typeof d.gap_to_leader_ms === "number" ? d.gap_to_leader_ms : 0;
      const gapFraction = gapMs > 0 ? gapMs / lapMs : 0;
      const separationBias = rank * 0.0016;
      const phase = mod1(leaderPhase - gapFraction - separationBias);
      const svg = pointAtProgress(phase);
      const info = getDriver(d.number);
      const driverCode = d.code || info.code;
      const teamColor = d.team_color ? `#${d.team_color.replace(/^#/, "")}` : info.color;
      const driverColor = settings.colorByTeam ? teamColor : "#d9e3ff";

      // Radial label offset reduces collisions when cars bunch up.
      const vx = svg.x - centerX;
      const vy = svg.y - centerY;
      const vLen = Math.max(1, Math.sqrt(vx * vx + vy * vy));
      const unitX = vx / vLen;
      const unitY = vy / vLen;
      const labelDistance = 12 + (rank % 3) * 4;

      const tangentLen = Math.max(1, Math.sqrt(svg.tx * svg.tx + svg.ty * svg.ty));
      const nx = -svg.ty / tangentLen;
      const ny = svg.tx / tangentLen;
      const trail = settings.showTrails
        ? [1, 2, 3, 4].map((step) => {
            const p = pointAtProgress(mod1(phase - step * 0.007));
            return { x: p.x, y: p.y, opacity: Math.max(0.12, 0.42 - step * 0.08) };
          })
        : [];

      return {
        number: d.number,
        code: driverCode,
        color: driverColor,
        teamColor,
        cx: svg.x,
        cy: svg.y,
        nx,
        ny,
        trail,
        lx: svg.x + unitX * labelDistance,
        ly: svg.y + unitY * labelDistance,
        position: d.position,
      };
    });

    return { circuitPath, driverDots, hasRealLayout };
  }, [layout, replayTimeMs, settings.colorByTeam, settings.showTrails, tower]);

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

      {circuitPath && (
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="track-svg"
          aria-label="Circuit map"
        >
          {/* === Circuit rendering: ambient → curb edge → tarmac surface === */}
          {/* 1. Soft outer ambient glow */}
          <path
            d={circuitPath}
            fill="none"
            stroke="rgba(180,190,220,0.04)"
            strokeWidth="28"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* 2. Curb / border highlight — bright off-white */}
          <path
            d={circuitPath}
            fill="none"
            stroke="rgba(230,235,255,0.72)"
            strokeWidth="13"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* 3. Tarmac road surface — dark asphalt */}
          <path
            d={circuitPath}
            fill="none"
            stroke="#1c1f28"
            strokeWidth="9"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* 4. Subtle centerline dashes */}
          <path
            d={circuitPath}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="1"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray="5 9"
          />

          {/* Driver dots */}
          {driverDots.map((d) => (
            <g key={d.number} className="driver-dot-group">
              {d.trail.map((p, idx) => (
                <circle key={`${d.number}-trail-${idx}`} cx={p.x} cy={p.y} r={4 - idx * 0.5} fill={d.color} opacity={p.opacity} />
              ))}
              {/* Glow ring */}
              {settings.showGlow && <circle cx={d.cx} cy={d.cy} r={13} fill={d.color} opacity={0.28} />}
              {settings.showGlow && <circle cx={d.cx} cy={d.cy} r={8} fill={d.color} opacity={0.18} />}
              {/* Dot */}
              <circle cx={d.cx} cy={d.cy} r={6.5} fill={d.color} stroke="#0a0c12" strokeWidth={2} />
              {settings.showPositionBadge && (
                <text
                  x={d.cx + d.nx * 12}
                  y={d.cy + d.ny * 12}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.95)"
                  fontSize="8"
                  fontFamily="ui-monospace, monospace"
                  fontWeight="700"
                >
                  P{d.position}
                </text>
              )}
              {/* Label */}
              {settings.showLabels && (
                <g>
                  {/* label backing for readability */}
                  <text
                    x={d.lx}
                    y={d.ly}
                    textAnchor="middle"
                    fill="rgba(0,0,0,0.75)"
                    fontSize="9"
                    fontFamily="ui-monospace, monospace"
                    fontWeight="700"
                    strokeWidth={3}
                    stroke="rgba(0,0,0,0.75)"
                    paintOrder="stroke"
                  >
                    {d.code}
                  </text>
                  <text
                    x={d.lx}
                    y={d.ly}
                    textAnchor="middle"
                    fill={d.color}
                    fontSize="9"
                    fontFamily="ui-monospace, monospace"
                    fontWeight="700"
                  >
                    {d.code}
                  </text>
                </g>
              )}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
