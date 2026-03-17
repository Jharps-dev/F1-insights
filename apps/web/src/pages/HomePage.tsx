import React from "react";
import { useNavigate } from "react-router-dom";
import { SessionPicker } from "../components/SessionPicker";
import { useReplay } from "../app/providers/ReplayProvider";

export function HomePage() {
  const navigate = useNavigate();
  const { sessions, sessionsLoading, selectSession } = useReplay();

  return (
    <SessionPicker
      sessions={sessions}
      loading={sessionsLoading}
      onSelect={(session) => {
        selectSession(session);
        navigate(`/replay/${session.session_key}`);
      }}
    />
  );
}