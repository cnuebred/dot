import * as fflate from 'fflate';
import type { Figure } from './stateManager';
import { toHex3 } from './math';
import { encode36, encode36Wide } from '../../shared/base36';
import { withVersion, FORMAT_VERSION } from '../../shared/format';

/** Canvases above this max coordinate use wide (2-char) coordinates. */
export const WIDE_COORD_THRESHOLD = 31;

/**
 * Generates an uncompressed RAW link (plain text, no Base64URL/compression).
 * v8 format: `v8:<size>:<block1><block2>...`
 *
 * For sizes ≤ 31 (16×16, 32×32), each block is 13 chars with single base-36
 * coordinates (0-35):
 *   [X1][Y1][TYPE][X2][Y2][C1][C2][C3][W][OP][RO][ZX][RD]
 *
 * For sizes > 31 (64×64, 128×128), coordinates need two base-36 chars (0-1295),
 * so each block is 17 chars:
 *   [X1][X1][Y1][Y1][TYPE][X2][X2][Y2][Y2][C1][C2][C3][W][OP][RO][ZX][RD]
 *
 * `size` is the canvas max coordinate (15/31/63/127). Color is 3 hex chars.
 */
export function encodeStateRaw(figures: Figure[], size = 15): string {
  if (figures.length === 0) return "";

  const wide = size > WIDE_COORD_THRESHOLD;
  let body = "";
  for (const fig of figures) {
    if (wide) {
      body +=
        encode36Wide(fig.x1) +
        encode36Wide(fig.y1) +
        fig.type +
        encode36Wide(fig.p1) +
        encode36Wide(fig.p2) +
        toHex3(fig.color) +
        encode36(fig.weight) +
        encode36(fig.opacity ?? 35) +
        encode36(fig.rotation ?? 0) +
        encode36(fig.zIndex ?? 0) +
        encode36(fig.radius ?? 0);
    } else {
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
  }

  return withVersion(`${size}:${body}`);
}

/**
 * Encodes a figure array into a compressed Base64URL string.
 * v8 block format (13 chars, single base-36 coordinates 0-35):
 *   [X1][Y1][TYPE][X2][Y2][C1][C2][C3][W][OP][RO][ZX][RD]
 *
 * Only canvases ≤ 31 (16×16, 32×32) are encoded here — larger canvases (64/128)
 * exceed the single base-36 coordinate range and are NOT backend/hotlink-able.
 * They use `encodeStateRaw` (wide coords) for client-side export/import only.
 */
export function encodeState(figures: Figure[], size = 15): string {
  if (figures.length === 0) return "";
  if (size > WIDE_COORD_THRESHOLD) return ""; // not hotlink-able

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