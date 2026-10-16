import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Modal } from "./Modal";
import { isRealisticVoice } from "../speech";
import {
  getMicDeviceId,
  getOllamaModel,
  getPttKey,
  getTtsRate,
  getTtsVoiceName,
  getWhisperModel,
  getWhisperModelPath,
  isReadbackEnabled,
  isSttEnabled,
  OLLAMA_MODELS,
  setMicDeviceId,
  setOllamaModel,
  setPttKey,
  setReadbackEnabled,
  setSttEnabled,
  setTtsRate,
  setTtsVoiceName,
  setWhisperModel,
  setWhisperModelPath,
  WHISPER_MODELS,
} from "../voiceSettings";
import { getTheme, setTheme, type Theme } from "../themeSettings";
import { AVAILABLE_PLUGINS, isPluginEnabled, setPluginEnabled } from "../pluginSettings";

interface Props {
  onClose: () => void;
  onRerunSetup: () => void;
}

type Tab = "general" | "voice" | "themes" | "plugins";

/** Settings is intentionally minimal — the knobs that exist are real,
 * nothing here is decorative. Tabbed instead of one long scroll once it
 * grew past the voice section. */
export function SettingsModal({ onClose, onRerunSetup }: Props) {
  const [tab, setTab] = useState<Tab>("general");

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings-tabs">
        {(["general", "voice", "themes", "plugins"] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? "settings-tab active" : "settings-tab"}
            onClick={() => setTab(t)}
          >
            {t === "general" ? "General" : t === "voice" ? "Voice" : t === "themes" ? "Themes" : "Plugins"}
          </button>
        ))}
      </div>
      {tab === "general" && <GeneralTab onRerunSetup={onRerunSetup} />}
      {tab === "voice" && <VoiceTab />}
      {tab === "themes" && <ThemesTab />}
      {tab === "plugins" && <PluginsTab />}
    </Modal>
  );
}

function GeneralTab({ onRerunSetup }: { onRerunSetup: () => void }) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <div className="settings-panel">
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
    </div>
  );
}

function VoiceTab() {
  const [readback, setReadback] = useState(isReadbackEnabled());
  const [model, setModel] = useState(getOllamaModel());
  const [ollamaCustom, setOllamaCustom] = useState(!OLLAMA_MODELS.some((m) => m.id === getOllamaModel()));
  const [ttsVoice, setTtsVoice] = useState(getTtsVoiceName());
  const [ttsRate, setTtsRateState] = useState(getTtsRate());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [sttEnabled, setSttEnabledState] = useState(isSttEnabled());
  const [whisperModelPath, setWhisperModelPathState] = useState(getWhisperModelPath());
  const [whisperModel, setWhisperModelState] = useState(getWhisperModel());
  const [micDeviceId, setMicDeviceIdState] = useState(getMicDeviceId());
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [pttKey, setPttKeyState] = useState(getPttKey());
  const [recordingKey, setRecordingKey] = useState(false);
  const [micResetState, setMicResetState] = useState<"idle" | "resetting" | "done">("idle");
  const [whisperPresent, setWhisperPresent] = useState<boolean | null>(null);
  const [ollamaPresent, setOllamaPresent] = useState<boolean | null>(null);
  const [whisperBusy, setWhisperBusy] = useState(false);
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [whisperPercent, setWhisperPercent] = useState<number | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<string | null>(null);
  const [whisperError, setWhisperError] = useState<string | null>(null);
  const [ollamaError, setOllamaError] = useState<string | null>(null);

  const refreshStatus = () =>
    invoke<{ whisper_model_present: boolean; ollama_model_present: boolean }>(
      "check_setup_status",
      { ollamaModel: model, whisperModel }
    )
      .then((s) => {
        setWhisperPresent(s.whisper_model_present);
        setOllamaPresent(s.ollama_model_present);
      })
      .catch(() => {});

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter(isRealisticVoice));
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => setMicDevices(devices.filter((d) => d.kind === "audioinput")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, whisperModel]);

  useEffect(() => {
    const un1 = listen<{ percent: number }>("whisper-download-progress", (e) => {
      setWhisperPercent(e.payload.percent);
    });
    const un2 = listen<{ status: string; percent: number | null }>("ollama-pull-progress", (e) => {
      const p = e.payload.percent;
      setOllamaStatus(p != null ? `${e.payload.status} ${p.toFixed(0)}%` : e.payload.status);
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, []);

  const downloadWhisperModel = async () => {
    setWhisperBusy(true);
    setWhisperPercent(0);
    setWhisperError(null);
    try {
      await invoke("download_whisper_model", { model: whisperModel });
      await refreshStatus();
    } catch (e) {
      setWhisperError(String(e));
    } finally {
      setWhisperBusy(false);
    }
  };

  const pullOllamaModel = async () => {
    setOllamaBusy(true);
    setOllamaStatus(null);
    setOllamaError(null);
    try {
      await invoke("pull_ollama_model", { model });
      await refreshStatus();
    } catch (e) {
      setOllamaError(String(e));
    } finally {
      setOllamaBusy(false);
    }
  };

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
    <div className="settings-panel">
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
        <select
          value={ollamaCustom ? "custom" : model}
          disabled={ollamaBusy}
          onChange={(e) => {
            if (e.target.value === "custom") {
              setOllamaCustom(true);
              return;
            }
            setOllamaCustom(false);
            setModel(e.target.value);
            setOllamaModel(e.target.value);
          }}
        >
          {OLLAMA_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {ollamaCustom && (
        <input
          type="text"
          value={model}
          placeholder="e.g. gemma3:12b"
          onChange={(e) => {
            setModel(e.target.value);
            setOllamaModel(e.target.value);
          }}
        />
      )}
      <div className="settings-row">
        <span>
          {ollamaPresent
            ? "✓ Model downloaded"
            : ollamaBusy && ollamaStatus
              ? ollamaStatus
              : "– Not downloaded"}
        </span>
        {!ollamaPresent && (
          <button disabled={ollamaBusy} onClick={pullOllamaModel}>
            {ollamaBusy ? "Pulling…" : "Pull"}
          </button>
        )}
      </div>
      {ollamaError && <p className="muted settings-note">⚠ {ollamaError}</p>}
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
            <option key={`${v.name}-${v.lang}`} value={v.name}>
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
        <span>Enable push-to-talk</span>
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
        <button onClick={() => invoke("open_microphone_settings")}>Open System Settings</button>
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
        Holdshort (⌘Q, not just closing the window) and reopen it.
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
        Speech model
        <select
          value={whisperModel}
          disabled={whisperBusy}
          onChange={(e) => {
            setWhisperModelState(e.target.value);
            setWhisperModel(e.target.value);
          }}
        >
          {WHISPER_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <div className="settings-row">
        <span>
          {whisperPresent
            ? "✓ Downloaded"
            : whisperBusy && whisperPercent != null
              ? `Downloading… ${whisperPercent.toFixed(0)}%`
              : "– Not downloaded"}
        </span>
        {!whisperPresent && (
          <button disabled={whisperBusy} onClick={downloadWhisperModel}>
            {whisperBusy ? `${(whisperPercent ?? 0).toFixed(0)}%` : "Download"}
          </button>
        )}
      </div>
      {whisperError && <p className="muted settings-note">⚠ {whisperError}</p>}
      <label className="field-label">
        Whisper model path (optional override - skips the picker above entirely)
        <input
          type="text"
          placeholder="~/.cache/whisper/ggml-small.en.bin"
          value={whisperModelPath}
          onChange={(e) => {
            setWhisperModelPathState(e.target.value);
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
        . Install it with <code>brew install whisper-cpp</code>, then pick a model size above and
        download it, or manually, e.g.{" "}
        <code>
          mkdir -p ~/.cache/whisper &amp;&amp; curl -L -o ~/.cache/whisper/ggml-small.en.bin
          https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
        </code>
        . Once enabled, hold the mic button in the clearance panel or the push-to-talk key above
        to talk - it tries to match what you say to a clearance (e.g. "cleared for takeoff") and
        issues it to the selected aircraft. Keyword matching, not a real language model, so stick
        close to the actual phrase.
      </p>
    </div>
  );
}

const THEME_INFO: { id: Theme; name: string; note: string }[] = [
  { id: "holdshort", name: "Holdshort", note: "The original dark green look." },
  {
    id: "crc",
    name: "CRC-inspired",
    note: "Dark neutral grey with a cyan accent, in the spirit of VATSIM's CRC client - not a pixel-exact copy.",
  },
  {
    id: "euroscope",
    name: "EuroScope-inspired",
    note: "Near-black with phosphor green, in the spirit of EuroScope's classic radar scope look - not a pixel-exact copy.",
  },
];

function ThemesTab() {
  const [theme, setThemeState] = useState<Theme>(getTheme());

  return (
    <div className="settings-panel">
      <p className="panel-subheader">App theme</p>
      <div className="theme-grid">
        {THEME_INFO.map((t) => (
          <button
            key={t.id}
            className={theme === t.id ? "theme-option active" : "theme-option"}
            onClick={() => {
              setThemeState(t.id);
              setTheme(t.id);
            }}
          >
            <span className={`theme-swatch theme-swatch-${t.id}`} />
            <span className="theme-option-name">{t.name}</span>
          </button>
        ))}
      </div>
      <p className="muted settings-note">
        {THEME_INFO.find((t) => t.id === theme)?.note}
      </p>
      <p className="muted settings-note">
        Themes recolor the app's own chrome - top bar, panels, buttons. The SMR and Tower Cab
        surface displays have their own fixed rendering colors for now and aren't themed yet.
      </p>
    </div>
  );
}

function PluginsTab() {
  const [, forceRender] = useState(0);

  return (
    <div className="settings-panel">
      <p className="panel-subheader">Plugins</p>
      {AVAILABLE_PLUGINS.map((p) => (
        <div key={p.id} className="plugin-row">
          <div className="plugin-row-header">
            <span className="plugin-name">{p.name}</span>
            <input
              type="checkbox"
              checked={isPluginEnabled(p.id)}
              onChange={(e) => {
                setPluginEnabled(p.id, e.target.checked);
                forceRender((n) => n + 1);
              }}
            />
          </div>
          <p className="muted plugin-description">{p.description}</p>
        </div>
      ))}
      <p className="muted settings-note">
        There's no sandboxed runtime for loading third-party plugin code yet - that's real
        engineering work (safely running code you didn't write). This list is the built-in set
        for now, using the same enable/disable pattern a community plugin system would use, so
        enabled plugins show up as a button in the top bar during a session.
      </p>
    </div>
  );
}
