import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { extractArchiveTool, listArchiveTool } from './archive'
import type { ToolContext } from './types'

let base = ''
let zipPath = ''

beforeAll(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'archive-test-'))
  const zip = new JSZip()
  zip.file('hello.txt', 'Hello World from zip!')
  zip.file('sub/nested.md', '# Nested markdown')
  const content = await zip.generateAsync({ type: 'nodebuffer' })
  zipPath = join(base, 'test.zip')
  await fs.writeFile(zipPath, content)
})

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function mockContext(): ToolContext {
  return {
    task: { id: 'task-1' } as any,
    workspace: base,
    roots: [base],
    allowShell: false,
    addArtifact: async () => null,
    setBrowser: () => undefined,
    setPlan: () => undefined,
    toast: () => undefined
  }
}

describe('archiveTools', () => {
  it('lists entries inside a .zip file', async () => {
    const ctx = mockContext()
    const result = await listArchiveTool.execute({ path: zipPath }, ctx)
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('hello.txt')
    expect(result.content).toContain('sub/nested.md')
  })

  it('extracts files from a .zip file', async () => {
    const ctx = mockContext()
    const dest = join(base, 'extracted')
    const result = await extractArchiveTool.execute({ archivePath: zipPath, destinationPath: dest }, ctx)
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('Successfully extracted')

    const fileContent = await fs.readFile(join(dest, 'hello.txt'), 'utf8')
    expect(fileContent).toBe('Hello World from zip!')

    const nestedContent = await fs.readFile(join(dest, 'sub', 'nested.md'), 'utf8')
    expect(nestedContent).toBe('# Nested markdown')
  })
})
