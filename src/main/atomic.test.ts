import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWriteJson } from './util'

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'selfimpulse-atomic-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('atomic JSON persistence', () => {
  it('serializes unique temporary files into one valid final document under concurrency', async () => {
    const file = join(directory, 'state.json')
    await Promise.all(
      Array.from({ length: 40 }, (_, value) => atomicWriteJson(file, { value, text: `record-${value}` }))
    )
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { value: number; text: string }
    expect(parsed.value).toBeGreaterThanOrEqual(0)
    expect(parsed.value).toBeLessThan(40)
    expect(parsed.text).toBe(`record-${parsed.value}`)
    expect((await readdir(directory)).filter((name) => name.includes('.tmp'))).toEqual([])
  })
})
