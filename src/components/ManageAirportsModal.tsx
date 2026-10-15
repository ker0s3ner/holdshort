import { Modal } from "./Modal";
import type { AirportSummary } from "../types";
import { regionFor } from "../airportRegions";

interface Props {
  airports: AirportSummary[];
  onClose: () => void;
}

/** Every bundled airport ships installed already - there's no download
 * step yet, so this mirrors CRC's "Manage Installed ARTCCs" list as a
 * status view rather than faking an install action. */
export function ManageAirportsModal({ airports, onClose }: Props) {
  const sorted = [...airports].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Modal title="Manage Installed Airports" onClose={onClose}>
      <p className="muted settings-note">
        Generated from real-world OpenStreetMap surface data via{" "}
        <code>tools/convert_airport.py</code>.
      </p>
      <div className="airport-list">
        {sorted.map((a) => (
          <div key={a.icao} className="airport-list-row">
            <div className="airport-list-info">
              <span className="pack-icao">{a.icao}</span>
              <span>{a.name}</span>
              <span className="muted">{regionFor(a.icao)}</span>
            </div>
            <button className="installed-badge" disabled>
              Installed
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
