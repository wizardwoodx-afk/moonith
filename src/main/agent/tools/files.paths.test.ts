/**
 * What a person reads when a path was wrong.
 *
 * A task was asked to inspect a granted folder and `list_files` was pointed at a
 * subfolder nobody had mentioned. The user saw
 * `Error: ENOENT: no such file or directory, access 'D:\...'`. These hold the
 * refused path to plain, actionable sentences, keep the sandbox's own refusal for
 * a path outside the granted folders, and keep an unexpected failure's message.
 */
import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolContext } from './types'
import { listFilesTool, readFileTool, searchFilesTool } from './files'

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

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'si-paths-'))

describe('a path that is not there', () => {
  it('list_files says the path does not exist instead of an OS errno', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'real folder'))
    const guessed = join(dir, 'plan')

    const outcome = await listFilesTool.execute({ path: guessed }, contextIn(dir))

    expect(outcome.isError).toBe(true)
    expect(outcome.content).toContain('does not exist')
    expect(outcome.content).toContain(guessed)
    expect(outcome.content).not.toContain('ENOENT')
    expect(outcome.content).not.toContain('no such file or directory')
    expect(outcome.content).not.toMatch(/^Error: /)
    expect(outcome.content).toContain('List')
    // The answer is about the one path asked for, not a tour of the root.
    expect(outcome.content).not.toContain('real folder')
  })

  it('covers a guessed relative path in the workspace too', async () => {
    const dir = tempDir()
    const outcome = await listFilesTool.execute({ path: join('plan', 'week1.md') }, contextIn(dir))
    expect(outcome.isError).toBe(true)
    expect(outcome.content).toContain('does not exist')
    expect(outcome.content).not.toContain('ENOENT')
  })

  it('read_file and search_files say the same in the same words', async () => {
    const dir = tempDir()
    const missing = join(dir, 'plan', 'notes.md')

    const read = await readFileTool.execute({ path: missing }, contextIn(dir))
    expect(read.isError).toBe(true)
    expect(read.content).toContain('does not exist')
    expect(read.content).not.toContain('ENOENT')

    const search = await searchFilesTool.execute({ query: 'x', path: join(dir, 'plan') }, contextIn(dir))
    expect(search.isError).toBe(true)
    expect(search.content).toContain('does not exist')
    expect(search.content).not.toContain('ENOENT')
  })

  it('still tells a file from a folder when a file is listed', async () => {
    const dir = tempDir()
    const file = join(dir, 'notes.txt')
    writeFileSync(file, 'body\n', 'utf8')

    const outcome = await listFilesTool.execute({ path: file }, contextIn(dir))
    expect(outcome.isError).toBe(true)
    expect(outcome.content).toBe('Not a directory. Use read_file instead.')
  })
})

describe('a path that was never granted', () => {
  it('names the refusal and shows nothing of what lives there', async () => {
    const parent = tempDir()
    const granted = join(parent, 'moon')
    const ungranted = join(parent, 'secret')
    mkdirSync(granted)
    mkdirSync(ungranted)
    writeFileSync(join(ungranted, 'diary.txt'), 'private\n', 'utf8')

    const outcome = await listFilesTool.execute({ path: ungranted }, contextIn(granted))

    expect(outcome.isError).toBe(true)
    expect(outcome.content).toContain('outside the folders granted to this task')
    expect(outcome.content).not.toContain('does not exist')
    expect(outcome.content).not.toContain('diary.txt')
  })

  it('keeps refusing an escape out of the granted folder', async () => {
    const dir = tempDir()
    const outcome = await listFilesTool.execute({ path: '..' }, contextIn(dir))
    expect(outcome.isError).toBe(true)
    expect(outcome.content).toContain('outside the folders granted to this task')
  })
})

describe('a failure nobody predicted', () => {
  it('surfaces its own message instead of a path lesson', async () => {
    const dir = tempDir()
    const stat = vi
      .spyOn(fsp, 'stat')
      .mockRejectedValue(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }))
    try {
      const outcome = await listFilesTool.execute({ path: dir }, contextIn(dir))
      expect(outcome.isError).toBe(true)
      expect(outcome.content).toContain('EPERM: operation not permitted')
    } finally {
      stat.mockRestore()
    }
  })
})
