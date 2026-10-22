import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PathAccessError, isWithin, joinInside, resolveSafePath, shortenPath } from './security'

describe('isWithin', () => {
  it('accepts the root itself and descendants', () => {
    expect(isWithin('/work', '/work')).toBe(true)
    expect(isWithin('/work', '/work/report.docx')).toBe(true)
  })

  it('rejects siblings and prefix collisions', () => {
    expect(isWithin('/work', '/work-other/report.docx')).toBe(false)
    expect(isWithin('/work', '/work/../escape.txt')).toBe(false)
    expect(isWithin('/work', '/etc/passwd')).toBe(false)
  })
})

describe('joinInside', () => {
  it('joins safe segments', () => {
    expect(joinInside('/work', 'reports', 'q1.docx')).toBe(join('/work', 'reports', 'q1.docx'))
  })

  it('rejects traversal segments', () => {
    expect(() => joinInside('/work', '..', 'escape.txt')).toThrow(PathAccessError)
  })
})

describe('shortenPath', () => {
  it('returns a relative path inside a root', () => {
    expect(shortenPath('/work/reports/q1.docx', ['/work'])).toBe(
      join('reports', 'q1.docx')
    )
    expect(shortenPath('/work', ['/work'])).toBe('.')
  })

  it('leaves outside paths untouched', () => {
    expect(shortenPath('/elsewhere/file.txt', ['/work'])).toBe('/elsewhere/file.txt')
  })
})

let base = ''
let root = ''
let outside = ''

beforeAll(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'knight-security-'))
  root = join(base, 'root')
  outside = join(base, 'outside')
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(outside, { recursive: true })
  await fs.writeFile(join(root, 'inside.txt'), 'inside')
  await fs.writeFile(join(outside, 'secret.txt'), 'secret')
})

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('resolveSafePath', () => {
  it('resolves relative paths against the first root', async () => {
    const resolved = await resolveSafePath([root], 'inside.txt', { mode: 'read' })
    expect(resolved).toBe(join(root, 'inside.txt'))
  })

  it('resolves nested new files for writing', async () => {
    const resolved = await resolveSafePath([root], 'notes/today.md')
    expect(resolved).toBe(join(root, 'notes', 'today.md'))
  })

  it('accepts absolute paths inside the root', async () => {
    const resolved = await resolveSafePath([root], join(root, 'inside.txt'), { mode: 'read' })
    expect(resolved).toBe(join(root, 'inside.txt'))
  })

  it('rejects paths outside every root', async () => {
    await expect(
      resolveSafePath([root], join(outside, 'secret.txt'), { mode: 'read' })
    ).rejects.toThrow(PathAccessError)
  })

  it('rejects traversal that leaves the root', async () => {
    await expect(resolveSafePath([root], '../outside/secret.txt')).rejects.toThrow(
      PathAccessError
    )
  })

  it('rejects empty names and null bytes', async () => {
    await expect(resolveSafePath([root], '')).rejects.toThrow(PathAccessError)
    await expect(resolveSafePath([root], 'inside\0.txt')).rejects.toThrow(PathAccessError)
  })

  it('rejects missing files in read mode', async () => {
    await expect(
      resolveSafePath([root], 'missing.txt', { mode: 'read' })
    ).rejects.toThrow()
  })

  it('rejects symlink and junction escapes', async () => {
    const link = join(root, 'escape-link')
    try {
      await fs.symlink(outside, link, 'junction')
    } catch {
      return
    }
    await expect(
      resolveSafePath([root], join(link, 'secret.txt'), { mode: 'read' })
    ).rejects.toThrow(PathAccessError)
  })
})
