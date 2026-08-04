/**
 * Client-side SVG renderer for committed figures.
 *
 * Draws the committed state into an inline `<svg>` element, mirroring the
 * backend `compileToSvg` output so the editor no longer needs a network
 * round-trip (`/r/...?mode=preview`) on every commit.
 */
import type { Figure } from './stateManager';
import { getColorByIndex } from '../../shared/palette';
import { buildPath, rotationTransform } from './pathBuilder';
import { getLineCap, arrowheadPoints, strokeWidth } from '../../shared/toolEndings';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Renders committed figures into the provided `<svg>` element.
 * `container` must be a `<svg viewBox="0 0 15 15">` element.
 */
export function renderCommittedSvg(svg: SVGSVGElement, figures: Figure[]): void {
  svg.replaceChildren();

  // Build parts, then sort by z-index (higher = on top), mirroring backend.
  const parts: { zIndex: number; isKnockout: boolean; el: SVGElement }[] = [];

  for (const fig of figures) {
    const x1 = fig.x1, y1 = fig.y1, x2 = fig.p1, y2 = fig.p2;
    const baseType = fig.type.toLowerCase();
    const isFilled = fig.type !== 'l' && fig.type === fig.type.toUpperCase();
    const color = getColorByIndex(fig.color);
    const opacity = (fig.opacity ?? 15) / 15;
    const rotation = (fig.rotation ?? 0) * 22.5;
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
    const pts = arrowheadPoints(fig.type, x1, y1, x2, y2, sw);
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

  // Clip everything to the 15×15 workspace so shapes cannot visually
  // overflow the canvas edge (e.g. rotated corners or thick strokes).
  const defs = document.createElementNS(SVG_NS, 'defs');
  const clip = document.createElementNS(SVG_NS, 'clipPath');
  clip.setAttribute('id', 'workspace-clip');
  const clipRect = document.createElementNS(SVG_NS, 'rect');
  clipRect.setAttribute('width', '15');
  clipRect.setAttribute('height', '15');
  clip.appendChild(clipRect);
  defs.appendChild(clip);

  if (knockout.length === 0) {
    const clipGroup = document.createElementNS(SVG_NS, 'g');
    clipGroup.setAttribute('clip-path', 'url(#workspace-clip)');
    for (const p of normal) clipGroup.appendChild(p.el);
    svg.append(defs, clipGroup);
    return;
  }

  // Knockout: wrap normal shapes in a mask group.
  const mask = document.createElementNS(SVG_NS, 'mask');
  mask.setAttribute('id', 'knockout-mask');
  const bgRect = document.createElementNS(SVG_NS, 'rect');
  bgRect.setAttribute('width', '15');
  bgRect.setAttribute('height', '15');
  bgRect.setAttribute('fill', 'white');
  mask.appendChild(bgRect);

  // For knockout figures, force every stroke to black (so they punch a hole).
  // Parts are `<g>` groups that may contain a path + arrowhead polygon.
  const addKnockoutNode = (node: SVGElement) => {
    const clone = node.cloneNode(true) as SVGElement;
    clone.querySelectorAll('path').forEach((p) => p.setAttribute('stroke', 'black'));
    mask.appendChild(clone);
  };
  for (const p of knockout) addKnockoutNode(p.el);

  defs.appendChild(mask);

  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('mask', 'url(#knockout-mask)');
  g.setAttribute('clip-path', 'url(#workspace-clip)');
  for (const p of normal) g.appendChild(p.el);

  svg.append(defs, g);
}
