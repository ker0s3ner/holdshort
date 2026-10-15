import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SurfaceDisplay } from "./components/SurfaceDisplay";
import { TowerCabView } from "./components/TowerCabView";
import { ClearancePanel } from "./components/ClearancePanel";
import { UpdateBanner } from "./components/UpdateBanner";
import { Launcher } from "./components/Launcher";
import { SettingsModal } from "./components/SettingsModal";
import { EditPacksModal } from "./components/EditPacksModal";
import type {
  AircraftSnapshot,
  AirportData,
  AirportSummary,
  Clearance,
  ControllerRole,
  SimTick,
} from "./types";
import "./App.css";

type Screen = "launcher" | "session";
type ViewMode = "smr" | "tower";

function App() {
  const [screen, setScreen] = useState<Screen>("launcher");
  const [airports, setAirports] = useState<AirportSummary[]>([]);
  const [role, setRole] = useState<ControllerRole>("ground");
  const [airport, setAirport] = useState<AirportData | null>(null);
  const [aircraft, setAircraft] = useState<AircraftSnapshot[]>([]);
  const [clockS, setClockS] = useState(0);
  const [selectedCallsign, setSelectedCallsign] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editPacksOpen, setEditPacksOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("smr");

  useEffect(() => {
    invoke<AirportSummary[]>("list_airports")
      .then(setAirports)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (screen !== "session") return;
    const unlisten = listen<SimTick>("sim-tick", (event) => {
      setClockS(event.payload.clock_s);
      setAircraft(event.payload.aircraft);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [screen]);

  const startSession = useCallback((icao: string, chosenRole: ControllerRole) => {
    invoke("start_session", { icao })
      .then(() => invoke<AirportData>("get_airport"))
      .then((data) => {
        setAirport(data);
        setRole(chosenRole);
        setSelectedCallsign(null);
        setViewMode(chosenRole === "tower" ? "tower" : "smr");
        setScreen("session");
      })
      .catch((e) => setError(String(e)));
  }, []);

  const exitToLauncher = useCallback(() => {
    invoke("end_session").catch(() => {});
    setScreen("launcher");
    setAirport(null);
    setAircraft([]);
  }, []);

  const onIssue = useCallback((callsign: string, clearance: Clearance) => {
    invoke("issue_clearance", { command: { callsign, clearance } }).catch((e) =>
      setError(String(e)),
    );
  }, []);

  if (error) {
    return <div className="status-line error">{error}</div>;
  }

  if (screen === "launcher") {
    return (
      <>
        <Launcher
          airports={airports}
          onStart={startSession}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenEditPacks={() => setEditPacksOpen(true)}
        />
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
        {editPacksOpen && (
          <EditPacksModal airports={airports} onClose={() => setEditPacksOpen(false)} />
        )}
      </>
    );
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
        <button className="back-button" onClick={exitToLauncher} title="Back to menu">
          ‹ Menu
        </button>
        <span className="title">
          {airport.name} ({airport.icao}) · {role.toUpperCase()}
        </span>
        <div className="view-toggle">
          <button
            className={viewMode === "smr" ? "active" : ""}
            onClick={() => setViewMode("smr")}
          >
            SMR
          </button>
          <button
            className={viewMode === "tower" ? "active" : ""}
            onClick={() => setViewMode("tower")}
          >
            TOWER CAB
          </button>
        </div>
        <span className="clock">
          SIM T+{pad(hh)}:{pad(mm)}:{pad(ss)}
        </span>
      </div>
      <div className="main-area">
        {viewMode === "smr" ? (
          <SurfaceDisplay
            airport={airport}
            aircraft={aircraft}
            selectedCallsign={selectedCallsign}
            onSelectAircraft={setSelectedCallsign}
          />
        ) : (
          <TowerCabView
            airport={airport}
            aircraft={aircraft}
            selectedCallsign={selectedCallsign}
            onSelectAircraft={setSelectedCallsign}
          />
        )}
        <ClearancePanel
          airport={airport}
          aircraft={aircraft}
          role={role}
          selectedCallsign={selectedCallsign}
          onSelect={setSelectedCallsign}
          onIssue={onIssue}
        />
      </div>
      <div className="attribution">
        {airport.attribution}
        {viewMode === "tower" && " · Imagery: Esri, Maxar, Earthstar Geographics"}
      </div>
    </div>
  );
}

export default App;
