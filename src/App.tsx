import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SurfaceDisplay } from "./components/SurfaceDisplay";
import { TowerCabView } from "./components/TowerCabView";
import { ApproachView } from "./components/ApproachView";
import { ScopeDCB } from "./components/ScopeDCB";
import { ScopeCommandLine } from "./components/ScopeCommandLine";
import { ControllerMessages } from "./components/ControllerMessages";
import { ClearancePanel } from "./components/ClearancePanel";
import { TopBar } from "./components/TopBar";
import { DepArrWindow } from "./components/DepArrWindow";
import { PluginHost } from "./components/PluginHost";
import { UpdateBanner } from "./components/UpdateBanner";
import { Launcher } from "./components/Launcher";
import { SetupWizard } from "./components/SetupWizard";
import { SettingsModal } from "./components/SettingsModal";
import { ManageRegionsModal } from "./components/ManageRegionsModal";
import { NewProfileModal } from "./components/NewProfileModal";
import { TrainingPanel } from "./components/TrainingPanel";
import type { ReplayCheckpoint, TrainingAction } from "./trainingSession";
import { LoadingModal } from "./components/LoadingModal";
import { speakReadback } from "./voice";
import { isReadbackEnabled } from "./voiceSettings";
import { enqueuePilotCalls } from "./pilotCalls";
import { applyStoredTheme } from "./themeSettings";
import { AVAILABLE_PLUGINS, isPluginEnabled } from "./pluginSettings";
import { trackHandoffs, type HandoffEvent } from "./handoffTracking";
import { receiveMessage, composeHandoffCoordination } from "./controllerMessaging";
import type { ScopeKind } from "./scopeDisplay";
import type { Profile } from "./profiles";
import type {
  AircraftSnapshot,
  AirportData,
  AirportSummary,
  Clearance,
  ControllerRole,
  SimEvent,
  SimTick,
  ScenarioSummary,
} from "./types";
import "./App.css";

applyStoredTheme();

type Screen = "setup" | "launcher" | "session";
type ViewMode = "smr" | "tower";

const SETUP_DONE_KEY = "holdshort.setupComplete";

function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    localStorage.getItem(SETUP_DONE_KEY) === "true" ? "launcher" : "setup"
  );
  const [airports, setAirports] = useState<AirportSummary[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [airportsLoading, setAirportsLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [role, setRole] = useState<ControllerRole>("ground");
  const [scenarioId, setScenarioId] = useState("free-play");
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
  const [worldMapOpen, setWorldMapOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [exitAfterDebrief, setExitAfterDebrief] = useState(false);
  const [paused, setPaused] = useState(false);
  const [trainingEvents, setTrainingEvents] = useState<SimTick["training_events"]>([]);
  const [replay, setReplay] = useState<ReplayCheckpoint[]>([]);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [trainingActions, setTrainingActions] = useState<TrainingAction[]>([]);

  // Tracks which position owns each aircraft tick over tick so a change -
  // a real handoff, whether to the human or to an AI-automated position -
  // gets a brief visual flash on the radar views instead of silently
  // happening. The Map itself is handed down by reference and mutated in
  // place; canvas views read it straight from their own draw loop rather
  // than needing a React re-render for every flash to animate.
  const prevOwnerRef = useRef(new Map<string, ControllerRole>());
  const handoffsRef = useRef(new Map<string, HandoffEvent>());
  useEffect(() => {
    const changes = trackHandoffs(aircraft, prevOwnerRef.current, handoffsRef.current);
    // A handoff that touches the operator's seat is coordinated out loud on
    // the messaging net by the position on the other end of it, so the MSG
    // window comes alive without the operator keying first. receiveMessage
    // rate-limits each position, so a busy final stays readable.
    for (const { callsign, event } of changes) {
      const coord = composeHandoffCoordination(role, event, callsign);
      if (coord) receiveMessage(role, coord.from, coord.text);
    }
  }, [aircraft, role]);

  useEffect(() => {
    Promise.all([invoke<AirportSummary[]>("list_installed"), invoke<ScenarioSummary[]>("list_scenarios")])
      .then(([installed, available]) => { setAirports(installed); setScenarios(available); })
      .catch((e) => setError(String(e)))
      .finally(() => setAirportsLoading(false));
  }, [installedVersion]);

  useEffect(() => {
    if (screen !== "session") return;
    const unlisten = listen<SimTick>("sim-tick", (event) => {
      setClockS(event.payload.clock_s);
      setAircraft(event.payload.aircraft);
      setTrainingEvents(event.payload.training_events);
      setReplay((previous) => [...previous.slice(-599), { clock_s: event.payload.clock_s, aircraft: event.payload.aircraft }]);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [screen]);

  useEffect(() => {
    if (screen !== "session") return;
    const unlisten = listen<SimTick["training_events"][number]>("training-event", (event) => {
      setTrainingEvents((previous) => previous.some((item) => item.id === event.payload.id) ? previous : [...previous, event.payload]);
    });
    return () => { unlisten.then((f) => f()); };
  }, [screen]);

  useEffect(() => {
    if (screen !== "session") return;
    const unlisten = listen<SimEvent[]>("sim-event", (event) => {
      if (isReadbackEnabled()) enqueuePilotCalls(event.payload);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [screen]);

  const startProfile = useCallback((profile: Profile, scenarioId = "free-play") => {
    setSessionLoading(true);
    invoke("start_session", { icao: profile.icao, role: profile.role, scenarioId })
      .then(() => invoke<AirportData>("get_airport"))
      .then((data) => {
        setAirport(data);
        setRole(profile.role);
        setScenarioId(scenarioId);
        setSelectedCallsign(null);
        setReplay([]);
        setReplayIndex(null);
        setTrainingActions([]);
        setTrainingEvents([]);
        setPaused(false);
        setViewMode(profile.displayType);
        setScreen("session");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setSessionLoading(false));
  }, []);

  const leaveSession = useCallback(() => {
    invoke("end_session").catch(() => {});
    setScreen("launcher");
    setAirport(null);
    setAircraft([]);
    setTrainingEvents([]);
    setReplay([]);
    setTrainingActions([]);
    setReplayIndex(null);
    setExitAfterDebrief(false);
  }, []);

  const exitToLauncher = useCallback(() => {
    if (trainingEvents.length || trainingActions.length || replay.length) {
      setPaused(true);
      invoke("set_session_paused", { paused: true }).catch(() => {});
      setExitAfterDebrief(true);
      setTrainingOpen(true);
    } else {
      leaveSession();
    }
  }, [leaveSession, replay.length, trainingActions.length, trainingEvents.length]);

  /** Station Select's "Connect" - switches to a different installed
   * airport/position without leaving the session for the full launcher,
   * the way CRC's own Station Select dialog works. Keeps the current
   * SMR/Tower Cab view mode rather than requiring a whole new profile. */
  const switchStation = useCallback((icao: string, newRole: ControllerRole) => {
    setSessionLoading(true);
    invoke("start_session", { icao, role: newRole, scenarioId: "free-play" })
      .then(() => invoke<AirportData>("get_airport"))
      .then((data) => {
        setAirport(data);
        setRole(newRole);
        setScenarioId("free-play");
        setSelectedCallsign(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setSessionLoading(false));
  }, []);

  // Clearance rejections (wrong controller for this aircraft's current
  // phase, a missing prerequisite step, etc.) are routine and recoverable -
  // they surface in ClearancePanel's own status line, not here. The
  // app-level `error` state is reserved for the session itself breaking.
  const onIssue = useCallback(async (callsign: string, clearance: Clearance) => {
    if (replayIndex != null) throw new Error("replay is read-only; return to live before issuing a clearance");
    let accepted = true;
    try {
      await invoke("issue_clearance", { command: { callsign, clearance } });
    } catch (error) {
      accepted = false;
      throw error;
    } finally {
      setTrainingActions((previous) => [...previous, { at: clockS, callsign, clearance, accepted }]);
    }
    if (isReadbackEnabled()) speakReadback(callsign, clearance);
  }, [clockS, replayIndex]);

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
          scenarios={scenarios}
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

  const replayFrame = replayIndex == null ? null : replay[replayIndex];
  const displayedAircraft = replayFrame?.aircraft ?? aircraft;
  const displayedClockS = replayFrame?.clock_s ?? clockS;
  const hh = Math.floor(displayedClockS / 3600);
  const mm = Math.floor((displayedClockS % 3600) / 60);
  const ss = Math.floor(displayedClockS % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const selected = displayedAircraft.find((a) => a.callsign === selectedCallsign) ?? null;

  // Which scope the DCB and command line are driving this session.
  const scopeKind: ScopeKind =
    role === "approach" ? "approach" : viewMode === "smr" ? "smr" : "tower";

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
        onToggleDepArr={() => setDepArrOpen((v) => !v)}
        worldMapEnabled={isPluginEnabled("worldmap")}
        worldMapOpen={worldMapOpen}
        onToggleWorldMap={() => setWorldMapOpen((v) => !v)}
        trainingEventCount={trainingEvents.length}
        onOpenTraining={() => setTrainingOpen(true)}
        paused={paused}
        onTogglePause={() => {
          const next = !paused;
          setPaused(next);
          invoke("set_session_paused", { paused: next }).catch(() => setPaused(paused));
        }}
        installedAirports={airports}
        onSwitchStation={switchStation}
        onDisconnect={exitToLauncher}
      />
      <div className="main-area">
        <div className="scope-shell">
          <ScopeDCB
            scope={scopeKind}
            role={role}
            selectedCallsign={selectedCallsign}
            onOpenMessages={() => setMessagesOpen(true)}
          />
          <div className="scope-canvas">
            {role === "approach" ? (
              <ApproachView
                airport={airport}
                aircraft={displayedAircraft}
                role={role}
                selectedCallsign={selectedCallsign}
                onSelectAircraft={setSelectedCallsign}
                recentHandoffs={handoffsRef.current}
              />
            ) : viewMode === "smr" ? (
              <SurfaceDisplay
                airport={airport}
                aircraft={displayedAircraft}
                role={role}
                selectedCallsign={selectedCallsign}
                onSelectAircraft={setSelectedCallsign}
                recentHandoffs={handoffsRef.current}
              />
            ) : (
              <TowerCabView
                airport={airport}
                aircraft={displayedAircraft}
                role={role}
                selectedCallsign={selectedCallsign}
                onSelectAircraft={setSelectedCallsign}
                recentHandoffs={handoffsRef.current}
              />
            )}
          </div>
          <ScopeCommandLine
            scope={scopeKind}
            role={role}
            aircraft={displayedAircraft}
            selectedCallsign={selectedCallsign}
            onSelect={setSelectedCallsign}
            issue={onIssue}
          />
        </div>
        <ClearancePanel
          airport={airport}
          aircraft={displayedAircraft}
          role={role}
          selectedCallsign={selectedCallsign}
          onSelect={setSelectedCallsign}
          onIssue={onIssue}
        />
      </div>
      {depArrOpen && (
        <DepArrWindow
          aircraft={displayedAircraft}
          onClose={() => setDepArrOpen(false)}
          onSelect={setSelectedCallsign}
        />
      )}
      {messagesOpen && (
        <ControllerMessages role={role} onClose={() => setMessagesOpen(false)} />
      )}
      {trainingOpen && <TrainingPanel events={trainingEvents} airport={airport} role={role} scenarioId={scenarioId} durationS={clockS} actions={trainingActions} checkpoints={replay} replayIndex={replayIndex} onReplayIndex={setReplayIndex} debrief={exitAfterDebrief} onClose={() => { if (exitAfterDebrief) leaveSession(); else setTrainingOpen(false); }} />}
      {worldMapOpen && isPluginEnabled("worldmap") && (
        <PluginHost
          title="World Traffic Map"
          entry={AVAILABLE_PLUGINS.find((p) => p.id === "worldmap")!.entry}
          airport={airport}
          aircraft={aircraft}
          onClose={() => setWorldMapOpen(false)}
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
