import { EventEmitter } from "events";
import { connect, MqttClient } from "mqtt";
import { CANONICAL_SCHEMA_VERSION, CanonicalEvent } from "@f1-insights/schemas";

const OPENF1_MQTT_URL = process.env.OPENF1_MQTT_URL || "mqtts://mqtt.openf1.org:8883";
const OPENF1_AUTH_URL = process.env.OPENF1_AUTH_URL || "";

interface OpenF1AuthResponse {
  access_token?: string;
}

export interface LiveIngestConfig {
  sessionKey: number;
  meetingKey?: number;
  username?: string;
  password?: string;
  accessToken?: string;
}

export interface LiveIngestStatus {
  connected: boolean;
  sessionKey?: number;
  topicCount: number;
  messagesSeen: number;
  eventsEmitted: number;
  lastMessageAtUtc?: string;
  lastError?: string;
}

type TopicKind = "car_data" | "lap" | "position" | "weather" | "race_control";

const TOPICS: Array<{ topic: string; kind: TopicKind }> = [
  { topic: "v1/car_data", kind: "car_data" },
  { topic: "v1/laps", kind: "lap" },
  { topic: "v1/position", kind: "position" },
  { topic: "v1/weather", kind: "weather" },
  { topic: "v1/race_control", kind: "race_control" },
];

export class OpenF1LiveIngest extends EventEmitter {
  private client: MqttClient | null = null;
  private status: LiveIngestStatus = {
    connected: false,
    topicCount: 0,
    messagesSeen: 0,
    eventsEmitted: 0,
  };

  async start(config: LiveIngestConfig): Promise<void> {
    if (this.client) {
      await this.stop();
    }

    const token = config.accessToken || (await this.fetchAccessToken(config));
    const userProperties = token ? { Authorization: `Bearer ${token}` } : undefined;

    this.status = {
      connected: false,
      sessionKey: config.sessionKey,
      topicCount: TOPICS.length,
      messagesSeen: 0,
      eventsEmitted: 0,
    };

    this.client = connect(OPENF1_MQTT_URL, {
      protocolVersion: 5,
      reconnectPeriod: 3000,
      connectTimeout: 20_000,
      username: config.username,
      password: config.password,
      properties: {
        userProperties,
      },
    });

    this.client.on("connect", () => {
      this.status.connected = true;

      for (const { topic } of TOPICS) {
        const fullTopic = `${topic}?session_key=${config.sessionKey}`;
        this.client?.subscribe(fullTopic, { qos: 0 }, (err) => {
          if (err) {
            this.status.lastError = err.message;
            this.emit("error", err);
          }
        });
      }

      this.emit("status", this.getStatus());
    });

    this.client.on("message", (topic, payload) => {
      this.status.messagesSeen += 1;
      this.status.lastMessageAtUtc = new Date().toISOString();

      try {
        const json = JSON.parse(payload.toString("utf8"));
        const rows = Array.isArray(json) ? json : [json];

        for (const row of rows) {
          const event = this.mapRowToCanonical(topic, row, config.sessionKey, config.meetingKey ?? null);
          if (!event) {
            continue;
          }

          this.status.eventsEmitted += 1;
          this.emit("event", event);
        }
      } catch (err) {
        this.status.lastError = err instanceof Error ? err.message : "Unknown parse error";
        this.emit("error", err);
      }
    });

    this.client.on("error", (err) => {
      this.status.lastError = err.message;
      this.emit("error", err);
    });

    this.client.on("close", () => {
      this.status.connected = false;
      this.emit("status", this.getStatus());
    });
  }

  async stop(): Promise<void> {
    if (!this.client) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.client?.end(false, {}, () => resolve());
    });
    this.client = null;
    this.status.connected = false;
    this.emit("status", this.getStatus());
  }

  getStatus(): LiveIngestStatus {
    return { ...this.status };
  }

  private async fetchAccessToken(config: LiveIngestConfig): Promise<string | undefined> {
    if (!OPENF1_AUTH_URL || !config.username || !config.password) {
      return undefined;
    }

    const response = await fetch(OPENF1_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: config.username, password: config.password }),
    });

    if (!response.ok) {
      throw new Error(`OpenF1 auth failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OpenF1AuthResponse;
    return data.access_token;
  }

  private mapRowToCanonical(
    topic: string,
    row: Record<string, unknown>,
    sessionKey: number,
    meetingKey: number | null
  ): CanonicalEvent | null {
    const kind = TOPICS.find((t) => topic.includes(t.topic))?.kind;
    if (!kind) {
      return null;
    }

    const driverNumber = this.toNumber(row.driver_number);
    const eventTime = typeof row.date === "string" ? row.date : new Date().toISOString();

    const base: Omit<CanonicalEvent, "kind" | "payload"> = {
      schema_version: CANONICAL_SCHEMA_VERSION,
      source: "openf1",
      ingest_time_utc: new Date().toISOString(),
      event_time_utc: eventTime,
      meeting_key: meetingKey,
      session_key: sessionKey,
      driver:
        typeof driverNumber === "number"
          ? {
              number: driverNumber,
              code: typeof row.driver_code === "string" ? row.driver_code : `D${driverNumber}`,
            }
          : undefined,
    };

    switch (kind) {
      case "car_data":
        return {
          ...base,
          kind,
          payload: {
            speed: this.toNumber(row.speed) ?? 0,
            throttle: this.scalePercentToUnit(this.toNumber(row.throttle)),
            brake: this.scalePercentToUnit(this.toNumber(row.brake)),
            rpm: this.toNumber(row.rpm) ?? 0,
            n_gear: this.toNumber(row.n_gear) ?? 0,
            drs: (this.toNumber(row.drs) ?? 0) > 0,
            lap_number: this.toNumber(row.lap_number) ?? undefined,
          },
        };
      case "lap":
        return {
          ...base,
          kind,
          payload: {
            lap_number: this.toNumber(row.lap_number) ?? 0,
            lap_duration_ms: this.toNumber(row.lap_duration) ? (this.toNumber(row.lap_duration) as number) * 1000 : 0,
            sector_1_ms: this.toNumber(row.duration_sector_1)
              ? (this.toNumber(row.duration_sector_1) as number) * 1000
              : undefined,
            sector_2_ms: this.toNumber(row.duration_sector_2)
              ? (this.toNumber(row.duration_sector_2) as number) * 1000
              : undefined,
            sector_3_ms: this.toNumber(row.duration_sector_3)
              ? (this.toNumber(row.duration_sector_3) as number) * 1000
              : undefined,
            tyre_compound: typeof row.compound === "string" ? row.compound : undefined,
          },
        };
      case "position":
        return {
          ...base,
          kind,
          payload: {
            position: this.toNumber(row.position) ?? 0,
            gap_to_leader_ms: undefined,
            interval_to_ahead_ms: undefined,
          },
        };
      case "weather":
        return {
          ...base,
          kind,
          payload: {
            air_temperature_c: this.toNumber(row.air_temperature) ?? 0,
            track_temperature_c: this.toNumber(row.track_temperature) ?? 0,
            wind_speed_kmh: this.toNumber(row.wind_speed) ?? 0,
            wind_direction_deg: this.toNumber(row.wind_direction) ?? 0,
            humidity_percent: this.toNumber(row.humidity) ?? undefined,
            rainfall: Boolean(row.rainfall),
          },
        };
      case "race_control":
        return {
          ...base,
          kind,
          payload: {
            category: "track_status",
            message: typeof row.message === "string" ? row.message : "",
            severity: this.mapSeverity(row),
          },
        };
      default:
        return null;
    }
  }

  private toNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private scalePercentToUnit(value: number | undefined): number {
    if (typeof value !== "number") {
      return 0;
    }
    if (value <= 1) {
      return value;
    }
    return Math.max(0, Math.min(1, value / 100));
  }

  private mapSeverity(row: Record<string, unknown>): "info" | "warning" | "critical" {
    const category = typeof row.category === "string" ? row.category.toLowerCase() : "";
    const message = typeof row.message === "string" ? row.message.toLowerCase() : "";

    if (category.includes("red") || message.includes("red flag") || message.includes("stopped")) {
      return "critical";
    }
    if (category.includes("yellow") || message.includes("safety car") || message.includes("vsc")) {
      return "warning";
    }
    return "info";
  }
}
