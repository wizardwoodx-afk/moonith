import { promises as fs } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import type { ToolContext } from './types'
import { defineTool, readRootsFor, toolResultError } from './types'
import { isWithin, resolveSafePath } from '../../security'
import { truncate } from '../../util'

const IGNORED = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'out', 'release', '.next', '.cache'])

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
      const target = await resolveSafePath(readRootsFor(ctx), args.path ?? ctx.workspace, { mode: 'read' })
      const stat = await fs.stat(target)
      if (!stat.isDirectory()) return { content: 'Not a directory. Use read_file instead.', isError: true }
      const results: string[] = []
      await listTree(target, target, 1, args.depth ?? 2, results)
      return {
        content: results.length ? results.join('\n') : '(empty directory)'
      }
    } catch (error) {
      return toolResultError(error)
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
      const target = await resolveSafePath(readRootsFor(ctx), args.path, { mode: 'read' })
      const buffer = await fs.readFile(target)
      if (buffer.includes(0)) return { content: 'Binary file. Use a specialized tool or the preview panel.', isError: true }
      if (buffer.length > 512_000) {
        return { content: 'File is larger than 512 KB. Use search_files or a shell command to inspect it.', isError: true }
      }
      const lines = buffer.toString('utf8').split(/\r?\n/)
      const offset = Math.max(1, args.offset ?? 1)
      const limit = args.limit ?? 400
      const slice = lines.slice(offset - 1, offset - 1 + limit)
      const header = `File: ${relative(ctx.workspace, target) || target} (lines ${offset}-${offset + slice.length - 1} of ${lines.length})`
      return { content: `${header}\n\n${slice.join('\n')}` }
    } catch (error) {
      return toolResultError(error)
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
  execute: async (args, ctx) => {
    try {
      if (Buffer.byteLength(args.content, 'utf8') > 2_500_000) {
        return { content: 'Content exceeds the 2.5 MB write limit.', isError: true }
      }
      const target = await resolveSafePath(ctx.roots, args.path, { mode: 'write' })
      await fs.mkdir(join(target, '..'), { recursive: true })
      await fs.writeFile(target, args.content, 'utf8')
      await ctx.addArtifact(target)
      return { content: `Wrote ${Buffer.byteLength(args.content, 'utf8')} bytes to ${relative(ctx.workspace, target) || target}` }
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
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(readRootsFor(ctx), args.path, { mode: 'read' })
      // Reading a shared Captain file does not grant a Crew writer access to it.
      await resolveSafePath(ctx.roots, args.path, { mode: 'write' })
      const original = await fs.readFile(target, 'utf8')
      const count = original.split(args.old_text).length - 1
      if (count === 0) return { content: 'Old text was not found in the file.', isError: true }
      if (count > 1 && !args.replace_all) {
        return { content: `Old text appears ${count} times. Provide more context or set replace_all.`, isError: true }
      }
      const updated = args.replace_all
        ? original.split(args.old_text).join(args.new_text)
        : original.replace(args.old_text, args.new_text)
      await fs.writeFile(target, updated, 'utf8')
      await ctx.addArtifact(target)
      return { content: `Updated ${args.path} (${count} occurrence${count === 1 ? '' : 's'}).` }
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
      const from = await resolveSafePath(ctx.roots, args.from, { mode: 'write' })
      const to = await resolveSafePath(ctx.roots, args.to, { mode: 'write' })
      const rejection = moveRejection(from, to)
      if (rejection) return { content: rejection, isError: true }
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
      const target = await resolveSafePath(ctx.roots, args.path, { mode: 'write' })
      if (target === ctx.workspace || target === ctx.workspace.replace(/[\\/]$/, '')) {
        return { content: 'Refusing to delete the task workspace root.', isError: true }
      }
      await fs.rm(target, { recursive: true, force: false })
      return { content: `Deleted ${relative(ctx.workspace, target) || target}` }
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
      const base = await resolveSafePath(readRootsFor(ctx), args.path ?? ctx.workspace, { mode: 'read' })
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
      return toolResultError(error)
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
