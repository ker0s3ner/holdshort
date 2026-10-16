import { getTheme, type Theme } from "./themeSettings";

/** Colors the SMR and Tower Cab canvases draw with - kept separate from
 * the CSS custom properties that theme the app's own chrome (top bar,
 * panels, buttons) because <canvas> can't read CSS variables; this is the
 * canvas-side equivalent, switched on the same Theme. Selection (yellow)
 * and arrival (cyan) stay constant across themes - that's ATC convention,
 * not aesthetic - only the base scope look changes per theme. */
export interface RadarPalette {
  /** SMR background wash (not used by Tower Cab, which sits on imagery). */
  bg: string;
  pavement: string;
  gateLinkStroke: string;
  runwayCenterline: string;
  /** Tower Cab's single diagram stroke color for taxiways/aprons. */
  diagram: string;
  /** Tower Cab's runway stroke color, distinct from taxiways. */
  runwayStroke: string;
  /** Tower Cab's filled pavement shade - a real synthetic diagram drawn
   * over the imagery (gray taxiway/apron shapes at realistic width), not
   * a thin accent-colored outline. */
  towerShade: string;
  parkingDot: string;
  runwayLabel: string;
  taxiwayLabel: string;
  gateLabel: string;
  areaFill: { terminal: string; hangar: string; apron: string; default: string };
  aircraftDefault: string;
  aircraftArrival: string;
  aircraftSelected: string;
  speakingRingDefault: string;
}

const PALETTES: Record<Theme, RadarPalette> = {
  // The original look - a dark teal/CRC-inspired SMR scope.
  holdshort: {
    bg: "#0a3f45",
    pavement: "#060606",
    gateLinkStroke: "#1c2b22",
    runwayCenterline: "#e8e8e8",
    diagram: "#ffb020",
    runwayStroke: "#e8e8e8",
    towerShade: "#3a4a46",
    parkingDot: "#cfe8d8",
    runwayLabel: "#eafff4",
    taxiwayLabel: "#ffd866",
    gateLabel: "#cfe8d8",
    areaFill: { terminal: "#888f93", hangar: "#767d81", apron: "#0e4a50", default: "#555" },
    aircraftDefault: "#f2f6f3",
    aircraftArrival: "#7fc8ff",
    aircraftSelected: "#ffdf5e",
    speakingRingDefault: "#ffffff",
  },
  // A darker, more neutral grey scope with CRC's own cyan accent.
  crc: {
    bg: "#14181a",
    pavement: "#050505",
    gateLinkStroke: "#2a2a2a",
    runwayCenterline: "#e8e8e8",
    diagram: "#9fa6ab",
    runwayStroke: "#f2f2f2",
    towerShade: "#4a4a4a",
    parkingDot: "#cfd8da",
    runwayLabel: "#f2f6f7",
    taxiwayLabel: "#4fc3f7",
    gateLabel: "#cfd8da",
    areaFill: { terminal: "#5a6468", hangar: "#4d5558", apron: "#1c2225", default: "#444" },
    aircraftDefault: "#e8eef0",
    aircraftArrival: "#4fc3f7",
    aircraftSelected: "#ffdf5e",
    speakingRingDefault: "#ffffff",
  },
  // The classic EuroScope radar look: true black with phosphor green.
  euroscope: {
    bg: "#000000",
    pavement: "#000000",
    gateLinkStroke: "#0e2412",
    runwayCenterline: "#eaffea",
    diagram: "#2f8f4a",
    runwayStroke: "#3dff6e",
    towerShade: "#1c2e1e",
    parkingDot: "#3dff6e",
    runwayLabel: "#eaffea",
    taxiwayLabel: "#ffb000",
    gateLabel: "#3dff6e",
    areaFill: { terminal: "#143318", hangar: "#102713", apron: "#081a0a", default: "#1a1a1a" },
    aircraftDefault: "#eaffea",
    aircraftArrival: "#39c5fe",
    aircraftSelected: "#ffe066",
    speakingRingDefault: "#3dff6e",
  },
};

export function getRadarPalette(): RadarPalette {
  return PALETTES[getTheme()];
}

/** "#rrggbb" -> "r, g, b", for building an rgba() string against a
 * palette color (canvas gradients need the channels split out). */
export function hexToRgbChannels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
