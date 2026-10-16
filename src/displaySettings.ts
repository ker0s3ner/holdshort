const DATABLOCK_MODE_KEY = "holdshort.display.datablockMode";
const SHOW_RUNWAY_LABELS_KEY = "holdshort.display.showRunwayLabels";
const SHOW_TAXIWAY_LABELS_KEY = "holdshort.display.showTaxiwayLabels";
const SHOW_GATE_LABELS_KEY = "holdshort.display.showGateLabels";
// Legacy single on/off toggle, kept only so an existing install that had
// labels turned off doesn't suddenly see all three turn back on.
const LEGACY_SHOW_LABELS_KEY = "holdshort.display.showLabels";

function getLabelFlag(key: string): boolean {
  try {
    if (localStorage.getItem(key) != null) return localStorage.getItem(key) !== "false";
    return localStorage.getItem(LEGACY_SHOW_LABELS_KEY) !== "false";
  } catch {
    return true;
  }
}

function setLabelFlag(key: string, show: boolean) {
  try {
    localStorage.setItem(key, String(show));
  } catch {
    // Storage unavailable - setting just won't persist.
  }
}

export function getShowRunwayLabels(): boolean {
  return getLabelFlag(SHOW_RUNWAY_LABELS_KEY);
}
export function setShowRunwayLabels(show: boolean) {
  setLabelFlag(SHOW_RUNWAY_LABELS_KEY, show);
}

export function getShowTaxiwayLabels(): boolean {
  return getLabelFlag(SHOW_TAXIWAY_LABELS_KEY);
}
export function setShowTaxiwayLabels(show: boolean) {
  setLabelFlag(SHOW_TAXIWAY_LABELS_KEY, show);
}

export function getShowGateLabels(): boolean {
  return getLabelFlag(SHOW_GATE_LABELS_KEY);
}
export function setShowGateLabels(show: boolean) {
  setLabelFlag(SHOW_GATE_LABELS_KEY, show);
}

export type DatablockMode = "all" | "selected";

export function getDatablockMode(): DatablockMode {
  try {
    return localStorage.getItem(DATABLOCK_MODE_KEY) === "selected" ? "selected" : "all";
  } catch {
    return "all";
  }
}

export function setDatablockMode(mode: DatablockMode) {
  try {
    localStorage.setItem(DATABLOCK_MODE_KEY, mode);
  } catch {
    // Storage unavailable - setting just won't persist.
  }
}
