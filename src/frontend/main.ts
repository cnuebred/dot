import { HomeView } from './ui/HomeView';
import { EditorView } from './ui/EditorView';
import { GalleryView } from './ui/GalleryView';
import { DocsView } from './ui/DocsView';
import { stateManager } from './logic/stateManager';
import { decodeState } from './logic/decoder';

type ViewName = 'home' | 'editor' | 'gallery' | 'docs';

interface DestroyableElement extends HTMLElement {
  __destroy?: () => void;
}

class App {
  private root: HTMLElement;
  private currentView: DestroyableElement | null = null;

  constructor() {
    this.root = document.getElementById('app')!;
    this.init();
  }

  private init() {
    // Load any auto-saved project if the developer option is enabled.
    stateManager.restoreFromLocalStorage();

    // Check ?import= URL parameter – if present, load icon and navigate to editor
    const params = new URLSearchParams(window.location.search);
    const importPayload = params.get('import');
    if (importPayload) {
      const figures = decodeState(importPayload);
      if (figures && figures.length > 0) {
        stateManager.loadFigures(figures);
        // Remove parameter from URL (without reload)
        const url = new URL(window.location.href);
        url.searchParams.delete('import');
        window.history.replaceState({}, '', url.toString());
      }
    }

    this.navigateTo('home');
    
    window.addEventListener('navigate', (e: any) => {
      this.navigateTo(e.detail);
    });
  }

  navigateTo(view: ViewName) {
    if (this.currentView) {
      this.currentView.__destroy?.();
      this.root.removeChild(this.currentView);
    }

    if (view === 'home') {
      this.currentView = new HomeView().render();
    } else if (view === 'gallery') {
      this.currentView = new GalleryView().render();
    } else if (view === 'docs') {
      this.currentView = new DocsView().render();
    } else {
      this.currentView = new EditorView().render();
    }

    this.root.appendChild(this.currentView);
  }
}

new App();