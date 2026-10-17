#!/usr/bin/env node
/**
 * Regression test for the voice intent pipeline's pure logic:
 * the accent/transcription-tolerant callsign matcher (speech.ts), the
 * broadened regex clearance parser (clearanceParser.ts), and the
 * LLM-backed intent resolver (intentParser.ts) - including its graceful
 * fallback to regex when the model is unavailable/unparseable, and its
 * parse of well-formed model output.
 *
 * No test framework and no live Ollama: it compiles the few modules with
 * the project's own tsc into a temp dir, stubs the LLM call with a plain
 * function, and asserts deterministically. Mirrors the style of
 * tools/scope_commands_test.cjs. Run from anywhere:
 *   node tools/intent_parser_test.cjs
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "holdshort-intent-test-"));

const tsc = path.join(root, "node_modules", ".bin", "tsc");
const compile = spawnSync(
  tsc,
  [
    "src/intentParser.ts",
    "src/clearanceParser.ts",
    "src/speech.ts",
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

const parser = require(path.join(outDir, "clearanceParser.js"));
const speech = require(path.join(outDir, "speech.js"));
const intent = require(path.join(outDir, "intentParser.js"));

let failures = 0;
let checks = 0;
function check(name, cond, extra) {
  checks += 1;
  if (cond) return;
  failures += 1;
  console.error(`FAIL  ${name}${extra !== undefined ? `  [${JSON.stringify(extra)}]` : ""}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- Fixtures ----------------------------------------------------------
const ac = (over) => ({
  callsign: "AAL2388",
  aircraft_type: "B738",
  state: "OnApproach",
  rule: "Arrival",
  x: 0, y: 0, heading_deg: 180, ground_speed_kt: 140,
  destination: "KLAX", origin: "KSEA",
  assigned_gate: "", assigned_runway: "",
  is_speaking: false, altitude_ft: 5000,
  assigned_heading_deg: null, assigned_altitude_ft: null, assigned_speed_kt: null,
  cleared_approach: false, owning_role: "approach",
  ...over,
});

const american = ac({ callsign: "AAL2388" });
const united = ac({ callsign: "UAL6806", rule: "Departure", state: "ReadyForTaxi", assigned_gate: "B12" });
const jetblue = ac({ callsign: "JBU19", rule: "Arrival" });
const roster = [american, united, jetblue];
const callsigns = roster.map((a) => a.callsign);

(async () => {
  // --- wordsToDigits normalization --------------------------------------
  check("spelled digits collapse into a run",
    speech.wordsToDigits("heading two seven zero") === "heading 270");
  check("flight level words collapse",
    speech.wordsToDigits("flight level one eight zero") === "flight level 180");
  check("niner maps to 9",
    speech.wordsToDigits("descend to niner thousand") === "descend to 9 thousand");
  check("thousand kept as a word",
    speech.wordsToDigits("climb five thousand") === "climb 5 thousand");

  // --- regex clearance parser (broadened coverage) ----------------------
  check("flight level descent -> feet",
    eq(parser.parseClearance("delta descend and maintain flight level one eight zero"),
       { DescendAndMaintain: { altitude_ft: 18000 } }),
    parser.parseClearance("delta descend and maintain flight level one eight zero"));
  check("spelled heading",
    eq(parser.parseClearance("turn left heading two seven zero"),
       { Vector: { heading_deg: 270 } }));
  check("slow to speed, spelled",
    eq(parser.parseClearance("slow to two five zero"),
       { AssignSpeed: { speed_kt: 250 } }));
  check("climb X thousand still works",
    eq(parser.parseClearance("climb and maintain five thousand"),
       { ClimbAndMaintain: { altitude_ft: 5000 } }));
  check("taxi to gate -> TaxiToGate (gate blank, no gate named)",
    eq(parser.parseClearance("taxi to the gate"),
       { TaxiToGate: { gate_ref: "" } }),
    parser.parseClearance("taxi to the gate"));
  check("taxi to named gate captures the ref",
    eq(parser.parseClearance("taxi to gate b12"),
       { TaxiToGate: { gate_ref: "B12" } }),
    parser.parseClearance("taxi to gate b12"));
  check("plain taxi still -> TaxiToRunway",
    eq(parser.parseClearance("taxi to runway two seven"),
       { TaxiToRunway: { via_hold_short: null } }));
  check("hold still -> HoldPosition",
    parser.parseClearance("hold position") === "HoldPosition");
  check("disregard -> CancelClearance",
    parser.parseClearance("disregard") === "CancelClearance");
  check("no clearance -> null",
    parser.parseClearance("good morning tower lovely weather") === null);

  // --- fuzzy callsign matching ------------------------------------------
  check("exact spoken callsign resolves",
    speech.fuzzyMatchCallsign("american two three eight eight descend", callsigns) === "AAL2388");
  check("accent slip on airline name still resolves (number intact)",
    speech.fuzzyMatchCallsign("americin two three eight eight", callsigns) === "AAL2388",
    speech.fuzzyMatchCallsign("americin two three eight eight", callsigns));
  check("two-word airline resolves (jet blue -> JBU19)",
    speech.fuzzyMatchCallsign("jet blue one nine cleared to land", callsigns) === "JBU19",
    speech.fuzzyMatchCallsign("jet blue one nine cleared to land", callsigns));
  check("wrong airline doesn't false-match",
    speech.fuzzyMatchCallsign("lufthansa four hundred", callsigns) === null,
    speech.fuzzyMatchCallsign("lufthansa four hundred", callsigns));
  check("matchSpokenCallsign falls through to fuzzy",
    speech.matchSpokenCallsign("united six eight oh six pushback", callsigns) === "UAL6806",
    speech.matchSpokenCallsign("united six eight oh six pushback", callsigns));

  // --- LLM response parsing (parseLlmIntent) ----------------------------
  check("parses well-formed model JSON into the union",
    eq(intent.parseLlmIntent(
         '{"callsign":"AAL2388","clearance":{"type":"ClimbAndMaintain","altitude_ft":5000}}', roster),
       { callsign: "AAL2388", clearance: { ClimbAndMaintain: { altitude_ft: 5000 } } }));
  check("parses JSON wrapped in prose / code fence",
    eq(intent.parseLlmIntent(
         'Sure!\n```json\n{"callsign":"UAL6806","clearance":{"type":"PushbackApproved"}}\n```', roster),
       { callsign: "UAL6806", clearance: "PushbackApproved" }));
  check("model naming a fuzzy callsign still resolves",
    eq(intent.parseLlmIntent(
         '{"callsign":"American 2388","clearance":{"type":"GoAround"}}', roster),
       { callsign: "AAL2388", clearance: "GoAround" }));
  check("clearance:none -> null (fall back)",
    intent.parseLlmIntent('{"clearance":"none"}', roster) === null);
  check("unknown type -> null",
    intent.parseLlmIntent('{"callsign":"AAL2388","clearance":{"type":"MakeCoffee"}}', roster) === null);
  check("garbage reply -> null",
    intent.parseLlmIntent("the model said hi", roster) === null);
  check("Vector missing heading -> null",
    intent.parseLlmIntent('{"clearance":{"type":"Vector"}}', roster) === null);

  // --- resolveClearance orchestration -----------------------------------
  // LLM path: a stub returning good JSON is used verbatim.
  const goodLlm = async () =>
    '{"callsign":"AAL2388","clearance":{"type":"DescendAndMaintain","altitude_ft":3000}}';
  let r = await intent.resolveClearance("american descend three thousand", roster, "approach", goodLlm);
  check("LLM path used when available",
    r.source === "llm" && r.callsign === "AAL2388" &&
      eq(r.clearance, { DescendAndMaintain: { altitude_ft: 3000 } }), r);

  // Fallback: LLM throws -> regex parser answers.
  const throwingLlm = async () => { throw new Error("ollama down"); };
  r = await intent.resolveClearance("american two three eight eight turn right heading one eight zero",
      roster, "approach", throwingLlm);
  check("throwing LLM falls back to regex",
    r.source === "regex" && r.callsign === "AAL2388" &&
      eq(r.clearance, { Vector: { heading_deg: 180 } }), r);

  // Fallback: LLM returns unparseable -> regex parser answers.
  const junkLlm = async () => "I think they said something about landing";
  r = await intent.resolveClearance("jet blue one nine cleared to land", roster, "tower", junkLlm);
  check("unparseable LLM falls back to regex",
    r.source === "regex" && r.callsign === "JBU19" && r.clearance === "ClearedToLand", r);

  // Fallback: LLM times out -> regex parser answers (short timeout so the
  // test doesn't actually wait).
  const slowLlm = () => new Promise((resolve) => setTimeout(() => resolve('{"clearance":"none"}'), 1000));
  const t0 = Date.now();
  r = await intent.resolveClearance("united six eight oh six pushback approved", roster, "ramp", slowLlm, 50);
  check("slow LLM times out and falls back to regex",
    r.source === "regex" && r.callsign === "UAL6806" && r.clearance === "PushbackApproved", r);
  check("timeout didn't block for the full LLM duration", Date.now() - t0 < 900);

  // No LLM wired at all -> pure regex, app still works with Ollama off.
  r = await intent.resolveClearance("american two three eight eight climb and maintain flight level one eight zero",
      roster, "approach");
  check("no LLM -> regex path",
    r.source === "regex" && r.callsign === "AAL2388" &&
      eq(r.clearance, { ClimbAndMaintain: { altitude_ft: 18000 } }), r);

  // Gate fill: TaxiToGate with no named gate borrows the aircraft's assigned gate.
  const gateLlm = async () => '{"callsign":"UAL6806","clearance":{"type":"TaxiToGate"}}';
  r = await intent.resolveClearance("united taxi to the gate", roster, "ground", gateLlm);
  check("TaxiToGate fills gate_ref from the aircraft's assigned gate",
    eq(r.clearance, { TaxiToGate: { gate_ref: "B12" } }), r);

  console.log(`${checks - failures}/${checks} checks passed`);
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
