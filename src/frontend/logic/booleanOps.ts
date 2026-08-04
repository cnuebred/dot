/**
 * Boolean (Pathfinder) operations for two selected figures.
 *
 * Works on the grid-snapped bounding boxes of the two figures and produces
 * ordinary Rectangle figures, so the result stays within the stable v5 block
 * format (no format bump, old links remain compatible).
 *
 * Operations:
 *   union     – outer bounding box of the two figures ("sumowanie").
 *   intersect – overlapping region ("nakładanie" / część wspólna).
 *   subtract  – figure A minus figure B ("wycinanie"). May yield 0–4 rects.
 *
 * Coordinates are clamped to the 0–15 grid.
 */
import type { Figure } from './stateManager';

export type BoolOp = 'union' | 'intersect' | 'subtract';

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number) => Math.round(v);

/** Normalized bounding box (min/max) of a figure. */
function toRect(f: Figure): Rect {
  return {
    x1: Math.min(f.x1, f.p1),
    y1: Math.min(f.y1, f.p2),
    x2: Math.max(f.x1, f.p1),
    y2: Math.max(f.y1, f.p2),
  };
}

function isValid(r: Rect): boolean {
  return r.x2 - r.x1 > 0 && r.y2 - r.y1 > 0;
}

function rectToFigure(r: Rect, from: Figure): Figure {
  return {
    x1: round(clamp(r.x1, 0, 15)),
    y1: round(clamp(r.y1, 0, 15)),
    p1: round(clamp(r.x2, 0, 15)),
    p2: round(clamp(r.y2, 0, 15)),
    type: 'r',
    color: from.color,
    weight: from.weight,
    opacity: from.opacity,
    rotation: 0,
    zIndex: from.zIndex,
    radius: from.radius ?? 0,
  };
}

function unionRects(a: Rect, b: Rect): Rect {
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  };
}

function intersectRects(a: Rect, b: Rect): Rect | null {
  const r: Rect = {
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
    x2: Math.min(a.x2, b.x2),
    y2: Math.min(a.y2, b.y2),
  };
  return isValid(r) ? r : null;
}

/**
 * Subtracts rect B from rect A (A minus B). Returns up to 4 rects that cover
 * the region of A outside B (top/bottom/left/right slices).
 */
function subtractRects(a: Rect, b: Rect): Rect[] {
  const result: Rect[] = [];

  // Vertical slices: region of A above and below B.
  const top: Rect = { x1: a.x1, y1: a.y1, x2: a.x2, y2: Math.min(b.y1, a.y2) };
  const bottom: Rect = { x1: a.x1, y1: Math.max(b.y2, a.y1), x2: a.x2, y2: a.y2 };
  if (isValid(top)) result.push(top);
  if (isValid(bottom)) result.push(bottom);

  // Horizontal slice of A that overlaps B's vertical band, minus B's width.
  const bandY1 = Math.max(a.y1, b.y1);
  const bandY2 = Math.min(a.y2, b.y2);
  if (bandY1 < bandY2) {
    const left: Rect = { x1: a.x1, y1: bandY1, x2: Math.min(b.x1, a.x2), y2: bandY2 };
    const right: Rect = { x1: Math.max(b.x2, a.x1), y1: bandY1, x2: a.x2, y2: bandY2 };
    if (isValid(left)) result.push(left);
    if (isValid(right)) result.push(right);
  }

  return result;
}

/**
 * Applies a boolean operation to two figures, returning the resulting
 * Rectangle figure(s). Returns an empty array when the result is empty
 * (e.g. no overlap for intersect).
 */
export function applyBoolean(a: Figure, b: Figure, op: BoolOp): Figure[] {
  const ra = toRect(a);
  const rb = toRect(b);

  switch (op) {
    case 'union': {
      const r = unionRects(ra, rb);
      if (!isValid(r)) return [];
      return [rectToFigure(r, a)];
    }
    case 'intersect': {
      const r = intersectRects(ra, rb);
      if (!r) return [];
      return [rectToFigure(r, a)];
    }
    case 'subtract': {
      return subtractRects(ra, rb).map((r) => rectToFigure(r, a));
    }
  }
}
