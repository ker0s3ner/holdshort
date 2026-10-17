import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AircraftSnapshot, AirportData, AirportSummary, ControllerRole, RunwayUse } from "../types";
import { frequencyFor } from "../frequencies";
import {
  getDatablockMode,
  getShowGateLabels,
  getShowRunwayLabels,
  getShowTaxiwayLabels,
  setDatablockMode,
  setShowGateLabels,
  setShowRunwayLabels,
  setShowTaxiwayLabels,
  type DatablockMode,
} from "../displaySettings";
import { getAtisLetter } from "../atisSettings";
import { StationSelectModal } from "./StationSelectModal";
import { AtisModal } from "./AtisModal";

type ViewMode = "smr" | "tower";

interface Props {
  airport: AirportData;
  role: ControllerRole;
  viewMode: ViewMode;
  clock: string;
  selected: AircraftSnapshot | null;
  depArrOpen: boolean;
  onToggleDepArr: () => void;
  worldMapEnabled: boolean;
  worldMapOpen: boolean;
  onToggleWorldMap: () => void;
  installedAirports: AirportSummary[];
  onSwitchStation: (icao: string, role: ControllerRole) => void;
  onDisconnect: () => void;
}

const METAR_REFRESH_MS = 5 * 60 * 1000;

/** Parses the wind group out of a raw METAR ("25008KT", "VRB03G15KT") into
 * the compact "DDD/SS" a real status bar shows - the full METAR is still
 * available as a tooltip rather than cluttering the bar with the whole
 * string. */
function parseWind(metar: string): string | null {
  const m = metar.match(/\b(\d{3}|VRB)(\d{2,3})(?:G\d{2,3})?KT\b/);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

/** The CRC-style status bar: a Station Select launcher where the position
 * identity lives, frequency, ATIS, the view-settings menu, active runway,
 * wind and clock up top, a thin menu strip underneath for the floating
 * windows (Dep/Arr, World Map). */
export function TopBar({
  airport,
  role,
  viewMode,
  clock,
  selected,
  depArrOpen,
  onToggleDepArr,
  worldMapEnabled,
  worldMapOpen,
  onToggleWorldMap,
  installedAirports,
  onSwitchStation,
  onDisconnect,
}: Props) {
  const [metar, setMetar] = useState<string | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [showRunwayLabels, setShowRunwayLabelsState] = useState(getShowRunwayLabels());
  const [showTaxiwayLabels, setShowTaxiwayLabelsState] = useState(getShowTaxiwayLabels());
  const [showGateLabels, setShowGateLabelsState] = useState(getShowGateLabels());
  const [datablockMode, setDatablockModeState] = useState<DatablockMode>(getDatablockMode());
  const [runwayOpen, setRunwayOpen] = useState(false);
  const [activeRunways, setActiveRunways] = useState<RunwayUse[]>([]);
  const [stationSelectOpen, setStationSelectOpen] = useState(false);
  const [atisOpen, setAtisOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const runwayMenuRef = useRef<HTMLDivElement>(null);

  const refreshActiveRunways = () => {
    invoke<RunwayUse[]>("get_active_runways")
      .then(setActiveRunways)
      .catch(() => {});
  };

  useEffect(() => {
    refreshActiveRunways();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airport.icao]);

  const toggleRunwayUse = (rwyRef: string, end: string, dep: boolean, arr: boolean) => {
    // Optimistic local update so the checkbox responds immediately instead
    // of waiting on the round trip.
    setActiveRunways((prev) => {
      const next = prev.filter((r) => !(r.rwy_ref === rwyRef && r.end === end));
      if (dep || arr) next.push({ rwy_ref: rwyRef, end, dep, arr });
      return next;
    });
    invoke("set_runway_use", { rwyRef, end, dep, arr }).catch(() => refreshActiveRunways());
  };

  useEffect(() => {
    let cancelled = false;
    const fetchMetar = () => {
      invoke<string>("get_metar", { icao: airport.icao })
        .then((m) => !cancelled && setMetar(m))
        .catch(() => !cancelled && setMetar(null));
    };
    fetchMetar();
    const id = setInterval(fetchMetar, METAR_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [airport.icao]);

  useEffect(() => {
    if (!displayOpen && !runwayOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setDisplayOpen(false);
      if (runwayMenuRef.current && !runwayMenuRef.current.contains(e.target as Node)) {
        setRunwayOpen(false);
      }
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [displayOpen, runwayOpen]);

  const wind = metar ? parseWind(metar) : null;

  return (
    <>
      <div className="top-bar">
        <div className="top-bar-row">
          <button
            className="station-button"
            onClick={() => setStationSelectOpen(true)}
            title="Station Select"
          >
            📡
          </button>
          <span className="tb-position">
            {airport.icao}_{role.toUpperCase()} [
            {role === "approach" ? "APP" : viewMode === "smr" ? "SMR" : "TWR"}]
          </span>
          <span className="tb-freq">{frequencyFor(airport.icao, role)}</span>
          <button className="tb-menu-trigger" onClick={() => setAtisOpen(true)}>
            ATIS {getAtisLetter(airport.icao)}
          </button>
          <div className="tb-menu" ref={menuRef}>
            <button className="tb-menu-trigger" onClick={() => setDisplayOpen((v) => !v)}>
              Quick SET ▾
            </button>
            {displayOpen && (
              <div className="tb-menu-panel">
                <label className="tb-menu-item">
                  <input
                    type="checkbox"
                    checked={showRunwayLabels}
                    onChange={(e) => {
                      setShowRunwayLabelsState(e.target.checked);
                      setShowRunwayLabels(e.target.checked);
                    }}
                  />
                  Runway numbers
                </label>
                <label className="tb-menu-item">
                  <input
                    type="checkbox"
                    checked={showTaxiwayLabels}
                    onChange={(e) => {
                      setShowTaxiwayLabelsState(e.target.checked);
                      setShowTaxiwayLabels(e.target.checked);
                    }}
                  />
                  Taxiway letters
                </label>
                <label className="tb-menu-item">
                  <input
                    type="checkbox"
                    checked={showGateLabels}
                    onChange={(e) => {
                      setShowGateLabelsState(e.target.checked);
                      setShowGateLabels(e.target.checked);
                    }}
                  />
                  Gate numbers
                </label>
                <div className="tb-menu-item">
                  <span>Datablocks</span>
                  <select
                    value={datablockMode}
                    onChange={(e) => {
                      const mode = e.target.value as DatablockMode;
                      setDatablockModeState(mode);
                      setDatablockMode(mode);
                    }}
                  >
                    <option value="all">All aircraft</option>
                    <option value="selected">Selected only</option>
                    <option value="none">Hidden</option>
                  </select>
                </div>
              </div>
            )}
          </div>
          <div className="tb-menu" ref={runwayMenuRef}>
            <button
              className="tb-menu-trigger"
              onClick={() => {
                setRunwayOpen((v) => !v);
                refreshActiveRunways();
              }}
            >
              🛫{" "}
              {activeRunways.length > 0
                ? activeRunways.map((r) => r.end).join(" ")
                : "no rwy"}
            </button>
            {runwayOpen && (
              <div className="tb-menu-panel runway-select-panel">
                <div className="runway-select-header">
                  <span>RWY</span>
                  <span>DEP</span>
                  <span>ARR</span>
                </div>
                {airport.runways.map((r) =>
                  r.ends.map((end) => {
                    const use = activeRunways.find((a) => a.rwy_ref === r.ref && a.end === end);
                    return (
                      <label className="runway-select-row" key={`${r.ref}-${end}`}>
                        <span className="runway-select-end">{end}</span>
                        <input
                          type="checkbox"
                          checked={use?.dep ?? false}
                          onChange={(e) =>
                            toggleRunwayUse(r.ref, end, e.target.checked, use?.arr ?? false)
                          }
                        />
                        <input
                          type="checkbox"
                          checked={use?.arr ?? false}
                          onChange={(e) =>
                            toggleRunwayUse(r.ref, end, use?.dep ?? false, e.target.checked)
                          }
                        />
                      </label>
                    );
                  })
                )}
              </div>
            )}
          </div>
          {selected && (
            <span className="tb-selected">
              {selected.callsign} · {selected.aircraft_type}
            </span>
          )}
          <span className="tb-spacer" />
          {wind && (
            <span className="tb-wind" title={metar ?? undefined}>
              W: {wind}
            </span>
          )}
          <span className="clock">{clock}</span>
        </div>
        <div className="top-bar-row top-bar-sub">
          <span className="tb-icao">{airport.icao}</span>
          <button
            className={depArrOpen ? "tb-menu-trigger active" : "tb-menu-trigger"}
            onClick={onToggleDepArr}
          >
            Dep/Arr
          </button>
          {worldMapEnabled && (
            <button
              className={worldMapOpen ? "tb-menu-trigger active" : "tb-menu-trigger"}
              onClick={onToggleWorldMap}
            >
              World Map
            </button>
          )}
        </div>
      </div>
      {stationSelectOpen && (
        <StationSelectModal
          installedAirports={installedAirports}
          currentIcao={airport.icao}
          currentRole={role}
          onConnect={onSwitchStation}
          onDisconnect={onDisconnect}
          onClose={() => setStationSelectOpen(false)}
        />
      )}
      {atisOpen && (
        <AtisModal
          icao={airport.icao}
          metar={metar}
          activeRunways={activeRunways}
          onClose={() => setAtisOpen(false)}
        />
      )}
    </>
  );
}
