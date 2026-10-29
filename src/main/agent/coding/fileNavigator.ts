import { promises as fs } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { extractDocumentContent } from '../../services/documents'

export const FIRST_CHUNK = 256 * 1024
export const MAX_READ_BYTES = 100 * 1024
export const MAX_READ_LINES = 2_000
export const MAX_LINE_LENGTH = 2_000
export const MAX_LINE_SUFFIX = '... [line truncated]'

export interface PagedFileContent {
  type: 'text-page'
  path: string
  content: string
  mime: string
  offset: number
  linesCount: number
  totalLines?: number
  hasMore: boolean
  nextOffset?: number
}

export interface PagedDirectoryEntry {
  path: string
  type: 'file' | 'directory' | 'symlink'
  size?: number
}

export interface PagedDirectoryContent {
  type: 'dir-page'
  path: string
  entries: PagedDirectoryEntry[]
  totalEntries: number
  hasMore: boolean
  nextOffset?: number
}

export interface CodeSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'export'
  line: number
  signature?: string
}

function clampLine(line: string): string {
  if (line.length <= MAX_LINE_LENGTH) return line
  return line.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX
}

export function detectMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.ts':
    case '.mts':
    case '.cts':
      return 'text/typescript'
    case '.tsx':
      return 'text/tsx'
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'text/javascript'
    case '.jsx':
      return 'text/jsx'
    case '.json':
      return 'application/json'
    case '.html':
    case '.htm':
      return 'text/html'
    case '.css':
      return 'text/css'
    case '.scss':
      return 'text/x-scss'
    case '.md':
    case '.mdx':
      return 'text/markdown'
    case '.yaml':
    case '.yml':
      return 'text/yaml'
    case '.py':
      return 'text/x-python'
    case '.go':
      return 'text/x-go'
    case '.rs':
      return 'text/x-rust'
    case '.sql':
      return 'text/x-sql'
    case '.sh':
    case '.bash':
      return 'application/x-sh'
    case '.pdf':
      return 'application/pdf'
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    default:
      return 'text/plain'
  }
}

export class FileNavigator {
  /**
   * Reads a file with chunked streaming, line clamping, and line-range offset/limit.
   * Can read arbitrarily large files without loading entire files into memory.
   */
  static async readFile(
    fullPath: string,
    options: { offset?: number; limit?: number } = {}
  ): Promise<PagedFileContent> {
    const fileHandle = await fs.open(fullPath, 'r')
    try {
      const stat = await fileHandle.stat()
      const offset = Math.max(1, options.offset ?? 1)
      const limit = Math.min(Math.max(1, options.limit ?? 400), MAX_READ_LINES)
      const mime = detectMime(fullPath)

      // Check first chunk for binary content (null bytes)
      const firstChunkBuf = Buffer.alloc(Math.min(FIRST_CHUNK, stat.size))
      const { bytesRead: firstRead } = await fileHandle.read(firstChunkBuf, 0, firstChunkBuf.length, 0)
      const slice = firstChunkBuf.subarray(0, firstRead)

      if (slice.includes(0)) {
        // Binary check with office document fallback
        const ext = extname(fullPath).toLowerCase()
        if (['.docx', '.doc', '.xlsx', '.xls', '.pdf'].includes(ext)) {
          const rawDoc = await extractDocumentContent(fullPath)
          const allLines = rawDoc.split(/\r?\n/).map(clampLine)
          const startIdx = offset - 1
          const selected = allLines.slice(startIdx, startIdx + limit)
          const hasMore = startIdx + limit < allLines.length
          return {
            type: 'text-page',
            path: fullPath,
            content: selected.join('\n'),
            mime,
            offset,
            linesCount: selected.length,
            totalLines: allLines.length,
            hasMore,
            nextOffset: hasMore ? offset + selected.length : undefined
          }
        }
        throw new Error(`Cannot read binary file: ${fullPath}`)
      }

      // Stream lines up to offset + limit
      let currentLine = 1
      const collected: string[] = []
      let bufferStr = ''
      let filePos = 0
      let eof = false
      const readBuf = Buffer.alloc(FIRST_CHUNK)

      while (!eof && collected.length < limit) {
        const { bytesRead } = await fileHandle.read(readBuf, 0, readBuf.length, filePos)
        if (bytesRead === 0) {
          eof = true
          break
        }
        filePos += bytesRead
        bufferStr += readBuf.toString('utf8', 0, bytesRead)

        let newlineIdx: number
        while ((newlineIdx = bufferStr.indexOf('\n')) >= 0) {
          let line = bufferStr.slice(0, newlineIdx)
          if (line.endsWith('\r')) line = line.slice(0, -1)
          bufferStr = bufferStr.slice(newlineIdx + 1)

          if (currentLine >= offset) {
            collected.push(clampLine(line))
            if (collected.length >= limit) break
          }
          currentLine++
        }
      }

      if (eof && bufferStr.length > 0 && collected.length < limit) {
        if (currentLine >= offset) {
          let line = bufferStr
          if (line.endsWith('\r')) line = line.slice(0, -1)
          collected.push(clampLine(line))
        }
        currentLine++
      }

      const hasMore = !eof || (eof && bufferStr.length > 0 && currentLine > offset + limit)
      return {
        type: 'text-page',
        path: fullPath,
        content: collected.join('\n'),
        mime,
        offset,
        linesCount: collected.length,
        hasMore,
        nextOffset: hasMore ? offset + collected.length : undefined
      }
    } finally {
      await fileHandle.close()
    }
  }

  /**
   * Paged directory listing with entry types and total accounting.
   */
  static async listDirectory(
    dirPath: string,
    options: { offset?: number; limit?: number; recursive?: boolean } = {}
  ): Promise<PagedDirectoryContent> {
    const offset = Math.max(0, options.offset ?? 0)
    const limit = Math.min(Math.max(1, options.limit ?? 200), 1000)
    const dirents = await fs.readdir(dirPath, { withFileTypes: true })

    const entries: PagedDirectoryEntry[] = []
    for (const d of dirents) {
      if (['node_modules', '.git', 'dist', 'release', '.cache'].includes(d.name)) continue
      let type: PagedDirectoryEntry['type'] = 'file'
      if (d.isDirectory()) type = 'directory'
      else if (d.isSymbolicLink()) type = 'symlink'

      entries.push({
        path: d.name,
        type
      })
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.path.localeCompare(b.path)
    })

    const pagedEntries = entries.slice(offset, offset + limit)
    const hasMore = offset + limit < entries.length

    return {
      type: 'dir-page',
      path: dirPath,
      entries: pagedEntries,
      totalEntries: entries.length,
      hasMore,
      nextOffset: hasMore ? offset + pagedEntries.length : undefined
    }
  }

  /**
   * Extract code symbols (classes, functions, interfaces, types) from code text.
   */
  static outlineSymbols(text: string): CodeSymbol[] {
    const lines = text.split(/\r?\n/)
    const symbols: CodeSymbol[] = []

    const patterns: Array<{ regex: RegExp; kind: CodeSymbol['kind'] }> = [
      { regex: /^(?:export\s+)?class\s+([A-Za-z0-9_$]+)/, kind: 'class' },
      { regex: /^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/, kind: 'interface' },
      { regex: /^(?:export\s+)?type\s+([A-Za-z0-9_$]+)/, kind: 'type' },
      { regex: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/, kind: 'function' },
      { regex: /^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/, kind: 'function' },
      { regex: /^(?:public|private|protected|static|async)?\s*([A-Za-z0-9_$]+)\s*\([^)]*\)\s*:\s*[^;{]+[;{]/, kind: 'function' },
      { regex: /^def\s+([A-Za-z0-9_]+)\s*\(/, kind: 'function' },
      { regex: /^fn\s+([A-Za-z0-9_]+)\s*\(/, kind: 'function' }
    ]

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx].trim()
      if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue

      for (const { regex, kind } of patterns) {
        const match = regex.exec(line)
        if (match) {
          symbols.push({
            name: match[1],
            kind,
            line: idx + 1,
            signature: clampLine(line)
          })
          break
        }
      }
    }

    return symbols
  }
}
