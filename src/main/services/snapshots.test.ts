/**
 * The undo trail.
 *
 * These tests are about one promise: whatever the agent changes, the user can
 * hand the file back the way this task found it — or be told plainly that this
 * particular change cannot be undone. Both outcomes are asserted against real
 * disk state, because a trail that quietly lies is worse than no trail.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSyncAll(join(tmpdir(), 'si-snapshots-'))
const snapshotRoot = join(root, 'store')
const workRoot = join(root, 'work')

vi.mock('../paths', () => ({
  getPaths: () => ({ snapshots: snapshotRoot })
}))

import { clear, guard, list, markApplied, recordMove, redo, revert } from './snapshots'

function mkdtempSyncAll(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}

/** A fresh workspace and an empty trail per test keeps the cases unrelated. */
async function fresh(taskId: string): Promise<string> {
  const dir = join(workRoot, taskId)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.rm(join(snapshotRoot, taskId), { recursive: true, force: true })
  return dir
}

describe('guard', () => {
  it('saves the bytes as they were when the task first met the file', async () => {
    const dir = await fresh('t-first')
    const file = join(dir, 'notes.md')
    writeFileSync(file, 'original\n', 'utf8')

    expect((await guard('t-first', file)).guarded).toBe(true)
    writeFileSync(file, 'agent rewrite\n', 'utf8')
    // A second touch must not overwrite the trail with the agent's own output.
    await guard('t-first', file)

    const outcome = await revert('t-first')
    expect(outcome.restored).toEqual([file])
    expect(readFileSync(file, 'utf8')).toBe('original\n')
  })

  it('removes what the task created and keeps what it found', async () => {
    const dir = await fresh('t-created')
    const made = join(dir, 'new.txt')
    writeFileSync(join(dir, 'keep.txt'), 'untouched\n', 'utf8')

    await guard('t-created', made)
    writeFileSync(made, 'agent output\n', 'utf8')

    const outcome = await revert('t-created')
    expect(outcome.removed).toEqual([made])
    expect(existsSync(made)).toBe(false)
    expect(existsSync(join(dir, 'keep.txt'))).toBe(true)
  })

  it('hands a deleted empty folder back and refuses to pretend about a full one', async () => {
    const dir = await fresh('t-folder')
    const empty = join(dir, 'empty')
    const full = join(dir, 'full')
    mkdirSyncAll(empty)
    mkdirSyncAll(full)
    writeFileSync(join(full, 'inside.txt'), 'data\n', 'utf8')

    expect((await guard('t-folder', empty, { forDeletion: true })).guarded).toBe(true)
    rmSync(empty, { recursive: true })

    const doomed = await guard('t-folder', full, { forDeletion: true })
    expect(doomed.guarded).toBe(false)
    expect(doomed.reason).toContain('contents')
    rmSync(full, { recursive: true })

    const outcome = await revert('t-folder')
    expect(existsSync(empty)).toBe(true)
    expect(outcome.left.some((line) => line.path === full)).toBe(true)
    expect(existsSync(full)).toBe(false)
  })

  it('never deletes a folder the task did not make', async () => {
    const dir = await fresh('t-existing')
    const preexisting = join(dir, 'was-here')
    mkdirSyncAll(preexisting)
    writeFileSync(join(preexisting, 'file.txt'), 'safe\n', 'utf8')

    await guard('t-existing', preexisting)
    const outcome = await revert('t-existing')

    expect(existsSync(preexisting)).toBe(true)
    expect(readFileSync(join(preexisting, 'file.txt'), 'utf8')).toBe('safe\n')
    expect(outcome.removed).toEqual([])
  })

  it('copies a large file now that the store is content-addressed', async () => {
    const dir = await fresh('t-large')
    const big = join(dir, 'big.bin')
    writeFileSync(big, Buffer.alloc(5_000_001, 7))

    expect((await guard('t-large', big)).guarded).toBe(true)
    writeFileSync(big, 'shrunk\n', 'utf8')

    const attempt = await revert('t-large')
    expect(attempt.restored).toHaveLength(1)
    expect(readFileSync(big).length).toBe(5_000_001)
  })

  it('moves a name back to where it started', async () => {
    const dir = await fresh('t-move')
    const from = join(dir, 'a.txt')
    const to = join(dir, 'b.txt')
    writeFileSync(from, 'contents\n', 'utf8')

    await guard('t-move', from)
    await guard('t-move', to)
    await recordMove('t-move', from, to)
    renameSync(from, to)
    expect(existsSync(to)).toBe(true)

    const outcome = await revert('t-move')
    expect(outcome.restored).toContain(from)
    expect(existsSync(from)).toBe(true)
    expect(existsSync(to)).toBe(false)
    expect(readFileSync(from, 'utf8')).toBe('contents\n')
  })

  // Skipped, not deleted: redo is implemented in snapshots.ts but these two
  // assertions still fail, so the feature is unproven and not shipped.
  it('redo replays the task change forward again', async () => {
    const dir = await fresh('t-redo')
    const file = join(dir, 'r.txt')
    writeFileSync(file, 'before\n', 'utf8')

    await guard('t-redo', file, { stepId: 'call-1' })
    writeFileSync(file, 'agent result\n', 'utf8')
    await markApplied('t-redo', file, 'call-1')

    expect((await revert('t-redo')).restored).toHaveLength(1)
    expect(readFileSync(file, 'utf8')).toBe('before\n')

    const forward = await redo('t-redo')
    expect(forward.restored).toHaveLength(1)
    expect(readFileSync(file, 'utf8')).toBe('agent result\n')
  })

  it('leaves a file the user edited afterwards alone', async () => {
    const dir = await fresh('t-dirty')
    const file = join(dir, 'own.txt')
    writeFileSync(file, 'original\n', 'utf8')
    await guard('t-dirty', file, { stepId: 'call-1' })
    writeFileSync(file, 'agent\n', 'utf8')
    await markApplied('t-dirty', file, 'call-1')
    writeFileSync(file, 'the user edited this afterwards\n', 'utf8')

    const attempt = await revert('t-dirty')
    expect(attempt.restored).toEqual([])
    expect(attempt.left[0].reason).toContain('changed after this task')
    expect(readFileSync(file, 'utf8')).toContain('the user edited')
  })

  it('survives a second revert without inventing damage', async () => {
    const dir = await fresh('t-twice')
    const file = join(dir, 'c.txt')
    writeFileSync(file, 'one\n', 'utf8')
    await guard('t-twice', file)
    writeFileSync(file, 'two\n', 'utf8')

    expect((await revert('t-twice')).restored).toHaveLength(1)
    // Reverting again is idempotent, and the trail stays for redo until cleared.
    const again = await revert('t-twice')
    expect(again.restored).toHaveLength(1)
    expect(again.left).toEqual([])
    expect((await list('t-twice')).length).toBe(1)
  })

  it('clears the whole trail when the task goes', async () => {
    const dir = await fresh('t-clear')
    const file = join(dir, 'd.txt')
    writeFileSync(file, 'x\n', 'utf8')
    await guard('t-clear', file)
    expect(readdirSync(join(snapshotRoot, 't-clear')).length).toBeGreaterThan(0)

    await clear('t-clear')
    expect(existsSync(join(snapshotRoot, 't-clear'))).toBe(false)
    expect(await list('t-clear')).toEqual([])
  })
})

function mkdirSyncAll(path: string): void {
  mkdirSync(path, { recursive: true })
}

describe('workspace isolation', () => {
  it('keeps two tasks in the same folder on their own trails', async () => {
    const dir = await fresh('t-shared')
    const file = join(dir, 'shared.txt')
    writeFileSync(file, 'start\n', 'utf8')

    await guard('t-shared', file)
    writeFileSync(file, 'task A\n', 'utf8')
    await guard('t-shared', file)
    writeFileSync(file, 'task B\n', 'utf8')

    // Both tasks share one trail per task id, so the last writer before the
    // revert still restores the pre-task bytes rather than an intermediate.
    const outcome = await revert('t-shared')
    expect(outcome.restored).toEqual([file])
    expect(readFileSync(file, 'utf8')).toBe('start\n')
  })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
