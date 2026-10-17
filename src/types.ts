export interface LatLon {
  lat: number;
  lon: number;
}

export interface AirportNode {
  id: string;
  lat: number;
  lon: number;
  x: number;
  y: number;
}

export interface AirportEdge {
  id: string;
  from: string;
  to: string;
  kind: "runway" | "taxiway" | "taxilane" | "stopway" | "gate_link";
  ref: string;
  length_m: number;
}

/** One runway end tower has configured for use right now, and for what -
 * several can be active at once, each serving departures, arrivals, or
 * both, mirroring the Rust side's RunwayUse. */
export interface RunwayUse {
  rwy_ref: string;
  end: string;
  dep: boolean;
  arr: boolean;
}

export interface Runway {
  ref: string;
  ends: string[];
  width_m: number | null;
  surface: string | null;
  node_start: string;
  node_end: string;
  heading_deg: number;
}

export interface ParkingPosition {
  id: string;
  ref: string;
  node: string;
  parking_type: string;
}

export interface Area {
  kind: "terminal" | "hangar" | "apron";
  points: [number, number][];
}

export interface Tower {
  x: number;
  y: number;
  height_m: number;
}

export interface AirportData {
  icao: string;
  name: string;
  reference_point: LatLon;
  attribution: string;
  nodes: AirportNode[];
  edges: AirportEdge[];
  runways: Runway[];
  parking_positions: ParkingPosition[];
  areas: Area[];
  towers: Tower[];
}

export type AircraftState =
  | "AtGate"
  | "PushingBack"
  | "ReadyForTaxi"
  | "TaxiingToRunway"
  | "HoldingShort"
  | "LinedUp"
  | "TakeoffRoll"
  | "Departed"
  | "OnApproach"
  | "LandingRollout"
  | "TaxiingToGate"
  | "Parked";

export type FlightRule = "Departure" | "Arrival";

export interface AircraftSnapshot {
  callsign: string;
  aircraft_type: string;
  state: AircraftState;
  rule: FlightRule;
  x: number;
  y: number;
  heading_deg: number;
  ground_speed_kt: number;
  destination: string;
  origin: string;
  assigned_gate: string;
  assigned_runway: string;
  is_speaking: boolean;
  altitude_ft: number;
  assigned_heading_deg: number | null;
  assigned_altitude_ft: number | null;
  assigned_speed_kt: number | null;
  cleared_approach: boolean;
}

export interface SimTick {
  clock_s: number;
  aircraft: AircraftSnapshot[];
}

/** A pilot calling up unprompted - ready for pushback, holding short and
 * ready for departure, vacated the runway and ready to taxi in. */
export interface SimEvent {
  callsign: string;
  message: string;
}

export interface AirportSummary {
  icao: string;
  name: string;
  region: string;
}

export type ControllerRole = "ramp" | "ground" | "tower" | "approach";

export type Clearance =
  | "EngineStartApproved"
  | "PushbackApproved"
  | { TaxiToRunway: { via_hold_short: string | null } }
  | { TaxiToGate: { gate_ref: string } }
  | { HoldShort: { node_id: string } }
  | "HoldPosition"
  | "ResumeTaxi"
  | "LineUpAndWait"
  | "ClearedForTakeoff"
  | "ClearedToLand"
  | "GoAround"
  | "CancelClearance"
  | { Vector: { heading_deg: number } }
  | { DescendAndMaintain: { altitude_ft: number } }
  | { ClimbAndMaintain: { altitude_ft: number } }
  | { AssignSpeed: { speed_kt: number } }
  | "ClearedApproach";

export interface ClearanceCommand {
  callsign: string;
  clearance: Clearance;
}
