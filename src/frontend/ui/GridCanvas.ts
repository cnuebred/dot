import { stateManager } from '../logic/stateManager';
import type { Figure, DraftState } from '../logic/stateManager';
import { getGridPos, getGridPosUnclamped } from '../logic/math';
import { getColorByIndex } from '../../shared/palette';
import { buildPath, rotationTransform } from '../logic/pathBuilder';
import { renderCommittedSvg } from '../logic/committedRenderer';
import { getLineCap, hasArrowhead, arrowheadPoints, strokeWidth } from '../../shared/toolEndings';

const SVG_NS = 'http://www.w3.org/2000/svg';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

export class GridCanvas {
  private canvasElement: HTMLElement;
  private committedSvg: SVGSVGElement;
  private previewSvg: SVGSVGElement;
  private previewPath: SVGPathElement;
  private highlightPath: SVGPathElement;
  private drawGroup: SVGGElement;
  private gridGroup: SVGGElement;
  private clipRect: SVGRectElement;
  private arrowPath: SVGPolygonElement | null = null;
  private isDrawing = false;
  private isMoving = false;
  private moveAnchorX = 0;
  private moveAnchorY = 0;
  private isMarquee = false;
  private marqueeRect: SVGRectElement | null = null;
  private marqueeStart: { x: number; y: number } | null = null;
  private activeHandle: Handle | null = null;
  private handleGroup: SVGGElement | null = null;
  private handleElements: Map<Handle, SVGGElement> = new Map();
  private resizeStartBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private unsubs: Array<() => void> = [];
  private highlightTimer: number | null = null;
  private windowMouseup: ((e: MouseEvent) => void) | null = null;

  constructor() {
    this.canvasElement = document.createElement('div');
    this.canvasElement.className = 'grid-canvas';

    const maxCoord = stateManager.maxCoord;

    // Inline SVG of committed figures – rendered client-side (no network round-trip).
    // viewBox "0 0 maxCoord maxCoord" maps the 0-maxCoord coordinate range
    // edge-to-edge and centers it (matches the backend SVG output for size 15).
    this.committedSvg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.committedSvg.setAttribute('viewBox', `0 0 ${maxCoord} ${maxCoord}`);
    this.committedSvg.classList.add('committed-preview');
    this.committedSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // SVG overlay for live draft preview (uncompressed, 60 FPS)
    this.previewSvg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    // viewBox 0 0 maxCoord maxCoord – the 0-maxCoord range fills the viewport, so the grid is centered.
    this.previewSvg.setAttribute('viewBox', `0 0 ${maxCoord} ${maxCoord}`);
    this.previewSvg.classList.add('draft-preview');
    this.previewSvg.setAttribute('color', '#666');

    // Definitions – checkerboard pattern for erase mode (opacity=0)
    const defs = document.createElementNS(SVG_NS, 'defs');
    const erasePattern = document.createElementNS(SVG_NS, 'pattern');
    erasePattern.setAttribute('id', 'erase-pattern');
    erasePattern.setAttribute('patternUnits', 'userSpaceOnUse');
    erasePattern.setAttribute('width', '0.5');
    erasePattern.setAttribute('height', '0.5');
    const r1 = document.createElementNS(SVG_NS, 'rect');
    r1.setAttribute('width', '0.5');
    r1.setAttribute('height', '0.5');
    r1.setAttribute('fill', 'rgba(239,68,68,0.25)');
    const r2 = document.createElementNS(SVG_NS, 'rect');
    r2.setAttribute('width', '0.25');
    r2.setAttribute('height', '0.25');
    r2.setAttribute('fill', 'rgba(239,68,68,0.25)');
    const r3 = document.createElementNS(SVG_NS, 'rect');
    r3.setAttribute('x', '0.25');
    r3.setAttribute('y', '0.25');
    r3.setAttribute('width', '0.25');
    r3.setAttribute('height', '0.25');
    r3.setAttribute('fill', 'rgba(239,68,68,0.25)');
    erasePattern.append(r1, r2, r3);
    defs.appendChild(erasePattern);

    // Clip the drawing group to the maxCoord workspace so draft shapes cannot
    // visually overflow the canvas edge.
    const clip = document.createElementNS(SVG_NS, 'clipPath');
    clip.setAttribute('id', 'workspace-clip');
    this.clipRect = document.createElementNS(SVG_NS, 'rect') as SVGRectElement;
    this.clipRect.setAttribute('width', String(maxCoord));
    this.clipRect.setAttribute('height', String(maxCoord));
    clip.appendChild(this.clipRect);
    defs.appendChild(clip);

    this.previewSvg.appendChild(defs);

    // Drawing group – coordinates 0-maxCoord mapped directly to the viewBox.
    this.drawGroup = document.createElementNS(SVG_NS, 'g');
    this.drawGroup.setAttribute('clip-path', 'url(#workspace-clip)');

    // Grid dots – suggested drawing points (maxCoord+1 per axis).
    // Generated explicitly (not via <pattern>) to avoid subpixel offsets.
    //
    // The full grid maps 1:1 onto the canvas (no percentage padding), so the
    // perimeter dots double as a decorative frame around the drawing area.
    // Edge dots are slightly larger to read as that border.
    this.gridGroup = document.createElementNS(SVG_NS, 'g');
    this.gridGroup.setAttribute('fill', 'currentColor');
    this.rebuildGridDots();
    this.drawGroup.appendChild(this.gridGroup);

    this.previewPath = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
    this.drawGroup.appendChild(this.previewPath);

    this.highlightPath = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
    this.highlightPath.setAttribute('fill', 'none');
    this.highlightPath.setAttribute('stroke', '#3b82f6');
    this.highlightPath.setAttribute('stroke-width', '0.4');
    this.highlightPath.setAttribute('stroke-opacity', '0');
    this.highlightPath.setAttribute('pointer-events', 'none');
    this.drawGroup.appendChild(this.highlightPath);

    // Marquee selection rectangle (hidden until a marquee drag starts).
    this.marqueeRect = document.createElementNS(SVG_NS, 'rect') as SVGRectElement;
    this.marqueeRect.setAttribute('fill', 'rgba(59,130,246,0.12)');
    this.marqueeRect.setAttribute('stroke', '#3b82f6');
    this.marqueeRect.setAttribute('stroke-width', '0.15');
    this.marqueeRect.setAttribute('stroke-dasharray', '0.4 0.3');
    this.marqueeRect.setAttribute('pointer-events', 'none');
    this.marqueeRect.setAttribute('display', 'none');
    this.drawGroup.appendChild(this.marqueeRect);

    this.previewSvg.appendChild(this.drawGroup);

    this.canvasElement.append(this.committedSvg, this.previewSvg);

    this.initEvents();
    renderCommittedSvg(this.committedSvg, stateManager.committedFigures);
  }

  private initEvents() {
    // --- Mouse: rysowanie / przesuwanie / zaznaczanie / transformacja ---
    this.canvasElement.addEventListener('mousedown', (e: MouseEvent) => {
      const pos = this.getGridPosFromClient(e.clientX, e.clientY);
      if(pos.x < 0 || pos.y < 0) return;
      if(pos.x > stateManager.maxCoord || pos.y > stateManager.maxCoord) return;

      if (stateManager.currentTool === 'm') {
        // Move mode – check transform handles first, then select/move/marquee.
        const handle = this.handleAt(pos.x, pos.y);
        if (handle) {
          this.activeHandle = handle;
          this.resizeStartBounds = stateManager.selectionBounds();
          this.moveAnchorX = pos.x;
          this.moveAnchorY = pos.y;
          if (handle === 'rotate') {
            stateManager.beginMove();
          }
          this.canvasElement.style.cursor = 'grabbing';
          return;
        }

        const additive = e.shiftKey;
        const idx = stateManager.selectFigureAt(pos.x, pos.y, additive);
        if (idx >= 0) {
          this.isMoving = true;
          this.moveAnchorX = pos.x;
          this.moveAnchorY = pos.y;
          stateManager.beginMove();
          this.canvasElement.style.cursor = 'grabbing';
        } else if (!additive) {
          // Empty space – start a marquee selection.
          this.isMarquee = true;
          this.marqueeStart = { x: pos.x, y: pos.y };
          this.showMarquee(pos.x, pos.y, pos.x, pos.y);
        }
        return;
      }

      // Drawing mode
      this.isDrawing = true;
      stateManager.updateDraft({
        active: true,
        x1: pos.x, y1: pos.y, p1: pos.x, p2: pos.y,
        type: stateManager.resolveType(),
        color: stateManager.currentColor,
        weight: stateManager.currentWeight,
        opacity: stateManager.currentOpacity,
        rotation: stateManager.currentRotation,
        zIndex: stateManager.currentZIndex,
        radius: stateManager.currentRadius,
      });
    });

    this.canvasElement.addEventListener('mousemove', (e: MouseEvent) => {
      // Moving a selection may extend beyond the workspace (v7): use unclamped
      // coords so shapes can overflow the 15×15 canvas edge (clipped on render).
      if (this.isMoving) {
        const upos = this.getGridPosUnclampedFromClient(e.clientX, e.clientY);
        const dx = upos.x - this.moveAnchorX;
        const dy = upos.y - this.moveAnchorY;
        stateManager.moveSelectedBy(dx, dy);
        return;
      }

      const pos = this.getGridPosFromClient(e.clientX, e.clientY);
      if(pos.x < 0 || pos.y < 0) return;
      if(pos.x > stateManager.maxCoord || pos.y > stateManager.maxCoord) return;

      if (this.activeHandle) {
        this.dragHandle(pos.x, pos.y);
        return;
      }

      if (this.isMarquee && this.marqueeStart) {
        this.showMarquee(this.marqueeStart.x, this.marqueeStart.y, pos.x, pos.y);
        return;
      }

      if (!this.isDrawing) return;
      stateManager.updateDraft({ p1: pos.x, p2: pos.y });
    });

    // Listen on window to end drawing/moving even when cursor leaves the grid
    this.windowMouseup = (e: MouseEvent) => {
      if (this.activeHandle) {
        this.activeHandle = null;
        this.resizeStartBounds = null;
        stateManager.commitMove();
        this.previewPath.removeAttribute('d');
        this.previewPath.removeAttribute('transform');
        this.canvasElement.style.cursor = stateManager.currentTool === 'm' ? 'grab' : 'crosshair';
        return;
      }
      if (this.isMarquee) {
        this.isMarquee = false;
        if (this.marqueeStart) {
          const pos = this.getGridPosFromClient(e.clientX, e.clientY);
          stateManager.selectInRect(this.marqueeStart.x, this.marqueeStart.y, pos.x, pos.y, e.shiftKey);
        }
        this.hideMarquee();
        return;
      }
      if (this.isMoving) {
        this.isMoving = false;
        stateManager.commitMove();
        this.previewPath.removeAttribute('d');
        this.previewPath.removeAttribute('transform');
        this.canvasElement.style.cursor = stateManager.currentTool === 'm' ? 'grab' : 'crosshair';
        return;
      }
      if (!this.isDrawing) return;
      this.isDrawing = false;
      stateManager.commitFigure();
    };
    window.addEventListener('mouseup', this.windowMouseup);

    // --- Touch: drawing / moving ---
    this.canvasElement.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const pos = this.getTouchGridPos(touch);

      if (stateManager.currentTool === 'm') {
        const idx = stateManager.selectFigureAt(pos.x, pos.y);
        if (idx >= 0) {
          this.isMoving = true;
          this.moveAnchorX = pos.x;
          this.moveAnchorY = pos.y;
          stateManager.beginMove();
        }
        return;
      }

      this.isDrawing = true;
      stateManager.updateDraft({
        active: true,
        x1: pos.x, y1: pos.y, p1: pos.x, p2: pos.y,
        type: stateManager.resolveType(),
        color: stateManager.currentColor,
        weight: stateManager.currentWeight,
        opacity: stateManager.currentOpacity,
        rotation: stateManager.currentRotation,
        zIndex: stateManager.currentZIndex,
        radius: stateManager.currentRadius,
      });
    }, { passive: false });

    this.canvasElement.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;

      if (this.isMoving) {
        const pos = this.getTouchGridPosUnclamped(touch);
        const dx = pos.x - this.moveAnchorX;
        const dy = pos.y - this.moveAnchorY;
        stateManager.moveSelectedBy(dx, dy);
        return;
      }

      if (!this.isDrawing) return;
      const pos = this.getTouchGridPos(touch);
      stateManager.updateDraft({ p1: pos.x, p2: pos.y });
    }, { passive: false });

    const endTouch = () => {
      if (this.isMoving) {
        this.isMoving = false;
        stateManager.commitMove();
        this.previewPath.removeAttribute('d');
        this.previewPath.removeAttribute('transform');
        return;
      }
      if (!this.isDrawing) return;
      this.isDrawing = false;
      stateManager.commitFigure();
    };
    this.canvasElement.addEventListener('touchend', endTouch);
    this.canvasElement.addEventListener('touchcancel', endTouch);

    // --- Subscriptions ---
    this.unsubs.push(stateManager.subscribe('draftUpdated', (draft: DraftState) => this.renderPreview(draft)));
    this.unsubs.push(stateManager.subscribe('committedUpdated', (figures: Figure[]) => {
      renderCommittedSvg(this.committedSvg, figures);
      this.renderHandles();
    }));
    this.unsubs.push(stateManager.subscribe('toolChanged', (tool: string) => {
      this.canvasElement.style.cursor = tool === 'm' ? 'grab' : 'crosshair';
      if (tool !== 'm') this.hideHandles();
    }));
    this.unsubs.push(stateManager.subscribe('selectionChanged', () => {
      this.renderHandles();
    }));
    this.unsubs.push(stateManager.subscribe('movePreview', () => {
      this.renderMovePreview();
      this.renderHandles();
    }));
    this.unsubs.push(stateManager.subscribe('figureHighlighted', (fig: Figure) => this.renderHighlight(fig)));
    this.unsubs.push(stateManager.subscribe('canvasSizeChanged', () => this.applyCanvasSize()));

    // Set initial cursor
    this.canvasElement.style.cursor = stateManager.currentTool === 'm' ? 'grab' : 'crosshair';
  }

  /** Rebuilds the grid dots from the current canvas size. */
  private rebuildGridDots() {
    this.gridGroup.innerHTML = '';
    const maxCoord = stateManager.maxCoord;
    for (let x = 0; x <= maxCoord; x++) {
      for (let y = 0; y <= maxCoord; y++) {
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(x));
        dot.setAttribute('cy', String(y));
        const onEdge = x === 0 || x === maxCoord || y === 0 || y === maxCoord;
        dot.setAttribute('r', onEdge ? '0.07' : '0.05');
        dot.setAttribute('opacity', onEdge ? '0.7' : '0.35');
        this.gridGroup.appendChild(dot);
      }
    }
  }

  /** Applies a canvas-size change to the SVGs (viewBox, clip, grid, committed render). */
  private applyCanvasSize() {
    const maxCoord = stateManager.maxCoord;
    this.committedSvg.setAttribute('viewBox', `0 0 ${maxCoord} ${maxCoord}`);
    this.previewSvg.setAttribute('viewBox', `0 0 ${maxCoord} ${maxCoord}`);
    this.clipRect.setAttribute('width', String(maxCoord));
    this.clipRect.setAttribute('height', String(maxCoord));
    this.rebuildGridDots();
    this.hideHandles();
    this.previewPath.removeAttribute('d');
    this.previewPath.removeAttribute('transform');
    renderCommittedSvg(this.committedSvg, stateManager.committedFigures);
  }

  private getTouchGridPos(touch: Touch): { x: number; y: number } {
    return this.getGridPosFromClient(touch.clientX, touch.clientY);
  }

  private getTouchGridPosUnclamped(touch: Touch): { x: number; y: number } {
    return this.getGridPosUnclampedFromClient(touch.clientX, touch.clientY);
  }

  /** Converts a client-space point to 0-15 grid coords using the preview SVG's actual bounds. */
  private getGridPosFromClient(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.previewSvg.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;
    return getGridPos(offsetX, offsetY, rect.width, stateManager.maxCoord);
  }

  /** Like getGridPosFromClient but unclamped, for moving shapes beyond the workspace. */
  private getGridPosUnclampedFromClient(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.previewSvg.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;
    return getGridPosUnclamped(offsetX, offsetY, rect.width, stateManager.maxCoord);
  }

  private renderPreview(draft: DraftState) {
    if (!draft.active) {
      this.previewPath.removeAttribute('d');
      this.previewPath.removeAttribute('transform');
      return;
    }

    const x1 = draft.x1, y1 = draft.y1, x2 = draft.p1, y2 = draft.p2;
    const baseType = draft.type.toLowerCase();
    const isFilled = draft.type !== 'l' && draft.type === draft.type.toUpperCase();
    const color = getColorByIndex(draft.color);
    const opacity = (draft.opacity ?? 35) / 35;
    const rotation = (draft.rotation ?? 0) * 10;

    // Unified with backend compileToSvg (svgCompiler.ts)
    const sw = strokeWidth(draft.weight);
    const strokeWidthStr = sw.toFixed(1);
    const lineCap = getLineCap(draft.type);

    const d = buildPath(baseType, x1, y1, x2, y2, draft.radius ?? 0);
    const isErase = draft.opacity === 0;

    this.previewPath.setAttribute('d', d);
    this.previewPath.setAttribute('stroke-linecap', lineCap);
    if (isErase) {
      this.previewPath.setAttribute('stroke', 'url(#erase-pattern)');
      this.previewPath.setAttribute('stroke-width', String(Math.max(0.4, draft.weight * 0.2 + 0.2)));
      this.previewPath.setAttribute('stroke-opacity', '1');
      this.previewPath.setAttribute('fill', isFilled ? 'url(#erase-pattern)' : 'none');
      this.previewPath.setAttribute('fill-opacity', isFilled ? '0.5' : '0');
    } else {
      this.previewPath.setAttribute('stroke', color);
      this.previewPath.setAttribute('stroke-width', strokeWidthStr);
      this.previewPath.setAttribute('stroke-opacity', String(opacity * 0.85));
      this.previewPath.setAttribute('fill', isFilled ? color : 'none');
      this.previewPath.setAttribute('fill-opacity', isFilled ? String(opacity * 0.5) : '0');
    }

    const transform = rotationTransform(rotation, x1, y1, x2, y2);
    if (transform) this.previewPath.setAttribute('transform', transform);
    else this.previewPath.removeAttribute('transform');

    // Arrowhead overlay on the draft preview.
    const arrow = arrowheadPoints(draft.type, x1, y1, x2, y2, sw, draft.radius ?? 0);
    if (arrow) {
      if (!this.arrowPath) {
        this.arrowPath = document.createElementNS(SVG_NS, 'polygon');
        this.drawGroup.appendChild(this.arrowPath);
      }
      this.arrowPath.setAttribute('points', arrow);
      this.arrowPath.setAttribute('fill', isErase ? 'url(#erase-pattern)' : color);
      this.arrowPath.setAttribute('stroke', 'none');
      this.arrowPath.setAttribute('opacity', isErase ? '1' : String(opacity * 0.85));
      if (transform) this.arrowPath.setAttribute('transform', transform);
      else this.arrowPath.removeAttribute('transform');
    } else if (this.arrowPath) {
      this.arrowPath.removeAttribute('points');
    }
  }

  private renderMovePreview() {
    const indices = stateManager.selectedIndices;
    // Clear any previously appended per-figure preview paths.
    while (this.previewPath.firstChild) this.previewPath.removeChild(this.previewPath.firstChild);
    if (indices.length === 0) {
      this.previewPath.removeAttribute('d');
      this.previewPath.removeAttribute('transform');
      return;
    }

    // Render a combined preview of all selected figures.
    const parts: string[] = [];
    let hasArrow = false;
    let arrowPoints = '';
    let arrowColor = '#666';
    let arrowOpacity = '0.85';
    let arrowTransform = '';

    for (const idx of indices) {
      const fig = stateManager.committedFigures[idx];
      if (!fig) continue;
      const x1 = fig.x1, y1 = fig.y1, x2 = fig.p1, y2 = fig.p2;
      const baseType = fig.type.toLowerCase();
      const isFilled = fig.type !== 'l' && fig.type === fig.type.toUpperCase();
      const color = getColorByIndex(fig.color);
      const opacity = (fig.opacity ?? 35) / 35;
      const rotation = (fig.rotation ?? 0) * 10;
      const sw = strokeWidth(fig.weight);
      const lineCap = getLineCap(fig.type);
      const isErase = fig.opacity === 0;

      const d = buildPath(baseType, x1, y1, x2, y2, fig.radius ?? 0);
      const transform = rotationTransform(rotation, x1, y1, x2, y2);

      // Build a sub-path with its own stroke/fill via a <path> per figure is complex;
      // instead we render each figure as a separate path element in a temp group.
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('stroke-linecap', lineCap);
      if (isErase) {
        p.setAttribute('stroke', 'url(#erase-pattern)');
        p.setAttribute('stroke-width', String(Math.max(0.4, fig.weight * 0.2 + 0.2)));
        p.setAttribute('stroke-opacity', '1');
        p.setAttribute('fill', isFilled ? 'url(#erase-pattern)' : 'none');
        p.setAttribute('fill-opacity', isFilled ? '0.5' : '0');
      } else {
        p.setAttribute('stroke', color);
        p.setAttribute('stroke-width', sw.toFixed(1));
        p.setAttribute('stroke-opacity', String(opacity * 0.85));
        p.setAttribute('fill', isFilled ? color : 'none');
        p.setAttribute('fill-opacity', isFilled ? String(opacity * 0.5) : '0');
      }
      if (transform) p.setAttribute('transform', transform);
      this.previewPath.appendChild(p);

      // Arrowhead overlay.
      const arrow = arrowheadPoints(fig.type, x1, y1, x2, y2, sw, fig.radius ?? 0);
      if (arrow) {
        hasArrow = true;
        arrowPoints = arrow;
        arrowColor = isErase ? 'url(#erase-pattern)' : color;
        arrowOpacity = isErase ? '1' : String(opacity * 0.85);
        arrowTransform = transform;
      }
    }

    if (hasArrow) {
      if (!this.arrowPath) {
        this.arrowPath = document.createElementNS(SVG_NS, 'polygon');
        this.drawGroup.appendChild(this.arrowPath);
      }
      this.arrowPath.setAttribute('points', arrowPoints);
      this.arrowPath.setAttribute('fill', arrowColor);
      this.arrowPath.setAttribute('stroke', 'none');
      this.arrowPath.setAttribute('opacity', arrowOpacity);
      if (arrowTransform) this.arrowPath.setAttribute('transform', arrowTransform);
      else this.arrowPath.removeAttribute('transform');
    } else if (this.arrowPath) {
      this.arrowPath.removeAttribute('points');
    }
  }

  private showMarquee(x1: number, y1: number, x2: number, y2: number) {
    if (!this.marqueeRect) return;
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    this.marqueeRect.setAttribute('x', String(minX));
    this.marqueeRect.setAttribute('y', String(minY));
    this.marqueeRect.setAttribute('width', String(maxX - minX));
    this.marqueeRect.setAttribute('height', String(maxY - minY));
    this.marqueeRect.setAttribute('display', '');
  }

  private hideMarquee() {
    if (!this.marqueeRect) return;
    this.marqueeRect.setAttribute('display', 'none');
  }

  /** Returns the handle under the given grid point, or null. */
  private handleAt(gx: number, gy: number): Handle | null {
    if (!this.handleGroup || this.handleGroup.getAttribute('display') === 'none') return null;
    for (const [handle, el] of this.handleElements) {
      const cx = parseFloat(el.getAttribute('data-cx') || '0');
      const cy = parseFloat(el.getAttribute('data-cy') || '0');
      const r = 0.5;
      if (Math.abs(gx - cx) <= r && Math.abs(gy - cy) <= r) return handle;
    }
    return null;
  }

  /** Renders the selection bounding box + resize/rotate handles. */
  private renderHandles() {
    if (stateManager.currentTool !== 'm') {
      this.hideHandles();
      return;
    }
    const bounds = stateManager.selectionBounds();
    if (!bounds) {
      this.hideHandles();
      return;
    }
    if (!this.handleGroup) {
      this.handleGroup = document.createElementNS(SVG_NS, 'g');
      this.handleGroup.setAttribute('pointer-events', 'none');
      this.drawGroup.appendChild(this.handleGroup);
    }
    this.handleGroup.innerHTML = '';
    this.handleElements.clear();

    const { minX, minY, maxX, maxY } = bounds;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    // Bounding box outline.
    const box = document.createElementNS(SVG_NS, 'rect');
    box.setAttribute('x', String(minX));
    box.setAttribute('y', String(minY));
    box.setAttribute('width', String(maxX - minX));
    box.setAttribute('height', String(maxY - minY));
    box.setAttribute('fill', 'none');
    box.setAttribute('stroke', '#3b82f6');
    box.setAttribute('stroke-width', '0.12');
    box.setAttribute('stroke-dasharray', '0.3 0.25');
    this.handleGroup.appendChild(box);

    // Corner + edge handles.
    const positions: Array<[Handle, number, number]> = [
      ['nw', minX, minY], ['n', cx, minY], ['ne', maxX, minY],
      ['e', maxX, cy], ['se', maxX, maxY], ['s', cx, maxY],
      ['sw', minX, maxY], ['w', minX, cy],
    ];
    for (const [handle, hx, hy] of positions) {
      const el = this.makeHandle(hx, hy, handle);
      this.handleElements.set(handle, el);
      this.handleGroup.appendChild(el);
    }

    // Rotate handle above the top-center.
    const rot = this.makeHandle(cx, minY - 0.9, 'rotate');
    rot.setAttribute('fill', '#f59e0b');
    this.handleElements.set('rotate', rot);
    this.handleGroup.appendChild(rot);

    this.handleGroup.setAttribute('display', '');
  }

  private makeHandle(x: number, y: number, handle: Handle): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-cx', String(x));
    g.setAttribute('data-cy', String(y));
    g.setAttribute('pointer-events', 'all');
    g.style.cursor = this.handleCursor(handle);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x - 0.35));
    rect.setAttribute('y', String(y - 0.35));
    rect.setAttribute('width', '0.7');
    rect.setAttribute('height', '0.7');
    rect.setAttribute('fill', '#ffffff');
    rect.setAttribute('stroke', '#3b82f6');
    rect.setAttribute('stroke-width', '0.12');
    g.appendChild(rect);
    return g;
  }

  private handleCursor(handle: Handle): string {
    switch (handle) {
      case 'nw': case 'se': return 'nwse-resize';
      case 'ne': case 'sw': return 'nesw-resize';
      case 'n': case 's': return 'ns-resize';
      case 'e': case 'w': return 'ew-resize';
      case 'rotate': return 'grab';
    }
  }

  private hideHandles() {
    if (this.handleGroup) this.handleGroup.setAttribute('display', 'none');
  }

  /** Applies a live resize/rotate drag from a handle. */
  private dragHandle(gx: number, gy: number) {
    const handle = this.activeHandle;
    const bounds = this.resizeStartBounds;
    if (!handle || !bounds) return;

    if (handle === 'rotate') {
      // Rotate by 10° steps based on horizontal drag distance (canonical 0-35).
      const dx = gx - this.moveAnchorX;
      const steps = Math.round(dx / 1.5);
      if (steps !== 0) {
        stateManager.rotateSelection(steps);
        this.moveAnchorX = gx;
      }
      return;
    }

    let newMinX = bounds.minX, newMinY = bounds.minY, newMaxX = bounds.maxX, newMaxY = bounds.maxY;
    if (handle.includes('w')) newMinX = gx;
    if (handle.includes('e')) newMaxX = gx;
    if (handle.includes('n')) newMinY = gy;
    if (handle.includes('s')) newMaxY = gy;
    // Guard against zero/inverted size.
    if (newMaxX - newMinX < 1) return;
    if (newMaxY - newMinY < 1) return;
    stateManager.resizeSelection(newMinX, newMinY, newMaxX, newMaxY);
  }

  private renderHighlight(fig: Figure) {
    const x1 = fig.x1, y1 = fig.y1, x2 = fig.p1, y2 = fig.p2;
    const baseType = fig.type.toLowerCase();
    const rotation = (fig.rotation ?? 0) * 10;

    this.highlightPath.setAttribute('d', buildPath(baseType, x1, y1, x2, y2, fig.radius ?? 0));
    this.highlightPath.setAttribute('stroke-opacity', '0.8');
    const transform = rotationTransform(rotation, x1, y1, x2, y2);
    if (transform) this.highlightPath.setAttribute('transform', transform);
    else this.highlightPath.removeAttribute('transform');

    if (this.highlightTimer !== null) window.clearTimeout(this.highlightTimer);
    this.highlightTimer = window.setTimeout(() => {
      this.highlightPath.setAttribute('stroke-opacity', '0');
      this.highlightPath.removeAttribute('d');
      this.highlightPath.removeAttribute('transform');
      this.highlightTimer = null;
    }, 800);
  }

  /** Releases all subscriptions and window listeners. Call before removing the view. */
  destroy(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    if (this.windowMouseup) {
      window.removeEventListener('mouseup', this.windowMouseup);
      this.windowMouseup = null;
    }
    if (this.highlightTimer !== null) {
      window.clearTimeout(this.highlightTimer);
      this.highlightTimer = null;
    }
  }

  render(): HTMLElement {
    return this.canvasElement;
  }
}
