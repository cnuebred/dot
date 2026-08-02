import * as fflate from 'fflate';
import type { Figure, ToolType } from './stateManager';

/**
 * Decodes a compressed Base64URL payload back into a Figure[] array.
 * Supports v3 (8-char blocks) and v4 (11-char blocks) formats.
 * v3: [X1][Y1][TYPE][X2][Y2][C1][C2][W]
 * v4: [X1][Y1][TYPE][X2][Y2][C1][C2][W][OP][RO][ZX]
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
    if (version !== 3 && version !== 4) return null;

    const body = text.slice(versionMatch[0].length);
    const blockLen = version >= 4 ? 11 : 8;

    // 4. Parse blocks
    const figures: Figure[] = [];
    for (let i = 0; i + blockLen <= body.length; i += blockLen) {
      const block = body.slice(i, i + blockLen);
      const x1 = fromHex(block[0]!);
      const y1 = fromHex(block[1]!);
      const type = block[2]! as ToolType;
      const p1 = fromHex(block[3]!);
      const p2 = fromHex(block[4]!);
      const color = fromHex(block[5]!) * 16 + fromHex(block[6]!);
      const weight = fromHex(block[7]!);

      if (isNaN(x1) || isNaN(y1) || isNaN(p1) || isNaN(p2) || isNaN(color) || isNaN(weight)) {
        return null;
      }

      // v4: extra fields (blockLen=11 for v4, 8 for v3)
      const opacity = blockLen >= 11 ? fromHex(block[8]!) : 15;
      const rotation = blockLen >= 11 ? fromHex(block[9]!) : 0;
      const zIndex = blockLen >= 11 ? fromHex(block[10]!) : 0;

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