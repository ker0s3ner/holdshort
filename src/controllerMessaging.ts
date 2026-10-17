import type { ControllerRole } from "./types";
import { roleLabel } from "./pointOuts";

/** Controller-to-controller messaging: the text coordination every real
 * CRC position carries alongside the radar - a message window per other
 * controller, plus a facility-wide broadcast line.
 *
 * In a single-seat trainer the "other controllers" are the three AI-run
 * positions you aren't working, so this follows the same frontend-simulated
 * shape point-outs do: the human's message is stored immediately and the
 * receiving position answers after a short, human-feeling delay. Replies are
 * composed deterministically from the text's coordination intent (release,
 * APREQ, handoff, verify, traffic…), which keeps them believable on screen
 * and assertable in the test harness. Views/panels subscribe for re-render;
 * the DCB reads unreadCount() for its badge.
 */

/** A party on the coordination net: another position, or the all-call. */
export type MessageParty = ControllerRole | "ALL";

export interface ControllerMessage {
  id: string;
  /** Who sent it - the operator's own role for outbound, the other
   * position's role for an inbound reply. */
  from: MessageParty;
  /** Who it was addressed to - a position, or ALL for a broadcast. */
  to: MessageParty;
  text: string;
  at: number;
  /** Outbound (from the operator) vs inbound (from an AI position). */
  outbound: boolean;
  /** Inbound messages start unread until their thread is viewed. */
  unread: boolean;
}

export interface SendResult {
  ok: boolean;
  message: string;
}

/** How long an AI position takes to answer a coordination message. */
export const REPLY_MS = 1100;
const MAX_LEN = 240;
/** Keep each thread bounded so a long session doesn't grow without end. */
const MAX_PER_THREAD = 200;
/** Minimum gap between unprompted inbound messages from one position, so a
 * burst of handoffs on a busy final doesn't machine-gun the net. Replies
 * the operator asked for (sendMessage) are never rate-limited; only the
 * positions' own self-started coordination is. */
export const INBOUND_MIN_GAP_MS = 8000;

interface PendingReply {
  at: number;
  from: ControllerRole;
  to: ControllerRole;
  text: string;
}

const messages: ControllerMessage[] = [];
const pending: PendingReply[] = [];
let activeThread: MessageParty | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
/** Last time each position started an unprompted message, for rate-limiting. */
const lastInboundAt = new Map<ControllerRole, number>();

const listeners = new Set<() => void>();

export function subscribeMessages(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

function threadKey(m: ControllerMessage): MessageParty {
  // A thread is "the other side": for a broadcast that's ALL, otherwise
  // whichever party isn't the operator.
  if (m.to === "ALL" || m.from === "ALL") return "ALL";
  return m.outbound ? m.to : m.from;
}

/** Every party the operator can coordinate with from a given seat: the
 * other three positions, then the all-call. */
export function parties(self: ControllerRole): MessageParty[] {
  const roles: ControllerRole[] = ["ramp", "ground", "tower", "approach"];
  return [...roles.filter((r) => r !== self), "ALL"];
}

export function partyLabel(party: MessageParty): string {
  return party === "ALL" ? "ALL" : roleLabel(party);
}

/** Parse "APP", "GROUND", "ALL"… into a party, or null. */
export function parseParty(token: string): MessageParty | null {
  const t = token.toUpperCase();
  if (t === "ALL" || t === "ALLCALL" || t === "BROADCAST") return "ALL";
  switch (t) {
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

/** The messages in one thread, oldest first. */
export function thread(party: MessageParty): ControllerMessage[] {
  return messages.filter((m) => threadKey(m) === party);
}

/** Unread inbound count for one thread, or across all threads when no
 * party is given (the DCB badge). */
export function unreadCount(party?: MessageParty): number {
  return messages.filter((m) => m.unread && (party == null || threadKey(m) === party)).length;
}

/** Point the store at the thread the operator is currently reading, so a
 * reply that lands in it is marked read on arrival rather than badging a
 * window that's already open. */
export function setActiveThread(party: MessageParty | null): void {
  activeThread = party;
  if (party) markThreadRead(party);
}

export function markThreadRead(party: MessageParty): void {
  let changed = false;
  for (const m of messages) {
    if (m.unread && threadKey(m) === party) {
      m.unread = false;
      changed = true;
    }
  }
  if (changed) notify();
}

function pushMessage(m: Omit<ControllerMessage, "id">): ControllerMessage {
  const full: ControllerMessage = { ...m, id: `m${++seq}` };
  messages.push(full);
  // Trim this thread if it has run long - drop the oldest, read entries.
  trimThread(m.to === "ALL" || m.from === "ALL" ? "ALL" : m.outbound ? m.to : m.from);
  return full;
}

function trimThread(party: MessageParty) {
  const idxs: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const key = m.to === "ALL" || m.from === "ALL" ? "ALL" : m.outbound ? m.to : m.from;
    if (key === party) idxs.push(i);
  }
  const over = idxs.length - MAX_PER_THREAD;
  if (over <= 0) return;
  // Remove the oldest `over` entries that are already read.
  const toRemove = new Set<number>();
  for (const i of idxs) {
    if (toRemove.size >= over) break;
    if (!messages[i].unread) toRemove.add(i);
  }
  if (toRemove.size === 0) return;
  let w = 0;
  for (let i = 0; i < messages.length; i++) {
    if (!toRemove.has(i)) messages[w++] = messages[i];
  }
  messages.length = w;
}

/** Send a coordination message from the operator's seat to another
 * position (or ALL). A message to a single position gets an AI reply after
 * REPLY_MS; broadcasts are heard but not answered. */
export function sendMessage(self: ControllerRole, to: MessageParty, raw: string): SendResult {
  const text = raw.trim().slice(0, MAX_LEN);
  if (!text) return { ok: false, message: "? MESSAGE REQUIRED" };
  if (to !== "ALL" && to === self) {
    return { ok: false, message: "? CANNOT MESSAGE YOUR OWN POSITION" };
  }

  pushMessage({ from: self, to, text, at: Date.now(), outbound: true, unread: false });

  if (to !== "ALL") {
    pending.push({ at: Date.now() + REPLY_MS, from: to, to: self, text: composeReply(to, text) });
    scheduleTimer();
  }
  notify();
  return { ok: true, message: `MSG → ${partyLabel(to)}: SENT` };
}

function scheduleTimer() {
  if (typeof setTimeout !== "function") return; // non-DOM test paths drive manually
  if (timer != null) return;
  const soonest = pending.reduce((min, p) => Math.min(min, p.at), Infinity);
  if (!Number.isFinite(soonest)) return;
  const delay = Math.max(0, soonest - Date.now());
  timer = setTimeout(() => {
    timer = null;
    deliverDueReplies(Date.now());
    if (pending.length) scheduleTimer();
  }, delay);
}

/** Move any replies whose time has come into the thread. Driven by the
 * internal timer in the app; called directly (with a supplied clock) by
 * the test harness so delivery is deterministic without real timers.
 * Returns how many were delivered. */
export function deliverDueReplies(now: number): number {
  let delivered = 0;
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i];
    if (p.at > now) continue;
    pending.splice(i, 1);
    const unread = activeThread !== p.from;
    pushMessage({ from: p.from, to: p.to, text: p.text, at: now, outbound: false, unread });
    delivered += 1;
  }
  if (delivered) notify();
  return delivered;
}

const CALLSIGN_RE = /\b([A-Z]{2,3}\d{1,4}[A-Z]?)\b/;

/** Compose an AI position's reply to a coordination message. Deterministic
 * by design - the same text always draws the same answer - so the reply
 * language is both believable on a scope and testable. Recognises the
 * coordination intents real controllers key on; anything else gets a plain
 * acknowledgement. */
export function composeReply(from: ControllerRole, text: string): string {
  const t = text.toUpperCase();
  const cs = CALLSIGN_RE.exec(t)?.[1];
  const tag = cs ? `${cs}, ` : "";

  if (/\bRELEASE\b/.test(t)) {
    return /\b(HOLD|NO|UNABLE)\b/.test(t) ? `${tag}holding for release.` : `${tag}released.`;
  }
  if (/\bAPREQ\b|\bREQUEST\b|\bAPPROVED\?|\bOK\b TO\b/.test(t)) {
    return `${tag}approved.`;
  }
  if (/\bPOINT\s?OUT\b|\bPT\b|\bRADAR\b/.test(t)) {
    return `${tag}radar contact.`;
  }
  if (/\bHAND\s?OFF\b|\bHANDOFF\b|\bTAKING\b|\bYOUR CONTROL\b/.test(t)) {
    return `${tag}handoff, radar contact.`;
  }
  if (/\bVERIFY\b|\bCONFIRM\b|\bSAY\b/.test(t)) {
    return `${tag}affirm.`;
  }
  if (/\bTRAFFIC\b|\bCONFLICT\b/.test(t)) {
    return `${tag}no conflict observed.`;
  }
  if (/\bRUNWAY\b|\bRWY\b|\bCONFIG\b|\bFLOW\b/.test(t)) {
    return `${tag}copy, ${roleLabel(from)} using the same.`;
  }
  if (/\bSTANDBY\b|\bWAIT\b|\bBUSY\b/.test(t)) {
    return `${tag}standby.`;
  }
  if (t.includes("?")) {
    return `${tag}affirm.`;
  }
  // Plain acknowledgement - vary deterministically on text length so the
  // net doesn't read as one canned phrase.
  const acks = ["roger.", "copy.", "c."];
  return `${tag}${acks[text.length % acks.length]}`;
}

/** Drop an unprompted coordination message from an AI position onto the
 * operator's seat - the inbound half of a two-way net. Unlike a reply to
 * something the operator sent, these are rate-limited per position so a
 * busy flow doesn't flood the window, and they badge or auto-read on the
 * same rules a reply does (unread unless their thread is already open).
 * Deterministic: pass `now` to drive it from the test harness. Returns the
 * stored message, or null if it was empty or throttled. */
export function receiveMessage(
  self: ControllerRole,
  from: ControllerRole,
  raw: string,
  now: number = Date.now()
): ControllerMessage | null {
  const text = raw.trim().slice(0, MAX_LEN);
  if (!text || from === self) return null;

  const last = lastInboundAt.get(from);
  if (last != null && now - last < INBOUND_MIN_GAP_MS) return null;
  lastInboundAt.set(from, now);

  const unread = activeThread !== from;
  const m = pushMessage({ from, to: self, text, at: now, outbound: false, unread });
  notify();
  return m;
}

/** What - if anything - an AI position says to the operator when an
 * aircraft changes hands. Only handoffs that touch the operator's own seat
 * are coordinated out loud: a position shipping traffic to the operator
 * calls the handoff, and a position taking the operator's traffic answers
 * radar contact. Handoffs between two AI positions aren't on the operator's
 * net, so they stay silent. Deterministic, matching composeReply's tone. */
export function composeHandoffCoordination(
  self: ControllerRole,
  event: { from: ControllerRole; to: ControllerRole },
  callsign: string
): { from: ControllerRole; text: string } | null {
  const cs = CALLSIGN_RE.exec(callsign.toUpperCase())?.[1] ?? callsign;
  if (event.to === self && event.from !== self) {
    // Someone is handing their traffic to the operator.
    return { from: event.from, text: `${cs}, handoff.` };
  }
  if (event.from === self && event.to !== self) {
    // The operator shipped traffic; the gaining position checks it in.
    return { from: event.to, text: `${cs}, radar contact.` };
  }
  return null;
}

/** Test/reset hook - clears all threads and pending replies. */
export function _resetMessaging(): void {
  messages.length = 0;
  pending.length = 0;
  activeThread = null;
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  seq = 0;
  lastInboundAt.clear();
}
