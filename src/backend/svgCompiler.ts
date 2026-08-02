import { getColorByIndex } from '../shared/palette';

export interface CompileOptions {
  /** Gdy ustawione, dodaje nieprzezroczyste tło (przydatne dla faviconów w niektórych przeglądarkach). */
  faviconBackground?: string;
  isPreview?: boolean
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
 * ViewBox: 0 0 16 16
 */
export function compileToSvg(text: string, options: CompileOptions = {}): string {
  const BLOCK_V3 = 8;
  const BLOCK_V4 = 11;
  const blockLen = text.length % BLOCK_V4 === 0 ? BLOCK_V4 : BLOCK_V3;
  const isV4 = blockLen === BLOCK_V4;

  // 16×16 grid – padding provided by CSS (12.5% on .grid-canvas).
  const additionalPadding = 0;
  const sizeWithPadding = 16;

  interface ShapePart {
    zIndex: number;
    xml: string;
    isKnockout: boolean;
  }
  const parts: ShapePart[] = [];

  for (let i = 0; i < text.length; i += blockLen) {
    const block = text.substring(i, i + blockLen);
    const x1 = parseInt(block[0]!, 16) + additionalPadding;
    const y1 = parseInt(block[1]!, 16) + additionalPadding;
    const type = block[2]!;
    const x2 = parseInt(block[3]!, 16) + additionalPadding;
    const y2 = parseInt(block[4]!, 16) + additionalPadding;
    const colorIndex = parseInt(block.substring(5, 7), 16);
    const weight = parseInt(block[7]!, 16);

    // v4: extra fields
    const opacity = isV4 ? parseInt(block[8]!, 16) / 15 : 1.0;
    const rotation = isV4 ? parseInt(block[9]!, 16) * 22.5 : 0;
    const zIndex = isV4 ? parseInt(block[10]!, 16) : 0;

    const isFilled = type !== 'l' && type === type.toUpperCase();
    const color = getColorByIndex(colorIndex);
    const stroke = isFilled ? 'none' : color;
    const fill = isFilled ? color : 'none';
    const strokeWidth = (0.2 + weight * 0.2).toFixed(1);

    let d = '';

    switch (type.toLowerCase()) {
      case 'l': // Line: from (x1,y1) to (x2,y2)
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
        break;
      case 'r': // Rectangle: opposite corners (x1,y1) and (x2,y2)
        d = `M ${x1} ${y1} H ${x2} V ${y2} H ${x1} Z`;
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
      case 'a': { // Arc from (x1,y1) to (x2,y2)
        const r = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
        d = `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
        break;
      }
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

    const isKnockout = isV4 && opacity === 0;

    parts.push({
      zIndex,
      isKnockout,
      xml: `<path d="${d}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${extra} />`,
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

  // If there are knockout figures, wrap normal ones in <g mask="url(#knockout)">
  let knockoutMask = '';
  let wrappedShapes = shapes;
  if (knockoutParts.length > 0) {
    const maskId = 'knockout';
    const knockoutPaths = knockoutParts.map(p => {
      return p.xml
        .replace(/stroke="[^"]*"/, 'stroke="black"')
        .replace(/opacity="[^"]*"/, '');
    }).join('\n    ');
    knockoutMask = `
  <defs>
    <mask id="${maskId}">
      <rect width="${sizeWithPadding}" height="${sizeWithPadding}" fill="white" />
      ${knockoutPaths}
    </mask>
  </defs>`;
    wrappedShapes = `  <g mask="url(#${maskId})">\n  ${shapes}\n  </g>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 ${sizeWithPadding} ${sizeWithPadding}" xmlns="http://www.w3.org/2000/svg" overflow="visible">
  ${knockoutMask}${background}${wrappedShapes}
</svg>`;
}