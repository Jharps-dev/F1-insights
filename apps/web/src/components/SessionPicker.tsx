import React, { useEffect, useMemo, useState } from "react";
import type {
  LayoutPoint,
  SessionDriverManifest,
  SessionManifest,
  SessionMeetingContext,
  SessionStartingGridEntry,
} from "../types";
import { CircuitGraphic, buildCircuitGeometry, isUsableLayout } from "./CircuitGraphic";

interface Props {
  sessions: SessionManifest[];
  loading: boolean;
  error?: string | null;
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

function getCircuitFallback(circuit: string) {
  return CIRCUIT_META[circuit] ?? { flag: "🏎", country: circuit };
}

function getCircuitCountryLabel(context: SessionMeetingContext | undefined, circuit: string): string {
  if (context?.location && context?.country_name && context.location !== context.country_name) {
    return `${context.location}, ${context.country_name}`;
  }
  return context?.country_name || context?.location || getCircuitFallback(circuit).country;
}

function getCircuitDescriptor(context: SessionMeetingContext | undefined, fallback: string): string {
  return context?.meeting_official_name || fallback;
}

function CircuitFlagMark({
  context,
  circuit,
  variant,
}: {
  context?: SessionMeetingContext;
  circuit: string;
  variant: "card" | "hero";
}) {
  const fallback = getCircuitFallback(circuit);
  const className = variant === "hero" ? "nav-circuit-hero-flag" : "nav-circuit-flag";

  if (context?.country_flag) {
    return (
      <img
        className={`${className} ${className}--image`}
        src={resolveMediaUrl(context.country_flag)}
        alt={`${context.country_name || circuit} flag`}
        loading="lazy"
      />
    );
  }

  return <div className={className}>{fallback.flag}</div>;
}

function DriverLineup({ drivers }: { drivers: SessionDriverManifest[] }) {
  const featuredDrivers = drivers.slice(0, 5);
  const remainingDrivers = Math.max(0, drivers.length - featuredDrivers.length);

  if (featuredDrivers.length === 0) {
    return null;
  }

  return (
    <div className="nav-driver-lineup" aria-label={`Featured drivers: ${drivers.length}`}>
      <div className="nav-driver-lineup-stack">
        {featuredDrivers.map((driver) => {
          const label = driver.broadcast_name || driver.code || String(driver.number);
          return driver.headshot_url ? (
            <img
              key={driver.number}
              className="nav-driver-avatar"
              src={resolveMediaUrl(driver.headshot_url)}
              alt={driver.name || label}
              title={driver.name || label}
              loading="lazy"
            />
          ) : (
            <div
              key={driver.number}
              className="nav-driver-avatar nav-driver-avatar--fallback"
              title={driver.name || label}
            >
              {label.slice(0, 3)}
            </div>
          );
        })}
      </div>
      <div className="nav-driver-lineup-copy">
        <span className="nav-driver-lineup-label">Driver lineup</span>
        <span className="nav-driver-lineup-value">
          {drivers.length} drivers{remainingDrivers > 0 ? ` · +${remainingDrivers} more shown in replay` : ""}
        </span>
      </div>
    </div>
  );
}

function getGridHeadline(startingGrid: SessionStartingGridEntry[] | undefined): string | null {
  if (!startingGrid || startingGrid.length === 0) {
    return null;
  }

  const topThree = startingGrid.slice(0, 3);
  const labels = topThree.map((entry) => {
    const code = entry.driver_code || entry.driver_name || `#${entry.driver_number}`;
    return `P${entry.position} ${code}`;
  });

  return labels.join(" · ");
}

function getGridSubline(startingGrid: SessionStartingGridEntry[] | undefined): string | null {
  if (!startingGrid || startingGrid.length < 2) {
    return null;
  }

  const pole = startingGrid[0];
  const frontRow = startingGrid[1];
  const poleName = pole.driver_name || pole.driver_code || `#${pole.driver_number}`;
  const frontRowName = frontRow.driver_name || frontRow.driver_code || `#${frontRow.driver_number}`;
  return `Pole: ${poleName} · Front row: ${frontRowName}`;
}

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
  meetingContext?: SessionMeetingContext;
  displayDrivers: SessionDriverManifest[];
}

interface SeasonGroup {
  year: number;
  circuits: CircuitGroup[];
  totalSessions: number;
  sprintWeekends: number;
  raceCount: number;
}

const layoutCache = new Map<number, LayoutPoint[] | null>();
const PREVIEW_BACKEND_HTTP =
  (import.meta.env.VITE_BACKEND_ORIGIN as string | undefined) ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

function resolveMediaUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (url.startsWith("/")) {
    return `${PREVIEW_BACKEND_HTTP}${url}`;
  }
  return url;
}

function CircuitTrackPreview({ sessionKeys, title }: { sessionKeys: number[]; title: string }) {
  const [points, setPoints] = useState<LayoutPoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const candidates = sessionKeys.slice(0, 10);

    if (candidates.length === 0) {
      setPoints(null);
      setLoading(false);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

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
          const response = await fetch(`${PREVIEW_BACKEND_HTTP}/api/sessions/${key}/layout`, {
            signal: controller.signal,
          });
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
          if (controller.signal.aborted) {
            return;
          }
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
      controller.abort();
    };
  }, [sessionKeys]);

  const geometry = useMemo(
    () => buildCircuitGeometry(points, { width: 168, height: 76, pad: 8, maxPoints: 240, fallbackSeed: title }),
    [points, title],
  );

  return (
    <div className="nav-circuit-track" title={title}>
      <CircuitGraphic
        geometry={geometry}
        width={168}
        height={76}
        title={title}
        className="nav-circuit-track-svg"
        variant="card"
        showCenterLine={false}
      />
      {loading && <span className="nav-circuit-track-status">Syncing layout</span>}
    </div>
  );
}

function CircuitPreviewMedia({
  circuitImage,
  circuitInfoUrl,
  sessionKeys,
  title,
  compact = false,
}: {
  circuitImage?: string;
  circuitInfoUrl?: string;
  sessionKeys: number[];
  title: string;
  compact?: boolean;
}) {
  const containerClassName = compact ? "nav-circuit-preview nav-circuit-preview--card" : "nav-circuit-media-card";
  const imageClassName = compact ? "nav-circuit-preview-image" : "nav-circuit-media-image";
  const placeholderClassName = compact
    ? "nav-circuit-preview-placeholder"
    : "nav-circuit-media-placeholder";
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedCircuitImage = imageFailed ? undefined : resolveMediaUrl(circuitImage);

  useEffect(() => {
    setImageFailed(false);
  }, [circuitImage]);

  return (
    <div className={containerClassName}>
      {resolvedCircuitImage ? (
        circuitInfoUrl ? (
          <a href={circuitInfoUrl} target="_blank" rel="noreferrer" className="nav-circuit-media-link">
            <img
              className={imageClassName}
              src={resolvedCircuitImage}
              alt={title}
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          </a>
        ) : (
          <img
            className={imageClassName}
            src={resolvedCircuitImage}
            alt={title}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        )
      ) : compact ? (
        <div className={placeholderClassName}>
          <CircuitTrackPreview sessionKeys={sessionKeys} title={title} />
        </div>
      ) : (
        <div className={placeholderClassName}>Circuit guide</div>
      )}
      {!compact && circuitInfoUrl && (
        <a href={circuitInfoUrl} target="_blank" rel="noreferrer" className="nav-circuit-media-cta">
          Open circuit guide ↗
        </a>
      )}
    </div>
  );
}

function buildSeasonGroups(sessions: SessionManifest[]): SeasonGroup[] {
  const byYear = new Map<number, Map<string, SessionManifest[]>>();
  for (const s of sessions) {
    const year = getSeasonYear(s);
    if (!Number.isFinite(year) || year <= 0) {
      continue;
    }
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
          const driverShowcaseSession =
            ss.find((s) => s.drivers.some((driver) => Boolean(driver.headshot_url))) ??
            [...ss].sort((a, b) => b.drivers.length - a.drivers.length)[0];
          return {
            circuit,
            sessions: ss.sort((a, b) => getSortTime(a) - getSortTime(b)),
            firstDate: times.length ? Math.min(...times) : 0,
            lastDate: times.length ? Math.max(...times) : 0,
            gpName,
            hasSprint,
            meetingContext: ss.find((s) => s.meeting_context)?.meeting_context,
            displayDrivers: driverShowcaseSession?.drivers ?? [],
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

function HomeView({ seasons, loading, error, onPickYear }: {
  seasons: SeasonGroup[];
  loading: boolean;
  error?: string | null;
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

      {!loading && error && (
        <div className="nav-empty nav-empty--error" role="alert">
          <p>Archive unavailable.</p>
          <p>{error}</p>
          <code>Start the API gateway with ./.tools/node/pnpm.cmd dev:server</code>
        </div>
      )}

      {!loading && !error && seasons.length === 0 && (
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
          const country = getCircuitCountryLabel(cg.meetingContext, cg.circuit);
          const round = String(idx + 1).padStart(2, "0");
          const previewSourceKeys =
            circuitPreviewKeys.get(cg.circuit) ??
            cg.sessions.map((s) => s.session_key);
          const circuitTitle = `${cg.gpName} circuit preview`;
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
              <CircuitPreviewMedia
                compact
                circuitImage={cg.meetingContext?.circuit_image}
                circuitInfoUrl={cg.meetingContext?.circuit_info_url}
                sessionKeys={previewSourceKeys}
                title={circuitTitle}
              />
              <CircuitFlagMark context={cg.meetingContext} circuit={cg.circuit} variant="card" />
              <div className="nav-circuit-gp">{cg.gpName}</div>
              <div className="nav-circuit-country">{country}</div>
              <div className="nav-circuit-meta">
                {getCircuitDescriptor(cg.meetingContext, cg.circuit)}
              </div>
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
  const country = getCircuitCountryLabel(circuitGroup.meetingContext, circuitGroup.circuit);
  const round = String(roundNum).padStart(2, "0");

  const sortedSessions = [...circuitGroup.sessions].sort((a, b) => {
    const ta = getTypeMeta(a), tb = getTypeMeta(b);
    if (ta.order !== tb.order) return ta.order - tb.order;
    return getSortTime(a) - getSortTime(b);
  });
  const featuredGridSession =
    sortedSessions.find((session) => session.starting_grid && session.starting_grid.length > 0) ?? null;
  const circuitInfoUrl = circuitGroup.meetingContext?.circuit_info_url;
  const circuitImage = circuitGroup.meetingContext?.circuit_image;

  return (
    <div className="nav-page">
      <div className="nav-breadcrumb">
        <button className="nav-back-btn" onClick={onBack}>← {year} Season</button>
        <span className="nav-crumb-sep">/</span>
        <span className="nav-crumb-current">{circuitGroup.gpName}</span>
      </div>

      <header className="nav-circuit-hero">
        <CircuitFlagMark context={circuitGroup.meetingContext} circuit={circuitGroup.circuit} variant="hero" />
        <div className="nav-circuit-hero-info">
          <h1 className="nav-circuit-hero-title">{circuitGroup.gpName}</h1>
          <p className="nav-circuit-hero-sub">
            Round {round} · {country}
            {circuitGroup.meetingContext?.circuit_type ? ` · ${circuitGroup.meetingContext.circuit_type}` : ""}
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
          <p className="nav-circuit-hero-meta">
            {getCircuitDescriptor(circuitGroup.meetingContext, circuitGroup.circuit)}
          </p>
          {featuredGridSession?.starting_grid && (
            <div className="nav-grid-summary">
              <span className="nav-grid-summary-label">Starting grid</span>
              <span className="nav-grid-summary-headline">{getGridHeadline(featuredGridSession.starting_grid)}</span>
              {getGridSubline(featuredGridSession.starting_grid) && (
                <span className="nav-grid-summary-subline">{getGridSubline(featuredGridSession.starting_grid)}</span>
              )}
            </div>
          )}
        </div>
        {(circuitImage || circuitInfoUrl) && (
          <CircuitPreviewMedia
            circuitImage={circuitImage}
            circuitInfoUrl={circuitInfoUrl}
            sessionKeys={circuitGroup.sessions.map((session) => session.session_key)}
            title={`${circuitGroup.gpName} circuit preview`}
          />
        )}
        {circuitGroup.hasSprint && (
          <span className="nav-sprint-pill nav-sprint-pill--lg">Sprint Weekend</span>
        )}
      </header>

      <DriverLineup drivers={circuitGroup.displayDrivers} />

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
                {s.starting_grid && s.starting_grid.length > 0 && (
                  <span className="nav-session-grid">{getGridHeadline(s.starting_grid)}</span>
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

export function SessionPicker({ sessions, loading, error = null, onSelect }: Props) {
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
        error={error}
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
