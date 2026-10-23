import { execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ToolContext } from './types'
import { defineTool, toolResultError } from './types'
import { resolveSafePath } from '../../security'
import { truncate } from '../../util'

/**
 * The Craft apps (storytold) are agent-native by design: every menu item, tool
 * and dialog is a command in one registry, and each app ships a `{app}-cli`
 * binary that runs those commands headless. That CLI is the integration seam —
 * these tools spawn it directly, so nothing here speaks MCP.
 *
 * Only the apps whose CLI and Windows build could be verified are listed. A
 * missing entry is deliberate, not an oversight: adding one is a manifest line
 * plus, at most, one branch in `buildRunArgs`.
 */

export interface CraftApp {
  label: string
  /** Binary name on PATH. */
  bin: string
  /** Environment variable that overrides the binary path. */
  env: string
  /** True when the CLI accepts `--automation-read-root` / `--automation-write-root`. */
  automationRoots: boolean
  /** True when a command's params are appended inline as `id={json}`. */
  inlineParams: boolean
  /** True when params travel in a separate `--params` flag instead. */
  separateParams: boolean
  /** Flag the CLI uses to name the written document. */
  saveFlag: '--save' | '--out'
  /** Default extension, used only to build a sensible output name. */
  ext: string
}

export const CRAFT_APPS: Record<string, CraftApp> = {
  gridcraft: {
    label: 'GridCraft',
    bin: 'gridcraft-cli',
    env: 'SELFIMPULSE_CRAFT_GRIDCRAFT',
    automationRoots: false,
    inlineParams: true,
    separateParams: false,
    saveFlag: '--out',
    ext: 'xlsx'
  },
  wordcraft: {
    label: 'WordCraft',
    bin: 'wordcraft-cli',
    env: 'SELFIMPULSE_CRAFT_WORDCRAFT',
    automationRoots: true,
    inlineParams: true,
    separateParams: false,
    saveFlag: '--save',
    ext: 'docx'
  },
  deckcraft: {
    label: 'DeckCraft',
    bin: 'deckcraft-cli',
    env: 'SELFIMPULSE_CRAFT_DECKCRAFT',
    automationRoots: true,
    inlineParams: true,
    separateParams: false,
    saveFlag: '--save',
    ext: 'deckcraft'
  },
  cadcraft: {
    label: 'CadCraft',
    bin: 'cadcraft-cli',
    env: 'SELFIMPULSE_CRAFT_CADCRAFT',
    automationRoots: false,
    inlineParams: true,
    separateParams: false,
    saveFlag: '--save',
    ext: 'dxf'
  },
  photocraft: {
    label: 'PhotoCraft',
    bin: 'photocraft-cli',
    env: 'SELFIMPULSE_CRAFT_PHOTOCRAFT',
    automationRoots: false,
    inlineParams: false,
    separateParams: true,
    saveFlag: '--out',
    ext: 'png'
  }
}

export interface CraftCommand {
  id: string
  params?: Record<string, unknown>
}

export interface CraftRunRequest {
  app: string
  input?: string
  commands: CraftCommand[]
  output?: string
}

/** Kept tiny on purpose: these CLIs need the toolchain, not the provider keys. */
function cliEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME']
  const env: NodeJS.ProcessEnv = {}
  for (const key of keep) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

/**
 * Resolve the CLI binary: an explicit override wins, then PATH. Windows
 * resolves `.cmd`/`.exe` shims through PATHEXT, which `existsSync` alone cannot
 * see, so an override is returned as-is and PATH lookups are best-effort.
 */
export function resolveCraftBinary(app: CraftApp): string {
  const override = process.env[app.env]
  if (override && override.trim()) return override.trim()
  return app.bin
}

function commandTokens(app: CraftApp, command: CraftCommand): string[] {
  const params = command.params
  const hasParams = params && Object.keys(params).length > 0
  if (!hasParams) return ['--cmd', command.id]
  if (app.separateParams) return ['--cmd', command.id, '--params', JSON.stringify(params)]
  if (app.inlineParams) return ['--cmd', `${command.id}=${JSON.stringify(params)}`]
  return ['--cmd', command.id]
}

/**
 * Build the argv for a headless run. Pure and exported so the per-app shapes can
 * be tested without any binary installed.
 */
export function buildRunArgs(
  app: CraftApp,
  request: CraftRunRequest,
  paths: { input: string | null; output: string | null; readRoots: string[]; writeRoots: string[] }
): string[] {
  const args: string[] = ['run']
  if (paths.input) args.push(paths.input)
  for (const command of request.commands) args.push(...commandTokens(app, command))
  if (app.automationRoots) {
    for (const root of paths.readRoots) args.push('--automation-read-root', root)
    for (const root of paths.writeRoots) args.push('--automation-write-root', root)
  }
  if (paths.output) args.push(app.saveFlag, paths.output)
  return args
}

function runCli(
  bin: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number }
): Promise<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((done) => {
    execFile(
      bin,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: cliEnv()
      },
      (error, stdout, stderr) => {
        const timedOut = Boolean(error && (error as { killed?: boolean }).killed)
        done({
          ok: !error,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut
        })
      }
    )
  })
}

function missingBinaryMessage(app: CraftApp): string {
  return (
    `${app.label}'s command-line tool (${app.bin}) is not on PATH. ` +
    `Install ${app.label} from github.com/storytold/${app.bin.replace(/-cli$/, '')}, ` +
    `or set ${app.env} to the full path of the executable.`
  )
}

export const craftCommandsTool = defineTool({
  name: 'craft_commands',
  title: 'List craft commands',
  description:
    'List the commands a Craft app exposes, optionally filtered by search text. Every Craft app publishes its whole feature surface as commands; call this before craft_run to find the exact command id and its parameters.',
  schema: z.object({
    app: z.enum(Object.keys(CRAFT_APPS) as [string, ...string[]]),
    search: z.string().max(80).optional().describe('Filter, for example "chart" or "format."')
  }),
  sideEffect: 'read',
  execute: async (args) => {
    const app = CRAFT_APPS[args.app]
    const bin = resolveCraftBinary(app)
    const argv = ['commands']
    if (args.search) argv.push('--search', args.search)
    try {
      const result = await runCli(bin, argv, { timeoutMs: 30_000 })
      if (!result.ok) {
        const detail = (result.stderr || result.stdout).trim()
        return {
          content: detail || missingBinaryMessage(app),
          isError: true
        }
      }
      return { content: truncate(result.stdout.trim() || '(no commands reported)', 20_000) }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `${CRAFT_APPS[args.app].label} commands${args.search ? `: ${args.search}` : ''}`
})

export const craftRunTool = defineTool({
  name: 'craft_run',
  title: 'Run craft commands',
  description:
    'Run commands headlessly in a Craft app (spreadsheet, word processor, presentations, CAD, photo editor) and save the result. Pass an input document and/or an output path inside the task workspace. The app must be installed; use craft_commands first to discover command ids.',
  schema: z.object({
    app: z.enum(Object.keys(CRAFT_APPS) as [string, ...string[]]),
    input: z.string().optional().describe('Existing document to open, relative to the workspace.'),
    commands: z
      .array(
        z.object({
          id: z.string().min(1).describe('Command id, for example "format.bold" or "slide.new".'),
          params: z.record(z.string(), z.unknown()).optional().describe('JSON parameters for the command.')
        })
      )
      .min(1)
      .max(50),
    output: z.string().optional().describe('Where to save the result, relative to the workspace.')
  }),
  sideEffect: 'write',
  risk: 'high',
  approval: 'always',
  execute: async (args, ctx) => {
    const app = CRAFT_APPS[args.app]
    try {
      const input = args.input
        ? await resolveSafePath(ctx.roots, args.input, { mode: 'read' })
        : null
      const output = args.output
        ? await resolveSafePath(ctx.roots, args.output, { mode: 'write' })
        : null
      if (!input && !output) {
        return { content: 'Give at least an input document or an output path.', isError: true }
      }
      if (output) {
        await fs.mkdir(join(output, '..'), { recursive: true })
      }

      const argv = buildRunArgs(app, args as CraftRunRequest, {
        input,
        output,
        readRoots: ctx.roots,
        writeRoots: ctx.roots
      })
      const result = await runCli(resolveCraftBinary(app), argv, {
        cwd: ctx.workspace,
        timeoutMs: 180_000
      })

      if (result.timedOut) {
        return { content: `${app.label} did not finish within 180s.`, isError: true }
      }
      if (!result.ok) {
        const detail = (result.stderr || result.stdout).trim()
        return {
          content: `${app.label} refused the run.\n${truncate(detail || missingBinaryMessage(app), 8000)}`,
          isError: true
        }
      }

      const notes: string[] = []
      if (output) {
        const written = await fs.stat(output).then(() => true).catch(() => false)
        if (!written) {
          return {
            content: `${app.label} reported success but wrote no file to ${args.output}.`,
            isError: true
          }
        }
        await ctx.addArtifact(output)
        notes.push(`Saved ${args.output} (${(await fs.stat(output)).size} bytes).`)
      }
      const stdout = result.stdout.trim()
      if (stdout) notes.push(truncate(stdout, 8000))
      return { content: notes.join('\n\n') || `${app.label} finished.` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) =>
    `${CRAFT_APPS[args.app].label}: ${args.commands.map((command) => command.id).join(', ')}`
})

export const craftTools = [craftCommandsTool, craftRunTool]

/** True when at least one Craft CLI is reachable, so the tool pack can advertise itself honestly. */
export function anyCraftBinaryPresent(): boolean {
  return Object.values(CRAFT_APPS).some((app) => {
    const bin = resolveCraftBinary(app)
    if (bin !== app.bin) return existsSync(bin)
    const path = process.env.PATH ?? process.env.Path ?? ''
    return path.split(';').some((dir) => dir && existsSync(join(dir, app.bin)))
  })
}
