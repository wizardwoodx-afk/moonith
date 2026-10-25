import { randomUUID } from 'node:crypto'
import { promises as fs, closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY'])
const retryDelay = (attempt: number): number => Math.min(160, 10 * 2 ** attempt)

function temporaryPath(file: string): string {
  return `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
}

/** Rename-over-target can briefly fail on Windows while another writer/AV has it open. */
export async function atomicWriteFile(
  file: string,
  value: string | Uint8Array,
  options: { mode?: number } = {}
): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = temporaryPath(file)
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(tmp, 'wx', options.mode ?? 0o600)
    await handle.writeFile(value)
    await handle.sync()
    await handle.close()
    handle = undefined
    let lastError: unknown
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await fs.rename(tmp, file)
        return
      } catch (error) {
        lastError = error
        const code = (error as NodeJS.ErrnoException).code
        if (!code || !RETRYABLE.has(code) || attempt === 7) break
        await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)))
      }
    }
    throw lastError
  } finally {
    if (handle) await handle.close().catch(() => undefined)
    await fs.rm(tmp, { force: true }).catch(() => undefined)
  }
}

function synchronousPause(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, milliseconds)
}

/** Synchronous counterpart for the native key/value adapter and secret stores. */
export function atomicWriteFileSync(
  file: string,
  value: string | Uint8Array,
  options: { mode?: number } = {}
): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = temporaryPath(file)
  try {
    const descriptor = openSync(tmp, 'wx', options.mode ?? 0o600)
    try {
      writeFileSync(descriptor, value)
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    let lastError: unknown
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        renameSync(tmp, file)
        return
      } catch (error) {
        lastError = error
        const code = (error as NodeJS.ErrnoException).code
        if (!code || !RETRYABLE.has(code) || attempt === 7) break
        synchronousPause(retryDelay(attempt))
      }
    }
    throw lastError
  } finally {
    rmSync(tmp, { force: true })
  }
}
