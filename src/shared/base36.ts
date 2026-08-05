/**
 * Base-36 encoding helpers (v8 format).
 *
 * v8 encodes coords and effect fields as SINGLE base-36 chars (`0-9a-z`),
 * giving each a range of 0-35 instead of hex's 0-15. This lets a single char
 * address a 32×32 canvas (coords 0-31) and gives the weight/opacity/rotation/
 * z-index/radius fields a wider, finer range.
 */
export const BASE36_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Maximum value representable in a single base-36 digit. */
export const BASE36_MAX = 35;

/** Matches a single base-36 digit char (lowercase). */
export const BASE36_CHAR = /^[0-9a-z]$/;

/**
 * Canonical scale for effect fields (weight/opacity/rotation/z-index/radius).
 * v8 uses 0-35. Legacy (v3-v7) fields are 0-15 and are RESCALED to this
 * canonical scale when decoded, so every figure shares the same scale
 * internally and all renderers only need to know 0-35.
 */
export const EFFECT_MAX = 35;
/** Legacy (hex) effect-field maximum. */
export const LEGACY_EFFECT_MAX = 15;

/**
 * Rescales a legacy 0-15 effect-field value to the canonical 0-35 scale.
 * Rotation is handled specially: the legacy 22.5° step becomes a 10° step
 * (360°/36), using `round(v * 2.25)` so common angles (0/90/180/270°) stay
 * exactly preserved. All other fields use `round(v * 35/15)`.
 */
export function rescaleLegacyField(v: number, isRotation = false): number {
  const c = Math.max(0, Math.min(LEGACY_EFFECT_MAX, v));
  return isRotation
    ? Math.round(c * 2.25)
    : Math.round(c * (EFFECT_MAX / LEGACY_EFFECT_MAX));
}

/** Canonical rotation in degrees for a 0-35 rotation field (10° per step). */
export function rotationDegrees(field: number): number {
  return Math.max(0, Math.min(EFFECT_MAX, field)) * 10;
}

/** Encodes a number (0-35) as a single lowercase base-36 char. Clamps to range. */
export function encode36(v: number): string {
  const clamped = Math.max(0, Math.min(BASE36_MAX, Math.round(v)));
  return BASE36_DIGITS[clamped]!;
}

/** Decodes a single base-36 char to its numeric value (0-35), or -1 if invalid. */
export function decode36(ch: string): number {
  const idx = BASE36_DIGITS.indexOf(ch);
  return idx >= 0 ? idx : -1;
}
