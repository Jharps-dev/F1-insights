import React, { useEffect, useMemo, useState } from "react";
import type { LayoutPoint, SessionManifest } from "../types";

interface Props {
  sessions: SessionManifest[];
  loading: boolean;
  onSelect: (session: SessionManifest) => void;
}

type NavState =
  | { view: "home" }
  | { view: "year"; year: number }
  | { view: "circuit"; year: number; circuit: string };

const CIRCUIT_META: Record<string, { flag: string; country: string }> = {
  Sakhir:        { flag: "🇧🇭", country: "Bahrain" },
  Jeddah:        { flag: "🇸🇦", country: "Saudi Arabia" },
  Melbourne:     { flag: "🇦🇺", country: "Australia" },
  Suzuka:        { flag: "🇯🇵", country: "Japan" },
  Shanghai:      { flag: "🇨🇳", country: "China" },
  Miami:         { flag: "🇺🇸", country: "United States" },
  Imola:         { flag: "🇮🇹", country: "Italy" },
  Monaco:        { flag: "🇲🇨", country: "Monaco" },
  Montreal:      { flag: "🇨🇦", country: "Canada" },
  Barcelona:     { flag: "🇪🇸", country: "Spain" },
  Spielberg:     { flag: "🇦🇹", country: "Austria" },
  Silverstone:   { flag: "🇬🇧", country: "Great Britain" },
  Budapest:      { flag: "🇭🇺", country: "Hungary" },
  Spa:           { flag: "🇧🇪", country: "Belgium" },
  Zandvoort:     { flag: "🇳🇱", country: "Netherlands" },
  Monza:         { flag: "🇮🇹", country: "Italy" },
  Baku:          { flag: "🇦🇿", country: "Azerbaijan" },
  Singapore:     { flag: "🇸🇬", country: "Singapore" },
  Austin:        { flag: "🇺🇸", country: "United States" },
  "Mexico City": { flag: "🇲🇽", country: "Mexico" },
  "São Paulo":   { flag: "🇧🇷", country: "Brazil" },
  "Las Vegas":   { flag: "🇺🇸", country: "Las Vegas, USA" },
  Lusail:        { flag: "🇶🇦", country: "Qatar" },
  "Abu Dhabi":   { flag: "🇦🇪", country: "UAE" },
  Bahrain:       { flag: "🇧🇭", country: "Bahrain" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSeasonYear(s: SessionManifest): number {
  if (typeof s.year === "number") return s.year;
  const raw = s.date_start_utc || s.created_utc;
  if (!raw) return 0;
  const v = new Date(raw).getUTCFullYear();
  return Number.isFinite(v) ? v : 0;
}

function getSortTime(s: SessionManifest): number {
  const raw = s.date_start_utc || s.created_utc;
  if (!raw) return 0;
  const v = new Date(raw).getTime();
  return Number.isFinite(v) ? v : 0;
}

function fmtShort(utc: string): string {
  try {
    return new Date(utc).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch { return ""; }
}

function fmtFull(utc: string): string {
  try {
    return new Date(utc).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" });
  } catch { return ""; }
}

function fmtTime(utc: string): string {
  try {
    return new Date(utc).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  } catch { return ""; }
}

interface TypeMeta { label: string; cls: string; order: number }

function getTypeMeta(s: SessionManifest): TypeMeta {
  const name = (s.session_name || "").toLowerCase();
  if (name.includes("sprint qualifying") || name.includes("sprint shootout"))
    return { label: "Sprint Qualifying", cls: "type-sprint-q", order: 4 };
  if (name.includes("sprint"))
    return { label: "Sprint", cls: "type-sprint", order: 5 };
  const type = (s.session_type || "").toLowerCase();
  if (type === "practice") {
    const m = (s.session_name || "").match(/(\d+)/);
    const n = m ? parseInt(m[1], 10) : 9;
    return { label: s.session_name || "Practice", cls: "type-practice", order: n };
  }
  if (type === "qualifying") return { label: "Qualifying", cls: "type-quali", order: 6 };
  if (type === "race") return { label: "Race", cls: "type-race", order: 7 };
  return { label: s.session_type, cls: "", order: 99 };
}

function chipLabel(label: string): string {
  if (label === "Sprint Qualifying") return "SQ";
  if (label === "Sprint") return "S";
  if (label === "Qualifying") return "Q";
  if (label === "Race") return "R";
  const m = label.match(/\d+/);
  if (m) return `P${m[0]}`;
  return label.slice(0, 2).toUpperCase();
}

// ── Data models ───────────────────────────────────────────────────────────────

interface CircuitGroup {
  circuit: string;
  sessions: SessionManifest[];
  firstDate: number;
  lastDate: number;
  gpName: string;
  hasSprint: boolean;
}

interface SeasonGroup {
  year: number;
  circuits: CircuitGroup[];
  totalSessions: number;
  sprintWeekends: number;
  raceCount: number;
}

const layoutCache = new Map<number, LayoutPoint[] | null>();

function sampleLayoutPoints(points: LayoutPoint[], targetPoints = 240): LayoutPoint[] {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }
  const sampleStep = Math.max(1, Math.floor(points.length / targetPoints));
  return points
    .filter((_, i) => i % sampleStep === 0)
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function isUsableLayout(points: LayoutPoint[]): boolean {
  const sampled = sampleLayoutPoints(points, 320);
  if (sampled.length < 20) {
    return false;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of sampled) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  if (spanX < 80 || spanY < 80) {
    return false;
  }

  const major = Math.max(spanX, spanY);
  const minor = Math.max(1, Math.min(spanX, spanY));
  if (major / minor > 12) {
    return false;
  }

  let pathLength = 0;
  const buckets = new Set<string>();
  for (let i = 1; i < sampled.length; i += 1) {
    const a = sampled[i - 1];
    const b = sampled[i];
    pathLength += Math.hypot(b.x - a.x, b.y - a.y);
  }
  for (const p of sampled) {
    buckets.add(`${Math.round((p.x - minX) / 20)}:${Math.round((p.y - minY) / 20)}`);
  }

  return pathLength >= major * 4 && buckets.size >= 18;
}

function toMiniTrackPath(points: LayoutPoint[], width: number, height: number, pad: number): string {
  if (points.length < 2) {
    return "";
  }

  const sampled = sampleLayoutPoints(points, 240);
  if (sampled.length < 2) {
    return "";
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of sampled) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const xOffset = (width - spanX * scale) / 2;
  const yOffset = (height - spanY * scale) / 2;

  return sampled
    .map((p, i) => {
      const x = xOffset + (p.x - minX) * scale;
      const y = yOffset + (maxY - p.y) * scale;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function CircuitTrackPreview({ sessionKeys, title }: { sessionKeys: number[]; title: string }) {
  const [points, setPoints] = useState<LayoutPoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const candidates = sessionKeys.slice(0, 10);

    async function loadFirstAvailable(): Promise<void> {
      setLoading(true);

      for (const key of candidates) {
        const cached = layoutCache.get(key);
        if (cached !== undefined) {
          if (cached && isUsableLayout(cached)) {
            if (!cancelled) {
              setPoints(cached);
              setLoading(false);
            }
            return;
          }
          continue;
        }

        try {
          const response = await fetch(`/api/sessions/${key}/layout`);
          if (!response.ok) {
            layoutCache.set(key, null);
            continue;
          }
          const data = (await response.json()) as LayoutPoint[] | null;
          const next = Array.isArray(data) && isUsableLayout(data) ? data : null;
          layoutCache.set(key, next);
          if (next) {
            if (!cancelled) {
              setPoints(next);
              setLoading(false);
            }
            return;
          }
        } catch {
          layoutCache.set(key, null);
        }
      }

      if (!cancelled) {
        setPoints(null);
        setLoading(false);
      }
    }

    void loadFirstAvailable();

    return () => {
      cancelled = true;
    };
  }, [sessionKeys]);

  const path = useMemo(() => {
    if (!points || points.length < 2) {
      return "";
    }
    return toMiniTrackPath(points, 168, 76, 8);
  }, [points]);

  return (
    <div className="nav-circuit-track" aria-hidden={loading || !path} title={title}>
      <svg viewBox="0 0 168 76" preserveAspectRatio="xMidYMid meet">
        {path ? (
          <>
            <path className="nav-circuit-track-glow" d={path} />
            <path className="nav-circuit-track-line" d={path} />
          </>
        ) : (
          <line className="nav-circuit-track-fallback" x1="16" y1="38" x2="152" y2="38" />
        )}
      </svg>
    </div>
  );
}

function buildSeasonGroups(sessions: SessionManifest[]): SeasonGroup[] {
  const byYear = new Map<number, Map<string, SessionManifest[]>>();
  for (const s of sessions) {
    const year = getSeasonYear(s);
    const circuit = s.circuit_short_name || "Unknown";
    if (!byYear.has(year)) byYear.set(year, new Map());
    const ym = byYear.get(year)!;
    if (!ym.has(circuit)) ym.set(circuit, []);
    ym.get(circuit)!.push(s);
  }
  return Array.from(byYear.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, circuits]) => {
      const cgs: CircuitGroup[] = Array.from(circuits.entries())
        .map(([circuit, ss]) => {
          const times = ss.map(getSortTime).filter((v) => v > 0);
          const gpName = ss.find((s) => s.meeting_name)?.meeting_name ?? circuit;
          const hasSprint = ss.some((s) => (s.session_name || "").toLowerCase().includes("sprint"));
          return {
            circuit,
            sessions: ss.sort((a, b) => getSortTime(a) - getSortTime(b)),
            firstDate: times.length ? Math.min(...times) : 0,
            lastDate: times.length ? Math.max(...times) : 0,
            gpName,
            hasSprint,
          };
        })
        .sort((a, b) => a.firstDate - b.firstDate);
      return {
        year,
        circuits: cgs,
        totalSessions: cgs.reduce((n, cg) => n + cg.sessions.length, 0),
        sprintWeekends: cgs.filter((cg) => cg.hasSprint).length,
        raceCount: cgs.filter((cg) => cg.sessions.some((s) => s.session_type?.toLowerCase() === "race")).length,
      };
    });
}

// ── Home View ─────────────────────────────────────────────────────────────────

function HomeView({ seasons, loading, onPickYear }: {
  seasons: SeasonGroup[];
  loading: boolean;
  onPickYear: (year: number) => void;
}) {
  const currentYear = new Date().getFullYear();
  return (
    <div className="nav-home">
      <header className="nav-hero">
        <div className="nav-logo">
          <span className="logo-f1">F1</span>
          <span className="logo-insights">INSIGHTS</span>
        </div>
        <p className="nav-tagline">Every session. Every corner. Relive Formula 1.</p>
        <p className="nav-desc">
          Full replay coverage of every practice, qualifying, sprint and race from 2023 onwards.
          Pause, rewind and analyse timing data, lap by lap, exactly as it happened on track.
        </p>
      </header>

      {loading && <div className="nav-loading">Loading archive…</div>}

      {!loading && seasons.length === 0 && (
        <div className="nav-empty">
          <p>No sessions imported yet.</p>
          <code>pnpm import:openf1:year -- --year 2024</code>
        </div>
      )}

      {!loading && seasons.length > 0 && (
        <>
          <p className="nav-section-label">Choose a Season</p>
          <div className="nav-year-grid">
            {seasons.map((season) => (
              <button
                key={season.year}
                className={`nav-year-card${season.year === currentYear ? " nav-year-card--current" : ""}`}
                onClick={() => onPickYear(season.year)}
              >
                {season.year === currentYear && (
                  <span className="nav-year-live-badge">Current Season</span>
                )}
                <div className="nav-year-number">{season.year}</div>
                <div className="nav-year-championship">Formula 1 World Championship</div>
                <div className="nav-year-stats">
                  <div className="nav-year-stat">
                    <span className="nav-year-stat-value">{season.raceCount}</span>
                    <span className="nav-year-stat-label">Rounds</span>
                  </div>
                  <div className="nav-year-stat">
                    <span className="nav-year-stat-value">{season.totalSessions}</span>
                    <span className="nav-year-stat-label">Sessions</span>
                  </div>
                  {season.sprintWeekends > 0 && (
                    <div className="nav-year-stat">
                      <span className="nav-year-stat-value">{season.sprintWeekends}</span>
                      <span className="nav-year-stat-label">Sprint Wknds</span>
                    </div>
                  )}
                </div>
                <div className="nav-year-cta">Explore Season →</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Year View ─────────────────────────────────────────────────────────────────

function YearView({ season, circuitPreviewKeys, onBack, onPickCircuit }: {
  season: SeasonGroup;
  circuitPreviewKeys: Map<string, number[]>;
  onBack: () => void;
  onPickCircuit: (circuit: string) => void;
}) {
  return (
    <div className="nav-page">
      <div className="nav-breadcrumb">
        <button className="nav-back-btn" onClick={onBack}>← Home</button>
        <span className="nav-crumb-sep">/</span>
        <span className="nav-crumb-current">{season.year} Season</span>
      </div>

      <header className="nav-page-header">
        <h1 className="nav-page-title">{season.year} Formula One Season</h1>
        <p className="nav-page-subtitle">
          {season.raceCount} rounds · {season.totalSessions} sessions imported
          {season.sprintWeekends > 0 ? ` · ${season.sprintWeekends} sprint weekends` : ""}
        </p>
      </header>

      <div className="nav-circuit-grid">
        {season.circuits.map((cg, idx) => {
          const meta = CIRCUIT_META[cg.circuit];
          const flag = meta?.flag ?? "🏎";
          const country = meta?.country ?? cg.circuit;
          const round = String(idx + 1).padStart(2, "0");
          const previewSourceKeys =
            circuitPreviewKeys.get(cg.circuit) ??
            cg.sessions.map((s) => s.session_key);
          const sessionLabels = cg.sessions
            .map((s) => getTypeMeta(s))
            .filter((v, i, arr) => arr.findIndex((x) => x.label === v.label) === i)
            .sort((a, b) => a.order - b.order);
          return (
            <button
              key={cg.circuit}
              className="nav-circuit-card"
              onClick={() => onPickCircuit(cg.circuit)}
            >
              <div className="nav-circuit-card-top">
                <span className="nav-round-badge">R{round}</span>
                {cg.hasSprint && <span className="nav-sprint-pill">Sprint</span>}
              </div>
              <CircuitTrackPreview sessionKeys={previewSourceKeys} title={`${cg.gpName} circuit layout`} />
              <div className="nav-circuit-flag">{flag}</div>
              <div className="nav-circuit-gp">{cg.gpName}</div>
              <div className="nav-circuit-country">{country}</div>
              {cg.firstDate > 0 && (
                <div className="nav-circuit-dates">
                  {fmtShort(new Date(cg.firstDate).toISOString())}
                  {cg.firstDate !== cg.lastDate
                    ? ` – ${fmtShort(new Date(cg.lastDate).toISOString())}`
                    : ""}
                </div>
              )}
              <div className="nav-circuit-chips">
                {sessionLabels.map((sm) => (
                  <span key={sm.label} className={`nav-type-chip ${sm.cls}`}>
                    {chipLabel(sm.label)}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Circuit View ──────────────────────────────────────────────────────────────

function CircuitView({ circuitGroup, year, roundNum, onBack, onSelect }: {
  circuitGroup: CircuitGroup;
  year: number;
  roundNum: number;
  onBack: () => void;
  onSelect: (session: SessionManifest) => void;
}) {
  const meta = CIRCUIT_META[circuitGroup.circuit];
  const flag = meta?.flag ?? "🏎";
  const country = meta?.country ?? circuitGroup.circuit;
  const round = String(roundNum).padStart(2, "0");

  const sortedSessions = [...circuitGroup.sessions].sort((a, b) => {
    const ta = getTypeMeta(a), tb = getTypeMeta(b);
    if (ta.order !== tb.order) return ta.order - tb.order;
    return getSortTime(a) - getSortTime(b);
  });

  return (
    <div className="nav-page">
      <div className="nav-breadcrumb">
        <button className="nav-back-btn" onClick={onBack}>← {year} Season</button>
        <span className="nav-crumb-sep">/</span>
        <span className="nav-crumb-current">{circuitGroup.gpName}</span>
      </div>

      <header className="nav-circuit-hero">
        <div className="nav-circuit-hero-flag">{flag}</div>
        <div className="nav-circuit-hero-info">
          <h1 className="nav-circuit-hero-title">{circuitGroup.gpName}</h1>
          <p className="nav-circuit-hero-sub">
            Round {round} · {country}
            {circuitGroup.firstDate > 0 && (
              <>
                {" · "}
                {fmtShort(new Date(circuitGroup.firstDate).toISOString())}
                {circuitGroup.firstDate !== circuitGroup.lastDate
                  ? ` – ${fmtShort(new Date(circuitGroup.lastDate).toISOString())}`
                  : ""}
              </>
            )}
          </p>
        </div>
        {circuitGroup.hasSprint && (
          <span className="nav-sprint-pill nav-sprint-pill--lg">Sprint Weekend</span>
        )}
      </header>

      <div className="nav-session-list">
        {sortedSessions.map((s) => {
          const { label, cls } = getTypeMeta(s);
          const isRace = s.session_type?.toLowerCase() === "race";
          return (
            <button
              key={s.session_key}
              className={`nav-session-row${isRace ? " nav-session-row--race" : ""}`}
              onClick={() => onSelect(s)}
            >
              <span className={`nav-session-badge ${cls}`}>{label}</span>
              <div className="nav-session-info">
                {s.date_start_utc && (
                  <span className="nav-session-date">{fmtFull(s.date_start_utc)}</span>
                )}
                {s.date_start_utc && (
                  <span className="nav-session-time">{fmtTime(s.date_start_utc)} UTC</span>
                )}
              </div>
              <span className="nav-session-drivers">{s.drivers.length} drivers</span>
              <span className="nav-session-watch">Watch →</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function SessionPicker({ sessions, loading, onSelect }: Props) {
  const [nav, setNav] = useState<NavState>({ view: "home" });
  const seasons = buildSeasonGroups(sessions);
  const circuitPreviewKeys = useMemo(() => {
    const ordered = [...sessions].sort((a, b) => getSortTime(b) - getSortTime(a));
    const byCircuit = new Map<string, number[]>();
    for (const session of ordered) {
      const circuit = session.circuit_short_name || "Unknown";
      if (!byCircuit.has(circuit)) {
        byCircuit.set(circuit, []);
      }
      const list = byCircuit.get(circuit)!;
      if (!list.includes(session.session_key)) {
        list.push(session.session_key);
      }
    }
    return byCircuit;
  }, [sessions]);

  if (nav.view === "home") {
    return (
      <HomeView
        seasons={seasons}
        loading={loading}
        onPickYear={(year) => setNav({ view: "year", year })}
      />
    );
  }

  if (nav.view === "year") {
    const season = seasons.find((s) => s.year === nav.year);
    if (!season) return null;
    return (
      <YearView
        season={season}
        circuitPreviewKeys={circuitPreviewKeys}
        onBack={() => setNav({ view: "home" })}
        onPickCircuit={(circuit) => setNav({ view: "circuit", year: nav.year, circuit })}
      />
    );
  }

  // circuit view
  const season = seasons.find((s) => s.year === nav.year);
  const circuitGroup = season?.circuits.find((cg) => cg.circuit === nav.circuit);
  const roundNum = (season?.circuits.findIndex((cg) => cg.circuit === nav.circuit) ?? 0) + 1;
  if (!circuitGroup) return null;
  return (
    <CircuitView
      circuitGroup={circuitGroup}
      year={nav.year}
      roundNum={roundNum}
      onBack={() => setNav({ view: "year", year: nav.year })}
      onSelect={onSelect}
    />
  );
}
