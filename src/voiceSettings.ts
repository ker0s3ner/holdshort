const ENABLED_KEY = "holdshort.voice.readbackEnabled";
const MODEL_KEY = "holdshort.voice.ollamaModel";
const TTS_VOICE_KEY = "holdshort.voice.ttsVoice";
const TTS_RATE_KEY = "holdshort.voice.ttsRate";
const STT_ENABLED_KEY = "holdshort.voice.sttEnabled";
const WHISPER_MODEL_KEY = "holdshort.voice.whisperModelPath";
const MIC_DEVICE_KEY = "holdshort.voice.micDeviceId";
const PTT_KEY_KEY = "holdshort.voice.pttKey";

function getItem(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function setItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable - setting just won't persist.
  }
}

export function isReadbackEnabled(): boolean {
  return getItem(ENABLED_KEY, "true") !== "false";
}

export function setReadbackEnabled(enabled: boolean) {
  setItem(ENABLED_KEY, String(enabled));
}

export function getOllamaModel(): string {
  return getItem(MODEL_KEY, "gemma2");
}

export function setOllamaModel(model: string) {
  setItem(MODEL_KEY, model);
}

/** Empty string means "let the OS pick its default voice". */
export function getTtsVoiceName(): string {
  return getItem(TTS_VOICE_KEY, "");
}

export function setTtsVoiceName(name: string) {
  setItem(TTS_VOICE_KEY, name);
}

export function getTtsRate(): number {
  return Number(getItem(TTS_RATE_KEY, "1")) || 1;
}

export function setTtsRate(rate: number) {
  setItem(TTS_RATE_KEY, String(rate));
}

export function isSttEnabled(): boolean {
  return getItem(STT_ENABLED_KEY, "false") === "true";
}

export function setSttEnabled(enabled: boolean) {
  setItem(STT_ENABLED_KEY, String(enabled));
}

/** Empty string means "use the default ~/.cache/whisper/ggml-base.en.bin path". */
export function getWhisperModelPath(): string {
  return getItem(WHISPER_MODEL_KEY, "");
}

export function setWhisperModelPath(path: string) {
  setItem(WHISPER_MODEL_KEY, path);
}

/** Empty string means "let the OS pick the default input device". */
export function getMicDeviceId(): string {
  return getItem(MIC_DEVICE_KEY, "");
}

export function setMicDeviceId(id: string) {
  setItem(MIC_DEVICE_KEY, id);
}

/** KeyboardEvent.code, e.g. "Backquote". Empty string means push-to-talk
 * has no keybind - only the mic button works. */
export function getPttKey(): string {
  return getItem(PTT_KEY_KEY, "Backquote");
}

export function setPttKey(code: string) {
  setItem(PTT_KEY_KEY, code);
}
