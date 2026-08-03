import { stateManager } from './logic/stateManager';
import { decodeState } from './logic/decoder';

type ViewName = 'home' | 'editor' | 'gallery' | 'docs';

interface DestroyableElement extends HTMLElement {
  __destroy?: () => void;
}

/** A view module: a constructable class with a `render(): HTMLElement` method. */
type ViewConstructor = new () => { render: () => HTMLElement };

/** Lazy-loads a view module and returns its constructor. */
async function loadView(view: ViewName): Promise<ViewConstructor> {
  switch (view) {
    case 'home':
      return (await import('./ui/HomeView')).HomeView;
    case 'editor':
      return (await import('./ui/EditorView')).EditorView;
    case 'gallery':
      return (await import('./ui/GalleryView')).GalleryView;
    case 'docs':
      return (await import('./ui/DocsView')).DocsView;
    default:
      return (await import('./ui/HomeView')).HomeView;
  }
}

class App {
  private root: HTMLElement;
  private currentView: DestroyableElement | null = null;
  private navAbort: AbortController | null = null;

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

    window.addEventListener('navigate', (e: Event) => {
      const detail = (e as CustomEvent).detail as ViewName;
      this.navigateTo(detail);
    });
  }

  async navigateTo(view: ViewName) {
    // Abort any in-flight lazy-load of the previous navigation (avoids
    // attaching a stale view if the user navigates quickly).
    this.navAbort?.abort();
    const abort = new AbortController();
    this.navAbort = abort;

    // Destroy the current view FIRST so stale state listeners are released.
    if (this.currentView) {
      this.currentView.__destroy?.();
      this.root.removeChild(this.currentView);
      this.currentView = null;
    }

    const ViewClass = await loadView(view);
    if (abort.signal.aborted) return;

    const instance = new ViewClass();
    this.currentView = instance.render() as DestroyableElement;
    this.root.appendChild(this.currentView);
  }
}

new App();