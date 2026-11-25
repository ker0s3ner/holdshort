import { ApproachView } from "./ApproachView";
import type { AirportData, AircraftSnapshot, ControllerRole } from "../types";
import type { HandoffEvent } from "../handoffTracking";

interface Props {
  airport: AirportData;
  aircraft: AircraftSnapshot[];
  role: ControllerRole;
  selectedCallsign: string | null;
  onSelectAircraft: (callsign: string | null) => void;
  recentHandoffs: Map<string, HandoffEvent>;
}

/** Center's station-dependent view. It uses the terminal radar renderer's
 * track interaction, but deliberately presents only airborne traffic and a
 * wide-area scope rather than pretending Center owns airport movement. */
export function CenterView(props: Props) {
  return <ApproachView {...props} />;
}
