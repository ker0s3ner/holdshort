import type { AircraftSnapshot, ControllerRole } from "./types";

export interface HandoffEvent {
  from: ControllerRole;
  to: ControllerRole;
  at: number;
}

/** How long a just-handed-off aircraft gets a visual flash on the radar
 * views - roughly matching CRC's "blinks white for 5 seconds" convention
 * for an accepted handoff. */
export const HANDOFF_FLASH_MS = 5000;

/** Diffs a fresh snapshot against the previously known owning_role per
 * callsign, recording a HandoffEvent for anything that changed hands -
 * including to an AI-automated position, which is a real handoff in
 * every functional sense, just not to another human. Mutates both maps
 * in place (prevOwner tracks state across ticks, handoffs accumulates
 * recent events and self-prunes anything older than HANDOFF_FLASH_MS)
 * so this can run from a plain ref-based effect without React state. */
export function trackHandoffs(
  aircraft: AircraftSnapshot[],
  prevOwner: Map<string, ControllerRole>,
  handoffs: Map<string, HandoffEvent>
): void {
  const now = Date.now();
  const seen = new Set<string>();

  for (const ac of aircraft) {
    seen.add(ac.callsign);
    const prev = prevOwner.get(ac.callsign);
    if (prev && prev !== ac.owning_role) {
      handoffs.set(ac.callsign, { from: prev, to: ac.owning_role, at: now });
    }
    prevOwner.set(ac.callsign, ac.owning_role);
  }

  // Forget aircraft that left the sim entirely.
  for (const callsign of prevOwner.keys()) {
    if (!seen.has(callsign)) prevOwner.delete(callsign);
  }
  for (const [callsign, event] of handoffs) {
    if (!seen.has(callsign) || now - event.at > HANDOFF_FLASH_MS) {
      handoffs.delete(callsign);
    }
  }
}
