import type { Clearance } from "./types";

/** Pulls a number out of speech near a keyword, handling both whisper's
 * usual direct-digit output ("3000", "270") and the spelled-out "X
 * thousand" form it sometimes produces for round altitudes. */
function extractNumber(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  return Number(m[1]);
}

/** Best-effort keyword matching from what push-to-talk heard into an
 * actual clearance - pattern matching, not a real NLU model, but real
 * enough to drive the sim instead of just showing transcribed text and
 * doing nothing with it. Checked most-specific-phrase-first so "cleared
 * for takeoff" doesn't get swallowed by a looser "hold" or "taxi" match. */
export function parseClearance(heard: string): Clearance | null {
  const text = heard.toLowerCase();

  if (/\bgo\s*around\b/.test(text)) return "GoAround";
  if (/\bcancel\b/.test(text)) return "CancelClearance";

  if (/\bclear(ed)?\s*(for\s*the\s*|for\s*)?(ils\s*|visual\s*|rnav\s*)?approach\b/.test(text)) {
    return "ClearedApproach";
  }
  if (/\bclear(ed)?\s*to\s*land\b/.test(text)) return "ClearedToLand";
  if (/\bclear(ed)?\s*for\s*take ?off\b/.test(text) || /\btake ?off\b/.test(text)) {
    return "ClearedForTakeoff";
  }

  const headingMatch = text.match(
    /\b(?:turn\s*(?:left|right)\s*)?(?:fly\s*)?heading\s*(\d{1,3})\b/
  );
  if (headingMatch) return { Vector: { heading_deg: Number(headingMatch[1]) } };

  const descendThousands = extractNumber(text, /\bdescend\b.{0,20}?\b(\d{1,2})\s*thousand\b/);
  const descendDigits = extractNumber(text, /\bdescend\b.{0,20}?\b(\d{3,5})\b/);
  if (descendThousands != null) return { DescendAndMaintain: { altitude_ft: descendThousands * 1000 } };
  if (descendDigits != null) return { DescendAndMaintain: { altitude_ft: descendDigits } };

  const climbThousands = extractNumber(text, /\bclimb\b.{0,20}?\b(\d{1,2})\s*thousand\b/);
  const climbDigits = extractNumber(text, /\bclimb\b.{0,20}?\b(\d{3,5})\b/);
  if (climbThousands != null) return { ClimbAndMaintain: { altitude_ft: climbThousands * 1000 } };
  if (climbDigits != null) return { ClimbAndMaintain: { altitude_ft: climbDigits } };

  const speedMatch = text.match(/\b(?:speed|reduce\s*speed|increase\s*speed)\s*(\d{2,3})\b/);
  if (speedMatch) return { AssignSpeed: { speed_kt: Number(speedMatch[1]) } };

  if (/\bline\s*up\s*and\s*wait\b/.test(text)) return "LineUpAndWait";
  if (/\bresume\s*taxi\b/.test(text)) return "ResumeTaxi";
  if (/\bhold\s*short\b/.test(text) || /\bhold\s*position\b/.test(text) || /\bhold\b/.test(text)) {
    return "HoldPosition";
  }
  if (
    /\b(engine\s*start|start\s*engines?)\b.*\bapprov/.test(text) ||
    /\bclear(ed)?\s*to\s*start\b/.test(text)
  ) {
    return "EngineStartApproved";
  }
  if (/\bpush\s*back\b/.test(text) || /\bpush\s*(and\s*start|&\s*start)?\s*approved\b/.test(text)) {
    return "PushbackApproved";
  }
  if (/\btaxi\b/.test(text)) return { TaxiToRunway: { via_hold_short: null } };

  return null;
}

/** Abbreviated typed-command entry in CRC's own convention - altitudes in
 * hundreds of feet, a letter prefix per instruction type:
 *   H270  -> turn heading 270
 *   D30   -> descend and maintain 3,000
 *   C50   -> climb and maintain 5,000
 *   S210  -> assign speed 210
 *   CA    -> cleared approach
 *   GA    -> go around
 */
export function parseCommand(input: string): Clearance | null {
  const text = input.trim().toUpperCase();
  if (text === "CA") return "ClearedApproach";
  if (text === "GA") return "GoAround";

  const m = text.match(/^([HDCS])(\d{1,3})$/);
  if (!m) return null;
  const [, prefix, numStr] = m;
  const num = Number(numStr);
  switch (prefix) {
    case "H":
      return { Vector: { heading_deg: num } };
    case "D":
      return { DescendAndMaintain: { altitude_ft: num * 100 } };
    case "C":
      return { ClimbAndMaintain: { altitude_ft: num * 100 } };
    case "S":
      return { AssignSpeed: { speed_kt: num } };
    default:
      return null;
  }
}
