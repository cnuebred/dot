/**
 * Memoized encoder for committed state.
 *
 * `encodeState` (zlib + Base64URL) is relatively expensive. It is invoked on
 * every committed update by multiple components (Toolbar import input, ExportModal,
 * etc.). This module caches the last encoded payload keyed by the state's
 * `committedRevision`, so repeated encodings of unchanged state are free.
 */
import { encodeState } from './encoder';
import { stateManager } from './stateManager';

let lastRevision = -1;
let lastSize = -1;
let lastEncoded = '';

/** Returns the compressed Base64URL payload for the current committed figures. */
export function encodeCommittedState(): string {
  if (stateManager.committedRevision === lastRevision && stateManager.canvasSize === lastSize) {
    return lastEncoded;
  }
  lastEncoded = encodeState(stateManager.committedFigures, stateManager.canvasSize);
  lastRevision = stateManager.committedRevision;
  lastSize = stateManager.canvasSize;
  return lastEncoded;
}

/** Invalidates the memo (call when figures change without a revision bump). */
export function resetEncodedStateCache(): void {
  lastRevision = -1;
  lastSize = -1;
  lastEncoded = '';
}
