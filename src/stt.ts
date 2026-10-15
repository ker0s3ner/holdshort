import { invoke } from "@tauri-apps/api/core";
import { getWhisperModelPath } from "./voiceSettings";

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
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new AudioContext();
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

  stop(): Uint8Array {
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
    const resampled = downsampleTo16k(merged, recordedRate);
    return encodeWav16(resampled, 16000);
  }
}

function downsampleTo16k(samples: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16000) return samples;
  const ratio = fromRate / 16000;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    out[i] = samples[Math.floor(i * ratio)];
  }
  return out;
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

/** Stops the recording and returns whisper.cpp's transcription of it. */
export async function stopListeningAndTranscribe(): Promise<string> {
  if (!active) throw new Error("not recording");
  const wavBytes = active.stop();
  active = null;
  const modelPath = getWhisperModelPath();
  return invoke<string>("transcribe_audio", {
    wavBase64: bytesToBase64(wavBytes),
    modelPath: modelPath || null,
  });
}
