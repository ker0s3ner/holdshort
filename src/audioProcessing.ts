/**
 * Pure DSP helpers for the voice-capture pipeline (no Tauri / DOM imports, so
 * they compile and run under a plain Node cjs test harness - see
 * tools/audio_processing_test.cjs).
 *
 * Why this exists: whisper decodes 16 kHz mono PCM. The browser mic usually
 * runs at 44.1/48 kHz, and the old pipeline downsampled by *dropping samples*
 * (nearest-neighbour decimation) with no anti-alias filter. That folds all the
 * energy above 8 kHz back down into the speech band as aliasing noise, smearing
 * exactly the high-frequency consonant detail that distinguishes words - which
 * hurts recognition for everyone and especially for accented speech. It also
 * never normalized loudness, so a quiet or distant mic under-drove the decoder.
 * These functions fix both: a properly band-limited resample and a guarded
 * peak normalization.
 */

/**
 * Windowed-sinc (Hamming) low-pass FIR kernel, normalized to unity DC gain.
 * `cutoffHz` is the -6 dB-ish passband edge; `taps` should be odd so the
 * kernel is symmetric about a true center sample (linear phase, no shift).
 */
export function designLowPass(cutoffHz: number, sampleRate: number, taps: number): Float32Array {
  const n = taps % 2 === 0 ? taps + 1 : taps;
  const kernel = new Float32Array(n);
  const fc = cutoffHz / sampleRate; // normalized cutoff (cycles/sample)
  const mid = (n - 1) / 2;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = i - mid;
    // sinc, with the x=0 limit handled explicitly
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    // Hamming window tames the sidelobes so stopband rejection is usable
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
    const v = sinc * w;
    kernel[i] = v;
    sum += v;
  }
  // Normalize so a DC (0 Hz) input passes through unchanged
  for (let i = 0; i < n; i++) kernel[i] /= sum;
  return kernel;
}

/** Convolve `samples` with a symmetric FIR `kernel`, returning a same-length
 * signal (edges handled by clamping to the first/last sample). */
export function applyFir(samples: Float32Array, kernel: Float32Array): Float32Array {
  const n = samples.length;
  const k = kernel.length;
  const mid = (k - 1) >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < k; j++) {
      let idx = i + j - mid;
      if (idx < 0) idx = 0;
      else if (idx >= n) idx = n - 1;
      acc += samples[idx] * kernel[j];
    }
    out[i] = acc;
  }
  return out;
}

/**
 * Resample mono float PCM to 16 kHz with proper anti-aliasing. When
 * downsampling, a low-pass FIR (cutoff just under the 8 kHz output Nyquist)
 * removes the content that would otherwise alias, *then* we read the new grid
 * by linear interpolation so non-integer ratios (e.g. 44100 -> 16000) are
 * handled cleanly. Upsampling needs no anti-alias filter.
 */
export function resampleTo16k(samples: Float32Array, fromRate: number): Float32Array {
  const TARGET = 16000;
  if (fromRate === TARGET || samples.length === 0) return samples;

  let src = samples;
  if (fromRate > TARGET) {
    // Cutoff a touch below the output Nyquist (8 kHz) to leave a transition
    // band; 7200 Hz keeps essentially all speech energy while killing aliases.
    const cutoff = 0.45 * TARGET; // 7200 Hz
    src = applyFir(samples, designLowPass(cutoff, fromRate, 101));
  }

  const ratio = fromRate / TARGET;
  const outLength = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, src.length - 1);
    const frac = pos - i0;
    out[i] = src[i0] * (1 - frac) + src[i1] * frac;
  }
  return out;
}

/** Peak amplitude at or below which a buffer is treated as silence/room noise
 * and left alone - so we never amplify a near-silent clip into loud hiss. A
 * genuine quiet utterance sits well above this. */
const NOISE_FLOOR = 0.004;
/** ~-1 dBFS target so the loudest sample nearly fills the range without
 * clipping on the subsequent int16 encode. */
const TARGET_PEAK = 0.891;
/** Cap the boost so a borderline-silent clip just over the floor can't be
 * multiplied by a huge factor into noise. */
const MAX_GAIN = 40;

/**
 * Peak-normalize float PCM to ~-1 dBFS in place-safe fashion (returns a new
 * buffer). Quiet speech is brought up so whisper decodes it reliably; clips at
 * or below the noise floor are returned unchanged so silence stays silent.
 */
export function normalizePeak(samples: Float32Array): Float32Array {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i] < 0 ? -samples[i] : samples[i];
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs <= NOISE_FLOOR) return samples; // silence guard
  const gain = Math.min(TARGET_PEAK / maxAbs, MAX_GAIN);
  if (gain <= 1.0001 && gain >= 0.9999) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

/**
 * Light one-pole high-pass to strip DC offset and low-frequency rumble
 * (HVAC, mic handling) below ~80 Hz, which carries no speech information but
 * can bias the decoder and waste normalization headroom.
 */
export function highPass(samples: Float32Array, sampleRate: number, cutoffHz = 80): Float32Array {
  if (samples.length === 0) return samples;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  const out = new Float32Array(samples.length);
  let prevIn = samples[0];
  let prevOut = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    prevOut = alpha * (prevOut + x - prevIn);
    out[i] = prevOut;
    prevIn = x;
  }
  return out;
}
