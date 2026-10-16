import { useEffect, useState } from "react";
import {
  getAtisLetter,
  getAtisQnh,
  getAtisRemarks,
  nextAtisLetter,
  setAtisLetter,
  setAtisQnh,
  setAtisRemarks,
} from "../atisSettings";
import { generateAtisText, parseMetar } from "../atis";

interface Props {
  icao: string;
  metar: string | null;
  activeRunway: { ref: string; end: string } | null;
  onClose: () => void;
}

/** Not simulated audio - just the record of what the controller's current
 * ATIS broadcast says, the way a real controller would jot it down before
 * reading it out. The identifier letter advances the same way a real ATIS
 * does each time it's updated. Wind, visibility, clouds, temp/dew, and
 * altimeter are pulled straight from the live METAR instead of being
 * retyped by hand - QNH stays editable since the METAR only updates
 * hourly and a real controller might need to correct it in between. */
export function AtisModal({ icao, metar, activeRunway, onClose }: Props) {
  const [letter, setLetterState] = useState(getAtisLetter(icao));
  const [remarks, setRemarksState] = useState(getAtisRemarks(icao));
  const [qnh, setQnhState] = useState(getAtisQnh(icao));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (qnh || !metar) return;
    const parsed = parseMetar(metar);
    if (parsed.qnhHpa != null) setQnhState(String(parsed.qnhHpa));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metar]);

  const text = generateAtisText({
    icao,
    letter,
    activeRunway,
    metar,
    qnh,
    remarks,
    towerName: "",
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box atis-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{icao} ATIS</span>
          <button className="icon-button" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-content atis-content">
          <div className="atis-side">
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
              QNH
              <input
                type="text"
                inputMode="numeric"
                value={qnh}
                placeholder="auto"
                onChange={(e) => {
                  setQnhState(e.target.value);
                  setAtisQnh(icao, e.target.value);
                }}
              />
            </label>
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
            {!metar && <p className="muted settings-note">No live METAR yet - weather line will be incomplete.</p>}
          </div>
          <div className="atis-main">
            <pre className="atis-text">{text}</pre>
            <button
              className="setup-primary"
              onClick={() => {
                navigator.clipboard?.writeText(text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "Copied" : "Copy ATIS Command"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
