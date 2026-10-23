import { spawn } from 'node:child_process'
import type { Dirent } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { scrubEnv } from './security'

/**
 * Tool runtime for the local agent.
 * Every tool is gated by a permission rule (allow / deny / ask) and confined to a
 * workspace root unless sandboxing is switched off.
 * Ported from the earlier desktop shell.
 */

export type PermissionRule = 'allow' | 'deny' | 'ask'

export type ToolPermissions = Record<string, PermissionRule | undefined>

export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean'
  description?: string
}

export interface ToolParametersSchema {
  type: 'object'
  properties: Record<string, ToolParameterSchema>
  required: string[]
}

export interface ToolFunctionSchema {
  name: string
  description: string
  parameters: ToolParametersSchema
}

export interface ToolDefinition {
  type: 'function'
  function: ToolFunctionSchema
}

export const TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative path' },
          maxBytes: { type: 'number', description: 'Maximum bytes to return' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List the entries of a workspace directory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Workspace-relative directory' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a text file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          append: { type: 'boolean' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search file contents for a regex across the workspace.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
          maxResults: { type: 'number' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command inside the workspace and return its output.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeoutMs: { type: 'number' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Finish the task and report the final answer to the user.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary']
      }
    }
  }
]

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'out', 'coverage'])

export interface ReadFileArgs {
  path?: string
  maxBytes?: number
}

export interface ListDirArgs {
  path?: string
}

export interface WriteFileArgs {
  path?: string
  content?: string
  append?: boolean
}

export interface SearchArgs {
  pattern?: string
  path?: string
  maxResults?: number
}

export interface RunCommandArgs {
  command?: string
  timeoutMs?: number
}

export interface ToolRuntimeOptions {
  workspace: string
  permissions?: ToolPermissions
  sandbox?: boolean
  onAsk?: (name: string) => boolean | Promise<boolean>
}

export interface DirEntry {
  name: string
  type: 'dir' | 'file'
  size: number
  modified: number
}

export interface ReadFileResult {
  ok: true
  path: string | undefined
  bytes: number
  truncated: boolean
  content: string
}

export interface ListDirResult {
  ok: true
  path: string | undefined
  entries: DirEntry[]
}

export interface WriteFileResult {
  ok: true
  path: string | undefined
  bytes: number
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

export interface SearchResult {
  ok: true
  pattern: string | undefined
  count: number
  hits: SearchHit[]
}

export interface RunCommandResult {
  ok: boolean
  exitCode?: number | null
  stdout?: string
  stderr?: string
  error?: string
}

export interface FinishResult {
  ok: true
  finished: true
  summary: string
}

export interface ToolFailure {
  ok: false
  error: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
}

export type ToolResult =
  | ReadFileResult
  | ListDirResult
  | WriteFileResult
  | SearchResult
  | RunCommandResult
  | FinishResult
  | ToolFailure

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function asFlag(value: unknown): boolean | undefined {
  return value === undefined ? undefined : Boolean(value)
}

export class ToolRuntime {
  readonly workspace: string
  readonly permissions: ToolPermissions
  readonly sandbox: boolean
  readonly onAsk: ((name: string) => boolean | Promise<boolean>) | undefined

  constructor({ workspace, permissions, sandbox = true, onAsk }: ToolRuntimeOptions) {
    this.workspace = path.resolve(workspace)
    this.permissions = permissions || {}
    this.sandbox = sandbox
    this.onAsk = onAsk
  }

  definitions(): ToolDefinition[] {
    return TOOL_DEFS
  }

  resolve(rel?: string): string {
    const target = path.resolve(this.workspace, rel || '.')
    if (this.sandbox) {
      // Compare path segments, not prefixes: "/work/app-2" must not pass for
      // a child of "/work/app".
      const inside = path.relative(this.workspace, target)
      if (inside.startsWith('..') || path.isAbsolute(inside)) {
        throw new Error(`Path escapes the workspace: ${rel}`)
      }
    }
    return target
  }

  async allowed(name: string): Promise<boolean> {
    const rule = this.permissions[name] ?? 'allow'
    if (rule === 'allow') return true
    if (rule === 'deny') return false
    if (rule === 'ask') {
      // Nobody answering means no: an unanswered prompt must not become a yes.
      if (this.onAsk) return await this.onAsk(name)
      return false
    }
    return false
  }

  async invoke(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    if (!(await this.allowed(name))) {
      return { ok: false, error: `Tool "${name}" is blocked by the permission rules.` }
    }
    try {
      switch (name) {
        case 'read_file':
          return await this.readFile({ path: asString(args.path), maxBytes: asNumber(args.maxBytes) })
        case 'list_dir':
          return await this.listDir({ path: asString(args.path) })
        case 'write_file':
          return await this.writeFile({
            path: asString(args.path),
            content: asString(args.content),
            append: asFlag(args.append)
          })
        case 'search':
          return await this.search({
            pattern: asString(args.pattern),
            path: asString(args.path),
            maxResults: asNumber(args.maxResults)
          })
        case 'run_command':
          return await this.runCommand({
            command: asString(args.command),
            timeoutMs: asNumber(args.timeoutMs)
          })
        case 'finish':
          return { ok: true, finished: true, summary: asString(args.summary) ?? '' }
        default:
          return { ok: false, error: `Unknown tool "${name}"` }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async readFile({ path: rel, maxBytes = 200000 }: ReadFileArgs): Promise<ReadFileResult> {
    const target = this.resolve(rel)
    const stat = await fs.stat(target)
    if (stat.isDirectory()) throw new Error(`${rel} is a directory`)
    const buf = await fs.readFile(target)
    const slice = buf.subarray(0, maxBytes)
    return {
      ok: true,
      path: rel,
      bytes: stat.size,
      truncated: stat.size > maxBytes,
      content: slice.toString('utf8')
    }
  }

  async listDir({ path: rel = '.' }: ListDirArgs): Promise<ListDirResult> {
    const target = this.resolve(rel)
    const entries = await fs.readdir(target, { withFileTypes: true })
    const out: DirEntry[] = []
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue
      const st = await fs.stat(path.join(target, e.name)).catch(() => null)
      out.push({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        size: st?.size ?? 0,
        modified: st?.mtimeMs ?? 0
      })
    }
    return { ok: true, path: rel, entries: out }
  }

  async writeFile({ path: rel, content, append = false }: WriteFileArgs): Promise<WriteFileResult> {
    const target = this.resolve(rel)
    await fs.mkdir(path.dirname(target), { recursive: true })
    if (append) await fs.appendFile(target, content ?? '', 'utf8')
    else await fs.writeFile(target, content ?? '', 'utf8')
    return { ok: true, path: rel, bytes: (content ?? '').length }
  }

  async search({ pattern, path: rel = '.', maxResults = 120 }: SearchArgs): Promise<SearchResult> {
    const root = this.resolve(rel)
    const source = String(pattern)
    let re: RegExp
    try {
      re = new RegExp(source, 'gi')
    } catch {
      throw new Error(`Invalid regex: ${pattern}`)
    }
    const hits: SearchHit[] = []
    const walk = async (dir: string): Promise<void> => {
      if (hits.length >= maxResults) return
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch((): Dirent[] => [])
      for (const e of entries) {
        if (hits.length >= maxResults) return
        if (SKIP_DIRS.has(e.name)) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          await walk(full)
        } else if (
          e.isFile() &&
          /\.(js|ts|tsx|jsx|json|md|css|html|txt|py|rs|go|java|yml|yaml)$/i.test(e.name)
        ) {
          const text = await fs.readFile(full, 'utf8').catch(() => null)
          if (text === null) continue
          const lines = text.split('\n')
          for (let i = 0; i < lines.length && hits.length < maxResults; i++) {
            re.lastIndex = 0
            if (re.test(lines[i])) {
              hits.push({
                path: path.relative(this.workspace, full),
                line: i + 1,
                text: lines[i].trim().slice(0, 200)
              })
            }
          }
        }
      }
    }
    await walk(root)
    return { ok: true, pattern, count: hits.length, hits }
  }

  async runCommand({ command, timeoutMs = 30000 }: RunCommandArgs): Promise<RunCommandResult> {
    return new Promise<RunCommandResult>((resolve) => {
      const child = spawn(command ?? '', {
        shell: true,
        cwd: this.workspace,
        env: scrubEnv({ KNIGHT: '1' })
      })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill()
        resolve({
          ok: false,
          error: `Command timed out after ${timeoutMs}ms`,
          stdout: stdout.slice(-4000),
          stderr: stderr.slice(-2000)
        })
      }, timeoutMs)
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ ok: false, error: err.message })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ ok: code === 0, exitCode: code, stdout: stdout.slice(-8000), stderr: stderr.slice(-4000) })
      })
    })
  }
}
