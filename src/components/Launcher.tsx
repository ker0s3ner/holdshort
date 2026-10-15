import { useRef, useState } from "react";
import type { AirportSummary } from "../types";
import type { Profile } from "../profiles";
import {
  deleteProfile,
  duplicateProfile,
  exportProfile,
  importProfile,
  loadProfiles,
} from "../profiles";

interface Props {
  airports: AirportSummary[];
  onStart: (profile: Profile) => void;
  onNewProfile: () => void;
  onOpenSettings: () => void;
  onOpenManageAirports: () => void;
}

/** The app's front door: a list of saved profiles (airport + position +
 * display type), the same pattern CRC's Profiles window uses. The airport
 * picker itself lives in the "New Profile" dialog, not here. */
export function Launcher({ airports, onStart, onNewProfile, onOpenSettings, onOpenManageAirports }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => setProfiles(loadProfiles());

  const nameFor = (icao: string) => airports.find((a) => a.icao === icao)?.name ?? icao;

  const onImportClick = () => fileInputRef.current?.click();
  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    file.text().then((text) => {
      try {
        importProfile(text);
        refresh();
      } catch {
        // Malformed file - ignore rather than crash the launcher.
      }
    });
  };

  return (
    <div className="launcher">
      <div className="launcher-topbar">
        <span className="launcher-title">HOLDSHORT</span>
        <button className="icon-button" onClick={onOpenSettings} title="Settings">
          ⚙
        </button>
      </div>

      <div className="profiles-body">
        <div className="profiles-list">
          {profiles.length === 0 && (
            <div className="muted">No profiles yet — create one to get started.</div>
          )}
          {profiles.map((p) => (
            <div key={p.id} className="profile-row">
              <button className="profile-row-main" onClick={() => onStart(p)}>
                <span className="profile-name">{p.name}</span>
                <span className="profile-meta">
                  {p.icao} · {nameFor(p.icao)} · {p.role.toUpperCase()} ·{" "}
                  {p.displayType === "tower" ? "TOWER CAB" : "SMR"}
                </span>
              </button>
              <div className="profile-row-actions">
                <button
                  className="icon-button"
                  title="Duplicate profile"
                  onClick={() => {
                    duplicateProfile(p.id);
                    refresh();
                  }}
                >
                  ⧉
                </button>
                <button
                  className="icon-button"
                  title="Export profile"
                  onClick={() => exportProfile(p)}
                >
                  ⇩
                </button>
                <button
                  className="icon-button"
                  title="Delete profile"
                  onClick={() => {
                    deleteProfile(p.id);
                    refresh();
                  }}
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="profiles-footer">
          <button onClick={onNewProfile}>New Profile…</button>
          <button onClick={onImportClick}>Import Profile…</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={onImportFile}
          />
        </div>
        <button className="manage-airports-button" onClick={onOpenManageAirports}>
          Manage Installed Regions…
        </button>
      </div>
    </div>
  );
}
