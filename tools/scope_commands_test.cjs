#!/usr/bin/env node
/**
 * Regression test for the scope display architecture's pure logic:
 * the command-line parser, the settings store + pref sets, datablock
 * fidelity, leader geometry and the point-out state machine.
 *
 * No test framework needed - it compiles the few modules involved with
 * the project's own tsc into a temp dir, stubs localStorage, and asserts.
 * Run from anywhere:  node tools/scope_commands_test.js
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "holdshort-scope-test-"));

const tsc = path.join(root, "node_modules", ".bin", "tsc");
const compile = spawnSync(
  tsc,
  [
    "src/scopeCommands.ts",
    "--ignoreConfig",
    "--outDir", outDir,
    "--module", "commonjs",
    "--target", "ES2020",
    "--moduleResolution", "node",
    "--ignoreDeprecations", "6.0",
    "--lib", "ES2020,DOM",
    "--skipLibCheck",
  ],
  { cwd: root, encoding: "utf8" },
);
if (compile.status !== 0) {
  console.error("tsc compile failed:\n" + compile.stdout + compile.stderr);
  process.exit(1);
}

// localStorage stub, installed before any module under test is required.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const sc = require(path.join(outDir, "scopeCommands.js"));
const sd = require(path.join(outDir, "scopeDisplay.js"));
const po = require(path.join(outDir, "pointOuts.js"));
const cm = require(path.join(outDir, "controllerMessaging.js"));

let failures = 0;
let checks = 0;
function check(name, cond, extra) {
  checks += 1;
  if (cond) return;
  failures += 1;
  console.error(`FAIL  ${name}${extra !== undefined ? `  [${JSON.stringify(extra)}]` : ""}`);
}

const ownAc = {
  callsign: "UAL123",
  aircraft_type: "B738",
  state: "OnApproach",
  rule: "Arrival",
  x: 0, y: 0,
  heading_deg: 180,
  ground_speed_kt: 140,
  destination: "KLAX",
  origin: "KSEA",
  assigned_gate: "",
  assigned_runway: "",
  is_speaking: false,
  altitude_ft: 5000,
  assigned_heading_deg: null,
  assigned_altitude_ft: null,
  assigned_speed_kt: null,
  cleared_approach: false,
  owning_role: "approach",
};
const groundAc = {
  ...ownAc,
  callsign: "AAL456",
  state: "TaxiingToRunway",
  altitude_ft: 0,
  owning_role: "ground",
};

const issued = [];
let selected = "UAL123";
const ctx = {
  scope: "approach",
  role: "approach",
  aircraft: [ownAc, groundAc],
  get selectedCallsign() {
    return selected;
  },
  select: (cs) => {
    selected = cs;
  },
  issue: async (callsign, clearance) => {
    issued.push([callsign, clearance]);
  },
};

async function run(line) {
  return sc.runCommand(line, ctx);
}

(async () => {
  // --- Clearance commands against the slewed target ---------------------
  let r = await run("HDG 090");
  check("HDG 090 ok", r.ok, r);
  check(
    "HDG issues Vector 90",
    JSON.stringify(issued.pop()) === JSON.stringify(["UAL123", { Vector: { heading_deg: 90 } }]),
  );

  r = await run("H270");
  check("H270 shorthand ok", r.ok, r);
  check("H270 issues Vector 270", JSON.stringify(issued.pop()) === JSON.stringify(["UAL123", { Vector: { heading_deg: 270 } }]));

  r = await run("A080"); // 5000ft -> climb to 8000
  check("A080 ok", r.ok, r);
  check(
    "A080 (hundreds) issues climb 8000",
    JSON.stringify(issued.pop()) ===
      JSON.stringify(["UAL123", { ClimbAndMaintain: { altitude_ft: 8000 } }]),
  );

  r = await run("ALT 3000"); // below current -> descend
  check("ALT 3000 issues descend", JSON.stringify(issued.pop()) === JSON.stringify(["UAL123", { DescendAndMaintain: { altitude_ft: 3000 } }]), r);

  r = await run("FL180");
  check("FL180 issues climb 18000", JSON.stringify(issued.pop()) === JSON.stringify(["UAL123", { ClimbAndMaintain: { altitude_ft: 18000 } }]), r);

  r = await run("SPD 210");
  check("SPD 210 issues AssignSpeed", JSON.stringify(issued.pop()) === JSON.stringify(["UAL123", { AssignSpeed: { speed_kt: 210 } }]), r);

  r = await run("CA");
  check("CA issues ClearedApproach", JSON.stringify(issued.pop()) === JSON.stringify(["UAL123", "ClearedApproach"]), r);

  // --- Slew-by-callsign -------------------------------------------------
  selected = "UAL123";
  r = await run("AAL456 HDG 120");
  check("leading callsign slews", selected === "AAL456", selected);
  check("then applies to it", JSON.stringify(issued.pop()) === JSON.stringify(["AAL456", { Vector: { heading_deg: 120 } }]), r);
  r = await run("NOPE1 HDG 010");
  check("unknown callsign + command errors", !r.ok, r);
  selected = "UAL123";

  // --- Display commands -------------------------------------------------
  r = await run("DB OFF");
  check("DB OFF", r.ok && sd.getScopeSettings().datablockMode === "none", r);
  r = await run("RINGS ON");
  check("RINGS ON", r.ok && sd.getScopeSettings().rings === true, r);
  r = await run("R 20");
  check("R 20 on approach", r.ok && sd.getScopeSettings().rangeNm === 20, r);
  r = await run("ROT 120");
  check("ROT 120", r.ok && sd.getScopeSettings().rotationDeg === 120, r);

  const smrCtx = { ...ctx, scope: "smr", selectedCallsign: null };
  r = await sc.runCommand("R 20", smrCtx);
  check("R rejected off approach", !r.ok, r);
  r = await sc.runCommand("VIS 12", smrCtx);
  check("VIS rejected off tower", !r.ok, r);

  // --- Leader lines -----------------------------------------------------
  selected = "UAL123";
  r = await run("LEN 24");
  check("LEN 24 ok", r.ok, r);
  check("per-track leader length", sd.getLeaderFor("UAL123").lengthPx === 24, sd.getLeaderFor("UAL123"));
  r = await run("DIR 090");
  check("DIR 090 ok", r.ok && sd.getLeaderFor("UAL123").angleDeg === 90, r);
  r = await run("LEN 99");
  check("LEN out of range rejected", !r.ok, r);
  r = await sc.runCommand("LEN 12", { ...ctx, selectedCallsign: null });
  check("LEN with no slew edits the scope default", r.ok && sd.getScopeSettings().leader.lengthPx === 12, { r, leader: sd.getScopeSettings().leader });
  const up = sd.leaderEnd({ angleDeg: 0, lengthPx: 12 });
  const right = sd.leaderEnd({ angleDeg: 90, lengthPx: 12 });
  check("leader angle 0 points straight up", Math.abs(up.dx) < 1e-9 && Math.abs(up.dy + 12) < 1e-9, up);
  check("leader angle 90 points right", Math.abs(right.dx - 12) < 1e-9 && Math.abs(right.dy) < 1e-9, right);

  // --- Quick Look -------------------------------------------------------
  r = await run("QL GND");
  check("QL GND on", r.ok && sd.getQuickLook() === "ground", r);
  r = await run("QL APP");
  check("QL to own position rejected", !r.ok, r);
  check(
    "Quick Look elevates that position's track to FDB",
    sd.fidelityOf(groundAc, "approach", "approach", sd.getQuickLook()) === "FDB",
  );
  r = await run("QL OFF");
  check("QL off", r.ok && sd.getQuickLook() === null, r);

  // --- Fidelity levels --------------------------------------------------
  check(
    "own track is FDB",
    sd.fidelityOf(ownAc, "approach", "approach", null) === "FDB",
  );
  check(
    "out-of-domain track is LDB on approach",
    sd.fidelityOf(groundAc, "approach", "approach", null) === "LDB",
  );
  check(
    "other position's in-domain track is PDB",
    sd.fidelityOf(groundAc, "smr", "approach", null) === "PDB",
  );
  check(
    "airborne departure is LDB on the SMR",
    sd.fidelityOf({ ...ownAc, state: "Departed", owning_role: "approach" }, "smr", "ground", null) === "LDB",
  );

  // --- Point-outs -------------------------------------------------------
  r = await run("PT TWR");
  check("PT to another position sent", r.ok, r);
  let po1 = po.pointOutFor("UAL123");
  check("pending while waiting", po1 && po1.state === "pending", po1);
  po1.since = Date.now() - 2500; // let the AI position "answer"
  po1 = po.pointOutFor("UAL123");
  check("accepted after delay", po1 && po1.state === "accepted", po1);
  po1.since = Date.now() - 6000; // hold expired
  check("accepted point-out expires", po.pointOutFor("UAL123") === null);

  selected = "AAL456";
  r = await run("PT APP"); // ctx.role is approach -> point-out to self
  check("point-out to own position rejected", !r.ok, r);
  const rej = po.pointOutFor("AAL456");
  check("rejected state recorded", rej && rej.state === "rejected", rej);
  rej.since = Date.now() - 2000;
  check("rejected point-out expires", po.pointOutFor("AAL456") === null);

  selected = "UAL123";
  r = await run("PT GND");
  check("PT to a second position sent", r.ok, r);
  r = await run("PT TWR");
  check("second PT blocked while one is outstanding", !r.ok, r);
  let p = po.pointOutFor("UAL123");
  check("outstanding PT is pending", p && p.state === "pending", p);
  p.since = Date.now() - 2500;
  check("AI position accepts after delay", po.pointOutFor("UAL123").state === "accepted");
  po.pointOutFor("UAL123").since = Date.now() - 6000;
  check("accepted PT expires", po.pointOutFor("UAL123") === null);

  // --- Handoff honesty --------------------------------------------------
  r = await run("HO TWR");
  check("HO explains phase-driven ownership", !r.ok && /PHASE/.test(r.message), r);

  // --- Controller-to-controller messaging -------------------------------
  cm._resetMessaging();

  // parseParty aliases
  check("parseParty GROUND", cm.parseParty("GROUND") === "ground");
  check("parseParty APP", cm.parseParty("app") === "approach");
  check("parseParty ALL", cm.parseParty("ALL") === "ALL");
  check("parseParty junk null", cm.parseParty("XYZ") === null);

  // parties() excludes own seat and ends with ALL
  const seatParties = cm.parties("approach");
  check(
    "parties exclude own seat + end with ALL",
    JSON.stringify(seatParties) === JSON.stringify(["ramp", "ground", "tower", "ALL"]),
    seatParties,
  );

  // composeReply intent recognition (deterministic)
  check("reply: release", cm.composeReply("tower", "UAL123 release?") === "UAL123, released.", cm.composeReply("tower", "UAL123 release?"));
  check("reply: hold for release", cm.composeReply("tower", "hold UAL123 for release") === "UAL123, holding for release.", cm.composeReply("tower", "hold UAL123 for release"));
  check("reply: apreq", cm.composeReply("approach", "AAL456 apreq direct") === "AAL456, approved.", cm.composeReply("approach", "AAL456 apreq direct"));
  check("reply: handoff", cm.composeReply("tower", "handoff AAL456") === "AAL456, handoff, radar contact.", cm.composeReply("tower", "handoff AAL456"));
  check("reply: verify", cm.composeReply("ground", "verify UAL123 at the gate") === "UAL123, affirm.", cm.composeReply("ground", "verify UAL123 at the gate"));
  check("reply: traffic", cm.composeReply("approach", "any traffic for 25R?") === "no conflict observed.", cm.composeReply("approach", "any traffic for 25R?"));
  check("reply: plain ack has no callsign tag", /^(roger\.|copy\.|c\.)$/.test(cm.composeReply("ground", "thanks")), cm.composeReply("ground", "thanks"));

  // sendMessage flow + deterministic reply delivery
  cm._resetMessaging();
  let sres = cm.sendMessage("approach", "tower", "UAL123 release?");
  check("sendMessage ok", sres.ok && /→ TWR/.test(sres.message), sres);
  let twrThread = cm.thread("tower");
  check("outbound stored immediately", twrThread.length === 1 && twrThread[0].outbound === true, twrThread);
  check("no reply before its time", cm.deliverDueReplies(Date.now()) === 0);
  const delivered = cm.deliverDueReplies(Date.now() + cm.REPLY_MS + 10);
  check("reply delivered after REPLY_MS", delivered === 1);
  twrThread = cm.thread("tower");
  check("thread now has the reply", twrThread.length === 2 && twrThread[1].outbound === false, twrThread);
  check("reply text is the composed answer", twrThread[1].text === "UAL123, released.", twrThread[1]);
  check("inbound reply is unread", twrThread[1].unread === true);
  check("unreadCount seat total counts it", cm.unreadCount() === 1, cm.unreadCount());
  check("unreadCount scoped to thread", cm.unreadCount("tower") === 1);
  cm.markThreadRead("tower");
  check("markThreadRead clears unread", cm.unreadCount() === 0);

  // Messaging your own position is refused
  sres = cm.sendMessage("approach", "approach", "hi");
  check("message to own seat rejected", !sres.ok, sres);

  // activeThread marks arriving replies read on sight
  cm._resetMessaging();
  cm.setActiveThread("ground");
  cm.sendMessage("approach", "ground", "AAL456 verify runway");
  cm.deliverDueReplies(Date.now() + cm.REPLY_MS + 10);
  check("reply to active thread lands read", cm.unreadCount() === 0, cm.unreadCount());
  cm.setActiveThread(null);

  // Broadcasts are heard but unanswered
  cm._resetMessaging();
  cm.sendMessage("approach", "ALL", "west flow in effect");
  const before = cm.thread("ALL").length;
  check("broadcast stored on ALL thread", before === 1);
  check("broadcast schedules no reply", cm.deliverDueReplies(Date.now() + cm.REPLY_MS + 10) === 0);

  // MSG via the command line
  cm._resetMessaging();
  r = await run("MSG TWR UAL123 release?");
  check("MSG command ok", r.ok && /SENT/.test(r.message), r);
  check("MSG command stored outbound to TWR", cm.thread("tower").length === 1);
  r = await run("MSG BADPOS hello");
  check("MSG bad position rejected", !r.ok, r);
  r = await run("MSG TWR");
  check("MSG with no text rejected", !r.ok, r);
  r = await run("M ALL west flow");
  check("M alias + ALL broadcast ok", r.ok, r);
  check("M alias stored on ALL thread", cm.thread("ALL").length === 1);
  cm._resetMessaging();

  // --- Inbound coordination (AI positions key up unprompted) ------------
  // composeHandoffCoordination: operator is TOWER here.
  const toTwr = cm.composeHandoffCoordination("tower", { from: "approach", to: "tower" }, "AAL456");
  check("handoff TO operator -> from the shipping position", toTwr && toTwr.from === "approach", toTwr);
  check("handoff TO operator -> calls the handoff", toTwr && toTwr.text === "AAL456, handoff.", toTwr);
  const fromTwr = cm.composeHandoffCoordination("tower", { from: "tower", to: "ground" }, "UAL123");
  check("handoff FROM operator -> from the gaining position", fromTwr && fromTwr.from === "ground", fromTwr);
  check("handoff FROM operator -> gaining position checks in", fromTwr && fromTwr.text === "UAL123, radar contact.", fromTwr);
  check("AI-to-AI handoff is silent", cm.composeHandoffCoordination("tower", { from: "approach", to: "ground" }, "DAL9") === null);

  // receiveMessage stores inbound, badges, and is deterministic.
  cm._resetMessaging();
  const t0 = 1_000_000;
  const inb = cm.receiveMessage("tower", "approach", "AAL456, handoff.", t0);
  check("receiveMessage stores inbound", inb && inb.outbound === false && inb.from === "approach", inb);
  check("inbound lands on the sender's thread", cm.thread("approach").length === 1);
  check("inbound badges when its window is closed", cm.unreadCount("approach") === 1 && cm.unreadCount() === 1);

  // Rate-limit: same position can't key again inside INBOUND_MIN_GAP_MS.
  const throttled = cm.receiveMessage("tower", "approach", "UAL1, handoff.", t0 + cm.INBOUND_MIN_GAP_MS - 1);
  check("inbound from same position is rate-limited", throttled === null && cm.thread("approach").length === 1);
  const afterGap = cm.receiveMessage("tower", "approach", "UAL1, handoff.", t0 + cm.INBOUND_MIN_GAP_MS);
  check("inbound allowed once the gap has passed", afterGap !== null && cm.thread("approach").length === 2);
  // A different position isn't throttled by another's clock.
  const other = cm.receiveMessage("tower", "ground", "DAL9, radar contact.", t0 + 1);
  check("inbound from a different position isn't throttled", other !== null && cm.thread("ground").length === 1);

  // Auto-read: inbound to the open thread lands read, not badged.
  cm._resetMessaging();
  cm.setActiveThread("approach");
  cm.receiveMessage("tower", "approach", "AAL456, handoff.", t0);
  check("inbound to the active thread lands read", cm.unreadCount() === 0, cm.unreadCount());
  cm.setActiveThread(null);

  // Guard: a position never coordinates with itself.
  check("receiveMessage to own seat is dropped", cm.receiveMessage("tower", "tower", "x", t0) === null);
  cm._resetMessaging();

  // --- Pref sets --------------------------------------------------------
  r = await run("PS SAVE ferry");
  check("PS save", r.ok, r);
  await run("DB ALL");
  await run("RINGS OFF");
  r = await run("PS LOAD ferry");
  check("PS load restores datablock mode", r.ok && sd.getScopeSettings().datablockMode === "none", r);
  check("PS load restores rings", sd.getScopeSettings().rings === true, r);
  r = await run("PS LIST");
  check("PS list shows the set", r.ok && /ferry/.test(r.message), r);

  for (let i = 0; i < sd.MAX_PREF_SETS - 1; i++) {
    await run(`PS SAVE slot${i}`);
  }
  r = await run("PS SAVE onemore");
  check("pref set cap enforced at 32", !r.ok && /FULL/.test(r.message), r);

  r = await run("PS DELETE ferry");
  check("PS delete", r.ok, r);

  // --- Misc -------------------------------------------------------------
  r = await run("HELP");
  check("HELP responds", r.ok && r.message.length > 0, r);
  r = await run("WAT 1");
  check("unknown command flagged", !r.ok && r.message.startsWith("? UNKNOWN"), r);
  r = await run("");
  check("empty line silent-fails", !r.ok && r.message === "", r);

  // Legacy TopBar API reads the same store as the DCB.
  sd.setDatablockMode("selected");
  r = await run("DB ALL");
  check("legacy set + command read one store", r.ok && sd.getDatablockMode() === "all", r);

  console.log(`${checks - failures}/${checks} checks passed`);
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});