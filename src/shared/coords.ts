/**
 * Shared coordinate encoding for format v7+.
 *
 * v3–v6 store each coordinate as a single hex char → range 0–15.
 * v7 stores each coordinate as TWO hex chars with a signed offset of 128,
 * giving a range of -128..127. This lets shapes extend beyond the 15×15
 * workspace (the overflow is clipped during rendering).
 *
 *   value = raw - OFFSET         (raw = stored 0..255)
 *   raw   = value + OFFSET       (value in -128..127)
 */
export const COORD_OFFSET = 128;
/** Inclusive valid range for a single signed coordinate. */
export const COORD_MIN = -COORD_OFFSET;   // -128
export const COORD_MAX = COORD_OFFSET - 1; // 127

const clampCoord = (v: number) => Math.max(COORD_MIN, Math.min(COORD_MAX, v));

/**
 * Encodes a signed coordinate into a 2-char lowercase hex string.
 * Values are clamped to [-128, 127] so the result ALWAYS fits in exactly
 * two hex chars – out-of-range coords are truncated to the nearest bound.
 * (The editor's unclamped move can exceed the range; clamping keeps blocks
 * valid so the payload is never corrupted.)
 */
export function encodeCoord(v: number): string {
  return (Math.round(clampCoord(v)) + COORD_OFFSET).toString(16).toLowerCase().padStart(2, '0');
}

/** Decodes a 2-char hex string into a signed coordinate. */
export function decodeCoord(raw: string): number {
  return parseInt(raw, 16) - COORD_OFFSET;
}
