import { stateManager } from './stateManager';
import type { ToolBase } from './stateManager';
import { ExportModal } from '../ui/ExportModal';

const TOOL_KEYS: Record<string, ToolBase> = {
  '1': 'l',
  '2': 'r',
  '3': 'c',
  '4': 't',
  '5': 'a',
};

/**
 * Registers global editor keyboard shortcuts:
 *  1-5         - tool selection (line/rectangle/circle/triangle/arc)
 *  F           - fill toggle
 *  Delete      - delete last figure
 *  Ctrl+Z      - undo
 *  Ctrl+Shift+Z - redo
 *  Ctrl/Cmd+E  - open export modal
 *
 * Returns a cleanup function (call when leaving the editor view).
 */
export function initKeyboardShortcuts(): () => void {
  const handler = (e: KeyboardEvent) => {
    // Ignore shortcuts when user is typing in a text field (e.g. gallery title).
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    const tool = TOOL_KEYS[e.key];
    if (tool) {
      stateManager.setTool(tool);
      return;
    }

    if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
      stateManager.setFillEnabled(!stateManager.fillEnabled);
      return;
    }

    // Ctrl+Shift+Z = Redo (check before Ctrl+Z)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      stateManager.redo();
      return;
    }

    // Ctrl+Z = Undo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      stateManager.undo();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      stateManager.removeFigure(stateManager.committedFigures.length - 1);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      document.body.appendChild(new ExportModal().render());
      return;
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
