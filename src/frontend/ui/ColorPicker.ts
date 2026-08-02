import { stateManager } from '../logic/stateManager';
import { PALETTE_64 } from '../../shared/palette';

/**
 * 64-color grid (8x8) for selecting the current figure's color.
 * Selecting a color updates stateManager.currentColor.
 */
export class ColorPicker {
  render(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'tool-group';
    group.innerHTML = `<label>Color</label>`;

    const grid = document.createElement('div');
    grid.className = 'color-grid';

    PALETTE_64.forEach((color, index) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = color;
      swatch.title = `#${index.toString(16).padStart(2, '0')} ${color}`;
      swatch.setAttribute('aria-label', `Color ${index}`);

      if (index === stateManager.currentColor) {
        swatch.classList.add('selected');
      }

      swatch.onclick = () => {
        stateManager.setColor(index);
        grid.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
        swatch.classList.add('selected');
      };

      grid.appendChild(swatch);
    });

    group.appendChild(grid);
    return group;
  }
}
