import { Toolbar } from './Toolbar';
import { GridCanvas } from './GridCanvas';
import { LayerPanel } from './LayerPanel';
import { initKeyboardShortcuts } from '../logic/shortcuts';

/** Element z dołączoną funkcją sprzątającą (usuwaną przez router przy zmianie widoku). */
export interface DestroyableElement extends HTMLElement {
  __destroy?: () => void;
}

export class EditorView {
  render(): DestroyableElement {
    const container = document.createElement('div') as DestroyableElement;
    container.className = 'editor-view';

    // Lewy Panel: Narzędzia
    const leftPanel = document.createElement('div');
    leftPanel.className = 'panel';
    leftPanel.id = 'left-panel';
    leftPanel.appendChild(new Toolbar().render());

    // Przycisk toggle dla lewego panelu (widoczny tylko na mobile)
    const leftToggle = document.createElement('button');
    leftToggle.className = 'panel-toggle panel-toggle-left';
    leftToggle.innerHTML = '☰';
    leftToggle.title = 'Show/hide tools';
    leftToggle.onclick = () => {
      leftPanel.classList.toggle('panel-open');
      leftToggle.classList.toggle('active');
    };

    // Środek: Canvas
    const canvasArea = document.createElement('div');
    canvasArea.className = 'canvas-container';
    canvasArea.appendChild(new GridCanvas().render());

    // Prawy Panel: Warstwy
    const rightPanel = document.createElement('div');
    rightPanel.className = 'panel-right';
    rightPanel.id = 'right-panel';
    rightPanel.style.height = '100%';
    rightPanel.style.overflowY = 'auto';
    rightPanel.appendChild(new LayerPanel().render());

    // Przycisk toggle dla prawego panelu (widoczny tylko na mobile)
    const rightToggle = document.createElement('button');
    rightToggle.className = 'panel-toggle panel-toggle-right';
    rightToggle.innerHTML = '☰';
    rightToggle.title = 'Show/hide layers';
    rightToggle.onclick = () => {
      rightPanel.classList.toggle('panel-open');
      rightToggle.classList.toggle('active');
    };

    container.append(leftPanel, leftToggle, canvasArea, rightToggle, rightPanel);

    const unbindShortcuts = initKeyboardShortcuts();
    container.__destroy = unbindShortcuts;

    return container;
  }
}