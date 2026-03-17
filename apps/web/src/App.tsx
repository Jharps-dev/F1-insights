import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./app/layouts/AppShell";
import { ReplayProvider } from "./app/providers/ReplayProvider";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { DriverInspectorPage } from "./pages/DriverInspectorPage";
import { HomePage } from "./pages/HomePage";
import { ReplayStudioPage } from "./pages/ReplayStudioPage";
import { StrategyLabPage } from "./pages/StrategyLabPage";

export function App() {
  return (
    <ReplayProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/replay" element={<ReplayStudioPage />} />
          <Route path="/replay/:sessionKey" element={<ReplayStudioPage />} />
          <Route path="/drivers" element={<DriverInspectorPage />} />
          <Route path="/strategy" element={<StrategyLabPage />} />
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ReplayProvider>
  );
}
