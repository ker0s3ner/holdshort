import type { ControllerRole } from "./types";

/** Point-outs: "I see your traffic" coordination with another position.
 *
 * Unlike a handoff - which follows the aircraft's own phase machine in the
 * Rust core, so ownership transfers are observed rather than requested - a
 * point-out is a request the receiving position has to answer, which makes
 * it the natural home for the pending/accepted/rejected visual language a
 * real scope carries. Position requests are answered by the AI controller
 * after a short delay (accepted) or refused immediately (rejected - e.g.
 * pointing out to your own position). This runs entirely in the frontend;
 * views poll pointOutFor() in their draw loop and animate the datablock
 * from the returned state.
 */

export type PointOutState = "pending" | "accepted" | "rejected";

export interface PointOut {
  callsign: string;
  to: ControllerRole;
  from: ControllerRole;
  state: PointOutState;
  /** When the current state began (re-stamped on transitions so views can
   * age the state themselves). */
  since: number;
}

const PENDING_MS = 2200;
const ACCEPT_HOLD_MS = 5000;
const REJECT_MS = 1800;

const outs = new Map<string, PointOut>();

export function roleLabel(role: ControllerRole): string {
  switch (role) {
    case "ramp":
      return "RAMP";
    case "ground":
      return "GND";
    case "tower":
      return "TWR";
    case "approach":
      return "APP";
  }
}

export interface PointOutResult {
  ok: boolean;
  message: string;
}

export function requestPointOut(
  callsign: string,
  to: ControllerRole,
  from: ControllerRole,
): PointOutResult {
  const now = Date.now();
  pruneExpired(now);

  if (to === from) {
    // Picking your own position is the one answer that's always "no" -
    // and it exercises the rejected visual path rather than leaving it
    // unreachable.
    outs.set(callsign, { callsign, to, from, state: "rejected", since: now });
    return { ok: false, message: `PT ${callsign} → ${roleLabel(to)}: REJECTED` };
  }
  if (outs.has(callsign)) {
    return { ok: false, message: `? PT ${callsign} ALREADY OUTSTANDING` };
  }
  outs.set(callsign, { callsign, to, from, state: "pending", since: now });
  return { ok: true, message: `PT ${callsign} → ${roleLabel(to)}: SENT` };
}

function pruneExpired(now: number) {
  for (const [cs, po] of outs) {
    const age = now - po.since;
    if ((po.state === "accepted" && age >= ACCEPT_HOLD_MS) || (po.state === "rejected" && age >= REJECT_MS)) {
      outs.delete(cs);
    }
  }
}

/** The current point-out on a track, advancing pending → accepted and
 * expiring finished ones as time passes. Called from the draw loop, so it
 * lazily drives its own transitions instead of running timers. */
export function pointOutFor(callsign: string): PointOut | null {
  const now = Date.now();
  const po = outs.get(callsign);
  if (!po) return null;
  if (po.state === "pending" && now - po.since >= PENDING_MS) {
    po.state = "accepted";
    po.since = now;
  }
  if ((po.state === "accepted" && now - po.since >= ACCEPT_HOLD_MS) ||
      (po.state === "rejected" && now - po.since >= REJECT_MS)) {
    outs.delete(callsign);
    return null;
  }
  return po;
}