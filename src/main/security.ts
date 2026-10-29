import { promises as fs, existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export class PathAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathAccessError'
  }
}

function normPath(p: string): string {
  const r = resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

export function isWithin(parent: string, child: string): boolean {
  const normP = normPath(parent)
  const normC = normPath(child)
  const rel = relative(normP, normC)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function extractMentionedFolders(text: string): string[] {
  if (!text) return []
  const found = new Set<string>()
  const winPattern = /[A-Za-z]:[\\/][^\s<>"'`*?|:]+/g
  const unixPattern = /(?:^|\s)(\/(?:Users|home|root|var|etc|opt|tmp|projects?|dev|workspace)[^\s<>"'`*?|:]+)/g

  let match: RegExpExecArray | null
  while ((match = winPattern.exec(text)) !== null) {
    const raw = match[0].replace(/[.,;:!?)\]}>"']+$/, '')
    try {
      if (existsSync(raw)) {
        const stat = statSync(raw)
        found.add(stat.isDirectory() ? resolve(raw) : resolve(dirname(raw)))
      }
    } catch {
      // skip
    }
  }

  while ((match = unixPattern.exec(text)) !== null) {
    const raw = match[1].trim().replace(/[.,;:!?)\]}>"']+$/, '')
    try {
      if (existsSync(raw)) {
        const stat = statSync(raw)
        found.add(stat.isDirectory() ? resolve(raw) : resolve(dirname(raw)))
      }
    } catch {
      // skip
    }
  }

  return [...found]
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
  
  let absolute: string
  if (isAbsolute(target)) {
    absolute = resolve(target)
  } else {
    let found = false
    let candidate = resolve(roots[0] ?? process.cwd(), target)
    for (const r of roots) {
      if (!r) continue
      const attempt = resolve(r, target)
      try {
        await fs.access(attempt)
        candidate = attempt
        found = true
        break
      } catch {
        // continue
      }
    }
    if (!found) {
      candidate = resolve(roots[1] ?? roots[0] ?? process.cwd(), target)
    }
    absolute = candidate
  }

  const inRoots = roots.some((root) => isWithin(root, absolute))
  if (!inRoots) {
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
