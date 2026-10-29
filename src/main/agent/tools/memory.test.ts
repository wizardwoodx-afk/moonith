import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolContext } from './types'

const paths = vi.hoisted(() => ({ memoriesFile: '' }))
vi.mock('../../paths', () => ({ getPaths: () => paths }))

let root: string
beforeEach(async () => {
  vi.resetModules()
  root = await fs.mkdtemp(join(tmpdir(), 'si-memory-tools-'))
  paths.memoriesFile = join(root, 'memories.json')
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function context(folders: string[]): ToolContext {
  return {
    task: { id: 'memory-test', folders } as ToolContext['task'],
    workspace: root, roots: folders, allowShell: false,
    addArtifact: async () => null, setBrowser: () => undefined,
    setPlan: () => undefined, toast: () => undefined
  }
}

describe('native memory tools', () => {
  it('persists optional retention, captain provenance and first-folder scope through the real ledger', async () => {
    const { memoryTools } = await import('./memory')
    const { MemoryLedger } = await import('../../services/memory')
    const remember = memoryTools.find((tool) => tool.name === 'remember')!
    const recall = memoryTools.find((tool) => tool.name === 'recall_memory')!
    const first = join(root, 'first')
    const second = join(root, 'second')
    const args = remember.schema!.parse({ text: 'Use concise summaries', tags: ['writing'], scope: 'workspace', retentionDays: 7 })
    const result = await remember.execute(args, context([first, second]))
    expect(result.isError).toBeFalsy()
    const notes = await new MemoryLedger().list()
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ source: 'captain', scope: 'workspace', scopeRef: first, tags: ['writing'] })
    expect(notes[0].expiresAt).toBeDefined()
    expect(Date.parse(notes[0].expiresAt!) - Date.parse(notes[0].createdAt)).toBe(604_800_000)
    const found = await recall.execute({ query: 'writing' }, context([first]))
    expect(found.content).toContain('Use concise summaries')
    expect(found.content).toContain('captain')
    expect((await recall.execute({ query: 'writing' }, context([second]))).content).not.toContain('Use concise summaries')
  })

  it.each([0, -1, 1.5, 3651, '7', null])('rejects invalid retention in the exposed tool schema: %j', async (retentionDays) => {
    const { memoryTools } = await import('./memory')
    const remember = memoryTools.find((tool) => tool.name === 'remember')!
    expect(remember.schema!.safeParse({ text: 'Valid memory note', retentionDays }).success).toBe(false)
  })

  it('keeps omitted retention durable and refuses workspace notes without a grant', async () => {
    const { memoryTools } = await import('./memory')
    const { MemoryLedger } = await import('../../services/memory')
    const remember = memoryTools.find((tool) => tool.name === 'remember')!
    const missing = await remember.execute(remember.schema!.parse({ text: 'Workspace note', scope: 'workspace' }), context([]))
    expect(missing.isError).toBe(true)
    await expect(fs.stat(paths.memoriesFile)).rejects.toMatchObject({ code: 'ENOENT' })
    await remember.execute(remember.schema!.parse({ text: 'Durable global note' }), context([]))
    const [note] = await new MemoryLedger().list()
    expect(note.scope).toBe('global')
    expect(note.expiresAt).toBeUndefined()
  })
})
