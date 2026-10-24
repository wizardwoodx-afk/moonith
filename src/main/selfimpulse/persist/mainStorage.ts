import { nodeStorage } from './nodeStorage'

/**
 * Renderer tests/editions may inject Storage; Electron's main process uses the
 * native file adapter. Resolved per call so test and host initialization order
 * cannot freeze the wrong backend.
 */
export function mainStorage(): Storage {
  try {
    const local = globalThis.localStorage
    if (local && typeof local.getItem === 'function') return local
  } catch {
    // Sandboxed hosts can throw on access; use the native adapter instead.
  }
  return nodeStorage
}
