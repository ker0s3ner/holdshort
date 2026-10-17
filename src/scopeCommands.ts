import type { AircraftSnapshot, Clearance, ControllerRole } from "./types";
import {
  deletePrefSet,
  getLeaderFor,
  LEADER_MAX_PX,
  LEADER_MIN_PX,
  listPrefSets,
  loadPrefSet,
  patchScopeSettings,
  savePrefSet,
  setLeaderFor,
  setQuickLook,
  type DatablockMode,
  type ScopeKind,
} from "./scopeDisplay";
import { requestPointOut, roleLabel } from "./pointOuts";
import { parseParty, sendMessage } from "./controllerMessaging";

/** The scope's message-composition area: nearly everything the DCB does
 * can also be typed here, either aimed at a slewing target (click a
 * target, then type the command) or with the callsign typed first
 * ("UAL123 HDG 090") - both real CRC/ERAM habits. This module owns
 * parsing and dispatch; the React component owns input + feedback.
 */

export interface CommandContext {
  scope: ScopeKind;
  role: ControllerRole;
  aircraft: AircraftSnapshot[];
  selectedCallsign: string | null;
  select: (callsign: string | null) => void;
  issue: (callsign: string, clearance: Clearance) => Promise<void>;
}

export interface CommandResult {
  ok: boolean;
  message: string;
}

const HELP =
  "HDG 090 · ALT 8000/A080/FL180 · SPD 210 · CA · leading callsign slews · " +
  "PT <pos> · MSG <pos|ALL> <text> · QL <pos|OFF> · DB ALL|SEL|OFF · RINGS ON|OFF · " +
  "LEN 6-40 · DIR 0-359 · R 20 · ROT 030 · VIS 15 · PS SAVE|LOAD|DEL|LIST <name>";

function parseRole(token: string): ControllerRole | null {
  switch (token) {
    case "RAMP":
      return "ramp";
    case "GND":
    case "GROUND":
      return "ground";
    case "TWR":
    case "TOWER":
      return "tower";
    case "APP":
    case "APPROACH":
      return "approach";
    default:
      return null;
  }
}

function findAircraft(ctx: CommandContext, token: string): AircraftSnapshot | undefined {
  const upper = token.toUpperCase();
  return ctx.aircraft.find((ac) => ac.callsign.toUpperCase() === upper);
}

function applyLeader(
  patch: Partial<{ angleDeg: number; lengthPx: number }>,
  ctx: CommandContext,
): CommandResult {
  const current = getLeaderFor(ctx.selectedCallsign);
  const next = { ...current, ...patch };
  if (next.angleDeg < 0 || next.angleDeg > 359) return { ok: false, message: "? DIR 0-359" };
  if (next.lengthPx < LEADER_MIN_PX || next.lengthPx > LEADER_MAX_PX)
    return { ok: false, message: `? LEN ${LEADER_MIN_PX}-${LEADER_MAX_PX}` };
  const angle = String(Math.round(next.angleDeg) % 360).padStart(3, "0");
  const len = Math.round(next.lengthPx);
  if (ctx.selectedCallsign) {
    setLeaderFor(ctx.selectedCallsign, next);
    return { ok: true, message: `${ctx.selectedCallsign} LEADER ${angle}°/${len}PX` };
  }
  patchScopeSettings({ leader: next });
  return { ok: true, message: `DEFAULT LEADER ${angle}°/${len}PX` };
}

/** Parse and execute one line typed into the scope's command area. */
export async function runCommand(raw: string, ctx: CommandContext): Promise<CommandResult> {
  const input = raw.trim();
  if (!input) return { ok: false, message: "" };

  let tokens = input.split(/\s+/);
  const head = tokens[0].toUpperCase();

  switch (head) {
    case "HELP":
    case "?":
      return { ok: true, message: HELP };

    case "DB": {
      const arg = (tokens[1] ?? "").toUpperCase();
      const mode: DatablockMode | null =
        arg === "ALL"
          ? "all"
          : arg === "SEL" || arg === "SELECTED"
            ? "selected"
            : arg === "OFF" || arg === "HIDE"
              ? "none"
              : null;
      if (!mode) return { ok: false, message: "? DB ALL|SEL|OFF" };
      patchScopeSettings({ datablockMode: mode });
      return { ok: true, message: `DB ${arg === "SELECTED" ? "SEL" : arg}` };
    }

    case "RINGS": {
      const arg = (tokens[1] ?? "").toUpperCase();
      if (arg !== "ON" && arg !== "OFF") return { ok: false, message: "? RINGS ON|OFF" };
      if (ctx.scope === "tower") return { ok: false, message: "! TWR USES VIS, NOT RINGS" };
      patchScopeSettings({ rings: arg === "ON" });
      return { ok: true, message: `RINGS ${arg}` };
    }

    case "LEN": {
      const n = parseInt(tokens[1] ?? "", 10);
      if (!Number.isFinite(n)) return { ok: false, message: "? LEN <px>" };
      return applyLeader({ lengthPx: n }, ctx);
    }

    case "DIR":
    case "DR": {
      const n = parseFloat(tokens[1] ?? "");
      if (!Number.isFinite(n)) return { ok: false, message: "? DIR <deg>" };
      return applyLeader({ angleDeg: n }, ctx);
    }

    case "R":
    case "RNG":
    case "RANGE": {
      if (ctx.scope !== "approach") return { ok: false, message: "! RANGE ONLY ON APP SCOPE" };
      const n = parseFloat(tokens[1] ?? "");
      if (!Number.isFinite(n) || n < 1 || n > 400) return { ok: false, message: "? R 1-400" };
      patchScopeSettings({ rangeNm: Math.round(n) });
      return { ok: true, message: `RANGE ${Math.round(n)}NM` };
    }

    case "ROT": {
      if (ctx.scope !== "approach") return { ok: false, message: "! ROT ONLY ON APP SCOPE" };
      const n = parseFloat(tokens[1] ?? "");
      if (!Number.isFinite(n) || n < 0 || n > 359) return { ok: false, message: "? ROT 0-359" };
      patchScopeSettings({ rotationDeg: Math.round(n) });
      return { ok: true, message: `ROT ${String(Math.round(n)).padStart(3, "0")}°` };
    }

    case "VIS": {
      if (ctx.scope !== "tower") return { ok: false, message: "! VIS ONLY ON TWR SCOPE" };
      const n = parseFloat(tokens[1] ?? "");
      if (!Number.isFinite(n) || n < 3 || n > 40) return { ok: false, message: "? VIS 3-40KM" };
      patchScopeSettings({ visRingKm: Math.round(n) });
      return { ok: true, message: `VIS ${Math.round(n)}KM` };
    }

    case "QL": {
      const arg = (tokens[1] ?? "").toUpperCase();
      if (arg === "" || arg === "OFF" || arg === "NONE") {
        setQuickLook(null);
        return { ok: true, message: "QL OFF" };
      }
      const target = parseRole(arg);
      if (!target) return { ok: false, message: "? QL RAMP|GND|TWR|APP|OFF" };
      if (target === ctx.role) return { ok: false, message: "? QL MUST BE ANOTHER POSITION" };
      setQuickLook(target);
      return { ok: true, message: `QL ${roleLabel(target)}` };
    }

    case "MSG":
    case "M": {
      const party = parseParty(tokens[1] ?? "");
      if (!party) return { ok: false, message: "? MSG RAMP|GND|TWR|APP|ALL <text>" };
      const text = tokens.slice(2).join(" ");
      if (!text.trim()) return { ok: false, message: "? MSG <pos> NEEDS A MESSAGE" };
      return sendMessage(ctx.role, party, text);
    }

    case "PS": {
      const sub = (tokens[1] ?? "").toUpperCase();
      const name = tokens[2] ?? "";
      switch (sub) {
        case "SAVE":
          return savePrefSet(name);
        case "LOAD":
        case "RECALL":
          return loadPrefSet(name);
        case "DEL":
        case "DELETE":
          return deletePrefSet(name);
        case "LIST": {
          const names = listPrefSets().map((p) => p.name);
          return { ok: true, message: names.length ? `PS: ${names.join(" · ")}` : "PS: (none saved)" };
        }
        default:
          return { ok: false, message: "? PS SAVE|LOAD|DEL|LIST <name>" };
      }
    }
  }

  // Not a display command: look for a callsign first ("UAL123 HDG 090"),
  // otherwise fall back to whatever target is currently slewed.
  let slewed: AircraftSnapshot | null = null;
  const maybe = findAircraft(ctx, tokens[0]);
  if (maybe) {
    slewed = maybe;
    ctx.select(maybe.callsign); // slew
    tokens = tokens.slice(1);
  }

  if (tokens.length === 0) {
    return slewed
      ? { ok: true, message: `SLEWED ${slewed.callsign}` }
      : { ok: false, message: "? SLEW A TARGET OR LEAD WITH A CALLSIGN" };
  }

  const target = slewed?.callsign ?? ctx.selectedCallsign;
  const ac = target ? ctx.aircraft.find((a) => a.callsign === target) : null;
  if (!ac) return { ok: false, message: "? NO TARGET - CLICK ONE OR LEAD WITH A CALLSIGN" };

  const cmd = tokens[0].toUpperCase();
  const arg = tokens[1] ?? "";

  const fail = (msg: string): CommandResult => ({ ok: false, message: `! ${ac.callsign} ${msg}` });
  const done = (msg: string): CommandResult => ({ ok: true, message: `${ac.callsign} ${msg}` });

  const invoke = async (clearance: Clearance, echo: string): Promise<CommandResult> => {
    try {
      await ctx.issue(ac.callsign, clearance);
      return done(echo);
    } catch (e) {
      return { ok: false, message: `! ${String(e)}` };
    }
  };

  // Altitude shorthand, all three real-scope habits: "ALT 8000" (feet),
  // "A080" (hundreds, immediately attached to the A) and "FL180".
  const hMatch = /^H(\d{1,3})$/.exec(cmd);
  const aCompact = /^A(\d{3})$/.exec(cmd);
  const aFeet = /^A(\d{4})$/.exec(cmd);
  const flMatch = /^FL(\d{2,3})$/.exec(cmd);

  if (cmd === "HDG" || hMatch) {
    const deg = parseFloat(hMatch ? hMatch[1] : arg);
    if (!Number.isFinite(deg) || deg < 0 || deg > 359) return { ok: false, message: "? HDG 0-359" };
    return invoke({ Vector: { heading_deg: deg } }, `HDG ${String(Math.round(deg)).padStart(3, "0")}`);
  }

  if (cmd === "ALT" || cmd === "A" || aCompact || aFeet || flMatch) {
    const numStr = flMatch ? flMatch[1] : aCompact ? aCompact[1] : aFeet ? aFeet[1] : arg;
    const n = parseFloat(numStr);
    if (!Number.isFinite(n)) return { ok: false, message: "? ALT <ft> OR FL<lvl>" };
    const feet = flMatch || aCompact ? n * 100 : n;
    if (feet < 1000 || feet > 60000) return { ok: false, message: "? ALT 1000-60000" };
    if (feet === ac.altitude_ft) return fail("ALREADY AT THAT ALTITUDE");
    const clearance: Clearance =
      feet > ac.altitude_ft
        ? { ClimbAndMaintain: { altitude_ft: feet } }
        : { DescendAndMaintain: { altitude_ft: feet } };
    return invoke(clearance, `${feet > ac.altitude_ft ? "CLIMB" : "DESCEND"} ${feet}`);
  }

  if (cmd === "SPD" || cmd === "S") {
    const n = parseFloat(arg);
    if (!Number.isFinite(n) || n < 0) return { ok: false, message: "? SPD <kts>" };
    return invoke({ AssignSpeed: { speed_kt: n } }, `SPD ${Math.round(n)}`);
  }

  if (cmd === "CA" || cmd === "ILS" || cmd === "APPROACH") {
    if (ac.cleared_approach) return fail("ALREADY CLEARED");
    return invoke("ClearedApproach", "CA");
  }

  if (cmd === "PT" || cmd === "PO") {
    const to = parseRole(arg.toUpperCase());
    if (!to) return { ok: false, message: "? PT RAMP|GND|TWR|APP" };
    return requestPointOut(ac.callsign, to, ctx.role);
  }

  if (cmd === "HO" || cmd === "HANDOFF") {
    // Ownership in Holdshort follows the aircraft's phase machine (Ramp →
    // Ground → Tower → Approach as it moves), observed by the display
    // rather than negotiated - so there's nothing to request here.
    return { ok: false, message: "! HO: OWNERSHIP FOLLOWS THE TRAFFIC PHASE, NOT A REQUEST" };
  }

  return { ok: false, message: `? UNKNOWN ${cmd}` };
}