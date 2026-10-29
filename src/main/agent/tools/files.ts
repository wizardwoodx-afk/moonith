import { promises as fs } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import type { ApprovalReview } from '@shared/types'
import type { ToolContext, ToolResult } from './types'
import { defineTool, toolResultError } from './types'
import { isWithin, PathAccessError, resolveSafePath } from '../../security'
import { truncate } from '../../util'
import { guard as guardOriginal, markApplied, recordMove } from '../../services/snapshots'
import { extractDocumentContent } from '../../services/documents'
import { diffLines } from '../diff'

const IGNORED = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'out', 'release', '.next', '.cache'])

/** A diff the approval prompt can render, with an optional reason instead. */
function diffReview(path: string, before: string, after: string, note?: string): ApprovalReview {
  const diff = diffLines(before, after)
  return {
    kind: 'diff',
    path,
    added: diff.added,
    removed: diff.removed,
    truncated: diff.truncated,
    lines: diff.lines,
    ...(note ? { note } : {})
  }
}

/**
 * The current content of a write target, for the approval prompt.
 *
 * `ok: false` means the path is not ours to touch at all; the caller then shows
 * the ordinary text prompt rather than pretending a blocked write is an empty
 * file. A missing file is a real answer and stays `ok` with `before: ''`.
 */
async function readBefore(
  ctx: ToolContext,
  path: string
): Promise<{ ok: true; before: string; binary: boolean } | { ok: false }> {
  let target: string
  try {
    target = await resolveSafePath(ctx.roots, path, { mode: 'write' })
  } catch {
    return { ok: false }
  }
  let before: string
  try {
    before = await fs.readFile(target, 'utf8')
  } catch {
    return { ok: true, before: '', binary: false }
  }
  return { ok: true, before, binary: before.includes('\u0000') }
}

async function listTree(
  dir: string,
  root: string,
  depth: number,
  maxDepth: number,
  results: string[]
): Promise<void> {
  if (depth > maxDepth || results.length >= 400) return
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const entry of entries) {
    if (results.length >= 400) return
    if (IGNORED.has(entry.name)) continue
    const full = join(dir, entry.name)
    const rel = relative(root, full) || entry.name
    if (entry.isDirectory()) {
      results.push(`${rel}/`)
      await listTree(full, root, depth + 1, maxDepth, results)
    } else {
      results.push(rel)
    }
  }
}

/**
 * Plain words for the two path failures a guessed path can cause: one that does
 * not exist inside a granted folder, and one that was never granted. The first
 * names only the offending path, so it says nothing about folders this task was
 * not given; the second keeps the sandbox's own refusal. Any other error is
 * unexpected and the caller surfaces its message unchanged.
 */
function pathFailure(error: unknown, path: string): ToolResult | null {
  if (error instanceof PathAccessError) return { content: error.message, isError: true }
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return {
      content:
        `This path does not exist in the folders granted to this task: ${path}\n` +
        'List the folder above it, or the task workspace, and use only paths that listing showed.',
      isError: true
    }
  }
  if (code === 'EISDIR') {
    return { content: 'Not a file. Use list_files to see what a folder contains.', isError: true }
  }
  return null
}

export const listFilesTool = defineTool({
  name: 'list_files',
  title: 'List files',
  description:
    'List files and folders inside a granted folder or the task workspace. Use this to inspect the workspace before reading files.',
  schema: z.object({
    path: z.string().optional().describe('Folder to list. Relative paths resolve to the task workspace.'),
    depth: z.number().int().min(1).max(5).optional().describe('Recursion depth (default 2).')
  }),
  sideEffect: 'read',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(ctx.roots, args.path ?? ctx.workspace, { mode: 'read' })
      const stat = await fs.stat(target)
      if (!stat.isDirectory()) return { content: 'Not a directory. Use read_file instead.', isError: true }
      const results: string[] = []
      await listTree(target, target, 1, args.depth ?? 2, results)
      return {
        content: results.length ? results.join('\n') : '(empty directory)'
      }
    } catch (error) {
      return pathFailure(error, args.path ?? ctx.workspace) ?? toolResultError(error)
    }
  },
  summarize: (args) => `List ${args.path ?? 'workspace'}`
})

export const readFileTool = defineTool({
  name: 'read_file',
  title: 'Read file',
  description:
    'Read a UTF-8 text file. Supports a line offset and limit for large files. Binary files are rejected.',
  schema: z.object({
    path: z.string().describe('File path, relative to the workspace or absolute inside a granted folder.'),
    offset: z.number().int().min(0).optional().describe('1-based starting line number.'),
    limit: z.number().int().min(1).max(2000).optional().describe('Maximum lines (default 400).')
  }),
  sideEffect: 'read',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(ctx.roots, args.path, { mode: 'read' })
      const buffer = await fs.readFile(target)
      const ext = extname(target).toLowerCase()
      if (['.docx', '.doc', '.xlsx', '.xls', '.pdf'].includes(ext)) {
        const rawText = await extractDocumentContent(target)
        const lines = rawText.split(/\r?\n/)
        const offset = Math.max(1, args.offset ?? 1)
        const limit = args.limit ?? 400
        const slice = lines.slice(offset - 1, offset - 1 + limit)
        const header = `File: ${relative(ctx.workspace, target) || target} (extracted document text, lines ${offset}-${offset + slice.length - 1} of ${lines.length})`
        return { content: `${header}\n\n${slice.join('\n')}` }
      }

      // Check for binary content within the first 8KB sample
      const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
      if (sample.includes(0)) {
        return { content: 'Binary file. Use a specialized tool or the preview panel.', isError: true }
      }

      const content = buffer.toString('utf8')
      const lines = content.split(/\r?\n/)
      const offset = Math.max(1, args.offset ?? 1)
      const limit = args.limit ?? 400
      const slice = lines.slice(offset - 1, offset - 1 + limit)
      const isTruncated = offset - 1 + limit < lines.length
      const header = `File: ${relative(ctx.workspace, target) || target} (lines ${offset}-${offset + slice.length - 1} of ${lines.length})${isTruncated ? ` [${lines.length - (offset - 1 + limit)} lines remaining — use offset to continue]` : ''}`
      return { content: `${header}\n\n${slice.join('\n')}` }
    } catch (error) {
      return pathFailure(error, args.path) ?? toolResultError(error)
    }
  },
  summarize: (args) => `Read ${args.path}`
})

export const writeFileTool = defineTool({
  name: 'write_file',
  title: 'Write file',
  description:
    'Create or overwrite a text file. Parent folders are created automatically. Files must stay inside the workspace or a granted folder.',
  schema: z.object({
    path: z.string().describe('Target file path, relative to the workspace or absolute inside a granted folder.'),
    content: z.string().describe('Complete UTF-8 file content.')
  }),
  sideEffect: 'write',
  approvalReview: async (args, ctx) => {
    const review = await readBefore(ctx, args.path)
    if (!review.ok) return undefined
    if (review.binary) {
      return diffReview(args.path, '', '', 'This replaces a non-text file. The change cannot be shown as a diff.')
    }
    return diffReview(
      args.path,
      review.before,
      args.content,
      review.before ? undefined : 'New file — nothing exists at this path yet.'
    )
  },
  execute: async (args, ctx) => {
    try {
      if (Buffer.byteLength(args.content, 'utf8') > 2_500_000) {
        return { content: 'Content exceeds the 2.5 MB write limit.', isError: true }
      }
      const target = await resolveSafePath(ctx.roots, args.path, { mode: 'write' })
      const trail = await guardOriginal(ctx.task.id, target, { stepId: ctx.callId })
      await fs.mkdir(join(target, '..'), { recursive: true })
      await fs.writeFile(target, args.content, 'utf8')
      await markApplied(ctx.task.id, target, ctx.callId)
      await ctx.addArtifact(target)
      const written = `Wrote ${Buffer.byteLength(args.content, 'utf8')} bytes to ${relative(ctx.workspace, target) || target}`
      return { content: trail.guarded ? written : `${written} — cannot be undone: ${trail.reason}` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Write ${args.path}`
})

export const editFileTool = defineTool({
  name: 'edit_file',
  title: 'Edit file',
  description:
    'Replace an exact text snippet in a file. Fails if the old text is missing or appears multiple times (unless replace_all is true).',
  schema: z.object({
    path: z.string(),
    old_text: z.string().min(1),
    new_text: z.string(),
    replace_all: z.boolean().optional()
  }),
  sideEffect: 'write',
  approvalReview: async (args, ctx) => {
    const review = await readBefore(ctx, args.path)
    if (!review.ok) return undefined
    if (review.binary) {
      return diffReview(args.path, '', '', 'This edits a non-text file. The change cannot be shown as a diff.')
    }
    if (!review.before) {
      return diffReview(args.path, '', '', 'The file does not exist yet, so there is no text to replace.')
    }
    const count = review.before.split(args.old_text).length - 1
    if (count === 0) {
      return diffReview(args.path, review.before, review.before, 'Old text was not found in the file — this edit will fail.')
    }
    if (count > 1 && !args.replace_all) {
      return diffReview(
        args.path,
        review.before,
        review.before,
        `Old text appears ${count} times — the edit needs more context or replace_all.`
      )
    }
    const after = args.replace_all
      ? review.before.split(args.old_text).join(args.new_text)
      : review.before.replace(args.old_text, args.new_text)
    return diffReview(args.path, review.before, after)
  },
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(ctx.roots, args.path, { mode: 'read' })
      const original = await fs.readFile(target, 'utf8')
      const count = original.split(args.old_text).length - 1
      if (count === 0) return { content: 'Old text was not found in the file.', isError: true }
      if (count > 1 && !args.replace_all) {
        return { content: `Old text appears ${count} times. Provide more context or set replace_all.`, isError: true }
      }
      const updated = args.replace_all
        ? original.split(args.old_text).join(args.new_text)
        : original.replace(args.old_text, args.new_text)
      const trail = await guardOriginal(ctx.task.id, target, { stepId: ctx.callId })
      await fs.writeFile(target, updated, 'utf8')
      await markApplied(ctx.task.id, target, ctx.callId)
      await ctx.addArtifact(target)
      const edited = `Updated ${args.path} (${count} occurrence${count === 1 ? '' : 's'}).`
      return { content: trail.guarded ? edited : `${edited} — cannot be undone: ${trail.reason}` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Edit ${args.path}`
})

export const makeDirectoryTool = defineTool({
  name: 'make_directory',
  title: 'Create folder',
  description: 'Create a folder inside the workspace or a granted folder.',
  schema: z.object({ path: z.string() }),
  sideEffect: 'write',
  risk: 'low',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(ctx.roots, args.path, { mode: 'write' })
      await guardOriginal(ctx.task.id, target)
      await fs.mkdir(target, { recursive: true })
      return { content: `Created folder ${relative(ctx.workspace, target) || target}` }
    } catch (error) {
      return toolResultError(error)
    }
  }
})

export function moveRejection(from: string, to: string): string | null {
  const source = resolve(from)
  const target = resolve(to)
  if (source === target) return 'Source and destination are the same path.'
  if (isWithin(source, target)) return 'Cannot move a folder into itself.'
  return null
}

export const movePathTool = defineTool({
  name: 'move_path',
  title: 'Move or rename',
  description: 'Move or rename a file or folder. Both source and destination must be inside granted folders.',
  schema: z.object({ from: z.string(), to: z.string() }),
  sideEffect: 'write',
  risk: 'high',
  execute: async (args, ctx) => {
    try {
      const from = await resolveSafePath(ctx.roots, args.from, { mode: 'read' })
      const to = await resolveSafePath(ctx.roots, args.to, { mode: 'write' })
      const rejection = moveRejection(from, to)
      if (rejection) return { content: rejection, isError: true }
      await guardOriginal(ctx.task.id, from)
      await guardOriginal(ctx.task.id, to)
      await recordMove(ctx.task.id, from, to)
      await fs.mkdir(join(to, '..'), { recursive: true })
      await fs.rename(from, to)
      return { content: `Moved ${args.from} → ${args.to}` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Move ${args.from} → ${args.to}`
})

export const deletePathTool = defineTool({
  name: 'delete_path',
  title: 'Delete',
  description:
    'Delete a file or folder. This is destructive and always requires a human decision, in every permission mode.',
  schema: z.object({ path: z.string() }),
  sideEffect: 'write',
  risk: 'high',
  approval: 'always',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(ctx.roots, args.path, { mode: 'read' })
      if (target === ctx.workspace || target === ctx.workspace.replace(/[\\/]$/, '')) {
        return { content: 'Refusing to delete the task workspace root.', isError: true }
      }
      const trail = await guardOriginal(ctx.task.id, target, { forDeletion: true })
      await fs.rm(target, { recursive: true, force: false })
      const deleted = `Deleted ${relative(ctx.workspace, target) || target}`
      return { content: trail.guarded ? deleted : `${deleted} — cannot be undone: ${trail.reason}` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Delete ${args.path}`
})

export const searchFilesTool = defineTool({
  name: 'search_files',
  title: 'Search files',
  description:
    'Search text across files in a folder. Returns matching file paths with line numbers and a short snippet.',
  schema: z.object({
    query: z.string().min(1),
    path: z.string().optional(),
    glob: z.string().optional().describe('Optional glob like **/*.ts'),
    case_sensitive: z.boolean().optional()
  }),
  sideEffect: 'read',
  execute: async (args, ctx) => {
    try {
      const base = await resolveSafePath(ctx.roots, args.path ?? ctx.workspace, { mode: 'read' })
      const fg = (await import('fast-glob')).default
      const pattern = args.glob ?? '**/*'
      if (pattern.startsWith('/') || pattern.includes('..')) {
        return { content: 'Glob must be relative and cannot traverse outside the folder.', isError: true }
      }
      const files = await fg(pattern, {
        cwd: base,
        onlyFiles: true,
        dot: false,
        followSymbolicLinks: false,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/release/**'],
        absolute: true
      })
      const needle = args.case_sensitive ? args.query : args.query.toLowerCase()
      const matches: string[] = []
      for (const file of files.slice(0, 2000)) {
        let stat
        try {
          stat = await fs.stat(file)
        } catch {
          continue
        }
        if (stat.size > 1_500_000) continue
        let text
        try {
          text = await fs.readFile(file, 'utf8')
        } catch {
          continue
        }
        if (text.includes('\0')) continue
        const lines = text.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          const haystack = args.case_sensitive ? lines[i] : lines[i].toLowerCase()
          if (haystack.includes(needle)) {
            matches.push(`${relative(base, file)}:${i + 1}: ${truncate(lines[i].trim(), 220)}`)
            if (matches.length >= 60) break
          }
        }
        if (matches.length >= 60) break
      }
      return {
        content: matches.length
          ? `Found ${matches.length} match${matches.length === 1 ? '' : 'es'}:\n${matches.join('\n')}`
          : 'No matches found.'
      }
    } catch (error) {
      return pathFailure(error, args.path ?? ctx.workspace) ?? toolResultError(error)
    }
  },
  summarize: (args) => `Search “${args.query}”`
})

export const fileTools = [
  listFilesTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  makeDirectoryTool,
  movePathTool,
  deletePathTool,
  searchFilesTool
]

export function classifyExtension(name: string): string {
  return extname(name).toLowerCase()
}
