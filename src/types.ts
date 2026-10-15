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

export interface AirportData {
  icao: string;
  name: string;
  reference_point: LatLon;
  attribution: string;
  nodes: AirportNode[];
  edges: AirportEdge[];
  runways: Runway[];
  parking_positions: ParkingPosition[];
}

export type AircraftState =
  | "AtGate"
  | "PushingBack"
  | "TaxiingToRunway"
  | "HoldingShort"
  | "LinedUp"
  | "TakeoffRoll"
  | "Departed"
  | "OnApproach"
  | "LandingRollout"
  | "TaxiingToGate"
  | "Parked";

export interface AircraftSnapshot {
  callsign: string;
  aircraft_type: string;
  state: AircraftState;
  x: number;
  y: number;
  heading_deg: number;
  ground_speed_kt: number;
  destination: string;
  assigned_gate: string;
  assigned_runway: string;
}

export interface SimTick {
  clock_s: number;
  aircraft: AircraftSnapshot[];
}

export type Clearance =
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
  | "CancelClearance";

export interface ClearanceCommand {
  callsign: string;
  clearance: Clearance;
}
