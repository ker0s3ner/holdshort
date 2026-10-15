import { Modal } from "./Modal";
import type { AirportSummary } from "../types";
import { regionFor } from "../airportRegions";

interface Props {
  airports: AirportSummary[];
  onClose: () => void;
}

/** Regions (not individual airports) are the installable unit, matching
 * CRC's "Manage Installed ARTCCs" list. Every bundled region ships
 * installed already - there's no download step yet - so this is a status
 * view rather than a faked install action. */
export function ManageRegionsModal({ airports, onClose }: Props) {
  const byRegion = new Map<string, AirportSummary[]>();
  for (const a of airports) {
    const region = regionFor(a.icao);
    const list = byRegion.get(region) ?? [];
    list.push(a);
    byRegion.set(region, list);
  }
  const regions = Array.from(byRegion.keys()).sort();

  return (
    <Modal title="Manage Installed Regions" onClose={onClose}>
      <p className="muted settings-note">
        Generated from real-world OpenStreetMap surface data via{" "}
        <code>tools/convert_airport.py</code>.
      </p>
      <div className="airport-list">
        {regions.map((region) => (
          <div key={region} className="region-row">
            <div className="airport-list-row">
              <div className="airport-list-info">
                <span className="pack-icao">{region}</span>
                <span className="muted">
                  {byRegion.get(region)!.length} facilit
                  {byRegion.get(region)!.length === 1 ? "y" : "ies"}
                </span>
              </div>
              <button className="installed-badge" disabled>
                Installed
              </button>
            </div>
            <div className="region-facilities">
              {byRegion
                .get(region)!
                .map((a) => `${a.icao} - ${a.name}`)
                .join(" · ")}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
