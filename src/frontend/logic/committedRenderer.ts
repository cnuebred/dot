/**
 * Client-side SVG renderer for committed figures.
 *
 * Draws the committed state into an inline `<svg>` element, mirroring the
 * backend `compileToSvg` output so the editor no longer needs a network
 * round-trip (`/r/...?mode=preview`) on every commit.
 */
import type { Figure } from './stateManager';
import { stateManager } from './stateManager';
import { getColorByIndex } from '../../shared/palette';
import { buildPath, rotationTransform } from './pathBuilder';
import { getLineCap, arrowheadPoints, strokeWidth } from '../../shared/toolEndings';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Renders committed figures into the provided `<svg>` element.
 * `container` must be a `<svg>` element whose viewBox matches the current
 * canvas size (e.g. "0 0 15 15" for the default 16-point canvas).
 */
export function renderCommittedSvg(svg: SVGSVGElement, figures: Figure[]): void {
  svg.replaceChildren();

  // Canvas extent (max coordinate). Matches the SVG viewBox set by the editor.
  const maxCoord = stateManager.maxCoord;

  // Build parts, then sort by z-index (higher = on top), mirroring backend.
  const parts: { zIndex: number; isKnockout: boolean; el: SVGElement }[] = [];

  for (const fig of figures) {
    const x1 = fig.x1, y1 = fig.y1, x2 = fig.p1, y2 = fig.p2;
    const baseType = fig.type.toLowerCase();
    const isFilled = fig.type !== 'l' && fig.type === fig.type.toUpperCase();
    const color = getColorByIndex(fig.color);
    const opacity = (fig.opacity ?? 35) / 35;
    const rotation = (fig.rotation ?? 0) * 10;
    const sw = strokeWidth(fig.weight);
    const strokeWidthStr = sw.toFixed(1);
    const lineCap = getLineCap(fig.type);

    const path = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
    path.setAttribute('d', buildPath(baseType, x1, y1, x2, y2, fig.radius ?? 0));
    path.setAttribute('stroke', isFilled ? 'none' : color);
    path.setAttribute('fill', isFilled ? color : 'none');
    path.setAttribute('stroke-width', strokeWidthStr);
    path.setAttribute('stroke-linecap', lineCap);
    path.setAttribute('stroke-linejoin', 'round');

    if (rotation !== 0) {
      path.setAttribute('transform', rotationTransform(rotation, x1, y1, x2, y2));
    }

    // Arrowhead overlay (if the tool is an arrowhead variant).
    let arrowEl: SVGPolygonElement | null = null;
    const pts = arrowheadPoints(fig.type, x1, y1, x2, y2, sw, fig.radius ?? 0);
    if (pts) {
      arrowEl = document.createElementNS(SVG_NS, 'polygon') as SVGPolygonElement;
      arrowEl.setAttribute('points', pts);
      arrowEl.setAttribute('fill', color);
      arrowEl.setAttribute('stroke', 'none');
      if (rotation !== 0) {
        arrowEl.setAttribute('transform', rotationTransform(rotation, x1, y1, x2, y2));
      }
    }

    const isKnockout = (fig.opacity ?? 15) === 0;

    // Group path + arrowhead so they move/highlight together.
    const group = document.createElementNS(SVG_NS, 'g');
    group.appendChild(path);
    if (arrowEl) group.appendChild(arrowEl);
    parts.push({ zIndex: fig.zIndex ?? 0, isKnockout, el: group });
  }

  parts.sort((a, b) => a.zIndex - b.zIndex);

  const normal = parts.filter((p) => !p.isKnockout);
  const knockout = parts.filter((p) => p.isKnockout);

  // Clip everything to the workspace so shapes cannot visually overflow the
  // canvas edge (e.g. rotated corners or thick strokes).
  const defs = document.createElementNS(SVG_NS, 'defs');
  const clip = document.createElementNS(SVG_NS, 'clipPath');
  clip.setAttribute('id', 'workspace-clip');
  const clipRect = document.createElementNS(SVG_NS, 'rect');
  clipRect.setAttribute('width', String(maxCoord));
  clipRect.setAttribute('height', String(maxCoord));
  clip.appendChild(clipRect);
  defs.appendChild(clip);

  if (knockout.length === 0) {
    const clipGroup = document.createElementNS(SVG_NS, 'g');
    clipGroup.setAttribute('clip-path', 'url(#workspace-clip)');
    for (const p of normal) clipGroup.appendChild(p.el);
    svg.append(defs, clipGroup);
    return;
  }

  // Knockout: an eraser punches holes only through figures DRAWN BEFORE it
  // (below it in the stack). The render order is the full sorted `parts` array
  // (stable sort by z-index → equal z-index keeps insertion order). An eraser
  // at index j erases only normal figures at indices < j. Figures drawn after
  // an eraser (on top of it) stay untouched.
  //
  // So we walk the stack from TOP to BOTTOM, accumulating the erasers seen so
  // far, and assign each normal figure a mask containing those erasers.
  const sortedParts = [...parts].sort((a, b) => a.zIndex - b.zIndex);

  const accumulatedErasers: SVGElement[] = [];
  const groups: SVGGElement[] = [];

  // Iterate top→down (last rendered → first rendered).
  for (let i = sortedParts.length - 1; i >= 0; i--) {
    const p = sortedParts[i]!;
    if (p.isKnockout) {
      // An eraser punches everything below it.
      accumulatedErasers.push(p.el);
      continue;
    }

    // A normal figure: if no eraser lies above it, render plainly.
    if (accumulatedErasers.length === 0) {
      const plain = document.createElementNS(SVG_NS, 'g');
      plain.setAttribute('clip-path', 'url(#workspace-clip)');
      plain.appendChild(p.el);
      groups.push(plain);
      continue;
    }

    // Otherwise mask it with the erasers above it.
    const mask = document.createElementNS(SVG_NS, 'mask');
    mask.setAttribute('id', `knockout-${i}`);
    const bgRect = document.createElementNS(SVG_NS, 'rect');
    bgRect.setAttribute('width', String(maxCoord));
    bgRect.setAttribute('height', String(maxCoord));
    bgRect.setAttribute('fill', 'white');
    mask.appendChild(bgRect);

    // For knockout figures, force every stroke to black (so they punch a hole).
    // Parts are `<g>` groups that may contain a path + arrowhead polygon.
    const addKnockoutNode = (node: SVGElement) => {
      const clone = node.cloneNode(true) as SVGElement;
      clone.querySelectorAll('path').forEach((p) => p.setAttribute('stroke', 'black'));
      mask.appendChild(clone);
    };
    for (const el of accumulatedErasers) addKnockoutNode(el);

    defs.appendChild(mask);

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('mask', `url(#knockout-${i})`);
    g.setAttribute('clip-path', 'url(#workspace-clip)');
    g.appendChild(p.el);
    groups.push(g);
  }

  // `groups` was built top→down; reverse so the SVG paints bottom→top (matching
  // original stack order: earlier z-index = lower = painted first).
  groups.reverse();

  // NOTE: `defs` (clipPath + knockout masks) MUST be attached to the SVG,
  // otherwise the masks/clip never reach the DOM and erase does nothing.
  svg.append(defs, ...groups);
}

/**
 * Serializes the current committed state into standalone SVG markup.
 *
 * This is a client-side, canvas-size-aware counterpart to the backend
 * `compileToSvg` for the DEFAULT (16-point) canvas. It is used by ExportModal
 * to let larger canvases (64/128 – which cannot be encoded into a stateless
 * URL) still be downloaded as SVG without a backend round-trip.
 */
export function renderCommittedSvgString(): string {
  const maxCoord = stateManager.maxCoord;

  // Build the shape markup in paint order (z-index ascending).
  const parts: { zIndex: number; isKnockout: boolean; xml: string }[] = [];

  for (const fig of stateManager.committedFigures) {
    const x1 = fig.x1, y1 = fig.y1, x2 = fig.p1, y2 = fig.p2;
    const baseType = fig.type.toLowerCase();
    const isFilled = fig.type !== 'l' && fig.type === fig.type.toUpperCase();
    const color = getColorByIndex(fig.color);
    const opacity = (fig.opacity ?? 35) / 35;
    const rotation = (fig.rotation ?? 0) * 10;
    const sw = strokeWidth(fig.weight);
    const lineCap = getLineCap(fig.type);
    const isKnockout = (fig.opacity ?? 35) === 0;

    const d = buildPath(baseType, x1, y1, x2, y2, fig.radius ?? 0);
    const transform = rotationTransform(rotation, x1, y1, x2, y2);
    const transformAttr = transform ? ` transform="${transform}"` : '';

    const stroke = isFilled ? 'none' : color;
    const fill = isFilled ? color : 'none';
    const fillOpacity = isFilled ? ` fill-opacity="${opacity}"` : '';

    let xml = `<path d="${d}" stroke="${stroke}" fill="${fill}" stroke-width="${sw.toFixed(1)}" stroke-linecap="${lineCap}" stroke-linejoin="round"${fillOpacity}${transformAttr} />`;

    // Arrowhead overlay.
    const pts = arrowheadPoints(fig.type, x1, y1, x2, y2, sw, fig.radius ?? 0);
    if (pts) {
      xml += `<polygon points="${pts}" fill="${color}" stroke="none"${transformAttr} />`;
    }

    parts.push({ zIndex: fig.zIndex ?? 0, isKnockout, xml });
  }

  parts.sort((a, b) => a.zIndex - b.zIndex);

  const knockout = parts.filter((p) => p.isKnockout);
  let knockoutMask = '';
  let wrappedShapes: string;

  if (knockout.length > 0) {
    const sortedParts = [...parts].sort((a, b) => a.zIndex - b.zIndex);
    const accumulatedErasers: string[] = [];
    const groups: string[] = [];

    // Walk the stack top→down, accumulating erasers; assign each normal figure
    // a mask containing the erasers drawn above it (paint-order semantics).
    for (let i = sortedParts.length - 1; i >= 0; i--) {
      const p = sortedParts[i]!;
      if (p.isKnockout) {
        // Force eraser strokes to black so they punch a hole in the mask.
        accumulatedErasers.push(
          p.xml
            .replace(/stroke="[^"]*"/, 'stroke="black"')
            .replace(/opacity="[^"]*"/, '')
        );
        continue;
      }
      if (accumulatedErasers.length === 0) {
        groups.push(`  <g clip-path="url(#workspace-clip)">\n  ${p.xml}\n  </g>`);
        continue;
      }
      const maskId = `knockout-${i}`;
      knockoutMask += `
    <mask id="${maskId}">
      <rect width="${maxCoord}" height="${maxCoord}" fill="white" />
      ${accumulatedErasers.join('\n    ')}
    </mask>`;
      groups.push(`  <g mask="url(#${maskId})" clip-path="url(#workspace-clip)">\n  ${p.xml}\n  </g>`);
    }

    groups.reverse();
    wrappedShapes = groups.join('\n');
  } else {
    wrappedShapes = `  <g clip-path="url(#workspace-clip)">\n  ${parts.map((p) => p.xml).join('\n  ')}\n  </g>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 ${maxCoord} ${maxCoord}" xmlns="http://www.w3.org/2000/svg" overflow="visible">
  <defs>
    <clipPath id="workspace-clip">
      <rect width="${maxCoord}" height="${maxCoord}" />
    </clipPath>${knockoutMask}
  </defs>${wrappedShapes}
</svg>`;
}
