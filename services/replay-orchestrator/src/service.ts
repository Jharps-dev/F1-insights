/**
 * Replay Orchestrator Service
 * 
 * Core responsibilities:
 * - Manage replay clock and state
 * - Serve WebSocket clients with state deltas
 * - Implement backpressure and subscriptions
 * - Ensure determinism
 */

import fs from "fs/promises";
import path from "path";
import { EventEmitter } from "events";
import { CanonicalEvent, StateStreamMessage, SessionManifest } from "@f1-insights/schemas";
import { ReplayClock, EventCursor, StateBuilder } from "@f1-insights/replay-sdk";

export interface ReplayServiceConfig {
  dataDir: string; // Directory with JSONL event logs
  port?: number;
}

export class ReplayService extends EventEmitter {
  private clock: ReplayClock;
  private cursor: EventCursor | null = null;
  private events: CanonicalEvent[] = [];
  private sessionStartTimeMs: number | null = null;
  private stateBuilder: StateBuilder;
  private config: ReplayServiceConfig;
  private manifest: SessionManifest | null = null;
  private tickInterval: NodeJS.Timeout | null = null;
  private sequenceId = 0;
  private sessionDurationMs = 0;
  private subscribers = new Set<(msg: StateStreamMessage) => void>();

  constructor(config: ReplayServiceConfig) {
    super();
    this.config = config;
    this.clock = new ReplayClock();
    this.stateBuilder = new StateBuilder();
  }

  private getEventTimeMs(event: CanonicalEvent): number | null {
    const parsed = Date.parse(event.event_time_utc || "");
    return Number.isFinite(parsed) ? parsed : null;
  }

  private getManifestWindowMs(): { start: number | null; end: number | null } {
    const start = Date.parse(this.manifest?.date_start_utc || "");
    const end = Date.parse(this.manifest?.date_end_utc || "");
    return {
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
    };
  }

  /**
   * Load a session from JSONL
   */
  async loadSession(sessionKey: number): Promise<void> {
    // Hard reset runtime state to avoid stale replay time/data bleeding into new session.
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.clock.seekTo(0);
    this.clock.pause();

    const manifestPath = path.join(this.config.dataDir, `manifest_${sessionKey}.json`);
    const eventsPath = path.join(this.config.dataDir, `events_${sessionKey}.jsonl`);

    console.log(`[REPLAY] Loading session ${sessionKey}...`);

    // Load manifest
    const manifestJson = await fs.readFile(manifestPath, "utf8");
    this.manifest = JSON.parse(manifestJson);
    if (Array.isArray(this.manifest?.drivers)) {
      this.stateBuilder.setDriverCatalog(this.manifest.drivers);
    }

    // Load events from JSONL
    const lines = (await fs.readFile(eventsPath, "utf8")).trim().split("\n");
    const events: CanonicalEvent[] = lines
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));

    // Ensure deterministic ordering from source timestamps.
    // Fallback to lexical compare only when both timestamps are missing/unparseable.
    events.sort((a, b) => {
      const ta = this.getEventTimeMs(a);
      const tb = this.getEventTimeMs(b);
      if (ta !== null && tb !== null && ta !== tb) {
        return ta - tb;
      }
      if (ta !== null && tb === null) {
        return -1;
      }
      if (ta === null && tb !== null) {
        return 1;
      }
      return (a.event_time_utc || "").localeCompare(b.event_time_utc || "");
    });
    this.events = events;

    const rawTimes = events
      .map((event) => this.getEventTimeMs(event))
      .filter((value): value is number => value !== null);

    const { start: manifestStartMs, end: manifestEndMs } = this.getManifestWindowMs();
    const inManifestWindow =
      manifestStartMs !== null && manifestEndMs !== null
        ? rawTimes.filter((t) => t >= manifestStartMs - 6 * 60 * 60 * 1000 && t <= manifestEndMs + 6 * 60 * 60 * 1000)
        : [];

    const timelineTimes = inManifestWindow.length > 0 ? inManifestWindow : rawTimes;
    this.sessionStartTimeMs = timelineTimes.length > 0 ? Math.min(...timelineTimes) : null;
    this.sessionDurationMs =
      timelineTimes.length > 1 ? Math.max(0, Math.max(...timelineTimes) - this.sessionStartTimeMs!) : 0;

    console.log(`  ✓ Loaded ${events.length} events`);

    this.cursor = new EventCursor(events);
    this.stateBuilder.reset();
    if (Array.isArray(this.manifest?.drivers)) {
      this.stateBuilder.setDriverCatalog(this.manifest.drivers);
    }
    this.clock.seekTo(0);
    this.clock.pause();

    // Emit a deterministic reset snapshot immediately so clients clear stale UI.
    this.emitSnapshot();

    console.log(`  ✓ Session ready for replay`);
    this.emit("session-loaded", { sessionKey, eventCount: events.length });
  }

  /**
   * Start the replay ticker
   * Emits state deltas to subscribers at regular intervals
   */
  start(tickRateHz = 10): void {
    if (this.tickInterval) return;

    console.log(`[REPLAY] Starting at ${tickRateHz} Hz`);
    this.clock.play();

    const tickMs = 1000 / tickRateHz;
    this.tickInterval = setInterval(() => {
      this.tick();
    }, tickMs);
  }

  /**
   * Pause replay
   */
  pause(): void {
    this.clock.pause();
    console.log(`[REPLAY] Paused at ${this.clock.getCurrentReplayTime()}ms`);
  }

  /**
   * Set playback speed
   */
  setSpeed(speed: number): void {
    this.clock.setSpeed(speed);
    console.log(`[REPLAY] Speed set to ${speed}x`);
  }

  /**
   * Seek to a time
   */
  seek(replayTimeMs: number): void {
    if (!this.cursor || this.sessionStartTimeMs === null || !Number.isFinite(this.sessionStartTimeMs)) {
      return;
    }

    this.clock.seekTo(replayTimeMs);
    this.clock.pause();
    this.stateBuilder.reset();

    const absoluteTargetTimeMs = this.sessionStartTimeMs + replayTimeMs;
    const eventsUpToTime = this.cursor.seekToTime(absoluteTargetTimeMs);
    this.stateBuilder.processEvents(eventsUpToTime);
    this.emitSnapshot();

    console.log(`[REPLAY] Seeked to ${replayTimeMs}ms`);
  }

  /**
   * Subscribe to state updates
   */
  subscribe(callback: (msg: StateStreamMessage) => void): () => void {
    this.subscribers.add(callback);
    // Return unsubscribe function
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Core tick: compute state and emit update
   */
  private tick(): void {
    if (!this.cursor || this.sessionStartTimeMs === null || !Number.isFinite(this.sessionStartTimeMs)) {
      return;
    }

    const replayTime = this.clock.getCurrentReplayTime();
    const absoluteTargetTimeMs = this.sessionStartTimeMs + replayTime;

    // Apply only newly reached events for this replay time.
    const nextEvents = this.cursor.getNextEvents(absoluteTargetTimeMs);
    if (nextEvents.length > 0) {
      this.stateBuilder.processEvents(nextEvents);
    }

    const towerState = this.stateBuilder.buildTowerState();
    const locationState = this.stateBuilder.buildDriverLocations();
    const stintStates = this.stateBuilder.buildStintStates();
    const insightCards = this.stateBuilder.buildInsightCards(replayTime);
    const rcMessages = this.stateBuilder.getRaceControlMessages();

    const message: StateStreamMessage = {
      type: "state_delta",
      sequence_id: this.sequenceId++,
      replay_time_ms: replayTime,
      wall_time_utc: new Date().toISOString(),
      payload: {
        tower: towerState,
        locations: locationState,
        stints: stintStates,
        insights: insightCards,
        race_control: rcMessages,
      },
      queue_depth: 0,
      recommended_fps: 60,
    };

    // Broadcast to all subscribers
    this.broadcast(message);
  }

  private emitSnapshot(): void {
    const replayTime = this.clock.getCurrentReplayTime();
    const message: StateStreamMessage = {
      type: "state_delta",
      sequence_id: this.sequenceId++,
      replay_time_ms: replayTime,
      wall_time_utc: new Date().toISOString(),
      payload: {
        tower: this.stateBuilder.buildTowerState(),
        locations: this.stateBuilder.buildDriverLocations(),
        stints: this.stateBuilder.buildStintStates(),
        insights: this.stateBuilder.buildInsightCards(replayTime),
        race_control: this.stateBuilder.getRaceControlMessages(),
      },
      queue_depth: 0,
      recommended_fps: 60,
    };

    this.broadcast(message);
  }

  private broadcast(message: StateStreamMessage): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(message);
      } catch (err) {
        console.error("[REPLAY] Subscriber error:", err);
        this.subscribers.delete(subscriber);
      }
    }
  }

  /**
   * Verify determinism: replay and hash state at key points
   */
  async verifyDeterminism(): Promise<boolean> {
    if (!this.events.length || this.sessionStartTimeMs === null) {
      console.log("[REPLAY] verifyDeterminism: no session loaded");
      return false;
    }

    const hash1 = this.stateBuilder.getStateHash();
    const replayTimeMs = this.clock.getState().currentReplayTimeMs;
    const absoluteTargetTimeMs = this.sessionStartTimeMs + replayTimeMs;

    // Build a fresh StateBuilder from scratch using the same event slice.
    const freshBuilder = new StateBuilder();
    if (Array.isArray(this.manifest?.drivers)) {
      freshBuilder.setDriverCatalog(this.manifest.drivers);
    }
    const eventsUpToTime = this.events.filter(
      (e) => !e.event_time_utc || Date.parse(e.event_time_utc) <= absoluteTargetTimeMs
    );
    freshBuilder.processEvents(eventsUpToTime);

    const hash2 = freshBuilder.getStateHash();
    const match = hash1 === hash2;

    if (match) {
      console.log(`[REPLAY] ✓ DETERMINISTIC at ${replayTimeMs}ms (${eventsUpToTime.length} events)`);
    } else {
      console.log(`[REPLAY] ✗ MISMATCH at ${replayTimeMs}ms`);
      console.log(`  hash1: ${hash1.substring(0, 16)}...`);
      console.log(`  hash2: ${hash2.substring(0, 16)}...`);
    }
    return match;
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      manifest: this.manifest,
      clock: this.clock.getState(),
      subscribers: this.subscribers.size,
      sessionDurationMs: this.sessionDurationMs,
    };
  }

  /**
   * Cleanup
   */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.clock.pause();
    console.log("[REPLAY] Stopped");
  }
}

/**
 * WebSocket message handler
 */
export interface WebSocketMessage {
  op: "play" | "pause" | "seek" | "speed" | "subscribe";
  args?: Record<string, any>;
}

/**
 * Bind replay service to a WebSocket handler (for use with ws library or similar)
 */
export function bindReplayToWebSocket(
  service: ReplayService,
  onMessage: (msg: StateStreamMessage) => void
): (msg: WebSocketMessage) => void {
  return (message: WebSocketMessage) => {
    try {
      switch (message.op) {
        case "play":
          service.start(message.args?.tickRateHz || 10);
          break;
        case "pause":
          service.pause();
          break;
        case "seek":
          service.seek(message.args?.replayTimeMs || 0);
          break;
        case "speed":
          service.setSpeed(message.args?.speed || 1.0);
          break;
        case "subscribe":
          // Already subscribed on connection
          break;
        default:
          console.warn(`Unknown message op: ${message.op}`);
      }
    } catch (err) {
      console.error("[WS] Message handler error:", err);
    }
  };
}
