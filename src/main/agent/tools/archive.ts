import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { z } from 'zod'
import JSZip from 'jszip'
import * as tar from 'tar'
import { defineTool, toolResultError } from './types'
import { resolveSafePath } from '../../security'

export const listArchiveTool = defineTool({
  name: 'list_archive',
  title: 'List archive contents',
  description: 'List files and folders inside a .zip, .tar, .tgz, or .gz archive without extracting.',
  schema: z.object({
    path: z.string().describe('Path to the archive file (relative to workspace or in a granted folder).')
  }),
  sideEffect: 'read',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(ctx.roots, args.path, { mode: 'read' })
      const ext = extname(target).toLowerCase()

      if (ext === '.zip') {
        const buffer = await fs.readFile(target)
        const zip = await JSZip.loadAsync(buffer)
        const entries: string[] = []
        zip.forEach((relPath, file) => {
          const type = file.dir ? '[DIR] ' : '[FILE]'
          const uncompressed = (file as any)._data?.uncompressedSize
          entries.push(`${type} ${relPath}${uncompressed !== undefined ? ` (${uncompressed} bytes)` : ''}`)
        })
        return {
          content: `Archive "${basename(target)}" contains ${entries.length} entries:\n\n${entries.slice(0, 150).join('\n')}${entries.length > 150 ? `\n...and ${entries.length - 150} more entries` : ''}`
        }
      }

      if (ext === '.tar' || ext === '.tgz' || ext === '.gz') {
        const entries: string[] = []
        await tar.t({
          file: target,
          onentry: (entry) => {
            entries.push(`${entry.type === 'Directory' ? '[DIR] ' : '[FILE]'} ${entry.path} (${entry.size} bytes)`)
          }
        })
        return {
          content: `Archive "${basename(target)}" contains ${entries.length} entries:\n\n${entries.slice(0, 150).join('\n')}${entries.length > 150 ? `\n...and ${entries.length - 150} more entries` : ''}`
        }
      }

      return { content: `Unsupported archive format: ${ext}. Supported formats: .zip, .tar, .tgz, .gz`, isError: true }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `List archive ${args.path}`
})

export const extractArchiveTool = defineTool({
  name: 'extract_archive',
  title: 'Extract archive',
  description: 'Extract a .zip, .tar, .tgz, or .gz archive into a destination folder inside the workspace or granted folder.',
  schema: z.object({
    archivePath: z.string().describe('Path to the archive file to extract.'),
    destinationPath: z.string().optional().describe('Folder to extract into. Defaults to an uncompressed folder alongside the archive.')
  }),
  sideEffect: 'write',
  risk: 'medium',
  approval: 'policy',
  execute: async (args, ctx) => {
    try {
      const source = await resolveSafePath(ctx.roots, args.archivePath, { mode: 'read' })
      const defaultDest = join(dirname(source), basename(source, extname(source)) + '_unpacked')
      const dest = await resolveSafePath(ctx.roots, args.destinationPath ?? defaultDest, { mode: 'write' })
      await fs.mkdir(dest, { recursive: true })

      const ext = extname(source).toLowerCase()
      const extractedFiles: string[] = []

      if (ext === '.zip') {
        const buffer = await fs.readFile(source)
        const zip = await JSZip.loadAsync(buffer)

        for (const [relPath, file] of Object.entries(zip.files)) {
          const outPath = join(dest, relPath)
          // Security check: ensure path stays inside dest
          const resolved = await resolveSafePath([dest], outPath, { mode: 'write' })
          if (file.dir) {
            await fs.mkdir(resolved, { recursive: true })
          } else {
            await fs.mkdir(dirname(resolved), { recursive: true })
            const content = await file.async('nodebuffer')
            await fs.writeFile(resolved, content)
            extractedFiles.push(relative(dest, resolved))
          }
        }
      } else if (ext === '.tar' || ext === '.tgz' || ext === '.gz') {
        await tar.x({
          file: source,
          cwd: dest
        })
        extractedFiles.push('(tar archive unpacked into destination)')
      } else {
        return { content: `Unsupported archive extension: ${ext}. Supported: .zip, .tar, .tgz, .gz`, isError: true }
      }

      return {
        content: `Successfully extracted ${basename(source)} into ${relative(ctx.workspace, dest) || dest}.\nExtracted ${extractedFiles.length} files.`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Extract ${args.archivePath}`
})

export const archiveTools = [listArchiveTool, extractArchiveTool]
