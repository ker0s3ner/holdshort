import { useState } from "react";
import {
  getAtisLetter,
  getAtisRemarks,
  nextAtisLetter,
  setAtisLetter,
  setAtisRemarks,
} from "../atisSettings";

interface Props {
  icao: string;
  onClose: () => void;
}

/** Not simulated audio - just the record of what the controller's current
 * ATIS broadcast says, the way a real controller would jot it down before
 * reading it out. The identifier letter advances the same way a real ATIS
 * does each time it's updated. */
export function AtisModal({ icao, onClose }: Props) {
  const [letter, setLetterState] = useState(getAtisLetter(icao));
  const [remarks, setRemarksState] = useState(getAtisRemarks(icao));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{icao} ATIS</span>
          <button className="icon-button" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-content">
          <div className="settings-row">
            <span>Information</span>
            <button
              onClick={() => {
                const next = nextAtisLetter(letter);
                setLetterState(next);
                setAtisLetter(icao, next);
              }}
            >
              {letter}
            </button>
          </div>
          <label className="field-label">
            Remarks
            <textarea
              rows={4}
              value={remarks}
              onChange={(e) => {
                setRemarksState(e.target.value);
                setAtisRemarks(icao, e.target.value);
              }}
              placeholder="e.g. expect visual approach, taxiway B closed"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
