/**
 * Maps a pixel offset within a drawing box to 0-15 grid coordinates.
 * `size` is the width (in px) of the drawing area the offset refers to.
 * No padding math here – the drawing area is the full 16×16 grid; any
 * visual frame around it is handled via the SVG's own bounding box.
 */
export function getGridPos(offsetX: number, offsetY: number, size: number): { x: number, y: number } {
  const cellSize = size / 15;
  const x = Math.round(offsetX / cellSize);
  const y = Math.round(offsetY / cellSize);

  return {
    x: Math.max(0, Math.min(16, x)),
    y: Math.max(0, Math.min(16, y))
  };
}

/**
 * Like getGridPos but WITHOUT clamping to 0-15. Used for moving shapes beyond
 * the workspace edge (v7): the shape may extend past the 15×15 canvas, and
 * the overflow is clipped during rendering.
 */
export function getGridPosUnclamped(offsetX: number, offsetY: number, size: number): { x: number, y: number } {
  const cellSize = size / 15;
  return {
    x: Math.round(offsetX / cellSize),
    y: Math.round(offsetY / cellSize),
  };
}

export function toHex(val: number): string {
  return val.toString(16).toLowerCase();
}

/** Encodes color index (0-63) as 2-char hex, required by block format. */
export function toHex2(val: number): string {
  return val.toString(16).toLowerCase().padStart(2, '0');
}

/** Encodes 12-bit color value (0-4095) as 3-char hex, required by v5 block format. */
export function toHex3(val: number): string {
  return val.toString(16).toLowerCase().padStart(3, '0');
}