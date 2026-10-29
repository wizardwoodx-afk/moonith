import { nodeStorage } from '../host/knight'

export interface MainStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const volatile = new Map<string, string>()
const memoryStorage: MainStorage = {
  getItem: (key) => volatile.get(key) ?? null,
  setItem: (key, value) => {
    volatile.set(key, String(value))
  },
  removeItem: (key) => {
    volatile.delete(key)
  }
}

/**
 * The renderer (and tests) may inject a Storage. The Electron main process has
 * none, so the engine's learning stores fall back to the native file adapter.
 */
export function mainStorage(): MainStorage {
  try {
    const local = globalThis.localStorage
    if (local && typeof local.getItem === 'function') return local
  } catch {
    // Sandboxed hosts can throw on access; use the native adapter instead.
  }
  if (process.versions?.electron) return nodeStorage
  return memoryStorage
}
