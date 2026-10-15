import { invoke } from "@tauri-apps/api/core";
import type { Clearance } from "./types";
import { getOllamaModel } from "./voiceSettings";

/** Plain-English phrase for a clearance, used both as the AI prompt seed
 * and as the spoken fallback when no local AI is available. */
export function describeClearance(clearance: Clearance): string {
  if (typeof clearance === "string") {
    switch (clearance) {
      case "PushbackApproved":
        return "pushback approved";
      case "HoldPosition":
        return "hold position";
      case "ResumeTaxi":
        return "resume taxi";
      case "LineUpAndWait":
        return "line up and wait";
      case "ClearedForTakeoff":
        return "cleared for takeoff";
      case "ClearedToLand":
        return "cleared to land";
      case "GoAround":
        return "go around";
      case "CancelClearance":
        return "disregard, cancel clearance";
    }
  }
  if ("TaxiToRunway" in clearance) return "taxi to the runway";
  if ("TaxiToGate" in clearance) return `taxi to gate ${clearance.TaxiToGate.gate_ref}`;
  if ("HoldShort" in clearance) return "hold short";
  return "roger";
}

/** Best-effort AI-generated pilot readback via a local Ollama + Gemma
 * instance, with a short client-side timeout so a missing/slow local model
 * never blocks the sim - falls back to a standard template readback. */
async function getReadbackText(callsign: string, phrase: string): Promise<string> {
  const fallback = `${phrase}, ${callsign}.`;
  try {
    const prompt =
      `You are an airline pilot on an ATC radio frequency. Your controller just said: ` +
      `"${phrase}". Reply with ONLY a brief, realistic radio readback repeating the ` +
      `instruction and your callsign "${callsign}". No explanation, no quotes, one sentence.`;
    const aiPromise = invoke<string>("ask_ai", { prompt, model: getOllamaModel() });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
    const result = await Promise.race([aiPromise, timeout]);
    if (typeof result === "string" && result.trim()) return result.trim();
  } catch {
    // Ollama not running or model not pulled - use the template instead.
  }
  return fallback;
}

/** Speaks a pilot readback for the given clearance via the browser's TTS
 * engine, ringing the aircraft on the display for the duration (the
 * "speaking" indicator) via the backend's is_speaking flag. */
export async function speakReadback(callsign: string, clearance: Clearance) {
  const phrase = describeClearance(clearance);
  const text = await getReadbackText(callsign, phrase);

  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  const setSpeaking = (speaking: boolean) =>
    invoke("set_speaking", { callsign, speaking }).catch(() => {});
  utter.onstart = () => setSpeaking(true);
  utter.onend = () => setSpeaking(false);
  utter.onerror = () => setSpeaking(false);
  window.speechSynthesis.speak(utter);
}
