import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { BrowserWindow } from 'electron'
import * as docx from 'docx'
import ExcelJS from 'exceljs'
import PptxGenJS from 'pptxgenjs'
import type { ArtifactKind } from '@shared/types'
import { resolveSafePath } from '../security'

export interface DocSpec {
  filename: string
  title?: string
  markdown: string
}

export interface SheetSpec {
  filename: string
  title?: string
  sheets: Array<{ name: string; rows: Array<Array<string | number | boolean | null>> }>
}

export interface SlideSpec {
  filename: string
  title?: string
  subtitle?: string
  slides: Array<{ title: string; bullets?: string[] }>
}

export interface GeneratedFile {
  filePath: string
  previewPath?: string
  kind: ArtifactKind
}

type BlockType = 'h1' | 'h2' | 'h3' | 'p' | 'bullet' | 'numbered' | 'quote' | 'code'
interface Block {
  type: BlockType
  text: string
}

interface InlineRun {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function safeFilename(value: string, fallback: string, extension: string): string {
  let name = basename(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim()
  name = name.replace(/[. ]+$/g, '')
  if (!name) name = fallback
  if (!extname(name)) name += extension
  if (name.length > 120) {
    const ext = extname(name)
    name = name.slice(0, 120 - ext.length) + ext
  }
  return name
}

async function artifactTarget(
  workspace: string,
  filename: string,
  fallback: string,
  extension: string
): Promise<string> {
  const dir = join(workspace, 'artifacts')
  await fs.mkdir(dir, { recursive: true })
  const name = safeFilename(filename, fallback, extension)
  return resolveSafePath([workspace], join(dir, name), { mode: 'write' })
}

function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue
    if (match.index > last) runs.push({ text: text.slice(last, match.index) })
    const token = match[0]
    if (token.startsWith('**')) runs.push({ text: token.slice(2, -2), bold: true })
    else if (token.startsWith('`')) runs.push({ text: token.slice(1, -1), code: true })
    else runs.push({ text: token.slice(1, -1), italic: true })
    last = match.index + token.length
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  return runs.map((run) => ({ ...run, text: run.text.replace(/\\\*/g, '*') }))
}

function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let inCode = false
  let code: string[] = []
  let paragraph: string[] = []

  const flushParagraph = (): void => {
    if (!paragraph.length) return
    blocks.push({ type: 'p', text: paragraph.join(' ').trim() })
    paragraph = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim().startsWith('```')) {
      flushParagraph()
      if (inCode) {
        blocks.push({ type: 'code', text: code.join('\n') })
        code = []
      }
      inCode = !inCode
      continue
    }
    if (inCode) {
      code.push(rawLine)
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      const level = heading[1].length
      blocks.push({ type: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', text: heading[2].trim() })
      continue
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      flushParagraph()
      blocks.push({ type: 'bullet', text: bullet[1].trim() })
      continue
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      flushParagraph()
      blocks.push({ type: 'numbered', text: numbered[1].trim() })
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      flushParagraph()
      blocks.push({ type: 'quote', text: quote[1].trim() })
      continue
    }
    paragraph.push(line.trim())
  }
  flushParagraph()
  if (inCode && code.length) blocks.push({ type: 'code', text: code.join('\n') })
  return blocks
}

function inlineHtml(text: string): string {
  return parseInline(text)
    .map((run) => {
      let html = escapeHtml(run.text)
      if (run.code) html = `<code>${html}</code>`
      if (run.italic) html = `<em>${html}</em>`
      if (run.bold) html = `<strong>${html}</strong>`
      return html
    })
    .join('')
}

function blocksToBody(blocks: Block[]): string {
  const parts: string[] = []
  let listType: 'ul' | 'ol' | null = null
  const closeList = (): void => {
    if (listType) {
      parts.push(`</${listType}>`)
      listType = null
    }
  }
  for (const block of blocks) {
    if (block.type === 'bullet' || block.type === 'numbered') {
      const wanted = block.type === 'bullet' ? 'ul' : 'ol'
      if (listType !== wanted) {
        closeList()
        parts.push(`<${wanted}>`)
        listType = wanted
      }
      parts.push(`<li>${inlineHtml(block.text)}</li>`)
      continue
    }
    closeList()
    if (block.type === 'h1') parts.push(`<h1>${inlineHtml(block.text)}</h1>`)
    else if (block.type === 'h2') parts.push(`<h2>${inlineHtml(block.text)}</h2>`)
    else if (block.type === 'h3') parts.push(`<h3>${inlineHtml(block.text)}</h3>`)
    else if (block.type === 'code') parts.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`)
    else if (block.type === 'quote') parts.push(`<blockquote>${inlineHtml(block.text)}</blockquote>`)
    else parts.push(`<p>${inlineHtml(block.text)}</p>`)
  }
  closeList()
  return parts.join('\n')
}

function previewDocument(title: string, body: string, accent = '#b4512b'): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 56px 64px; background: #fbf9f4; color: #211f1b;
    font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; line-height: 1.65; }
  main { max-width: 820px; margin: 0 auto; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size: 2.4rem; line-height: 1.15; margin: 0 0 1.4rem; letter-spacing: -0.02em; }
  h2 { font-size: 1.35rem; margin: 2rem 0 0.6rem; letter-spacing: -0.01em; }
  h3 { font-size: 1.08rem; margin: 1.4rem 0 0.4rem; }
  p { margin: 0.65rem 0; }
  ul, ol { padding-left: 1.4rem; margin: 0.6rem 0; }
  li { margin: 0.25rem 0; }
  blockquote { margin: 1rem 0; padding: 0.5rem 1rem; border-left: 3px solid ${accent}; color: #5f594f; background: #f4efe6; }
  pre { background: #22201c; color: #f8f4ec; padding: 1rem 1.2rem; border-radius: 10px; overflow: auto; }
  code { font-family: "Cascadia Code", Consolas, monospace; font-size: 0.9em; }
  p code, li code { background: #efe9de; padding: 0.1em 0.35em; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.92rem; }
  th, td { border: 1px solid #ddd4c6; padding: 0.5rem 0.65rem; text-align: left; vertical-align: top; }
  th { background: #efe9de; }
  .sheet-title { font-family: Georgia, serif; font-size: 1.5rem; margin: 1.6rem 0 0.6rem; }
  .slide { background: #f7f3ea; border: 1px solid #e2d9ca; border-radius: 14px; padding: 32px 36px; margin: 18px 0; aspect-ratio: 16/9; overflow: hidden; }
  .slide h2 { margin: 0 0 0.8rem; font-family: Georgia, serif; font-size: 1.7rem; }
  .slide li { margin: 0.4rem 0; }
  @media print { body { padding: 0; background: white; } }
</style></head><body><main>${body}</main></body></html>`
}

async function writePreview(targetFile: string, html: string): Promise<string> {
  const preview = `${targetFile}.preview.html`
  await fs.writeFile(preview, html, 'utf8')
  return preview
}

export async function generateDocx(workspace: string, spec: DocSpec): Promise<GeneratedFile> {
  const target = await artifactTarget(workspace, spec.filename, 'document', '.docx')
  const blocks = parseMarkdown(spec.markdown)
  const children: docx.Paragraph[] = []
  if (spec.title) {
    children.push(
      new docx.Paragraph({
        children: [new docx.TextRun({ text: spec.title, bold: true, size: 36, color: '1F1D1A' })],
        spacing: { after: 280 }
      })
    )
  }

  for (const block of blocks) {
    const runs = parseInline(block.text).map(
      (run) =>
        new docx.TextRun({
          text: run.text,
          bold: run.bold,
          italics: run.italic,
          font: run.code ? 'Consolas' : 'Aptos',
          color: run.code ? '9A3F22' : '26231F',
          size: 22
        })
    )
    const heading =
      block.type === 'h1'
        ? docx.HeadingLevel.HEADING_1
        : block.type === 'h2'
          ? docx.HeadingLevel.HEADING_2
          : block.type === 'h3'
            ? docx.HeadingLevel.HEADING_3
            : undefined
    if (block.type === 'code') {
      children.push(
        new docx.Paragraph({
          children: [
            new docx.TextRun({
              text: block.text,
              font: 'Consolas',
              size: 19,
              color: 'F8F4EC'
            })
          ],
          shading: { type: docx.ShadingType.CLEAR, fill: '211F1B' },
          spacing: { before: 120, after: 120 },
          indent: { left: 180, right: 180 }
        })
      )
      continue
    }
    children.push(
      new docx.Paragraph({
        children: runs.length ? runs : [new docx.TextRun({ text: block.text })],
        heading,
        bullet: block.type === 'bullet' ? { level: 0 } : undefined,
        indent: block.type === 'numbered' ? { left: 360, hanging: 240 } : block.type === 'quote' ? { left: 480 } : undefined,
        spacing: { before: heading ? 200 : 60, after: heading ? 100 : 60 },
        border:
          block.type === 'quote'
            ? {
                left: { style: docx.BorderStyle.SINGLE, size: 12, color: 'B4512B', space: 12 }
              }
            : undefined
      })
    )
  }

  const document = new docx.Document({
    creator: 'Knight Cowork',
    title: spec.title || basename(target),
    sections: [
      {
        properties: {
          page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } }
        },
        children
      }
    ]
  })

  const buffer = await docx.Packer.toBuffer(document)
  await fs.writeFile(target, buffer)
  const previewHtml = previewDocument(
    spec.title || basename(target),
    (spec.title ? `<h1>${escapeHtml(spec.title)}</h1>` : '') + blocksToBody(blocks)
  )
  const preview = await writePreview(target, previewHtml)
  return { filePath: target, previewPath: preview, kind: 'document' }
}

export async function generateSpreadsheet(workspace: string, spec: SheetSpec): Promise<GeneratedFile> {
  const target = await artifactTarget(workspace, spec.filename, 'workbook', '.xlsx')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Knight Cowork'
  workbook.created = new Date()

  const previewParts: string[] = []
  const sheets = spec.sheets.length ? spec.sheets : [{ name: 'Sheet1', rows: [] }]
  for (const sheetSpec of sheets) {
    const worksheet = workbook.addWorksheet((sheetSpec.name || 'Sheet').slice(0, 31))
    const rows = sheetSpec.rows.length ? sheetSpec.rows : [['']]
    for (const row of rows) worksheet.addRow(row)
    const header = worksheet.getRow(1)
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F1D1A' } }
    header.height = 22
    header.eachCell((cell) => {
      cell.alignment = { vertical: 'middle' }
    })
    worksheet.views = [{ state: 'frozen', ySplit: 1 }]
    const columnCount = Math.max(...rows.map((row) => row.length), 1)
    for (let c = 1; c <= columnCount; c++) {
      const widths = rows.map((row) => String(row[c - 1] ?? '').length)
      worksheet.getColumn(c).width = Math.min(Math.max(12, ...widths) + 2, 60)
    }
    for (let r = 2; r <= rows.length; r++) {
      const row = worksheet.getRow(r)
      row.eachCell((cell) => {
        cell.alignment = { vertical: 'top', wrapText: true }
        cell.border = {
          bottom: { style: 'hair', color: { argb: 'FFE2D9CA' } }
        }
      })
    }
    const tableRows = rows
      .map(
        (row) =>
          `<tr>${row
            .map((cell) => `<td>${escapeHtml(cell === null || cell === undefined ? '' : String(cell))}</td>`)
            .join('')}</tr>`
      )
      .join('\n')
    previewParts.push(`<h2 class="sheet-title">${escapeHtml(sheetSpec.name || 'Sheet')}</h2><table>${tableRows}</table>`)
  }

  await workbook.xlsx.writeFile(target)
  const previewHtml = previewDocument(
    spec.title || basename(target),
    (spec.title ? `<h1>${escapeHtml(spec.title)}</h1>` : '') + previewParts.join('\n')
  )
  const preview = await writePreview(target, previewHtml)
  return { filePath: target, previewPath: preview, kind: 'spreadsheet' }
}

export async function generatePresentation(workspace: string, spec: SlideSpec): Promise<GeneratedFile> {
  const target = await artifactTarget(workspace, spec.filename, 'presentation', '.pptx')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Knight Cowork'
  pptx.company = 'Knight Cowork'
  pptx.title = spec.title || basename(target)

  const titleSlide = pptx.addSlide()
  titleSlide.background = { color: '1F1D1A' }
  titleSlide.addText(spec.title || 'Presentation', {
    x: 0.8,
    y: 2.1,
    w: 11.7,
    h: 1.4,
    fontFace: 'Georgia',
    fontSize: 40,
    bold: true,
    color: 'F7F3EA',
    valign: 'middle'
  })
  if (spec.subtitle) {
    titleSlide.addText(spec.subtitle, {
      x: 0.82,
      y: 3.5,
      w: 11,
      h: 0.7,
      fontFace: 'Aptos',
      fontSize: 18,
      color: 'D9CFC0'
    })
  }
  titleSlide.addText('KNIGHT COWORK', {
    x: 0.85,
    y: 6.8,
    w: 5,
    h: 0.3,
    fontFace: 'Aptos',
    fontSize: 10,
    charSpacing: 3,
    color: 'B4512B'
  })

  for (const slideSpec of spec.slides) {
    const slide = pptx.addSlide()
    slide.background = { color: 'F7F3EA' }
    slide.addText(slideSpec.title, {
      x: 0.8,
      y: 0.55,
      w: 11.7,
      h: 0.9,
      fontFace: 'Georgia',
      fontSize: 28,
      bold: true,
      color: '1F1D1A'
    })
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.82,
      y: 1.5,
      w: 0.9,
      h: 0.06,
      fill: { color: 'B4512B' },
      line: { color: 'B4512B' }
    })
    if (slideSpec.bullets?.length) {
      slide.addText(
        slideSpec.bullets.map((bullet) => ({
          text: bullet,
          options: { bullet: { code: '2022' }, breakLine: true }
        })),
        {
          x: 0.9,
          y: 1.9,
          w: 11.4,
          h: 4.6,
          fontFace: 'Aptos',
          fontSize: 18,
          color: '2B2823',
          valign: 'top',
          paraSpaceAfter: 10
        }
      )
    }
  }

  await pptx.writeFile({ fileName: target })

  const slidesHtml = spec.slides
    .map(
      (slide) =>
        `<section class="slide"><h2>${escapeHtml(slide.title)}</h2><ul>${(slide.bullets ?? [])
          .map((bullet) => `<li>${inlineHtml(bullet)}</li>`)
          .join('')}</ul></section>`
    )
    .join('\n')
  const previewHtml = previewDocument(
    spec.title || basename(target),
    (spec.title ? `<h1>${escapeHtml(spec.title)}</h1>` : '') + slidesHtml
  )
  const preview = await writePreview(target, previewHtml)
  return { filePath: target, previewPath: preview, kind: 'presentation' }
}

export async function generatePdf(workspace: string, spec: DocSpec): Promise<GeneratedFile> {
  const target = await artifactTarget(workspace, spec.filename, 'document', '.pdf')
  const blocks = parseMarkdown(spec.markdown)
  const html = previewDocument(
    spec.title || basename(target),
    (spec.title ? `<h1>${escapeHtml(spec.title)}</h1>` : '') + blocksToBody(blocks)
  ).replace('</style>', ' @page { size: A4; margin: 16mm; } body { padding: 0; } </style>')
  const source = `${target}.source.html`
  await fs.writeFile(source, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false, contextIsolation: true }
  })
  try {
    await win.loadFile(source)
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    await fs.writeFile(target, pdf)
  } finally {
    win.destroy()
    await fs.rm(source, { force: true })
  }
  return { filePath: target, kind: 'pdf' }
}

export function artifactKindForPath(filePath: string): ArtifactKind {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.docx' || ext === '.doc' || ext === '.md') return ext === '.md' ? 'text' : 'document'
  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') return 'spreadsheet'
  if (ext === '.pptx' || ext === '.ppt') return 'presentation'
  if (ext === '.pdf') return 'pdf'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) return 'image'
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.html', '.css', '.sh', '.ps1', '.sql'].includes(ext)) {
    return 'code'
  }
  if (['.txt', '.md', '.log', '.yaml', '.yml', '.xml', '.toml'].includes(ext)) return 'text'
  return 'other'
}

export function mimeForPath(filePath: string): string | undefined {
  const ext = extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.html': 'text/html',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.xml': 'application/xml',
    '.ico': 'image/x-icon'
  }
  return map[ext]
}
