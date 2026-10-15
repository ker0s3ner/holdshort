import { useEffect, useState } from "react";
import type { AirportSummary, ControllerRole } from "../types";

interface Props {
  airports: AirportSummary[];
  onStart: (icao: string, role: ControllerRole) => void;
  onOpenSettings: () => void;
  onOpenEditPacks: () => void;
}

const ROLES: { id: ControllerRole; label: string; blurb: string }[] = [
  { id: "ramp", label: "Ramp", blurb: "Pushback & engine start, gate/ramp area" },
  { id: "ground", label: "Ground", blurb: "Taxi routing, runway hold points" },
  { id: "tower", label: "Tower", blurb: "Runway operations, line-up, takeoff/landing" },
  { id: "approach", label: "Approach", blurb: "Inbound sequencing (preview)" },
];

/** The app's front door: pick a downloaded airport pack, pick the position
 * you're working, then start the session. */
export function Launcher({ airports, onStart, onOpenSettings, onOpenEditPacks }: Props) {
  const [selectedIcao, setSelectedIcao] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<ControllerRole>("ground");

  useEffect(() => {
    if (!selectedIcao && airports.length > 0) {
      setSelectedIcao(airports[0].icao);
    }
  }, [airports, selectedIcao]);

  return (
    <div className="launcher">
      <div className="launcher-topbar">
        <span className="launcher-title">HOLDSHORT</span>
        <div className="launcher-topbar-actions">
          <button className="icon-button" onClick={onOpenEditPacks} title="Edit packs">
            📦
          </button>
          <button className="icon-button" onClick={onOpenSettings} title="Settings">
            ⚙
          </button>
        </div>
      </div>

      <div className="launcher-body">
        <section className="launcher-section">
          <h2>Airport pack</h2>
          <div className="pack-grid">
            {airports.map((a) => (
              <button
                key={a.icao}
                className={a.icao === selectedIcao ? "pack-card selected" : "pack-card"}
                onClick={() => setSelectedIcao(a.icao)}
              >
                <span className="pack-icao">{a.icao}</span>
                <span className="pack-name">{a.name}</span>
              </button>
            ))}
            {airports.length === 0 && <div className="muted">No airport packs installed.</div>}
          </div>
        </section>

        <section className="launcher-section">
          <h2>Position</h2>
          <div className="role-grid">
            {ROLES.map((r) => (
              <button
                key={r.id}
                className={r.id === selectedRole ? "role-card selected" : "role-card"}
                onClick={() => setSelectedRole(r.id)}
              >
                <span className="role-label">{r.label}</span>
                <span className="role-blurb">{r.blurb}</span>
              </button>
            ))}
          </div>
        </section>

        <button
          className="start-button"
          disabled={!selectedIcao}
          onClick={() => selectedIcao && onStart(selectedIcao, selectedRole)}
        >
          Enter {selectedIcao ?? ""} — {ROLES.find((r) => r.id === selectedRole)?.label}
        </button>
      </div>
    </div>
  );
}
