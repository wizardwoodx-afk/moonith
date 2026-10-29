/**
 * The undo trail through the real tools.
 *
 * The service tests prove the trail works in isolation; these prove the file
 * tools actually call it before they write. A guard that exists but is never
 * invoked is exactly the kind of fix that looks finished and does nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Task } from '@shared/types'
import type { ToolContext } from './types'

const sandbox = join(tmpdir(), `si-undo-${Math.random().toString(36).slice(2)}`)
mkdirSync(sandbox, { recursive: true })
const store = join(sandbox, 'store')
vi.mock('../../paths', () => ({ getPaths: () => ({ snapshots: store }) }))

import {
  deletePathTool,
  editFileTool,
  makeDirectoryTool,
  movePathTool,
  writeFileTool
} from './files'
import { list, revert } from '../../services/snapshots'
import { patchTools } from './patch'

const applyChanges = patchTools[0]

/** Each case gets its own workspace and starts with an empty trail. */
async function context(taskId: string): Promise<ToolContext> {
  const dir = join(sandbox, `work-${taskId}`)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.rm(join(store, taskId), { recursive: true, force: true })
  return {
    roots: [dir],
    readRoots: [dir],
    workspace: dir,
    task: { id: taskId } as Task,
    allowShell: false,
    addArtifact: async () => null,
    setBrowser: () => undefined,
    setPlan: () => undefined,
    toast: () => undefined
  } as unknown as ToolContext
}

const dirOf = (ctx: ToolContext): string => (ctx.roots as string[])[0]

describe('the file tools leave a trail', () => {
  it('write_file can be undone back to the bytes it found', async () => {
    const ctx = await context('w1')
    const file = join(dirOf(ctx), 'report.md')
    writeFileSync(file, 'handwritten draft\n', 'utf8')

    const outcome = await writeFileTool.execute({ path: 'report.md', content: 'agent draft\n' }, ctx)
    expect(outcome.isError).toBeFalsy()
    expect(readFileSync(file, 'utf8')).toBe('agent draft\n')

    const restored = await revert('w1')
    expect(restored.restored.map((path) => path.endsWith('report.md'))).toEqual([true])
    expect(readFileSync(file, 'utf8')).toBe('handwritten draft\n')
  })

  it('a large overwrite is still undoable', async () => {
    const ctx = await context('w2')
    const file = join(dirOf(ctx), 'large.txt')
    writeFileSync(file, Buffer.alloc(5_000_001, 65))

    const outcome = await writeFileTool.execute({ path: 'large.txt', content: 'small\n' }, ctx)
    expect(outcome.content).not.toContain('cannot be undone')

    const attempt = await revert('w2')
    expect(attempt.restored).toHaveLength(1)
    expect(readFileSync(file).length).toBe(5_000_001)
  })

  it('edit_file is undoable', async () => {
    const ctx = await context('e1')
    const dir = dirOf(ctx)
    writeFileSync(join(dir, 'app.ts'), 'const a = 1\nconst b = 2\n', 'utf8')

    await editFileTool.execute(
      { path: 'app.ts', old_text: 'const b = 2', new_text: 'const b = 3', replace_all: false },
      ctx
    )
    expect(readFileSync(join(dir, 'app.ts'), 'utf8')).toContain('= 3')

    await revert('e1')
    expect(readFileSync(join(dir, 'app.ts'), 'utf8')).toBe('const a = 1\nconst b = 2\n')
  })

  it('a folder the task created is removed, and the one it found is not', async () => {
    const ctx = await context('m1')
    const dir = dirOf(ctx)
    mkdirSync(join(dir, 'existing'))
    writeFileSync(join(dir, 'existing', 'keep.txt'), 'safe\n', 'utf8')

    await makeDirectoryTool.execute({ path: 'made-by-agent' }, ctx)
    await makeDirectoryTool.execute({ path: 'existing' }, ctx)
    expect(readFileSync(join(dir, 'existing', 'keep.txt'), 'utf8')).toBe('safe\n')

    const outcome = await revert('m1')
    expect(exists(join(dir, 'made-by-agent'))).toBe(false)
    expect(exists(join(dir, 'existing'))).toBe(true)
    expect(outcome.removed.some((path) => path.includes('made-by-agent'))).toBe(true)
    expect(hasContent(join(dir, 'existing', 'keep.txt'))).toBe(true)
  })

  it('a delete that cannot be undone is reported before it is final', async () => {
    const ctx = await context('d1')
    const dir = dirOf(ctx)
    mkdirSync(join(dir, 'tree'))
    writeFileSync(join(dir, 'tree', 'leaf.txt'), 'precious\n', 'utf8')

    const outcome = await deletePathTool.execute({ path: 'tree' }, ctx)
    expect(outcome.content).toContain('cannot be undone')
    expect(exists(join(dir, 'tree'))).toBe(false)

    const attempt = await revert('d1')
    expect(attempt.left.some((line) => line.reason.includes('contents'))).toBe(true)
  })

  it('a move puts the name back', async () => {
    const ctx = await context('mv1')
    const dir = dirOf(ctx)
    writeFileSync(join(dir, 'old.txt'), 'moved content\n', 'utf8')

    await movePathTool.execute({ from: 'old.txt', to: 'new.txt' }, ctx)
    expect(exists(join(dir, 'new.txt'))).toBe(true)

    await revert('mv1')
    expect(exists(join(dir, 'old.txt'))).toBe(true)
    expect(exists(join(dir, 'new.txt'))).toBe(false)
    expect(readFileSync(join(dir, 'old.txt'), 'utf8')).toBe('moved content\n')
  })
})

describe('the batch tool leaves a trail', () => {
  it('apply_changes can be undone across every file it touched', async () => {
    const ctx = await context('p1')
    const dir = dirOf(ctx)
    writeFileSync(join(dir, 'one.txt'), 'first original\n', 'utf8')
    writeFileSync(join(dir, 'two.txt'), 'second original\n', 'utf8')

    const outcome = await applyChanges.execute(
      {
        edits: [
          { path: 'one.txt', content: 'first rewritten\n' },
          { path: 'two.txt', old_text: 'second', new_text: 'SECOND' }
        ]
      },
      ctx
    )
    expect(outcome.isError).toBeFalsy()
    expect(readFileSync(join(dir, 'one.txt'), 'utf8')).toContain('rewritten')

    const restored = await revert('p1')
    expect(restored.restored).toHaveLength(2)
    expect(readFileSync(join(dir, 'one.txt'), 'utf8')).toBe('first original\n')
    expect(readFileSync(join(dir, 'two.txt'), 'utf8')).toBe('second original\n')
  })
})

const exists = existsSync

function hasContent(path: string): boolean {
  try {
    return readFileSync(path, 'utf8').length > 0
  } catch {
    return false
  }
}
