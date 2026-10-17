import { useEffect, useRef } from "react";
import type { AirportData, AircraftSnapshot } from "../types";
import { getRadarPalette } from "../radarPalette";
import { HANDOFF_FLASH_MS, type HandoffEvent } from "../handoffTracking";

interface Props {
  airport: AirportData;
  aircraft: AircraftSnapshot[];
  selectedCallsign: string | null;
  onSelectAircraft: (callsign: string | null) => void;
  recentHandoffs: Map<string, HandoffEvent>;
}

const NM_TO_M = 1852.0;
const RING_SPACING_NM = 5;
const RING_COUNT = 6; // out to 30nm

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
  selectedCallsign,
  onSelectAircraft,
  recentHandoffs,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef({ scale: 0.004, panX: 0, panY: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const aircraftRef = useRef<AircraftSnapshot[]>(aircraft);
  const selectedRef = useRef<string | null>(selectedCallsign);
  const handoffsRef = useRef(recentHandoffs);

  useEffect(() => {
    aircraftRef.current = aircraft;
  }, [aircraft]);
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

    {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const radiusM = RING_SPACING_NM * RING_COUNT * NM_TO_M;
      const fitScale = (Math.min(w, h) / 2 / radiusM) * 0.9;
      viewRef.current = { scale: fitScale, panX: 0, panY: 0 };
    }

    const toScreen = (x: number, y: number) => {
      const { scale, panX, panY } = viewRef.current;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      return {
        sx: w / 2 + (x + panX) * scale,
        sy: h / 2 - (y + panY) * scale,
      };
    };

    const draw = () => {
      const palette = getRadarPalette();
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, w, h);

      const center = toScreen(0, 0);

      // Range rings, every RING_SPACING_NM out to RING_COUNT rings.
      ctx.strokeStyle = palette.gateLinkStroke;
      ctx.lineWidth = 1;
      ctx.font = "9px monospace";
      ctx.fillStyle = palette.taxiwayLabel;
      for (let i = 1; i <= RING_COUNT; i++) {
        const r = i * RING_SPACING_NM * NM_TO_M * viewRef.current.scale;
        ctx.beginPath();
        ctx.arc(center.sx, center.sy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(`${i * RING_SPACING_NM}`, center.sx + r + 2, center.sy - 2);
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

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate((ac.heading_deg * Math.PI) / 180);
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

        // Datablock: callsign / altitude (hundreds, real ATC convention) +
        // ground speed (tens) / vectored heading if Approach has assigned
        // one - the information a real scope datablock actually carries.
        const leaderEnd = { x: sx + 14, y: sy - 14 };
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx + 4, sy - 4);
        ctx.lineTo(leaderEnd.x, leaderEnd.y);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.font = "10px monospace";
        ctx.fillText(ac.callsign, leaderEnd.x + 2, leaderEnd.y - 2);
        const altHundreds = String(Math.round(ac.altitude_ft / 100)).padStart(3, "0");
        const gsTens = String(Math.round(ac.ground_speed_kt / 10)).padStart(2, "0");
        ctx.fillText(`${altHundreds} ${gsTens}`, leaderEnd.x + 2, leaderEnd.y + 9);
        if (ac.assigned_heading_deg != null) {
          ctx.fillText(`H${Math.round(ac.assigned_heading_deg)}`, leaderEnd.x + 2, leaderEnd.y + 20);
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
