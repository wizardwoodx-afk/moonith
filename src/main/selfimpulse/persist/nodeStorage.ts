import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '../../atomic'

let configuredRoot: string | null = null
const volatile = new Map<string, string>()

/** Set by the Electron entrypoint after portable/userData path selection. */
export function configureNodeStorageRoot(root: string): void {
  configuredRoot = root
}

export function resetNodeStorageForTests(): void {
  configuredRoot = null
  volatile.clear()
}

function storageRoot(): string | null {
  if (configuredRoot) return configuredRoot
  if (process.env.SELFIMPULSE_USER_DATA) return join(process.env.SELFIMPULSE_USER_DATA, 'selfimpulse')
  // A pure Node probe is memory-only unless it explicitly chooses a directory.
  if (process.versions.electron) return join(process.cwd(), '.selfimpulse')
  return null
}

function storeFile(key: string, root: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(root, 'store', `${safe}.json`)
}

function keysOnDisk(root: string): string[] {
  try {
    return readdirSync(join(root, 'store'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -5))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Native Storage-shaped adapter. Read/write failures are never empty success. */
export const nodeStorage = {
  getItem(key: string): string | null {
    const root = storageRoot()
    if (!root) return volatile.get(key) ?? null
    try {
      return readFileSync(storeFile(key, root), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  },
  setItem(key: string, value: string): void {
    const root = storageRoot()
    if (!root) {
      volatile.set(key, value)
      return
    }
    atomicWriteFileSync(storeFile(key, root), value)
  },
  removeItem(key: string): void {
    volatile.delete(key)
    const root = storageRoot()
    if (root) rmSync(storeFile(key, root), { force: true })
  },
  get length(): number {
    const root = storageRoot()
    return root ? keysOnDisk(root).length : volatile.size
  },
  key(index: number): string | null {
    if (!Number.isInteger(index) || index < 0) return null
    const root = storageRoot()
    const keys = root ? keysOnDisk(root) : [...volatile.keys()]
    return keys[index] ?? null
  },
  clear(): void {
    volatile.clear()
    const root = storageRoot()
    if (!root) return
    for (const key of keysOnDisk(root)) rmSync(storeFile(key, root), { force: true })
  }
}
