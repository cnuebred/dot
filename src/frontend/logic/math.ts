/** Padding ratio inside .grid-canvas (11% – working area 78%). */
export const GRID_PADDING_RATIO = 0.11;

export function getGridPos(offsetX: number, offsetY: number, containerWidth: number): { x: number, y: number } {
  // Account for padding – drawing area is inner 75% of container
  const drawAreaSize = containerWidth * (1 - 2 * GRID_PADDING_RATIO);
  const drawAreaOffset = containerWidth * GRID_PADDING_RATIO;
  const cellSize = drawAreaSize / 16;
  
  // Calculate 0-15 indices (hex 0-f, matching block format)
  const x = Math.round((offsetX - drawAreaOffset) / cellSize);
  const y = Math.round((offsetY - drawAreaOffset) / cellSize);
  
  return {
    x: Math.max(0, Math.min(16, x)),
    y: Math.max(0, Math.min(16, y))
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