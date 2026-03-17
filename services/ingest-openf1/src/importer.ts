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

const BASE_URL = "https://api.openf1.org/v1";
const CACHE_DIR = process.env.CACHE_DIR || ".cache/openf1";

export type ImportProfile = "lite" | "standard" | "full";

interface ImportProfileSettings {
  includeCarData: boolean;
  carDataKeepEvery: number;
  includeWeather: boolean;
  includeRaceControl: boolean;
}

const IMPORT_PROFILES: Record<ImportProfile, ImportProfileSettings> = {
  lite: {
    includeCarData: false,
    carDataKeepEvery: 1,
    includeWeather: true,
    includeRaceControl: true,
  },
  standard: {
    includeCarData: true,
    carDataKeepEvery: 5,
    includeWeather: true,
    includeRaceControl: true,
  },
  full: {
    includeCarData: true,
    carDataKeepEvery: 1,
    includeWeather: true,
    includeRaceControl: true,
  },
};

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
  const drivers = new Map<number, { number: number; code: string; name?: string; team?: string; team_color?: string }>();

  try {
    // Fetch sessions to find meeting/circuit context
    const sessionsUrl = `${BASE_URL}/sessions?session_key=${sessionKey}`;
    const sessionsList: any[] = await (options.cacheOnly ? [] : fetchCached(sessionsUrl));
    const sessionData = sessionsList[0];

    if (!sessionData) {
      throw new Error(`Session ${sessionKey} not found`);
    }

    const meetingKey = sessionData.meeting_key;
    console.log(`  Meeting: #${meetingKey}, Session: ${sessionData.session_name}, Date: ${sessionData.date_start || "unknown"}`);

    // Fetch drivers metadata early so we still have driver cards if telemetry endpoint is unavailable
    console.log(`  → Fetching drivers metadata...`);
    const driversUrl = `${BASE_URL}/drivers?session_key=${sessionKey}`;
    const sessionDrivers: any[] = await fetchOptionalArray(driversUrl, "drivers");
    for (const row of sessionDrivers) {
      if (row.driver_number) {
        drivers.set(row.driver_number, {
          number: row.driver_number,
          code: row.name_acronym || row.driver_code || `D${row.driver_number}`,
          name: row.full_name,
          team: row.team_name,
          team_color: row.team_colour,
        });
      }
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
            number: row.driver_number,
            code: row.driver_code || prev?.code || `D${row.driver_number}`,
            name: prev?.name,
            team: prev?.team,
            team_color: prev?.team_color,
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
        event_time_utc: row.date || new Date().toISOString(),
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
          sector_1_ms: row.sector_1_session_time ? row.sector_1_session_time * 1000 : null,
          sector_2_ms: row.sector_2_session_time ? row.sector_2_session_time * 1000 : null,
          sector_3_ms: row.sector_3_session_time ? row.sector_3_session_time * 1000 : null,
          tyre_compound: row.tyre_compound || matchingStint?.compound,
          tyre_age_laps: row.tyre_age_laps ?? matchingStint?.tyre_age_at_start,
          stint_number: matchingStint?.stint_number,
          is_pit_lap: row.pit_out_time !== null,
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

    // Sort events by time (deterministic)
    events.sort((a, b) => (a.event_time_utc || "").localeCompare(b.event_time_utc || ""));

    console.log(`  ✓ Imported ${events.length} events from OpenF1`);

    const manifest: SessionManifest = {
      schema_version: CANONICAL_SCHEMA_VERSION,
      dataset_name: `openf1_session_${sessionKey}`,
      created_utc: new Date().toISOString(),
      year: sessionData.year,
      meeting_name: sessionData.meeting_name,
      session_name: sessionData.session_name,
      date_start_utc: sessionData.date_start,
      date_end_utc: sessionData.date_end,
      import_profile: profile,
      meeting_key: meetingKey,
      session_key: sessionKey,
      session_type: sessionData.session_type || ("practice" as const),
      circuit_short_name: sessionData.circuit_short_name,
      drivers: Array.from(drivers.values()),
      source_priority: ["openf1"],
      time_basis: "utc",
      files: {
        events_jsonl: `events_${sessionKey}.jsonl`,
        manifest_json: `manifest_${sessionKey}.json`,
      },
    };

    return { events, manifest };
  } catch (err) {
    console.error(`[ERROR] Failed to import OpenF1 session: ${err}`);
    throw err;
  }
}

/**
 * List available sessions from OpenF1
 */
export async function listOpenF1Sessions(year?: number): Promise<any[]> {
  const url = year ? `${BASE_URL}/sessions?year=${year}` : `${BASE_URL}/sessions`;
  const sessions = await fetchCached(url);
  return sessions;
}

export { fetchCached, fetchWithBackoff };
