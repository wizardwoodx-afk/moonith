import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { ToolContext } from './types'
import { defineTool, toolResultError } from './types'
import { resolveSafePath } from '../../security'
import { truncate } from '../../util'

const execAsync = promisify(exec)

/**
 * Defence in depth only. `run_command` now requires approval in every
 * permission mode, so this list is a guard against obvious accidents rather
 * than a security boundary: it is a pattern match and can be evaded.
 */
const BLOCKED = [
  /\bformat(\.com)?\b/i,
  /\bdiskpart\b/i,
  /\bbcdedit\b/i,
  /\bshutdown\b/i,
  /\bpoweroff\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bdd\s+of=\/dev\//i,
  // rm -rf /, /*, /., ~, $HOME and drive roots; trailing globs included.
  /\brm\s+(?:-[a-z]+\s+)*-[a-z]*[rf][a-z]*\s+["']?(?:\/|~|\$HOME)\/?\*?["']?(?:\s|$)/i,
  /\brm\s+(?:-[a-z]+\s+)*-[a-z]*[rf][a-z]*\s+["']?[A-Z]:[\\/]/i,
  // Windows recursive deletes.
  /\b(?:rd|rmdir)\b[^\n|;&]*\/s\b/i,
  /\bdel\b[^\n|;&]*(?:\/[fsq]\b[^\n|;&]*){2,}/i,
  /\bRemove-Item\b[^\n|;&]*-Recurse\b/i,
  /\b(?:Remove-Item|ri)\b[^\n|;&]*-Force\b[^\n|;&]*-Recurse\b/i,
  // Dynamic execution and download-to-disk helpers.
  /\bInvoke-Expression\b|\biex\s/i,
  /\bcertutil\b[^\n|;&]*-urlcache\b/i,
  /\bbitsadmin\b[^\n|;&]*\/transfer\b/i,
  /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|powershell|pwsh|cmd|iex|python|node)\b/i,
  // Persistence and link tricks.
  /\bmklink\b/i,
  /\breg\s+add\b[^\n]*(?:\\Run(?:Once)?\b|\\CurrentVersion\\Run)/i,
  // Disk wipers.
  /\bcipher\s+\/w\b/i,
  /\b(?:sdelete|shred)\b/i
]

const DESTRUCTIVE_VERB =
  /(?:^|[;&|]\s*)\s*(?:sudo\s+)?(?:rm|rd|rmdir|del|erase|format|mkfs|diskpart|shutdown|cipher|sdelete|shred|reg)\b/i

/** NUL bytes always truncate or split a command line; newlines only matter when they hide a destructive verb. */
function isBlockedCommand(command: string): boolean {
  if (command.includes('\u0000')) return true
  if (!/[\r\n]/.test(command)) return false
  return command
    .split(/[\r\n]+/)
    .some((line) => DESTRUCTIVE_VERB.test(line))
}

function sanitizedEnv(): NodeJS.ProcessEnv {
  const keep = [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'ComSpec',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'HOME',
    'LANG',
    'LC_ALL',
    'TERM',
    'SHELL'
  ]
  const env: NodeJS.ProcessEnv = {}
  for (const key of keep) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

export const runCommandTool = defineTool({
  name: 'run_command',
  title: 'Run command',
  description:
    'Run a shell command inside the task workspace or a granted folder. Always requires approval, in every permission mode. Use for legitimate build, inspection, and file-processing tasks. Avoid destructive or interactive commands.',
  schema: z.object({
    command: z.string().min(1).describe('Shell command to execute.'),
    cwd: z.string().optional().describe('Working directory; defaults to the task workspace.'),
    timeout_seconds: z.number().int().min(1).max(300).optional()
  }),
  sideEffect: 'execute',
  risk: 'high',
  approval: 'always',
  execute: async (args, ctx) => {
    if (!ctx.allowShell) {
      return { content: 'Shell access is disabled in Settings → Permissions.', isError: true }
    }
    if (isBlockedCommand(args.command) || BLOCKED.some((pattern) => pattern.test(args.command))) {
      return { content: 'This command is blocked by the safety policy.', isError: true }
    }
    try {
      const cwd = await resolveSafePath(ctx.roots, args.cwd ?? ctx.workspace, { mode: 'read' })
      const timeout = (args.timeout_seconds ?? 60) * 1000
      const result = await execAsync(args.command, {
        cwd,
        timeout,
        maxBuffer: 3 * 1024 * 1024,
        windowsHide: true,
        env: sanitizedEnv(),
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
      })
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
      return {
        content: `Exit code: 0\n\n${truncate(output || '(no output)', 20000)}`
      }
    } catch (error) {
      const anyError = error as Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean }
      if (anyError.killed) {
        return { content: `Command timed out after ${args.timeout_seconds ?? 60}s.`, isError: true }
      }
      const output = [anyError.stdout, anyError.stderr].filter(Boolean).join('\n') || anyError.message
      return {
        content: `Exit code: ${anyError.code ?? 'unknown'}\n\n${truncate(output, 20000)}`,
        isError: true
      }
    }
  },
  summarize: (args) => args.command
})

export const shellTools = [runCommandTool]
