import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDocumentTool, readDocumentTool } from './documents'
import type { ToolContext } from './types'

function contextFor(workspace: string): ToolContext {
  return {
    task: { id: 'task_test' } as ToolContext['task'],
    workspace,
    roots: [workspace],
    allowShell: false,
    addArtifact: async () => null,
    setBrowser: () => undefined,
    setPlan: () => undefined,
    toast: () => undefined
  }
}

describe('document tools', () => {
  it('reads a generated document back by its bare filename', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'si-docs-'))
    const ctx = contextFor(workspace)

    const created = await createDocumentTool.execute(
      { filename: 'probe.docx', markdown: 'The codename is MOONLIT HARBOR.' },
      ctx
    )
    expect(created.isError).toBeFalsy()

    const read = await readDocumentTool.execute({ path: 'probe.docx' }, ctx)
    expect(read.isError).toBeFalsy()
    expect(String(read.content)).toContain('The codename is MOONLIT HARBOR')
  })
})
