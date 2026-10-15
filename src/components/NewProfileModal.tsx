import { useMemo, useState } from "react";
import type { AirportSummary, ControllerRole } from "../types";
import { regionFor } from "../airportRegions";
import { createProfile, type Profile } from "../profiles";

interface Props {
  airports: AirportSummary[];
  onClose: () => void;
  onCreated: (profile: Profile) => void;
}

const ROLES: ControllerRole[] = ["ramp", "ground", "tower", "approach"];

export function NewProfileModal({ airports, onClose, onCreated }: Props) {
  const regions = useMemo(() => {
    const set = new Set(airports.map((a) => regionFor(a.icao)));
    return Array.from(set).sort();
  }, [airports]);

  const [region, setRegion] = useState(regions[0] ?? "");
  const facilitiesInRegion = useMemo(
    () => airports.filter((a) => regionFor(a.icao) === region),
    [airports, region],
  );
  const [icao, setIcao] = useState(facilitiesInRegion[0]?.icao ?? "");
  const [displayType, setDisplayType] = useState<"smr" | "tower">("smr");
  const [role, setRole] = useState<ControllerRole>("ground");
  const [name, setName] = useState("");

  const onRegionChange = (r: string) => {
    setRegion(r);
    const first = airports.find((a) => regionFor(a.icao) === r);
    setIcao(first?.icao ?? "");
  };

  const canCreate = icao !== "" && name.trim() !== "";

  const create = () => {
    if (!canCreate) return;
    const profile = createProfile({ name: name.trim(), icao, role, displayType });
    onCreated(profile);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box new-profile-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Create New Profile</span>
          <button className="icon-button" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-content">
          <label className="field-label">
            Region
            <select value={region} onChange={(e) => onRegionChange(e.target.value)}>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label">
            Facility
            <select value={icao} onChange={(e) => setIcao(e.target.value)}>
              {facilitiesInRegion.map((a) => (
                <option key={a.icao} value={a.icao}>
                  {a.icao} - {a.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label">
            Display Type
            <select
              value={displayType}
              onChange={(e) => setDisplayType(e.target.value as "smr" | "tower")}
            >
              <option value="smr">SMR</option>
              <option value="tower">Tower Cab</option>
            </select>
          </label>

          <label className="field-label">
            Position
            <select value={role} onChange={(e) => setRole(e.target.value as ControllerRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label">
            Profile Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. KBUR Ground"
            />
          </label>

          <div className="new-profile-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!canCreate} onClick={create}>
              Create Profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
