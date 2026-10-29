/**
 * The approval review for file writes.
 *
 * Permission prompts used to show the tool's JSON arguments, which meant the
 * user was asked to approve an overwrite they could not read. These tests hold
 * the review to what the modal renders: the real diff, honest counts, and no
 * invented review for a path the sandbox would refuse anyway.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApprovalReview } from '@shared/types'
import type { ToolContext } from './types'
import { editFileTool, writeFileTool } from './files'

function contextIn(dir: string): ToolContext {
  return {
    roots: [dir],
    readRoots: [dir],
    workspace: dir,
    task: {} as never,
    allowShell: false,
    addArtifact: async () => null,
    setBrowser: () => undefined,
    setPlan: () => undefined,
    toast: () => undefined
  } as unknown as ToolContext
}

function asDiff(review: ApprovalReview | undefined): Extract<ApprovalReview, { kind: 'diff' }> {
  expect(review?.kind).toBe('diff')
  return review as Extract<ApprovalReview, { kind: 'diff' }>
}

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'si-review-'))

describe('write_file review', () => {
  it('shows a new file as all additions', async () => {
    const dir = tempDir()
    const review = asDiff(
      await writeFileTool.approvalReview?.({ path: 'notes.md', content: 'one\ntwo\n' }, contextIn(dir))
    )
    expect(review.added).toBe(2)
    expect(review.removed).toBe(0)
    expect(review.note).toContain('New file')
    expect(review.lines.every((line) => line.sign === '+')).toBe(true)
  })

  it('shows what an overwrite destroys, neighbours and all', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.txt'), 'keep\nreplace me\nkeep too\n', 'utf8')
    const review = asDiff(
      await writeFileTool.approvalReview?.(
        { path: 'a.txt', content: 'keep\nreplaced\nkeep too\n' },
        contextIn(dir)
      )
    )
    expect(review.added).toBe(1)
    expect(review.removed).toBe(1)
    expect(review.note).toBeUndefined()
    expect(review.lines.filter((line) => line.sign === ' ').map((line) => line.text)).toEqual([
      'keep',
      'keep too'
    ])
  })

  it('offers no review for a path outside the granted folders', async () => {
    const dir = tempDir()
    expect(
      await writeFileTool.approvalReview?.({ path: '../../escape.txt', content: 'x' }, contextIn(dir))
    ).toBeUndefined()
  })

  it('says so when the target is not text', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([1, 2, 0, 3, 4]))
    const review = asDiff(
      await writeFileTool.approvalReview?.({ path: 'blob.bin', content: 'now text' }, contextIn(dir))
    )
    expect(review.lines).toHaveLength(0)
    expect(review.note).toContain('non-text file')
  })
})

describe('edit_file review', () => {
  it('renders the replacement before it happens', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'b.txt'), 'alpha\nbeta\ngamma\n', 'utf8')
    const review = asDiff(
      await editFileTool.approvalReview?.(
        { path: 'b.txt', old_text: 'beta', new_text: 'delta', replace_all: false },
        contextIn(dir)
      )
    )
    expect(review.added).toBe(1)
    expect(review.removed).toBe(1)
    expect(review.lines.map((line) => `${line.sign} ${line.text}`)).toEqual([
      '  alpha',
      '- beta',
      '+ delta',
      '  gamma'
    ])
  })

  it('warns when the match is missing or ambiguous instead of showing a fake change', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'c.txt'), 'x\nx\ny\n', 'utf8')

    const ambiguous = asDiff(
      await editFileTool.approvalReview?.(
        { path: 'c.txt', old_text: 'x', new_text: 'z', replace_all: false },
        contextIn(dir)
      )
    )
    expect(ambiguous.note).toContain('appears 2 times')
    expect(ambiguous.added).toBe(0)
    expect(ambiguous.removed).toBe(0)

    const missing = asDiff(
      await editFileTool.approvalReview?.(
        { path: 'c.txt', old_text: 'nope', new_text: 'z', replace_all: false },
        contextIn(dir)
      )
    )
    expect(missing.note).toContain('not found')
  })

  it('shows every replacement when replace_all is set', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'd.txt'), 'red\nred\nred\n', 'utf8')
    const review = asDiff(
      await editFileTool.approvalReview?.(
        { path: 'd.txt', old_text: 'red', new_text: 'blue', replace_all: true },
        contextIn(dir)
      )
    )
    expect(review.removed).toBe(3)
    expect(review.added).toBe(3)
  })
})
