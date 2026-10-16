import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AirportSummary } from "../types";
import {
  getOllamaModel,
  getWhisperModel,
  OLLAMA_MODELS,
  setOllamaModel,
  setSttEnabled,
  setWhisperModel,
  WHISPER_MODELS,
} from "../voiceSettings";

interface Props {
  onDone: () => void;
}

type Step = "welcome" | "voice" | "regions" | "done";

/** First-run setup: install the speech engine and pick which regions'
 * airports to download, before the launcher shows up. Everything here is
 * optional and can be redone later from Settings / Manage Installed
 * Regions - this just gets a new install out of the box with something
 * more than the single bundled starter airport. */
export function SetupWizard({ onDone }: Props) {
  const [step, setStep] = useState<Step>("welcome");

  return (
    <div className="setup-wizard">
      <div className="setup-card">
        <div className="setup-progress">
          {(["welcome", "voice", "regions", "done"] as Step[]).map((s) => (
            <span key={s} className={s === step ? "setup-dot active" : "setup-dot"} />
          ))}
        </div>
        {step === "welcome" && (
          <WelcomeStep onNext={() => setStep("voice")} onSkip={onDone} />
        )}
        {step === "voice" && (
          <VoiceStep onNext={() => setStep("regions")} onSkip={() => setStep("regions")} />
        )}
        {step === "regions" && (
          <RegionsStep onNext={() => setStep("done")} onSkip={() => setStep("done")} />
        )}
        {step === "done" && <DoneStep onFinish={onDone} />}
      </div>
    </div>
  );
}

function WelcomeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <>
      <h1 className="setup-title">Welcome to Holdshort</h1>
      <p className="setup-body">
        A couple of one-time things before you get to the launcher: setting up local
        speech-to-text (optional) and choosing which regions' airports to download. One
        airport - Burbank (KBUR) - is always available, so none of this is required.
      </p>
      <div className="setup-actions">
        <button className="setup-skip" onClick={onSkip}>
          Skip setup
        </button>
        <button className="setup-primary" onClick={onNext}>
          Get Started
        </button>
      </div>
    </>
  );
}

interface SetupStatus {
  brew_installed: boolean;
  whisper_installed: boolean;
  whisper_model_present: boolean;
  ollama_installed: boolean;
  ollama_model_present: boolean;
}

type Busy =
  | "idle"
  | "installing-whisper"
  | "downloading-model"
  | "installing-ollama"
  | "pulling-model";

function VoiceStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [whisperModel, setWhisperModelState] = useState(getWhisperModel());
  const [ollamaModel, setOllamaModelState] = useState(getOllamaModel());
  const [ollamaCustom, setOllamaCustom] = useState(
    !OLLAMA_MODELS.some((m) => m.id === getOllamaModel())
  );
  const [whisperPercent, setWhisperPercent] = useState<number | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<string | null>(null);

  const refresh = () =>
    invoke<SetupStatus>("check_setup_status", { ollamaModel, whisperModel })
      .then(setStatus)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ollamaModel, whisperModel]);

  useEffect(() => {
    if (status?.whisper_installed && status?.whisper_model_present) {
      setSttEnabled(true);
    }
  }, [status]);

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

  const run = async (busyState: Busy, command: string, args?: Record<string, unknown>) => {
    setBusy(busyState);
    setError(null);
    setWhisperPercent(null);
    setOllamaStatus(null);
    try {
      await invoke(command, args);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("idle");
    }
  };

  const sttReady = !!(status?.whisper_installed && status?.whisper_model_present);
  const aiReady = !!(status?.ollama_installed && status?.ollama_model_present);

  return (
    <>
      <h1 className="setup-title">Voice (optional)</h1>
      <p className="setup-body">
        Both of these run entirely on this Mac, no account needed: <code>whisper.cpp</code> for
        talking to ATC (macOS's web view can't use browser speech recognition), and{" "}
        <a href="https://ollama.com" target="_blank" rel="noreferrer">
          Ollama
        </a>{" "}
        to phrase pilot readbacks naturally instead of a fixed template.
      </p>
      <div className="setup-checklist">
        <div className="setup-check-row">
          <span>{status?.brew_installed ? "✓" : "–"} Homebrew</span>
          {!status?.brew_installed && (
            <a href="https://brew.sh" target="_blank" rel="noreferrer">
              install brew.sh
            </a>
          )}
        </div>
        <div className="setup-check-row">
          <span>{status?.whisper_installed ? "✓" : "–"} whisper.cpp (speech-to-text)</span>
          {!status?.whisper_installed && (
            <button
              disabled={!status?.brew_installed || busy !== "idle"}
              onClick={() => run("installing-whisper", "install_whisper_cpp")}
            >
              {busy === "installing-whisper" ? "Installing…" : "Install"}
            </button>
          )}
        </div>
        <label className="field-label">
          Speech model
          <select
            value={whisperModel}
            disabled={busy !== "idle"}
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
        <div className="setup-check-row">
          <span>
            {status?.whisper_model_present ? "✓" : "–"}{" "}
            {busy === "downloading-model" && whisperPercent != null
              ? `Downloading… ${whisperPercent.toFixed(0)}%`
              : "Downloaded"}
          </span>
          {!status?.whisper_model_present && (
            <button
              disabled={busy !== "idle"}
              onClick={() => run("downloading-model", "download_whisper_model", { model: whisperModel })}
            >
              {busy === "downloading-model" ? `${(whisperPercent ?? 0).toFixed(0)}%` : "Download"}
            </button>
          )}
        </div>
        <div className="setup-check-row">
          <span>{status?.ollama_installed ? "✓" : "–"} Ollama (AI readback)</span>
          {!status?.ollama_installed && (
            <button
              disabled={!status?.brew_installed || busy !== "idle"}
              onClick={() => run("installing-ollama", "install_ollama")}
            >
              {busy === "installing-ollama" ? "Installing…" : "Install"}
            </button>
          )}
        </div>
        <label className="field-label">
          AI model
          <select
            value={ollamaCustom ? "custom" : ollamaModel}
            disabled={busy !== "idle"}
            onChange={(e) => {
              if (e.target.value === "custom") {
                setOllamaCustom(true);
                return;
              }
              setOllamaCustom(false);
              setOllamaModelState(e.target.value);
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
            value={ollamaModel}
            placeholder="e.g. gemma3:12b"
            onChange={(e) => {
              setOllamaModelState(e.target.value);
              setOllamaModel(e.target.value);
            }}
          />
        )}
        <div className="setup-check-row">
          <span>
            {status?.ollama_model_present
              ? "✓ Model downloaded"
              : busy === "pulling-model" && ollamaStatus
                ? ollamaStatus
                : "– Not downloaded"}
          </span>
          {status?.ollama_installed && !status?.ollama_model_present && (
            <button
              disabled={busy !== "idle"}
              onClick={() => run("pulling-model", "pull_ollama_model", { model: ollamaModel })}
            >
              {busy === "pulling-model" ? "Pulling…" : "Pull"}
            </button>
          )}
        </div>
      </div>
      <p className="muted settings-note">
        macOS also needs its own mic permission for push-to-talk - if it ever says "permission
        denied", open{" "}
        <button className="inline-link" onClick={() => invoke("open_microphone_settings")}>
          System Settings → Microphone
        </button>{" "}
        and turn Holdshort on there.
      </p>
      {error && <p className="muted settings-note">⚠ {error}</p>}
      {sttReady && <p className="muted settings-note">Speech-to-text ready - push-to-talk is on.</p>}
      {aiReady && <p className="muted settings-note">AI readback ready.</p>}
      <div className="setup-actions">
        <button className="setup-skip" onClick={onSkip}>
          Skip for now
        </button>
        <button className="setup-primary" onClick={onNext}>
          Continue
        </button>
      </div>
    </>
  );
}

function RegionsStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [catalog, setCatalog] = useState<AirportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    invoke<AirportSummary[]>("list_catalog")
      .then(setCatalog)
      .catch((e) => setError(String(e)));
  }, []);

  const byRegion = useMemo(() => {
    const map = new Map<string, AirportSummary[]>();
    for (const a of catalog ?? []) {
      const region = a.region || "Other";
      const list = map.get(region) ?? [];
      list.push(a);
      map.set(region, list);
    }
    return map;
  }, [catalog]);
  const regions = useMemo(() => Array.from(byRegion.keys()).sort(), [byRegion]);

  const toggle = (region: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  };

  const installSelected = async () => {
    const airports = regions
      .filter((r) => selected.has(r))
      .flatMap((r) => byRegion.get(r) ?? []);
    for (let i = 0; i < airports.length; i++) {
      setProgress(`Installing ${airports[i].icao} (${i + 1}/${airports.length})…`);
      try {
        await invoke("install_airport", { icao: airports[i].icao });
      } catch (e) {
        setError(String(e));
      }
    }
    setProgress(null);
    onNext();
  };

  return (
    <>
      <h1 className="setup-title">Choose your regions</h1>
      <p className="setup-body">
        Airport surface data is downloaded, not bundled - installing everything would be huge.
        Pick the regions you want to fly now; add or remove more anytime from "Manage Installed
        Regions".
      </p>
      {error && <p className="muted settings-note">⚠ {error}</p>}
      {!catalog && !error && <p className="muted settings-note">Loading catalog…</p>}
      <div className="setup-region-grid">
        {regions.map((region) => (
          <label key={region} className="setup-region-option">
            <input
              type="checkbox"
              checked={selected.has(region)}
              onChange={() => toggle(region)}
            />
            {region} ({byRegion.get(region)?.length})
          </label>
        ))}
      </div>
      {progress && <p className="muted settings-note">{progress}</p>}
      <div className="setup-actions">
        <button className="setup-skip" onClick={onSkip} disabled={!!progress}>
          Skip for now
        </button>
        <button
          className="setup-primary"
          onClick={installSelected}
          disabled={!!progress || selected.size === 0}
        >
          {progress ? "Installing…" : `Install ${selected.size || ""} region(s)`}
        </button>
      </div>
    </>
  );
}

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <>
      <h1 className="setup-title">All set</h1>
      <p className="setup-body">
        You can change any of this later from Settings or Manage Installed Regions in the
        launcher.
      </p>
      <div className="setup-actions">
        <button className="setup-primary" onClick={onFinish}>
          Enter Holdshort
        </button>
      </div>
    </>
  );
}
