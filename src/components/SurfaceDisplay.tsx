import { useEffect, useRef } from "react";
import type { AirportData, AircraftSnapshot } from "../types";

interface Props {
  airport: AirportData;
  aircraft: AircraftSnapshot[];
  selectedCallsign: string | null;
  onSelectAircraft: (callsign: string) => void;
}

const EDGE_COLOR: Record<string, string> = {
  runway: "#e8e8e8",
  stopway: "#9a9a7a",
  taxiway: "#3c5a46",
  taxilane: "#2f4a3a",
  gate_link: "#2a3a30",
};

/** Draws a small plane silhouette centered at the origin, nose pointing up
 * (0, -1), at a scale readable on the SMR display. Caller handles
 * translate/rotate/fillStyle. */
function drawPlaneGlyph(ctx: CanvasRenderingContext2D) {
  const s = 0.055;
  ctx.beginPath();
  ctx.moveTo(0 * s, -140 * s);
  ctx.lineTo(34 * s, 60 * s);
  ctx.lineTo(120 * s, 118 * s);
  ctx.lineTo(120 * s, 150 * s);
  ctx.lineTo(34 * s, 122 * s);
  ctx.lineTo(18 * s, 230 * s);
  ctx.lineTo(62 * s, 268 * s);
  ctx.lineTo(62 * s, 296 * s);
  ctx.lineTo(0 * s, 270 * s);
  ctx.lineTo(-62 * s, 296 * s);
  ctx.lineTo(-62 * s, 268 * s);
  ctx.lineTo(-18 * s, 230 * s);
  ctx.lineTo(-34 * s, 122 * s);
  ctx.lineTo(-120 * s, 150 * s);
  ctx.lineTo(-120 * s, 118 * s);
  ctx.lineTo(-34 * s, 60 * s);
  ctx.closePath();
  ctx.fill();
}

const EDGE_WIDTH: Record<string, number> = {
  runway: 5,
  stopway: 3,
  taxiway: 1.6,
  taxilane: 1.2,
  gate_link: 1,
};

/** Surface Movement Radar (SMR) view: a plan-view ground traffic display
 * built directly from the airport's real taxiway/runway graph. Aircraft
 * data arrives ~4x/sec from the sim tick, so the draw loop reads it from a
 * ref rather than re-running the whole setup effect on every tick. */
export function SurfaceDisplay({ airport, aircraft, selectedCallsign, onSelectAircraft }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef({ scale: 2.2, panX: 0, panY: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const aircraftRef = useRef<AircraftSnapshot[]>(aircraft);
  const selectedRef = useRef<string | null>(selectedCallsign);

  useEffect(() => {
    aircraftRef.current = aircraft;
  }, [aircraft]);
  useEffect(() => {
    selectedRef.current = selectedCallsign;
  }, [selectedCallsign]);

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

    const nodeById = new Map(airport.nodes.map((n) => [n.id, n]));

    // Airports range from a small single-runway field to a sprawling hub
    // several kilometers across, so the initial view must fit to the
    // actual airport extent rather than assume a fixed scale.
    {
      const xs = airport.nodes.map((n) => n.x);
      const ys = airport.nodes.map((n) => n.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const spanX = Math.max(maxX - minX, 1);
      const spanY = Math.max(maxY - minY, 1);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const padding = 0.85;
      const fitScale = Math.min((w / spanX) * padding, (h / spanY) * padding);
      viewRef.current = {
        scale: fitScale,
        panX: -(minX + maxX) / 2,
        panY: -(minY + maxY) / 2,
      };
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
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#0a1410";
      ctx.fillRect(0, 0, w, h);

      for (const e of airport.edges) {
        const a = nodeById.get(e.from);
        const b = nodeById.get(e.to);
        if (!a || !b) continue;
        const { sx: ax, sy: ay } = toScreen(a.x, a.y);
        const { sx: bx, sy: by } = toScreen(b.x, b.y);
        ctx.strokeStyle = EDGE_COLOR[e.kind] ?? "#2f4a3a";
        ctx.lineWidth = EDGE_WIDTH[e.kind] ?? 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }

      ctx.fillStyle = "#4a6a5a";
      for (const p of airport.parking_positions) {
        const n = nodeById.get(p.node);
        if (!n) continue;
        const { sx, sy } = toScreen(n.x, n.y);
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "#cfe8d8";
      ctx.font = "bold 11px monospace";
      for (const r of airport.runways) {
        const start = nodeById.get(r.node_start);
        const end = nodeById.get(r.node_end);
        if (start && r.ends[0]) {
          const { sx, sy } = toScreen(start.x, start.y);
          ctx.fillText(r.ends[0], sx + 6, sy);
        }
        if (end && r.ends[1]) {
          const { sx, sy } = toScreen(end.x, end.y);
          ctx.fillText(r.ends[1], sx + 6, sy);
        }
      }

      for (const ac of aircraftRef.current) {
        const { sx, sy } = toScreen(ac.x, ac.y);
        const isSelected = ac.callsign === selectedRef.current;
        const isArrival = ac.state === "LandingRollout" || ac.state === "OnApproach";
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate((ac.heading_deg * Math.PI) / 180);
        ctx.fillStyle = isSelected ? "#ffdf5e" : isArrival ? "#7fc8ff" : "#7fffb0";
        drawPlaneGlyph(ctx);
        ctx.restore();

        ctx.fillStyle = isSelected ? "#ffdf5e" : "#bdf2d2";
        ctx.font = "10px monospace";
        ctx.fillText(
          `${ac.callsign} ${ac.aircraft_type} ${Math.round(ac.ground_speed_kt)}kt`,
          sx + 8,
          sy - 4,
        );
        ctx.fillText(ac.state, sx + 8, sy + 8);
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
        onSelectAircraft(hit);
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
      viewRef.current.scale = Math.min(20, Math.max(0.3, viewRef.current.scale * factor));
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
    // Intentionally only re-run when the airport itself changes; aircraft
    // and selection flow through refs so the canvas isn't torn down 4x/sec.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airport, onSelectAircraft]);

  return <canvas ref={canvasRef} className="surface-display" />;
}
