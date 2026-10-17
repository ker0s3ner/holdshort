import type { AircraftSnapshot, Clearance, ControllerRole } from "./types";
import { parseClearance } from "./clearanceParser";
import { fuzzyMatchCallsign } from "./speech";

/** What the voice pipeline resolves a spoken transmission down to: which
 * aircraft it was addressed to (null if we couldn't tell), which clearance
 * it asked for (null if none was recognized), and which path produced it -
 * the local LLM or the regex fallback - purely so the "Heard:" line and any
 * debugging can say which one answered. */
export interface IntentResult {
  callsign: string | null;
  clearance: Clearance | null;
  source: "llm" | "regex";
}

/** A pluggable "ask the local model" call. The real one wraps the Tauri
 * `ask_ai` command; tests pass a deterministic stub. It returns the model's
 * raw text, or null/throws when the model is unavailable - either way the
 * resolver falls back to regex, so Ollama being off is never fatal. */
export type LlmCall = (prompt: string) => Promise<string | null>;

const PHASE_BY_STATE: Partial<Record<AircraftSnapshot["state"], string>> = {
  AtGate: "parked at gate, before pushback",
  PushingBack: "pushing back",
  ReadyForTaxi: "ready to taxi",
  TaxiingToRunway: "taxiing to the runway",
  HoldingShort: "holding short of the runway",
  LinedUp: "lined up on the runway",
  TakeoffRoll: "on takeoff roll",
  Departed: "airborne, departing",
  OnApproach: "on approach to land",
  LandingRollout: "landing rollout",
  TaxiingToGate: "taxiing to the gate",
  Parked: "parked",
};

/** The exact set of clearance "type" tags the model is allowed to emit, so
 * the prompt and the parser agree on one vocabulary. */
const CLEARANCE_TYPES = [
  "EngineStartApproved",
  "PushbackApproved",
  "TaxiToRunway",
  "TaxiToGate",
  "HoldPosition",
  "ResumeTaxi",
  "LineUpAndWait",
  "ClearedForTakeoff",
  "ClearedToLand",
  "GoAround",
  "CancelClearance",
  "Vector",
  "DescendAndMaintain",
  "ClimbAndMaintain",
  "AssignSpeed",
  "ClearedApproach",
] as const;

/** Builds the strict, context-primed prompt for the local LLM intent parse.
 * Feeding it the live callsigns (and each one's flight phase) plus the
 * controller's position is what lets it recover from accent/transcription
 * noise the regex can't - it knows the plausible readings ahead of time. */
export function buildIntentPrompt(
  transcript: string,
  aircraft: AircraftSnapshot[],
  role: ControllerRole
): string {
  const roster = aircraft.length
    ? aircraft
        .map((a) => `  - ${a.callsign} (${a.rule}, ${PHASE_BY_STATE[a.state] ?? a.state})`)
        .join("\n")
    : "  (no aircraft on frequency)";

  return (
    `You are a parser for air traffic control voice clearances. You are the ` +
    `${role.toUpperCase()} controller. A speech-to-text engine transcribed what the ` +
    `controller said; it may contain accent or transcription errors.\n\n` +
    `Aircraft currently on frequency:\n${roster}\n\n` +
    `Transcript: "${transcript}"\n\n` +
    `Decide which aircraft (by exact callsign from the list above) the clearance was ` +
    `addressed to, and which single clearance it is. Reply with ONLY a JSON object, no ` +
    `prose, in this shape:\n` +
    `{"callsign": "<exact callsign from the list, or null>", "clearance": {"type": "<TYPE>", ` +
    `"heading_deg": <int?>, "altitude_ft": <int in feet?>, "speed_kt": <int?>, "gate_ref": "<str?>"}}\n` +
    `TYPE must be one of: ${CLEARANCE_TYPES.join(", ")}.\n` +
    `Only include the numeric field relevant to the type. Altitudes are in feet ` +
    `(e.g. flight level 180 = 18000). If no clear clearance was said, reply ` +
    `{"clearance": "none"}.`
  );
}

/** Maps the model's flat {type, ...fields} object (or a bare type string)
 * onto the real Clearance union. Returns null for anything outside the
 * known vocabulary so a hallucinated type degrades to the regex fallback
 * rather than issuing a bogus clearance. */
function toClearance(raw: unknown): Clearance | null {
  if (typeof raw === "string") {
    return toClearance({ type: raw });
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const type = typeof obj.type === "string" ? obj.type : null;
  if (!type) return null;

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  switch (type) {
    case "EngineStartApproved":
    case "PushbackApproved":
    case "HoldPosition":
    case "ResumeTaxi":
    case "LineUpAndWait":
    case "ClearedForTakeoff":
    case "ClearedToLand":
    case "GoAround":
    case "CancelClearance":
    case "ClearedApproach":
      return type;
    case "TaxiToRunway":
      return { TaxiToRunway: { via_hold_short: null } };
    case "TaxiToGate":
      return { TaxiToGate: { gate_ref: typeof obj.gate_ref === "string" ? obj.gate_ref : "" } };
    // The model has no runway-node graph, so a bare "hold short" from it is
    // treated as a hold-in-place, same as the regex path does.
    case "HoldShort":
      return "HoldPosition";
    case "Vector": {
      const h = num(obj.heading_deg);
      return h != null ? { Vector: { heading_deg: h } } : null;
    }
    case "DescendAndMaintain": {
      const a = num(obj.altitude_ft);
      return a != null ? { DescendAndMaintain: { altitude_ft: a } } : null;
    }
    case "ClimbAndMaintain": {
      const a = num(obj.altitude_ft);
      return a != null ? { ClimbAndMaintain: { altitude_ft: a } } : null;
    }
    case "AssignSpeed": {
      const s = num(obj.speed_kt);
      return s != null ? { AssignSpeed: { speed_kt: s } } : null;
    }
    default:
      return null;
  }
}

/** Parses the LLM's raw reply into a resolved callsign + clearance. Tolerant
 * of the model wrapping its JSON in prose or code fences (grabs the first
 * {...} block). Returns null when the model said "none", emitted nothing
 * usable, or named a callsign/clearance we can't map - all of which send the
 * caller to the regex fallback. */
export function parseLlmIntent(
  rawReply: string,
  aircraft: AircraftSnapshot[]
): { callsign: string | null; clearance: Clearance } | null {
  const start = rawReply.indexOf("{");
  const end = rawReply.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawReply.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  if (obj.clearance === "none" || obj.clearance == null) return null;
  const clearance = toClearance(obj.clearance);
  if (!clearance) return null;

  const callsigns = aircraft.map((a) => a.callsign);
  let callsign: string | null = null;
  if (typeof obj.callsign === "string" && obj.callsign.trim()) {
    const named = obj.callsign.trim();
    // Prefer an exact roster hit; otherwise fuzzy-resolve the model's guess.
    callsign =
      callsigns.find((c) => c.toLowerCase() === named.toLowerCase()) ??
      fuzzyMatchCallsign(named, callsigns);
  }
  return { callsign, clearance };
}

/** TaxiToGate from speech usually doesn't name a gate - the backend needs a
 * real gate_ref to route to, so fill it from the resolved aircraft's own
 * assigned gate when the pilot (or model) left it blank. */
export function fillGate(
  clearance: Clearance,
  callsign: string | null,
  aircraft: AircraftSnapshot[]
): Clearance {
  if (typeof clearance === "string" || !("TaxiToGate" in clearance)) return clearance;
  if (clearance.TaxiToGate.gate_ref) return clearance;
  const ac = aircraft.find((a) => a.callsign === callsign);
  if (ac?.assigned_gate) return { TaxiToGate: { gate_ref: ac.assigned_gate } };
  return clearance;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
  return Promise.race([promise, timeout]);
}

/** Resolves a spoken transmission to a callsign + clearance. Tries the local
 * LLM first (context-primed, accent-tolerant), and on ANY failure - no model
 * wired, timeout, thrown error, or an unparseable/none reply - falls back to
 * the deterministic regex parser + fuzzy callsign match. The app therefore
 * works identically with Ollama off; the LLM only ever improves a result,
 * never gates one. The timeout mirrors voice.ts's readback timeout. */
export async function resolveClearance(
  transcript: string,
  aircraft: AircraftSnapshot[],
  role: ControllerRole,
  llmCall?: LlmCall,
  timeoutMs = 4000
): Promise<IntentResult> {
  if (llmCall) {
    try {
      const reply = await withTimeout(llmCall(buildIntentPrompt(transcript, aircraft, role)), timeoutMs);
      if (reply) {
        const parsed = parseLlmIntent(reply, aircraft);
        if (parsed) {
          return {
            callsign: parsed.callsign,
            clearance: fillGate(parsed.clearance, parsed.callsign, aircraft),
            source: "llm",
          };
        }
      }
    } catch {
      // Model unreachable or errored - fall through to the regex parser.
    }
  }

  const clearance = parseClearance(transcript);
  const callsign = fuzzyMatchCallsign(
    transcript,
    aircraft.map((a) => a.callsign)
  );
  return {
    callsign,
    clearance: clearance ? fillGate(clearance, callsign, aircraft) : null,
    source: "regex",
  };
}
