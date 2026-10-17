import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ControllerRole } from "../types";
import {
  deliverDueReplies,
  markThreadRead,
  parties,
  partyLabel,
  REPLY_MS,
  sendMessage,
  setActiveThread,
  subscribeMessages,
  thread,
  unreadCount,
  type MessageParty,
} from "../controllerMessaging";

/** The controller-to-controller message window - CRC's coordination net in
 * a single pane: one thread per other position plus the facility all-call
 * down the left, the selected conversation and a composer on the right.
 * Draggable and independent of the scope canvas, like the Dep/Arr window.
 */

interface Props {
  role: ControllerRole;
  onClose: () => void;
}

export function ControllerMessages({ role, onClose }: Props) {
  const [pos, setPos] = useState({ x: 120, y: 120 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [rev, setRev] = useState(0);
  const list = parties(role);
  const [active, setActive] = useState<MessageParty>(list[0]);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Re-render on any store change, and keep a short poll running so pending
  // AI replies land even if the internal timer is throttled in the
  // background - cheap, and it keeps the thread live while the window's up.
  useEffect(() => {
    const unsub = subscribeMessages(() => setRev((v) => v + 1));
    const id = setInterval(() => {
      if (deliverDueReplies(Date.now()) === 0) setRev((v) => v + 1);
    }, Math.max(250, Math.floor(REPLY_MS / 3)));
    return () => {
      unsub();
      clearInterval(id);
    };
  }, []);

  // Tell the store which thread is on screen so arriving replies there are
  // marked read instead of badging an open window.
  useEffect(() => {
    setActiveThread(active);
    markThreadRead(active);
    inputRef.current?.focus();
    return () => setActiveThread(null);
  }, [role, active]);

  // Pin to the latest message whenever the thread grows.
  const msgs = thread(active);
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rev, active]);

  const onHeaderDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({ x: ev.clientX - dragRef.current.x, y: ev.clientY - dragRef.current.y });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const send = () => {
    if (!draft.trim()) return;
    const res = sendMessage(role, active, draft);
    if (res.ok) setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  void rev;

  return (
    <div className="msg-window" style={{ left: pos.x, top: pos.y }}>
      <div className="msg-header" onMouseDown={onHeaderDown}>
        <span>Coordination — {partyLabel(role)} position</span>
        <button className="icon-button" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="msg-body">
        <div className="msg-parties">
          {list.map((p) => {
            const n = unreadCount(p);
            return (
              <button
                key={p}
                className={p === active ? "msg-party active" : "msg-party"}
                onClick={() => setActive(p)}
              >
                <span>{p === "ALL" ? "ALL CALL" : partyLabel(p)}</span>
                {n > 0 && <span className="msg-badge">{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="msg-thread">
          <div className="msg-thread-body" ref={bodyRef}>
            {msgs.length === 0 && (
              <div className="msg-empty">
                {active === "ALL"
                  ? "Broadcast to every position. No replies on the all-call."
                  : `No coordination with ${partyLabel(active)} yet.`}
              </div>
            )}
            {msgs.map((m) => (
              <div
                key={m.id}
                className={m.outbound ? "msg-bubble out" : "msg-bubble in"}
              >
                <span className="msg-bubble-from">
                  {m.outbound ? "YOU" : partyLabel(m.from)}
                  {m.to === "ALL" && m.outbound ? " → ALL" : ""}
                </span>
                <span className="msg-bubble-text">{m.text}</span>
              </div>
            ))}
          </div>
          <div className="msg-composer">
            <span className="msg-composer-to">
              {active === "ALL" ? "ALL" : partyLabel(active)}&gt;
            </span>
            <input
              ref={inputRef}
              className="msg-composer-input"
              spellCheck={false}
              autoComplete="off"
              placeholder={
                active === "ALL"
                  ? "broadcast to all positions…"
                  : `message ${partyLabel(active)} — e.g. "UAL123 release?"`
              }
              value={draft}
              maxLength={240}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button className="msg-send" disabled={!draft.trim()} onClick={send}>
              SEND
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
