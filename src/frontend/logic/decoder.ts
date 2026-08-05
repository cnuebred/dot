import * as fflate from 'fflate';
import type { Figure, ToolType } from './stateManager';
import { decode36, decode36Wide, rescaleLegacyField } from '../../shared/base36';

/** Canvases above this max coordinate use wide (2-char) coordinates. */
export const WIDE_COORD_THRESHOLD = 31;

/**
 * Decodes an icon payload back into a Figure[] array.
 *
 * Accepts BOTH:
 *  - compressed Base64URL payloads (`/r/...`), supporting legacy v3-v7 and the
 *    current v8 (13 base-36 chars), AND
 *  - raw (uncompressed) text payloads (`/raw/...` or pasted text), which also
 *    carry 64×64 (size 63) and 128×128 (size 127) canvases via wide coords.
 *
 * v8 narrow block (size ≤ 31), 13 chars:
 *   [X1][Y1][TYPE][X2][Y2][C1][C2][C3][W][OP][RO][ZX][RD]  (single base-36 coords)
 * v8 wide block (size > 31), 17 chars:
 *   [X1][X1][Y1][Y1][TYPE][X2][X2][Y2][Y2][C1][C2][C3][W][OP][RO][ZX][RD]
 *   (coordinates are two base-36 chars → 0-1295, covering 0-127)
 *
 * Legacy effect fields (0-15) are RESCALED to the canonical 0-35 scale so all
 * figures share the same scale internally (renderers only know 0-35).
 *
 * Returns `{ figures, size }` where `size` is the canvas max coordinate, or
 * null on invalid payload.
 */
export interface DecodedState {
  figures: Figure[];
  size: number;
}

export function decodeState(payload: string): DecodedState | null {
  if (!payload || payload.length === 0) return null;

  try {
    let text: string;
    let isRaw = false;

    if (payload.startsWith('v')) {
      // Raw (uncompressed) text payload, e.g. "v8:63:...".
      isRaw = true;
      text = payload;
    } else {
      // Compressed Base64URL.
      if (payload.length > 512) return null;
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const decompressed = fflate.unzlibSync(bytes);
      text = new TextDecoder().decode(decompressed);
    }

    // 3. Check version preamble
    const versionMatch = /^v(\d+):/.exec(text);
    if (!versionMatch) return null;
    const version = parseInt(versionMatch[1]!, 10);
    if (version < 3 || version > 8) return null;

    let body = text.slice(versionMatch[0].length);
    let size = 15;
    const isV8 = version === 8;

    if (isV8) {
      // v8 carries an optional canvas-size segment: v8:<size>:<body>.
      const sizeMatch = /^(\d+):/.exec(body);
      if (sizeMatch) {
        size = parseInt(sizeMatch[1]!, 10);
        body = body.slice(sizeMatch[0].length);
      }
    }

    // v8 uses wide (17-char) blocks for canvases > 31.
    const wide = isV8 && size > WIDE_COORD_THRESHOLD;
    const blockLen = isV8 ? (wide ? 17 : 13) : version >= 7 ? 17 : version >= 6 ? 13 : version >= 5 ? 12 : version >= 4 ? 11 : 8;

    // 4. Parse blocks
    const figures: Figure[] = [];
    for (let i = 0; i + blockLen <= body.length; i += blockLen) {
      const block = body.slice(i, i + blockLen);

      let x1: number, y1: number, p1: number, p2: number;
      let type: ToolType;
      let color: number, weight: number, opacity: number, rotation: number, zIndex: number, radius: number;

      if (isV8) {
        if (wide) {
          // v8 wide: coordinates are 2 base-36 chars; TYPE at index 4.
          x1 = decode36Wide(block.slice(0, 2));
          y1 = decode36Wide(block.slice(2, 4));
          type = block[4]! as ToolType;
          p1 = decode36Wide(block.slice(5, 7));
          p2 = decode36Wide(block.slice(7, 9));
          color = fromHex(block[9]!) * 256 + fromHex(block[10]!) * 16 + fromHex(block[11]!);
          weight = decode36(block[12]!);
          opacity = decode36(block[13]!);
          rotation = decode36(block[14]!);
          zIndex = decode36(block[15]!);
          radius = decode36(block[16]!);
        } else {
          // v8 narrow: base-36 single-char fields.
          x1 = decode36(block[0]!);
          y1 = decode36(block[1]!);
          type = block[2]! as ToolType;
          p1 = decode36(block[3]!);
          p2 = decode36(block[4]!);
          color = fromHex(block[5]!) * 256 + fromHex(block[6]!) * 16 + fromHex(block[7]!);
          weight = decode36(block[8]!);
          opacity = decode36(block[9]!);
          rotation = decode36(block[10]!);
          zIndex = decode36(block[11]!);
          radius = decode36(block[12]!);
        }
      } else if (version >= 7) {
        // v7: coords are 2 hex chars with offset; TYPE at index 4.
        x1 = decodeCoord(block.slice(0, 2));
        y1 = decodeCoord(block.slice(2, 4));
        type = block[4]! as ToolType;
        p1 = decodeCoord(block.slice(5, 7));
        p2 = decodeCoord(block.slice(7, 9));
        color = fromHex(block[9]!) * 256 + fromHex(block[10]!) * 16 + fromHex(block[11]!);
        // Legacy 0-15 → rescale to canonical 0-35.
        weight = rescaleLegacyField(fromHex(block[12]!));
        opacity = rescaleLegacyField(fromHex(block[13]!));
        rotation = rescaleLegacyField(fromHex(block[14]!), true);
        zIndex = rescaleLegacyField(fromHex(block[15]!));
        radius = rescaleLegacyField(fromHex(block[16]!));
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
        const legacyWeight = fromHex(blockLen >= 12 ? block[8]! : block[7]!);
        weight = rescaleLegacyField(legacyWeight);
        // v4/v5/v6: extra fields
        const extOffset = blockLen >= 12 ? 9 : 8;
        const hasExt = blockLen >= 11;
        opacity = hasExt ? rescaleLegacyField(fromHex(block[extOffset]!)) : 35;
        rotation = hasExt ? rescaleLegacyField(fromHex(block[extOffset + 1]!), true) : 0;
        zIndex = hasExt ? rescaleLegacyField(fromHex(block[extOffset + 2]!)) : 0;
        radius = blockLen >= 13 ? rescaleLegacyField(fromHex(block[extOffset + 3]!)) : 0;
      }

      // v8 uses base-36 fields; a -1 from decode36 means an invalid char.
      const coordsOk = isV8
        ? x1 >= 0 && y1 >= 0 && p1 >= 0 && p2 >= 0 && weight >= 0 && opacity >= 0 && rotation >= 0 && zIndex >= 0 && radius >= 0
        : !isNaN(x1) && !isNaN(y1) && !isNaN(p1) && !isNaN(p2) && !isNaN(color) && !isNaN(weight);
      if (!coordsOk) {
        return null;
      }

      figures.push({ x1, y1, type, p1, p2, color, weight, opacity, rotation, zIndex, radius });
    }

    return { figures, size };
  } catch {
    return null;
  }
}

function fromHex(ch: string): number {
  return parseInt(ch, 16);
}

function decodeCoord(raw: string): number {
  return parseInt(raw, 16) - 128;
}

