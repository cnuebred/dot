/**
 * Builds an SVG path `d` string for a figure given its bounding box.
 *
 * Shared by draft preview, move preview and highlight rendering so the
 * shape logic lives in ONE place (mirrors the backend `svgCompiler.ts`).
 */
import { arcRadius } from '../../shared/toolEndings';

/**
 * Returns the `d` attribute for a shape's bounding box.
 * `baseType` should be the lower-cased tool type.
 * Line variants: l/s/b/v (round/square/butt/arrowhead) → line path.
 * Arc variants:  a/k/n/z (round/square/butt/arrowhead) → arc path.
 * `radius` (0-15) rounds the corners of rectangles (v6).
 */
export function buildPath(baseType: string, x1: number, y1: number, x2: number, y2: number, radius = 0): string {
  switch (baseType) {
    case 'l': // Line (round)
    case 's': // Line (square)
    case 'b': // Line (butt)
    case 'v': // Line (arrowhead)
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    case 'r': {
      if (radius > 0) {
        const r = Math.min(radius / 15 * 7.5, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
        const rx = Math.min(r, Math.abs(x2 - x1) / 2);
        const ry = Math.min(r, Math.abs(y2 - y1) / 2);
        return `M ${x1 + rx} ${y1} ` +
               `H ${x2 - rx} ` +
               `A ${rx} ${ry} 0 0 1 ${x2} ${y1 + ry} ` +
               `V ${y2 - ry} ` +
               `A ${rx} ${ry} 0 0 1 ${x2 - rx} ${y2} ` +
               `H ${x1 + rx} ` +
               `A ${rx} ${ry} 0 0 1 ${x1} ${y2 - ry} ` +
               `V ${y1 + ry} ` +
               `A ${rx} ${ry} 0 0 1 ${x1 + rx} ${y1} Z`;
      }
      return `M ${x1} ${y1} H ${x2} V ${y2} H ${x1} Z`;
    }
    case 'c': {
      const r = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1) / 2;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
    }
    case 't': {
      const x3 = 2 * x1 - x2;
      return `M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y2} Z`;
    }
    case 'a': // Arc (round)
    case 'k': // Arc (square)
    case 'n': // Arc (butt)
    case 'z': // Arc (arrowhead)
      const r = arcRadius(x1, y1, x2, y2, radius);
      return `M ${x1} ${y1} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${x2} ${y2}`;
    default:
      return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
}

/** Rotation transform string (empty string when no rotation needed). */
export function rotationTransform(rotation: number, x1: number, y1: number, x2: number, y2: number): string {
  if (rotation === 0) return '';
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return `rotate(${rotation} ${cx} ${cy})`;
}
