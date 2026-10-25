import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Marketplace, assertInstalledSkillId, assertMarketplaceReference } from './marketplace'
import type { BackendStore } from './store'

let base = ''
let workspace = ''
let outside = ''

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'selfimpulse-marketplace-'))
  workspace = join(base, 'workspace')
  outside = join(base, 'outside')
  await mkdir(join(workspace, '.agents', 'skills'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(outside, 'keep.txt'), 'keep', 'utf8')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function service(): Marketplace {
  const records: Record<string, Record<string, unknown>> = {}
  const store = {
    settings: {
      all: () => records,
      set: (key: string, value: Record<string, unknown>) => {
        records[key] = value
      }
    }
  } as unknown as BackendStore
  const values = new Map<string, string>()
  return new Marketplace(store, workspace, {
    get: (key) => values.get(key) ?? '',
    put: (key, value) => {
      values.set(key, value)
      return true
    }
  })
}

describe('marketplace path and reference enforcement', () => {
  it('rejects traversal and option-shaped references before invoking a CLI', () => {
    expect(() => assertMarketplaceReference('../outside')).toThrow('Invalid marketplace')
    expect(() => assertMarketplaceReference('--dir')).toThrow('Invalid marketplace')
    expect(() => assertMarketplaceReference('skill\\..\\outside')).toThrow('Invalid marketplace')
    expect(assertMarketplaceReference('@scope/design-system')).toBe('@scope/design-system')
  })

  it('does not use a string-prefix check for deletion', async () => {
    await expect(service().remove({ id: '../outside' })).rejects.toThrow('Invalid installed skill id')
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('refuses a symlinked installed bundle that points outside the skill root', async () => {
    await symlink(outside, join(workspace, '.agents', 'skills', 'linked'), 'dir')
    await expect(service().remove({ id: 'linked' })).rejects.toThrow('outside')
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('allows a normal installed bundle to be removed', async () => {
    const target = join(workspace, '.agents', 'skills', 'local-skill')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'SKILL.md'), '# Local', 'utf8')
    await expect(service().remove({ id: 'local-skill' })).resolves.toEqual({ ok: true })
    expect(assertInstalledSkillId('local-skill')).toBe('local-skill')
  })
})
