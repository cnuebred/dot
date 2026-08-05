import { stateManager, StateManager } from '../logic/stateManager';
import type { ToolBase } from '../logic/stateManager';
import { ExportModal } from './ExportModal';
import { ColorPicker } from './ColorPicker';
import { decodeState } from '../logic/decoder';
import { encodeStateRaw } from '../logic/encoder';
import { encodeCommittedState } from '../logic/encodeMemo';
import { PALETTE_META } from '../../shared/palette';

export class Toolbar {
  private unsubs: Array<() => void> = [];

  render(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'toolbar';

    const toolGroup = document.createElement('div');
    toolGroup.className = 'tool-group';
    toolGroup.innerHTML = `<label>Tools</label>`;

    // Uwaga: narzędzia strzałkowe ('v' linia, 'z' łuk) są tymczasowo ukryte w UI,
    // ale ich logika (renderowanie/walidacja) pozostaje aktywna w kodzie.
    const tools: { id: ToolBase, label: string }[] = [
      { id: 'l', label: 'Line' },
      { id: 's', label: 'Line (square)' },
      { id: 'b', label: 'Line (flat)' },
      { id: 'r', label: 'Rectangle' },
      { id: 'c', label: 'Circle' },
      { id: 't', label: 'Triangle' },
      { id: 'a', label: 'Arc' },
      { id: 'k', label: 'Arc (square)' },
      { id: 'n', label: 'Arc (flat)' },
      { id: 'm', label: '✋ Move' },
    ];

    tools.forEach(tool => {
      const option = document.createElement('div');
      option.className = 'tool-option';
      const isChecked = stateManager.currentTool === tool.id;
      
      option.innerHTML = `
        <input type="radio" name="tool" value="${tool.id}" ${isChecked ? 'checked' : ''}>
        <span>${tool.label}</span>
      `;
      
      option.onclick = () => {
        stateManager.setTool(tool.id);
        toolGroup.querySelectorAll<HTMLInputElement>('input[name="tool"]').forEach(input => {
          input.checked = input.value === tool.id;
        });
      };
      toolGroup.appendChild(option);
    });

    container.appendChild(toolGroup);

    // Undo/Redo buttons
    const historyGroup = document.createElement('div');
    historyGroup.className = 'tool-group';
    historyGroup.innerHTML = `<label>History</label>`;

    const historyButtons = document.createElement('div');
    historyButtons.className = 'history-buttons';

    const undoBtn = document.createElement('button');
    undoBtn.className = 'history-btn';
    undoBtn.textContent = '↩';
    undoBtn.title = 'Undo (Ctrl+Z)';
    undoBtn.disabled = !stateManager.canUndo();
    undoBtn.onclick = () => stateManager.undo();

    const redoBtn = document.createElement('button');
    redoBtn.className = 'history-btn';
    redoBtn.textContent = '↪';
    redoBtn.title = 'Redo (Ctrl+Shift+Z)';
    redoBtn.disabled = !stateManager.canRedo();
    redoBtn.onclick = () => stateManager.redo();

    this.unsubs.push(stateManager.subscribe('historyChanged', (data: { canUndo: boolean; canRedo: boolean }) => {
      undoBtn.disabled = !data.canUndo;
      redoBtn.disabled = !data.canRedo;
    }));

    historyButtons.append(undoBtn, redoBtn);
    historyGroup.appendChild(historyButtons);
    container.appendChild(historyGroup);

    // Stroke / Fill toggle (not applicable to lines)
    const fillGroup = document.createElement('div');
    fillGroup.className = 'tool-group';
    fillGroup.innerHTML = `<label>Fill</label>`;

    const switchWrapper = document.createElement('label');
    switchWrapper.className = 'toggle-switch';

    const fillCheckbox = document.createElement('input');
    fillCheckbox.type = 'checkbox';
    fillCheckbox.checked = stateManager.fillEnabled;
    fillCheckbox.onchange = () => stateManager.setFillEnabled(fillCheckbox.checked);

    const slider = document.createElement('span');
    slider.className = 'toggle-slider';

    switchWrapper.append(fillCheckbox, slider);

    const hint = document.createElement('p');
    hint.className = 'hint-text';
    hint.textContent = 'Line is always drawn with stroke only.';

    fillGroup.append(switchWrapper, hint);
    container.appendChild(fillGroup);

    // Palette selector (multi-palette support)
    const paletteGroup = document.createElement('div');
    paletteGroup.className = 'tool-group';
    paletteGroup.innerHTML = `<label>Palette</label>`;

    // Line weight selection (16 levels, 0-15)
    const weightGroup = document.createElement('div');
    weightGroup.className = 'tool-group';
    weightGroup.innerHTML = `<label>Line Weight</label>`;

    const weightSlider = document.createElement('input');
    weightSlider.type = 'range';
    weightSlider.min = '0';
    weightSlider.max = '35';
    weightSlider.value = String(stateManager.currentWeight);
    weightSlider.className = 'weight-slider';
    weightSlider.oninput = () => stateManager.setWeight(parseInt(weightSlider.value));

    const weightLabel = document.createElement('span');
    weightLabel.className = 'weight-value';
    weightLabel.textContent = String(stateManager.currentWeight);

    weightSlider.oninput = () => {
      const val = parseInt(weightSlider.value);
      weightLabel.textContent = String(val);
      stateManager.setWeight(val);
    };

    weightGroup.append(weightSlider, weightLabel);
    container.appendChild(weightGroup);

    // --- v4: Opacity ---
    const opacityGroup = document.createElement('div');
    opacityGroup.className = 'tool-group';
    opacityGroup.innerHTML = `<label>Opacity</label>`;

    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range';
    opacitySlider.min = '0';
    opacitySlider.max = '35';
    opacitySlider.value = String(stateManager.currentOpacity);
    opacitySlider.className = 'weight-slider';
    const opacityLabel = document.createElement('span');
    opacityLabel.className = 'weight-value';
    opacityLabel.textContent = Math.round(stateManager.currentOpacity / 35 * 100) + '%';

    opacitySlider.oninput = () => {
      const val = parseInt(opacitySlider.value);
      opacityLabel.textContent = Math.round(val / 35 * 100) + '%';
      stateManager.setOpacity(val);
    };

    opacityGroup.append(opacitySlider, opacityLabel);
    container.appendChild(opacityGroup);

    // --- Erase Mode (knockout) ---
    const eraseGroup = document.createElement('div');
    eraseGroup.className = 'tool-group';
    eraseGroup.innerHTML = `<label>Erase Mode</label>`;

    const eraseSwitchWrapper = document.createElement('label');
    eraseSwitchWrapper.className = 'toggle-switch';

    const eraseCheckbox = document.createElement('input');
    eraseCheckbox.type = 'checkbox';
    eraseCheckbox.checked = stateManager.currentOpacity === 0;
    eraseCheckbox.onchange = () => {
      if (eraseCheckbox.checked) {
        stateManager.setOpacity(0);
        opacitySlider.value = '0';
        opacityLabel.textContent = '0%';
      } else {
        stateManager.setOpacity(35);
        opacitySlider.value = '35';
        opacityLabel.textContent = '100%';
      }
    };

    const eraseSlider = document.createElement('span');
    eraseSlider.className = 'toggle-slider';
    eraseSlider.style.backgroundColor = '#ef4444';

    eraseSwitchWrapper.append(eraseCheckbox, eraseSlider);

    const eraseHint = document.createElement('p');
    eraseHint.className = 'hint-text';
    eraseHint.textContent = 'Figure punches a hole through underlying shapes (knockout effect).';

    // Sync checkbox with opacity slider
    this.unsubs.push(stateManager.subscribe('opacityChanged', (val: number) => {
      eraseCheckbox.checked = val === 0;
    }));

    eraseGroup.append(eraseSwitchWrapper, eraseHint);
    container.appendChild(eraseGroup);

    // --- v4: Rotation ---
    const rotationGroup = document.createElement('div');
    rotationGroup.className = 'tool-group';
    rotationGroup.innerHTML = `<label>Rotation</label>`;

    const rotationSlider = document.createElement('input');
    rotationSlider.type = 'range';
    rotationSlider.min = '0';
    rotationSlider.max = '35';
    rotationSlider.value = String(stateManager.currentRotation);
    rotationSlider.className = 'weight-slider';
    rotationSlider.oninput = () => {
      const val = parseInt(rotationSlider.value);
      stateManager.setRotation(val);
    };

    const rotationLabel = document.createElement('span');
    rotationLabel.className = 'weight-value';
    rotationLabel.textContent = (stateManager.currentRotation * 10) + '°';

    rotationSlider.oninput = () => {
      const val = parseInt(rotationSlider.value);
      rotationLabel.textContent = (val * 10) + '°';
      stateManager.setRotation(val);
    };

    rotationGroup.append(rotationSlider, rotationLabel);
    container.appendChild(rotationGroup);

    // --- v4: Z-Index (layer order) ---
    const zIndexGroup = document.createElement('div');
    zIndexGroup.className = 'tool-group';
    zIndexGroup.innerHTML = `<label>Z-Layer</label>`;

    const zIndexSlider = document.createElement('input');
    zIndexSlider.type = 'range';
    zIndexSlider.min = '0';
    zIndexSlider.max = '35';
    zIndexSlider.value = String(stateManager.currentZIndex);
    zIndexSlider.className = 'weight-slider';
    zIndexSlider.oninput = () => {
      const val = parseInt(zIndexSlider.value);
      stateManager.setZIndex(val);
    };

    const zIndexLabel = document.createElement('span');
    zIndexLabel.className = 'weight-value';
    zIndexLabel.textContent = String(stateManager.currentZIndex);

    zIndexSlider.oninput = () => {
      const val = parseInt(zIndexSlider.value);
      zIndexLabel.textContent = String(val);
      stateManager.setZIndex(val);
    };

    zIndexGroup.append(zIndexSlider, zIndexLabel);
    container.appendChild(zIndexGroup);

    // --- Radius (rounded corners) ---
    const radiusGroup = document.createElement('div');
    radiusGroup.className = 'tool-group';
    radiusGroup.innerHTML = `<label>Radius</label>`;

    const radiusSlider = document.createElement('input');
    radiusSlider.type = 'range';
    radiusSlider.min = '0';
    radiusSlider.max = '35';
    radiusSlider.value = String(stateManager.currentRadius);
    radiusSlider.className = 'weight-slider';
    radiusSlider.oninput = () => {
      const val = parseInt(radiusSlider.value);
      radiusLabel.textContent = String(val);
      stateManager.setRadius(val);
    };

    const radiusLabel = document.createElement('span');
    radiusLabel.className = 'weight-value';
    radiusLabel.textContent = String(stateManager.currentRadius);

    radiusGroup.append(radiusSlider, radiusLabel);
    container.appendChild(radiusGroup);

    // --- Canvas size (points per axis) ---
    // Larger canvases are client-side only: the 64/128 canvases cannot be
    // encoded into the stateless URL, so their hotlink/export is disabled.
    const canvasSizeGroup = document.createElement('div');
    canvasSizeGroup.className = 'tool-group';
    canvasSizeGroup.innerHTML = `<label>Canvas Size</label>`;

    const canvasSizeSelect = document.createElement('select');
    canvasSizeSelect.className = 'canvas-size-select';

    const canvasSizeHint = document.createElement('p');
    canvasSizeHint.className = 'hint-text';
    canvasSizeHint.style.cssText = 'min-height:1.2em;font-size:0.78rem;color:#64748b;margin-top:0.25rem;';

    const renderCanvasSizeOptions = () => {
      canvasSizeSelect.innerHTML = '';
      for (const size of StateManager.CANVAS_SIZES) {
        const opt = document.createElement('option');
        opt.value = String(size.maxCoord);
        opt.textContent = size.label + (size.stateless ? '' : ' (client-only)');
        if (size.maxCoord === stateManager.canvasSize) opt.selected = true;
        canvasSizeSelect.appendChild(opt);
      }
    };
    renderCanvasSizeOptions();

    const refreshCanvasSizeHint = () => {
      const size = StateManager.CANVAS_SIZES.find((s) => s.maxCoord === stateManager.canvasSize);
      canvasSizeHint.textContent = size && !size.stateless
        ? 'This canvas is client-only – hotlink & export are disabled.'
        : '';
    };
    refreshCanvasSizeHint();

    canvasSizeSelect.onchange = () => {
      const newSize = parseInt(canvasSizeSelect.value);
      if (newSize === stateManager.canvasSize) return;
      const target = StateManager.CANVAS_SIZES.find((s) => s.maxCoord === newSize);
      if (target && !target.stateless) {
        const ok = window.confirm(
          `Switching to a ${target.label} canvas is client-only.\n\n` +
          'You will lose the stateless (shareable) hotlink, and the Export / Gallery ' +
          'options will be disabled for this canvas. The current drawing will be cleared.\n\n' +
          'Continue?'
        );
        if (!ok) {
          // Revert selection to current size.
          canvasSizeSelect.value = String(stateManager.canvasSize);
          return;
        }
      }
      stateManager.setCanvasSize(newSize);
      renderCanvasSizeOptions();
      refreshCanvasSizeHint();
    };

    this.unsubs.push(stateManager.subscribe('canvasSizeChanged', () => {
      renderCanvasSizeOptions();
      refreshCanvasSizeHint();
    }));

    canvasSizeGroup.append(canvasSizeSelect, canvasSizeHint);
    container.appendChild(canvasSizeGroup);

    // Color selection (64-color palette)
    container.appendChild(new ColorPicker().render());

    // Developer panel: auto-save to localStorage
    const devGroup = document.createElement('div');
    devGroup.className = 'tool-group';
    devGroup.innerHTML = `<label>Developer</label>`;

    const devSwitchWrapper = document.createElement('label');
    devSwitchWrapper.className = 'toggle-switch';

    const autosaveCheckbox = document.createElement('input');
    autosaveCheckbox.type = 'checkbox';
    autosaveCheckbox.checked = stateManager.autosaveEnabled;
    autosaveCheckbox.onchange = () => stateManager.setAutosaveEnabled(autosaveCheckbox.checked);

    const devSlider = document.createElement('span');
    devSlider.className = 'toggle-slider';

    devSwitchWrapper.append(autosaveCheckbox, devSlider);

    const devHint = document.createElement('p');
    devHint.className = 'dev-hint';
    devHint.textContent = 'Auto-save project to browser localStorage.';

    devGroup.append(devSwitchWrapper, devHint);
    container.appendChild(devGroup);

    // Skróty klawiszowe (podpowiedź)
    const shortcutsGroup = document.createElement('div');
    shortcutsGroup.className = 'tool-group';
    shortcutsGroup.innerHTML = `
      <label>Shortcuts</label>
      <p class="shortcuts-hint">
        <kbd>1-5</kbd> tool · <kbd>F</kbd> fill · <kbd>Del</kbd> delete ·
        <kbd>Ctrl+C/V/D</kbd> copy/paste/dup · <kbd>Ctrl+E</kbd> export
      </p>
    `;
    container.appendChild(shortcutsGroup);

    // Grupa Import/Eksport
    const ioGroup = document.createElement('div');
    ioGroup.className = 'tool-group';
    ioGroup.innerHTML = `<label>Import / Export</label>`;

    const importInput = document.createElement('input');
    importInput.className = 'input-field';
    importInput.type = 'text';
    importInput.placeholder = 'Paste link or payload...';
    importInput.style.cssText = 'width:100%;margin-bottom:0.5rem;';

    const importStatus = document.createElement('p');
    importStatus.className = 'hint-text';
    importStatus.style.cssText = 'min-height:1.2em;';

    // Funkcja aktualizująca input z bieżącego stanu canvasu
    const updateImportInput = () => {
      importInput.disabled = false;
      if (stateManager.isStateless()) {
        importInput.placeholder = 'Paste link or payload...';
        const encoded = encodeCommittedState();
        if (encoded) {
          importInput.value = `${window.location.origin}/r/${encoded}`;
        } else {
          importInput.value = '';
        }
      } else {
        // 64/128 canvases: no backend hotlink, but shareable as a RAW link.
        importInput.placeholder = 'RAW link (client-only export)';
        const raw = encodeStateRaw(stateManager.committedFigures, stateManager.canvasSize);
        importInput.value = raw ? `${window.location.origin}/raw/${raw}` : '';
        importStatus.textContent = '';
      }
    };

    importInput.oninput = () => {
      const value = importInput.value.trim();
      if (!value) {
        importStatus.textContent = '';
        return;
      }

      // Wyciągnij payload z URL (obsługuje /r/, /p/, /i/, ?import=, lub surowy payload)
      let payload = value;
      try {
        const url = new URL(value);
        // /r/payload, /raw/payload, /p/id, /i/payload
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2 && (pathParts[0] === 'r' || pathParts[0] === 'i')) {
          payload = pathParts[1]!;
        } else if (pathParts.length >= 2 && pathParts[0] === 'raw') {
          // /raw/<text payload> — reconstruct the raw payload (may contain ':').
          payload = url.pathname.slice('/raw/'.length);
        } else if (url.searchParams.has('import')) {
          payload = url.searchParams.get('import')!;
        }
      } catch {
        // Nie URL – traktuj jako surowy payload
      }

      const decoded = decodeState(payload);
      if (decoded && decoded.figures.length > 0) {
        // v8 payloads carry their canvas size – restore it on import.
        stateManager.setCanvasSize(decoded.size);
        stateManager.loadFigures(decoded.figures);
        importStatus.textContent = `✅ Imported ${decoded.figures.length} figures`;
        importStatus.style.color = '#4ade80';
      } else if (payload.length > 0) {
        importStatus.textContent = '❌ Invalid format';
        importStatus.style.color = '#f87171';
      }
    };

    // Nasłuchuj zmian canvasu i aktualizuj input
    this.unsubs.push(stateManager.subscribe('committedUpdated', updateImportInput));

    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn-primary';
    exportBtn.textContent = 'Export';
    exportBtn.style.width = '100%';
    exportBtn.onclick = () => {
      const modal = new ExportModal().render();
      document.body.appendChild(modal);
    };

    ioGroup.append(importInput, importStatus, exportBtn);
    container.appendChild(ioGroup);

    return container;
  }

  /** Registers subscriptions. Call after the toolbar DOM is rendered. Returns a cleanup function. */
  attach(): () => void {
    // No-op for now – subscriptions are registered during render() and tracked in this.unsubs.
    return () => {
      for (const unsub of this.unsubs) unsub();
      this.unsubs = [];
    };
  }
}
