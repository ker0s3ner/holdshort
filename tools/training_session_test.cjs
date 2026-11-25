#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "holdshort-training-test-"));
const compile = spawnSync(path.join(root, "node_modules", ".bin", "tsc"), [
  "src/trainingSession.ts", "src/types.ts", "--ignoreConfig", "--outDir", outDir,
  "--module", "commonjs", "--target", "ES2020", "--moduleResolution", "node",
  "--ignoreDeprecations", "6.0", "--lib", "ES2020,DOM", "--skipLibCheck",
], { cwd: root, encoding: "utf8" });
if (compile.status !== 0) {
  console.error(compile.stdout + compile.stderr);
  process.exit(1);
}

const { buildTrainingReport, scenarioObjectives } = require(path.join(outDir, "trainingSession.js"));
const event = { id: 1, clock_s: 20, kind: "runway_conflict", callsigns: ["AAL1", "UAL2"], message: "conflict", severity: 3 };
const report = buildTrainingReport("KBUR", "tower", "tower-runway-surge", 120, [event], [
  { at: 10, callsign: "AAL1", clearance: "ClearedForTakeoff", accepted: true },
  { at: 11, callsign: "UAL2", clearance: "ClearedForTakeoff", accepted: false },
], [{ clock_s: 0, aircraft: [] }]);

if (report.score.safety !== 64) throw new Error(`unexpected safety score: ${report.score.safety}`);
if (report.score.discipline !== 92) throw new Error(`unexpected discipline score: ${report.score.discipline}`);
if (report.score.overall !== 63) throw new Error(`unexpected overall score: ${report.score.overall}`);
if (report.checkpoints.length !== 1 || report.events.length !== 1) throw new Error("report did not preserve raw session data");
if (!scenarioObjectives("tower-runway-surge", [], [
  { at: 1, callsign: "AAL1", clearance: "HoldPosition", accepted: true },
  { at: 2, callsign: "AAL2", clearance: "HoldPosition", accepted: true },
  { at: 3, callsign: "AAL3", clearance: "HoldPosition", accepted: true },
  { at: 4, callsign: "AAL4", clearance: "HoldPosition", accepted: true },
  { at: 5, callsign: "AAL5", clearance: "HoldPosition", accepted: true },
]).every((objective) => objective.completed)) throw new Error("scenario objectives did not complete");
console.log("training_session_test: passed");
fs.rmSync(outDir, { recursive: true, force: true });
