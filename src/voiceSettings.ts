const ENABLED_KEY = "holdshort.voice.readbackEnabled";
const MODEL_KEY = "holdshort.voice.ollamaModel";

export function isReadbackEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setReadbackEnabled(enabled: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled));
  } catch {
    // Storage unavailable - setting just won't persist.
  }
}

export function getOllamaModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) || "gemma2";
  } catch {
    return "gemma2";
  }
}

export function setOllamaModel(model: string) {
  try {
    localStorage.setItem(MODEL_KEY, model);
  } catch {
    // Storage unavailable - setting just won't persist.
  }
}
