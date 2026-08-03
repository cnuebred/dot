import { MAX_COLOR_INDEX, COLOR_INDEX_MASK } from '../shared/palette';

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

// Allowed tool letters: line (stroke only), and stroke/fill pair
// for rectangle, circle, triangle and arc.
const ALLOWED_TYPES = new Set(['l', 'r', 'R', 'c', 'C', 't', 'T', 'a', 'A']);
const HEX_CHAR = /^[0-9a-fA-F]$/;
const BLOCK_LENGTH_V3 = 8;
const BLOCK_LENGTH_V4 = 11;
const BLOCK_LENGTH_V5 = 12;

/**
 * Validates a string against the dot.qrware specification (Format 3.0 / 4.0 / 5.0)
 * Accepts 8-char blocks (v3), 11-char blocks (v4) or 12-char blocks (v5).
 * v3: [X1][Y1][TYPE][X2][Y2][C1][C2][W]
 * v4: [X1][Y1][TYPE][X2][Y2][C1][C2][W][OP][RO][ZX]
 * v5: [X1][Y1][TYPE][X2][Y2][C1][C2][C3][W][OP][RO][ZX]
 * where C1C2C3 = 12-bit color index (000-fff), OP=opacity, RO=rotation, ZX=z-index.
 */
export function validatePayload(text: string): ValidationResult {
  if (!text || text.length === 0) {
    return { isValid: false, error: 'Empty payload' };
  }

  // Detect block length: v3=8, v4=11, v5=12
  let blockLen: number;
  if (text.length % BLOCK_LENGTH_V5 === 0) {
    blockLen = BLOCK_LENGTH_V5;
  } else if (text.length % BLOCK_LENGTH_V4 === 0) {
    blockLen = BLOCK_LENGTH_V4;
  } else if (text.length % BLOCK_LENGTH_V3 === 0) {
    blockLen = BLOCK_LENGTH_V3;
  } else {
    return { isValid: false, error: `Invalid length: must be multiple of ${BLOCK_LENGTH_V3} (v3), ${BLOCK_LENGTH_V4} (v4) or ${BLOCK_LENGTH_V5} (v5)` };
  }

  for (let i = 0; i < text.length; i += blockLen) {
    const block = text.substring(i, i + blockLen);
    const [x1, y1, type, x2, y2, c1, c2, w] = block;

    if (!HEX_CHAR.test(x1!) || !HEX_CHAR.test(y1!) || !HEX_CHAR.test(x2!) || !HEX_CHAR.test(y2!)) {
      return { isValid: false, error: `Invalid hex coordinate in block at position ${i}` };
    }

    if (!ALLOWED_TYPES.has(type!)) {
      return { isValid: false, error: `Invalid tool type at position ${i + 2}` };
    }

    // v5: 3 hex chars for 12-bit color (000-fff)
    const c3 = blockLen === BLOCK_LENGTH_V5 ? block[7] : undefined;
    if (!HEX_CHAR.test(c1!) || !HEX_CHAR.test(c2!) || (c3 !== undefined && !HEX_CHAR.test(c3!))) {
      return { isValid: false, error: `Invalid color code at position ${i + 5}` };
    }

    const colorIndex = c3 !== undefined
      ? parseInt(`${c1}${c2}${c3}`, 16)
      : parseInt(`${c1}${c2}`, 16);
    if (colorIndex > MAX_COLOR_INDEX) {
      return { isValid: false, error: `Color index out of range at position ${i + 5}` };
    }

    // Weight position differs: v3/v4 = block[7], v5 = block[8]
    const weightChar = blockLen === BLOCK_LENGTH_V5 ? block[8] : w;
    if (!HEX_CHAR.test(weightChar!)) {
      return { isValid: false, error: `Invalid weight at position ${i + 7}` };
    }

    // v4/v5: extra fields OP, RO, ZX
    if (blockLen === BLOCK_LENGTH_V4 || blockLen === BLOCK_LENGTH_V5) {
      const opOffset = blockLen === BLOCK_LENGTH_V5 ? 9 : 8;
      const op = block[opOffset], ro = block[opOffset + 1], zx = block[opOffset + 2];
      if (!HEX_CHAR.test(op!) || !HEX_CHAR.test(ro!) || !HEX_CHAR.test(zx!)) {
        return { isValid: false, error: `Invalid v${blockLen === BLOCK_LENGTH_V5 ? 5 : 4} extended fields at position ${i + opOffset}` };
      }
    }
  }

  return { isValid: true };
}