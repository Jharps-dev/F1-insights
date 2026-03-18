/**
 * Canonical Event Schema v1.0
 * 
 * All upstream sources (OpenF1, FastF1, Jolpica, FIA PDFs) map to this schema.
 * This is append-only, time-addressed, deterministic.
 * 
 * Replay-safe: identical event sequence always produces identical state.
 */

export const CANONICAL_SCHEMA_VERSION = "1.0";

/**
 * Core event envelope — every event in the system follows this structure.
 */
export interface CanonicalEvent {
  // Schema versioning for backward compatibility
  schema_version: "1.0";

  // Source of the event (used for priority resolution when sources conflict)
  source: "openf1" | "fastf1" | "jolpica" | "fia_pdf" | "licensed_provider";

  // Wall-clock UTC times
  ingest_time_utc: string; // When we received/processed this event (ISO 8601)
  event_time_utc: string; // When the event actually occurred (ISO 8601, may be null)

  // Session identity
  meeting_key: number | null; // Formula 1 meeting ID
  session_key: number | null; // Formula 1 session ID (unique within meeting)

  // Event classification (kind + payload together describe what happened)
  kind:
    | "car_data" // Telemetry: speed, throttle, brake, gear, RPM
    | "location" // Driver x/y coordinates around the circuit
    | "lap" // Lap time + metadata
    | "position" // Driver position/interval changes
    | "weather" // Track/air temperature, wind
    | "race_control" // Safety car, flags, investigations
    | "pit" // Pit stop event
    | "radio" // Team radio message
    | "penalty" // Penalty decision
    | "result" // Final classification
    | "document" // Official FIA document
    | "derived"; // Computed metric (pace model, prediction, etc.)

  // Driver context (null for session/weather events)
  driver?: {
    number: number; // 1-99
    code: string; // 3-letter code (HAM, VER, etc.)
  };

  // Payload is kind-specific; see types below
  payload: unknown;

  /**
   * INTERNAL: Deterministic sort key for stable ordering
   * (source priority, event_time_utc, stable tie-break)
   */
  _sort_key?: string;
}

/**
 * Telemetry event: 3.7 Hz sample rate from OpenF1
 */
export interface CarDataPayload {
  speed: number; // km/h
  throttle: number; // 0-1
  brake: number; // 0-1
  rpm: number; // revolutions per minute
  n_gear: number; // -1 (R), 0 (N), 1-8
  drs: boolean; // DRS open?
  lap_number?: number;
  session_time?: number; // Seconds from session start (OpenF1 convention)
}

/**
 * Location event: driver coordinates in circuit space
 */
export interface LocationPayload {
  x: number;
  y: number;
  z?: number;
  session_time?: number; // Seconds from session start when provided by source
}

/**
 * Lap event: posted when a lap is completed or updated
 */
export interface LapPayload {
  lap_number: number;
  lap_duration_ms: number; // Total lap time
  sector_1_ms?: number; // Sector times when available
  sector_2_ms?: number;
  sector_3_ms?: number;
  i1_speed_kmh?: number;
  i2_speed_kmh?: number;
  speed_trap_kmh?: number;
  tyre_compound?: "S" | "M" | "H" | "I" | "W";
  tyre_age_laps?: number;
  is_pit_lap?: boolean;
  pit_loss_ms?: number;
  is_valid?: boolean;
  stint_number?: number;
}

/**
 * Position event: driver movements in the order
 */
export interface PositionPayload {
  position: number; // 1, 2, 3, ...
  gap_to_leader_ms?: number; // Gap in milliseconds
  interval_to_ahead_ms?: number; // Gap to car ahead
}

/**
 * Weather event: track conditions updated ~every minute
 */
export interface WeatherPayload {
  air_temperature_c: number;
  track_temperature_c: number;
  wind_speed_kmh: number;
  wind_direction_deg: number; // 0-360
  humidity_percent?: number;
  rainfall?: boolean;
}

/**
 * Race control: safety car, flags, investigations
 */
export interface RaceControlPayload {
  category: "safety_car" | "flag" | "investigation" | "track_status";
  message: string;
  severity: "info" | "warning" | "critical";
  triggered_by_driver?: number;
}

/**
 * Pit stop event
 */
export interface PitPayload {
  pit_entry_lap: number;
  pit_exit_lap?: number;
  pit_loss_ms?: number;
  tyre_set_new?: "S" | "M" | "H" | "I" | "W";
}

/**
 * Team radio: driver/engineer communication
 */
export interface RadioPayload {
  message: string;
  speaker?: "driver" | "engineer" | "pit_wall";
  audio_url?: string;
}

/**
 * Final result/classification
 */
export interface ResultPayload {
  position: number;
  points: number;
  status: "finished" | "dnf" | "dns" | "disqualified";
  grid_position?: number;
  laps_completed?: number;
  time_or_retired?: string;
  penalties?: Array<{ 
    type: string; 
    reason: string; 
    time_penalty?: number; 
  }>;
}

export interface StartingGridEntry {
  position: number;
  driver_number: number;
  driver_code?: string;
  driver_name?: string;
  team_name?: string;
  team_color?: string;
  grid_time?: string;
}

/**
 * FIA Official Document
 */
export interface DocumentPayload {
  doc_id: string;
  title: string;
  document_type: "classification" | "decision" | "penalty" | "document";
  published_time_utc: string;
  url: string;
  extracted_text?: string;
}

/**
 * Session manifest: metadata for a replay dataset
 */
export interface SessionManifest {
  schema_version: "1.0";
  dataset_name: string;
  created_utc: string;

  // Optional provenance metadata from source APIs
  year?: number;
  meeting_name?: string;
  session_name?: string;
  date_start_utc?: string;
  date_end_utc?: string;
  import_profile?: "lite" | "standard" | "full";

  // Session metadata
  meeting_key: number;
  session_key: number;
  session_type: string;
  circuit_short_name?: string;
  meeting_context?: {
    meeting_official_name?: string;
    location?: string;
    country_code?: string;
    country_name?: string;
    country_flag?: string;
    country_flag_source_url?: string;
    circuit_type?: string;
    circuit_info_url?: string;
    circuit_image?: string;
    circuit_image_source_url?: string;
  };
  starting_grid?: StartingGridEntry[];

  // Drivers in session
  drivers: Array<{
    number: number;
    code: string;
    name?: string;
    broadcast_name?: string;
    first_name?: string;
    last_name?: string;
    team?: string;
    team_color?: string;
    headshot_url?: string;
    headshot_source_url?: string;
    country_code?: string;
  }>;

  // Source priority for conflict resolution
  source_priority: ("fia_pdf" | "openf1" | "fastf1" | "jolpica" | "licensed_provider")[];

  // Time basis
  time_basis: "utc" | "session_relative";

  // File structure
  files: {
    events_jsonl: string; // Path to JSONL event log
    manifest_json: string; // This file
    raw_sources?: Record<string, string>; // Paths to raw source files (for audit/replay)
  };
}

/**
 * Stream message sent to UI clients over WebSocket
 * Combines state delta + sequence number for idempotent updates
 */
export interface StateStreamMessage {
  type: "state_delta" | "checkpoint" | "error" | "status";
  
  // Sequence metadata
  sequence_id: number; // Monotonically increasing
  replay_time_ms: number; // Current replay clock position
  wall_time_utc: string;

  // State payload
  payload: {
    tower?: TowerState;
    telemetry?: TelemetryWindow;
    locations?: DriverLocationState[];
    stints?: StintState[];
    insights?: InsightCard[];
    race_control?: RaceControlMessage[];
    radios?: RadioMessage[];
    driver_focus?: number | null; // Driver number if focused
  };

  // For backpressure
  queue_depth?: number;
  recommended_fps?: number; // If we're overwhelmed, suggest client reduce rate
}

/**
 * Live timing tower state
 */
export interface TowerState {
  lap: number;
  drivers: Array<{
    number: number;
    code: string;
    name?: string;
    team?: string;
    team_color?: string;
    position: number;
    tyre_compound?: string;
    tyre_age?: number;
    current_lap?: number;
    last_lap_ms?: number;
    best_lap_ms?: number;
    best_sector_1_ms?: number;
    best_sector_2_ms?: number;
    best_sector_3_ms?: number;
    current_speed_kmh?: number;
    pit_count?: number;
    intermediate_1_speed_kmh?: number;
    intermediate_2_speed_kmh?: number;
    speed_trap_kmh?: number;
    gap_to_leader_ms?: number;
    interval_to_ahead_ms?: number;
    gap_trend_ms_per_lap?: number;
    interval_trend_ms_per_lap?: number;
    stint_number?: number;
    status: "running" | "pit" | "dnf" | "pit_box";
    sectors_state?: ("pb" | "sb" | "slow" | "none")[];
  }>;
}

/**
 * Telemetry data window (last N seconds)
 */
export interface TelemetryWindow {
  driver_number: number;
  window_start_ms: number;
  window_end_ms: number;
  samples: Array<{
    t_ms: number; // Time in replay
    speed: number;
    throttle: number;
    brake: number;
  }>;
}

export interface RadioMessage {
  id: string;
  time_utc: string;
  driver_number?: number;
  driver_code?: string;
  message: string;
  audio_url?: string;
}

/**
 * Latest known driver coordinates projected for the circuit map.
 */
export interface DriverLocationState {
  driver_number: number;
  code: string;
  x: number;
  y: number;
  z?: number;
  time_utc: string;
  position?: number;
  team_color?: string;
}

/**
 * Stint state (pace evolution)
 */
export interface StintState {
  driver_number: number;
  stint_number: number;
  lap_start: number;
  lap_end?: number;
  tyre_compound: "S" | "M" | "H" | "I" | "W";
  current_lap?: number;
  lap_count?: number;
  best_lap_ms?: number;
  last_lap_ms?: number;
  pace_mean_ms?: number;
  pace_delta_to_pb_ms?: number;
  degradation_rate?: number; // ms/lap
}

/**
 * Derived insight card for explainable analytics surfaces.
 */
export interface InsightCard {
  id: string;
  kind: "gaining" | "losing" | "stint_pressure";
  driver_number: number;
  rival_driver_number?: number;
  replay_time_ms: number;
  headline: string;
  rationale: string;
  confidence: "low" | "medium" | "high";
  metric_ms?: number;
  window_laps?: number;
}

/**
 * Race control message for UI
 */
export interface RaceControlMessage {
  id: string;
  time_utc: string;
  category: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

/**
 * Determinism check: identical input should produce identical output
 */
export interface DeterminismCheckpoint {
  replay_time_ms: number;
  event_count: number;
  state_hash: string; // SHA256(JSON.stringify(sorted_state))
  verified: boolean;
}
