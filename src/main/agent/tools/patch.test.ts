/**
 * The batch edit tool.
 *
 * The behaviour that matters is that a batch is one decision: either every edit
 * lands or no file moves at all. These tests therefore read the disk back after
 * every case instead of trusting the returned text.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApprovalReview } from '@shared/types'
import type { ToolContext } from './types'
import { patchTools } from './patch'

const applyChanges = patchTools[0]

function contextIn(dir: string, written: string[] = []): ToolContext {
  return {
    roots: [dir],
    readRoots: [dir],
    workspace: dir,
    task: {} as never,
    allowShell: false,
    addArtifact: async (absPath: string) => {
      written.push(absPath)
      return null
    },
    setBrowser: () => undefined,
    setPlan: () => undefined,
    toast: () => undefined
  } as unknown as ToolContext
}

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'si-patch-'))

function run(args: unknown, dir: string, written: string[] = []): Promise<{ content: string; isError?: boolean }> {
  return applyChanges.execute(args, contextIn(dir, written))
}

function asDiff(review: ApprovalReview | undefined): Extract<ApprovalReview, { kind: 'diff' }> {
  expect(review?.kind).toBe('diff')
  return review as Extract<ApprovalReview, { kind: 'diff' }>
}

const one = (path: string, content: string): { path: string; content: string } => ({ path, content })

describe('apply_changes success', () => {
  it('applies a three-edit batch across two files and reports each file', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.ts'), 'one\ntwo\nthree\n', 'utf8')
    writeFileSync(join(dir, 'b.ts'), 'alpha\nbeta\n', 'utf8')
    const written: string[] = []

    const result = await run(
      {
        edits: [
          { path: 'a.ts', old_text: 'two', new_text: 'TWO\nextra' },
          { path: 'a.ts', old_text: 'three', new_text: '3' },
          { path: 'b.ts', old_text: 'beta', new_text: 'BETA' }
        ]
      },
      dir,
      written
    )

    expect(result.isError).toBeUndefined()
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('one\nTWO\nextra\n3\n')
    expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toBe('alpha\nBETA\n')
    expect(result.content).toContain('Applied 3 edits across 2 files.')
    expect(result.content).toContain('a.ts  +3 −2')
    expect(result.content).toContain('b.ts  +1 −1')
    expect(result.content).toContain('Total  +4 −3')
    expect(written).toEqual([join(dir, 'a.ts'), join(dir, 'b.ts')])
  })

  it('mixes a whole-file write with targeted edits', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'old.txt'), 'x\ny\n', 'utf8')

    const result = await run(
      { edits: [one('fresh.txt', 'brand new\n'), { path: 'old.txt', old_text: 'y', new_text: 'z' }] },
      dir
    )

    expect(result.isError).toBeUndefined()
    expect(readFileSync(join(dir, 'fresh.txt'), 'utf8')).toBe('brand new\n')
    expect(readFileSync(join(dir, 'old.txt'), 'utf8')).toBe('x\nz\n')
    expect(result.content).toContain('Total  +2 −1')
  })

  it('creates the folders a batched write needs', async () => {
    const dir = tempDir()
    const result = await run({ edits: [one(join('deep', 'deeper', 'n.txt'), 'made\n')] }, dir)
    expect(result.isError).toBeUndefined()
    expect(readFileSync(join(dir, 'deep', 'deeper', 'n.txt'), 'utf8')).toBe('made\n')
  })

  it('composes two edits on one path in batch order', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'seq.txt'), 'a\nb\nc\n', 'utf8')

    const result = await run(
      {
        edits: [
          { path: 'seq.txt', old_text: 'a', new_text: 'x' },
          { path: 'seq.txt', old_text: 'b', new_text: 'y' },
          { path: 'seq.txt', old_text: 'x', new_text: 'z' }
        ]
      },
      dir
    )

    expect(result.isError).toBeUndefined()
    expect(readFileSync(join(dir, 'seq.txt'), 'utf8')).toBe('z\ny\nc\n')
    expect(result.content).toContain('Applied 3 edits across 1 file.')
  })

  it('keeps $ sequences in new_text literal', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'dollar.txt'), 'foo\n', 'utf8')

    await run({ edits: [{ path: 'dollar.txt', old_text: 'foo', new_text: "$& and $'" }] }, dir)

    expect(readFileSync(join(dir, 'dollar.txt'), 'utf8')).toBe("$& and $'\n")
  })

  it('replaces every occurrence when replace_all is set', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'red.txt'), 'red\nred\nred\n', 'utf8')

    const result = await run({ edits: [{ path: 'red.txt', old_text: 'red', new_text: 'blue', replace_all: true }] }, dir)

    expect(result.isError).toBeUndefined()
    expect(readFileSync(join(dir, 'red.txt'), 'utf8')).toBe('blue\nblue\nblue\n')
    expect(result.content).toContain('red.txt  +3 −3')
  })
})

describe('apply_changes all-or-nothing', () => {
  it('writes nothing to any file when one edit of five fails', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.txt'), 'aaa\n', 'utf8')
    writeFileSync(join(dir, 'b.txt'), 'bbb\n', 'utf8')
    writeFileSync(join(dir, 'c.txt'), 'ccc\n', 'utf8')
    const written: string[] = []

    const result = await run(
      {
        edits: [
          { path: 'a.txt', old_text: 'aaa', new_text: 'AAA' },
          one('b.txt', 'B\nB\n'),
          { path: 'c.txt', old_text: 'missing', new_text: 'X' },
          one('d.txt', 'D\n'),
          { path: 'b.txt', old_text: 'B', new_text: 'b', replace_all: true }
        ]
      },
      dir,
      written
    )

    expect(result.isError).toBe(true)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('aaa\n')
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('bbb\n')
    expect(readFileSync(join(dir, 'c.txt'), 'utf8')).toBe('ccc\n')
    expect(existsSync(join(dir, 'd.txt'))).toBe(false)
    expect(written).toEqual([])
    expect(result.content).toContain('Batch rejected: 1 of 5 edits failed. Nothing on disk was changed.')
    expect(result.content).toContain('edit[2] c.txt: Old text was not found in the file.')
    expect(result.content).toContain('Valid but not applied:')
    for (const index of [0, 1, 3, 4]) expect(result.content).toContain(`edit[${index}]`)
  })

  it('aborts the whole batch on a path outside the granted folders', async () => {
    const dir = tempDir()
    const result = await run({ edits: [one('good.txt', 'G\n'), one('../escape.txt', 'E\n')] }, dir)

    expect(result.isError).toBe(true)
    expect(existsSync(join(dir, 'good.txt'))).toBe(false)
    expect(readdirSync(dir)).toEqual([])
    expect(result.content).toContain('outside the folders granted to this task')
  })

  it('rejects an edit that is neither a replacement nor a whole-file write by index', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'e.txt'), 'here\n', 'utf8')

    const result = await run({ edits: [{ path: 'e.txt', old_text: 'here' }, { path: 'e.txt', content: 'x\n' }] }, dir)

    expect(result.isError).toBe(true)
    expect(result.content).toContain('edit[0] e.txt: new_text is missing for this replacement.')
    expect(readFileSync(join(dir, 'e.txt'), 'utf8')).toBe('here\n')
  })

  it('names the file and index when old_text is ambiguous', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'amb.txt'), 'x\nx\ny\n', 'utf8')
    writeFileSync(join(dir, 'ok.txt'), 'keep\n', 'utf8')

    const result = await run(
      { edits: [one('ok.txt', 'kept\n'), { path: 'amb.txt', old_text: 'x', new_text: 'z' }] },
      dir
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('edit[1] amb.txt')
    expect(result.content).toContain('Old text appears 2 times in the file.')
    expect(readFileSync(join(dir, 'amb.txt'), 'utf8')).toBe('x\nx\ny\n')
    expect(readFileSync(join(dir, 'ok.txt'), 'utf8')).toBe('keep\n')
  })

  it('fails a second edit whose text an earlier edit already consumed', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'twice.txt'), 'a\nb\n', 'utf8')

    const result = await run(
      {
        edits: [
          { path: 'twice.txt', old_text: 'a', new_text: 'x' },
          { path: 'twice.txt', old_text: 'a', new_text: 'q' }
        ]
      },
      dir
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Old text was not found in the file as changed by earlier edits in this batch.')
    expect(readFileSync(join(dir, 'twice.txt'), 'utf8')).toBe('a\nb\n')
  })

  it('refuses a non-text target instead of corrupting it', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([1, 2, 0, 3]))

    const result = await run({ edits: [{ path: 'blob.bin', old_text: '1', new_text: '9' }] }, dir)

    expect(result.isError).toBe(true)
    expect(result.content).toContain('not text')
    expect(readFileSync(join(dir, 'blob.bin'))).toEqual(Buffer.from([1, 2, 0, 3]))
  })

  it('restores the files it already wrote when the write phase fails', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'blocked'), 'a file where a folder is needed\n', 'utf8')
    writeFileSync(join(dir, 'first.txt'), 'original\n', 'utf8')

    const result = await run({ edits: [one('first.txt', 'rewritten\n'), one(join('blocked', 'second.txt'), 'B\n')] }, dir)

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Batch aborted while writing')
    expect(readFileSync(join(dir, 'first.txt'), 'utf8')).toBe('original\n')
    expect(existsSync(join(dir, 'blocked', 'second.txt'))).toBe(false)
  })
})

describe('apply_changes dry run and limits', () => {
  it('reports counts without touching the disk', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'p.txt'), '1\n2\n', 'utf8')

    const result = await run(
      {
        dry_run: true,
        edits: [
          { path: 'p.txt', old_text: '2', new_text: 'two\nthree' },
          one('q.txt', 'never written\n')
        ]
      },
      dir
    )

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Dry run: 2 edits across 2 files would apply cleanly. Nothing was written.')
    expect(result.content).toContain('Total  +3 −1')
    expect(readFileSync(join(dir, 'p.txt'), 'utf8')).toBe('1\n2\n')
    expect(existsSync(join(dir, 'q.txt'))).toBe(false)
  })

  it('gives the same verdict for a broken batch as a real run', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'r.txt'), 'real\n', 'utf8')

    const dry = await run({ dry_run: true, edits: [{ path: 'r.txt', old_text: 'gone', new_text: 'x' }] }, dir)
    const wet = await run({ edits: [{ path: 'r.txt', old_text: 'gone', new_text: 'x' }] }, dir)

    expect(dry.content).toBe(wet.content)
    expect(dry.isError).toBe(true)
    expect(readFileSync(join(dir, 'r.txt'), 'utf8')).toBe('real\n')
  })

  it('caps a batch at 25 edits', () => {
    const schema = applyChanges.schema
    expect(schema?.safeParse({ edits: Array.from({ length: 25 }, (_, i) => one(`f${i}.txt`, 'x\n')) }).success).toBe(true)
    const tooMany = Array.from({ length: 26 }, (_, i) => one(`f${i}.txt`, 'x\n'))
    expect(schema?.safeParse({ edits: tooMany }).success).toBe(false)
    expect(schema?.safeParse({ edits: [] }).success).toBe(false)
  })

  it('refuses an over-cap call without writing anything', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'keep'), { recursive: true })
    const tooMany = Array.from({ length: 26 }, (_, i) => one(`f${i}.txt`, 'x\n'))

    const result = await run({ edits: tooMany }, dir)

    expect(result.isError).toBe(true)
    expect(result.content).toContain('at most 25 edits per call and got 26')
    expect(readdirSync(dir)).toEqual(['keep'])
  })
})

describe('apply_changes approval review', () => {
  it('shows the diff of every file in the batch', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.ts'), 'one\ntwo\nthree\n', 'utf8')
    writeFileSync(join(dir, 'b.ts'), 'alpha\nbeta\n', 'utf8')

    const review = asDiff(
      await applyChanges.approvalReview?.(
        {
          edits: [
            { path: 'a.ts', old_text: 'two', new_text: 'TWO\nextra' },
            { path: 'a.ts', old_text: 'three', new_text: '3' },
            { path: 'b.ts', old_text: 'beta', new_text: 'BETA' }
          ]
        },
        contextIn(dir)
      )
    )

    expect(review.path).toBe('2 files')
    expect(review.added).toBe(4)
    expect(review.removed).toBe(3)
    expect(review.truncated).toBe(false)
    expect(review.note).toContain('every file it changes')
    const headers = review.lines.filter((line) => line.text.startsWith('──')).map((line) => line.text)
    expect(headers).toEqual(['── a.ts ──', '── b.ts ──'])
    expect(review.lines.filter((line) => line.sign === '-').map((line) => line.text)).toEqual([
      'two',
      'three',
      'beta'
    ])
    expect(review.lines.filter((line) => line.sign === '+').map((line) => line.text)).toEqual([
      'TWO',
      'extra',
      '3',
      'BETA'
    ])
  })

  it('warns in the review when the batch cannot be applied', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'w.txt'), 'one\ntwo\n', 'utf8')

    const review = asDiff(
      await applyChanges.approvalReview?.(
        { edits: [{ path: 'w.txt', old_text: 'gone', new_text: 'x' }] },
        contextIn(dir)
      )
    )

    expect(review.note).toContain('1 of 1 edit would fail, so nothing is written.')
    expect(review.added).toBe(0)
    expect(review.removed).toBe(0)
    expect(review.path).toBe('0 files')
  })
})
