import * as fflate from 'fflate';
import type { Figure, ToolType } from './stateManager';
import { decodeCoord } from '../../shared/coords';

/**
 * Decodes a compressed Base64URL payload back into a Figure[] array.
 * Supports v3 (8-char blocks), v4 (11-char blocks), v5 (12-char blocks),
 * v6 (13-char blocks) and v7 (17-char blocks) formats.
 * v3: [X1][Y1][TYPE][X2][Y2][C1][C2][W]
 * v4: [X1][Y1][TYPE][X2][Y2][C1][C2][W][OP][RO][ZX]
 * v5: [X1][Y1][TYPE][X2][Y2][C1][C2][C3][W][OP][RO][ZX]
 * v6: [X1][Y1][TYPE][X2][Y2][C1][C2][C3][W][OP][RO][ZX][RD]
 * v7: [X1X1][Y1Y1][TYPE][X2X2][Y2Y2][C1][C2][C3][W][OP][RO][ZX][RD]
 * where coordinates are 2 hex chars with offset 128 (signed -128..127),
 * allowing shapes to extend beyond the 15×15 workspace.
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
    if (version < 3 || version > 7) return null;

    const body = text.slice(versionMatch[0].length);
    const isV7 = version >= 7;
    const blockLen = isV7 ? 17 : version >= 6 ? 13 : version >= 5 ? 12 : version >= 4 ? 11 : 8;

    // 4. Parse blocks
    const figures: Figure[] = [];
    for (let i = 0; i + blockLen <= body.length; i += blockLen) {
      const block = body.slice(i, i + blockLen);

      let x1: number, y1: number, p1: number, p2: number;
      let type: ToolType;
      let color: number, weight: number, opacity: number, rotation: number, zIndex: number, radius: number;

      if (isV7) {
        // v7: coords are 2 hex chars with offset; TYPE at index 4.
        x1 = decodeCoord(block.slice(0, 2));
        y1 = decodeCoord(block.slice(2, 4));
        type = block[4]! as ToolType;
        p1 = decodeCoord(block.slice(5, 7));
        p2 = decodeCoord(block.slice(7, 9));
        color = fromHex(block[9]!) * 256 + fromHex(block[10]!) * 16 + fromHex(block[11]!);
        weight = fromHex(block[12]!);
        opacity = fromHex(block[13]!);
        rotation = fromHex(block[14]!);
        zIndex = fromHex(block[15]!);
        radius = fromHex(block[16]!);
      } else {
        // v3-v6: coords are single hex chars.
        x1 = fromHex(block[0]!);
        y1 = fromHex(block[1]!);
        type = block[2]! as ToolType;
        p1 = fromHex(block[3]!);
        p2 = fromHex(block[4]!);
        // v5/v6: 3 hex chars (12-bit), v3/v4: 2 hex chars (8-bit)
        color = blockLen >= 12
          ? fromHex(block[5]!) * 256 + fromHex(block[6]!) * 16 + fromHex(block[7]!)
          : fromHex(block[5]!) * 16 + fromHex(block[6]!);
        weight = fromHex(blockLen >= 12 ? block[8]! : block[7]!);
        // v4/v5/v6: extra fields
        const extOffset = blockLen >= 12 ? 9 : 8;
        opacity = blockLen >= 11 ? fromHex(block[extOffset]!) : 15;
        rotation = blockLen >= 11 ? fromHex(block[extOffset + 1]!) : 0;
        zIndex = blockLen >= 11 ? fromHex(block[extOffset + 2]!) : 0;
        radius = blockLen >= 13 ? fromHex(block[extOffset + 3]!) : 0;
      }

      if (isNaN(x1) || isNaN(y1) || isNaN(p1) || isNaN(p2) || isNaN(color) || isNaN(weight)) {
        return null;
      }

      figures.push({ x1, y1, type, p1, p2, color, weight, opacity, rotation, zIndex, radius });
    }

    return figures;
  } catch {
    return null;
  }
}

function fromHex(ch: string): number {
  return parseInt(ch, 16);
}