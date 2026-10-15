import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import type { AirportSummary } from "../types";

interface Props {
  installed: AirportSummary[];
  onClose: () => void;
  onInstalledChanged: () => void;
}

type InstallState = "idle" | "installing" | "uninstalling";

/** Lets you install or remove whole regions' worth of airports on demand.
 * Airport data lives outside the app binary - installing "every airport in
 * the world" would otherwise mean shipping an enormous download up front,
 * so only what you ask for gets fetched and cached locally. */
export function ManageRegionsModal({ installed, onClose, onInstalledChanged }: Props) {
  const [catalog, setCatalog] = useState<AirportSummary[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, InstallState>>({});

  useEffect(() => {
    invoke<AirportSummary[]>("list_catalog")
      .then(setCatalog)
      .catch((e) => setCatalogError(String(e)));
  }, []);

  const installedIcaos = useMemo(() => new Set(installed.map((a) => a.icao)), [installed]);

  const byRegion = useMemo(() => {
    const map = new Map<string, AirportSummary[]>();
    for (const a of catalog ?? []) {
      const region = a.region || "Other";
      const list = map.get(region) ?? [];
      list.push(a);
      map.set(region, list);
    }
    return map;
  }, [catalog]);
  const regions = useMemo(() => Array.from(byRegion.keys()).sort(), [byRegion]);

  const installOne = async (icao: string) => {
    setBusy((b) => ({ ...b, [icao]: "installing" }));
    try {
      await invoke("install_airport", { icao });
      onInstalledChanged();
    } catch (e) {
      setCatalogError(String(e));
    } finally {
      setBusy((b) => ({ ...b, [icao]: "idle" }));
    }
  };

  const uninstallOne = async (icao: string) => {
    setBusy((b) => ({ ...b, [icao]: "uninstalling" }));
    try {
      await invoke("uninstall_airport", { icao });
      onInstalledChanged();
    } catch (e) {
      setCatalogError(String(e));
    } finally {
      setBusy((b) => ({ ...b, [icao]: "idle" }));
    }
  };

  const installRegion = async (region: string) => {
    for (const a of byRegion.get(region) ?? []) {
      if (!installedIcaos.has(a.icao)) await installOne(a.icao);
    }
  };

  return (
    <Modal title="Manage Installed Regions" onClose={onClose}>
      <p className="muted settings-note">
        Airports are downloaded on demand, not bundled with the app - install only the regions you
        need. Data comes from <code>tools/convert_airport.py</code> runs against real-world
        OpenStreetMap surface data.
      </p>
      {catalogError && <p className="muted settings-note">⚠ {catalogError}</p>}
      {!catalog && !catalogError && <p className="muted settings-note">Loading catalog…</p>}
      <div className="airport-list">
        {regions.map((region) => {
          const facilities = byRegion.get(region)!;
          const installedCount = facilities.filter((a) => installedIcaos.has(a.icao)).length;
          const allInstalled = installedCount === facilities.length;
          return (
            <div key={region} className="region-row">
              <div className="airport-list-row">
                <div className="airport-list-info">
                  <span className="pack-icao">{region}</span>
                  <span className="muted">
                    {installedCount}/{facilities.length} installed
                  </span>
                </div>
                {allInstalled ? (
                  <button className="installed-badge" disabled>
                    Installed
                  </button>
                ) : (
                  <button className="installed-badge" onClick={() => installRegion(region)}>
                    Install region
                  </button>
                )}
              </div>
              <div className="region-facilities-list">
                {facilities.map((a) => {
                  const state = busy[a.icao] ?? "idle";
                  const isInstalled = installedIcaos.has(a.icao);
                  return (
                    <div key={a.icao} className="facility-row">
                      <span>
                        {a.icao} - {a.name}
                      </span>
                      {isInstalled ? (
                        <button
                          className="facility-action"
                          disabled={state !== "idle"}
                          onClick={() => uninstallOne(a.icao)}
                        >
                          {state === "uninstalling" ? "Removing…" : "Uninstall"}
                        </button>
                      ) : (
                        <button
                          className="facility-action"
                          disabled={state !== "idle"}
                          onClick={() => installOne(a.icao)}
                        >
                          {state === "installing" ? "Installing…" : "Install"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
