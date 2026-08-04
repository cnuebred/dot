import * as fflate from 'fflate';
import type { Figure } from './stateManager';
import { toHex, toHex2, toHex3 } from './math';
import { encodeCoord } from '../../shared/coords';
import { withVersion } from '../../shared/format';

/**
 * Generates an uncompressed RAW link (plain text, no Base64URL/compression).
 * Format: v7:<block1><block2>... where each block is 17 hex characters.
 * Useful for debugging and inspecting the icon structure.
 */
export function encodeStateRaw(figures: Figure[]): string {
  if (figures.length === 0) return "";

  let body = "";
  for (const fig of figures) {
    body += 
      encodeCoord(fig.x1) + 
      encodeCoord(fig.y1) + 
      fig.type + 
      encodeCoord(fig.p1) + 
      encodeCoord(fig.p2) +
      toHex3(fig.color) +
      toHex(fig.weight) +
      toHex(fig.opacity ?? 15) +
      toHex(fig.rotation ?? 0) +
      toHex(fig.zIndex ?? 0) +
      toHex(fig.radius ?? 0);
  }

  return withVersion(body);
}

/**
 * Encodes a figure array into a compressed Base64URL string.
 * v7 block format (17 chars):
 *   [X1][X1][Y1][Y1][TYPE][X2][X2][Y2][Y2][C1][C2][C3][W][OP][RO][ZX][RD]
 * Each coordinate is 2 hex chars with offset 128 → signed range -128..127,
 * allowing shapes to extend beyond the 15×15 workspace.
 * Before compression, data is prefixed with a version preamble (e.g. `v7:`).
 */
export function encodeState(figures: Figure[]): string {
  if (figures.length === 0) return "";

  // 1. Build text string (17-char v7 format)
  let body = "";
  for (const fig of figures) {
    body += 
      encodeCoord(fig.x1) + 
      encodeCoord(fig.y1) + 
      fig.type + 
      encodeCoord(fig.p1) + 
      encodeCoord(fig.p2) +
      toHex3(fig.color) +
      toHex(fig.weight) +
      toHex(fig.opacity ?? 15) +
      toHex(fig.rotation ?? 0) +
      toHex(fig.zIndex ?? 0) +
      toHex(fig.radius ?? 0);
  }

  const payload = withVersion(body);

  // 2. zlib compression (compatible with unzlibSync on backend)
  const bytes = new TextEncoder().encode(payload);
  const compressed = fflate.zlibSync(bytes);
  
  // 3. Base64URL encoding
  // NOTE: String.fromCharCode(...compressed) may overflow the stack for large icons.
  // The loop builds the string in chunks (8KB), which is stack-safe.
  let binaryString = '';
  const CHUNK_SIZE = 8192;
  for (let i = 0; i < compressed.length; i += CHUNK_SIZE) {
    const chunk = compressed.subarray(i, Math.min(i + CHUNK_SIZE, compressed.length));
    binaryString += String.fromCharCode(...chunk);
  }
  return btoa(binaryString)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}