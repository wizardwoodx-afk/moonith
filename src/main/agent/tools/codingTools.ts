import { promises as fs } from 'node:fs'
import { relative } from 'node:path'
import { z } from 'zod'
import { defineTool, toolResultError } from './types'
import { resolveSafePath } from '../../security'
import { guard as guardOriginal, markApplied } from '../../services/snapshots'
import { FileNavigator } from '../coding/fileNavigator'
import { TechnePatchEngine } from '../coding/patchEngine'

export const readFileChunkTool = defineTool({
  name: 'read_file_chunk',
  title: 'Read file chunk',
  description:
    'High-performance chunked file reader. Supports byte-level streaming, line offset and limit, line length clamping, and next offset pagination. Reads arbitrarily large files without loading them whole into memory.',
  schema: z.object({
    path: z.string().describe('File path relative to the workspace or within granted folders.'),
    offset: z.number().int().min(1).optional().describe('1-based starting line number (default: 1).'),
    limit: z.number().int().min(1).max(2000).optional().describe('Maximum number of lines to return (default: 400).')
  }),
  sideEffect: 'read',
  approval: 'never',
  risk: 'low',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(ctx.roots, args.path, { mode: 'read' })
      const page = await FileNavigator.readFile(target, {
        offset: args.offset,
        limit: args.limit
      })

      const relPath = relative(ctx.workspace, target) || target
      let header = `File: ${relPath} (${page.mime}, lines ${page.offset}-${page.offset + page.linesCount - 1})`
      if (page.hasMore) {
        header += ` · [More available, next_offset: ${page.nextOffset}]`
      }

      return {
        content: `${header}\n\n${page.content}`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Read chunk from ${args.path} (from line ${args.offset ?? 1})`
})

export const applyCodePatchTool = defineTool({
  name: 'apply_code_patch',
  title: 'Apply unified code patch',
  description:
    'Applies a multi-hunk unified diff patch to a file with fuzzy context matching and pre-flight syntax integrity checking. Creates a reversible snapshot before editing.',
  schema: z.object({
    path: z.string().describe('File path relative to workspace or within granted folders.'),
    patch: z.string().describe('Unified diff text containing one or more @@ -old +new @@ hunks.'),
    dry_run: z.boolean().optional().describe('Validate and compute patch result without modifying the file on disk.')
  }),
  sideEffect: 'write',
  approval: 'policy',
  risk: 'medium',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(ctx.roots, args.path, { mode: 'write' })
      const original = await fs.readFile(target, 'utf8')

      // Snapshot original file for Walkback rollback safety
      await guardOriginal(ctx.task.id, target, { stepId: ctx.callId })

      const outcome = TechnePatchEngine.applyUnifiedPatch(original, args.patch)
      if (!outcome.success) {
        return {
          content: `Patch application failed: ${outcome.error}`,
          isError: true
        }
      }

      // Pre-flight syntax validation
      const syntaxCheck = TechnePatchEngine.validateCodeSyntax(target, outcome.content!)
      if (!syntaxCheck.valid) {
        return {
          content: `Syntax validation failed after patch: ${syntaxCheck.error}. The file was not modified.`,
          isError: true
        }
      }

      if (args.dry_run) {
        return {
          content: `[Dry Run] Patch applies cleanly (+${outcome.additions}/-${outcome.deletions} lines). File not modified.`
        }
      }

      await fs.writeFile(target, outcome.content!, 'utf8')
      await markApplied(ctx.task.id, target, ctx.callId)

      return {
        content: `Successfully applied patch to ${args.path} (+${outcome.additions}/-${outcome.deletions} lines). Syntax validation passed.`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Apply patch to ${args.path}`
})

export const outlineSymbolsTool = defineTool({
  name: 'outline_symbols',
  title: 'Outline code symbols',
  description:
    'Extracts definitions of classes, interfaces, types, functions, and methods with line numbers from a code file.',
  schema: z.object({
    path: z.string().describe('File path relative to workspace or within granted folders.')
  }),
  sideEffect: 'read',
  approval: 'never',
  risk: 'low',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(ctx.roots, args.path, { mode: 'read' })
      const content = await fs.readFile(target, 'utf8')
      const symbols = FileNavigator.outlineSymbols(content)

      if (symbols.length === 0) {
        return { content: `No top-level functions, classes, or types found in ${args.path}.` }
      }

      const relPath = relative(ctx.workspace, target) || target
      const lines = symbols.map(
        (s) => `Line ${s.line} [${s.kind}]: ${s.name}  →  ${s.signature ?? ''}`
      )

      return {
        content: `Symbol Outline for ${relPath} (${symbols.length} symbols):\n\n${lines.join('\n')}`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Outline symbols in ${args.path}`
})

export const codingTools = [readFileChunkTool, applyCodePatchTool, outlineSymbolsTool]
