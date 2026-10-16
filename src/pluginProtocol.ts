/** The Holdshort plugin SDK, v1: a postMessage protocol between the main
 * app and a plugin running in a sandboxed <iframe sandbox="allow-scripts">
 * (no allow-same-origin, so the iframe gets its own opaque origin - it
 * genuinely cannot read the host's localStorage, DOM, or cookies, not just
 * "isn't supposed to"). Read-only for now: a plugin gets a live feed of
 * traffic/airport/theme data and renders whatever it wants, but can't
 * issue clearances or otherwise write back into the sim. A write API is
 * real future work, not a corner cut for today - letting untrusted code
 * safely control the simulation is a bigger design problem on its own.
 *
 * A plugin is a single static HTML file (served from public/plugins/<id>/
 * index.html) that does its own thing with plain DOM/JS/SVG - no build
 * step, no framework, so nothing here depends on React or bundling. */

export interface PluginAirportRef {
  icao: string;
  lat: number;
  lon: number;
}

/** Minimal per-aircraft data pushed to plugins - deliberately not the full
 * AircraftSnapshot (internal sim fields a plugin has no business reading
 * stay internal; this is the SDK's actual public surface, so it's kept
 * small on purpose). */
export interface PluginAircraft {
  callsign: string;
  aircraft_type: string;
  rule: "Departure" | "Arrival";
  state: string;
  /** The real-world airport this flight is going to/from, resolved from
   * the app's own airport-coordinate table so a plugin never needs its
   * own copy of that data just to plot a route. Null if unknown. */
  otherAirport: PluginAirportRef | null;
}

/** A few theme colors so a plugin can blend into whichever theme is
 * active instead of always looking like a foreign element bolted on. */
export interface PluginThemeColors {
  bg: string;
  panel: string;
  border: string;
  accent: string;
  text: string;
  textMuted: string;
}

/** Host -> plugin, sent once on load and again on every live update
 * (roughly 1 Hz, matching the sim's own display snapshot rate). */
export interface PluginTickMessage {
  type: "holdshort:tick";
  homeAirport: PluginAirportRef;
  aircraft: PluginAircraft[];
  theme: PluginThemeColors;
}

/** Plugin -> host: sent once the plugin's own message listener is
 * attached, so the host knows it's safe to start sending ticks instead of
 * racing the iframe's load. */
export interface PluginReadyMessage {
  type: "holdshort:ready";
}

export type HostToPluginMessage = PluginTickMessage;
export type PluginToHostMessage = PluginReadyMessage;
