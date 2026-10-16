import { useEffect, useRef, useState } from "react";
import type { AircraftSnapshot, AirportData } from "../types";
import { AIRPORT_COORDS } from "../airportCoords";
import type { PluginAircraft, PluginThemeColors, PluginToHostMessage } from "../pluginProtocol";

interface Props {
  title: string;
  /** Path to the plugin's static HTML file, e.g. "/plugins/worldmap/index.html". */
  entry: string;
  airport: AirportData;
  aircraft: AircraftSnapshot[];
  onClose: () => void;
}

function currentThemeColors(): PluginThemeColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    bg: v("--bg-app") || "#05080a",
    panel: v("--bg-panel") || "#0b120e",
    border: v("--border") || "#1c2b22",
    accent: v("--accent") || "#7fffb0",
    text: v("--text") || "#cfe8d8",
    textMuted: v("--text-muted") || "#9adbb6",
  };
}

/** Hosts a Holdshort plugin - a single static HTML file running in a
 * sandboxed <iframe sandbox="allow-scripts"> (no allow-same-origin, so it
 * gets its own opaque origin and genuinely cannot reach the host's
 * localStorage/DOM/cookies) - in the same draggable floating window chrome
 * as the built-in Dep/Arr and World Map windows. Feeds it a live read-only
 * telemetry stream over postMessage per pluginProtocol.ts; see that file
 * for what a plugin actually gets. */
export function PluginHost({ title, entry, airport, aircraft, onClose }: Props) {
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);

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

  const sendTick = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !readyRef.current) return;
    const pluginAircraft: PluginAircraft[] = aircraft.map((a) => {
      const otherIcao = a.rule === "Departure" ? a.destination : a.origin;
      const coord = AIRPORT_COORDS[otherIcao];
      return {
        callsign: a.callsign,
        aircraft_type: a.aircraft_type,
        rule: a.rule,
        state: a.state,
        otherAirport: coord ? { icao: otherIcao, lat: coord[0], lon: coord[1] } : null,
      };
    });
    win.postMessage(
      {
        type: "holdshort:tick",
        homeAirport: {
          icao: airport.icao,
          lat: airport.reference_point.lat,
          lon: airport.reference_point.lon,
        },
        aircraft: pluginAircraft,
        theme: currentThemeColors(),
      },
      "*"
    );
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent<PluginToHostMessage>) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "holdshort:ready") {
        readyRef.current = true;
        sendTick();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sendTick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airport, aircraft]);

  return (
    <div className="dep-arr-window plugin-host-window" style={{ left: pos.x, top: pos.y }}>
      <div className="dep-arr-header" onMouseDown={onHeaderDown}>
        <span>{title}</span>
        <button className="icon-button" onClick={onClose}>
          ✕
        </button>
      </div>
      <iframe
        ref={iframeRef}
        src={entry}
        title={title}
        className="plugin-host-frame"
        sandbox="allow-scripts"
        onLoad={sendTick}
      />
    </div>
  );
}
