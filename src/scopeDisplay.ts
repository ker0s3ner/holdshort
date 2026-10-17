import type { AircraftSnapshot, ControllerRole } from "./types";

/** The shared display-architecture layer every CRC scope (Tower Cab, the
 * SMR/ASDE-X surface display, the Approach radar) is built from:
 *
 * - One settings store (`ScopeSettings`) read live by the canvas draw
 *   loops, the Display Control Bar and the command line, so all three
 *   always agree. Values persist per-operator under `holdshort.display.*`
 *   (the pre-existing keys are reused, so an installed copy keeps its
 *   labels/datablock choices). Facility-wide state (active runways)
 *   deliberately lives in the Rust backend instead - that's the
 *   global-vs-local split: scope settings are personal, runway config is
 *   shared.
 * - Named preference sets (SAVE/LOAD, capped like ASDE-X's 32 slots) so a
 *   controller can bank a whole arrangement and get it back.
 * - Per-track leader lines (independently adjustable direction + length),
 *   the three datablock fidelity levels (LDB/PDB/FDB) derived from track
 *   ownership, and Quick Look elevation.
 */

export type DatablockMode = "all" | "selected" | "none";

/** Which scope the DCB/command line are currently driving. */
export type ScopeKind = "smr" | "tower" | "approach";

export interface LeaderStyle {
  /** Degrees, 0 = straight up, increasing clockwise. */
  angleDeg: number;
  /** Pixels from target to the far end of the leader line. */
  lengthPx: number;
}

export interface ScopeSettings {
  showRunwayLabels: boolean;
  showTaxiwayLabels: boolean;
  showGateLabels: boolean;
  datablockMode: DatablockMode;
  leader: LeaderStyle;
  /** Range rings overlay (SMR + Approach; Tower uses its visibility ring). */
  rings: boolean;
  /** Scope rotation in degrees, 0 = north-up (Approach). */
  rotationDeg: number;
  /** Displayed range in nautical miles around the scope center; 0 = fit. */
  rangeNm: number;
  /** Tower Cab visibility ring radius, kilometres. */
  visRingKm: number;
}

// Legacy keys deliberately kept so existing installs carry their choices
// over - displaySettings used these same strings.
const K_DB = "holdshort.display.datablockMode";
const K_RWY = "holdshort.display.showRunwayLabels";
const K_TAXI = "holdshort.display.showTaxiwayLabels";
const K_GATE = "holdshort.display.showGateLabels";
const K_LEADER = "holdshort.display.leader";
const K_RINGS = "holdshort.display.rings";
const K_ROT = "holdshort.display.rotation";
const K_RANGE = "holdshort.display.rangeNm";
const K_VIS = "holdshort.display.visRingKm";
const K_LEADER_OVR = "holdshort.display.leaderOverrides";
const K_PREFSETS = "holdshort.prefSets";

export const LEADER_MIN_PX = 6;
export const LEADER_MAX_PX = 40;
export const MAX_PREF_SETS = 32;

export const DEFAULT_LEADER: LeaderStyle = { angleDeg: 45, lengthPx: 16 };

function raw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable - the setting just won't persist past the session.
  }
}

function readBool(key: string, fallback: boolean): boolean {
  const v = raw(key);
  return v == null ? fallback : v !== "false";
}

function readNum(key: string, fallback: number): number {
  const v = parseFloat(raw(key) ?? "");
  return Number.isFinite(v) ? v : fallback;
}

function readSettings(): ScopeSettings {
  let leader = DEFAULT_LEADER;
  const rawLeader = raw(K_LEADER);
  if (rawLeader) {
    try {
      const parsed = JSON.parse(rawLeader);
      if (parsed && typeof parsed.angleDeg === "number" && typeof parsed.lengthPx === "number") {
        leader = {
          angleDeg: clamp(parsed.angleDeg, 0, 359),
          lengthPx: clamp(parsed.lengthPx, LEADER_MIN_PX, LEADER_MAX_PX),
        };
      }
    } catch {
      // Corrupt value - fall back to the default.
    }
  }
  const mode = raw(K_DB);
  return {
    showRunwayLabels: readBool(K_RWY, true),
    showTaxiwayLabels: readBool(K_TAXI, true),
    showGateLabels: readBool(K_GATE, true),
    datablockMode: mode === "selected" || mode === "none" ? mode : "all",
    leader,
    rings: readBool(K_RINGS, false),
    rotationDeg: clamp(Math.round(readNum(K_ROT, 0)), 0, 359),
    rangeNm: clamp(readNum(K_RANGE, 0), 0, 400),
    visRingKm: clamp(readNum(K_VIS, 18), 3, 40),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

let cache: ScopeSettings | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/** Fresh view of the store (cached; invalidated on every write). Draw
 * loops call this every frame, DCB/command line subscribe via
 * subscribeScopeSettings. */
export function getScopeSettings(): ScopeSettings {
  if (!cache) cache = readSettings();
  return cache;
}

export function subscribeScopeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function persistPatch(patch: Partial<ScopeSettings>, current: ScopeSettings) {
  if (patch.datablockMode != null && patch.datablockMode !== current.datablockMode)
    write(K_DB, patch.datablockMode);
  if (patch.showRunwayLabels != null && patch.showRunwayLabels !== current.showRunwayLabels)
    write(K_RWY, String(patch.showRunwayLabels));
  if (patch.showTaxiwayLabels != null && patch.showTaxiwayLabels !== current.showTaxiwayLabels)
    write(K_TAXI, String(patch.showTaxiwayLabels));
  if (patch.showGateLabels != null && patch.showGateLabels !== current.showGateLabels)
    write(K_GATE, String(patch.showGateLabels));
  if (patch.leader && (patch.leader.angleDeg !== current.leader.angleDeg || patch.leader.lengthPx !== current.leader.lengthPx))
    write(K_LEADER, JSON.stringify(patch.leader));
  if (patch.rings != null && patch.rings !== current.rings) write(K_RINGS, String(patch.rings));
  if (patch.rotationDeg != null && patch.rotationDeg !== current.rotationDeg)
    write(K_ROT, String(patch.rotationDeg));
  if (patch.rangeNm != null && patch.rangeNm !== current.rangeNm)
    write(K_RANGE, String(patch.rangeNm));
  if (patch.visRingKm != null && patch.visRingKm !== current.visRingKm)
    write(K_VIS, String(patch.visRingKm));
}

export function patchScopeSettings(patch: Partial<ScopeSettings>): void {
  const current = getScopeSettings();
  persistPatch(patch, current);
  cache = { ...current, ...patch };
  notify();
}

// ---------------------------------------------------------------------------
// Legacy displaySettings API - TopBar's Quick SET menu talks to this, and it
// writes through the same store the DCB and the canvases read from.
// ---------------------------------------------------------------------------

export function getDatablockMode(): DatablockMode {
  return getScopeSettings().datablockMode;
}
export function setDatablockMode(mode: DatablockMode) {
  patchScopeSettings({ datablockMode: mode });
}

export function getShowRunwayLabels(): boolean {
  return getScopeSettings().showRunwayLabels;
}
export function setShowRunwayLabels(show: boolean) {
  patchScopeSettings({ showRunwayLabels: show });
}

export function getShowTaxiwayLabels(): boolean {
  return getScopeSettings().showTaxiwayLabels;
}
export function setShowTaxiwayLabels(show: boolean) {
  patchScopeSettings({ showTaxiwayLabels: show });
}

export function getShowGateLabels(): boolean {
  return getScopeSettings().showGateLabels;
}
export function setShowGateLabels(show: boolean) {
  patchScopeSettings({ showGateLabels: show });
}

// ---------------------------------------------------------------------------
// Leader lines - a default for the whole scope plus independently
// adjustable per-track overrides (set from the DCB spinners while slewed
// onto a target, or from the LEN/DIR commands).
// ---------------------------------------------------------------------------

function readOverrides(): Record<string, LeaderStyle> {
  const v = raw(K_LEADER_OVR);
  if (!v) return {};
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let overrideCache: Record<string, LeaderStyle> | null = null;

/** The style a specific target's leader line draws with - its own
 * override if one exists, otherwise the scope default. */
export function getLeaderFor(callsign: string | null): LeaderStyle {
  const s = getScopeSettings();
  if (!callsign) return s.leader;
  if (!overrideCache) overrideCache = readOverrides();
  return overrideCache[callsign] ?? s.leader;
}

export function setLeaderFor(callsign: string, style: LeaderStyle): void {
  if (!overrideCache) overrideCache = readOverrides();
  const normalized: LeaderStyle = {
    angleDeg: clamp(Math.round(style.angleDeg), 0, 359),
    lengthPx: clamp(Math.round(style.lengthPx), LEADER_MIN_PX, LEADER_MAX_PX),
  };
  const isDefault =
    normalized.angleDeg === getScopeSettings().leader.angleDeg &&
    normalized.lengthPx === getScopeSettings().leader.lengthPx;
  if (isDefault) {
    delete overrideCache[callsign];
  } else {
    overrideCache[callsign] = normalized;
  }
  write(K_LEADER_OVR, JSON.stringify(overrideCache));
}

export function clearLeaderOverrides(): void {
  overrideCache = {};
  write(K_LEADER_OVR, "{}");
}

/** Screen-space offset of a leader line's far end, angle 0 = up,
 * increasing clockwise. */
export function leaderEnd(style: LeaderStyle): { dx: number; dy: number } {
  const rad = (style.angleDeg * Math.PI) / 180;
  return { dx: Math.sin(rad) * style.lengthPx, dy: -Math.cos(rad) * style.lengthPx };
}

// ---------------------------------------------------------------------------
// Datablock fidelity: Limited / Partial / Full, derived from track
// ownership - FDB when the track is yours (or elevated by Quick Look),
// PDB when another position owns it, LDB when the track sits outside this
// scope's domain entirely (e.g. an airborne departure on the surface
// radar: still a return, but barely your business).
// ---------------------------------------------------------------------------

export type Fidelity = "LDB" | "PDB" | "FDB";

function inScopeDomain(ac: AircraftSnapshot, scope: ScopeKind): boolean {
  switch (scope) {
    case "smr":
      return ac.state !== "Departed" && ac.state !== "OnApproach";
    case "tower":
      return ac.state !== "Departed";
    case "approach":
      return (
        ac.state === "OnApproach" ||
        ac.state === "Departed" ||
        ac.state === "TakeoffRoll" ||
        ac.state === "LinedUp" ||
        ac.state === "LandingRollout"
      );
  }
}

export function fidelityOf(
  ac: AircraftSnapshot,
  scope: ScopeKind,
  myRole: ControllerRole,
  quickLook: ControllerRole | null,
): Fidelity {
  if (ac.owning_role === myRole) return "FDB";
  if (quickLook && ac.owning_role === quickLook) return "FDB";
  return inScopeDomain(ac, scope) ? "PDB" : "LDB";
}

// ---------------------------------------------------------------------------
// Quick Look: watch another position's full datablocks without taking
// ownership. Session-only state (a real QL is a live view, not a saved
// preference), which is why it's kept out of the persisted settings.
// ---------------------------------------------------------------------------

let quickLook: ControllerRole | null = null;

export function getQuickLook(): ControllerRole | null {
  return quickLook;
}

export function setQuickLook(target: ControllerRole | null): void {
  if (quickLook === target) return;
  quickLook = target;
  notify();
}

// ---------------------------------------------------------------------------
// Named preference sets (save/load/delete), capped like ASDE-X's 32 slots.
// ---------------------------------------------------------------------------

export interface PrefSet {
  name: string;
  savedAt: number;
  settings: ScopeSettings;
}

function readPrefSets(): PrefSet[] {
  const v = raw(K_PREFSETS);
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function listPrefSets(): PrefSet[] {
  return readPrefSets();
}

export interface PrefSetResult {
  ok: boolean;
  message: string;
}

export function savePrefSet(name: string): PrefSetResult {
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) return { ok: false, message: "? NAME REQUIRED" };
  // Quick Look is operational state, not a preference - never banked.
  const snapshot: ScopeSettings = { ...getScopeSettings() };
  const sets = readPrefSets().filter((p) => p.name !== trimmed);
  if (sets.length >= MAX_PREF_SETS && !readPrefSets().some((p) => p.name === trimmed)) {
    return { ok: false, message: `? PREF SET FULL (${MAX_PREF_SETS})` };
  }
  sets.push({ name: trimmed, savedAt: Date.now(), settings: snapshot });
  write(K_PREFSETS, JSON.stringify(sets));
  notify();
  return { ok: true, message: `PS ${trimmed} SAVED` };
}

export function loadPrefSet(name: string): PrefSetResult {
  const trimmed = name.trim();
  const found = readPrefSets().find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  if (!found) return { ok: false, message: `? NO PREF SET ${trimmed.toUpperCase()}` };
  patchScopeSettings(found.settings);
  return { ok: true, message: `PS ${found.name} LOADED` };
}

export function deletePrefSet(name: string): PrefSetResult {
  const trimmed = name.trim();
  const sets = readPrefSets();
  const next = sets.filter((p) => p.name.toLowerCase() !== trimmed.toLowerCase());
  if (next.length === sets.length) return { ok: false, message: `? NO PREF SET ${trimmed.toUpperCase()}` };
  write(K_PREFSETS, JSON.stringify(next));
  notify();
  return { ok: true, message: `PS ${trimmed.toUpperCase()} DELETED` };
}