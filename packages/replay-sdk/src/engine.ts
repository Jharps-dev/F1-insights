/**
 * Deterministic Replay Engine
 * 
 * Core responsibility: transform an append-only event log into time-addressed state snapshots.
 * All state is derived from events; no wall-clock or side effects in state computation.
 */

import crypto from "crypto";
import { CanonicalEvent, DriverLocationState, InsightCard, RadioMessage, StintState, TowerState, StateStreamMessage } from "@f1-insights/schemas";

/**
 * Replay Clock: maps wall-clock to replay-time
 * Supports pause, speed changes, seek
 */
export class ReplayClock {
  private paused = true;
  private speed = 1.0; // Playback speed multiplier
  private replayTimeMs = 0; // Current position in replay timeline
  private wallTimeStart = Date.now();
  private replayTimeAtWallStart = 0;

  constructor() {}

  /**
   * Start playback
   */
  play(): void {
    this.paused = false;
    this.wallTimeStart = Date.now();
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (!this.paused) {
      // Capture current replay time before pausing
      this.replayTimeAtWallStart = this.getCurrentReplayTime();
      this.paused = true;
    }
  }

  /**
   * Set playback speed (0.5x, 1x, 2x, 8x, etc.)
   */
  setSpeed(speed: number): void {
    if (!this.paused) {
      // Adjust wall time anchor to prevent jump
      const currentReplayTime = this.getCurrentReplayTime();
      this.replayTimeAtWallStart = currentReplayTime;
      this.wallTimeStart = Date.now();
    }
    this.speed = Math.max(0.1, speed);
  }

  /**
   * Seek to absolute time in replay
   */
  seekTo(replayTimeMs: number): void {
    this.replayTimeAtWallStart = replayTimeMs;
    this.wallTimeStart = Date.now();
  }

  /**
   * Get current replay time (without advancing it)
   */
  getCurrentReplayTime(): number {
    if (this.paused) {
      return this.replayTimeAtWallStart;
    }
    const wallElapsed = Date.now() - this.wallTimeStart;
    return this.replayTimeAtWallStart + wallElapsed * this.speed;
  }

  /**
   * Check if we've reached a target time yet
   */
  hasReached(targetTimeMs: number): boolean {
    return this.getCurrentReplayTime() >= targetTimeMs;
  }

  getState() {
    return {
      paused: this.paused,
      speed: this.speed,
      currentReplayTimeMs: this.getCurrentReplayTime(),
    };
  }
}

/**
 * Event Cursor: efficiently seek through event log
 */
export class EventCursor {
  private events: CanonicalEvent[];
  private eventTimesMs: number[];
  private cursor = 0; // Index in events array

  private static parseEventTime(event: CanonicalEvent): number {
    const ts = Date.parse(event.event_time_utc || "");
    return Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER;
  }

  constructor(events: CanonicalEvent[]) {
    // Sort by parsed timestamp to keep deterministic temporal ordering.
    this.events = [...events].sort((a, b) => {
      const ta = EventCursor.parseEventTime(a);
      const tb = EventCursor.parseEventTime(b);
      if (ta !== tb) {
        return ta - tb;
      }
      return (a.event_time_utc || "").localeCompare(b.event_time_utc || "");
    });
    this.eventTimesMs = this.events.map((event) => EventCursor.parseEventTime(event));
  }

  /**
   * Seek to a specific replay time and return all events up to that point
   */
  seekToTime(targetTimeMs: number): CanonicalEvent[] {
    // Binary search for the right position
    let lo = 0;
    let hi = this.events.length;

    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const midTime = this.eventTimesMs[mid];
      if (midTime <= targetTimeMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    this.cursor = lo;
    return this.events.slice(0, lo);
  }

  /**
   * Get next batch of events (up to a certain replay time or count)
   */
  getNextEvents(upToTimeMs?: number, maxCount = 1000): CanonicalEvent[] {
    let endIdx = this.cursor;

    if (typeof upToTimeMs === "number") {
      // Only emit events whose event_time_utc has been reached on the replay clock,
      // capped by maxCount for backpressure.
      while (
        endIdx < this.events.length &&
        endIdx - this.cursor < maxCount &&
        this.eventTimesMs[endIdx] <= upToTimeMs
      ) {
        endIdx++;
      }
    } else {
      endIdx = Math.min(this.cursor + maxCount, this.events.length);
    }

    const batch = this.events.slice(this.cursor, endIdx);
    this.cursor = endIdx;
    return batch;
  }

  /**
   * Reset to start
   */
  reset(): void {
    this.cursor = 0;
  }

  /**
   * Get total event count
   */
  getTotalEvents(): number {
    return this.events.length;
  }

  /**
   * Get current cursor position
   */
  getCursorPosition(): number {
    return this.cursor;
  }
}

/**
 * State Builder: stateful accumulator that projects events → UI state
 * 
 * All state is derived deterministically from events.
 * If we replay the same events in the same order, we get identical state.
 */
export class StateBuilder {
  private driverStates: Map<number, DriverState> = new Map();
  private driverCatalog = new Map<number, { code: string; name?: string; team?: string; team_color?: string }>();
  private raceControlMessages: RaceControlEntry[] = [];
  private radioMessages: RadioMessage[] = [];
  private telemetryBuffers: Map<number, TelemetryBuffer> = new Map();
  private eventsSeen = 0;
  private lastEventTime = "";
  // Session-best sector times — updated as lap events arrive.
  private sessionBestS1Ms: number | undefined;
  private sessionBestS2Ms: number | undefined;
  private sessionBestS3Ms: number | undefined;

  /**
   * Process a batch of events and update internal state
   */
  processEvents(events: CanonicalEvent[]): void {
    for (const event of events) {
      this.processEvent(event);
    }
  }

  private processEvent(event: CanonicalEvent): void {
    this.eventsSeen++;
    if (event.event_time_utc) {
      this.lastEventTime = event.event_time_utc;
    }

    const driverNumber = event.driver?.number;

    switch (event.kind) {
      case "car_data": {
        if (!driverNumber) break;
        const payload = event.payload as any;

        const state = this.getOrCreateDriver(driverNumber);
        state.status = "running";
        state.lastTelemetry = {
          speed: payload.speed,
          throttle: payload.throttle,
          brake: payload.brake,
          laptop_number: payload.lap_number,
          time_ms: new Date(event.event_time_utc || Date.now()).getTime(),
        };

        const buffer = this.getOrCreateTelemetryBuffer(driverNumber);
        buffer.addSample(payload);
        break;
      }

      case "lap": {
        if (!driverNumber) break;
        const payload = event.payload as any;
        const state = this.getOrCreateDriver(driverNumber);

        state.currentLap = payload.lap_number;
        state.currentStintNumber = payload.stint_number ?? state.currentStintNumber ?? 1;
        state.tyreCompound = payload.tyre_compound;
        state.tyreAge = payload.tyre_age_laps;
        state.status = payload.is_pit_lap ? "pit" : "running";

        if (payload.lap_duration_ms > 0) {
          state.lastLapMs = payload.lap_duration_ms;
          state.bestLapMs = Math.min(state.bestLapMs ?? payload.lap_duration_ms, payload.lap_duration_ms);
        }

        if (!payload.is_pit_lap && payload.is_valid !== false && payload.lap_duration_ms > 0) {
          state.lapHistory.push({
            lap: payload.lap_number,
            lapMs: payload.lap_duration_ms,
            gapToLeaderMs: state.gapToLeaderMs,
            intervalToAheadMs: state.intervalToAheadMs,
            tyreCompound: payload.tyre_compound,
            tyreAge: payload.tyre_age_laps,
            stintNumber: payload.stint_number ?? state.currentStintNumber ?? 1,
            eventTimeMs: new Date(event.event_time_utc || Date.now()).getTime(),
          });
          if (state.lapHistory.length > 60) {
            state.lapHistory.shift();
          }
        }

        if (payload.sector_1_ms) {
          state.sector1Ms = payload.sector_1_ms;
          state.bestSector1Ms = Math.min(state.bestSector1Ms ?? payload.sector_1_ms, payload.sector_1_ms);
          this.sessionBestS1Ms = Math.min(this.sessionBestS1Ms ?? payload.sector_1_ms, payload.sector_1_ms);
        }
        if (payload.sector_2_ms) {
          state.sector2Ms = payload.sector_2_ms;
          state.bestSector2Ms = Math.min(state.bestSector2Ms ?? payload.sector_2_ms, payload.sector_2_ms);
          this.sessionBestS2Ms = Math.min(this.sessionBestS2Ms ?? payload.sector_2_ms, payload.sector_2_ms);
        }
        if (payload.sector_3_ms) {
          state.sector3Ms = payload.sector_3_ms;
          state.bestSector3Ms = Math.min(state.bestSector3Ms ?? payload.sector_3_ms, payload.sector_3_ms);
          this.sessionBestS3Ms = Math.min(this.sessionBestS3Ms ?? payload.sector_3_ms, payload.sector_3_ms);
        }
        if (payload.i1_speed_kmh) {
          state.bestI1SpeedKmh = Math.max(state.bestI1SpeedKmh ?? payload.i1_speed_kmh, payload.i1_speed_kmh);
        }
        if (payload.i2_speed_kmh) {
          state.bestI2SpeedKmh = Math.max(state.bestI2SpeedKmh ?? payload.i2_speed_kmh, payload.i2_speed_kmh);
        }
        if (payload.speed_trap_kmh) {
          state.bestSpeedTrapKmh = Math.max(state.bestSpeedTrapKmh ?? payload.speed_trap_kmh, payload.speed_trap_kmh);
        }
        break;
      }

      case "location": {
        if (!driverNumber) break;
        const payload = event.payload as any;
        if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) {
          break;
        }

        const state = this.getOrCreateDriver(driverNumber);
        if (state.status !== "dnf") {
          state.status = "running";
        }
        state.latestLocation = {
          x: payload.x,
          y: payload.y,
          z: Number.isFinite(payload.z) ? payload.z : undefined,
          time_utc: event.event_time_utc || "",
        };
        break;
      }

      case "position": {
        if (!driverNumber) break;
        const payload = event.payload as any;
        const state = this.getOrCreateDriver(driverNumber);

        state.position = payload.position;
        state.gapToLeaderMs = payload.gap_to_leader_ms;
        state.intervalToAheadMs = payload.interval_to_ahead_ms;
        if (state.status !== "dnf") {
          state.status = "running";
        }
        break;
      }

      case "race_control": {
        const payload = event.payload as any;
        this.raceControlMessages.push({
          id: `rc_${this.eventsSeen}`,
          time_utc: event.event_time_utc || "",
          category: payload.category,
          message: payload.message,
          severity: payload.severity,
        });
        break;
      }

      case "radio": {
        const payload = event.payload as any;
        this.radioMessages.push({
          id: `radio_${this.eventsSeen}`,
          time_utc: event.event_time_utc || "",
          driver_number: driverNumber,
          driver_code: event.driver?.code,
          message: typeof payload.message === "string" ? payload.message : "Team radio available",
          audio_url: typeof payload.audio_url === "string" ? payload.audio_url : undefined,
        });
        if (this.radioMessages.length > 120) {
          this.radioMessages.shift();
        }
        break;
      }

      case "pit": {
        if (!driverNumber) break;
        const state = this.getOrCreateDriver(driverNumber);
        state.status = "pit_box";
        state.pitCount = (state.pitCount || 0) + 1;
        break;
      }

      case "result": {
        if (!driverNumber) break;
        const payload = event.payload as any;
        const state = this.getOrCreateDriver(driverNumber);
        state.finalPosition = payload.position;
        state.points = payload.points;
        state.status = payload.status === "dns" ? "dnf" : payload.status;
        break;
      }

      // Other kinds are processed but don't affect tower state for now
    }
  }

  /**
   * Build current tower state
   */
  buildTowerState(): TowerState {
    const sorted = Array.from(this.driverStates.values()).sort((a, b) => a.position - b.position);
    const leaderLap = sorted[0]?.currentLap ?? 0;
    const drivers = sorted.map((driver) => ({
        number: driver.number,
        code: driver.code,
        name: driver.name,
        team: driver.team,
        team_color: driver.teamColor,
        position: driver.position,
        tyre_compound: driver.tyreCompound,
        tyre_age: driver.tyreAge,
      current_lap: driver.currentLap,
        last_lap_ms: driver.lastLapMs,
        best_lap_ms: driver.bestLapMs,
        best_sector_1_ms: driver.bestSector1Ms,
        best_sector_2_ms: driver.bestSector2Ms,
        best_sector_3_ms: driver.bestSector3Ms,
      current_speed_kmh: driver.lastTelemetry?.speed,
      pit_count: driver.pitCount,
        intermediate_1_speed_kmh: driver.bestI1SpeedKmh,
        intermediate_2_speed_kmh: driver.bestI2SpeedKmh,
        speed_trap_kmh: driver.bestSpeedTrapKmh,
        gap_to_leader_ms: driver.gapToLeaderMs,
        interval_to_ahead_ms: driver.intervalToAheadMs,
        gap_trend_ms_per_lap: this.computeTrendPerLap(driver.lapHistory, "gapToLeaderMs"),
        interval_trend_ms_per_lap: this.computeTrendPerLap(driver.lapHistory, "intervalToAheadMs"),
        stint_number: driver.currentStintNumber,
        status: driver.status,
        sectors_state: this.getCurrentSectorStates(driver),
      }));

    return { lap: leaderLap, drivers };
  }

  /**
   * Get race control messages
   */
  getRaceControlMessages() {
    return this.raceControlMessages;
  }

  getRadioMessages() {
    return this.radioMessages;
  }

  buildDriverLocations(): DriverLocationState[] {
    return Array.from(this.driverStates.values())
      .filter((driver): driver is DriverState & { latestLocation: NonNullable<DriverState["latestLocation"]> } => Boolean(driver.latestLocation))
      .sort((a, b) => a.position - b.position)
      .map((driver) => ({
        driver_number: driver.number,
        code: driver.code,
        x: driver.latestLocation.x,
        y: driver.latestLocation.y,
        z: driver.latestLocation.z,
        time_utc: driver.latestLocation.time_utc,
        position: Number.isFinite(driver.position) ? driver.position : undefined,
        team_color: driver.teamColor,
      }));
  }

  buildStintStates(): StintState[] {
    const stints: StintState[] = [];

    for (const driver of this.driverStates.values()) {
      const byStint = new Map<number, LapHistoryEntry[]>();
      for (const lap of driver.lapHistory) {
        const stintNumber = lap.stintNumber ?? 1;
        if (!byStint.has(stintNumber)) {
          byStint.set(stintNumber, []);
        }
        byStint.get(stintNumber)!.push(lap);
      }

      for (const [stintNumber, laps] of byStint.entries()) {
        const sorted = [...laps].sort((a, b) => a.lap - b.lap);
        const lapTimes = sorted.map((lap) => lap.lapMs).filter((lapMs) => lapMs > 0);
        if (lapTimes.length === 0) {
          continue;
        }

        const mean = Math.round(lapTimes.reduce((sum, value) => sum + value, 0) / lapTimes.length);
        const best = Math.min(...lapTimes);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const lapSpan = Math.max(1, last.lap - first.lap);
        const degradation = lapSpan > 0 ? Math.round((last.lapMs - first.lapMs) / lapSpan) : 0;

        stints.push({
          driver_number: driver.number,
          stint_number: stintNumber,
          lap_start: first.lap,
          lap_end: last.lap,
          tyre_compound: (last.tyreCompound || first.tyreCompound || "H") as StintState["tyre_compound"],
          current_lap: driver.currentLap,
          lap_count: sorted.length,
          best_lap_ms: best,
          last_lap_ms: last.lapMs,
          pace_mean_ms: mean,
          pace_delta_to_pb_ms: Math.round(mean - best),
          degradation_rate: degradation,
        });
      }
    }

    return stints.sort((a, b) => {
      if (a.driver_number !== b.driver_number) {
        return a.driver_number - b.driver_number;
      }
      return a.stint_number - b.stint_number;
    });
  }

  buildInsightCards(replayTimeMs: number): InsightCard[] {
    const stintStates = this.buildStintStates();
    const insights: InsightCard[] = [];

    for (const driver of this.driverStates.values()) {
      const intervalTrend = this.computeTrendPerLap(driver.lapHistory, "intervalToAheadMs");
      const gapTrend = this.computeTrendPerLap(driver.lapHistory, "gapToLeaderMs");
      const intervalWindow = this.getTrendWindow(driver.lapHistory, "intervalToAheadMs");
      const gapWindow = this.getTrendWindow(driver.lapHistory, "gapToLeaderMs");

      if (typeof intervalTrend === "number" && intervalWindow && Math.abs(intervalTrend) >= 150) {
        insights.push({
          id: `interval_${driver.number}_${intervalWindow.startLap}_${intervalWindow.endLap}`,
          kind: intervalTrend < 0 ? "gaining" : "losing",
          driver_number: driver.number,
          replay_time_ms: Math.round(replayTimeMs),
          headline:
            intervalTrend < 0
              ? `${driver.code} is gaining on the car ahead`
              : `${driver.code} is losing time to the car ahead`,
          rationale:
            intervalTrend < 0
              ? `Interval improved by ${Math.abs(intervalWindow.deltaMs)} ms across the last ${intervalWindow.windowLaps} timed laps.`
              : `Interval widened by ${Math.abs(intervalWindow.deltaMs)} ms across the last ${intervalWindow.windowLaps} timed laps.`,
          confidence: intervalWindow.windowLaps >= 3 ? "high" : "medium",
          metric_ms: Math.abs(intervalTrend),
          window_laps: intervalWindow.windowLaps,
        });
      } else if (driver.position > 1 && typeof gapTrend === "number" && gapWindow && Math.abs(gapTrend) >= 250) {
        insights.push({
          id: `gap_${driver.number}_${gapWindow.startLap}_${gapWindow.endLap}`,
          kind: gapTrend < 0 ? "gaining" : "losing",
          driver_number: driver.number,
          replay_time_ms: Math.round(replayTimeMs),
          headline:
            gapTrend < 0
              ? `${driver.code} is closing on the leader`
              : `${driver.code} is dropping back from the leader`,
          rationale:
            gapTrend < 0
              ? `Gap to the leader reduced by ${Math.abs(gapWindow.deltaMs)} ms over the last ${gapWindow.windowLaps} timed laps.`
              : `Gap to the leader grew by ${Math.abs(gapWindow.deltaMs)} ms over the last ${gapWindow.windowLaps} timed laps.`,
          confidence: gapWindow.windowLaps >= 3 ? "medium" : "low",
          metric_ms: Math.abs(gapTrend),
          window_laps: gapWindow.windowLaps,
        });
      }

      const currentStint = stintStates.find(
        (stint) => stint.driver_number === driver.number && stint.stint_number === driver.currentStintNumber
      );
      if (
        currentStint &&
        (currentStint.lap_count ?? 0) >= 4 &&
        typeof currentStint.degradation_rate === "number" &&
        currentStint.degradation_rate >= 180
      ) {
        insights.push({
          id: `stint_${driver.number}_${currentStint.stint_number}`,
          kind: "stint_pressure",
          driver_number: driver.number,
          replay_time_ms: Math.round(replayTimeMs),
          headline: `${driver.code} tyre performance is fading`,
          rationale: `Current stint shows roughly ${currentStint.degradation_rate} ms/lap degradation across ${currentStint.lap_count} timed laps.`,
          confidence: (currentStint.lap_count ?? 0) >= 6 ? "high" : "medium",
          metric_ms: currentStint.degradation_rate,
          window_laps: currentStint.lap_count,
        });
      }
    }

    const deduped = new Map<string, InsightCard>();
    for (const insight of insights) {
      deduped.set(insight.id, insight);
    }

    return Array.from(deduped.values())
      .sort((a, b) => (b.metric_ms || 0) - (a.metric_ms || 0))
      .slice(0, 6);
  }

  /**
   * Determinism check: hash current state
   */
  getStateHash(): string {
    const state = {
      drivers: Array.from(this.driverStates.values()),
      raceControl: this.raceControlMessages,
    };
    const json = JSON.stringify(state, null, 0);
    return crypto.createHash("sha256").update(json).digest("hex");
  }

  /**
   * Reset state for new replay
   */
  reset(): void {
    this.driverStates.clear();
    this.raceControlMessages = [];
    this.telemetryBuffers.clear();
    this.eventsSeen = 0;
    this.lastEventTime = "";
    this.sessionBestS1Ms = undefined;
    this.sessionBestS2Ms = undefined;
    this.sessionBestS3Ms = undefined;
    this.radioMessages = [];
  }

  setDriverCatalog(
    drivers: Array<{ number: number; code: string; name?: string; team?: string; team_color?: string }>
  ): void {
    this.driverCatalog.clear();
    for (const driver of drivers) {
      this.driverCatalog.set(driver.number, {
        code: driver.code,
        name: driver.name,
        team: driver.team,
        team_color: driver.team_color,
      });

      // Seed placeholder entries so Replay Studio can render the session roster
      // immediately on load before the first position/lap events are processed.
      if (!this.driverStates.has(driver.number)) {
        this.driverStates.set(driver.number, {
          number: driver.number,
          code: driver.code,
          name: driver.name,
          team: driver.team,
          teamColor: driver.team_color,
          position: 999,
          status: "running",
          pitCount: 0,
          lapHistory: [],
        });
      }
    }
  }

  private getOrCreateDriver(number: number): DriverState {
    if (!this.driverStates.has(number)) {
      const info = this.driverCatalog.get(number);
      this.driverStates.set(number, {
        number,
        code: info?.code || `D${number}`,
        name: info?.name,
        team: info?.team,
        teamColor: info?.team_color,
        position: 999,
        status: "running",
        pitCount: 0,
        lapHistory: [],
      });
    }
    return this.driverStates.get(number)!;
  }

  private getOrCreateTelemetryBuffer(number: number): TelemetryBuffer {
    if (!this.telemetryBuffers.has(number)) {
      this.telemetryBuffers.set(number, new TelemetryBuffer(500)); // Ring buffer of 500 samples
    }
    return this.telemetryBuffers.get(number)!;
  }

  private getCurrentSectorStates(driver: DriverState): ("pb" | "sb" | "slow" | "none")[] {
    const classify = (
      current: number | undefined,
      driverBest: number | undefined,
      sessionBest: number | undefined
    ): "pb" | "sb" | "slow" | "none" => {
      if (!current) return "none";
      if (sessionBest !== undefined && current <= sessionBest) return "sb";
      if (driverBest !== undefined && current <= driverBest) return "pb";
      return "slow";
    };

    return [
      classify(driver.sector1Ms, driver.bestSector1Ms, this.sessionBestS1Ms),
      classify(driver.sector2Ms, driver.bestSector2Ms, this.sessionBestS2Ms),
      classify(driver.sector3Ms, driver.bestSector3Ms, this.sessionBestS3Ms),
    ];
  }

  private computeTrendPerLap(
    lapHistory: LapHistoryEntry[],
    key: "gapToLeaderMs" | "intervalToAheadMs"
  ): number | undefined {
    const window = this.getTrendWindow(lapHistory, key);
    if (!window) {
      return undefined;
    }
    return Math.round(window.deltaMs / window.windowLaps);
  }

  private getTrendWindow(
    lapHistory: LapHistoryEntry[],
    key: "gapToLeaderMs" | "intervalToAheadMs"
  ): { startLap: number; endLap: number; deltaMs: number; windowLaps: number } | undefined {
    const valid = lapHistory.filter((entry) => typeof entry[key] === "number");
    if (valid.length < 2) {
      return undefined;
    }

    const window = valid.slice(-4);
    const first = window[0];
    const last = window[window.length - 1];
    const startValue = first[key];
    const endValue = last[key];
    if (typeof startValue !== "number" || typeof endValue !== "number") {
      return undefined;
    }

    return {
      startLap: first.lap,
      endLap: last.lap,
      deltaMs: endValue - startValue,
      windowLaps: Math.max(1, last.lap - first.lap),
    };
  }
}

/**
 * Driver state: accumulated from events
 */
interface DriverState {
  number: number;
  code: string;
  name?: string;
  team?: string;
  teamColor?: string;
  position: number;
  currentLap?: number;
  lastLapMs?: number;
  bestLapMs?: number;
  sector1Ms?: number;
  sector2Ms?: number;
  sector3Ms?: number;
  bestSector1Ms?: number;
  bestSector2Ms?: number;
  bestSector3Ms?: number;
  bestI1SpeedKmh?: number;
  bestI2SpeedKmh?: number;
  bestSpeedTrapKmh?: number;
  tyreCompound?: string;
  tyreAge?: number;
  currentStintNumber?: number;
  gapToLeaderMs?: number;
  intervalToAheadMs?: number;
  status: "running" | "pit" | "pit_box" | "dnf";
  pitCount: number;
  lapHistory: LapHistoryEntry[];
  lastTelemetry?: { speed: number; throttle: number; brake: number; laptop_number?: number; time_ms: number };
  latestLocation?: { x: number; y: number; z?: number; time_utc: string };
  finalPosition?: number;
  points?: number;
}

interface LapHistoryEntry {
  lap: number;
  lapMs: number;
  gapToLeaderMs?: number;
  intervalToAheadMs?: number;
  tyreCompound?: string;
  tyreAge?: number;
  stintNumber?: number;
  eventTimeMs: number;
}

interface RaceControlEntry {
  id: string;
  time_utc: string;
  category: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

/**
 * Ring buffer for telemetry (last N samples)
 */
class TelemetryBuffer {
  private samples: any[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  addSample(sample: any): void {
    this.samples.push(sample);
    if (this.samples.length > this.maxSize) {
      this.samples.shift();
    }
  }

  getSamples() {
    return this.samples;
  }

  clear() {
    this.samples = [];
  }
}

export { DriverState, RaceControlEntry, TelemetryBuffer };
