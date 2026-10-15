import { useState } from "react";
import { Modal } from "./Modal";
import {
  getOllamaModel,
  isReadbackEnabled,
  setOllamaModel,
  setReadbackEnabled,
} from "../voiceSettings";

interface Props {
  onClose: () => void;
}

/** Settings is intentionally minimal — the knobs that exist are real,
 * nothing here is decorative. More (units, traffic density) land as the
 * simulation grows. */
export function SettingsModal({ onClose }: Props) {
  const [readback, setReadback] = useState(isReadbackEnabled());
  const [model, setModel] = useState(getOllamaModel());

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings-row">
        <span>Version</span>
        <span className="muted">0.7.0</span>
      </div>
      <div className="settings-row">
        <span>Update channel</span>
        <span className="muted">GitHub Releases (auto-update on launch)</span>
      </div>

      <div className="settings-row">
        <span>AI pilot readback (TTS)</span>
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
      <p className="muted settings-note">
        Readback speech uses your Mac's built-in text-to-speech. If a local{" "}
        <a href="https://ollama.com" target="_blank" rel="noreferrer">
          Ollama
        </a>{" "}
        instance with the model above is running, readbacks are phrased by it; otherwise a
        standard template readback is used instead.
      </p>
      <p className="muted settings-note">
        Speech-to-text (talking to ATC by voice) isn't available yet — macOS's embedded web view
        doesn't support browser speech recognition, so this needs a native audio pipeline, which
        is planned but not built.
      </p>
    </Modal>
  );
}
