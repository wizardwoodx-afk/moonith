import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: {} }))

import { ToolRuntime } from './tools'

let base = ''
let workspace = ''
let outside = ''

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'selfimpulse-backend-tools-'))
  workspace = join(base, 'workspace')
  outside = join(base, 'outside')
  await mkdir(workspace, { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(outside, 'secret.txt'), 'outside-secret', 'utf8')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function runtime(): ToolRuntime {
  return new ToolRuntime({
    workspace,
    permissions: { read_file: 'allow', write_file: 'allow', list_dir: 'allow' }
  })
}

describe('backend tool filesystem boundary', () => {
  it('refuses to read through a symlink that leaves the workspace', async () => {
    await symlink(outside, join(workspace, 'linked'), 'dir')
    const result = await runtime().invoke('read_file', { path: 'linked/secret.txt' })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('outside-secret')
  })

  it('refuses to write through a symlink that leaves the workspace', async () => {
    await symlink(outside, join(workspace, 'linked'), 'dir')
    const result = await runtime().invoke('write_file', {
      path: 'linked/pwned.txt',
      content: 'must-not-escape'
    })
    expect(result.ok).toBe(false)
    await expect(readFile(join(outside, 'pwned.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('still permits ordinary workspace reads and writes', async () => {
    const writer = runtime()
    expect((await writer.invoke('write_file', { path: 'notes/today.txt', content: 'inside' })).ok).toBe(true)
    const result = await writer.invoke('read_file', { path: 'notes/today.txt' })
    expect(result).toMatchObject({ ok: true, content: 'inside' })
  })
})
