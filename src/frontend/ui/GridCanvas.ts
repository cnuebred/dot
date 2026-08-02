import { stateManager } from '../logic/stateManager';
import type { Figure, DraftState } from '../logic/stateManager';
import { getGridPos } from '../logic/math';
import { encodeState } from '../logic/encoder';
import { getColorByIndex } from '../../shared/palette';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class GridCanvas {
  private canvasElement: HTMLElement;
  private mainImg: HTMLImageElement;
  private previewSvg: SVGSVGElement;
  private previewPath: SVGPathElement;
  private highlightPath: SVGPathElement;
  private isDrawing = false;
  private isMoving = false;

  constructor() {
    this.canvasElement = document.createElement('div');
    this.canvasElement.className = 'grid-canvas';

    // Main image fetched from backend (committed figures)
    this.mainImg = document.createElement('img');
    this.mainImg.className = 'main-preview';
    this.mainImg.alt = 'Icon preview';

    // SVG overlay for live draft preview (uncompressed, 60 FPS)
    this.previewSvg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    // viewBox 0 0 16 16 – padding provided by CSS (12.5% on .grid-canvas)
    this.previewSvg.setAttribute('viewBox', '0 0 16 16');
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
    this.previewSvg.appendChild(defs);

    // Drawing group – coordinates 0–15 mapped directly to viewBox 16×16.
    const drawGroup = document.createElementNS(SVG_NS, 'g');

    // Grid dots – suggested drawing points (16×16 = 256 dots).
    // Generated explicitly (not via <pattern>) to avoid subpixel
    // offsets at small viewBox.
    const gridGroup = document.createElementNS(SVG_NS, 'g');
    gridGroup.setAttribute('fill', 'currentColor');
    gridGroup.setAttribute('opacity', '0.35');
    for (let x = 0; x <= 15; x++) {
      for (let y = 0; y <= 15; y++) {
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(x));
        dot.setAttribute('cy', String(y));
        dot.setAttribute('r', '0.05');
        gridGroup.appendChild(dot);
      }
    }
    drawGroup.appendChild(gridGroup);

    this.previewPath = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
    drawGroup.appendChild(this.previewPath);

    this.highlightPath = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
    this.highlightPath.setAttribute('fill', 'none');
    this.highlightPath.setAttribute('stroke', '#3b82f6');
    this.highlightPath.setAttribute('stroke-width', '0.4');
    this.highlightPath.setAttribute('stroke-opacity', '0');
    this.highlightPath.setAttribute('pointer-events', 'none');
    drawGroup.appendChild(this.highlightPath);

    this.previewSvg.appendChild(drawGroup);

    this.canvasElement.append(this.mainImg, this.previewSvg);

    this.initEvents();
    this.updateMainPreview(stateManager.committedFigures);
  }

  private initEvents() {
    // --- Mouse: rysowanie / przesuwanie ---
    this.canvasElement.addEventListener('mousedown', (e: MouseEvent) => {
      const rect = this.canvasElement.getBoundingClientRect();
      const pos = getGridPos(e.clientX - rect.left, e.clientY - rect.top, this.canvasElement.clientWidth);

      if (stateManager.currentTool === 'm') {
        // Move mode – select figure under cursor
        const idx = stateManager.selectFigureAt(pos.x, pos.y);
        if (idx >= 0) {
          this.isMoving = true;
          this.canvasElement.style.cursor = 'grabbing';
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
      });
    });

    this.canvasElement.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = this.canvasElement.getBoundingClientRect();
      const pos = getGridPos(e.clientX - rect.left, e.clientY - rect.top, this.canvasElement.clientWidth);

      if (this.isMoving) {
        stateManager.moveSelectedBy(pos.x, pos.y);
        return;
      }

      if (!this.isDrawing) return;
      stateManager.updateDraft({ p1: pos.x, p2: pos.y });
    });

    // Listen on window to end drawing/moving even when cursor leaves the grid
    window.addEventListener('mouseup', () => {
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
    });

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
      });
    }, { passive: false });

    this.canvasElement.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;

      if (this.isMoving) {
        const pos = this.getTouchGridPos(touch);
        stateManager.moveSelectedBy(pos.x, pos.y);
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
    stateManager.subscribe('draftUpdated', (draft: DraftState) => this.renderPreview(draft));
    stateManager.subscribe('committedUpdated', (figures: Figure[]) => this.updateMainPreview(figures));
    stateManager.subscribe('toolChanged', (tool: string) => {
      this.canvasElement.style.cursor = tool === 'm' ? 'grab' : 'crosshair';
    });
    stateManager.subscribe('movePreview', (data: { figureIndex: number; x1: number; y1: number; p1: number; p2: number }) => this.renderMovePreview(data));
    stateManager.subscribe('figureHighlighted', (fig: Figure) => this.renderHighlight(fig));

    // Set initial cursor
    this.canvasElement.style.cursor = stateManager.currentTool === 'm' ? 'grab' : 'crosshair';
  }

  private getTouchGridPos(touch: Touch): { x: number; y: number } {
    const rect = this.canvasElement.getBoundingClientRect();
    const offsetX = touch.clientX - rect.left;
    const offsetY = touch.clientY - rect.top;
    return getGridPos(offsetX, offsetY, this.canvasElement.clientWidth);
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
    const opacity = (draft.opacity ?? 15) / 15;
    const rotation = (draft.rotation ?? 0) * 22.5;

    // Bounding box center for rotation
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;

    // Unified with backend compileToSvg (svgCompiler.ts)
    const strokeWidth = (0.2 + draft.weight * 0.2).toFixed(1);

    let d = '';
    switch (baseType) {
      case 'l':
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
        break;
      case 'r':
        d = `M ${x1} ${y1} H ${x2} V ${y2} H ${x1} Z`;
        break;
      case 'c': {
        const r = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1) / 2;
        d = `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
        break;
      }
      case 't': {
        const x3 = 2 * x1 - x2;
        d = `M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y2} Z`;
        break;
      }
      case 'a': {
        const r = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
        d = `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
        break;
      }
      default:
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
    }

    const isErase = draft.opacity === 0;

    this.previewPath.setAttribute('d', d);
    if (isErase) {
      this.previewPath.setAttribute('stroke', 'url(#erase-pattern)');
      this.previewPath.setAttribute('stroke-width', String(Math.max(0.4, draft.weight * 0.2 + 0.2)));
      this.previewPath.setAttribute('stroke-opacity', '1');
      this.previewPath.setAttribute('fill', isFilled ? 'url(#erase-pattern)' : 'none');
      this.previewPath.setAttribute('fill-opacity', isFilled ? '0.5' : '0');
    } else {
      this.previewPath.setAttribute('stroke', color);
      this.previewPath.setAttribute('stroke-width', strokeWidth);
      this.previewPath.setAttribute('stroke-opacity', String(opacity * 0.85));
      this.previewPath.setAttribute('fill', isFilled ? color : 'none');
      this.previewPath.setAttribute('fill-opacity', isFilled ? String(opacity * 0.5) : '0');
    }

    if (rotation !== 0) {
      this.previewPath.setAttribute('transform', `rotate(${rotation} ${cx} ${cy})`);
    } else {
      this.previewPath.removeAttribute('transform');
    }
  }

  private renderMovePreview(data: { figureIndex: number; x1: number; y1: number; p1: number; p2: number }) {
    const fig = stateManager.committedFigures[data.figureIndex];
    if (!fig) {
      this.previewPath.removeAttribute('d');
      this.previewPath.removeAttribute('transform');
      return;
    }

    const x1 = data.x1, y1 = data.y1, x2 = data.p1, y2 = data.p2;
    const baseType = fig.type.toLowerCase();
    const isFilled = fig.type !== 'l' && fig.type === fig.type.toUpperCase();
    const color = getColorByIndex(fig.color);
    const opacity = (fig.opacity ?? 15) / 15;
    const rotation = (fig.rotation ?? 0) * 22.5;

    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const strokeWidth = (0.2 + fig.weight * 0.2).toFixed(1);

    let d = '';
    switch (baseType) {
      case 'l':
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
        break;
      case 'r':
        d = `M ${x1} ${y1} H ${x2} V ${y2} H ${x1} Z`;
        break;
      case 'c': {
        const r = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1) / 2;
        d = `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
        break;
      }
      case 't': {
        const x3 = 2 * x1 - x2;
        d = `M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y2} Z`;
        break;
      }
      case 'a': {
        const r = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
        d = `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
        break;
      }
      default:
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
    }

    const isErase = fig.opacity === 0;

    this.previewPath.setAttribute('d', d);
    if (isErase) {
      this.previewPath.setAttribute('stroke', 'url(#erase-pattern)');
      this.previewPath.setAttribute('stroke-width', String(Math.max(0.4, fig.weight * 0.2 + 0.2)));
      this.previewPath.setAttribute('stroke-opacity', '1');
      this.previewPath.setAttribute('fill', isFilled ? 'url(#erase-pattern)' : 'none');
      this.previewPath.setAttribute('fill-opacity', isFilled ? '0.5' : '0');
    } else {
      this.previewPath.setAttribute('stroke', color);
      this.previewPath.setAttribute('stroke-width', strokeWidth);
      this.previewPath.setAttribute('stroke-opacity', String(opacity * 0.85));
      this.previewPath.setAttribute('fill', isFilled ? color : 'none');
      this.previewPath.setAttribute('fill-opacity', isFilled ? String(opacity * 0.5) : '0');
    }

    if (rotation !== 0) {
      this.previewPath.setAttribute('transform', `rotate(${rotation} ${cx} ${cy})`);
    } else {
      this.previewPath.removeAttribute('transform');
    }
  }

  private renderHighlight(fig: Figure) {
    const x1 = fig.x1, y1 = fig.y1, x2 = fig.p1, y2 = fig.p2;
    const baseType = fig.type.toLowerCase();
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rotation = (fig.rotation ?? 0) * 22.5;

    let d = '';
    switch (baseType) {
      case 'l':
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
        break;
      case 'r':
        d = `M ${x1} ${y1} H ${x2} V ${y2} H ${x1} Z`;
        break;
      case 'c': {
        const r = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1) / 2;
        d = `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
        break;
      }
      case 't': {
        const x3 = 2 * x1 - x2;
        d = `M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y2} Z`;
        break;
      }
      case 'a': {
        const r = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
        d = `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
        break;
      }
      default:
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
    }

    this.highlightPath.setAttribute('d', d);
    this.highlightPath.setAttribute('stroke-opacity', '0.8');
    if (rotation !== 0) {
      this.highlightPath.setAttribute('transform', `rotate(${rotation} ${cx} ${cy})`);
    } else {
      this.highlightPath.removeAttribute('transform');
    }

    setTimeout(() => {
      this.highlightPath.setAttribute('stroke-opacity', '0');
      this.highlightPath.removeAttribute('d');
      this.highlightPath.removeAttribute('transform');
    }, 800);
  }

  private updateMainPreview(figures: Figure[]) {
    const payload = encodeState(figures);
    this.mainImg.src = payload ? `/r/${payload}?mode=preview&_=${Date.now()}` : '';
  }

  render(): HTMLElement {
    return this.canvasElement;
  }
}
