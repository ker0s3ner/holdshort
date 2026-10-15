import { invoke } from "@tauri-apps/api/core";
import type { SimEvent } from "./types";
import { getTtsRate, getTtsVoiceName, isReadbackEnabled } from "./voiceSettings";

/** Pilots call up on their own the moment they're ready - at the gate
 * requesting pushback, holding short ready for departure, vacating the
 * runway requesting taxi in - rather than waiting for the controller to
 * select them first. Only one plane talks at a time on a real frequency,
 * so these are queued and spoken one after another instead of all firing
 * at once when several aircraft become ready in the same tick. */
const queue: SimEvent[] = [];
let processing = false;

export function enqueuePilotCalls(events: SimEvent[]) {
  queue.push(...events);
  void processQueue();
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const ev = queue.shift()!;
    await speakPilotCall(ev);
    await new Promise((r) => setTimeout(r, 600));
  }
  processing = false;
}

function setSpeaking(callsign: string, speaking: boolean) {
  return invoke("set_speaking", { callsign, speaking }).catch(() => {});
}

async function speakPilotCall(ev: SimEvent) {
  if (!isReadbackEnabled() || !("speechSynthesis" in window)) {
    // No TTS configured - still flash the speaking ring briefly so a call-in
    // is visible on the display even without audio.
    await setSpeaking(ev.callsign, true);
    await new Promise((r) => setTimeout(r, 1400));
    await setSpeaking(ev.callsign, false);
    return;
  }

  const text = `${ev.callsign}, ${ev.message}.`;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = getTtsRate();
  const voiceName = getTtsVoiceName();
  if (voiceName) {
    const voice = window.speechSynthesis.getVoices().find((v) => v.name === voiceName);
    if (voice) utter.voice = voice;
  }

  await new Promise<void>((resolve) => {
    utter.onstart = () => setSpeaking(ev.callsign, true);
    const finish = () => {
      setSpeaking(ev.callsign, false);
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  });
}
