import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AirportSummary } from "../types";
import { setSttEnabled } from "../voiceSettings";

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
}

function VoiceStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState<"idle" | "installing" | "downloading">("idle");
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    invoke<SetupStatus>("check_setup_status")
      .then(setStatus)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (status?.whisper_installed && status?.whisper_model_present) {
      setSttEnabled(true);
    }
  }, [status]);

  const installWhisper = async () => {
    setBusy("installing");
    setError(null);
    try {
      await invoke("install_whisper_cpp");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("idle");
    }
  };

  const downloadModel = async () => {
    setBusy("downloading");
    setError(null);
    try {
      await invoke("download_whisper_model");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("idle");
    }
  };

  const ready = !!(status?.whisper_installed && status?.whisper_model_present);

  return (
    <>
      <h1 className="setup-title">Speech-to-text (optional)</h1>
      <p className="setup-body">
        macOS's embedded web view can't use browser speech recognition, so talking to ATC uses a
        real local engine - <code>whisper.cpp</code> - instead. It runs entirely on this Mac, no
        account or internet needed once set up.
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
          <span>{status?.whisper_installed ? "✓" : "–"} whisper.cpp</span>
          {!status?.whisper_installed && (
            <button disabled={!status?.brew_installed || busy !== "idle"} onClick={installWhisper}>
              {busy === "installing" ? "Installing…" : "Install"}
            </button>
          )}
        </div>
        <div className="setup-check-row">
          <span>{status?.whisper_model_present ? "✓" : "–"} Speech model (~140MB)</span>
          {!status?.whisper_model_present && (
            <button disabled={busy !== "idle"} onClick={downloadModel}>
              {busy === "downloading" ? "Downloading…" : "Download"}
            </button>
          )}
        </div>
      </div>
      {error && <p className="muted settings-note">⚠ {error}</p>}
      {ready && <p className="muted settings-note">Ready - push-to-talk is now on.</p>}
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
