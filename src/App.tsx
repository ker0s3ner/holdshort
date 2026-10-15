import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SurfaceDisplay } from "./components/SurfaceDisplay";
import { TowerCabView } from "./components/TowerCabView";
import { ClearancePanel } from "./components/ClearancePanel";
import { TopBar } from "./components/TopBar";
import { DepArrWindow } from "./components/DepArrWindow";
import { UpdateBanner } from "./components/UpdateBanner";
import { Launcher } from "./components/Launcher";
import { SetupWizard } from "./components/SetupWizard";
import { SettingsModal } from "./components/SettingsModal";
import { ManageRegionsModal } from "./components/ManageRegionsModal";
import { NewProfileModal } from "./components/NewProfileModal";
import { LoadingModal } from "./components/LoadingModal";
import { speakReadback } from "./voice";
import { isReadbackEnabled } from "./voiceSettings";
import type { Profile } from "./profiles";
import type {
  AircraftSnapshot,
  AirportData,
  AirportSummary,
  Clearance,
  ControllerRole,
  SimTick,
} from "./types";
import "./App.css";

type Screen = "setup" | "launcher" | "session";
type ViewMode = "smr" | "tower";

const SETUP_DONE_KEY = "holdshort.setupComplete";

function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    localStorage.getItem(SETUP_DONE_KEY) === "true" ? "launcher" : "setup"
  );
  const [airports, setAirports] = useState<AirportSummary[]>([]);
  const [airportsLoading, setAirportsLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [role, setRole] = useState<ControllerRole>("ground");
  const [airport, setAirport] = useState<AirportData | null>(null);
  const [aircraft, setAircraft] = useState<AircraftSnapshot[]>([]);
  const [clockS, setClockS] = useState(0);
  const [selectedCallsign, setSelectedCallsign] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manageRegionsOpen, setManageRegionsOpen] = useState(false);
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("smr");
  const [profilesVersion, setProfilesVersion] = useState(0);
  const [installedVersion, setInstalledVersion] = useState(0);
  const [depArrOpen, setDepArrOpen] = useState(false);

  useEffect(() => {
    invoke<AirportSummary[]>("list_installed")
      .then(setAirports)
      .catch((e) => setError(String(e)))
      .finally(() => setAirportsLoading(false));
  }, [installedVersion]);

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

  const startProfile = useCallback((profile: Profile) => {
    setSessionLoading(true);
    invoke("start_session", { icao: profile.icao })
      .then(() => invoke<AirportData>("get_airport"))
      .then((data) => {
        setAirport(data);
        setRole(profile.role);
        setSelectedCallsign(null);
        setViewMode(profile.displayType);
        setScreen("session");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setSessionLoading(false));
  }, []);

  const exitToLauncher = useCallback(() => {
    invoke("end_session").catch(() => {});
    setScreen("launcher");
    setAirport(null);
    setAircraft([]);
  }, []);

  const onIssue = useCallback((callsign: string, clearance: Clearance) => {
    invoke("issue_clearance", { command: { callsign, clearance } })
      .then(() => {
        if (isReadbackEnabled()) speakReadback(callsign, clearance);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return <div className="status-line error">{error}</div>;
  }

  if (screen === "setup") {
    return (
      <SetupWizard
        onDone={() => {
          localStorage.setItem(SETUP_DONE_KEY, "true");
          setInstalledVersion((v) => v + 1);
          setScreen("launcher");
        }}
      />
    );
  }

  if (screen === "launcher") {
    return (
      <>
        {airportsLoading && <LoadingModal message="Checking for new navigation data" />}
        {sessionLoading && <LoadingModal message="Loading airport surface data" />}
        <Launcher
          key={profilesVersion}
          airports={airports}
          onStart={startProfile}
          onNewProfile={() => setNewProfileOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenManageAirports={() => setManageRegionsOpen(true)}
        />
        {settingsOpen && (
          <SettingsModal
            onClose={() => setSettingsOpen(false)}
            onRerunSetup={() => {
              setSettingsOpen(false);
              setScreen("setup");
            }}
          />
        )}
        {manageRegionsOpen && (
          <ManageRegionsModal
            installed={airports}
            onClose={() => setManageRegionsOpen(false)}
            onInstalledChanged={() => setInstalledVersion((v) => v + 1)}
          />
        )}
        {newProfileOpen && (
          <NewProfileModal
            airports={airports}
            onClose={() => setNewProfileOpen(false)}
            onCreated={() => {
              setNewProfileOpen(false);
              setProfilesVersion((v) => v + 1);
            }}
          />
        )}
      </>
    );
  }

  if (!airport) {
    return <LoadingModal message="Loading airport surface data" />;
  }

  const hh = Math.floor(clockS / 3600);
  const mm = Math.floor((clockS % 3600) / 60);
  const ss = Math.floor(clockS % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const selected = aircraft.find((a) => a.callsign === selectedCallsign) ?? null;

  return (
    <div className="app-shell">
      <UpdateBanner />
      <TopBar
        airport={airport}
        role={role}
        viewMode={viewMode}
        clock={`${pad(hh)}:${pad(mm)}:${pad(ss)}`}
        selected={selected}
        depArrOpen={depArrOpen}
        onBack={exitToLauncher}
        onToggleDepArr={() => setDepArrOpen((v) => !v)}
      />
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
      {depArrOpen && (
        <DepArrWindow
          aircraft={aircraft}
          onClose={() => setDepArrOpen(false)}
          onSelect={setSelectedCallsign}
        />
      )}
      <div className="attribution">
        {airport.attribution}
        {viewMode === "tower" && " · Imagery: Esri, Maxar, Earthstar Geographics"}
      </div>
    </div>
  );
}

export default App;
