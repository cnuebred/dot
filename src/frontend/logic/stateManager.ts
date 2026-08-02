export type ToolBase = 'l' | 'r' | 'c' | 't' | 'a' | 'm';
export type ToolType = 'l' | 'L' | 'r' | 'R' | 'c' | 'C' | 'a' | 'A' | 't' | 'T';

export interface Figure {
  x1: number;
  y1: number;
  type: ToolType;
  p1: number;
  p2: number;
  /** Color index (0-63) from 64-color palette (Format 2.0). */
  color: number;
  /** Line weight (0-15), 16 levels. 0 = thinnest, 15 = thickest. */
  weight: number;
  /** Opacity 0-15 (0=fully transparent, 15=fully opaque). v4. */
  opacity: number;
  /** Rotation 0-15 (0°-337.5°, step 22.5°). v4. */
  rotation: number;
  /** Z-index 0-15 (higher = on top). v4. */
  zIndex: number;
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
}

type StateListener = (data: any) => void;

// localStorage keys used by the developer "autosave" option.
// Data is stored only locally in the user's browser.
const AUTOSAVE_ENABLED_KEY = 'dot:autosave:enabled';
const AUTOSAVE_DATA_KEY = 'dot:autosave:data';

class StateManager {
  private listeners: Map<string, StateListener[]> = new Map();
  
  public committedFigures: Figure[] = [];
  public draft: DraftState = {
    active: false,
    x1: 0, y1: 0, p1: 0, p2: 0,
    type: 'l',
    color: 0,
    weight: 0,
    opacity: 15,
    rotation: 0,
    zIndex: 0,
  };
  public currentTool: ToolBase = 'l';
  public fillEnabled = false;
  public currentColor = 0;
  public currentWeight = 0;
  public currentOpacity = 15;
  public currentRotation = 0;
  public currentZIndex = 0;
  public autosaveEnabled = false;

  // --- Move Tool ---
  public selectedFigureIndex: number = -1;
  private moveStartX: number = 0;
  private moveStartY: number = 0;
  private moveOrigFigure: Figure | null = null;

  // --- Undo/Redo History ---
  private historyStack: Figure[][] = [];
  private historyIndex: number = -1;
  private readonly MAX_HISTORY = 100;
  private historyLocked = false;

  constructor() {
    this.autosaveEnabled = this.readLocalStorage(AUTOSAVE_ENABLED_KEY) === '1';
  }

  subscribe(event: string, listener: StateListener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(listener);
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(listener => listener(data));
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
    this.emit('committedUpdated', this.committedFigures);
    this.emit('historyChanged', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    this.persistIfEnabled();
    this.historyLocked = false;
  }

  redo() {
    if (!this.canRedo()) return;
    this.historyLocked = true;
    this.historyIndex++;
    this.committedFigures = JSON.parse(JSON.stringify(this.historyStack[this.historyIndex]));
    this.emit('committedUpdated', this.committedFigures);
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

  /** Determines current tool letter (case = stroke/fill). Line is always stroke. */
  resolveType(): ToolType {
    if (this.currentTool === 'l' || this.currentTool === 'm') return 'l';
    return (this.fillEnabled ? this.currentTool.toUpperCase() : this.currentTool) as ToolType;
  }

  // --- Move Tool ---

  /** Próbuje zaznaczyć figurę w punkcie (gx, gy) – współrzędne siatki 0-16. */
  selectFigureAt(gx: number, gy: number): number {
    for (let i = this.committedFigures.length - 1; i >= 0; i--) {
      const f = this.committedFigures[i];
      const minX = Math.min(f.x1, f.p1);
      const maxX = Math.max(f.x1, f.p1);
      const minY = Math.min(f.y1, f.p2);
      const maxY = Math.max(f.y1, f.p2);
      if (gx >= minX && gx <= maxX && gy >= minY && gy <= maxY) {
        this.selectedFigureIndex = i;
        this.moveStartX = gx;
        this.moveStartY = gy;
        this.moveOrigFigure = { ...f };
        this.emit('selectionChanged', { index: i, figure: f });
        this.emit('figureHighlighted', f);
        return i;
      }
    }
    this.selectedFigureIndex = -1;
    this.moveOrigFigure = null;
    this.emit('selectionChanged', { index: -1, figure: null });
    return -1;
  }

  /** Przesuwa zaznaczoną figurę o (dx, dy) względem punktu startowego. */
  moveSelectedBy(gx: number, gy: number) {
    if (this.selectedFigureIndex < 0 || !this.moveOrigFigure) return;
    const dx = gx - this.moveStartX;
    const dy = gy - this.moveStartY;
    const orig = this.moveOrigFigure;
    const f = this.committedFigures[this.selectedFigureIndex];
    f.x1 = orig.x1 + dx;
    f.y1 = orig.y1 + dy;
    f.p1 = orig.p1 + dx;
    f.p2 = orig.p2 + dy;
    // Emituj podgląd na froncie (SVG) – bez wysyłania requestu do serwera
    this.emit('movePreview', {
      figureIndex: this.selectedFigureIndex,
      x1: f.x1,
      y1: f.y1,
      p1: f.p1,
      p2: f.p2,
    });
  }

  /** Kończy przesuwanie – zapisuje stan do historii i wysyła do serwera.
   *  Jeśli figura wyszła poza pole 0–15, operacja jest automatycznie cofana (UNDO). */
  commitMove() {
    if (this.selectedFigureIndex < 0) return;
    const f = this.committedFigures[this.selectedFigureIndex];
    const outOfBounds = f.x1 < 0 || f.x1 > 15 || f.y1 < 0 || f.y1 > 15 ||
                        f.p1 < 0 || f.p1 > 15 || f.p2 < 0 || f.p2 > 15;
    if (outOfBounds && this.moveOrigFigure) {
      // UNDO – przywróć figurę do stanu sprzed przesunięcia
      this.committedFigures[this.selectedFigureIndex] = { ...this.moveOrigFigure };
    } else {
      this.pushHistory();
    }
    this.selectedFigureIndex = -1;
    this.moveOrigFigure = null;
    this.emit('selectionChanged', { index: -1, figure: null });
    this.emit('committedUpdated', this.committedFigures);
    this.persistIfEnabled();
  }

  clearSelection() {
    this.selectedFigureIndex = -1;
    this.moveOrigFigure = null;
    this.emit('selectionChanged', { index: -1, figure: null });
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
    };
    
    this.committedFigures.push(newFigure);
    this.draft = { ...this.draft, active: false };
    
    this.emit('committedUpdated', this.committedFigures);
    this.emit('draftUpdated', this.draft);
    this.persistIfEnabled();
  }

  highlight(fig: Figure) {
    this.emit('figureHighlighted', fig);
  }

  removeFigure(index: number) {
    this.pushHistory();
    this.committedFigures.splice(index, 1);
    this.emit('committedUpdated', this.committedFigures);
    this.persistIfEnabled();
  }

  reorderFigures(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= this.committedFigures.length) return;
    if (toIndex < 0 || toIndex >= this.committedFigures.length) return;
    this.pushHistory();
    const [moved] = this.committedFigures.splice(fromIndex, 1);
    this.committedFigures.splice(toIndex, 0, moved);
    this.emit('committedUpdated', this.committedFigures);
    this.persistIfEnabled();
  }

  clearAll() {
    this.pushHistory();
    this.committedFigures = [];
    this.emit('committedUpdated', this.committedFigures);
    this.persistIfEnabled();
  }

  /** Ładuje figury z zewnętrznego źródła (np. import, ?import= w URL). */
  loadFigures(figures: Figure[]) {
    this.pushHistory();
    this.committedFigures = figures;
    this.emit('committedUpdated', this.committedFigures);
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
    this.writeLocalStorage(AUTOSAVE_DATA_KEY, JSON.stringify(this.committedFigures));
  }

  /** Ładuje ostatnio zapisany projekt z localStorage (jeśli autozapis jest włączony). Wywoływane raz przy starcie aplikacji. */
  restoreFromLocalStorage() {
    if (!this.autosaveEnabled) return;

    const raw = this.readLocalStorage(AUTOSAVE_DATA_KEY);
    if (!raw) return;

    try {
      const restored = JSON.parse(raw);
      if (Array.isArray(restored)) {
        this.committedFigures = restored;
        this.emit('committedUpdated', this.committedFigures);
      }
    } catch {
      // Uszkodzone dane - ignorujemy i zaczynamy od pustego stanu.
    }
  }
}

export const stateManager = new StateManager();