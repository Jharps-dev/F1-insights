/**
 * OpenF1 REST Importer
 * 
 * Fetches historical timing/telemetry data from OpenF1 API (2023+)
 * Converts to canonical events, respects rate limits, uses caching.
 * 
 * OpenF1 docs: https://openf1.org/docs/
 * Licence: CC BY-NC-SA 4.0 (non-commercial, attribution required)
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { CanonicalEvent, CANONICAL_SCHEMA_VERSION, SessionManifest } from "@f1-insights/schemas";
import { mirrorSessionManifestAssets } from "./assets";

const BASE_URL = "https://api.openf1.org/v1";
const CACHE_DIR = process.env.CACHE_DIR || ".cache/openf1";

export type ImportProfile = "lite" | "standard" | "full";

interface ImportProfileSettings {
  includeCarData: boolean;
  carDataKeepEvery: number;
  includeLocation: boolean;
  locationKeepEvery: number;
  includeWeather: boolean;
  includeRaceControl: boolean;
  includePit: boolean;
  includeTeamRadio: boolean;
  includeResult: boolean;
}

const IMPORT_PROFILES: Record<ImportProfile, ImportProfileSettings> = {
  lite: {
    includeCarData: false,
    carDataKeepEvery: 1,
    includeLocation: false,
    locationKeepEvery: 1,
    includeWeather: true,
    includeRaceControl: true,
    includePit: true,
    includeTeamRadio: true,
    includeResult: true,
  },
  standard: {
    includeCarData: true,
    carDataKeepEvery: 5,
    includeLocation: true,
    locationKeepEvery: 3,
    includeWeather: true,
    includeRaceControl: true,
    includePit: true,
    includeTeamRadio: true,
    includeResult: true,
  },
  full: {
    includeCarData: true,
    carDataKeepEvery: 1,
    includeLocation: true,
    locationKeepEvery: 1,
    includeWeather: true,
    includeRaceControl: true,
    includePit: true,
    includeTeamRadio: true,
    includeResult: true,
  },
};

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTyreCompound(value: unknown): "S" | "M" | "H" | "I" | "W" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized.startsWith("SOFT")) return "S";
  if (normalized.startsWith("MED")) return "M";
  if (normalized.startsWith("HARD")) return "H";
  if (normalized.startsWith("INT")) return "I";
  if (normalized.startsWith("WET")) return "W";
  if (normalized === "S" || normalized === "M" || normalized === "H" || normalized === "I" || normalized === "W") {
    return normalized;
  }

  return undefined;
}

function mapResultStatus(row: Record<string, unknown>): "finished" | "dnf" | "dns" | "disqualified" {
  if (row.dsq === true) {
    return "disqualified";
  }
  if (row.dns === true) {
    return "dns";
  }
  if (row.dnf === true) {
    return "dnf";
  }
  return "finished";
}

function formatResultTime(row: Record<string, unknown>): string | undefined {
  const gapToLeader = toOptionalNumber(row.gap_to_leader);
  if (typeof gapToLeader === "number") {
    if (gapToLeader === 0) {
      return "Leader";
    }
    return `+${gapToLeader.toFixed(3)}s`;
  }

  const duration = toOptionalNumber(row.duration);
  if (typeof duration === "number") {
    return `${duration.toFixed(3)}s`;
  }

  return undefined;
}

function formatGridLapTime(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  const parsed = toOptionalNumber(value);
  if (typeof parsed !== "number") {
    return undefined;
  }

  if (parsed >= 60) {
    const minutes = Math.floor(parsed / 60);
    const seconds = (parsed % 60).toFixed(3).padStart(6, "0");
    return `${minutes}:${seconds}`;
  }

  return parsed.toFixed(3);
}

function toIsoFromMs(value: number | undefined): string | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return new Date(value as number).toISOString();
}

function deriveLapEventTimeUtc(row: Record<string, unknown>, sessionData: Record<string, unknown>): string {
  const dateStartRaw = typeof row.date_start === "string" ? row.date_start : undefined;
  const lapStartMs = dateStartRaw ? Date.parse(dateStartRaw) : Number.NaN;
  const lapDurationSeconds = toOptionalNumber(row.lap_duration);

  if (Number.isFinite(lapStartMs) && typeof lapDurationSeconds === "number" && lapDurationSeconds > 0) {
    const lapEndIso = toIsoFromMs(lapStartMs + lapDurationSeconds * 1000);
    if (lapEndIso) {
      return lapEndIso;
    }
  }

  if (Number.isFinite(lapStartMs)) {
    const lapStartIso = toIsoFromMs(lapStartMs);
    if (lapStartIso) {
      return lapStartIso;
    }
  }

  if (typeof row.date === "string" && row.date.trim().length > 0) {
    return row.date;
  }

  return String(sessionData.date_end || sessionData.date_start || new Date().toISOString());
}

function buildMeetingContext(meetingData: any): SessionManifest["meeting_context"] | undefined {
  if (!meetingData) {
    return undefined;
  }

  return {
    meeting_official_name:
      typeof meetingData.meeting_official_name === "string" ? meetingData.meeting_official_name : undefined,
    location: typeof meetingData.location === "string" ? meetingData.location : undefined,
    country_code: typeof meetingData.country_code === "string" ? meetingData.country_code : undefined,
    country_name: typeof meetingData.country_name === "string" ? meetingData.country_name : undefined,
    country_flag: typeof meetingData.country_flag === "string" ? meetingData.country_flag : undefined,
    country_flag_source_url: typeof meetingData.country_flag === "string" ? meetingData.country_flag : undefined,
    circuit_type: typeof meetingData.circuit_type === "string" ? meetingData.circuit_type : undefined,
    circuit_info_url: typeof meetingData.circuit_info_url === "string" ? meetingData.circuit_info_url : undefined,
    circuit_image: typeof meetingData.circuit_image === "string" ? meetingData.circuit_image : undefined,
    circuit_image_source_url: typeof meetingData.circuit_image === "string" ? meetingData.circuit_image : undefined,
  };
}

function buildStartingGrid(
  rows: any[],
  drivers: Map<number, SessionManifest["drivers"][number]>
): NonNullable<SessionManifest["starting_grid"]> {
  return rows
    .map((row) => {
      const driverNumber = Number(row.driver_number);
      const position = Number(row.position);
      if (!Number.isFinite(driverNumber) || !Number.isFinite(position)) {
        return null;
      }

      const driverMeta = drivers.get(driverNumber);
      return {
        position,
        driver_number: driverNumber,
        driver_code:
          typeof row.driver_code === "string"
            ? row.driver_code
            : typeof row.name_acronym === "string"
              ? row.name_acronym
              : driverMeta?.code,
        driver_name:
          typeof row.full_name === "string"
            ? row.full_name
            : typeof row.broadcast_name === "string"
              ? row.broadcast_name
              : driverMeta?.name,
        team_name: typeof row.team_name === "string" ? row.team_name : driverMeta?.team,
        team_color: typeof row.team_colour === "string" ? row.team_colour : driverMeta?.team_color,
        grid_time: formatGridLapTime(row.lap_time ?? row.time ?? row.time_q1 ?? row.time_q2 ?? row.time_q3),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => a.position - b.position);
}

interface SessionMetadataBundle {
  sessionData: any;
  meetingKey: number;
  meetingData?: any;
  drivers: Map<number, SessionManifest["drivers"][number]>;
  startingGrid: NonNullable<SessionManifest["starting_grid"]>;
}

async function fetchSessionMetadata(sessionKey: number): Promise<SessionMetadataBundle> {
  const sessionsUrl = `${BASE_URL}/sessions?session_key=${sessionKey}`;
  const sessionsList: any[] = await fetchCached(sessionsUrl);
  const sessionData = sessionsList[0];

  if (!sessionData) {
    throw new Error(`Session ${sessionKey} not found`);
  }

  const meetingKey = Number(sessionData.meeting_key);
  const drivers = new Map<number, SessionManifest["drivers"][number]>();

  console.log(`  Meeting: #${meetingKey}, Session: ${sessionData.session_name}, Date: ${sessionData.date_start || "unknown"}`);

  console.log(`  → Fetching meeting metadata...`);
  const meetingsUrl = `${BASE_URL}/meetings?meeting_key=${meetingKey}`;
  const meetingRows: any[] = await fetchOptionalArray(meetingsUrl, "meetings");
  const meetingData = meetingRows[0];

  console.log(`  → Fetching drivers metadata...`);
  const driversUrl = `${BASE_URL}/drivers?session_key=${sessionKey}`;
  const sessionDrivers: any[] = await fetchOptionalArray(driversUrl, "drivers");
  for (const row of sessionDrivers) {
    const driverNumber = Number(row.driver_number);
    if (Number.isFinite(driverNumber)) {
      drivers.set(driverNumber, {
        number: driverNumber,
        code: row.name_acronym || row.driver_code || `D${driverNumber}`,
        name: typeof row.full_name === "string" ? row.full_name : undefined,
        broadcast_name: typeof row.broadcast_name === "string" ? row.broadcast_name : undefined,
        first_name: typeof row.first_name === "string" ? row.first_name : undefined,
        last_name: typeof row.last_name === "string" ? row.last_name : undefined,
        team: typeof row.team_name === "string" ? row.team_name : undefined,
        team_color: typeof row.team_colour === "string" ? row.team_colour : undefined,
        headshot_url: typeof row.headshot_url === "string" ? row.headshot_url : undefined,
        headshot_source_url: typeof row.headshot_url === "string" ? row.headshot_url : undefined,
        country_code: typeof row.country_code === "string" ? row.country_code : undefined,
      });
    }
  }

  console.log(`  → Fetching starting grid...`);
  const startingGridUrl = `${BASE_URL}/starting_grid?session_key=${sessionKey}`;
  const startingGridRows: any[] = await fetchOptionalArray(startingGridUrl, "starting_grid");

  return {
    sessionData,
    meetingKey,
    meetingData,
    drivers,
    startingGrid: buildStartingGrid(startingGridRows, drivers),
  };
}

function buildSessionManifest(args: {
  sessionKey: number;
  profile?: ImportProfile;
  sessionData: any;
  meetingKey: number;
  meetingData?: any;
  drivers: Map<number, SessionManifest["drivers"][number]>;
  startingGrid: NonNullable<SessionManifest["starting_grid"]>;
  existingManifest?: Partial<SessionManifest>;
}): SessionManifest {
  const {
    sessionKey,
    profile,
    sessionData,
    meetingKey,
    meetingData,
    drivers,
    startingGrid,
    existingManifest,
  } = args;

  return {
    schema_version: CANONICAL_SCHEMA_VERSION,
    dataset_name: existingManifest?.dataset_name || `openf1_session_${sessionKey}`,
    created_utc: existingManifest?.created_utc || new Date().toISOString(),
    year: sessionData.year ?? existingManifest?.year,
    meeting_name: sessionData.meeting_name ?? existingManifest?.meeting_name,
    session_name: sessionData.session_name ?? existingManifest?.session_name,
    date_start_utc: sessionData.date_start ?? existingManifest?.date_start_utc,
    date_end_utc: sessionData.date_end ?? existingManifest?.date_end_utc,
    import_profile: profile ?? existingManifest?.import_profile,
    meeting_key: meetingKey,
    session_key: sessionKey,
    session_type: sessionData.session_type || existingManifest?.session_type || ("practice" as const),
    circuit_short_name: sessionData.circuit_short_name || existingManifest?.circuit_short_name,
    meeting_context: buildMeetingContext(meetingData) || existingManifest?.meeting_context,
    starting_grid: startingGrid.length > 0 ? startingGrid : existingManifest?.starting_grid,
    drivers: Array.from(drivers.values()),
    source_priority: existingManifest?.source_priority || ["openf1"],
    time_basis: existingManifest?.time_basis || "utc",
    files: existingManifest?.files || {
      events_jsonl: `events_${sessionKey}.jsonl`,
      manifest_json: `manifest_${sessionKey}.json`,
    },
  };
}

/**
 * Fetch with retry, backoff, and rate limiting
 */
async function fetchWithBackoff(
  url: string,
  options: { maxRetries?: number; timeoutMs?: number } = {}
): Promise<any> {
  const maxRetries = options.maxRetries ?? 6;
  const timeoutMs = options.timeoutMs ?? 20000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "F1Insights/1.0 (en-GB)",
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      // Respect rate limiting
      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        const baseDelay = retryAfter ? Number(retryAfter) * 1000 : 250 * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 200);
        await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
        continue;
      }

      if (res.status >= 500 && res.status <= 599) {
        const baseDelay = 250 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, baseDelay));
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      return data;
    } catch (err) {
      if (err instanceof Error && /HTTP 4\d\d/.test(err.message) && !err.message.includes("HTTP 429")) {
        throw err;
      }
      if (attempt < maxRetries) {
        console.warn(`Fetch failed (attempt ${attempt + 1}/${maxRetries + 1}): ${url}`, err);
      } else {
        throw err;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Cache helper: fetch with local file cache
 */
async function fetchCached(url: string): Promise<any> {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const cacheKey = crypto.createHash("sha256").update(url).digest("hex");
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);

  try {
    const cached = await fs.readFile(cachePath, "utf8");
    console.log(`[CACHE HIT] ${url}`);
    return JSON.parse(cached);
  } catch {
    // Cache miss; fetch from network
  }

  console.log(`[FETCH] ${url}`);
  const data = await fetchWithBackoff(url);
  await fs.writeFile(cachePath, JSON.stringify(data), "utf8");
  return data;
}

async function fetchOptionalArray(url: string, label: string): Promise<any[]> {
  try {
    const data = await fetchCached(url);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn(`[WARN] Skipping ${label}: ${url}`, err);
    return [];
  }
}

/**
 * Import a single session from OpenF1
 */
export async function importOpenF1Session(
  sessionKey: number,
  options: { cacheOnly?: boolean; profile?: ImportProfile } = {}
): Promise<{
  events: CanonicalEvent[];
  manifest: SessionManifest;
}> {
  console.log(`\n[IMPORT] OpenF1 Session ${sessionKey}`);

  const profile = options.profile ?? "standard";
  const profileSettings = IMPORT_PROFILES[profile];
  console.log(`  Profile: ${profile}`);

  const events: CanonicalEvent[] = [];
  const drivers = new Map<number, SessionManifest["drivers"][number]>();

  try {
    const { sessionData, meetingKey, meetingData, drivers: metadataDrivers, startingGrid } = await fetchSessionMetadata(sessionKey);
    drivers.clear();
    for (const [driverNumber, driver] of metadataDrivers.entries()) {
      drivers.set(driverNumber, driver);
    }

    // Stints enrich lap tyre context and strategy metrics.
    console.log(`  → Fetching stints...`);
    const stintsUrl = `${BASE_URL}/stints?session_key=${sessionKey}`;
    const stints: any[] = await fetchOptionalArray(stintsUrl, "stints");
    const stintByDriver = new Map<number, any[]>();
    for (const stint of stints) {
      const num = Number(stint.driver_number);
      if (!Number.isFinite(num)) {
        continue;
      }
      const list = stintByDriver.get(num) || [];
      list.push(stint);
      stintByDriver.set(num, list);
    }

    // Fetch car data (telemetry) at ~3.7 Hz
    if (profileSettings.includeCarData) {
      console.log(`  → Fetching car_data (telemetry, ~3.7 Hz)...`);
      const carData: any[] = [];
      for (const driver of Array.from(drivers.keys())) {
        const carDataUrl = `${BASE_URL}/car_data?session_key=${sessionKey}&driver_number=${driver}`;
        const driverCarData = await fetchOptionalArray(carDataUrl, `car_data driver ${driver}`);
        carData.push(...driverCarData);
      }

      const keepEvery = Math.max(1, profileSettings.carDataKeepEvery);
      for (let i = 0; i < carData.length; i++) {
        if (i % keepEvery !== 0) {
          continue;
        }
        const row = carData[i];
        if (row.driver_number) {
          const prev = drivers.get(row.driver_number);
          drivers.set(row.driver_number, {
            ...prev,
            number: row.driver_number,
            code: row.driver_code || prev?.code || `D${row.driver_number}`,
          });
        }

        events.push({
          schema_version: CANONICAL_SCHEMA_VERSION,
          source: "openf1",
          ingest_time_utc: new Date().toISOString(),
          event_time_utc: row.date || new Date().toISOString(),
          meeting_key: meetingKey,
          session_key: sessionKey,
          kind: "car_data",
          driver: {
            number: row.driver_number,
            code: row.driver_code,
          },
          payload: {
            speed: row.speed,
            throttle: row.throttle,
            brake: row.brake,
            rpm: row.rpm,
            n_gear: row.n_gear,
            drs: row.drs,
            lap_number: row.lap_number,
            session_time: row.session_time,
          },
        });
      }
    } else {
      console.log(`  → Skipping car_data for profile '${profile}'`);
    }

    if (profileSettings.includeLocation) {
      console.log(`  → Fetching location (driver coordinates)...`);
      const locationRows: any[] = [];
      for (const driver of Array.from(drivers.keys())) {
        const locationUrl = `${BASE_URL}/location?session_key=${sessionKey}&driver_number=${driver}`;
        const driverLocations = await fetchOptionalArray(locationUrl, `location driver ${driver}`);
        locationRows.push(...driverLocations);
      }

      const keepEvery = Math.max(1, profileSettings.locationKeepEvery);
      for (let i = 0; i < locationRows.length; i++) {
        if (i % keepEvery !== 0) {
          continue;
        }

        const row = locationRows[i];
        const driverNumber = Number(row.driver_number);
        if (!Number.isFinite(driverNumber)) {
          continue;
        }

        const prev = drivers.get(driverNumber);
        const driverCode = row.driver_code || prev?.code || `D${driverNumber}`;
        events.push({
          schema_version: CANONICAL_SCHEMA_VERSION,
          source: "openf1",
          ingest_time_utc: new Date().toISOString(),
          event_time_utc: row.date || new Date().toISOString(),
          meeting_key: meetingKey,
          session_key: sessionKey,
          kind: "location",
          driver: {
            number: driverNumber,
            code: driverCode,
          },
          payload: {
            x: Number(row.x) || 0,
            y: Number(row.y) || 0,
            z: Number.isFinite(Number(row.z)) ? Number(row.z) : undefined,
            session_time: Number.isFinite(Number(row.session_time)) ? Number(row.session_time) : undefined,
          },
        });
      }
    } else {
      console.log(`  → Skipping location for profile '${profile}'`);
    }

    if (profileSettings.includePit) {
      console.log(`  → Fetching pit stops...`);
      const pitUrl = `${BASE_URL}/pit?session_key=${sessionKey}`;
      const pitRows: any[] = await fetchOptionalArray(pitUrl, "pit");

      for (const row of pitRows) {
        const driverNumber = Number(row.driver_number);
        if (!Number.isFinite(driverNumber)) {
          continue;
        }

        const prev = drivers.get(driverNumber);
        const pitLossSeconds =
          toOptionalNumber(row.pit_duration) ??
          toOptionalNumber(row.lane_duration) ??
          toOptionalNumber(row.stop_duration);

        events.push({
          schema_version: CANONICAL_SCHEMA_VERSION,
          source: "openf1",
          ingest_time_utc: new Date().toISOString(),
          event_time_utc: row.date || new Date().toISOString(),
          meeting_key: meetingKey,
          session_key: sessionKey,
          kind: "pit",
          driver: {
            number: driverNumber,
            code: prev?.code || `D${driverNumber}`,
          },
          payload: {
            pit_entry_lap: Number(row.lap_number) || 0,
            pit_exit_lap: undefined,
            pit_loss_ms: typeof pitLossSeconds === "number" ? Math.round(pitLossSeconds * 1000) : undefined,
            tyre_set_new: normalizeTyreCompound(row.compound),
          },
        });
      }
    }

    // Fetch laps
    console.log(`  → Fetching laps...`);
    const lapsUrl = `${BASE_URL}/laps?session_key=${sessionKey}`;
    const laps: any[] = await fetchOptionalArray(lapsUrl, "laps");

    for (const row of laps) {
      const driverNumber = Number(row.driver_number);
      const lapNumber = Number(row.lap_number);
      const matchingStint = (stintByDriver.get(driverNumber) || []).find((stint) => {
        const lapStart = Number(stint.lap_start || 0);
        const lapEnd = Number(stint.lap_end || 0);
        return lapNumber >= lapStart && lapNumber <= lapEnd;
      });

      events.push({
        schema_version: CANONICAL_SCHEMA_VERSION,
        source: "openf1",
        ingest_time_utc: new Date().toISOString(),
        event_time_utc: deriveLapEventTimeUtc(row, sessionData),
        meeting_key: meetingKey,
        session_key: sessionKey,
        kind: "lap",
        driver: {
          number: row.driver_number,
          code: row.driver_code,
        },
        payload: {
          lap_number: row.lap_number,
          lap_duration_ms: row.lap_duration ? row.lap_duration * 1000 : 0,
          sector_1_ms: row.duration_sector_1 ? row.duration_sector_1 * 1000 : null,
          sector_2_ms: row.duration_sector_2 ? row.duration_sector_2 * 1000 : null,
          sector_3_ms: row.duration_sector_3 ? row.duration_sector_3 * 1000 : null,
          i1_speed_kmh: toOptionalNumber(row.i1_speed),
          i2_speed_kmh: toOptionalNumber(row.i2_speed),
          speed_trap_kmh: toOptionalNumber(row.st_speed),
          tyre_compound: row.tyre_compound || matchingStint?.compound,
          tyre_age_laps: row.tyre_age_laps ?? matchingStint?.tyre_age_at_start,
          stint_number: matchingStint?.stint_number,
          is_pit_lap: row.is_pit_out_lap === true,
          is_valid: !row.is_deleted,
        },
      });
    }

    // Fetch positions
    console.log(`  → Fetching positions...`);
    const positionsUrl = `${BASE_URL}/position?session_key=${sessionKey}`;
    const intervals: any[] = await fetchOptionalArray(positionsUrl, "position");

    for (const row of intervals) {
      events.push({
        schema_version: CANONICAL_SCHEMA_VERSION,
        source: "openf1",
        ingest_time_utc: new Date().toISOString(),
        event_time_utc: row.date || new Date().toISOString(),
        meeting_key: meetingKey,
        session_key: sessionKey,
        kind: "position",
        driver: {
          number: row.driver_number,
          code: row.driver_code,
        },
        payload: {
          position: row.position,
          gap_to_leader_ms: null,
          interval_to_ahead_ms: null,
        },
      });
    }

    // Fetch weather (updated every minute)
    if (profileSettings.includeWeather) {
      console.log(`  → Fetching weather...`);
      const weatherUrl = `${BASE_URL}/weather?session_key=${sessionKey}`;
      const weather: any[] = await fetchOptionalArray(weatherUrl, "weather");

      for (const row of weather) {
        events.push({
          schema_version: CANONICAL_SCHEMA_VERSION,
          source: "openf1",
          ingest_time_utc: new Date().toISOString(),
          event_time_utc: row.date || new Date().toISOString(),
          meeting_key: meetingKey,
          session_key: sessionKey,
          kind: "weather",
          driver: undefined,
          payload: {
            air_temperature_c: row.air_temperature,
            track_temperature_c: row.track_temperature,
            wind_speed_kmh: row.wind_speed,
            wind_direction_deg: row.wind_direction,
            humidity_percent: row.humidity,
            rainfall: row.rainfall,
          },
        });
      }
    }

    // Fetch race control messages
    if (profileSettings.includeRaceControl) {
      console.log(`  → Fetching race_control...`);
      const rcUrl = `${BASE_URL}/race_control?session_key=${sessionKey}`;
      const raceControl: any[] = await fetchOptionalArray(rcUrl, "race_control");

      for (const row of raceControl) {
        events.push({
          schema_version: CANONICAL_SCHEMA_VERSION,
          source: "openf1",
          ingest_time_utc: new Date().toISOString(),
          event_time_utc: row.date || new Date().toISOString(),
          meeting_key: meetingKey,
          session_key: sessionKey,
          kind: "race_control",
          driver: undefined,
          payload: {
            category: row.category,
            message: row.message,
            severity: row.severity || "info",
          },
        });
      }
    }

    if (profileSettings.includeTeamRadio) {
      console.log(`  → Fetching team_radio...`);
      const teamRadioUrl = `${BASE_URL}/team_radio?session_key=${sessionKey}`;
      const teamRadio: any[] = await fetchOptionalArray(teamRadioUrl, "team_radio");

      for (const row of teamRadio) {
        const driverNumber = Number(row.driver_number);
        if (!Number.isFinite(driverNumber)) {
          continue;
        }

        const prev = drivers.get(driverNumber);
        events.push({
          schema_version: CANONICAL_SCHEMA_VERSION,
          source: "openf1",
          ingest_time_utc: new Date().toISOString(),
          event_time_utc: row.date || sessionData.date_end || sessionData.date_start || new Date().toISOString(),
          meeting_key: meetingKey,
          session_key: sessionKey,
          kind: "radio",
          driver: {
            number: driverNumber,
            code: prev?.code || `D${driverNumber}`,
          },
          payload: {
            message: "Team radio available",
            audio_url: typeof row.recording_url === "string" ? row.recording_url : undefined,
          },
        });
      }
    }

    if (profileSettings.includeResult) {
      console.log(`  → Fetching session_result...`);
      const resultUrl = `${BASE_URL}/session_result?session_key=${sessionKey}`;
      const results: any[] = await fetchOptionalArray(resultUrl, "session_result");

      for (const row of results) {
        const driverNumber = Number(row.driver_number);
        if (!Number.isFinite(driverNumber)) {
          continue;
        }

        const prev = drivers.get(driverNumber);
        events.push({
          schema_version: CANONICAL_SCHEMA_VERSION,
          source: "openf1",
          ingest_time_utc: new Date().toISOString(),
          event_time_utc: sessionData.date_end || row.date || sessionData.date_start || new Date().toISOString(),
          meeting_key: meetingKey,
          session_key: sessionKey,
          kind: "result",
          driver: {
            number: driverNumber,
            code: prev?.code || `D${driverNumber}`,
          },
          payload: {
            position: Number(row.position) || 0,
            points: toOptionalNumber(row.points) ?? 0,
            status: mapResultStatus(row),
            grid_position: toOptionalNumber(row.grid_position),
            laps_completed: toOptionalNumber(row.number_of_laps),
            time_or_retired: formatResultTime(row),
          },
        });
      }
    }

    // Sort events by time (deterministic)
    events.sort((a, b) => (a.event_time_utc || "").localeCompare(b.event_time_utc || ""));

    console.log(`  ✓ Imported ${events.length} events from OpenF1`);

    const manifest = buildSessionManifest({
      sessionKey,
      profile,
      sessionData,
      meetingKey,
      meetingData,
      drivers,
      startingGrid,
    });

    return { events, manifest };
  } catch (err) {
    console.error(`[ERROR] Failed to import OpenF1 session: ${err}`);
    throw err;
  }
}

export async function backfillOpenF1Manifest(
  manifestPath: string,
  options: { force?: boolean } = {}
): Promise<{ updated: boolean; sessionKey: number; manifest: SessionManifest }> {
  const raw = await fs.readFile(manifestPath, "utf8");
  const existingManifest = JSON.parse(raw) as SessionManifest;
  const sessionKey = Number(existingManifest.session_key);

  if (!Number.isInteger(sessionKey) || sessionKey <= 0) {
    throw new Error(`Invalid manifest session key in ${manifestPath}`);
  }

  const needsMeetingContext = !existingManifest.meeting_context;
  const needsDriverEnrichment = existingManifest.drivers.some(
    (driver) => !driver.broadcast_name || !driver.headshot_url || !driver.country_code
  );
  const needsStartingGrid = !existingManifest.starting_grid || existingManifest.starting_grid.length === 0;
  const needsAssetMirror =
    Boolean(existingManifest.meeting_context?.country_flag && /^https?:\/\//i.test(existingManifest.meeting_context.country_flag)) ||
    Boolean(existingManifest.meeting_context?.circuit_image && /^https?:\/\//i.test(existingManifest.meeting_context.circuit_image)) ||
    existingManifest.drivers.some((driver) => Boolean(driver.headshot_url && /^https?:\/\//i.test(driver.headshot_url)));

  if (!options.force && !needsMeetingContext && !needsDriverEnrichment && !needsStartingGrid && !needsAssetMirror) {
    return { updated: false, sessionKey, manifest: existingManifest };
  }

  console.log(`\n[BACKFILL] Manifest ${sessionKey}`);
  const { sessionData, meetingKey, meetingData, drivers, startingGrid } = await fetchSessionMetadata(sessionKey);
  const manifest = buildSessionManifest({
    sessionKey,
    sessionData,
    meetingKey,
    meetingData,
    drivers,
    startingGrid,
    existingManifest,
  });
  const mirroredManifest = await mirrorSessionManifestAssets(manifest, path.dirname(manifestPath), {
    force: options.force,
  });

  await fs.writeFile(manifestPath, JSON.stringify(mirroredManifest, null, 2), "utf8");
  return { updated: true, sessionKey, manifest: mirroredManifest };
}

export async function backfillOpenF1Manifests(
  outputDir: string,
  options: { force?: boolean; sessionKeys?: number[] } = {}
): Promise<{ updated: number; skipped: number; failed: number; sessionKeys: number[] }> {
  const files = await fs.readdir(outputDir);
  const sessionFilter = options.sessionKeys ? new Set(options.sessionKeys) : null;
  const manifestFiles = files
    .filter((fileName) => fileName.startsWith("manifest_") && fileName.endsWith(".json"))
    .map((fileName) => path.join(outputDir, fileName))
    .filter((filePath) => {
      if (!sessionFilter) {
        return true;
      }
      const matched = path.basename(filePath).match(/manifest_(\d+)\.json$/);
      return matched ? sessionFilter.has(Number(matched[1])) : false;
    })
    .sort((a, b) => a.localeCompare(b));

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const touchedSessionKeys: number[] = [];

  for (const manifestPath of manifestFiles) {
    try {
      const result = await backfillOpenF1Manifest(manifestPath, { force: options.force });
      touchedSessionKeys.push(result.sessionKey);
      if (result.updated) {
        updated += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(`[BACKFILL] Failed ${path.basename(manifestPath)}:`, err);
    }
  }

  return { updated, skipped, failed, sessionKeys: touchedSessionKeys };
}

/**
 * List available sessions from OpenF1
 */
export async function listOpenF1Sessions(year?: number): Promise<any[]> {
  const url = year ? `${BASE_URL}/sessions?year=${year}` : `${BASE_URL}/sessions`;
  const sessions = await fetchCached(url);
  return sessions;
}

export async function listOpenF1Meetings(year?: number): Promise<any[]> {
  const url = year ? `${BASE_URL}/meetings?year=${year}` : `${BASE_URL}/meetings`;
  const meetings = await fetchCached(url);
  return meetings;
}

export { fetchCached, fetchWithBackoff };
