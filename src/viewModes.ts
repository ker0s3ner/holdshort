import type { ControllerRole } from "./types";

export type ViewMode = "smr" | "tower" | "terminal" | "enroute";

export const VIEW_LABELS: Record<ViewMode, string> = {
  smr: "SMR",
  tower: "Tower Cab",
  terminal: "Terminal Radar",
  enroute: "Center Radar",
};

/** Display choices follow the station, like CRC: a center position does not
 * get a surface display, while tower/ground can use the cab and SMR. */
export function viewsForRole(role: ControllerRole): ViewMode[] {
  switch (role) {
    case "center":
      return ["enroute"];
    case "approach":
      return ["terminal", "tower"];
    case "tower":
      return ["tower", "smr"];
    case "ground":
    case "delivery":
    case "ramp":
      return ["smr", "tower"];
  }
}

export function defaultViewForRole(role: ControllerRole): ViewMode {
  return viewsForRole(role)[0];
}
