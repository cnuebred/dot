export type ToolBase = 'l' | 's' | 'b' | 'v' | 'r' | 'c' | 't' | 'a' | 'k' | 'n' | 'z' | 'm';
export type ToolType = 'l' | 'L' | 's' | 'S' | 'b' | 'B' | 'v' | 'V' | 'r' | 'R' | 'c' | 'C' | 'a' | 'A' | 'k' | 'K' | 'n' | 'N' | 'z' | 'Z' | 't' | 'T';

import { applyBoolean } from './booleanOps';

export interface Figure {
  x1: number;
  y1: number;
  type: ToolType;
  p1: number;
  p2: number;
  /** 12-bit color value (0-4095): paletteId<<6 | colorIndex (Format 5.0). */
  color: number;
  /** Line weight (0-35), canonical scale. 0 = thinnest, 35 = thickest. */
  weight: number;
  /** Opacity 0-35 (0=fully transparent, 35=fully opaque). */
  opacity: number;
  /** Rotation 0-35 (0°-350°, step 10°). */
  rotation: number;
  /** Z-index 0-35 (higher = on top). */
  zIndex: number;
  /** Corner radius 0-35 (rounded corners on rect). */
  radius: number;
}

export interface DraftState {
  active: boolean;
  x1: number;
  y1: number;
  p1: number;
  p2: number;
  type: ToolType;
  color: number;
  weight: number;
  opacity: number;
  rotation: number;
  zIndex: number;
  radius: number;
}

type StateListener = (data: any) => void;

// localStorage keys used by the developer "autosave" option.
// Data is stored only locally in the user's browser.
const AUTOSAVE_ENABLED_KEY = 'dot:autosave:enabled';
const AUTOSAVE_DATA_KEY = 'dot:autosave:data';

export class StateManager {
  private listeners: Map<string, StateListener[]> = new Map();
  
  public committedFigures: Figure[] = [];
  public draft: DraftState = {
    active: false,
    x1: 0, y1: 0, p1: 0, p2: 0,
    type: 'l',
    color: 0,
    weight: 0,
    opacity: 35,
    rotation: 0,
    zIndex: 0,
    radius: 0,
  };
  public currentTool: ToolBase = 'l';
  public fillEnabled = false;
  public currentRadius = 0;
  public currentColor = 0;
  public currentPalette = 0;
  public currentWeight = 0;
  public currentOpacity = 35;
  public currentRotation = 0;
  public currentZIndex = 0;
  public autosaveEnabled = false;

  /**
   * Canvas size in points (max coordinate). Supported values:
   *  - 15  → 16×16 point canvas (default, stateless / shareable)
   *  - 63  → 64×64 point canvas (client-only – hotlink/export disabled)
   *  - 127 → 128×128 point canvas (client-only – hotlink/export disabled)
   * Larger canvases are client-side only because their state cannot be
   * encoded into the URL / backend without blowing the payload limits.
   */
  public canvasSize = 15;
  /** Highest coordinate available on the current canvas (== canvasSize). */
  public get maxCoord(): number {
    return this.canvasSize;
  }

  /**
   * Monotonic counter incremented whenever the committed figures change.
   * Used to invalidate memoized encodings of committed state.
   */
  public committedRevision = 0;

  // --- Selection & Move Tool ---
  public selectedIndices: number[] = [];
  private moveStartX: number = 0;
  private moveStartY: number = 0;
  private moveOrigFigures: Figure[] = [];
  private clipboard: Figure[] = [];
  private groups: number[][] = [];

  // --- Undo/Redo History ---
  private historyStack: Figure[][] = [];
  private historyIndex: number = -1;
  private readonly MAX_HISTORY = 100;
  private historyLocked = false;

  constructor() {
    this.autosaveEnabled = this.readLocalStorage(AUTOSAVE_ENABLED_KEY) === '1';
  }

  /** Subscribes to an event. Returns an unsubscribe function to release the listener. */
  subscribe(event: string, listener: StateListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(listener);
    return () => {
      const arr = this.listeners.get(event);
      if (!arr) return;
      const idx = arr.indexOf(listener);
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(listener => listener(data));
  }

  /** Emits committedUpdated and bumps the revision (invalidates memoized encodings). */
  private emitCommitted() {
    this.committedRevision++;
    this.emit('committedUpdated', this.committedFigures);
  }

  // --- History ---

  private pushHistory() {
    if (this.historyLocked) return;
    // Remove "future" states beyond current position (when user undoes and makes a new operation)
    if (this.historyIndex < this.historyStack.length - 1) {
      this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
    }
    this.historyStack.push(JSON.parse(JSON.stringify(this.committedFigures)));
    if (this.historyStack.length > this.MAX_HISTORY) {
      this.historyStack.shift();
    }
    this.historyIndex = this.historyStack.length - 1;
    this.emit('historyChanged', { canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  canUndo(): boolean {
    return this.historyIndex > 0;
  }

  canRedo(): boolean {
    return this.historyIndex < this.historyStack.length - 1;
  }

  undo() {
    if (!this.canUndo()) return;
    this.historyLocked = true;
    this.historyIndex--;
    this.committedFigures = JSON.parse(JSON.stringify(this.historyStack[this.historyIndex]));
    this.emitCommitted();
    this.emit('historyChanged', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    this.persistIfEnabled();
    this.historyLocked = false;
  }

  redo() {
    if (!this.canRedo()) return;
    this.historyLocked = true;
    this.historyIndex++;
    this.committedFigures = JSON.parse(JSON.stringify(this.historyStack[this.historyIndex]));
    this.emitCommitted();
    this.emit('historyChanged', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    this.persistIfEnabled();
    this.historyLocked = false;
  }

  // --- Tools and Properties ---

  setTool(tool: ToolBase) {
    this.currentTool = tool;
    this.emit('toolChanged', tool);
  }

  setFillEnabled(value: boolean) {
    this.fillEnabled = value;
    this.emit('fillChanged', value);
  }

  setColor(colorIndex: number) {
    this.currentColor = colorIndex;
    this.emit('colorChanged', colorIndex);
  }

  /**
   * Applies a color to the current selection (if any), or just sets the
   * active drawing color when nothing is selected.
   *
   * When figures are selected, their `color` is updated to `colorIndex`
   * (with history + persist), so clicking a swatch recolors the selected
   * element(s). Returns true if a selection was recolored.
   */
  setColorForSelection(colorIndex: number): boolean {
    this.currentColor = colorIndex;
    this.emit('colorChanged', colorIndex);

    if (this.selectedIndices.length === 0) return false;

    this.pushHistory();
    this.selectedIndices.forEach(i => {
      const f = this.committedFigures[i];
      if (f) f.color = colorIndex;
    });
    this.emitCommitted();
    this.emit('selectionChanged', { indices: this.selectedIndices });
    this.persistIfEnabled();
    return true;
  }

  setPalette(paletteId: number) {
    this.currentPalette = paletteId;
    this.emit('paletteChanged', paletteId);
  }

  setWeight(weight: number) {
    this.currentWeight = weight;
    this.emit('weightChanged', weight);
  }

  setOpacity(opacity: number) {
    this.currentOpacity = opacity;
    this.emit('opacityChanged', opacity);
  }

  setRotation(rotation: number) {
    this.currentRotation = rotation;
    this.emit('rotationChanged', rotation);
  }

  setZIndex(zIndex: number) {
    this.currentZIndex = zIndex;
    this.emit('zIndexChanged', zIndex);
  }

  setRadius(radius: number) {
    this.currentRadius = radius;
    this.emit('radiusChanged', radius);
  }

  /**
   * The supported canvas sizes (max coordinate values).
   */
  static readonly CANVAS_SIZES: ReadonlyArray<{ label: string; maxCoord: number; stateless: boolean }> = [
    { label: '16×16', maxCoord: 15, stateless: true },
    { label: '32×32', maxCoord: 31, stateless: true },
    { label: '64×64', maxCoord: 63, stateless: false },
    { label: '128×128', maxCoord: 127, stateless: false },
  ];

  /** Whether the current canvas can be shared via stateless URL/backend. */
  isStateless(): boolean {
    // 16×16 and 32×32 fit within the base-36 coord range (0-35), so they can
    // be encoded into the stateless URL. 64/128 exceed it → client-only.
    return this.canvasSize === 15 || this.canvasSize === 31;
  }

  /**
   * Changes the canvas size. Returns true on success, false if `size` is not
   * a supported canvas size. Larger canvases are client-side only, so their
   * state is not stored in the stateless autosave payload.
   */
  setCanvasSize(size: number): boolean {
    const supported = StateManager.CANVAS_SIZES.some((s) => s.maxCoord === size);
    if (!supported || size === this.canvasSize) {
      return size === this.canvasSize;
    }
    this.canvasSize = size;
    // Clearing committed figures avoids any ambiguity about coordinates
    // living outside the new bounds and drops references to the old size.
    this.clearAll();
    this.emit('canvasSizeChanged', size);
    return true;
  }

  /** Determines current tool letter (case = stroke/fill). Line variants are always stroke. */
  resolveType(): ToolType {
    // Line endings are always stroke-only.
    if (this.currentTool === 'l' || this.currentTool === 's' || this.currentTool === 'b' || this.currentTool === 'v') {
      return this.currentTool;
    }
    if (this.currentTool === 'm') return 'l';
    return (this.fillEnabled ? this.currentTool.toUpperCase() : this.currentTool) as ToolType;
  }

  // --- Selection & Move Tool ---

  /** Returns the index of the topmost figure whose bounding box contains (gx, gy). */
  figureAt(gx: number, gy: number): number {
    for (let i = this.committedFigures.length - 1; i >= 0; i--) {
      const f = this.committedFigures[i]!;
      const minX = Math.min(f.x1, f.p1);
      const maxX = Math.max(f.x1, f.p1);
      const minY = Math.min(f.y1, f.p2);
      const maxY = Math.max(f.y1, f.p2);
      if (gx >= minX && gx <= maxX && gy >= minY && gy <= maxY) return i;
    }
    return -1;
  }

  /** Selects a single figure (or toggles when additive). Returns the index or -1. */
  selectFigureAt(gx: number, gy: number, additive = false): number {
    const idx = this.figureAt(gx, gy);
    if (idx < 0) {
      if (!additive) this.clearSelection();
      return -1;
    }
    if (additive) {
      this.toggleSelection(idx);
      return idx;
    }
    this.setSelection([idx]);
    this.emit('figureHighlighted', this.committedFigures[idx]!);
    return idx;
  }

  /** Selects all figures intersecting the marquee rect (inclusive). */
  selectInRect(x1: number, y1: number, x2: number, y2: number, additive = false) {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const hits: number[] = [];
    this.committedFigures.forEach((f, i) => {
      const fMinX = Math.min(f.x1, f.p1), fMaxX = Math.max(f.x1, f.p1);
      const fMinY = Math.min(f.y1, f.p2), fMaxY = Math.max(f.y1, f.p2);
      if (fMinX <= maxX && fMaxX >= minX && fMinY <= maxY && fMaxY >= minY) hits.push(i);
    });
    if (additive) {
      const set = new Set(this.selectedIndices);
      hits.forEach(i => set.add(i));
      this.setSelection([...set]);
    } else {
      this.setSelection(hits);
    }
  }

  setSelection(indices: number[]) {
    this.selectedIndices = [...indices];
    this.emit('selectionChanged', { indices: this.selectedIndices });
  }

  toggleSelection(idx: number) {
    const pos = this.selectedIndices.indexOf(idx);
    if (pos === -1) this.selectedIndices.push(idx);
    else this.selectedIndices.splice(pos, 1);
    this.emit('selectionChanged', { indices: this.selectedIndices });
  }

  clearSelection() {
    this.selectedIndices = [];
    this.moveOrigFigures = [];
    this.emit('selectionChanged', { indices: [] });
  }

  /** Bounding box (grid coords) of the current selection, or null when empty. */
  selectionBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (this.selectedIndices.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of this.selectedIndices) {
      const f = this.committedFigures[i];
      if (!f) continue;
      minX = Math.min(minX, f.x1, f.p1);
      minY = Math.min(minY, f.y1, f.p2);
      maxX = Math.max(maxX, f.x1, f.p1);
      maxY = Math.max(maxY, f.y1, f.p2);
    }
    return { minX, minY, maxX, maxY };
  }

  /** Begins a move of the current selection, snapshotting original positions. */
  beginMove() {
    this.moveStartX = 0;
    this.moveStartY = 0;
    this.moveOrigFigures = this.selectedIndices.map(i => ({ ...this.committedFigures[i]! }));
  }

  /** Moves the selected figures by (dx, dy) grid steps (live preview). */
  moveSelectedBy(dx: number, dy: number) {
    if (this.selectedIndices.length === 0 || this.moveOrigFigures.length === 0) return;
    this.selectedIndices.forEach((idx, k) => {
      const orig = this.moveOrigFigures[k];
      if (!orig) return;
      const f = this.committedFigures[idx]!;
      f.x1 = orig.x1 + dx;
      f.y1 = orig.y1 + dy;
      f.p1 = orig.p1 + dx;
      f.p2 = orig.p2 + dy;
    });
    this.emit('movePreview', { indices: this.selectedIndices });
  }

  /** Commits a move. Shapes may extend beyond the 0–15 grid (v7), clipped on render. */
  commitMove() {
    if (this.selectedIndices.length === 0) return;
    this.pushHistory();
    this.moveOrigFigures = [];
    this.emitCommitted();
    this.persistIfEnabled();
  }

  /** Nudges the selection by (dx, dy) grid steps (may extend beyond the grid, v7). */
  nudgeSelection(dx: number, dy: number) {
    if (this.selectedIndices.length === 0) return;
    this.beginMove();
    this.moveSelectedBy(dx, dy);
    this.moveOrigFigures = [];
    this.pushHistory();
    this.emitCommitted();
    this.persistIfEnabled();
  }

  /** Resizes the selection's bounding box to (newMinX, newMinY, newMaxX, newMaxY). */
  resizeSelection(newMinX: number, newMinY: number, newMaxX: number, newMaxY: number) {
    const bounds = this.selectionBounds();
    if (!bounds) return;
    const sx = (newMaxX - newMinX) / Math.max(1, bounds.maxX - bounds.minX);
    const sy = (newMaxY - newMinY) / Math.max(1, bounds.maxY - bounds.minY);
    this.selectedIndices.forEach(i => {
      const f = this.committedFigures[i]!;
      f.x1 = Math.round(newMinX + (f.x1 - bounds.minX) * sx);
      f.p1 = Math.round(newMinX + (f.p1 - bounds.minX) * sx);
      f.y1 = Math.round(newMinY + (f.y1 - bounds.minY) * sy);
      f.p2 = Math.round(newMinY + (f.p2 - bounds.minY) * sy);
    });
    this.emit('movePreview', { indices: this.selectedIndices });
  }

  /** Rotates the selection by `steps` (each = 10°) around its center. */
  rotateSelection(steps: number, commitHistory = true) {
    if (this.selectedIndices.length === 0) return;
    if (commitHistory) this.pushHistory();
    this.selectedIndices.forEach(i => {
      const f = this.committedFigures[i]!;
      f.rotation = (f.rotation + steps + 36) % 36;
    });
    this.emitCommitted();
    if (commitHistory) this.persistIfEnabled();
  }

  /** Flips the selection horizontally (mirror around vertical center axis). */
  flipSelectionHorizontal() {
    const bounds = this.selectionBounds();
    if (!bounds) return;
    this.pushHistory();
    const cx = (bounds.minX + bounds.maxX) / 2;
    this.selectedIndices.forEach(i => {
      const f = this.committedFigures[i]!;
      f.x1 = Math.round(2 * cx - f.x1);
      f.p1 = Math.round(2 * cx - f.p1);
    });
    this.emitCommitted();
    this.persistIfEnabled();
  }

  /** Flips the selection vertically (mirror around horizontal center axis). */
  flipSelectionVertical() {
    const bounds = this.selectionBounds();
    if (!bounds) return;
    this.pushHistory();
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.selectedIndices.forEach(i => {
      const f = this.committedFigures[i]!;
      f.y1 = Math.round(2 * cy - f.y1);
      f.p2 = Math.round(2 * cy - f.p2);
    });
    this.emitCommitted();
    this.persistIfEnabled();
  }

  /** Aligns the selection to the canvas or to the selection bounds. */
  alignSelection(axis: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom', toCanvas: boolean) {
    const bounds = this.selectionBounds();
    if (!bounds) return;
    this.pushHistory();
    const dx = (() => {
      if (axis === 'left') return (toCanvas ? 0 : bounds.minX) - bounds.minX;
      if (axis === 'right') return (toCanvas ? 15 : bounds.maxX) - bounds.maxX;
      if (axis === 'centerX') return (toCanvas ? 7.5 : (bounds.minX + bounds.maxX) / 2) - (bounds.minX + bounds.maxX) / 2;
      return 0;
    })();
    const dy = (() => {
      if (axis === 'top') return (toCanvas ? 0 : bounds.minY) - bounds.minY;
      if (axis === 'bottom') return (toCanvas ? 15 : bounds.maxY) - bounds.maxY;
      if (axis === 'centerY') return (toCanvas ? 7.5 : (bounds.minY + bounds.maxY) / 2) - (bounds.minY + bounds.maxY) / 2;
      return 0;
    })();
    this.selectedIndices.forEach(i => {
      const f = this.committedFigures[i]!;
      f.x1 += Math.round(dx); f.p1 += Math.round(dx);
      f.y1 += Math.round(dy); f.p2 += Math.round(dy);
    });
    this.emitCommitted();
    this.persistIfEnabled();
  }

  /** Distributes the selection evenly along the given axis. */
  distributeSelection(axis: 'x' | 'y') {
    if (this.selectedIndices.length < 3) return;
    this.pushHistory();
    const sorted = [...this.selectedIndices].sort((a, b) => {
      const fa = this.committedFigures[a]!, fb = this.committedFigures[b]!;
      return axis === 'x'
        ? Math.min(fa.x1, fa.p1) - Math.min(fb.x1, fb.p1)
        : Math.min(fa.y1, fa.p2) - Math.min(fb.y1, fb.p2);
    });
    const first = sorted[0]!, last = sorted[sorted.length - 1]!;
    const fFirst = this.committedFigures[first]!, fLast = this.committedFigures[last]!;
    const start = axis === 'x' ? Math.min(fFirst.x1, fFirst.p1) : Math.min(fFirst.y1, fFirst.p2);
    const end = axis === 'x' ? Math.max(fLast.x1, fLast.p1) : Math.max(fLast.y1, fLast.p2);
    const gap = (end - start) / (sorted.length - 1);
    sorted.forEach((idx, k) => {
      const f = this.committedFigures[idx]!;
      const cur = axis === 'x' ? Math.min(f.x1, f.p1) : Math.min(f.y1, f.p2);
      const delta = Math.round(start + gap * k - cur);
      if (axis === 'x') { f.x1 += delta; f.p1 += delta; }
      else { f.y1 += delta; f.p2 += delta; }
    });
    this.emitCommitted();
    this.persistIfEnabled();
  }

  // --- Clipboard ---

  copySelection() {
    this.clipboard = this.selectedIndices.map(i => ({ ...this.committedFigures[i]! }));
    this.emit('clipboardChanged', this.clipboard.length);
  }

  /** Pastes the clipboard, offsetting each figure by (dx, dy) and selecting the new copies. */
  pasteClipboard(dx = 1, dy = 1) {
    if (this.clipboard.length === 0) return;
    this.pushHistory();
    const newIndices: number[] = [];
    for (const fig of this.clipboard) {
      const copy: Figure = { ...fig, x1: fig.x1 + dx, y1: fig.y1 + dy, p1: fig.p1 + dx, p2: fig.p2 + dy };
      this.committedFigures.push(copy);
      newIndices.push(this.committedFigures.length - 1);
    }
    this.setSelection(newIndices);
    this.emitCommitted();
    this.persistIfEnabled();
  }

  /** Duplicates the selection in place (offset by 1 grid step). */
  duplicateSelection() {
    if (this.selectedIndices.length === 0) return;
    this.copySelection();
    this.pasteClipboard(1, 1);
  }

  // --- Grouping ---

  /** Groups the selected figures so they move/transform together. */
  groupSelection() {
    if (this.selectedIndices.length < 2) return;
    this.groups.push([...this.selectedIndices]);
    this.emit('groupsChanged', this.groups);
  }

  /** Removes the group containing the given figure index. */
  ungroupSelection() {
    if (this.selectedIndices.length === 0) return;
    const set = new Set(this.selectedIndices);
    this.groups = this.groups.filter(g => !g.some(i => set.has(i)));
    this.emit('groupsChanged', this.groups);
  }

  /** Returns the full set of indices to operate on (expands groups). */
  selectionWithGroups(): number[] {
    const set = new Set(this.selectedIndices);
    for (const g of this.groups) {
      if (g.some(i => set.has(i))) g.forEach(i => set.add(i));
    }
    return [...set];
  }

  // --- Boolean (Pathfinder) operations ---

  /**
   * Applies a boolean operation (union/intersect/subtract) to exactly two
   * selected figures. The two figures are replaced by the resulting
   * rectangle(s). Requires exactly 2 figures selected. This is the
   * "sumowanie / nakładanie / wycinanie" of shapes.
   */
  booleanOp(op: 'union' | 'intersect' | 'subtract') {
    if (this.selectedIndices.length !== 2) return false;
    const ia = this.selectedIndices[0]!;
    const ib = this.selectedIndices[1]!;
    const a = this.committedFigures[ia];
    const b = this.committedFigures[ib];
    if (!a || !b) return false;

    this.pushHistory();
    const results = applyBoolean(a, b, op);
    // Remove the two source figures (higher index first to keep indices valid).
    const [hi, lo] = ia > ib ? [ia, ib] : [ib, ia];
    this.committedFigures.splice(hi, 1);
    this.committedFigures.splice(lo, 1);

    // Insert results at the lo position.
    if (results.length > 0) {
      this.committedFigures.splice(lo, 0, ...results);
    }

    // Fix up groups and selection.
    this.groups = this.groups
      .map(g => g.filter(i => i !== hi && i !== lo).map(i => (i > hi ? i - 1 : i > lo ? i - 1 : i)))
      .filter(g => g.length > 0);

    if (results.length > 0) {
      this.setSelection(results.map((_, k) => lo + k));
    } else {
      this.clearSelection();
    }
    this.emit('groupsChanged', this.groups);
    this.emitCommitted();
    this.persistIfEnabled();
    return true;
  }

  updateDraft(update: Partial<DraftState>) {
    this.draft = { ...this.draft, ...update };
    this.emit('draftUpdated', this.draft);
  }

  commitFigure() {
    if (!this.draft.active) return;
    
    this.pushHistory();

    const newFigure: Figure = {
      x1: this.draft.x1,
      y1: this.draft.y1,
      type: this.draft.type,
      p1: this.draft.p1,
      p2: this.draft.p2,
      color: this.draft.color,
      weight: this.draft.weight,
      opacity: this.draft.opacity,
      rotation: this.draft.rotation,
      zIndex: this.draft.zIndex,
      radius: this.draft.radius,
    };
    
    this.committedFigures.push(newFigure);
    this.draft = { ...this.draft, active: false };
    
    this.emitCommitted();
    this.emit('draftUpdated', this.draft);
    this.persistIfEnabled();
  }

  highlight(fig: Figure) {
    this.emit('figureHighlighted', fig);
  }

  removeFigure(index: number) {
    this.pushHistory();
    this.committedFigures.splice(index, 1);
    // Fix up selection indices and drop groups referencing the removed figure.
    this.selectedIndices = this.selectedIndices
      .filter(i => i !== index)
      .map(i => (i > index ? i - 1 : i));
    this.groups = this.groups
      .map(g => g.filter(i => i !== index).map(i => (i > index ? i - 1 : i)))
      .filter(g => g.length > 0);
    this.emit('selectionChanged', { indices: this.selectedIndices });
    this.emit('groupsChanged', this.groups);
    this.emitCommitted();
    this.persistIfEnabled();
  }

  reorderFigures(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= this.committedFigures.length) return;
    if (toIndex < 0 || toIndex >= this.committedFigures.length) return;
    this.pushHistory();
    const [moved] = this.committedFigures.splice(fromIndex, 1);
    if (!moved) return;
    this.committedFigures.splice(toIndex, 0, moved);
    // Fix up selection + group indices after the reorder.
    this.selectedIndices = this.selectedIndices.map(i => {
      if (i === fromIndex) return toIndex;
      if (fromIndex < toIndex && i > fromIndex && i <= toIndex) return i - 1;
      if (fromIndex > toIndex && i >= toIndex && i < fromIndex) return i + 1;
      return i;
    });
    this.groups = this.groups.map(g => g.map(i => {
      if (i === fromIndex) return toIndex;
      if (fromIndex < toIndex && i > fromIndex && i <= toIndex) return i - 1;
      if (fromIndex > toIndex && i >= toIndex && i < fromIndex) return i + 1;
      return i;
    }));
    this.emit('selectionChanged', { indices: this.selectedIndices });
    this.emit('groupsChanged', this.groups);
    this.emitCommitted();
    this.persistIfEnabled();
  }

  clearAll() {
    this.pushHistory();
    this.committedFigures = [];
    this.selectedIndices = [];
    this.groups = [];
    this.emit('selectionChanged', { indices: [] });
    this.emit('groupsChanged', this.groups);
    this.emitCommitted();
    this.persistIfEnabled();
  }

  /** Ładuje figury z zewnętrznego źródła (np. import, ?import= w URL). */
  loadFigures(figures: Figure[]) {
    this.pushHistory();
    this.committedFigures = figures;
    this.selectedIndices = [];
    this.groups = [];
    this.emit('selectionChanged', { indices: [] });
    this.emit('groupsChanged', this.groups);
    this.emitCommitted();
    this.persistIfEnabled();
  }

  // --- Autozapis w localStorage (opcja deweloperska) ---

  private readLocalStorage(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeLocalStorage(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // localStorage niedostępny (np. tryb prywatny) - po cichu pomijamy.
    }
  }

  setAutosaveEnabled(value: boolean) {
    this.autosaveEnabled = value;
    this.writeLocalStorage(AUTOSAVE_ENABLED_KEY, value ? '1' : '0');
    if (value) this.persistIfEnabled();
    this.emit('autosaveChanged', value);
  }

  private persistIfEnabled() {
    if (!this.autosaveEnabled) return;
    this.writeLocalStorage(AUTOSAVE_DATA_KEY, JSON.stringify({
      canvasSize: this.canvasSize,
      figures: this.committedFigures,
    }));
  }

  /** Ładuje ostatnio zapisany projekt z localStorage (jeśli autozapis jest włączony). Wywoływane raz przy starcie aplikacji. */
  restoreFromLocalStorage() {
    if (!this.autosaveEnabled) return;

    const raw = this.readLocalStorage(AUTOSAVE_DATA_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      // New format: { canvasSize, figures }. Legacy format: array of figures.
      const figures = Array.isArray(parsed) ? parsed : parsed?.figures;
      if (Array.isArray(figures)) {
        if (!Array.isArray(parsed) && typeof parsed?.canvasSize === 'number') {
          this.canvasSize = parsed.canvasSize;
        }
        this.committedFigures = figures;
        this.emitCommitted();
      }
    } catch {
      // Uszkodzone dane - ignorujemy i zaczynamy od pustego stanu.
    }
  }
}

export const stateManager = new StateManager();