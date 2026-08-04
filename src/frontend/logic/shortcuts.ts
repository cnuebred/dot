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
 *  Delete      - delete selected figures (or last figure when none selected)
 *  Ctrl+Z      - undo
 *  Ctrl+Shift+Z - redo
 *  Ctrl/Cmd+C  - copy selection
 *  Ctrl/Cmd+V  - paste clipboard
 *  Ctrl/Cmd+D  - duplicate selection
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

    const mod = e.ctrlKey || e.metaKey;

    // Ctrl+Shift+Z = Redo (check before Ctrl+Z)
    if (mod && e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      stateManager.redo();
      return;
    }

    // Ctrl+Z = Undo
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      stateManager.undo();
      return;
    }

    // Copy / Paste / Duplicate / Group / Ungroup
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      stateManager.copySelection();
      return;
    }
    if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      stateManager.pasteClipboard();
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      stateManager.duplicateSelection();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (stateManager.selectedIndices.length > 0) {
        // Delete selected figures (highest index first to keep indices valid).
        const toDelete = [...stateManager.selectedIndices].sort((a, b) => b - a);
        for (const idx of toDelete) stateManager.removeFigure(idx);
      } else {
        stateManager.removeFigure(stateManager.committedFigures.length - 1);
      }
      return;
    }

    if (mod && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      document.body.appendChild(new ExportModal().render());
      return;
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
