import { Modal } from "./Modal";

interface Props {
  onClose: () => void;
}

/** Settings is intentionally minimal for now — the knobs that exist are
 * real, nothing here is decorative. More (units, traffic density, audio)
 * land as the simulation grows. */
export function SettingsModal({ onClose }: Props) {
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings-row">
        <span>Version</span>
        <span className="muted">0.1.0</span>
      </div>
      <div className="settings-row">
        <span>Update channel</span>
        <span className="muted">GitHub Releases (auto-update on launch)</span>
      </div>
      <p className="muted settings-note">
        Traffic density, units, and audio settings are coming in a future update.
      </p>
    </Modal>
  );
}
