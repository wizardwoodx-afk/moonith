import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { atomicWriteJson, newId, readJson, readJsonLimited, readResponseText, safeJsonParse, slugify, truncate } from './util'

let dir = ''

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'knight-util-'))
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('readJson', () => {
  it('returns a fallback for a missing file', async () => {
    expect(await readJson(join(dir, 'missing.json'), { fallback: true })).toEqual({
      fallback: true
    })
  })

  it('returns a fallback for malformed JSON', async () => {
    const file = join(dir, 'broken.json')
    await fs.writeFile(file, '{not json', 'utf8')
    expect(await readJson(file, [])).toEqual([])
  })

  it('parses valid JSON', async () => {
    const file = join(dir, 'valid.json')
    await fs.writeFile(file, JSON.stringify({ hello: 'world' }), 'utf8')
    expect(await readJson(file, null)).toEqual({ hello: 'world' })
  })
})

describe('atomicWriteJson', () => {
  it('creates parent folders and writes formatted JSON', async () => {
    const file = join(dir, 'nested', 'settings.json')
    await atomicWriteJson(file, { theme: 'dark', count: 2 })
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ theme: 'dark', count: 2 })
    const entries = await fs.readdir(join(dir, 'nested'))
    expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('replaces existing content', async () => {
    const file = join(dir, 'replace.json')
    await atomicWriteJson(file, { version: 1 })
    await atomicWriteJson(file, { version: 2 })
    expect(await readJson(file, null)).toEqual({ version: 2 })
  })

  it('uses distinct temporary files for concurrent writers', async () => {
    const file = join(dir, 'concurrent.json')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(123456789)
    try {
      await Promise.all(
        Array.from({ length: 16 }, (_, writer) => atomicWriteJson(file, { writer }))
      )
    } finally {
      clock.mockRestore()
    }
    const saved = await readJson<{ writer: number } | null>(file, null)
    expect(saved?.writer).toBeGreaterThanOrEqual(0)
    expect(saved?.writer).toBeLessThan(16)
    const entries = await fs.readdir(dir)
    expect(entries.filter((name) => name.startsWith('concurrent.json.') && name.endsWith('.tmp'))).toEqual([])
  })
})

describe('bounded responses', () => {
  it('parses JSON within the byte budget', async () => {
    await expect(readJsonLimited(new Response('{"ok":true}'), 64)).resolves.toEqual({ ok: true })
  })

  it('rejects oversized streamed bodies before parsing them', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(32)))
        controller.close()
      }
    })
    await expect(readResponseText(new Response(stream), 8)).rejects.toThrow('8-byte limit')
    await expect(readJsonLimited(new Response('not json'), 64)).rejects.toThrow('valid JSON')
  })
})

describe('helpers', () => {
  it('builds unique prefixed ids', () => {
    expect(newId('task')).toMatch(/^task_/)
    expect(newId('task')).not.toBe(newId('task'))
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('truncates long text with a marker', () => {
    expect(truncate('hello', 10)).toBe('hello')
    const value = truncate('a'.repeat(20), 10)
    expect(value.startsWith('a'.repeat(10))).toBe(true)
    expect(value).toContain('[truncated 10 chars]')
  })

  it('parses JSON safely', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
    expect(safeJsonParse('nope')).toBeUndefined()
  })

  it('slugifies titles', () => {
    expect(slugify('  Q3 Market Brief! ')).toBe('q3-market-brief')
    expect(slugify('!!!', 'task')).toBe('task')
  })
})
