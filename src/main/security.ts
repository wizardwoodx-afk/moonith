import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

export class PathAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathAccessError'
  }
}

export function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function realpathOrSelf(value: string): Promise<string> {
  try {
    return await fs.realpath(value)
  } catch {
    return resolve(value)
  }
}

async function realRoots(roots: string[]): Promise<string[]> {
  const out: string[] = []
  for (const root of roots) {
    if (!root) continue
    try {
      out.push(await fs.realpath(root))
    } catch {
      out.push(resolve(root))
    }
  }
  return out
}

/**
 * Resolve a user/model supplied path and guarantee it stays inside one of the
 * allowed roots. Lexical checks run first, then real paths (for existing files
 * and the nearest existing ancestor) to reject symlink escapes.
 */
export async function resolveSafePath(
  roots: string[],
  target: string,
  opts: { mode?: 'read' | 'write' } = {}
): Promise<string> {
  if (!target || target.includes('\0')) throw new PathAccessError('Invalid path.')
  const absolute = isAbsolute(target) ? resolve(target) : resolve(roots[0] ?? process.cwd(), target)

  if (!roots.some((root) => isWithin(root, absolute))) {
    throw new PathAccessError(`Path is outside the folders granted to this task: ${target}`)
  }

  const names = await realRoots(roots)
  let existing = absolute
  for (;;) {
    try {
      existing = await fs.realpath(existing)
      break
    } catch {
      const parent = resolve(existing, '..')
      if (parent === existing) break
      existing = parent
    }
  }

  if (!names.some((root) => isWithin(root, existing))) {
    throw new PathAccessError('Path resolves outside the folders granted to this task.')
  }

  if (opts.mode === 'read') {
    await fs.access(absolute)
  }

  return absolute
}

export function shortenPath(path: string, roots: string[]): string {
  for (const root of roots) {
    if (isWithin(root, path)) {
      const rel = relative(root, path)
      return rel ? rel : '.'
    }
  }
  return path
}

export function joinInside(root: string, ...parts: string[]): string {
  const target = join(root, ...parts)
  if (!isWithin(root, target)) throw new PathAccessError('Resolved path escaped its root.')
  return target
}
