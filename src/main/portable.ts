import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * A `portable.flag` beside the install folder keeps the profile inside the
 * distribution instead of `%APPDATA%`.
 */
export function portableDataDir(
  execPath: string,
  hasFlag: (path: string) => boolean = existsSync
): string | null {
  const root = join(dirname(execPath), '..')
  return hasFlag(join(root, 'portable.flag')) ? join(root, 'data') : null
}
