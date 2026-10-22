import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { copyLegacyUserData } from './userDataMigration'

let root = ''

beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'selfimpulse-migrate-'))
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('copyLegacyUserData', () => {
  it('copies the profile files and folders that exist', async () => {
    const legacy = join(root, 'copy', 'legacy')
    const next = join(root, 'copy', 'next')
    await fs.mkdir(join(legacy, 'tasks'), { recursive: true })
    await fs.mkdir(join(legacy, 'selfimpulse', 'workspace'), { recursive: true })
    await fs.writeFile(join(legacy, 'settings.json'), '{"theme":"moonlight"}', 'utf8')
    await fs.writeFile(join(legacy, 'tasks', 'task_1.json'), '{"id":"task_1"}', 'utf8')
    await fs.writeFile(join(legacy, 'selfimpulse', 'workspace', 'notes.md'), 'hello', 'utf8')

    const copied = copyLegacyUserData(legacy, next)

    expect(copied).toEqual(['settings.json', 'tasks', 'selfimpulse'])
    expect(await fs.readFile(join(next, 'settings.json'), 'utf8')).toBe('{"theme":"moonlight"}')
    expect(await fs.readFile(join(next, 'tasks', 'task_1.json'), 'utf8')).toBe('{"id":"task_1"}')
    expect(await fs.readFile(join(next, 'selfimpulse', 'workspace', 'notes.md'), 'utf8')).toBe(
      'hello'
    )
  })

  it('leaves an existing profile untouched', async () => {
    const legacy = join(root, 'existing', 'legacy')
    const next = join(root, 'existing', 'next')
    await fs.mkdir(legacy, { recursive: true })
    await fs.mkdir(next, { recursive: true })
    await fs.writeFile(join(legacy, 'settings.json'), '{"from":"legacy"}', 'utf8')
    await fs.writeFile(join(next, 'settings.json'), '{"from":"next"}', 'utf8')

    expect(copyLegacyUserData(legacy, next)).toEqual([])
    expect(await fs.readFile(join(next, 'settings.json'), 'utf8')).toBe('{"from":"next"}')
  })

  it('does nothing when the old folder is missing', async () => {
    const next = join(root, 'missing', 'next')
    expect(copyLegacyUserData(join(root, 'missing', 'legacy'), next)).toEqual([])
    await expect(fs.access(next)).rejects.toThrow()
  })

  it('keeps files the new profile already has', async () => {
    const legacy = join(root, 'merge', 'legacy')
    const next = join(root, 'merge', 'next')
    await fs.mkdir(join(legacy, 'tasks'), { recursive: true })
    await fs.mkdir(join(next, 'tasks'), { recursive: true })
    await fs.writeFile(join(legacy, 'tasks', 'a.json'), 'legacy-a', 'utf8')
    await fs.writeFile(join(legacy, 'tasks', 'b.json'), 'legacy-b', 'utf8')
    await fs.writeFile(join(next, 'tasks', 'a.json'), 'next-a', 'utf8')

    expect(copyLegacyUserData(legacy, next)).toEqual(['tasks'])
    expect(await fs.readFile(join(next, 'tasks', 'a.json'), 'utf8')).toBe('next-a')
    expect(await fs.readFile(join(next, 'tasks', 'b.json'), 'utf8')).toBe('legacy-b')
  })
})
