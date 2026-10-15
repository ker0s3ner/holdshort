import type { AircraftSnapshot, AirportData, Clearance } from "../types";

interface Props {
  airport: AirportData;
  aircraft: AircraftSnapshot[];
  selectedCallsign: string | null;
  onSelect: (callsign: string) => void;
  onIssue: (callsign: string, clearance: Clearance) => void;
}

/** Ground/tower clearance strip: pick an aircraft, issue it a clearance
 * using the same phraseology a controller would use on frequency. */
export function ClearancePanel({ airport, aircraft, selectedCallsign, onSelect, onIssue }: Props) {
  const selected = aircraft.find((a) => a.callsign === selectedCallsign) ?? null;

  const issue = (clearance: Clearance) => {
    if (!selectedCallsign) return;
    onIssue(selectedCallsign, clearance);
  };

  return (
    <div className="clearance-panel">
      <div className="panel-header">{airport.icao} GROUND / TOWER</div>

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

      {selected && (
        <div className="clearance-detail">
          <div className="detail-line">
            {selected.callsign} · {selected.aircraft_type} · gate {selected.assigned_gate} · rwy{" "}
            {selected.assigned_runway} · dest {selected.destination}
          </div>
          <div className="clearance-buttons">
            <button onClick={() => issue("PushbackApproved")}>Pushback Approved</button>
            <button onClick={() => issue({ TaxiToRunway: { via_hold_short: null } })}>
              Taxi to Runway
            </button>
            <button onClick={() => issue("ResumeTaxi")}>Resume Taxi</button>
            <button onClick={() => issue("LineUpAndWait")}>Line Up and Wait</button>
            <button onClick={() => issue("ClearedForTakeoff")}>Cleared for Takeoff</button>
            <button onClick={() => issue("ClearedToLand")}>Cleared to Land</button>
            <button onClick={() => issue("HoldPosition")}>Hold Position</button>
            <button onClick={() => issue("CancelClearance")}>Cancel Clearance</button>
          </div>
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
        </div>
      )}
    </div>
  );
}
