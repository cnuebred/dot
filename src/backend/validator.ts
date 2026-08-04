import { MAX_COLOR_INDEX, COLOR_INDEX_MASK } from '../shared/palette';

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

// Allowed tool letters: line (stroke only), and stroke/fill pair
// for rectangle, circle, triangle and arc.
// Line endings: l=round, s=square, b=butt, v=arrowhead (stroke only)
// Arc endings:  a=round, k=square, n=butt, z=arrowhead (+ uppercase = fill)
const ALLOWED_TYPES = new Set([
  'l', 's', 'b', 'v',           // line variants (stroke)
  'r', 'R', 'c', 'C', 't', 'T', // rectangle, circle, triangle
  'a', 'A', 'k', 'K', 'n', 'N', 'z', 'Z', // arc variants
]);
const HEX_CHAR = /^[0-9a-fA-F]$/;
const BLOCK_LENGTH_V3 = 8;
const BLOCK_LENGTH_V4 = 11;
const BLOCK_LENGTH_V5 = 12;
const BLOCK_LENGTH_V6 = 13;
const BLOCK_LENGTH_V7 = 17;

/**
 * Validates a string against the dot.qrware specification (Format 3.0 – 7.0).
 * Accepts 8-char blocks (v3), 11-char blocks (v4), 12-char blocks (v5),
 * 13-char blocks (v6) or 17-char blocks (v7).
 * v3: [X1][Y1][TYPE][X2][Y2][C1][C2][W]
 * v4: [X1][Y1][TYPE][X2][Y2][C1][C2][W][OP][RO][ZX]
 * v5: [X1][Y1][TYPE][X2][Y2][C1][C2][C3][W][OP][RO][ZX]
 * v6: [X1][Y1][TYPE][X2][Y2][C1][C2][C3][W][OP][RO][ZX][RD]
 * v7: [X1X1][Y1Y1][TYPE][X2X2][Y2Y2][C1][C2][C3][W][OP][RO][ZX][RD]
 * where v7 coordinates are 2 hex chars with offset 128 (signed -128..127),
 * allowing shapes to extend beyond the 15×15 workspace.
 *
 * `version` must be provided for v7 (its block length is ambiguous via modulo).
 */
export function validatePayload(text: string, version?: number): ValidationResult {
  if (!text || text.length === 0) {
    return { isValid: false, error: 'Empty payload' };
  }

  const isV7 = version === 7;
  let blockLen: number;
  if (isV7) {
    blockLen = BLOCK_LENGTH_V7;
  } else {
    // Legacy detection via modulo.
    if (text.length % BLOCK_LENGTH_V6 === 0) blockLen = BLOCK_LENGTH_V6;
    else if (text.length % BLOCK_LENGTH_V5 === 0) blockLen = BLOCK_LENGTH_V5;
    else if (text.length % BLOCK_LENGTH_V4 === 0) blockLen = BLOCK_LENGTH_V4;
    else if (text.length % BLOCK_LENGTH_V3 === 0) blockLen = BLOCK_LENGTH_V3;
    else {
      return { isValid: false, error: `Invalid length: must be multiple of a supported block size` };
    }
  }

  for (let i = 0; i < text.length; i += blockLen) {
    const block = text.substring(i, i + blockLen);

    if (isV7) {
      // v7: coords at 0-1, 2-3 (x1,y1); type at 4; x2,y2 at 5-6, 7-8.
      const x1 = block.substring(0, 2), y1 = block.substring(2, 4);
      const type = block[4]!;
      const x2 = block.substring(5, 7), y2 = block.substring(7, 9);
      if (!HEX_CHAR.test(x1[0]!) || !HEX_CHAR.test(x1[1]!) ||
          !HEX_CHAR.test(y1[0]!) || !HEX_CHAR.test(y1[1]!) ||
          !HEX_CHAR.test(x2[0]!) || !HEX_CHAR.test(x2[1]!) ||
          !HEX_CHAR.test(y2[0]!) || !HEX_CHAR.test(y2[1]!)) {
        return { isValid: false, error: `Invalid hex coordinate in block at position ${i}` };
      }
      if (!ALLOWED_TYPES.has(type)) {
        return { isValid: false, error: `Invalid tool type at position ${i + 4}` };
      }
      // color C1C2C3 at 9-11, W at 12, OP/RO/ZX at 13-15, RD at 16.
      for (let k = 9; k <= 16; k++) {
        if (!HEX_CHAR.test(block[k]!)) {
          return { isValid: false, error: `Invalid v7 field at position ${i + k}` };
        }
      }
      const colorIndex = parseInt(block.substring(9, 12), 16);
      if (colorIndex > MAX_COLOR_INDEX) {
        return { isValid: false, error: `Color index out of range at position ${i + 9}` };
      }
      continue;
    }

    const [x1, y1, type, x2, y2, c1, c2, w] = block;

    if (!HEX_CHAR.test(x1!) || !HEX_CHAR.test(y1!) || !HEX_CHAR.test(x2!) || !HEX_CHAR.test(y2!)) {
      return { isValid: false, error: `Invalid hex coordinate in block at position ${i}` };
    }

    if (!ALLOWED_TYPES.has(type!)) {
      return { isValid: false, error: `Invalid tool type at position ${i + 2}` };
    }

    // v5/v6: 3 hex chars for 12-bit color (000-fff)
    const c3 = (blockLen === BLOCK_LENGTH_V5 || blockLen === BLOCK_LENGTH_V6) ? block[7] : undefined;
    if (!HEX_CHAR.test(c1!) || !HEX_CHAR.test(c2!) || (c3 !== undefined && !HEX_CHAR.test(c3!))) {
      return { isValid: false, error: `Invalid color code at position ${i + 5}` };
    }

    const colorIndex = c3 !== undefined
      ? parseInt(`${c1}${c2}${c3}`, 16)
      : parseInt(`${c1}${c2}`, 16);
    if (colorIndex > MAX_COLOR_INDEX) {
      return { isValid: false, error: `Color index out of range at position ${i + 5}` };
    }

    // Weight position differs: v3/v4 = block[7], v5/v6 = block[8]
    const weightChar = (blockLen === BLOCK_LENGTH_V5 || blockLen === BLOCK_LENGTH_V6) ? block[8] : w;
    if (!HEX_CHAR.test(weightChar!)) {
      return { isValid: false, error: `Invalid weight at position ${i + 7}` };
    }

    // v4/v5/v6: extra fields OP, RO, ZX (+ RD for v6)
    if (blockLen === BLOCK_LENGTH_V4 || blockLen === BLOCK_LENGTH_V5 || blockLen === BLOCK_LENGTH_V6) {
      const opOffset = (blockLen === BLOCK_LENGTH_V5 || blockLen === BLOCK_LENGTH_V6) ? 9 : 8;
      const op = block[opOffset], ro = block[opOffset + 1], zx = block[opOffset + 2];
      if (!HEX_CHAR.test(op!) || !HEX_CHAR.test(ro!) || !HEX_CHAR.test(zx!)) {
        return { isValid: false, error: `Invalid v${blockLen >= BLOCK_LENGTH_V5 ? (blockLen === BLOCK_LENGTH_V6 ? 6 : 5) : 4} extended fields at position ${i + opOffset}` };
      }
      // v6 adds RD (radius) after ZX.
      if (blockLen === BLOCK_LENGTH_V6) {
        const rd = block[opOffset + 3];
        if (!HEX_CHAR.test(rd!)) {
          return { isValid: false, error: `Invalid radius at position ${i + opOffset + 3}` };
        }
      }
    }
  }

  return { isValid: true };
}