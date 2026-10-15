const SHOW_LABELS_KEY = "holdshort.display.showLabels";
const DATABLOCK_MODE_KEY = "holdshort.display.datablockMode";

export function getShowLabels(): boolean {
  try {
    return localStorage.getItem(SHOW_LABELS_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setShowLabels(show: boolean) {
  try {
    localStorage.setItem(SHOW_LABELS_KEY, String(show));
  } catch {
    // Storage unavailable - setting just won't persist.
  }
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
