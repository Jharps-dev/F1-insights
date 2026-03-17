import React from "react";
import type { ReplayStatus } from "../types";

interface Props {
  status: ReplayStatus;
  connected: boolean;
  isPlaying: boolean;
  durationMs?: number;
  onPlay: () => void;
  onPause: () => void;
  onRestart: () => void;
  onSeekStart: () => void;
  onSeekEnd: () => void;
  onSeekBack: () => void;
  onSeekForward: () => void;
  onSeekTo: (ms: number) => void;
  onSpeedChange: (speed: number) => void;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function PlaybackBar({
  status,
  connected,
  isPlaying,
  durationMs,
  onPlay,
  onPause,
  onRestart,
  onSeekStart,
  onSeekEnd,
  onSeekBack,
  onSeekForward,
  onSeekTo,
  onSpeedChange,
}: Props) {
  const totalMs = Math.max(0, durationMs ?? 0);
  const currentMs = Math.max(0, Math.min(status.currentReplayTimeMs, totalMs || status.currentReplayTimeMs));

  return (
    <div className="playback-bar">
      <div className="playback-transport">
        <button
          className="pb-btn pb-seek"
          onClick={onSeekStart}
          disabled={!connected}
          title="Jump to start"
        >
          ↤ Start
        </button>

        <button
          className="pb-btn pb-seek"
          onClick={onSeekBack}
          disabled={!connected}
          title="Seek back 30s"
        >
          ⏮ 30s
        </button>

        {isPlaying ? (
          <button
            className="pb-btn pb-pause"
            onClick={onPause}
            disabled={!connected}
            title="Pause"
          >
            ⏸
          </button>
        ) : (
          <button
            className="pb-btn pb-play"
            onClick={onPlay}
            disabled={!connected}
            title="Play"
          >
            ▶
          </button>
        )}

        <button
          className="pb-btn pb-seek"
          onClick={onSeekForward}
          disabled={!connected}
          title="Seek forward 30s"
        >
          30s ⏭
        </button>

        <button
          className="pb-btn pb-seek"
          onClick={onRestart}
          disabled={!connected}
          title="Restart from beginning"
        >
          ↺ Restart
        </button>

        <button
          className="pb-btn pb-seek"
          onClick={onSeekEnd}
          disabled={!connected || totalMs <= 0}
          title="Jump to end"
        >
          End ↦
        </button>
      </div>

      <div className="playback-time">
        <span>{formatTime(currentMs)}</span>
        {totalMs > 0 ? <span className="playback-time-total">/ {formatTime(totalMs)}</span> : null}
      </div>

      {totalMs > 0 && (
        <input
          type="range"
          className="pb-scrubber"
          min={0}
          max={totalMs}
          step={1000}
          value={currentMs}
          disabled={!connected}
          onChange={(e) => onSeekTo(Number(e.target.value))}
          title={`${formatTime(currentMs)} / ${formatTime(totalMs)}`}
        />
      )}

      <div className="playback-speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`speed-btn ${status.speed === s ? "speed-btn-active" : ""}`}
            onClick={() => onSpeedChange(s)}
            disabled={!connected}
          >
            {s}×
          </button>
        ))}
      </div>

      <div className={`pb-connection ${connected ? "pb-connected" : "pb-disconnected"}`}>
        <span className="pb-dot" />
        {connected ? "WS READY" : "WS CONNECTING..."}
      </div>
    </div>
  );
}
