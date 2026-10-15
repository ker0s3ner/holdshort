import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SurfaceDisplay } from "./components/SurfaceDisplay";
import { ClearancePanel } from "./components/ClearancePanel";
import { UpdateBanner } from "./components/UpdateBanner";
import type { AircraftSnapshot, AirportData, Clearance, SimTick } from "./types";
import "./App.css";

function App() {
  const [airport, setAirport] = useState<AirportData | null>(null);
  const [aircraft, setAircraft] = useState<AircraftSnapshot[]>([]);
  const [clockS, setClockS] = useState(0);
  const [selectedCallsign, setSelectedCallsign] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<AirportData>("get_airport")
      .then(setAirport)
      .catch((e) => setError(String(e)));

    const unlisten = listen<SimTick>("sim-tick", (event) => {
      setClockS(event.payload.clock_s);
      setAircraft(event.payload.aircraft);
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const onIssue = useCallback((callsign: string, clearance: Clearance) => {
    invoke("issue_clearance", { command: { callsign, clearance } }).catch((e) =>
      setError(String(e)),
    );
  }, []);

  if (error) {
    return <div className="status-line error">{error}</div>;
  }
  if (!airport) {
    return <div className="status-line">Loading airport surface data…</div>;
  }

  const hh = Math.floor(clockS / 3600);
  const mm = Math.floor((clockS % 3600) / 60);
  const ss = Math.floor(clockS % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    <div className="app-shell">
      <UpdateBanner />
      <div className="top-bar">
        <span className="title">{airport.name} ({airport.icao})</span>
        <span className="clock">SIM T+{pad(hh)}:{pad(mm)}:{pad(ss)}</span>
      </div>
      <div className="main-area">
        <SurfaceDisplay
          airport={airport}
          aircraft={aircraft}
          selectedCallsign={selectedCallsign}
          onSelectAircraft={setSelectedCallsign}
        />
        <ClearancePanel
          airport={airport}
          aircraft={aircraft}
          selectedCallsign={selectedCallsign}
          onSelect={setSelectedCallsign}
          onIssue={onIssue}
        />
      </div>
      <div className="attribution">{airport.attribution}</div>
    </div>
  );
}

export default App;
