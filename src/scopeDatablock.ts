import { pointOutFor, roleLabel } from "./pointOuts";
import { getLeaderFor, leaderEnd, type Fidelity } from "./scopeDisplay";

/** Shared leader-line + datablock renderer for every scope (the piece all
 * four CRC displays share): the leader direction/length comes from the
 * per-track style (scope default unless this track has its own), LDB
 * blocks draw dimmer than FDB ones, and a point-out tints and blinks the
 * whole block through its pending / accepted / rejected states.
 */

const AMBER = "#ffb020";
const RED = "#ff6b5e";

interface Args {
  ctx: CanvasRenderingContext2D;
  callsign: string;
  /** Screen position of the target glyph. */
  sx: number;
  sy: number;
  /** Glyph color - also the leader-line color. */
  color: string;
  fidelity: Fidelity;
  /** Content lines for this fidelity (caller builds them - each view
   * carries different fields). */
  lines: string[];
}

export function drawLeaderBlock({ ctx, callsign, sx, sy, color, fidelity, lines }: Args) {
  const style = getLeaderFor(callsign);
  const len = Math.max(1, style.lengthPx);
  const { dx, dy } = leaderEnd(style);
  const ux = dx / len;
  const uy = dy / len;

  const startX = sx + ux * 4.5;
  const startY = sy + uy * 4.5;
  const ex = sx + dx;
  const ey = sy + dy;

  const po = pointOutFor(callsign);
  const now = Date.now();
  const blinkOn = Math.floor(now / 300) % 2 === 0;
  let textColor = color;
  let hide = false;
  let suffix: string | null = null;
  if (po) {
    if (po.state === "pending") {
      textColor = AMBER;
      suffix = `PO ${roleLabel(po.to)}`;
      hide = !blinkOn;
    } else if (po.state === "rejected") {
      textColor = RED;
      suffix = "!! PO";
      hide = !blinkOn;
    } else {
      suffix = `PO ${roleLabel(po.to)}`; // accepted, steady
    }
  }

  ctx.save();
  if (fidelity === "LDB") ctx.globalAlpha *= 0.55; // limited block, dimmed

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  // Text sits on whichever side of the target the leader points, so a
  // leader aimed upper-left puts the block upper-left of the target.
  const right = dx >= 0;
  ctx.textAlign = right ? "left" : "right";
  const tx = ex + (right ? 3 : -3);

  if (!hide) {
    ctx.fillStyle = textColor;
    lines.forEach((line, i) => {
      ctx.fillText(line, tx, ey - 2 + i * 11);
    });
    if (suffix) {
      ctx.fillStyle = po && po.state === "accepted" ? AMBER : textColor;
      ctx.fillText(suffix, tx, ey - 2 + lines.length * 11);
    }
  }

  ctx.restore(); // restores textAlign, fillStyle and alpha with it
}