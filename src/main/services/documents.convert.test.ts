import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Conversion prints through a hidden BrowserWindow. The stub keeps the real
 * mammoth/HTML pipeline intact and only replaces the Chromium print call, so
 * the assertions below see the exact HTML that would be printed.
 */
const printedHtml: string[] = []

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindowStub {
    webContents = {
      printToPDF: async (): Promise<Buffer> => Buffer.from('%PDF-1.4\nstub')
    }
    loadFile = async (file: string): Promise<void> => {
      printedHtml.push(readFileSync(file, 'utf8'))
    }
    destroy = (): void => undefined
  }
}))

import { convertDocumentToPdf, generateDocx } from './documents'

const workspaces: string[] = []

async function newWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'si-convert-'))
  workspaces.push(dir)
  return dir
}

afterEach(async () => {
  printedHtml.length = 0
  await Promise.all(workspaces.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('convertDocumentToPdf', () => {
  it('keeps a real .docx intact instead of retyping it', async () => {
    const workspace = await newWorkspace()
    const made = await generateDocx(workspace, {
      filename: 'att_9e9a3de2-601-paper.docx',
      title: 'English Paper',
      markdown: '# Section A\n\nThe codename is MOONLIT HARBOR.\n\n- first answer\n- second answer'
    })

    const converted = await convertDocumentToPdf(workspace, { sourcePath: made.filePath })

    expect(converted.kind).toBe('pdf')
    expect(converted.filePath.endsWith('paper.pdf')).toBe(true)
    const pdf = await readFile(converted.filePath)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')

    const html = printedHtml.at(-1) ?? ''
    expect(html).toContain('MOONLIT HARBOR')
    expect(html).toContain('<li>first answer</li>')
    expect(html).toContain('@page { size: A4;')
  })

  it('refuses formats it cannot convert faithfully', async () => {
    const workspace = await newWorkspace()
    await expect(
      convertDocumentToPdf(workspace, { sourcePath: join(workspace, 'photo.png') })
    ).rejects.toThrow('Supported formats')
  })
})
