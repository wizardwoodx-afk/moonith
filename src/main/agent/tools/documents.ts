import { z } from 'zod'
import { relative } from 'node:path'
import type { ToolContext } from './types'
import { defineTool, toolResultError } from './types'
import {
  generateDocx,
  generatePdf,
  generatePresentation,
  generateSpreadsheet
} from '../../services/documents'

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

export const documentTools = [
  createDocumentTool,
  createSpreadsheetTool,
  createPresentationTool,
  createPdfTool
]
