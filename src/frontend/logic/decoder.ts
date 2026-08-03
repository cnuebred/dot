import * as fflate from 'fflate';
import type { Figure, ToolType } from './stateManager';

/**
 * Decodes a compressed Base64URL payload back into a Figure[] array.
 * Supports v3 (8-char blocks), v4 (11-char blocks) and v5 (12-char blocks) formats.
 * v3: [X1][Y1][TYPE][X2][Y2][C1][C2][W]
 * v4: [X1][Y1][TYPE][X2][Y2][C1][C2][W][OP][RO][ZX]
 * v5: [X1][Y1][TYPE][X2][Y2][C1][C2][C3][W][OP][RO][ZX]
 * where C1C2C3 = 12-bit color index (000-fff).
 */
export function decodeState(payload: string): Figure[] | null {
  if (!payload || payload.length > 512) return null;

  try {
    // 1. Base64URL → binary
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // 2. zlib decompression
    const decompressed = fflate.unzlibSync(bytes);
    const text = new TextDecoder().decode(decompressed);

    // 3. Check version preamble
    const versionMatch = /^v(\d+):/.exec(text);
    if (!versionMatch) return null;
    const version = parseInt(versionMatch[1]!, 10);
    if (version !== 3 && version !== 4 && version !== 5) return null;

    const body = text.slice(versionMatch[0].length);
    const blockLen = version >= 5 ? 12 : version >= 4 ? 11 : 8;

    // 4. Parse blocks
    const figures: Figure[] = [];
    for (let i = 0; i + blockLen <= body.length; i += blockLen) {
      const block = body.slice(i, i + blockLen);
      const x1 = fromHex(block[0]!);
      const y1 = fromHex(block[1]!);
      const type = block[2]! as ToolType;
      const p1 = fromHex(block[3]!);
      const p2 = fromHex(block[4]!);
      // v5: 3 hex chars (12-bit), v3/v4: 2 hex chars (8-bit)
      const color = blockLen >= 12
        ? fromHex(block[5]!) * 256 + fromHex(block[6]!) * 16 + fromHex(block[7]!)
        : fromHex(block[5]!) * 16 + fromHex(block[6]!);
      const weightOffset = blockLen >= 12 ? 8 : 7;
      const weight = fromHex(block[weightOffset]!);

      if (isNaN(x1) || isNaN(y1) || isNaN(p1) || isNaN(p2) || isNaN(color) || isNaN(weight)) {
        return null;
      }

      // v4/v5: extra fields
      const extOffset = blockLen >= 12 ? 9 : 8;
      const opacity = blockLen >= 11 ? fromHex(block[extOffset]!) : 15;
      const rotation = blockLen >= 11 ? fromHex(block[extOffset + 1]!) : 0;
      const zIndex = blockLen >= 11 ? fromHex(block[extOffset + 2]!) : 0;

      figures.push({ x1, y1, type, p1, p2, color, weight, opacity, rotation, zIndex });
    }

    return figures;
  } catch {
    return null;
  }
}

function fromHex(ch: string): number {
  return parseInt(ch, 16);
}