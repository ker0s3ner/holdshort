import type { Clearance } from "./types";

/** Best-effort keyword matching from what push-to-talk heard into an
 * actual clearance - pattern matching, not a real NLU model, but real
 * enough to drive the sim instead of just showing transcribed text and
 * doing nothing with it. Checked most-specific-phrase-first so "cleared
 * for takeoff" doesn't get swallowed by a looser "hold" or "taxi" match. */
export function parseClearance(heard: string): Clearance | null {
  const text = heard.toLowerCase();

  if (/\bgo\s*around\b/.test(text)) return "GoAround";
  if (/\bcancel\b/.test(text)) return "CancelClearance";
  if (/\bclear(ed)?\s*to\s*land\b/.test(text)) return "ClearedToLand";
  if (/\bclear(ed)?\s*for\s*take ?off\b/.test(text) || /\btake ?off\b/.test(text)) {
    return "ClearedForTakeoff";
  }
  if (/\bline\s*up\s*and\s*wait\b/.test(text)) return "LineUpAndWait";
  if (/\bresume\s*taxi\b/.test(text)) return "ResumeTaxi";
  if (/\bhold\s*short\b/.test(text) || /\bhold\s*position\b/.test(text) || /\bhold\b/.test(text)) {
    return "HoldPosition";
  }
  if (/\bpush\s*back\b/.test(text)) return "PushbackApproved";
  if (/\btaxi\b/.test(text)) return { TaxiToRunway: { via_hold_short: null } };

  return null;
}
