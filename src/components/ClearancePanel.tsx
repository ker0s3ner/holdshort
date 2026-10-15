import { useState } from "react";
import type { AircraftSnapshot, AirportData, Clearance, ControllerRole } from "../types";
import { frequencyFor } from "../frequencies";
import { startListening, stopListeningAndTranscribe } from "../stt";
import { isSttEnabled } from "../voiceSettings";

interface Props {
  airport: AirportData;
  aircraft: AircraftSnapshot[];
  role: ControllerRole;
  selectedCallsign: string | null;
  onSelect: (callsign: string) => void;
  onIssue: (callsign: string, clearance: Clearance) => void;
}

interface ClearanceButton {
  label: string;
  clearance: Clearance;
}

/** Each position only gets the clearances a real controller in that chair
 * would issue. Approach has no direct surface control yet — arrivals are
 * procedurally spawned onto final — so it's read-only for now. */
const BUTTONS_BY_ROLE: Record<ControllerRole, ClearanceButton[]> = {
  ramp: [
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
  approach: [],
};

const ADJACENT_POSITIONS: Record<ControllerRole, (keyof typeof BUTTONS_BY_ROLE)[]> = {
  ramp: ["ground"],
  ground: ["ramp", "tower"],
  tower: ["ground", "approach"],
  approach: ["tower"],
};

const HELD_STATES = new Set(["HoldingShort", "LinedUp"]);

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

  const [recording, setRecording] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);

  const issue = (clearance: Clearance) => {
    if (!selectedCallsign) return;
    onIssue(selectedCallsign, clearance);
  };

  const toggleMic = async () => {
    if (!recording) {
      setHeard(null);
      try {
        await startListening();
        setRecording(true);
      } catch (e) {
        setHeard(`mic error: ${e}`);
      }
      return;
    }
    setRecording(false);
    try {
      const text = await stopListeningAndTranscribe();
      setHeard(text);
    } catch (e) {
      setHeard(`${e}`);
    }
  };

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
        {held.length === 0 && <div className="muted">None holding.</div>}
        {held.map((ac) => (
          <button
            key={ac.callsign}
            className={ac.callsign === selectedCallsign ? "aircraft-row selected" : "aircraft-row"}
            onClick={() => onSelect(ac.callsign)}
          >
            <span className="callsign">{ac.callsign}</span>
            <span className="type">{ac.aircraft_type}</span>
            <span className="state">{ac.state === "LinedUp" ? "lined up" : "holding short"}</span>
          </button>
        ))}
      </div>

      {role === "approach" && (
        <div className="clearance-detail">
          <p className="muted settings-note">
            Approach control is a preview: arrivals are generated directly onto final rather than
            vectored. Sequencing and speed/altitude control are planned, not simulated yet.
          </p>
        </div>
      )}

      {selected && role !== "approach" && (
        <div className="clearance-detail">
          <div className="detail-line">
            {selected.callsign} · {selected.aircraft_type} · gate {selected.assigned_gate} · rwy{" "}
            {selected.assigned_runway} ·{" "}
            {selected.rule === "Departure" ? `dest ${selected.destination}` : `from ${selected.origin}`}
          </div>
          <div className="clearance-buttons">
            {buttons.map((b) => (
              <button key={b.label} onClick={() => issue(b.clearance)}>
                {b.label}
              </button>
            ))}
          </div>
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
