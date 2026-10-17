import { useEffect, useRef } from "react";
import type { AirportData, AircraftSnapshot, ControllerRole } from "../types";
import { fidelityOf, getQuickLook, getScopeSettings } from "../scopeDisplay";
import { drawLeaderBlock } from "../scopeDatablock";
import { getRadarPalette } from "../radarPalette";
import { HANDOFF_FLASH_MS, type HandoffEvent } from "../handoffTracking";

interface Props {
  airport: AirportData;
  aircraft: AircraftSnapshot[];
  role: ControllerRole;
  selectedCallsign: string | null;
  onSelectAircraft: (callsign: string | null) => void;
  recentHandoffs: Map<string, HandoffEvent>;
}

const NM_TO_M = 1852.0;
const RING_SPACING_NM = 5;
const RING_COUNT = 6; // out to 30nm with the default FIT range

/** Ring spacing that fits a chosen range: as many rings as stay readable
 * (at least 3), stepping through the real scope's 0.5/1/2/5/10/20NM
 * increments. */
function pickRingStep(rangeNm: number): number {
  const steps = [0.5, 1, 2, 5, 10, 20];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (rangeNm / steps[i] >= 3) return steps[i];
  }
  return steps[0];
}

/** Small plane blip, nose pointing up - simpler than the surface glyph
 * since at radar scale a detailed silhouette doesn't read anyway. */
function drawBlip(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4, 5);
  ctx.lineTo(0, 2);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
}

/** A radar-scope-style view of the airspace around the field: range rings,
 * the runway layout for reference, and every aircraft airborne or on
 * approach - the wide-area counterpart to the surface-only SMR/Tower Cab
 * views, for Approach's own vectoring work (and departures climbing out). */
export function ApproachView({
  airport,
  aircraft,
  role,
  selectedCallsign,
  onSelectAircraft,
  recentHandoffs,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef({ scale: 0.004, panX: 0, panY: 0, rot: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const aircraftRef = useRef<AircraftSnapshot[]>(aircraft);
  const selectedRef = useRef<string | null>(selectedCallsign);
  const handoffsRef = useRef(recentHandoffs);
  const roleRef = useRef(role);

  useEffect(() => {
    aircraftRef.current = aircraft;
  }, [aircraft]);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);
  useEffect(() => {
    selectedRef.current = selectedCallsign;
  }, [selectedCallsign]);
  useEffect(() => {
    handoffsRef.current = recentHandoffs;
  }, [recentHandoffs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    // Refit the scope for a chosen range (0 = the old fit-to-window
    // behavior, sized for the legacy 6x5NM rings). Called on mount and
    // again whenever the RANGE spinner or an `R <nm>` command changes it.
    let lastRange = -1;
    const applyRange = (rangeNm: number) => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const radiusM =
        rangeNm > 0 ? rangeNm * NM_TO_M : RING_SPACING_NM * RING_COUNT * NM_TO_M;
      viewRef.current = {
        ...viewRef.current,
        scale: (Math.min(w, h) / 2 / radiusM) * 0.9,
      };
      lastRange = rangeNm;
    };
    applyRange(getScopeSettings().rangeNm);

    const toScreen = (x: number, y: number) => {
      const { scale, panX, panY, rot } = viewRef.current;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      // Scope rotation (DCB ROT / `ROT <deg>`): world coordinates turn
      // about the field origin so the chosen bearing sits at the top of
      // the scope; pan stays screen-aligned because it's added after.
      const rad = (rot * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const rx = x * c - y * s;
      const ry = x * s + y * c;
      return {
        sx: w / 2 + (rx + panX) * scale,
        sy: h / 2 - (ry + panY) * scale,
      };
    };

    const draw = () => {
      const palette = getRadarPalette();
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const S = getScopeSettings();
      // Settings are read live every frame: a DCB spinner or a typed
      // command lands on the very next frame without tearing down the
      // canvas or its pan/zoom state.
      if (S.rangeNm !== lastRange) applyRange(S.rangeNm);
      viewRef.current.rot = S.rotationDeg;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, w, h);

      const center = toScreen(0, 0);

      // Range rings: the legacy 5NMFixed x 6 layout when RANGE is FIT,
      // otherwise a scaled step out to the selected range. DCB toggles.
      if (S.rings) {
        const stepNm = S.rangeNm > 0 ? pickRingStep(S.rangeNm) : RING_SPACING_NM;
        const maxNm = S.rangeNm > 0 ? S.rangeNm : stepNm * RING_COUNT;
        ctx.strokeStyle = palette.gateLinkStroke;
        ctx.lineWidth = 1;
        ctx.font = "9px monospace";
        ctx.fillStyle = palette.taxiwayLabel;
        for (let i = 1; ; i++) {
          const nm = i * stepNm;
          if (nm > maxNm + 1e-9) break;
          const r = nm * NM_TO_M * viewRef.current.scale;
          ctx.beginPath();
          ctx.arc(center.sx, center.sy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillText(`${nm}`, center.sx + r + 2, center.sy - 2);
        }
      }

      // Runways, for reference - at this scale the taxiway network isn't
      // legible anyway, so just the landing surfaces themselves.
      const nodeById = new Map(airport.nodes.map((n) => [n.id, n]));
      ctx.strokeStyle = palette.runwayStroke;
      ctx.lineWidth = 2;
      for (const r of airport.runways) {
        const a = nodeById.get(r.node_start);
        const b = nodeById.get(r.node_end);
        if (!a || !b) continue;
        const { sx: ax, sy: ay } = toScreen(a.x, a.y);
        const { sx: bx, sy: by } = toScreen(b.x, b.y);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.fillStyle = palette.runwayLabel;
      ctx.font = "bold 11px monospace";
      ctx.fillText(airport.icao, center.sx + 8, center.sy + 4);

      for (const ac of aircraftRef.current) {
        const { sx, sy } = toScreen(ac.x, ac.y);
        const isSelected = ac.callsign === selectedRef.current;
        const isArrival = ac.rule === "Arrival";
        const color = isSelected
          ? palette.aircraftSelected
          : isArrival
            ? palette.aircraftArrival
            : palette.aircraftDefault;

        // Glyph bearing follows the scope rotation: with ROT holding
        // bearing X at the top, a target flying heading H renders at H-X.
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(((ac.heading_deg - viewRef.current.rot) * Math.PI) / 180);
        ctx.fillStyle = color;
        drawBlip(ctx);
        ctx.restore();

        if (ac.is_speaking) {
          ctx.strokeStyle = isSelected ? palette.aircraftSelected : palette.speakingRingDefault;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, 10, 0, Math.PI * 2);
          ctx.stroke();
        }

        const handoff = handoffsRef.current.get(ac.callsign);
        if (handoff) {
          const age = Date.now() - handoff.at;
          if (age < HANDOFF_FLASH_MS) {
            const pulse = 0.4 + 0.6 * Math.abs(Math.sin(age / 220));
            ctx.globalAlpha = pulse;
            ctx.strokeStyle = palette.speakingRingDefault;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(sx, sy, 14, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }

        // Datablock with the three fidelity levels: FDB (callsign,
        // altitude in hundreds + ground speed in tens, plus any assigned
        // heading/altitude/speed) for tracks this position owns or
        // Quick-Looks, PDB (callsign + alt/gs) for other positions'
        // traffic, LDB (callsign alone) for out-of-domain returns.
        const showBlock =
          S.datablockMode === "all" || (S.datablockMode === "selected" && isSelected);
        if (showBlock) {
          const fid = fidelityOf(ac, "approach", roleRef.current, getQuickLook());
          const altHundreds = String(Math.round(ac.altitude_ft / 100)).padStart(3, "0");
          const gsTens = String(Math.round(ac.ground_speed_kt / 10)).padStart(2, "0");
          let lines: string[];
          if (fid === "FDB") {
            const parts: string[] = [];
            if (ac.assigned_heading_deg != null)
              parts.push(`H${Math.round(ac.assigned_heading_deg)}`);
            if (ac.assigned_altitude_ft != null)
              parts.push(String(Math.round(ac.assigned_altitude_ft / 100)));
            if (ac.assigned_speed_kt != null)
              parts.push(String(Math.round(ac.assigned_speed_kt)));
            lines = [ac.callsign, `${altHundreds} ${gsTens}`];
            if (parts.length) lines.push(parts.join(" "));
          } else if (fid === "PDB") {
            lines = [ac.callsign, `${altHundreds} ${gsTens}`];
          } else {
            lines = [ac.callsign];
          }
          ctx.font = "10px monospace";
          ctx.textBaseline = "alphabetic";
          drawLeaderBlock({ ctx, callsign: ac.callsign, sx, sy, color, fidelity: fid, lines });
        }
      }

      ctx.restore();
    };

    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const findAircraftAt = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      let closest: string | null = null;
      let bestDist = 14;
      for (const ac of aircraftRef.current) {
        const { sx, sy } = toScreen(ac.x, ac.y);
        const d = Math.hypot(sx - mx, sy - my);
        if (d < bestDist) {
          bestDist = d;
          closest = ac.callsign;
        }
      }
      return closest;
    };

    const onMouseDown = (e: MouseEvent) => {
      const hit = findAircraftAt(e.clientX, e.clientY);
      if (hit) {
        onSelectAircraft(hit === selectedRef.current ? null : hit);
        return;
      }
      dragRef.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      dragRef.current = { x: e.clientX, y: e.clientY };
      viewRef.current.panX += dx / viewRef.current.scale;
      viewRef.current.panY -= dy / viewRef.current.scale;
    };
    const onMouseUp = () => {
      dragRef.current = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      viewRef.current.scale = Math.min(0.05, Math.max(0.0005, viewRef.current.scale * factor));
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airport, onSelectAircraft]);

  return <canvas ref={canvasRef} className="surface-display" />;
}
