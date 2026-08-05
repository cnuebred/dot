import { getColorByIndex, getPaletteId, getColorIndex } from '../shared/palette';
import { getLineCap, hasArrowhead, arrowheadPoints, strokeWidth, arcRadius } from '../shared/toolEndings';
import { decodeCoord } from '../shared/coords';

export interface CompileOptions {
  /** Gdy ustawione, dodaje nieprzezroczyste tło (przydatne dla faviconów w niektórych przeglądarkach). */
  faviconBackground?: string;
  isPreview?: boolean;
  /** Format version. Must be provided for v7 (block length is ambiguous via modulo). */
  version?: number;
}

/**
 * Translates a validated string into SVG XML.
 * v3 block format (8 chars): [X1][Y1][TYPE][X2][Y2][C1][C2][W]
 * v4 block format (11 chars): [X1][Y1][TYPE][X2][Y2][C1][C2][W][OP][RO][ZX]
 *   OP = opacity (0-f → 0.0–1.0), RO = rotation (0-f → 0°–337.5°, step 22.5°),
 *   ZX = z-index (0-f, higher = on top).
 * Lowercase tool letter = stroke, uppercase = fill (line is always stroke).
 * [C1][C2] is color index (00-3f) from the 64-color palette shared by front/backend.
 * [W] is line weight (0-f), mapped to stroke-width 0.2–3.2.
 * ViewBox: 0 0 15 15
 *
 * Why 15×15: the figures/grid dots live on integer coordinates 0–15 (16 points).
 * A viewBox of "0 0 15 15" maps that 0–15 range exactly onto the viewport, so the
 * 16 points span edge-to-edge and the drawing is perfectly centered. A "0 0 16 16"
 * box would leave an extra 1/16 margin on the right/bottom, shifting content off-center.
 */
export function compileToSvg(text: string, options: CompileOptions = {}): string {
  const BLOCK_V3 = 8;
  const BLOCK_V4 = 11;
  const BLOCK_V5 = 12;
  const BLOCK_V6 = 13;
  const BLOCK_V7 = 17;

  const isV7 = options.version === 7;
  let blockLen: number;
  if (isV7) {
    blockLen = BLOCK_V7;
  } else {
    blockLen = text.length % BLOCK_V6 === 0 ? BLOCK_V6
      : text.length % BLOCK_V5 === 0 ? BLOCK_V5
      : text.length % BLOCK_V4 === 0 ? BLOCK_V4
      : BLOCK_V3;
  }
  const isV4 = blockLen === BLOCK_V4;
  const isV5 = blockLen === BLOCK_V5;
  const isV6 = blockLen === BLOCK_V6;

  // 16×16 grid – coordinates 0-15. ViewBox is 15×15 so the 0-15 range fills the
  // whole viewport (16 points edge-to-edge, perfectly centered).
  const additionalPadding = 0;
  const sizeWithPadding = 15;

  interface ShapePart {
    zIndex: number;
    xml: string;
    isKnockout: boolean;
  }
  const parts: ShapePart[] = [];

  for (let i = 0; i < text.length; i += blockLen) {
    const block = text.substring(i, i + blockLen);

    let x1: number, y1: number, type: string, x2: number, y2: number;
    let colorIndex: number, weight: number, opacity: number, rotation: number, zIndex: number, radius: number;

    if (isV7) {
      // v7: coords are 2 hex chars with offset; type at index 4.
      x1 = decodeCoord(block.substring(0, 2)) + additionalPadding;
      y1 = decodeCoord(block.substring(2, 4)) + additionalPadding;
      type = block[4]!;
      x2 = decodeCoord(block.substring(5, 7)) + additionalPadding;
      y2 = decodeCoord(block.substring(7, 9)) + additionalPadding;
      colorIndex = parseInt(block.substring(9, 12), 16);
      weight = parseInt(block[12]!, 16);
      opacity = parseInt(block[13]!, 16) / 15;
      rotation = parseInt(block[14]!, 16) * 22.5;
      zIndex = parseInt(block[15]!, 16);
      radius = parseInt(block[16]!, 16);
    } else {
      x1 = parseInt(block[0]!, 16) + additionalPadding;
      y1 = parseInt(block[1]!, 16) + additionalPadding;
      type = block[2]!;
      x2 = parseInt(block[3]!, 16) + additionalPadding;
      y2 = parseInt(block[4]!, 16) + additionalPadding;
      // v5/v6: 3 hex chars (12-bit color), v3/v4: 2 hex chars (8-bit color)
      colorIndex = (isV5 || isV6)
        ? parseInt(block.substring(5, 8), 16)
        : parseInt(block.substring(5, 7), 16);
      weight = parseInt((isV5 || isV6 ? block[8]! : block[7]!), 16);
      // v4/v5/v6: extra fields
      const extOffset = (isV5 || isV6) ? 9 : 8;
      opacity = (isV4 || isV5 || isV6) ? parseInt(block[extOffset]!, 16) / 15 : 1.0;
      rotation = (isV4 || isV5 || isV6) ? parseInt(block[extOffset + 1]!, 16) * 22.5 : 0;
      zIndex = (isV4 || isV5 || isV6) ? parseInt(block[extOffset + 2]!, 16) : 0;
      // v6: radius (rounded corners)
      radius = isV6 ? parseInt(block[extOffset + 3]!, 16) : 0;
    }

    const isFilled = type !== 'l' && type === type.toUpperCase();
    const color = getColorByIndex(colorIndex);
    const stroke = isFilled ? 'none' : color;
    const fill = isFilled ? color : 'none';
    const sw = strokeWidth(weight);
    const strokeWidthStr = sw.toFixed(1);
    const lineCap = getLineCap(type);

    let d = '';

    switch (type.toLowerCase()) {
      case 'l': // Line (round) from (x1,y1) to (x2,y2)
      case 's': // Line (square cap)
      case 'b': // Line (butt cap)
      case 'v': // Line (arrowhead)
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
        break;
      case 'r': // Rectangle: opposite corners (x1,y1) and (x2,y2)
        if (radius > 0) {
          const r = Math.min(radius / 15 * 7.5, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
          const rx = Math.min(r, Math.abs(x2 - x1) / 2);
          const ry = Math.min(r, Math.abs(y2 - y1) / 2);
          d = `M ${x1 + rx} ${y1} ` +
              `H ${x2 - rx} ` +
              `A ${rx} ${ry} 0 0 1 ${x2} ${y1 + ry} ` +
              `V ${y2 - ry} ` +
              `A ${rx} ${ry} 0 0 1 ${x2 - rx} ${y2} ` +
              `H ${x1 + rx} ` +
              `A ${rx} ${ry} 0 0 1 ${x1} ${y2 - ry} ` +
              `V ${y1 + ry} ` +
              `A ${rx} ${ry} 0 0 1 ${x1 + rx} ${y1} Z`;
        } else {
          d = `M ${x1} ${y1} H ${x2} V ${y2} H ${x1} Z`;
        }
        break;
      case 'c': { // Circle: inscribed in rectangle (x1,y1)-(x2,y2)
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const r = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1) / 2;
        d = `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
        break;
      }
      case 't': { // Isosceles triangle: vertex (x1,y1), base symmetric around x1 at y2
        const x3 = 2 * x1 - x2;
        d = `M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y2} Z`;
        break;
      }
      case 'a': // Arc (round) from (x1,y1) to (x2,y2)
      case 'k': // Arc (square cap)
      case 'n': // Arc (butt cap)
      case 'z': // Arc (arrowhead)
        const r = arcRadius(x1, y1, x2, y2, radius);
        d = `M ${x1} ${y1} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${x2} ${y2}`;
        break;
    }

    // v4 attributes: opacity + rotation
    const extraAttrs: string[] = [];
    if (isV4 && opacity < 1.0) extraAttrs.push(`opacity="${opacity.toFixed(2)}"`);
    if (isV4 && rotation !== 0) {
      // Rotate around bounding box center (x1,y1)-(x2,y2)
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      extraAttrs.push(`transform="rotate(${rotation} ${cx} ${cy})"`);
    }
    const extra = extraAttrs.length > 0 ? ' ' + extraAttrs.join(' ') : '';
    const rotationAttr = isV4 && rotation !== 0
      ? ` transform="rotate(${rotation} ${(x1 + x2) / 2} ${(y1 + y2) / 2})"`
      : '';

    // Arrowhead overlay (if the tool is an arrowhead variant).
    let arrowXml = '';
    if (hasArrowhead(type)) {
      const pts = arrowheadPoints(type, x1, y1, x2, y2, sw, radius);
      if (pts) {
        arrowXml = `<polygon points="${pts}" fill="${color}" stroke="none"${rotationAttr} />`;
      }
    }

    // opacity === 0 → erase (knockout). Guarded by version only implicitly:
    // v3 has no opacity (always 15), so this only triggers for v4+.
    const isKnockout = opacity === 0;

    parts.push({
      zIndex,
      isKnockout,
      xml: `<path d="${d}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidthStr}" stroke-linecap="${lineCap}" stroke-linejoin="round"${extra} />` +
        (arrowXml ? arrowXml : ''),
    });
  }

  // Sort by z-index (ascending – higher z-index = later in SVG = on top)
  parts.sort((a, b) => a.zIndex - b.zIndex);

  // Split into normal and knockout (opacity=0 → erase mode)
  const normalParts = parts.filter(p => !p.isKnockout);
  const knockoutParts = parts.filter(p => p.isKnockout);

  const shapes = normalParts.map(p => p.xml).join('\n  ');

  const background = options.faviconBackground
    ? `<rect width="${sizeWithPadding}" height="${sizeWithPadding}" fill="${options.faviconBackground}" />\n  `
    : '';

  // If there are knockout figures, mask each normal figure by the erasers ABOVE
  // it in the render stack. The render order is the full sorted `parts` array
  // (stable sort by z-index → equal z-index keeps insertion order). An eraser
  // at index j erases only normal figures at indices < j. Figures drawn after
  // an eraser (on top of it) stay untouched.
  let knockoutMask = '';
  let wrappedShapes = shapes;
  if (knockoutParts.length > 0) {
    const sortedParts = [...parts].sort((a, b) => a.zIndex - b.zIndex);

    const accumulatedErasers: string[] = [];
    const groups: string[] = [];

    // Walk from the TOP of the stack (last rendered) down to the bottom.
    for (let i = sortedParts.length - 1; i >= 0; i--) {
      const p = sortedParts[i]!;
      if (p.isKnockout) {
        accumulatedErasers.push(
          p.xml
            .replace(/stroke="[^"]*"/, 'stroke="black"')
            .replace(/opacity="[^"]*"/, '')
        );
        continue;
      }

      // A normal figure: render plainly if nothing above erases it.
      if (accumulatedErasers.length === 0) {
        groups.push(`  <g clip-path="url(#workspace-clip)">\n  ${p.xml}\n  </g>`);
        continue;
      }

      const maskId = `knockout-${i}`;
      knockoutMask += `
    <mask id="${maskId}">
      <rect width="${sizeWithPadding}" height="${sizeWithPadding}" fill="white" />
      ${accumulatedErasers.join('\n    ')}
    </mask>`;
      groups.push(`  <g mask="url(#${maskId})" clip-path="url(#workspace-clip)">\n  ${p.xml}\n  </g>`);
    }

    // groups was built top→down; reverse so the SVG paints bottom→top.
    groups.reverse();
    wrappedShapes = groups.join('\n');
  } else {
    wrappedShapes = `  <g clip-path="url(#workspace-clip)">\n  ${shapes}\n  </g>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 ${sizeWithPadding} ${sizeWithPadding}" xmlns="http://www.w3.org/2000/svg" overflow="visible">
  <defs>
    <clipPath id="workspace-clip">
      <rect width="${sizeWithPadding}" height="${sizeWithPadding}" />
    </clipPath>${knockoutMask}
  </defs>${background}${wrappedShapes}
</svg>`;
}