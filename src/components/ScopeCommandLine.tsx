import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AircraftSnapshot, Clearance, ControllerRole } from "../types";
import { roleLabel } from "../pointOuts";
import { runCommand, type CommandResult } from "../scopeCommands";
import type { ScopeKind } from "../scopeDisplay";

/** The scope's message composition area - the command line that sits
 * under every real CRC display. Everything the DCB can do is typeable
 * here too, aimed at the slewing target (click a track to slew, then
 * type) or prefixed with a callsign. Typed lines like "UAL123 HDG 090"
 * work; the newest result or error shows on the status line to the right.
 */

interface Props {
  scope: ScopeKind;
  role: ControllerRole;
  aircraft: AircraftSnapshot[];
  selectedCallsign: string | null;
  onSelect: (callsign: string | null) => void;
  issue: (callsign: string, clearance: Clearance) => Promise<void>;
}

export function ScopeCommandLine({
  scope,
  role,
  aircraft,
  selectedCallsign,
  onSelect,
  issue,
}: Props) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    // Real scopes focus their command line; clicking a target (sluing)
    // parks the caret here ready for the next entry.
    inputRef.current?.focus();
  }, [selectedCallsign]);

  const submit = async () => {
    if (busyRef.current || !value.trim()) return;
    busyRef.current = true;
    try {
      const res = await runCommand(value, {
        scope,
        role,
        aircraft,
        selectedCallsign,
        select: onSelect,
        issue,
      });
      if (res.message) setResult(res);
    } finally {
      busyRef.current = false;
      setValue("");
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="scope-cl" onClick={() => inputRef.current?.focus()}>
      <span className="scope-cl-prompt" title={selectedCallsign ? `Slewed: ${selectedCallsign}` : "No target slewed"}>
        {roleLabel(role)}&gt;
      </span>
      <input
        ref={inputRef}
        className="scope-cl-input"
        spellCheck={false}
        autoComplete="off"
        placeholder={
          selectedCallsign
            ? `${selectedCallsign} slewed — HDG 090 · A080 · SPD 210 · PT TWR · HELP`
            : "click a target to slew, or lead with a callsign — HELP"
        }
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {result && (
        <span className={result.ok ? "scope-cl-status" : "scope-cl-status err"}>
          {result.message}
        </span>
      )}
    </div>
  );
}