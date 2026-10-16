import { useEffect, useRef } from "react";
import type { AirportData, AircraftSnapshot } from "../types";
import {
  getDatablockMode,
  getShowGateLabels,
  getShowRunwayLabels,
  getShowTaxiwayLabels,
} from "../displaySettings";
import { getRadarPalette, hexToRgbChannels } from "../radarPalette";

interface Props {
  airport: AirportData;
  aircraft: AircraftSnapshot[];
  selectedCallsign: string | null;
  onSelectAircraft: (callsign: string | null) => void;
}

const VIS_RING_METERS = 18_000; // ~10 statute miles, the default CRC clear-weather ring
// How far past the airport's own geometry the satellite basemap extends,
// so Tower Cab opens on a wide view of the surrounding area (matching real
// CRC) instead of a tight crop around just the runways.
const BASEMAP_MARGIN_M = 3500;

/** Draws the same plane silhouette used on the SMR display, nose up. */
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

function destTag(icao: string): string {
  return icao.length >= 3 ? icao.slice(-3) : icao;
}

interface BasemapTile {
  img: HTMLImageElement;
  localTopLeft: [number, number];
  localBottomRight: [number, number];
}

const R_EARTH = 6378137.0;

function lonLatToTileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n,
  );
  return [x, y];
}

function tileXYToLonLat(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return [lon, lat];
}

/** Loads the real-world satellite basemap for an airport (Esri World
 * Imagery) as a set of static tiles placed at their true local-meter
 * position, computed from the same lat/lon <-> local-xy projection the
 * airport data was generated with. */
function loadBasemapTiles(airport: AirportData, onTileLoaded: () => void): BasemapTile[] {
  const refLat = airport.reference_point.lat;
  const refLon = airport.reference_point.lon;
  const refLatRad = (refLat * Math.PI) / 180;

  const toLocal = (lon: number, lat: number): [number, number] => {
    const x = ((lon - refLon) * Math.PI) / 180 * R_EARTH * Math.cos(refLatRad);
    const y = ((lat - refLat) * Math.PI) / 180 * R_EARTH;
    return [x, y];
  };

  const xs = airport.nodes.map((n) => n.x);
  const ys = airport.nodes.map((n) => n.y);
  const minX = Math.min(...xs) - BASEMAP_MARGIN_M;
  const maxX = Math.max(...xs) + BASEMAP_MARGIN_M;
  const minY = Math.min(...ys) - BASEMAP_MARGIN_M;
  const maxY = Math.max(...ys) + BASEMAP_MARGIN_M;

  const toLatLon = (x: number, y: number): [number, number] => {
    const lat = refLat + (y / R_EARTH) * (180 / Math.PI);
    const lon = refLon + (x / (R_EARTH * Math.cos(refLatRad))) * (180 / Math.PI);
    return [lon, lat];
  };

  let zoom = 18;
  let tileRange: { minTx: number; maxTx: number; minTy: number; maxTy: number } | null = null;
  for (; zoom >= 12; zoom--) {
    const [lonW, latN] = toLatLon(minX, maxY);
    const [lonE, latS] = toLatLon(maxX, minY);
    const [tx0, ty0] = lonLatToTileXY(lonW, latN, zoom);
    const [tx1, ty1] = lonLatToTileXY(lonE, latS, zoom);
    const minTx = Math.min(tx0, tx1);
    const maxTx = Math.max(tx0, tx1);
    const minTy = Math.min(ty0, ty1);
    const maxTy = Math.max(ty0, ty1);
    const count = (maxTx - minTx + 1) * (maxTy - minTy + 1);
    if (count <= 120) {
      tileRange = { minTx, maxTx, minTy, maxTy };
      break;
    }
  }
  if (!tileRange) return [];

  const tiles: BasemapTile[] = [];
  for (let tx = tileRange.minTx; tx <= tileRange.maxTx; tx++) {
    for (let ty = tileRange.minTy; ty <= tileRange.maxTy; ty++) {
      const [lonTL, latTL] = tileXYToLonLat(tx, ty, zoom);
      const [lonBR, latBR] = tileXYToLonLat(tx + 1, ty + 1, zoom);
      const img = new Image();
      img.onload = onTileLoaded;
      img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
      tiles.push({
        img,
        localTopLeft: toLocal(lonTL, latTL),
        localBottomRight: toLocal(lonBR, latBR),
      });
    }
  }
  return tiles;
}

/** Tower Cab view: real satellite imagery of the airport with the taxiway
 * diagram drawn over it in amber, a weather-visibility ring, and the same
 * leader-line aircraft datablocks as the SMR display - matching how CRC's
 * Tower Cab mode actually works (a 2D plan view over imagery, not a 3D
 * out-the-window render). */
export function TowerCabView({ airport, aircraft, selectedCallsign, onSelectAircraft }: Props) {
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
    const tiles = loadBasemapTiles(airport, () => {});

    // One label position per distinct taxiway/taxilane identifier (the
    // centroid of all its segments' midpoints), rather than stamping the
    // ref on every individual OSM way segment.
    const taxiwayLabels = (() => {
      const sums = new Map<string, { x: number; y: number; n: number }>();
      for (const e of airport.edges) {
        if (e.kind !== "taxiway" && e.kind !== "taxilane") continue;
        if (!e.ref) continue;
        const a = nodeById.get(e.from);
        const b = nodeById.get(e.to);
        if (!a || !b) continue;
        const entry = sums.get(e.ref) ?? { x: 0, y: 0, n: 0 };
        entry.x += (a.x + b.x) / 2;
        entry.y += (a.y + b.y) / 2;
        entry.n += 1;
        sums.set(e.ref, entry);
      }
      return Array.from(sums.entries()).map(([ref, s]) => ({
        ref,
        x: s.x / s.n,
        y: s.y / s.n,
      }));
    })();

    {
      const xs = airport.nodes.map((n) => n.x);
      const ys = airport.nodes.map((n) => n.y);
      const minX = Math.min(...xs) - BASEMAP_MARGIN_M * 0.6;
      const maxX = Math.max(...xs) + BASEMAP_MARGIN_M * 0.6;
      const minY = Math.min(...ys) - BASEMAP_MARGIN_M * 0.6;
      const maxY = Math.max(...ys) + BASEMAP_MARGIN_M * 0.6;
      const spanX = Math.max(maxX - minX, 1);
      const spanY = Math.max(maxY - minY, 1);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const padding = 0.95;
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
      const palette = getRadarPalette();
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const { panX, panY } = viewRef.current;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, w, h);

      for (const tile of tiles) {
        if (!tile.img.complete || tile.img.naturalWidth === 0) continue;
        const tl = toScreen(tile.localTopLeft[0], tile.localTopLeft[1]);
        const br = toScreen(tile.localBottomRight[0], tile.localBottomRight[1]);
        ctx.drawImage(tile.img, tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
      }

      // Weather-visibility ring: imagery fades to the cloud base color
      // beyond the configured range, same convention CRC's Tower Cab uses.
      const center = toScreen(-panX, -panY);
      const { scale } = viewRef.current;
      const visRadiusPx = VIS_RING_METERS * scale;
      const grad = ctx.createRadialGradient(
        center.sx,
        center.sy,
        visRadiusPx * 0.75,
        center.sx,
        center.sy,
        visRadiusPx,
      );
      const bgChannels = hexToRgbChannels(palette.bg);
      grad.addColorStop(0, `rgba(${bgChannels},0)`);
      grad.addColorStop(1, `rgba(${bgChannels},1)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Apron/terminal/hangar footprints, outlined only (not filled) so the
      // satellite imagery underneath still reads through.
      ctx.strokeStyle = palette.diagram;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      for (const area of airport.areas) {
        if (area.points.length < 3) continue;
        ctx.beginPath();
        area.points.forEach(([x, y], i) => {
          const { sx, sy } = toScreen(x, y);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const e of airport.edges) {
        if (e.kind === "gate_link") continue;
        const a = nodeById.get(e.from);
        const b = nodeById.get(e.to);
        if (!a || !b) continue;
        const { sx: ax, sy: ay } = toScreen(a.x, a.y);
        const { sx: bx, sy: by } = toScreen(b.x, b.y);
        ctx.strokeStyle = e.kind === "runway" ? palette.runwayStroke : palette.diagram;
        ctx.globalAlpha = e.kind === "runway" ? 0.95 : 0.75;
        ctx.lineWidth = e.kind === "runway" ? 3 : 1.6;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const showRunwayLabels = getShowRunwayLabels();
      const showTaxiwayLabels = getShowTaxiwayLabels();
      const showGateLabels = getShowGateLabels();
      const datablockMode = getDatablockMode();

      ctx.fillStyle = palette.diagram;
      for (const p of airport.parking_positions) {
        const n = nodeById.get(p.node);
        if (!n) continue;
        const { sx, sy } = toScreen(n.x, n.y);
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (showRunwayLabels || showTaxiwayLabels || showGateLabels) {
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 2;

        if (showRunwayLabels) {
          ctx.fillStyle = palette.runwayLabel;
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

        if (showTaxiwayLabels) {
          ctx.fillStyle = palette.taxiwayLabel;
          ctx.font = "bold 10px monospace";
          for (const t of taxiwayLabels) {
            const { sx, sy } = toScreen(t.x, t.y);
            ctx.fillText(t.ref, sx - 4, sy - 4);
          }
        }

        if (showGateLabels) {
          ctx.fillStyle = palette.gateLabel;
          ctx.font = "9px monospace";
          for (const p of airport.parking_positions) {
            if (!p.ref) continue;
            const n = nodeById.get(p.node);
            if (!n) continue;
            const { sx, sy } = toScreen(n.x, n.y);
            ctx.fillText(p.ref, sx + 4, sy + 3);
          }
        }
        ctx.shadowBlur = 0;
      }

      for (const ac of aircraftRef.current) {
        const { sx, sy } = toScreen(ac.x, ac.y);
        const isSelected = ac.callsign === selectedRef.current;
        const isArrival = ac.state === "LandingRollout" || ac.state === "OnApproach";
        const color = isSelected
          ? palette.aircraftSelected
          : isArrival
            ? palette.aircraftArrival
            : palette.aircraftDefault;

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate((ac.heading_deg * Math.PI) / 180);
        ctx.fillStyle = color;
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 3;
        drawPlaneGlyph(ctx);
        ctx.shadowBlur = 0;
        ctx.restore();

        if (ac.is_speaking) {
          ctx.strokeStyle = isSelected ? palette.aircraftSelected : palette.speakingRingDefault;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, 11, 0, Math.PI * 2);
          ctx.stroke();
        }

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
          ctx.shadowColor = "rgba(0,0,0,0.9)";
          ctx.shadowBlur = 2;
          ctx.fillText(ac.callsign, leaderEnd.x + 2, leaderEnd.y - 2);
          ctx.fillText(ac.aircraft_type, leaderEnd.x + 2, leaderEnd.y + 9);
          ctx.fillText(
            destTag(ac.rule === "Departure" ? ac.destination : ac.origin),
            leaderEnd.x + 2,
            leaderEnd.y + 20,
          );
          ctx.shadowBlur = 0;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airport, onSelectAircraft]);

  return <canvas ref={canvasRef} className="tower-cab-view" />;
}
