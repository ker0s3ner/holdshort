import { useEffect, useRef, useState } from "react";
import type { AircraftSnapshot, AirportData, Clearance, ControllerRole } from "../types";
import { frequencyFor } from "../frequencies";
import { isRecording, startListening, stopListeningAndTranscribe } from "../stt";
import { getPttKey, isSttEnabled } from "../voiceSettings";
import { matchSpokenCallsign, spellCallsign } from "../speech";
import { speakOnChannel } from "../radio";
import { parseClearance, parseCommand } from "../clearanceParser";
import { STATE_LABELS } from "../aircraftState";

interface Props {
  airport: AirportData;
  aircraft: AircraftSnapshot[];
  role: ControllerRole;
  selectedCallsign: string | null;
  onSelect: (callsign: string) => void;
  onIssue: (callsign: string, clearance: Clearance) => Promise<void>;
}

interface ClearanceButton {
  label: string;
  clearance: Clearance;
}

/** Each position only gets the clearances a real controller in that chair
 * would issue. */
const BUTTONS_BY_ROLE: Record<ControllerRole, ClearanceButton[]> = {
  ramp: [
    { label: "Engine Start Approved", clearance: "EngineStartApproved" },
    { label: "Pushback Approved", clearance: "PushbackApproved" },
    { label: "Hold Position", clearance: "HoldPosition" },
    { label: "Cancel Clearance", clearance: "CancelClearance" },
  ],
  ground: [
    { label: "Taxi to Runway", clearance: { TaxiToRunway: { via_hold_short: null } } },
    { label: "Resume Taxi", clearance: "ResumeTaxi" },
    { label: "Hold Position", clearance: "HoldPosition" },
    { label: "Cancel Clearance", clearance: "CancelClearance" },
  ],
  tower: [
    { label: "Line Up and Wait", clearance: "LineUpAndWait" },
    { label: "Cleared for Takeoff", clearance: "ClearedForTakeoff" },
    { label: "Cleared to Land", clearance: "ClearedToLand" },
    { label: "Go Around", clearance: "GoAround" },
  ],
  approach: [
    { label: "Cleared Approach", clearance: "ClearedApproach" },
    { label: "Go Around", clearance: "GoAround" },
  ],
};

/** OnApproach/Departed aircraft are Approach's own, same role the Held
 * Positions list plays for Ground/Tower. */
const APPROACH_STATES = new Set(["OnApproach", "Departed"]);

const ADJACENT_POSITIONS: Record<ControllerRole, (keyof typeof BUTTONS_BY_ROLE)[]> = {
  ramp: ["ground"],
  ground: ["ramp", "tower"],
  tower: ["ground", "approach"],
  approach: ["tower"],
};

const HELD_STATES = new Set(["ReadyForTaxi", "HoldingShort", "LinedUp"]);

export function ClearancePanel({
  airport,
  aircraft,
  role,
  selectedCallsign,
  onSelect,
  onIssue,
}: Props) {
  const selected = aircraft.find((a) => a.callsign === selectedCallsign) ?? null;
  const buttons = BUTTONS_BY_ROLE[role];
  const held = aircraft.filter((a) => HELD_STATES.has(a.state));
  const approachTraffic = aircraft.filter((a) => APPROACH_STATES.has(a.state));

  const [commandText, setCommandText] = useState("");
  const [recording, setRecording] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const startingRef = useRef(false);

  const issue = (clearance: Clearance) => {
    if (!selectedCallsign) return;
    onIssue(selectedCallsign, clearance).catch((e) => setHeard(`${e}`));
  };

  // CRC-style abbreviated command entry (H270, D30, S210, CA...) - see
  // clearanceParser.ts's parseCommand for the full set.
  const submitCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const clearance = parseCommand(commandText);
    if (!clearance) {
      setHeard(`"${commandText}" - not a recognized command`);
      setCommandText("");
      return;
    }
    if (!selectedCallsign) {
      setHeard(`"${commandText}" - understood, but no aircraft selected`);
      setCommandText("");
      return;
    }
    const target = selectedCallsign;
    const text = commandText;
    onIssue(target, clearance)
      .then(() => setHeard(`"${text}" → issued to ${target}`))
      .catch((err) => setHeard(`"${text}" → ${err}`));
    setCommandText("");
  };

  // A real controller moving on to the next aircraft on a busy frequency
  // doesn't change anything in the flight's status - it's just "wait a
  // moment" - so this only speaks, it doesn't touch sim state.
  const sayStandby = () => {
    if (!selectedCallsign) return;
    if (!("speechSynthesis" in window)) return;
    void speakOnChannel(new SpeechSynthesisUtterance(`${spellCallsign(selectedCallsign)}, standby.`));
  };

  const beginRecording = async () => {
    if (isRecording() || startingRef.current) return;
    startingRef.current = true;
    setHeard(null);
    try {
      await startListening();
      setRecording(true);
    } catch (e) {
      if (`${e}`.includes("NotAllowedError")) {
        setHeard(
          "mic permission denied - if Holdshort isn't even listed in System Settings → Microphone, use \"Reset Permission\" in Settings, then fully quit (⌘Q) and reopen the app"
        );
      } else {
        setHeard(`mic error: ${e}`);
      }
    } finally {
      startingRef.current = false;
    }
  };

  const endRecording = async () => {
    if (!isRecording()) return;
    setRecording(false);
    try {
      const text = await stopListeningAndTranscribe();
      const clearance = parseClearance(text);
      const spokenCallsign = matchSpokenCallsign(
        text,
        aircraft.map((a) => a.callsign)
      );
      const target = spokenCallsign ?? selectedCallsign;
      if (spokenCallsign && spokenCallsign !== selectedCallsign) onSelect(spokenCallsign);

      if (clearance && target) {
        try {
          await onIssue(target, clearance);
          setHeard(`"${text}" → issued to ${target}`);
        } catch (e) {
          setHeard(`"${text}" → ${e}`);
        }
      } else if (clearance && !target) {
        setHeard(`"${text}" - understood, but no aircraft selected`);
      } else {
        setHeard(`"${text}" - didn't recognize a clearance in that`);
      }
    } catch (e) {
      setHeard(`${e}`);
    }
  };

  const toggleMic = () => {
    if (isRecording()) endRecording();
    else beginRecording();
  };

  useEffect(() => {
    if (!isSttEnabled()) return;
    const key = getPttKey();
    if (!key) return;

    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== key || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      beginRecording();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== key) return;
      e.preventDefault();
      endRecording();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="clearance-panel">
      <div className="panel-header">
        {airport.icao} {role.toUpperCase()}
        {isSttEnabled() && (
          <button
            className={recording ? "mic-button recording" : "mic-button"}
            onClick={toggleMic}
            title={recording ? "Stop and transcribe" : "Push to talk"}
          >
            {recording ? "● rec" : "🎙"}
          </button>
        )}
      </div>
      {heard && <div className="muted settings-note heard-line">Heard: "{heard}"</div>}

      <div className="freq-strip">
        <div className="freq-row freq-own">
          <span>{role.toUpperCase()}</span>
          <span>{frequencyFor(airport.icao, role)}</span>
        </div>
        {ADJACENT_POSITIONS[role].map((pos) => (
          <div className="freq-row" key={pos}>
            <span>{pos.toUpperCase()}</span>
            <span>{frequencyFor(airport.icao, pos)}</span>
          </div>
        ))}
      </div>

      <div className="panel-subheader">Held Positions</div>
      <div className="held-list">
        {role === "approach"
          ? approachTraffic.length === 0 && <div className="muted">None on frequency.</div>
          : held.length === 0 && <div className="muted">None holding.</div>}
        {(role === "approach" ? approachTraffic : held).map((ac) => (
          <button
            key={ac.callsign}
            className={ac.callsign === selectedCallsign ? "aircraft-row selected" : "aircraft-row"}
            onClick={() => onSelect(ac.callsign)}
          >
            <span className="callsign">{ac.callsign}</span>
            <span className="type">{ac.aircraft_type}</span>
            <span className="state">
              {role === "approach"
                ? `${Math.round(ac.altitude_ft)} ft`
                : ac.state === "LinedUp"
                  ? "lined up"
                  : ac.state === "ReadyForTaxi"
                    ? "ready to taxi"
                    : "holding short"}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="clearance-detail">
          <div className="detail-line">
            {selected.callsign} · {selected.aircraft_type} · gate {selected.assigned_gate} · rwy{" "}
            {selected.assigned_runway} ·{" "}
            {selected.rule === "Departure" ? `dest ${selected.destination}` : `from ${selected.origin}`}
          </div>
          <div className="detail-line detail-line-sub">
            {selected.rule === "Departure" ? "DEP" : "ARR"} · {STATE_LABELS[selected.state]} ·{" "}
            {Math.round(selected.ground_speed_kt)} kt
            {(selected.state === "OnApproach" || selected.state === "Departed") &&
              ` · ${Math.round(selected.altitude_ft)} ft · hdg ${Math.round(selected.heading_deg)}` +
                (selected.assigned_heading_deg != null ? ` (vectored ${Math.round(selected.assigned_heading_deg)})` : "") +
                (selected.assigned_altitude_ft != null ? ` · assigned ${Math.round(selected.assigned_altitude_ft)} ft` : "") +
                (selected.assigned_speed_kt != null ? ` · assigned ${Math.round(selected.assigned_speed_kt)} kt` : "") +
                (selected.state === "OnApproach" ? (selected.cleared_approach ? " · cleared" : " · not cleared") : "")}
          </div>
          <div className="clearance-buttons">
            {buttons.map((b) => (
              <button key={b.label} onClick={() => issue(b.clearance)}>
                {b.label}
              </button>
            ))}
            <button className="standby-button" onClick={sayStandby}>
              Standby
            </button>
          </div>
          {role === "approach" && (
            <form className="command-entry" onSubmit={submitCommand}>
              <input
                type="text"
                value={commandText}
                onChange={(e) => setCommandText(e.target.value)}
                placeholder="H270 · D30 · C50 · S210"
                autoCapitalize="characters"
              />
              <button type="submit">Send</button>
            </form>
          )}
          {role === "ground" && (
            <div className="gate-picker">
              <span>Taxi to gate:</span>
              <select
                onChange={(e) => {
                  if (e.target.value) issue({ TaxiToGate: { gate_ref: e.target.value } });
                }}
                value=""
              >
                <option value="" disabled>
                  select gate
                </option>
                {airport.parking_positions.map((p) => (
                  <option key={p.id} value={p.ref}>
                    {p.ref}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
