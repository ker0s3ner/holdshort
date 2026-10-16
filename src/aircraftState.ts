import type { AircraftState } from "./types";

/** Human-readable label for each simulation state, shared by anywhere that
 * shows an aircraft's current status (flight strips, the dep/arr list). */
export const STATE_LABELS: Record<AircraftState, string> = {
  AtGate: "at gate",
  PushingBack: "pushing back",
  ReadyForTaxi: "ready to taxi",
  TaxiingToRunway: "taxiing to rwy",
  HoldingShort: "holding short",
  LinedUp: "lined up",
  TakeoffRoll: "takeoff roll",
  Departed: "departed",
  OnApproach: "on approach",
  LandingRollout: "landing rollout",
  TaxiingToGate: "taxiing to gate",
  Parked: "parked",
};
