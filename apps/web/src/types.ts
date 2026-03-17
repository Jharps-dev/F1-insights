/** Shared TypeScript types for the F1 Insights web app. */

export interface SessionManifest {
  schema_version: string;
  session_key: number;
  meeting_key: number;
  session_type: string;
  session_name?: string;
  circuit_short_name: string;
  year?: number;
  meeting_name?: string;
  date_start_utc?: string;
  date_end_utc?: string;
  import_profile?: "lite" | "standard" | "full";
  drivers: Array<{ number: number; code: string; name?: string; team?: string; team_color?: string }>;
  created_utc?: string;
}

export interface TowerDriver {
  number: number;
  code: string;
  name?: string;
  team?: string;
  team_color?: string;
  position: number;
  tyre_compound?: string;
  tyre_age?: number;
  last_lap_ms?: number;
  best_lap_ms?: number;
  gap_to_leader_ms?: number | null;
  interval_to_ahead_ms?: number | null;
  gap_trend_ms_per_lap?: number;
  interval_trend_ms_per_lap?: number;
  stint_number?: number;
  status?: string;
  sectors_state?: string[];
}

export interface TowerState {
  lap?: number;
  drivers: TowerDriver[];
}

export interface RaceControlMessage {
  id: string;
  time_utc: string;
  category?: string;
  message: string;
  severity?: "info" | "warning" | "critical";
}

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
  degradation_rate?: number;
}

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

export interface ReplayStatus {
  paused: boolean;
  speed: number;
  currentReplayTimeMs: number;
  durationMs?: number;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LiveStatus {
  sessionKey: number | null;
  hasAuthConfig: boolean;
  mqttUrl: string;
  liveImportProfile?: "lite" | "standard" | "full";
  connected: boolean;
  topicCount: number;
  messagesSeen: number;
  eventsEmitted: number;
  lastMessageAtUtc?: string;
  lastError?: string;
}
