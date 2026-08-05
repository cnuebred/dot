import * as fflate from 'fflate';
import type { Figure } from './stateManager';
import { toHex3 } from './math';
import { encode36 } from '../../shared/base36';
import { withVersion, FORMAT_VERSION } from '../../shared/format';

/**
 * Generates an uncompressed RAW link (plain text, no Base64URL/compression).
 * v8 format: `v8:<size>:<block1><block2>...` where each block is 13 chars:
 *   [X1][Y1][TYPE][X2][Y2][C1][C2][C3][W][OP][RO][ZX][RD]
 * Coords + effect fields are single BASE-36 chars (0-9+a-z → 0-35). Color is
 * 3 hex chars (12-bit). `size` is the canvas max coord (15 or 31).
 */
export function encodeStateRaw(figures: Figure[], size = 15): string {
  if (figures.length === 0) return "";

  let body = "";
  for (const fig of figures) {
    body +=
      encode36(fig.x1) +
      encode36(fig.y1) +
      fig.type +
      encode36(fig.p1) +
      encode36(fig.p2) +
      toHex3(fig.color) +
      encode36(fig.weight) +
      encode36(fig.opacity ?? 35) +
      encode36(fig.rotation ?? 0) +
      encode36(fig.zIndex ?? 0) +
      encode36(fig.radius ?? 0);
  }

  return withVersion(`${size}:${body}`);
}

/**
 * Encodes a figure array into a compressed Base64URL string.
 * v8 block format (13 chars):
 *   [X1][Y1][TYPE][X2][Y2][C1][C2][C3][W][OP][RO][ZX][RD]
 * Every single-symbol field is a BASE-36 digit (0-9+a-z → value 0-35). Color
 * stays 3 hex chars (12-bit). Coordinates 0-35 support up to a 32×32 canvas.
 * Before compression, data is prefixed with the version + size preamble,
 * e.g. `v8:31:...`.
 */
export function encodeState(figures: Figure[], size = 15): string {
  if (figures.length === 0) return "";

  // 1. Build text string (13-char v8 blocks, base-36 fields)
  let body = "";
  for (const fig of figures) {
    body +=
      encode36(fig.x1) +
      encode36(fig.y1) +
      fig.type +
      encode36(fig.p1) +
      encode36(fig.p2) +
      toHex3(fig.color) +
      encode36(fig.weight) +
      encode36(fig.opacity ?? 35) +
      encode36(fig.rotation ?? 0) +
      encode36(fig.zIndex ?? 0) +
      encode36(fig.radius ?? 0);
  }

  const payload = withVersion(`${size}:${body}`);

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