import { stateManager } from '../logic/stateManager';
import type { Figure } from '../logic/stateManager';
import { getColorByIndex } from '../../shared/palette';

export class LayerPanel {
  private container: HTMLElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'layer-panel';
    this.init();
  }

  private init() {
    stateManager.subscribe('committedUpdated', (figures: Figure[]) => {
      this.renderLayers(figures);
    });
    stateManager.subscribe('figureHighlighted', (fig: Figure) => {
      this.highlightSvgElement(fig);
    });
    this.renderLayers(stateManager.committedFigures);
  }

  private highlightSvgElement(fig: Figure) {
    // Find figure index in committedFigures
    const idx = stateManager.committedFigures.indexOf(fig);
    if (idx < 0) return;

    // Highlight the layer element
    const layerItem = this.container.querySelector(`.layer-item[data-index="${idx}"]`);
    if (!layerItem) return;

    layerItem.classList.add('highlight-pulse');
    setTimeout(() => {
      layerItem.classList.remove('highlight-pulse');
    }, 800);
  }

  private renderLayers(figures: Figure[]) {
    this.container.innerHTML = '';
    
    const title = document.createElement('div');
    title.className = 'tool-group';
    title.innerHTML = `<label>Layers (${figures.length})</label>`;
    this.container.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'layer-list';

    figures.forEach((fig, index) => {
      const item = document.createElement('li');
      item.className = 'layer-item' + (fig.opacity === 0 ? ' erase-mode' : '');
      item.draggable = true;
      item.dataset.index = String(index);
      item.onclick = () => stateManager.highlight(fig);

      // Drag & drop
      item.ondragstart = (e: DragEvent) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        item.classList.add('dragging');
      };
      item.ondragend = () => {
        item.classList.remove('dragging');
        list.querySelectorAll('.layer-item').forEach(el => el.classList.remove('drag-over'));
      };
      item.ondragover = (e: DragEvent) => {
        e.preventDefault();
        if (!e.dataTransfer) return;
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-over');
      };
      item.ondragleave = () => {
        item.classList.remove('drag-over');
      };
      item.ondrop = (e: DragEvent) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const fromIndex = parseInt(e.dataTransfer?.getData('text/plain') ?? '');
        const toIndex = parseInt(item.dataset.index ?? '');
        if (!isNaN(fromIndex) && !isNaN(toIndex)) {
          stateManager.reorderFigures(fromIndex, toIndex);
        }
      };

      const swatch = document.createElement('span');
      swatch.className = 'layer-color-swatch';
      swatch.style.backgroundColor = getColorByIndex(fig.color);

      const info = document.createElement('span');
      info.textContent = `Figure ${index + 1}: ${fig.type} (${fig.x1},${fig.y1})`;
      
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-delete';
      delBtn.textContent = '✕';
      delBtn.onclick = () => stateManager.removeFigure(index);
      
      item.append(swatch, info, delBtn);
      list.appendChild(item);
    });

    this.container.appendChild(list);
  }

  render(): HTMLElement {
    return this.container;
  }
}