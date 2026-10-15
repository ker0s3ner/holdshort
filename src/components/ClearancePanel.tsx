import type { AircraftSnapshot, AirportData, Clearance, ControllerRole } from "../types";

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

  const issue = (clearance: Clearance) => {
    if (!selectedCallsign) return;
    onIssue(selectedCallsign, clearance);
  };

  return (
    <div className="clearance-panel">
      <div className="panel-header">
        {airport.icao} {role.toUpperCase()}
      </div>

      <div className="aircraft-list">
        {aircraft.length === 0 && <div className="muted">No traffic yet…</div>}
        {aircraft.map((ac) => (
          <button
            key={ac.callsign}
            className={ac.callsign === selectedCallsign ? "aircraft-row selected" : "aircraft-row"}
            onClick={() => onSelect(ac.callsign)}
          >
            <span className="callsign">{ac.callsign}</span>
            <span className="type">{ac.aircraft_type}</span>
            <span className="state">{ac.state}</span>
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
            {selected.assigned_runway} · dest {selected.destination}
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
