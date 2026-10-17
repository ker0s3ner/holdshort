import { invoke } from "@tauri-apps/api/core";
import { getMicDeviceId, getWhisperModel, getWhisperModelPath } from "./voiceSettings";
import { spellCallsign } from "./speech";
import { resampleTo16k, normalizePeak, highPass } from "./audioProcessing";

/** Records 16-bit PCM mono WAV from the mic using plain Web Audio (not
 * MediaRecorder, whose default codec varies by platform) so the bytes sent
 * to the backend are always a format whisper.cpp understands directly. */
class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = 16000;

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "microphone access isn't available (no navigator.mediaDevices) - this needs the latest Holdshort build"
      );
    }
    const deviceId = getMicDeviceId();
    // Constraints chosen for ASR, not for a phone call:
    // - channelCount:1  whisper wants mono; forcing it avoids a stereo
    //   downmix surprise and halves the data.
    // - autoGainControl:true  the browser rides the mic level up for a quiet
    //   or distant/accented speaker (our own peak-normalize below is a second
    //   safety net, but AGC adapts during the utterance).
    // - echoCancellation:false  there's no loudspeaker loop to cancel for a
    //   push-to-talk mic; AEC only adds nonlinear processing that colors speech.
    // - noiseSuppression:false  DELIBERATE: browser noise suppression is tuned
    //   for telephony intelligibility and tends to gate/scrub the low-energy
    //   consonant and fricative detail that ASR leans on, so it measurably
    //   hurts transcription. We keep the raw signal and clean it ourselves.
    const base: MediaTrackConstraints = {
      channelCount: 1,
      autoGainControl: true,
      echoCancellation: false,
      noiseSuppression: false,
    };
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base,
    });
    // Ask for a 16 kHz context so capture matches whisper's rate with no
    // resampling at all. WKWebView (and most browsers) may ignore this and
    // hand back the hardware rate (usually 48000); we read the real rate back
    // and the anti-aliased resampleTo16k() in stop() handles whatever we got.
    this.ctx = new AudioContext({ sampleRate: 16000 });
    this.sampleRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.processor.onaudioprocess = (e) => {
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
  }

  stop(): { wav: Uint8Array; sampleCount: number } {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    const recordedRate = this.ctx?.sampleRate ?? this.sampleRate;
    this.ctx?.close();

    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    // Clean up the signal in the order that matters: strip DC/rumble, band-limit
    // and resample to 16 kHz with anti-aliasing (the old code decimated with no
    // low-pass, aliasing consonant detail into the speech band), then bring the
    // level up to ~-1 dBFS so a quiet or accented speaker decodes reliably.
    const hp = highPass(merged, recordedRate);
    const resampled = resampleTo16k(hp, recordedRate);
    const normalized = normalizePeak(resampled);
    return { wav: encodeWav16(normalized, 16000), sampleCount: normalized.length };
  }
}

function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

let active: Recorder | null = null;

export function isRecording(): boolean {
  return active !== null;
}

export async function startListening() {
  if (active) return;
  const r = new Recorder();
  await r.start();
  active = r;
}

/** Minimum recording length whisper.cpp can actually decode - a push that's
 * released almost instantly can produce a near-empty WAV (the audio
 * pipeline buffers in ~4096-sample chunks, so a very quick tap can end
 * before a single chunk arrives), which miniaudio rejects outright rather
 * than transcribing as silence. */
const MIN_SAMPLES_16K = 1600; // 0.1s

/** Stops the recording and returns whisper.cpp's transcription of it. The
 * active callsigns are passed through to bias the decoder's initial prompt
 * toward the exact flight identifiers it's about to hear, spelled the way
 * they're spoken on frequency ("American two three eight eight") - a large
 * accuracy win for accented/jargon speech. */
export async function stopListeningAndTranscribe(callsigns: string[] = []): Promise<string> {
  if (!active) throw new Error("not recording");
  const { wav, sampleCount } = active.stop();
  active = null;
  if (sampleCount < MIN_SAMPLES_16K) {
    throw new Error("recording too short - hold the key down a little longer");
  }
  const modelPath = getWhisperModelPath();
  const callsignPrompt = callsigns.map((c) => spellCallsign(c)).join(", ");
  return invoke<string>("transcribe_audio", {
    wavBase64: bytesToBase64(wav),
    modelPath: modelPath || null,
    whisperModel: getWhisperModel(),
    callsignPrompt: callsignPrompt || null,
  });
}
