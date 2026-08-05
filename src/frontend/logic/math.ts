/**
 * Maps a pixel offset within a drawing box to grid coordinates.
 * `size` is the width (in px) of the drawing area the offset refers to.
 * `maxCoord` is the highest grid coordinate on the canvas (e.g. 15 for a
 * 16-point canvas, 63 for 64-point, 127 for 128-point). The cell size is
 * derived from `size / maxCoord` so the full coordinate range maps exactly
 * onto the viewport, matching the SVG viewBox.
 * No padding math here – the drawing area is the full grid; any visual frame
 * around it is handled via the SVG's own bounding box.
 */
export function getGridPos(offsetX: number, offsetY: number, size: number, maxCoord = 15): { x: number, y: number } {
  const cellSize = size / maxCoord;
  const x = Math.round(offsetX / cellSize);
  const y = Math.round(offsetY / cellSize);

  return {
    x: Math.max(0, Math.min(maxCoord, x)),
    y: Math.max(0, Math.min(maxCoord, y))
  };
}

/**
 * Like getGridPos but WITHOUT clamping to the workspace. Used for moving
 * shapes beyond the workspace edge (v7): the shape may extend past the
 * canvas, and the overflow is clipped during rendering.
 */
export function getGridPosUnclamped(offsetX: number, offsetY: number, size: number, maxCoord = 15): { x: number, y: number } {
  const cellSize = size / maxCoord;
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