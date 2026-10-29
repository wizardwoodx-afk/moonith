import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY'])
const retryDelay = (attempt: number): number => Math.min(160, 10 * 2 ** attempt)

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Durably replace a file: write a unique temp in the same directory, fsync it,
 * then rename over the target. Evidence stores must not survive as a
 * half-written key or a half-written anchor, and rename is the only primitive
 * that makes "the old file or the new one, never a mixture" true.
 *
 * This is deliberately local to the audit module: `src/main/atomic.ts` is the
 * repo-wide helper landing in the same merge, and the audit ledger refuses to
 * take a dependency on a file that is not committed yet. Re-pointing this call
 * site at it is a one-line change once that lands.
 */
export async function writeAuditFileDurably(
  file: string,
  value: string,
  options: { mode?: number } = {}
): Promise<void> {
  const directory = dirname(file)
  await fs.mkdir(directory, { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(temporary, 'wx', options.mode ?? 0o600)
    await handle.writeFile(value, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    let lastError: unknown
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await fs.rename(temporary, file)
        return
      } catch (error) {
        lastError = error
        const code = (error as NodeJS.ErrnoException).code
        if (!code || !RETRYABLE.has(code) || attempt === 7) break
        await pause(retryDelay(attempt))
      }
    }
    throw lastError
  } finally {
    if (handle) await handle.close().catch(() => undefined)
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}
