import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import {
  getMicDeviceId,
  getOllamaModel,
  getPttKey,
  getTtsRate,
  getTtsVoiceName,
  getWhisperModelPath,
  isReadbackEnabled,
  isSttEnabled,
  setMicDeviceId,
  setOllamaModel,
  setPttKey,
  setReadbackEnabled,
  setSttEnabled,
  setTtsRate,
  setTtsVoiceName,
  setWhisperModelPath,
} from "../voiceSettings";

interface Props {
  onClose: () => void;
  onRerunSetup: () => void;
}

/** Settings is intentionally minimal — the knobs that exist are real,
 * nothing here is decorative. More (units, traffic density) land as the
 * simulation grows. */
export function SettingsModal({ onClose, onRerunSetup }: Props) {
  const [readback, setReadback] = useState(isReadbackEnabled());
  const [model, setModel] = useState(getOllamaModel());
  const [ttsVoice, setTtsVoice] = useState(getTtsVoiceName());
  const [ttsRate, setTtsRateState] = useState(getTtsRate());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [sttEnabled, setSttEnabledState] = useState(isSttEnabled());
  const [whisperModel, setWhisperModelState] = useState(getWhisperModelPath());
  const [micDeviceId, setMicDeviceIdState] = useState(getMicDeviceId());
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [pttKey, setPttKeyState] = useState(getPttKey());
  const [recordingKey, setRecordingKey] = useState(false);
  const [version, setVersion] = useState("");
  const [micResetState, setMicResetState] = useState<"idle" | "resetting" | "done">("idle");

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => setMicDevices(devices.filter((d) => d.kind === "audioinput")))
      .catch(() => {});
  }, []);

  const startKeyCapture = () => {
    setRecordingKey(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      window.removeEventListener("keydown", onKey, true);
      setRecordingKey(false);
      if (e.code === "Escape") return;
      setPttKeyState(e.code);
      setPttKey(e.code);
    };
    window.addEventListener("keydown", onKey, true);
  };

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings-row">
        <span>Version</span>
        <span className="muted">{version || "…"}</span>
      </div>
      <div className="settings-row">
        <span>Update channel</span>
        <span className="muted">GitHub Releases (auto-update on launch)</span>
      </div>
      <div className="settings-row">
        <span>First-time setup (voice engine + regions)</span>
        <button onClick={onRerunSetup}>Run again</button>
      </div>

      <p className="panel-subheader">Text-to-speech (pilot readbacks)</p>
      <div className="settings-row">
        <span>AI pilot readback</span>
        <input
          type="checkbox"
          checked={readback}
          onChange={(e) => {
            setReadback(e.target.checked);
            setReadbackEnabled(e.target.checked);
          }}
        />
      </div>
      <label className="field-label">
        Ollama model (for readback phrasing)
        <input
          type="text"
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setOllamaModel(e.target.value);
          }}
        />
      </label>
      <label className="field-label">
        Voice
        <select
          value={ttsVoice}
          onChange={(e) => {
            setTtsVoice(e.target.value);
            setTtsVoiceName(e.target.value);
          }}
        >
          <option value="">System default</option>
          {voices.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        Speech rate ({ttsRate.toFixed(2)}x)
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={ttsRate}
          onChange={(e) => {
            const rate = Number(e.target.value);
            setTtsRateState(rate);
            setTtsRate(rate);
          }}
        />
      </label>
      <p className="muted settings-note">
        Readback speech uses your Mac's built-in text-to-speech. If a local{" "}
        <a href="https://ollama.com" target="_blank" rel="noreferrer">
          Ollama
        </a>{" "}
        instance with the model above is running, readbacks are phrased by it; otherwise a
        standard template readback is used instead. Output device isn't selectable here - the
        web view can't redirect system speech audio, so use macOS's own Sound settings for that.
      </p>

      <p className="panel-subheader">Speech-to-text (talking to ATC)</p>
      <div className="settings-row">
        <span>Enable push-to-talk (experimental)</span>
        <input
          type="checkbox"
          checked={sttEnabled}
          onChange={(e) => {
            setSttEnabledState(e.target.checked);
            setSttEnabled(e.target.checked);
          }}
        />
      </div>
      <div className="settings-row">
        <span>Microphone access</span>
        <button onClick={() => invoke("open_microphone_settings")}>
          Open System Settings
        </button>
      </div>
      <div className="settings-row">
        <span>Holdshort not listed there at all?</span>
        <button
          disabled={micResetState === "resetting"}
          onClick={async () => {
            setMicResetState("resetting");
            try {
              await invoke("reset_microphone_permission");
              setMicResetState("done");
            } catch (e) {
              setMicResetState("idle");
              alert(`Couldn't reset: ${e}`);
            }
          }}
        >
          {micResetState === "resetting"
            ? "Resetting…"
            : micResetState === "done"
              ? "Done - now quit & reopen"
              : "Reset Permission"}
        </button>
      </div>
      <p className="muted settings-note">
        If push-to-talk says "permission denied" or Holdshort simply isn't in the Microphone list
        in System Settings at all, that's a known quirk of this app not being signed with a paid
        Apple Developer certificate - macOS can end up with a stuck, invisible denial that never
        shows up to toggle back on. "Reset Permission" clears that. After it finishes, fully quit
        Holdshort (⌘Q, not just closing the window) and reopen it - the next time push-to-talk
        runs, macOS should prompt for mic access like a first launch.
      </p>
      <label className="field-label">
        Input device
        <select
          value={micDeviceId}
          onChange={(e) => {
            setMicDeviceIdState(e.target.value);
            setMicDeviceId(e.target.value);
          }}
        >
          <option value="">System default</option>
          {micDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Microphone"}
            </option>
          ))}
        </select>
      </label>
      <div className="settings-row">
        <span>Push-to-talk key</span>
        <button onClick={startKeyCapture} disabled={recordingKey}>
          {recordingKey ? "Press a key…" : pttKey || "(none set)"}
        </button>
      </div>
      <label className="field-label">
        Whisper model path (optional override)
        <input
          type="text"
          placeholder="~/.cache/whisper/ggml-base.en.bin"
          value={whisperModel}
          onChange={(e) => {
            setWhisperModelState(e.target.value);
            setWhisperModelPath(e.target.value);
          }}
        />
      </label>
      <p className="muted settings-note">
        macOS's embedded web view can't run browser speech recognition, so this uses a real local
        engine instead:{" "}
        <a href="https://github.com/ggml-org/whisper.cpp" target="_blank" rel="noreferrer">
          whisper.cpp
        </a>
        . Install it with <code>brew install whisper-cpp</code>, then download a model, e.g.{" "}
        <code>
          mkdir -p ~/.cache/whisper &amp;&amp; curl -L -o ~/.cache/whisper/ggml-base.en.bin
          https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
        </code>
        . Once enabled, hold the mic button in the clearance panel or the push-to-talk key above
        to talk - what it hears shows up as text, it isn't parsed into clearances yet.
      </p>
    </Modal>
  );
}
