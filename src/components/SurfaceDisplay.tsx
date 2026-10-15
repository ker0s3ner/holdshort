import { useEffect, useRef } from "react";
import type { AirportData, AircraftSnapshot } from "../types";
import { getDatablockMode, getShowLabels } from "../displaySettings";

interface Props {
  airport: AirportData;
  aircraft: AircraftSnapshot[];
  selectedCallsign: string | null;
  onSelectAircraft: (callsign: string | null) => void;
}

const BG_COLOR = "#0a3f45";
const PAVEMENT_COLOR = "#060606";

const AREA_FILL: Record<string, string> = {
  terminal: "#888f93",
  hangar: "#767d81",
  apron: "#0e4a50",
};

const EDGE_WIDTH: Record<string, number> = {
  runway: 15,
  stopway: 9,
  taxiway: 8,
  taxilane: 6,
  gate_link: 2,
};

/** Draws a small plane silhouette centered at the origin, nose pointing up
 * (0, -1), at a scale readable on the SMR display. Caller handles
 * translate/rotate/fillStyle. */
function drawPlaneGlyph(ctx: CanvasRenderingContext2D) {
  const s = 0.05;
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

/** A short destination tag for the third datablock line - the last three
 * letters of the ICAO destination (KLAX -> LAX, EGLL -> GLL), the common
 * real-world shorthand for a scratchpad/destination field. */
function destTag(icao: string): string {
  return icao.length >= 3 ? icao.slice(-3) : icao;
}

/** Surface Movement Radar (SMR) view: a plan-view ground traffic display
 * built directly from the airport's real taxiway/runway graph, styled after
 * real ASDE-X surface radar displays (teal background, solid black
 * pavement, building footprints, leader-line datablocks). Aircraft data
 * arrives ~4x/sec from the sim tick, so the draw loop reads it from a ref
 * rather than re-running the whole setup effect on every tick. */
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
      const { scale } = viewRef.current;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, w, h);

      // Building/ramp footprints under the pavement network.
      for (const area of airport.areas) {
        if (area.points.length < 3) continue;
        ctx.fillStyle = AREA_FILL[area.kind] ?? "#555";
        ctx.beginPath();
        area.points.forEach(([x, y], i) => {
          const { sx, sy } = toScreen(x, y);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.fill();
      }

      // Pavement: solid black taxiway/runway strokes, scaled with zoom so
      // they read as physical width rather than a fixed screen thickness.
      for (const e of airport.edges) {
        const a = nodeById.get(e.from);
        const b = nodeById.get(e.to);
        if (!a || !b) continue;
        const { sx: ax, sy: ay } = toScreen(a.x, a.y);
        const { sx: bx, sy: by } = toScreen(b.x, b.y);
        const baseWidth = EDGE_WIDTH[e.kind] ?? 4;
        ctx.strokeStyle = e.kind === "gate_link" ? "#1c2b22" : PAVEMENT_COLOR;
        ctx.lineWidth = Math.max(baseWidth * (scale / 2.2), 1.5);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }

      // Runway centerline dashes for a more authentic read.
      for (const e of airport.edges) {
        if (e.kind !== "runway") continue;
        const a = nodeById.get(e.from);
        const b = nodeById.get(e.to);
        if (!a || !b) continue;
        const { sx: ax, sy: ay } = toScreen(a.x, a.y);
        const { sx: bx, sy: by } = toScreen(b.x, b.y);
        ctx.strokeStyle = "#e8e8e8";
        ctx.lineWidth = Math.max(1.5 * (scale / 2.2), 0.8);
        ctx.setLineDash([Math.max(6 * (scale / 2.2), 3), Math.max(6 * (scale / 2.2), 3)]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const showLabels = getShowLabels();
      const datablockMode = getDatablockMode();

      ctx.fillStyle = "#cfe8d8";
      for (const p of airport.parking_positions) {
        const n = nodeById.get(p.node);
        if (!n) continue;
        const { sx, sy } = toScreen(n.x, n.y);
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      if (showLabels) {
        ctx.fillStyle = "#eafff4";
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
      }

      for (const ac of aircraftRef.current) {
        const { sx, sy } = toScreen(ac.x, ac.y);
        const isSelected = ac.callsign === selectedRef.current;
        const isArrival = ac.state === "LandingRollout" || ac.state === "OnApproach";
        const color = isSelected ? "#ffdf5e" : isArrival ? "#7fc8ff" : "#f2f6f3";

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate((ac.heading_deg * Math.PI) / 180);
        ctx.fillStyle = color;
        drawPlaneGlyph(ctx);
        ctx.restore();

        // "Speaking" indicator: a ring around whoever is transmitting,
        // independent of selection - yellow if it's also the aircraft
        // you've selected, white otherwise (matching live-ATC clients).
        if (ac.is_speaking) {
          ctx.strokeStyle = isSelected ? "#ffdf5e" : "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, 11, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Leader line + stacked 3-line datablock, offset to the upper
        // right, matching the real surface-radar datablock convention.
        // "Selected only" mode keeps the glyphs but drops the clutter of a
        // full datablock for every aircraft on a busy field.
        if (datablockMode === "all" || isSelected) {
          const leaderEnd = { x: sx + 16, y: sy - 16 };
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx + 5, sy - 5);
          ctx.lineTo(leaderEnd.x, leaderEnd.y);
          ctx.stroke();

          ctx.fillStyle = color;
          ctx.font = "10px monospace";
          ctx.textBaseline = "alphabetic";
          ctx.fillText(ac.callsign, leaderEnd.x + 2, leaderEnd.y - 2);
          ctx.fillText(ac.aircraft_type, leaderEnd.x + 2, leaderEnd.y + 9);
          ctx.fillText(
            destTag(ac.rule === "Departure" ? ac.destination : ac.origin),
            leaderEnd.x + 2,
            leaderEnd.y + 20,
          );
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
