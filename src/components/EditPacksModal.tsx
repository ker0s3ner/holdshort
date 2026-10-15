import { Modal } from "./Modal";
import type { AirportSummary } from "../types";

interface Props {
  airports: AirportSummary[];
  onClose: () => void;
}

/** Read-only for now: lists the installed airport packs and where their
 * source data comes from. A real editor (adjusting gates, taxi routes,
 * adding custom airports) is a planned follow-up, not faked here. */
export function EditPacksModal({ airports, onClose }: Props) {
  return (
    <Modal title="Airport packs" onClose={onClose}>
      <p className="muted settings-note">
        Packs are generated from real-world OpenStreetMap surface data via{" "}
        <code>tools/convert_airport.py</code>. Editing taxi routes and gates in-app is planned
        but not built yet — for now, re-run the converter with adjusted bounds to refresh a pack.
      </p>
      <div className="pack-list">
        {airports.map((a) => (
          <div key={a.icao} className="pack-list-row">
            <span className="pack-icao">{a.icao}</span>
            <span>{a.name}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
