#!/usr/bin/env node
/**
 * Regression test for the voice-capture DSP (src/audioProcessing.ts): the
 * anti-aliased resample and the guarded peak normalization that feed whisper.
 * These are the fixes for accented speech decoding badly - the old pipeline
 * decimated with no low-pass (aliasing consonant detail) and never normalized
 * loudness.
 *
 * No test framework: compile the pure module with the project's own tsc into a
 * temp dir and assert against synthetic buffers. Mirrors
 * tools/intent_parser_test.cjs. Run from anywhere:
 *   node tools/audio_processing_test.cjs
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "holdshort-audio-test-"));

const tsc = path.join(root, "node_modules", ".bin", "tsc");
const compile = spawnSync(
  tsc,
  [
    "src/audioProcessing.ts",
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

const dsp = require(path.join(outDir, "audioProcessing.js"));

let failures = 0;
let checks = 0;
function check(name, cond, extra) {
  checks += 1;
  if (cond) return;
  failures += 1;
  console.error(`FAIL  ${name}${extra !== undefined ? `  [${JSON.stringify(extra)}]` : ""}`);
}

/** Generate `durationS` seconds of a sine at `freq` Hz / `rate` Hz, amp in [0,1]. */
function tone(freq, rate, durationS, amp = 0.9) {
  const n = Math.floor(rate * durationS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

/** Peak absolute amplitude, ignoring filter edge transients. */
function peak(samples, skip = 400) {
  let m = 0;
  for (let i = skip; i < samples.length - skip; i++) {
    const a = Math.abs(samples[i]);
    if (a > m) m = a;
  }
  return m;
}

// --- Resample anti-aliasing -------------------------------------------------
// A 1 kHz tone is well inside the 8 kHz output band and must survive the
// 48k->16k resample close to its original amplitude.
{
  const pass = resampleAmp(1000, 48000);
  check("1kHz passes the resample", pass > 0.8, pass);
}
// A 10 kHz tone is above the 8 kHz output Nyquist. The OLD nearest-neighbour
// decimation would alias it down into the audible band at near-full amplitude;
// the anti-alias low-pass must crush it instead.
{
  const alias = resampleAmp(10000, 48000);
  check("10kHz is attenuated by the resample (anti-alias)", alias < 0.1, alias);
}
// And a frequency just above Nyquist (common 44.1k capture) must also be killed.
{
  const alias = resampleAmp(9000, 44100);
  check("9kHz@44.1k is attenuated", alias < 0.15, alias);
}

function resampleAmp(freq, rate) {
  const out = dsp.resampleTo16k(tone(freq, rate, 0.25), rate);
  return peak(out);
}

// resampleTo16k is a no-op at 16k and must not change length/values materially.
{
  const sig = tone(1000, 16000, 0.1);
  const out = dsp.resampleTo16k(sig, 16000);
  check("16k input is passed through unchanged", out === sig || out.length === sig.length, out.length);
}

// Output length tracks the resample ratio (48k/16k = 3x shorter).
{
  const sig = tone(1000, 48000, 0.3);
  const out = dsp.resampleTo16k(sig, 48000);
  const expected = Math.floor(sig.length / 3);
  check("48k->16k output length ~ /3", Math.abs(out.length - expected) <= 1, {
    got: out.length,
    expected,
  });
}

// --- Peak normalization -----------------------------------------------------
// A quiet utterance (peak ~0.05) must be boosted up toward ~-1 dBFS (~0.89).
{
  const quiet = tone(300, 16000, 0.2, 0.05);
  const out = dsp.normalizePeak(quiet);
  const p = peak(out, 0);
  check("quiet speech is boosted toward -1 dBFS", p > 0.8 && p <= 0.9, p);
}
// Near-silence (tiny noise under the floor) must NOT be amplified into hiss.
{
  const n = 16000;
  const silence = new Float32Array(n);
  for (let i = 0; i < n; i++) silence[i] = (Math.random() - 0.5) * 2 * 0.001; // ~0.001 peak
  const out = dsp.normalizePeak(silence);
  check("near-silence is left alone (no noise blow-up)", peak(out, 0) < 0.01, peak(out, 0));
}
// All-zero buffer stays zero (no divide-by-zero, no NaN).
{
  const z = new Float32Array(1000);
  const out = dsp.normalizePeak(z);
  let ok = true;
  for (let i = 0; i < out.length; i++) if (out[i] !== 0) ok = false;
  check("all-zero buffer stays zero", ok);
}
// An already-hot buffer isn't pushed past 1.0 (no added clipping).
{
  const hot = tone(300, 16000, 0.2, 0.95);
  const out = dsp.normalizePeak(hot);
  check("hot buffer is not amplified past full scale", peak(out, 0) <= 1.0, peak(out, 0));
}

// --- High-pass --------------------------------------------------------------
// A DC offset must be removed; a 300 Hz tone riding on it must survive.
{
  const n = 16000;
  const sig = new Float32Array(n);
  for (let i = 0; i < n; i++) sig[i] = 0.5 + 0.3 * Math.sin((2 * Math.PI * 300 * i) / 16000);
  const out = dsp.highPass(sig, 16000);
  let mean = 0;
  for (let i = 2000; i < n; i++) mean += out[i];
  mean /= n - 2000;
  check("high-pass removes DC offset", Math.abs(mean) < 0.02, mean);
  check("high-pass keeps 300Hz speech energy", peak(out) > 0.2, peak(out));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED of ${checks}.`);
  process.exit(1);
}
console.log(`audio_processing_test: ${checks}/${checks} checks passed.`);
