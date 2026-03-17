import React, { useEffect, useRef } from "react";
import type { RaceControlMessage } from "../types";

interface Props {
  messages: RaceControlMessage[];
}

function formatTime(utc: string): string {
  try {
    return new Date(utc).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

const SEVERITY_ICONS: Record<string, string> = {
  critical: "🔴",
  warning: "🟡",
  info: "⚪",
};

export function RaceControlFeed({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="rc-panel">
      <div className="panel-header">
        <span>RACE CONTROL</span>
        <span className="panel-badge">{messages.length}</span>
      </div>

      <div className="rc-list">
        {messages.length === 0 && (
          <div className="rc-empty">No messages yet…</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`rc-item rc-${m.severity ?? "info"}`}>
            <span className="rc-severity">{SEVERITY_ICONS[m.severity ?? "info"] ?? "⚪"}</span>
            <span className="rc-time">{formatTime(m.time_utc)}</span>
            <span className="rc-msg">{m.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
