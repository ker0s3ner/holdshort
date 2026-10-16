import { useMemo, useRef, useState } from "react";
import type { AircraftSnapshot, AirportData } from "../types";
import { AIRPORT_COORDS } from "../airportCoords";

interface Props {
  airport: AirportData;
  aircraft: AircraftSnapshot[];
  onClose: () => void;
}

const MAP_W = 420;
const MAP_H = 230;

function project(lat: number, lon: number): [number, number] {
  const x = ((lon + 180) / 360) * MAP_W;
  const y = ((90 - lat) / 180) * MAP_H;
  return [x, y];
}

/** A VatSpy-inspired world map: not a live global network (there isn't
 * one - this sim has no server connecting separate Holdshort sessions),
 * but a real view of where this session's own traffic is actually flying
 * to and from in the real world, using each flight's real origin/
 * destination ICAO. */
export function WorldMapWindow({ airport, aircraft, onClose }: Props) {
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

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

  const home = project(airport.reference_point.lat, airport.reference_point.lon);

  const routes = useMemo(() => {
    const seen = new Map<string, { icao: string; count: number; coord: [number, number] }>();
    for (const a of aircraft) {
      const otherIcao = a.rule === "Departure" ? a.destination : a.origin;
      const coord = AIRPORT_COORDS[otherIcao];
      if (!coord) continue;
      const entry = seen.get(otherIcao) ?? { icao: otherIcao, count: 0, coord };
      entry.count += 1;
      seen.set(otherIcao, entry);
    }
    return Array.from(seen.values());
  }, [aircraft]);

  const gridLines = [];
  for (let lon = -180; lon <= 180; lon += 30) gridLines.push(lon);
  const gridLats = [];
  for (let lat = -60; lat <= 60; lat += 30) gridLats.push(lat);

  return (
    <div className="world-map-window" style={{ left: pos.x, top: pos.y }}>
      <div className="dep-arr-header" onMouseDown={onHeaderDown}>
        <span>World Traffic Map</span>
        <button className="icon-button" onClick={onClose}>
          ✕
        </button>
      </div>
      <svg width={MAP_W} height={MAP_H} className="world-map-svg">
        <rect x={0} y={0} width={MAP_W} height={MAP_H} className="world-map-bg" />
        {gridLines.map((lon) => {
          const [x] = project(0, lon);
          return <line key={`lon${lon}`} x1={x} y1={0} x2={x} y2={MAP_H} className="world-map-grid" />;
        })}
        {gridLats.map((lat) => {
          const [, y] = project(lat, 0);
          return <line key={`lat${lat}`} x1={0} y1={y} x2={MAP_W} y2={y} className="world-map-grid" />;
        })}
        {routes.map((r) => (
          <line
            key={`route-${r.icao}`}
            x1={home[0]}
            y1={home[1]}
            x2={r.coord[0]}
            y2={r.coord[1]}
            className="world-map-route"
          />
        ))}
        {routes.map((r) => (
          <g key={`pin-${r.icao}`}>
            <circle cx={r.coord[0]} cy={r.coord[1]} r={3} className="world-map-pin" />
            <text x={r.coord[0] + 5} y={r.coord[1] - 4} className="world-map-label">
              {r.icao}
              {r.count > 1 ? ` ×${r.count}` : ""}
            </text>
          </g>
        ))}
        <circle cx={home[0]} cy={home[1]} r={5} className="world-map-home" />
        <text x={home[0] + 6} y={home[1] - 6} className="world-map-label world-map-home-label">
          {airport.icao}
        </text>
      </svg>
      {routes.length === 0 && (
        <p className="muted world-map-empty">No traffic with a mapped destination right now.</p>
      )}
    </div>
  );
}
