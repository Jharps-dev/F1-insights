import React, { useMemo, useState } from "react";
import type { RadioMessage } from "../types";

interface Props {
  radios: RadioMessage[];
  selectedDriver: number | null;
  defaultMode?: "global" | "selected";
}

function formatClock(timeUtc: string): string {
  if (!timeUtc) {
    return "--:--:--";
  }
  const date = new Date(timeUtc);
  if (Number.isNaN(date.getTime())) {
    return timeUtc.slice(11, 19) || "--:--:--";
  }
  return date.toISOString().slice(11, 19);
}

export function TeamRadioFeed({ radios, selectedDriver, defaultMode = "global" }: Props) {
  const [mode, setMode] = useState<"global" | "selected">(defaultMode);
  const effectiveMode = mode === "selected" && selectedDriver == null ? "global" : mode;

  const filtered = useMemo(() => {
    const ordered = [...radios].sort((a, b) => Date.parse(b.time_utc || "") - Date.parse(a.time_utc || ""));
    if (effectiveMode === "selected" && selectedDriver != null) {
      return ordered.filter((radio) => radio.driver_number === selectedDriver);
    }
    return ordered;
  }, [effectiveMode, radios, selectedDriver]);

  return (
    <div className="radio-panel">
      <div className="panel-header">
        <span>TEAM RADIO</span>
        <div className="radio-mode-switch" role="tablist" aria-label="Team radio filter">
          <button className={effectiveMode === "global" ? "is-active" : ""} onClick={() => setMode("global")} type="button">
            Global
          </button>
          <button
            className={effectiveMode === "selected" ? "is-active" : ""}
            onClick={() => setMode("selected")}
            type="button"
            disabled={selectedDriver == null}
          >
            Driver
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="radio-empty">
          {effectiveMode === "selected" ? "No synced radio for the selected driver yet." : "No team radio reached on the replay timeline yet."}
        </div>
      ) : (
        <div className="radio-list">
          {filtered.slice(0, 18).map((radio) => (
            <article key={radio.id} className="radio-item">
              <div className="radio-item-head">
                <span className="radio-driver">{radio.driver_code || (radio.driver_number != null ? `#${radio.driver_number}` : "TEAM")}</span>
                <span className="radio-time">{formatClock(radio.time_utc)}</span>
              </div>
              <div className="radio-message">{radio.message}</div>
              {radio.audio_url ? (
                <audio className="radio-audio" controls preload="none" src={radio.audio_url}>
                  Your browser does not support audio playback.
                </audio>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}