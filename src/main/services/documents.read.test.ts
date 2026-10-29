import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extractDocumentContent, generateDocx, generateSpreadsheet } from './documents'

describe('documents read & extract', () => {
  it('extracts text from a real generated docx', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'doc-read-test-'))
    try {
      const generated = await generateDocx(dir, {
        filename: 'test-extract.docx',
        title: 'Project Tangerine',
        markdown: 'This is a test report.\n\n- Key finding 1: Success\n- Key finding 2: Growth'
      })
      const content = await extractDocumentContent(generated.filePath)
      expect(content).toContain('Project Tangerine')
      expect(content).toContain('Key finding 1: Success')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('extracts table rows from a real generated spreadsheet', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'sheet-read-test-'))
    try {
      const generated = await generateSpreadsheet(dir, {
        filename: 'data.xlsx',
        sheets: [
          {
            name: 'Metrics',
            rows: [
              ['Metric', 'Value'],
              ['Uplift', '14.6%'],
              ['Reviewer', 'Priya']
            ]
          }
        ]
      })
      const content = await extractDocumentContent(generated.filePath)
      expect(content).toContain('Sheet: Metrics')
      expect(content).toContain('Uplift')
      expect(content).toContain('14.6%')
      expect(content).toContain('Priya')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
