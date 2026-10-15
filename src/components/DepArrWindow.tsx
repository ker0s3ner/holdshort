import { useRef, useState } from "react";
import type { AircraftSnapshot } from "../types";

interface Props {
  aircraft: AircraftSnapshot[];
  onClose: () => void;
  onSelect: (callsign: string) => void;
}

/** A small draggable floating window listing current departures and
 * arrivals, independent of the SMR/Tower Cab canvas underneath. */
export function DepArrWindow({ aircraft, onClose, onSelect }: Props) {
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const departures = aircraft.filter((a) => a.rule === "Departure");
  const arrivals = aircraft.filter((a) => a.rule === "Arrival");

  const onHeaderDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({ x: ev.clientX - dragRef.current.x, y: ev.clientY - dragRef.current.y });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="dep-arr-window" style={{ left: pos.x, top: pos.y }}>
      <div className="dep-arr-header" onMouseDown={onHeaderDown}>
        <span>Departures / Arrivals</span>
        <button className="icon-button" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="dep-arr-body">
        <div className="dep-arr-column">
          <div className="dep-arr-column-title">Departures</div>
          {departures.length === 0 && <div className="muted">None</div>}
          {departures.map((a) => (
            <button key={a.callsign} className="dep-arr-row" onClick={() => onSelect(a.callsign)}>
              <span className="callsign">{a.callsign}</span>
              <span>{a.destination}</span>
            </button>
          ))}
        </div>
        <div className="dep-arr-column">
          <div className="dep-arr-column-title">Arrivals</div>
          {arrivals.length === 0 && <div className="muted">None</div>}
          {arrivals.map((a) => (
            <button key={a.callsign} className="dep-arr-row" onClick={() => onSelect(a.callsign)}>
              <span className="callsign">{a.callsign}</span>
              <span>{a.origin}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
