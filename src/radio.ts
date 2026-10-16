/** A single shared "frequency" that every spoken transmission - pilot
 * call-ins and controller readbacks alike - goes out on. Two people keyed
 * up at once produces a garbled, blocked transmission in real life, not
 * two clean overlapping voices, so this tracks whether the channel is
 * currently busy and, if something new tries to transmit while it is,
 * plays a short "blocked" beep and drops that transmission instead of
 * letting two voices talk over each other. */
let busy = false;

export function isChannelBusy(): boolean {
  return busy;
}

function playBlockedBeep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(900, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch {
    // Web Audio unavailable - silently skip the beep, the dropped
    // transmission itself still behaves correctly.
  }
}

/** Speaks `utter` on the shared channel. Resolves once the transmission
 * finishes (or immediately, with a blocked beep, if the channel was busy).
 * `onSpeakingChange` fires true right as audio starts and false when it
 * ends, for driving a "speaking" indicator. */
export function speakOnChannel(
  utter: SpeechSynthesisUtterance,
  onSpeakingChange?: (speaking: boolean) => void
): Promise<void> {
  return new Promise((resolve) => {
    if (busy) {
      playBlockedBeep();
      resolve();
      return;
    }
    busy = true;
    const finish = () => {
      busy = false;
      onSpeakingChange?.(false);
      resolve();
    };
    utter.onstart = () => onSpeakingChange?.(true);
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  });
}
