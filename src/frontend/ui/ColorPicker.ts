import { stateManager } from '../logic/stateManager';
import { PALETTES_64, PALETTE_META, PALETTE_SIZE, encodeColor, getColorIndex } from '../../shared/palette';

/**
 * Color picker with multi-palette support.
 * Shows a palette selector bar + 64-color grid for the active palette.
 * The color value stored in Figure is an 8-bit encoded value:
 *   bits 6-7 = palette ID, bits 0-5 = color index within palette.
 */
export class ColorPicker {
  private currentPaletteId = 0;

  render(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'tool-group';
    group.innerHTML = `<label>Color</label>`;

    // --- Palette selector tabs ---
    const paletteBar = document.createElement('div');
    paletteBar.className = 'palette-bar';

    PALETTE_META.forEach((meta) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'palette-tab';
      tab.textContent = meta.name;
      tab.title = meta.description;

      if (meta.id === this.currentPaletteId) {
        tab.classList.add('active');
      }

      tab.onclick = () => {
        this.currentPaletteId = meta.id;
        stateManager.setPalette(meta.id);
        paletteBar.querySelectorAll('.palette-tab').forEach(el => el.classList.remove('active'));
        tab.classList.add('active');
        grid.innerHTML = '';
        this.buildGrid(grid);
      };

      paletteBar.appendChild(tab);
    });

    group.appendChild(paletteBar);

    // --- Color grid ---
    const grid = document.createElement('div');
    grid.className = 'color-grid';
    this.buildGrid(grid);
    group.appendChild(grid);

    return group;
  }

  private buildGrid(grid: HTMLElement) {
    const palette = PALETTES_64[this.currentPaletteId]!;

    palette.forEach((color, index) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = color;
      swatch.title = `${PALETTE_META[this.currentPaletteId]!.name} #${index.toString(16).padStart(2, '0')} ${color}`;
      swatch.setAttribute('aria-label', `Color ${index}`);

      const encoded = encodeColor(this.currentPaletteId, index);
      if (encoded === stateManager.currentColor) {
        swatch.classList.add('selected');
      }

      swatch.onclick = () => {
        const encodedColor = encodeColor(this.currentPaletteId, index);
        stateManager.setColor(encodedColor);
        grid.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
        swatch.classList.add('selected');
      };

      grid.appendChild(swatch);
    });
  }
}
