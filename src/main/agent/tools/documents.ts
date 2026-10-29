import { z } from 'zod'
import { isAbsolute, join, relative } from 'node:path'
import type { ToolContext } from './types'
import { defineTool, toolResultError } from './types'
import {
  convertDocumentToPdf,
  extractDocumentContent,
  generateDocx,
  generatePdf,
  generatePresentation,
  generateSpreadsheet
} from '../../services/documents'
import { resolveSafePath } from '../../security'

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const createDocumentTool = defineTool({
  name: 'create_document',
  title: 'Create Word document',
  description:
    'Create a real .docx Word document in the task workspace from Markdown. Supports headings, paragraphs, bullet/numbered lists, quotes, and code blocks. Use for reports, briefs, letters, and plans.',
  schema: z.object({
    filename: z.string().describe('Output filename, e.g. research-brief.docx'),
    title: z.string().optional(),
    markdown: z.string().min(1).describe('Document body in Markdown.')
  }),
  sideEffect: 'write',
  execute: async (args, ctx) => {
    try {
      const generated = await generateDocx(ctx.workspace, args)
      const artifact = await ctx.addArtifact(generated.filePath, generated.previewPath)
      return {
        content: `Created Word document ${relative(ctx.workspace, generated.filePath)}${
          artifact ? ` (artifact ${artifact.id})` : ''
        }`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Create document ${args.filename}`
})

export const createSpreadsheetTool = defineTool({
  name: 'create_spreadsheet',
  title: 'Create spreadsheet',
  description:
    'Create a real .xlsx Excel workbook with one or more named sheets and rows. The first row is styled as a header. Use for data tables, budgets, trackers, and analyses.',
  schema: z.object({
    filename: z.string().describe('Output filename, e.g. budget.xlsx'),
    title: z.string().optional(),
    sheets: z
      .array(
        z.object({
          name: z.string(),
          rows: z.array(z.array(cellSchema))
        })
      )
      .min(1)
  }),
  sideEffect: 'write',
  execute: async (args, ctx) => {
    try {
      const generated = await generateSpreadsheet(ctx.workspace, args)
      const artifact = await ctx.addArtifact(generated.filePath, generated.previewPath)
      return {
        content: `Created spreadsheet ${relative(ctx.workspace, generated.filePath)}${
          artifact ? ` (artifact ${artifact.id})` : ''
        }`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Create spreadsheet ${args.filename}`
})

export const createPresentationTool = defineTool({
  name: 'create_presentation',
  title: 'Create slide deck',
  description:
    'Create a real .pptx PowerPoint deck with a title slide and content slides (title + bullet points). Use for decks and presentations.',
  schema: z.object({
    filename: z.string().describe('Output filename, e.g. strategy-deck.pptx'),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    slides: z
      .array(
        z.object({
          title: z.string(),
          bullets: z.array(z.string()).optional()
        })
      )
      .min(1)
      .max(30)
  }),
  sideEffect: 'write',
  execute: async (args, ctx) => {
    try {
      const generated = await generatePresentation(ctx.workspace, args)
      const artifact = await ctx.addArtifact(generated.filePath, generated.previewPath)
      return {
        content: `Created presentation ${relative(ctx.workspace, generated.filePath)}${
          artifact ? ` (artifact ${artifact.id})` : ''
        }`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Create deck ${args.filename}`
})

export const createPdfTool = defineTool({
  name: 'create_pdf',
  title: 'Create PDF',
  description:
    'Render a Markdown document to a real .pdf file. Use for final, print-ready deliverables.',
  schema: z.object({
    filename: z.string().describe('Output filename, e.g. report.pdf'),
    title: z.string().optional(),
    markdown: z.string().min(1)
  }),
  sideEffect: 'write',
  execute: async (args, ctx) => {
    try {
      const generated = await generatePdf(ctx.workspace, args)
      const artifact = await ctx.addArtifact(generated.filePath, generated.previewPath)
      return {
        content: `Created PDF ${relative(ctx.workspace, generated.filePath)}${
          artifact ? ` (artifact ${artifact.id})` : ''
        }`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Create PDF ${args.filename}`
})

/**
 * Generated documents live under `artifacts/`, but the agent usually refers to
 * them by bare filename, so a plain workspace lookup misses them. Fall back to
 * the artifacts folder before reporting the file missing.
 */
async function resolveReadableDocument(ctx: ToolContext, path: string): Promise<string> {  try {
    return await resolveSafePath(ctx.roots, path, { mode: 'read' })
  } catch (error) {
    if (isAbsolute(path)) throw error
    try {
      return await resolveSafePath(ctx.roots, join('artifacts', path), { mode: 'read' })
    } catch {
      throw error
    }
  }
}

export const readDocumentTool = defineTool({
  name: 'read_document',
  title: 'Read document',
  description:
    'Read and extract text, tables, and content from a Word (.docx), Excel (.xlsx), or PDF (.pdf) file in the workspace or granted folder.',
  schema: z.object({
    path: z.string().describe('File path, relative to workspace or absolute in granted folder.'),
    offset: z.number().int().min(0).optional().describe('1-based starting line number.'),
    limit: z.number().int().min(1).max(2000).optional().describe('Maximum lines (default 400).')
  }),
  sideEffect: 'read',
  execute: async (args, ctx) => {
    try {
      const target = await resolveReadableDocument(ctx, args.path)
      const rawText = await extractDocumentContent(target)
      const lines = rawText.split(/\r?\n/)
      const offset = Math.max(1, args.offset ?? 1)
      const limit = args.limit ?? 400
      const slice = lines.slice(offset - 1, offset - 1 + limit)
      const header = `Document: ${relative(ctx.workspace, target) || target} (lines ${offset}-${offset + slice.length - 1} of ${lines.length})`
      return { content: `${header}\n\n${slice.join('\n')}` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Read document ${args.path}`
})

export const convertDocumentTool = defineTool({
  name: 'convert_document',
  title: 'Convert document to PDF',
  description:
    'Convert an existing Word (.docx), Markdown, or text file into a PDF, keeping the original text, headings, lists, and tables so nothing is retyped or lost. Use this whenever the user asks to convert, export, or turn a document they already have into a PDF.',
  schema: z.object({
    path: z.string().describe('Source document path, relative to workspace or absolute in granted folder.'),
    filename: z.string().optional().describe('Output PDF filename; defaults to the source name with .pdf.')
  }),
  sideEffect: 'write',
  execute: async (args, ctx) => {
    try {
      const source = await resolveReadableDocument(ctx, args.path)
      const generated = await convertDocumentToPdf(ctx.workspace, {
        sourcePath: source,
        filename: args.filename
      })
      const artifact = await ctx.addArtifact(generated.filePath, generated.previewPath)
      return {
        content: `Converted ${relative(ctx.workspace, source) || source} to PDF ${relative(
          ctx.workspace,
          generated.filePath
        )}${artifact ? ` (artifact ${artifact.id})` : ''}`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Convert ${args.path} to PDF`
})

export const documentTools = [
  readDocumentTool,
  convertDocumentTool,
  createDocumentTool,
  createSpreadsheetTool,
  createPresentationTool,
  createPdfTool
]
