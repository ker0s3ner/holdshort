import { useState } from "react";
import type { AirportSummary, ControllerRole } from "../types";

interface Props {
  installedAirports: AirportSummary[];
  currentIcao: string;
  currentRole: ControllerRole;
  onConnect: (icao: string, role: ControllerRole) => void;
  onDisconnect: () => void;
  onClose: () => void;
}

const ROLES: ControllerRole[] = ["ramp", "ground", "tower", "approach"];

/** CRC's own Station Select dialog lets you switch position without
 * leaving the session - this is that, scoped to what we actually have:
 * pick an installed airport and a facility (role), no topdown/CID/rating
 * concepts since this isn't a network client. */
export function StationSelectModal({
  installedAirports,
  currentIcao,
  currentRole,
  onConnect,
  onDisconnect,
  onClose,
}: Props) {
  const [icao, setIcao] = useState(currentIcao);
  const [role, setRole] = useState<ControllerRole>(currentRole);
  const [switching, setSwitching] = useState(false);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box station-select-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Station Select</span>
          <button className="icon-button" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-content">
          {!switching ? (
            <>
              <div className="station-current">
                {currentIcao} — {currentRole.toUpperCase()}
              </div>
              <div className="station-select-actions">
                <button className="setup-skip" onClick={onDisconnect}>
                  Disconnect
                </button>
                <button className="setup-primary" onClick={() => setSwitching(true)}>
                  Switch Station…
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="field-label">
                Airport
                <select value={icao} onChange={(e) => setIcao(e.target.value)}>
                  {installedAirports.map((a) => (
                    <option key={a.icao} value={a.icao}>
                      {a.icao} - {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Facility
                <select value={role} onChange={(e) => setRole(e.target.value as ControllerRole)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <div className="station-select-actions">
                <button className="setup-skip" onClick={() => setSwitching(false)}>
                  Back
                </button>
                <button
                  className="setup-primary"
                  onClick={() => {
                    onConnect(icao, role);
                    onClose();
                  }}
                >
                  Connect
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
