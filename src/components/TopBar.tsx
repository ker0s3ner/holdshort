import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AircraftSnapshot, AirportData, ControllerRole } from "../types";
import { frequencyFor } from "../frequencies";
import {
  getDatablockMode,
  getShowLabels,
  setDatablockMode,
  setShowLabels,
  type DatablockMode,
} from "../displaySettings";

type ViewMode = "smr" | "tower";

interface Props {
  airport: AirportData;
  role: ControllerRole;
  viewMode: ViewMode;
  clock: string;
  selected: AircraftSnapshot | null;
  depArrOpen: boolean;
  onBack: () => void;
  onToggleDepArr: () => void;
  worldMapEnabled: boolean;
  worldMapOpen: boolean;
  onToggleWorldMap: () => void;
}

const METAR_REFRESH_MS = 5 * 60 * 1000;

/** The two-row CRC-style status bar: position/frequency/clock/METAR up top,
 * a thin menu strip underneath for the real view settings that exist
 * (datablock density, label visibility, the dep/arr window) rather than
 * decorative menu labels with nothing behind them. */
export function TopBar({
  airport,
  role,
  viewMode,
  clock,
  selected,
  depArrOpen,
  onBack,
  onToggleDepArr,
  worldMapEnabled,
  worldMapOpen,
  onToggleWorldMap,
}: Props) {
  const [metar, setMetar] = useState<string | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [showLabels, setShowLabelsState] = useState(getShowLabels());
  const [datablockMode, setDatablockModeState] = useState<DatablockMode>(getDatablockMode());
  const menuRef = useRef<HTMLDivElement>(null);

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
    if (!displayOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setDisplayOpen(false);
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [displayOpen]);

  return (
    <>
      <div className="top-bar">
        <div className="top-bar-row">
          <button className="back-button" onClick={onBack} title="Back to menu">
            ‹
          </button>
          <span className="tb-position">
            {airport.icao}_{role.toUpperCase()} [{viewMode === "smr" ? "SMR" : "TWR"}]
          </span>
          <span className="tb-freq">{frequencyFor(airport.icao, role)}</span>
          <span className="tb-status">
            <span className="tb-status-dot" /> LIVE
          </span>
          {selected && (
            <span className="tb-selected">
              {selected.callsign} · {selected.aircraft_type}
            </span>
          )}
          <span className="tb-spacer" />
          {metar && <span className="metar-line" title={metar}>{metar}</span>}
          <span className="clock">{clock}</span>
        </div>
        <div className="top-bar-row top-bar-sub">
          <span className="tb-icao">{airport.icao}</span>
          <div className="tb-menu" ref={menuRef}>
            <button className="tb-menu-trigger" onClick={() => setDisplayOpen((v) => !v)}>
              Display ▾
            </button>
            {displayOpen && (
              <div className="tb-menu-panel">
                <label className="tb-menu-item">
                  <input
                    type="checkbox"
                    checked={showLabels}
                    onChange={(e) => {
                      setShowLabelsState(e.target.checked);
                      setShowLabels(e.target.checked);
                    }}
                  />
                  Surface labels (runway/taxiway/gate)
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
                  </select>
                </div>
              </div>
            )}
          </div>
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
    </>
  );
}
