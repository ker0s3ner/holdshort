import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { ControllerRole } from "../types";
import {
  deletePrefSet,
  getLeaderFor,
  getQuickLook,
  getScopeSettings,
  LEADER_MAX_PX,
  LEADER_MIN_PX,
  listPrefSets,
  loadPrefSet,
  patchScopeSettings,
  savePrefSet,
  setLeaderFor,
  setQuickLook,
  subscribeScopeSettings,
  type ScopeKind,
  type ScopeSettings,
} from "../scopeDisplay";
import { requestPointOut, roleLabel } from "../pointOuts";
import { subscribeMessages, unreadCount } from "../controllerMessaging";

/** The Display Control Bar: a strip of controls along the top edge of
 * every scope - toggle buttons, spinner buttons (arrow-click or scroll
 * wheel to adjust a value), and buttons that open submenus - exactly the
 * recurring piece all four real CRC displays share. Which buttons appear
 * is scope-specific: RANGE/ROT only make sense on Approach's radar, VIS
 * only on Tower Cab's visibility ring.
 */

interface Props {
  scope: ScopeKind;
  role: ControllerRole;
  selectedCallsign: string | null;
  /** Opens the controller-to-controller message window. */
  onOpenMessages: () => void;
}

const RANGE_STEPS = [0, 2, 5, 10, 20, 30, 40, 60]; // 0 = fit
const ROT_STEP = 15;
const DIR_STEP = 45;

interface SpinnerProps {
  label: string;
  value: string;
  title: string;
  onPrev: () => void;
  onNext: () => void;
}

function Spinner({ label, value, title, onPrev, onNext }: SpinnerProps) {
  // Real DCB spinners adjust on wheel scroll over the readout as well as
  // on click - React's wheel handler is passive, so scrolling just changes
  // the value without zooming anything behind it.
  const onWheel = (e: ReactWheelEvent) => {
    if (e.deltaY > 0) onPrev();
    else if (e.deltaY < 0) onNext();
  };
  return (
    <span className="dcb-spinner" title={title}>
      <button className="dcb-btn dcb-arrow" onClick={onPrev} tabIndex={-1}>
        ◂
      </button>
      <span className="dcb-spinner-val" onWheel={onWheel}>
        <span className="dcb-spinner-label">{label}</span> {value}
      </span>
      <button className="dcb-btn dcb-arrow" onClick={onNext} tabIndex={-1}>
        ▸
      </button>
    </span>
  );
}

interface MenuProps {
  trigger: ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}

function Menu({ trigger, active, disabled, title, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div className="dcb-menu" ref={ref}>
      <button
        className={active ? "dcb-btn active" : "dcb-btn"}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={title}
      >
        {trigger}
      </button>
      {open && <div className="dcb-menu-panel">{children}</div>}
    </div>
  );
}

export function ScopeDCB({ scope, role, selectedCallsign, onOpenMessages }: Props) {
  const [settings, setSettings] = useState<ScopeSettings>(getScopeSettings);
  const [quickLook, setQuickLookState] = useState<ControllerRole | null>(getQuickLook);
  const [rev, setRev] = useState(0); // bumped after per-track leader edits
  const [status, setStatus] = useState<string | null>(null);
  const [prefName, setPrefName] = useState("");
  const [prefSetsRev, setPrefSetsRev] = useState(0);
  const [unread, setUnread] = useState(() => unreadCount());

  useEffect(
    () =>
      subscribeScopeSettings(() => {
        setSettings(getScopeSettings());
        setQuickLookState(getQuickLook());
        setRev((v) => v + 1);
      }),
    [],
  );

  // Keep the MSG badge current as replies arrive and threads are read.
  useEffect(
    () => subscribeMessages(() => setUnread(unreadCount())),
    [role],
  );

  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(null), 2600);
    return () => clearTimeout(id);
  }, [status]);

  // Leader edits go through the store API directly (per-track overrides
  // live outside ScopeSettings), so bump revision to re-read them.
  const leader = getLeaderFor(selectedCallsign);
  const showStatus = (msg: string) => setStatus(msg);

  const cycleDbMode = () => {
    const order = ["all", "selected", "none"] as const;
    const idx = order.indexOf(settings.datablockMode);
    patchScopeSettings({ datablockMode: order[(idx + 1) % order.length] });
  };

  const stepRange = (dir: 1 | -1) => {
    const idx = RANGE_STEPS.indexOf(settings.rangeNm);
    const next = RANGE_STEPS[(idx + dir + RANGE_STEPS.length) % RANGE_STEPS.length];
    patchScopeSettings({ rangeNm: next });
  };

  const stepLeader = (field: "angleDeg" | "lengthPx", dir: 1 | -1) => {
    const next =
      field === "angleDeg"
        ? { ...leader, angleDeg: (leader.angleDeg + dir * DIR_STEP + 360) % 360 }
        : {
            ...leader,
            lengthPx: Math.min(LEADER_MAX_PX, Math.max(LEADER_MIN_PX, leader.lengthPx + dir * 2)),
          };
    if (selectedCallsign) setLeaderFor(selectedCallsign, next);
    else patchScopeSettings({ leader: next });
    setRev((v) => v + 1);
  };

  const doPointOut = (to: ControllerRole) => {
    if (!selectedCallsign) return;
    const res = requestPointOut(selectedCallsign, to, role);
    showStatus((res.ok ? "" : "! ") + res.message);
  };

  void rev;

  return (
    <div className="scope-dcb">
      <span className="dcb-group">
        <button
          className="dcb-btn"
          onClick={cycleDbMode}
          title="Datablock mode: all / selected / off"
        >
          DB:
          {settings.datablockMode === "all"
            ? "ALL"
            : settings.datablockMode === "selected"
              ? "SEL"
              : "OFF"}
        </button>
        {scope !== "tower" && (
          <button
            className={settings.rings ? "dcb-btn active" : "dcb-btn"}
            onClick={() => patchScopeSettings({ rings: !settings.rings })}
            title="Range rings"
          >
            RINGS
          </button>
        )}
        <Menu trigger={<>LBL ▾</>} title="Map labels">
          {(
            [
              ["showRunwayLabels", "Runway numbers"],
              ["showTaxiwayLabels", "Taxiway letters"],
              ["showGateLabels", "Gate numbers"],
            ] as const
          ).map(([key, label]) => (
            <label className="dcb-menu-item" key={key}>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => patchScopeSettings({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </Menu>
      </span>

      <span className="dcb-group">
        <Spinner
          label="LEN"
          value={String(leader.lengthPx)}
          title={
            selectedCallsign
              ? `Leader length for ${selectedCallsign} (scroll or click)`
              : "Default leader length for all tracks (scroll or click)"
          }
          onPrev={() => stepLeader("lengthPx", -1)}
          onNext={() => stepLeader("lengthPx", 1)}
        />
        <Spinner
          label="DIR"
          value={`${String(leader.angleDeg).padStart(3, "0")}°`}
          title={
            selectedCallsign
              ? `Leader direction for ${selectedCallsign}, 0 = up (scroll or click)`
              : "Default leader direction, 0 = up (scroll or click)"
          }
          onPrev={() => stepLeader("angleDeg", -1)}
          onNext={() => stepLeader("angleDeg", 1)}
        />
        {selectedCallsign && (
          <span className="dcb-sublabel" title="Adjusting the slewed track's own leader line">
            ↔ {selectedCallsign}
          </span>
        )}
      </span>

      {scope === "approach" && (
        <span className="dcb-group">
          <Spinner
            label="RANGE"
            value={settings.rangeNm === 0 ? "FIT" : `${settings.rangeNm}NM`}
            title="Displayed range around the scope center"
            onPrev={() => stepRange(-1)}
            onNext={() => stepRange(1)}
          />
          <Spinner
            label="ROT"
            value={`${String(settings.rotationDeg).padStart(3, "0")}°`}
            title="Scope rotation, 0 = north-up"
            onPrev={() =>
              patchScopeSettings({ rotationDeg: (settings.rotationDeg - ROT_STEP + 360) % 360 })
            }
            onNext={() =>
              patchScopeSettings({ rotationDeg: (settings.rotationDeg + ROT_STEP) % 360 })
            }
          />
        </span>
      )}

      {scope === "tower" && (
        <span className="dcb-group">
          <Spinner
            label="VIS"
            value={`${settings.visRingKm}KM`}
            title="Visibility ring radius"
            onPrev={() => patchScopeSettings({ visRingKm: Math.max(3, settings.visRingKm - 1) })}
            onNext={() => patchScopeSettings({ visRingKm: Math.min(40, settings.visRingKm + 1) })}
          />
        </span>
      )}

      <span className="dcb-group">
        <Menu trigger={<>PREFS ▾</>} title="Named preference sets">
          <div className="dcb-pref-save">
            <input
              className="dcb-pref-input"
              placeholder="name…"
              value={prefName}
              maxLength={20}
              onChange={(e) => setPrefName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && prefName.trim()) {
                  showStatus(savePrefSet(prefName).message);
                  setPrefName("");
                  setPrefSetsRev((v) => v + 1);
                }
              }}
            />
            <button
              className="dcb-btn"
              disabled={!prefName.trim()}
              onClick={() => {
                showStatus(savePrefSet(prefName).message);
                setPrefName("");
                setPrefSetsRev((v) => v + 1);
              }}
            >
              SAVE
            </button>
          </div>
          {prefSetsRev >= 0 &&
            (listPrefSets().length === 0 ? (
              <span className="dcb-menu-hint">No pref sets saved yet</span>
            ) : (
              listPrefSets().map((p) => (
                <div className="dcb-pref-row" key={p.name}>
                  <button
                    className="dcb-btn dcb-pref-name"
                    onClick={() => showStatus(loadPrefSet(p.name).message)}
                  >
                    {p.name}
                  </button>
                  <button
                    className="dcb-btn dcb-pref-del"
                    title="Delete"
                    onClick={() => {
                      showStatus(deletePrefSet(p.name).message);
                      setPrefSetsRev((v) => v + 1);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            ))}
        </Menu>

        <Menu
          trigger={quickLook ? `QL ${roleLabel(quickLook)}` : "QL ▾"}
          active={quickLook != null}
          title="Quick Look - another position's full datablocks, still their aircraft"
        >
          <button
            className={quickLook == null ? "dcb-menu-item active" : "dcb-menu-item"}
            onClick={() => setQuickLook(null)}
          >
            Quick Look off
          </button>
          {(["ramp", "ground", "tower", "approach"] as ControllerRole[])
            .filter((r) => r !== role)
            .map((r) => (
              <button
                key={r}
                className={quickLook === r ? "dcb-menu-item active" : "dcb-menu-item"}
                onClick={() => setQuickLook(r)}
              >
                {roleLabel(r)}
              </button>
            ))}
        </Menu>

        <Menu
          trigger="PT ▾"
          disabled={!selectedCallsign}
          title={
            selectedCallsign
              ? `Point ${selectedCallsign} out to another position`
              : "Slew a target first"
          }
        >
          <span className="dcb-menu-hint">Point out to…</span>
          {(["ramp", "ground", "tower", "approach"] as ControllerRole[]).map((r) => (
            <button className="dcb-menu-item" key={r} onClick={() => doPointOut(r)}>
              {roleLabel(r)}
            </button>
          ))}
        </Menu>

        <button
          className={unread > 0 ? "dcb-btn active dcb-msg" : "dcb-btn dcb-msg"}
          onClick={onOpenMessages}
          title="Controller-to-controller coordination messages"
        >
          MSG
          {unread > 0 && <span className="dcb-msg-badge">{unread}</span>}
        </button>
      </span>

      <span
        className={
          status && (status.startsWith("!") || status.startsWith("?"))
            ? "dcb-status err"
            : "dcb-status"
        }
      >
        {status}
      </span>
    </div>
  );
}