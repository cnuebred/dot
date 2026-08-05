/**
 * Shared tool-endings logic: line/arc cap styles and arrowheads.
 *
 * The tool `type` letter in a block encodes BOTH the shape and its ending:
 *   Line: l=round (default), s=square, b=butt, v=arrowhead
 *   Arc:  a=round (default), k=square, n=butt, z=arrowhead
 *
 * This module is imported by both the frontend (editor previews + committed
 * render) and the backend (svgCompiler), so the rendered output is identical.
 * Cap style + arrowhead geometry are computed here so all renderers agree.
 */

// Tool letters per shape.
export const LINE_TOOLS = ['l', 's', 'b', 'v'] as const;
export const ARC_TOOLS = ['a', 'k', 'n', 'z'] as const;

/** Maps a tool type letter to the SVG `stroke-linecap` value. */
export function getLineCap(type: string): 'round' | 'square' | 'butt' {
  switch (type.toLowerCase()) {
    case 's':
    case 'k':
      return 'square';
    case 'b':
    case 'n':
      return 'butt';
    default:
      return 'round';
  }
}

/** Whether the tool letter carries an arrowhead (filled triangle at the end). */
export function hasArrowhead(type: string): boolean {
  const t = type.toLowerCase();
  return t === 'v' || t === 'z';
}

/** Whether the lower-cased letter is an arc variant. */
export function isArcEnding(type: string): boolean {
  return (ARC_TOOLS as readonly string[]).includes(type.toLowerCase());
}

/**
 * Line weight (0-35 canonical) → stroke width, shared by frontend and backend.
 * Range 0.2 → 3.2. Legacy (v3-v7) weights (0-15) are rescaled to the canonical
 * 0-35 scale before calling, so the min/max (and therefore legacy visuals) are
 * preserved while v8 gets finer control.
 */
export function strokeWidth(weight: number): number {
  const w = Math.max(0, Math.min(35, weight));
  return 0.2 + w * (3.0 / 35);
}

/**
 * Effective radius of curvature for an arc figure (sharp ↔ flat).
 *
 * The `radius` field (0-35 canonical) controls how "sharp" (deeply bent,
 * close to a semicircle) vs "flat" (close to a straight line) the arc is:
 *   - 0  → sharpest: keeps the legacy behavior `r = max(|dx|,|dy|,1)`, so old
 *          payloads render exactly as before (backward compatible).
 *   - 35 → flattest: the arc approaches a straight chord between the endpoints.
 *
 * Implementation uses sagitta (arc height) interpolation and recovers the
 * radius via `R = (D²/4 + h²)/(2h)`, which is always ≥ D/2, so the SVG arc
 * parameters stay valid (no auto-scaling) at any value.
 */
export function arcRadius(x1: number, y1: number, x2: number, y2: number, radiusField = 0): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const D = Math.hypot(dx, dy);
  const rDefault = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const hDefault = rDefault - Math.sqrt(Math.max(rDefault * rDefault - (D / 2) ** 2, 0));
  const t = Math.max(0, Math.min(35, radiusField)) / 35;
  // Flat target: a tiny sagitta so the arc is nearly a straight line.
  const hFlat = Math.max(D, 1) * 0.002;
  const h = hDefault + (hFlat - hDefault) * t;
  const r = (D * D / 4 + h * h) / (2 * h);
  return r;
}

/**
 * Returns an SVG polygon `points` string for a filled arrowhead at the end of
 * the figure, or null when the type has no arrowhead.
 *
 * Arrow direction:
 *  - line: P2 → P1 reversed (tip points back along the line toward P1).
 *  - arc:  tangent at the end point of `M x1 y1 A r r 0 0 1 x2 y2`.
 */
export function arrowheadPoints(
  type: string,
  x1: number, y1: number, x2: number, y2: number,
  lineW: number,
  radiusField = 0,
): string | null {
  if (!hasArrowhead(type)) return null;

  // Unit direction from the END point back toward the body (arrow base).
  let ux: number, uy: number;
  if (isArcEnding(type)) {
    // Tangent unit vector at the end point, then negate to point back along path.
    const dir = arcEndTangent(x1, y1, x2, y2, radiusField);
    ux = -dir.tx;
    uy = -dir.ty;
  } else {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    ux = (x1 - x2) / len; // point from tip (end) back toward start
    uy = (y1 - y2) / len;
  }

  const px = -uy; // perpendicular to u
  const py = ux;
  const tipLen = Math.max(lineW * 2.5, 0.4);
  const halfW = Math.max(lineW * 1.4, 0.35);

  const baseX = x2 + ux * tipLen; // base lies behind the tip (toward body)
  const baseY = y2 + uy * tipLen;
  const lx = baseX + px * halfW;
  const ly = baseY + py * halfW;
  const rx = baseX - px * halfW;
  const ry = baseY - py * halfW;

  return `${x2},${y2} ${lx},${ly} ${rx},${ry}`;
}

/**
 * Unit tangent at the end point (x2,y2) of the SVG arc
 * `M x1 y1 A r r 0 0 1 x2 y2` (sweep=1, y-down). Direction of travel.
 */
function arcEndTangent(
  x1: number, y1: number, x2: number, y2: number,
  radiusField = 0,
): { tx: number; ty: number } {
  const r = arcRadius(x1, y1, x2, y2, radiusField);
  const D = Math.hypot(x2 - x1, y2 - y1);
  const h = D > 0 ? Math.sqrt(Math.max(r * r - (D / 2) ** 2, 0)) : 0;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Chord unit vector + its perpendicular.
  const cl = D || 1;
  const cxu = (x2 - x1) / cl;
  const cyu = (y2 - y1) / cl;
  const px = -cyu; // left perpendicular (y-down)
  const py = cxu;
  // sweep=1 → center on the right of chord direction: rotate chord perp by +90.
  const cx = mx + px * h;
  const cy = my + py * h;
  // Radius vector at end, then rotate by -90° (y-down) for sweep=1 tangent.
  const rxv = x2 - cx;
  const ryv = y2 - cy;
  let tx = ryv;
  let ty = -rxv;
  const len = Math.hypot(tx, ty) || 1;
  return { tx: tx / len, ty: ty / len };
}
