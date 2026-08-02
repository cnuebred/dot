import * as fflate from 'fflate';
import type { Figure } from './stateManager';
import { toHex, toHex2 } from './math';
import { withVersion } from '../../shared/format';

/**
 * Generates an uncompressed RAW link (plain text, no Base64URL/compression).
 * Format: v4:<block1><block2>... where each block is 11 hex characters.
 * Useful for debugging and inspecting the icon structure.
 */
export function encodeStateRaw(figures: Figure[]): string {
  if (figures.length === 0) return "";

  let body = "";
  for (const fig of figures) {
    body += 
      toHex(fig.x1) + 
      toHex(fig.y1) + 
      fig.type + 
      toHex(fig.p1) + 
      toHex(fig.p2) +
      toHex2(fig.color) +
      toHex(fig.weight) +
      toHex(fig.opacity ?? 15) +
      toHex(fig.rotation ?? 0) +
      toHex(fig.zIndex ?? 0);
  }

  return withVersion(body);
}

/**
 * Encodes a figure array into a compressed Base64URL string.
 * v4 block format (11 chars): [X1][Y1][TYPE][X2][Y2][C1][C2][W][OP][RO][ZX]
 *   OP = opacity (0-f), RO = rotation (0-f), ZX = z-index (0-f)
 * Before compression, data is prefixed with a version preamble (e.g. `v4:`),
 * allowing the backend to unambiguously identify the format version
 * and reject unknown/old payloads.
 */
export function encodeState(figures: Figure[]): string {
  if (figures.length === 0) return "";

  // 1. Build text string (11-char v4 format)
  let body = "";
  for (const fig of figures) {
    body += 
      toHex(fig.x1) + 
      toHex(fig.y1) + 
      fig.type + 
      toHex(fig.p1) + 
      toHex(fig.p2) +
      toHex2(fig.color) +
      toHex(fig.weight) +
      toHex(fig.opacity ?? 15) +
      toHex(fig.rotation ?? 0) +
      toHex(fig.zIndex ?? 0);
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