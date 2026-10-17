const ENABLED_KEY = "holdshort.voice.readbackEnabled";
const MODEL_KEY = "holdshort.voice.ollamaModel";
const TTS_VOICE_KEY = "holdshort.voice.ttsVoice";
const TTS_RATE_KEY = "holdshort.voice.ttsRate";
const STT_ENABLED_KEY = "holdshort.voice.sttEnabled";
const WHISPER_MODEL_KEY = "holdshort.voice.whisperModelPath";
const WHISPER_MODEL_NAME_KEY = "holdshort.voice.whisperModel";
const MIC_DEVICE_KEY = "holdshort.voice.micDeviceId";
const PTT_KEY_KEY = "holdshort.voice.pttKey";

/** Every size whisper.cpp ships a ready-made ggml model for, smallest/
 * least-accurate to biggest/best. Same naming convention Hugging Face
 * uses, so these ids double as both the Settings dropdown value and the
 * download filename. */
export const WHISPER_MODELS = [
  { id: "tiny.en", label: "Tiny — fastest, least accurate (~75MB)" },
  { id: "base.en", label: "Base — fast, basic accuracy (~142MB)" },
  { id: "small.en", label: "Small — fast, lighter accuracy (~466MB)" },
  { id: "medium.en", label: "Medium — recommended, best for accents (~1.5GB)" },
  { id: "large-v3", label: "Large — maximum accuracy, heaviest, multilingual (~2.9GB)" },
] as const;

/** A spread of general-purpose Ollama models from smallest/fastest to
 * largest/best, for phrasing pilot readbacks. Any Ollama model name
 * works, not just these - "Custom" in the picker falls back to free text
 * for anything not on this shortlist. */
export const OLLAMA_MODELS = [
  { id: "gemma2:2b", label: "Gemma 2 2B — fastest, least capable" },
  { id: "llama3.2:3b", label: "Llama 3.2 3B — fast, small" },
  { id: "gemma2", label: "Gemma 2 9B — recommended" },
  { id: "llama3.1:8b", label: "Llama 3.1 8B" },
  { id: "gemma2:27b", label: "Gemma 2 27B — slower, more capable" },
  { id: "llama3.1:70b", label: "Llama 3.1 70B — best, heaviest" },
] as const;

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

/** Empty string means "use the default ~/.cache/whisper/ggml-small.en.bin path". */
export function getWhisperModelPath(): string {
  return getItem(WHISPER_MODEL_KEY, "");
}

export function setWhisperModelPath(path: string) {
  setItem(WHISPER_MODEL_KEY, path);
}

/** Which WHISPER_MODELS ladder entry is selected - ignored if
 * getWhisperModelPath() is set, which overrides this with an exact path. */
export function getWhisperModel(): string {
  return getItem(WHISPER_MODEL_NAME_KEY, "medium.en");
}

export function setWhisperModel(model: string) {
  setItem(WHISPER_MODEL_NAME_KEY, model);
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
