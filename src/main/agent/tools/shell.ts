import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { ToolContext } from './types'
import { defineTool, toolResultError } from './types'
import { resolveSafePath } from '../../security'
import { truncate } from '../../util'

const execAsync = promisify(exec)

const BLOCKED = [
  /\bformat(\.com)?\b/i,
  /\bdiskpart\b/i,
  /\bbcdedit\b/i,
  /\bshutdown\b/i,
  /\bpoweroff\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /rm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+\/(?:\s|$)/i,
  /Remove-Item\s+[A-Z]:\\?\s+-Recurse/i
]

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
    'Run a shell command inside the task workspace or a granted folder. Requires approval in Manual and Auto modes. Use for legitimate build, inspection, and file-processing tasks. Avoid destructive or interactive commands.',
  schema: z.object({
    command: z.string().min(1).describe('Shell command to execute.'),
    cwd: z.string().optional().describe('Working directory; defaults to the task workspace.'),
    timeout_seconds: z.number().int().min(1).max(300).optional()
  }),
  sideEffect: 'execute',
  risk: 'high',
  execute: async (args, ctx) => {
    if (!ctx.allowShell) {
      return { content: 'Shell access is disabled in Settings → Permissions.', isError: true }
    }
    if (BLOCKED.some((pattern) => pattern.test(args.command))) {
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
