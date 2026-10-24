import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ToolContext } from './types'
import { defineTool, toolResultError } from './types'
import { resolveSafePath } from '../../security'
import { truncate } from '../../util'

/**
 * THE STUDIO — fourteen desktop engines driven headlessly, under our own names.
 *
 * Each upstream app publishes its whole feature surface as commands in one
 * registry and ships a `{name}-cli` binary that runs them without a GUI. We call
 * that binary directly: no MCP hop, no JSON-RPC handshake, one process per run.
 *
 * The internal ids are Greek and deliberately ours. The upstream projects are
 * MIT OR Apache-2.0, which permits rebranding, but their names and marks are
 * not ours to use — PdfCraft states plainly that its trademarks are excluded
 * from the licence. So the alias is the product name and `upstream` exists only
 * to attribute the work and to name the download in an error message.
 * See docs/third-party-notices.md.
 *
 * The binaries keep their real names. Renaming an executable we did not build
 * would be a lie to the filesystem and would break the app's own resources.
 */

export interface StudioApp {
  /** The name we ship. */
  label: string
  /** The Greek word behind it, for the UI. */
  greek: string
  /** What it does, in three words. */
  role: string
  /** Attribution only — never shown as our product name. */
  upstream: string
  /** GitHub repository under github.com/storytold. */
  repo: string
  /** Binary name on PATH. */
  bin: string
  /** Environment variable that overrides the binary path. */
  env: string
  /**
   * `true` when the CLI and its Windows build were confirmed; `false` when the
   * app follows the same architecture but its CLI has not been checked.
   */
  verified: boolean
}

export const STUDIO_APPS: Record<string, StudioApp> = {
  techne: { label: 'Techne', greek: 'τέχνη', role: 'generative canvas', upstream: 'ArtCraft', repo: 'artcraft', bin: 'artcraft-cli', env: 'SELFIMPULSE_STUDIO_TECHNE', verified: false },
  agora: { label: 'Agora', greek: 'ἀγορά', role: 'app launcher', upstream: 'ArtCraft Launcher', repo: 'craft-launcher', bin: 'craft-launcher-cli', env: 'SELFIMPULSE_STUDIO_AGORA', verified: false },
  eikon: { label: 'Eikon', greek: 'εἰκών', role: 'raster image editor', upstream: 'PhotoCraft', repo: 'photocraft', bin: 'photocraft-cli', env: 'SELFIMPULSE_STUDIO_EIKON', verified: true },
  phos: { label: 'Phos', greek: 'φῶς', role: 'photo workflow', upstream: 'LightCraft', repo: 'lightcraft', bin: 'lightcraft-cli', env: 'SELFIMPULSE_STUDIO_PHOS', verified: false },
  kinema: { label: 'Kinema', greek: 'κίνημα', role: 'video editor', upstream: 'FilmCraft', repo: 'filmcraft', bin: 'filmcraft-cli', env: 'SELFIMPULSE_STUDIO_KINEMA', verified: false },
  schema: { label: 'Schema', greek: 'σχῆμα', role: 'page layout', upstream: 'DesignCraft', repo: 'designcraft', bin: 'designcraft-cli', env: 'SELFIMPULSE_STUDIO_SCHEMA', verified: false },
  gramme: { label: 'Gramme', greek: 'γραμμή', role: 'vector illustration', upstream: 'VectorCraft', repo: 'vectorcraft', bin: 'vectorcraft-cli', env: 'SELFIMPULSE_STUDIO_GRAMME', verified: true },
  chartes: { label: 'Chartes', greek: 'χάρτης', role: 'document and forms', upstream: 'PdfCraft', repo: 'pdfcraft', bin: 'pdfcraft-cli', env: 'SELFIMPULSE_STUDIO_CHARTES', verified: true },
  drama: { label: 'Drama', greek: 'δρᾶμα', role: 'motion and effects', upstream: 'EffectCraft', repo: 'effectcraft', bin: 'effectcraft-cli', env: 'SELFIMPULSE_STUDIO_DRAMA', verified: false },
  logos: { label: 'Logos', greek: 'λόγος', role: 'word processor', upstream: 'WordCraft', repo: 'wordcraft', bin: 'wordcraft-cli', env: 'SELFIMPULSE_STUDIO_LOGOS', verified: true },
  skene: { label: 'Skene', greek: 'σκηνή', role: 'presentations', upstream: 'DeckCraft', repo: 'deckcraft', bin: 'deckcraft-cli', env: 'SELFIMPULSE_STUDIO_SKENE', verified: true },
  pinax: { label: 'Pinax', greek: 'πίναξ', role: 'spreadsheet', upstream: 'GridCraft', repo: 'gridcraft', bin: 'gridcraft-cli', env: 'SELFIMPULSE_STUDIO_PINAX', verified: true },
  techton: { label: 'Techton', greek: 'τέκτων', role: 'CAD and drafting', upstream: 'CADCraft', repo: 'cadcraft', bin: 'cadcraft-cli', env: 'SELFIMPULSE_STUDIO_TECHTON', verified: true },
  echo: { label: 'Echo', greek: 'ἠχώ', role: 'audio production', upstream: 'SoundCraft', repo: 'soundcraft', bin: 'soundcraft-cli', env: 'SELFIMPULSE_STUDIO_ECHO', verified: false },
  eidos: { label: 'Eidos', greek: 'εἶδος', role: 'interface design', upstream: 'FigCraft', repo: 'figcraft', bin: 'figcraft-cli', env: 'SELFIMPULSE_STUDIO_EIDOS', verified: false }
}

export type StudioAppId = keyof typeof STUDIO_APPS

export interface StudioCommand {
  id: string
  params?: Record<string, unknown>
}

export interface StudioRunRequest {
  app: string
  input?: string
  commands: StudioCommand[]
  output?: string
}

/** How each CLI wants its arguments. They are genuinely not uniform. */
export type CliShape = 'inline' | 'separate' | 'keyvalue' | 'export-only'

/**
 * Upstream CLI conventions, as confirmed from each project's README.
 * `export-only` means the CLI cannot express a command list at all: Gramme's
 * binary only does `run --in … --export …`, and its command API lives behind
 * the control channel, so we say so rather than invent arguments.
 */
export const CLI_SHAPE: Record<string, CliShape> = {
  pinax: 'inline',
  logos: 'inline',
  skene: 'inline',
  techton: 'inline',
  eikon: 'separate',
  chartes: 'keyvalue',
  gramme: 'export-only',
  techne: 'inline',
  agora: 'inline',
  phos: 'inline',
  kinema: 'inline',
  schema: 'inline',
  drama: 'inline',
  echo: 'inline',
  eidos: 'inline'
}

/** Apps whose CLI accepts `--automation-read-root` / `--automation-write-root`. */
const AUTOMATION_ROOTS = new Set(['logos', 'skene'])

/** Apps whose CLI accepts `--root` to confine all file access. */
const ROOT_CONFINED = new Set(['chartes'])

const DOC_FLAG: Record<string, '--save' | '--out' | '--export'> = {
  pinax: '--out',
  logos: '--save',
  skene: '--save',
  techton: '--save',
  eikon: '--out',
  chartes: '--out',
  gramme: '--export'
}

function cliEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME']
  const env: NodeJS.ProcessEnv = {}
  for (const key of keep) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

export function resolveStudioBinary(app: StudioApp): string {
  const override = process.env[app.env]
  if (override && override.trim()) return override.trim()
  return app.bin
}

/** The argv that lists an app's command registry. */
export function buildListArgs(appId: string, search?: string): string[] {
  const shape = CLI_SHAPE[appId]
  if (shape === 'keyvalue') {
    // Chartes publishes its table as JSON-Schema tools rather than command ids.
    return ['tools']
  }
  if (shape === 'export-only') return ['run', '--help']
  const args = ['commands']
  if (search) args.push('--search', search)
  return args
}

function commandTokens(shape: CliShape, command: StudioCommand): string[] {
  const params = command.params
  const hasParams = Boolean(params && Object.keys(params).length > 0)
  if (shape === 'separate') {
    if (!hasParams) return ['--cmd', command.id]
    return ['--cmd', command.id, '--params', JSON.stringify(params)]
  }
  if (shape === 'keyvalue') {
    // Chartes: `run tool key=value …`, where values parse as JSON.
    const pairs = Object.entries(params ?? {}).map(([key, value]) => [
      `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`
    ])
    return [command.id, ...pairs.flat()]
  }
  if (!hasParams) return ['--cmd', command.id]
  return ['--cmd', `${command.id}=${JSON.stringify(params)}`]
}

/**
 * Build argv for a headless run. Pure and exported so every CLI shape can be
 * tested without a single binary installed.
 *
 * Returns a string when the app's CLI cannot express the request, so the tool
 * can explain itself instead of spawning something that will fail obscurely.
 */
export function buildRunArgs(
  appId: string,
  request: StudioRunRequest,
  paths: { input: string | null; output: string | null; roots: string[] }
): string[] | string {
  const app = STUDIO_APPS[appId]
  if (!app) return `Unknown studio app: ${appId}.`
  const shape = CLI_SHAPE[appId]

  if (shape === 'export-only') {
    return (
      `${app.label} (${app.upstream}) does not expose a command list on its CLI — ` +
      'it only converts and exports. Drive it through its control channel instead.'
    )
  }

  const args: string[] = ['run']
  if (paths.input) args.push(paths.input)

  if (shape === 'keyvalue') {
    // Chartes takes one tool per invocation, not a chain.
    if (request.commands.length > 1) {
      return `${app.label} runs one tool per invocation; send a single command.`
    }
    args.push(...commandTokens(shape, request.commands[0]))
  } else {
    for (const command of request.commands) args.push(...commandTokens(shape, command))
  }

  if (AUTOMATION_ROOTS.has(appId)) {
    for (const root of paths.roots) args.push('--automation-read-root', root)
    for (const root of paths.roots) args.push('--automation-write-root', root)
  }
  if (ROOT_CONFINED.has(appId) && paths.roots.length) {
    args.push('--root', paths.roots[0])
  }
  if (paths.output) args.push(DOC_FLAG[appId] ?? '--out', paths.output)
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
      { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: cliEnv() },
      (error, stdout, stderr) => {
        done({
          ok: !error,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut: Boolean(error && (error as { killed?: boolean }).killed)
        })
      }
    )
  })
}

function missingBinary(app: StudioApp): string {
  const base = `${app.label} (${app.upstream}) needs ${app.bin} on PATH, or set ${app.env} to its full path.`
  if (!app.verified) {
    return `${base} This app's command-line tool has not been confirmed to ship yet — check github.com/storytold/${app.repo} before relying on it.`
  }
  return `${base} Install it from github.com/storytold/${app.repo}.`
}

function describeApps(): string {
  return Object.entries(STUDIO_APPS)
    .map(([id, app]) => `${id} — ${app.label} (${app.greek}), ${app.role}${app.verified ? '' : ', unverified'}`)
    .join('\n')
}

export const studioCommandsTool = defineTool({
  name: 'studio_commands',
  title: 'List studio commands',
  description:
    'List the commands one of the Studio desktop engines exposes, optionally filtered. Every engine publishes its whole feature surface as commands; call this before studio_run to find the exact command id and its parameters. Call with no app to list all engines.',
  schema: z.object({
    app: z.string().optional().describe('Engine id, for example "pinax". Omit to list every engine.'),
    search: z.string().max(80).optional().describe('Filter, for example "chart" or "format."')
  }),
  /* This tool SPAWNS an external binary (execFile, no shell) to ask it for
   * its registry. "Listing" describes the output, not the effect: the same
   * process could do anything, so it is classified exactly like studio_run —
   * execute / high / always-approval. That makes it acquire the shell.exec
   * capability, mint signed receipts and reach a human, instead of slipping
   * past the receipt barrier as a "read". */
  sideEffect: 'execute',
  risk: 'high',
  approval: 'always',
  execute: async (args) => {
    if (!args.app) return { content: describeApps() }
    const app = STUDIO_APPS[args.app]
    if (!app) return { content: `Unknown engine "${args.app}".\n\n${describeApps()}`, isError: true }
    try {
      const result = await runCli(resolveStudioBinary(app), buildListArgs(args.app, args.search), {
        timeoutMs: 30_000
      })
      if (!result.ok) {
        const detail = (result.stderr || result.stdout).trim()
        return { content: detail || missingBinary(app), isError: true }
      }
      return { content: truncate(result.stdout.trim() || '(no commands reported)', 20_000) }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => (args.app ? `${STUDIO_APPS[args.app]?.label ?? args.app} commands` : 'Studio engines')
})

export const studioRunTool = defineTool({
  name: 'studio_run',
  title: 'Run studio commands',
  description:
    'Run commands headlessly in a Studio desktop engine (spreadsheet, word processor, presentations, CAD, PDF, image, vector) and save the result. Give an input document, an output path, or both, inside the task workspace. Use studio_commands first to discover command ids.',
  schema: z.object({
    app: z.string().describe('Engine id, for example "pinax" for spreadsheets.'),
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
    const app = STUDIO_APPS[args.app]
    if (!app) return { content: `Unknown engine "${args.app}".\n\n${describeApps()}`, isError: true }
    try {
      const input = args.input ? await resolveSafePath(ctx.roots, args.input, { mode: 'read' }) : null
      const output = args.output ? await resolveSafePath(ctx.roots, args.output, { mode: 'write' }) : null
      if (!input && !output) {
        return { content: 'Give at least an input document or an output path.', isError: true }
      }
      if (output) await fs.mkdir(join(output, '..'), { recursive: true })

      const argv = buildRunArgs(args.app, args as StudioRunRequest, {
        input,
        output,
        roots: ctx.roots
      })
      if (typeof argv === 'string') return { content: argv, isError: true }

      const result = await runCli(resolveStudioBinary(app), argv, {
        cwd: ctx.workspace,
        timeoutMs: 180_000
      })

      if (result.timedOut) return { content: `${app.label} did not finish within 180s.`, isError: true }
      if (!result.ok) {
        const detail = (result.stderr || result.stdout).trim()
        return {
          content: `${app.label} refused the run.\n${truncate(detail || missingBinary(app), 8000)}`,
          isError: true
        }
      }

      const notes: string[] = []
      if (output) {
        const stat = await fs.stat(output).catch(() => null)
        if (!stat) {
          return { content: `${app.label} reported success but wrote no file to ${args.output}.`, isError: true }
        }
        await ctx.addArtifact(output)
        notes.push(`Saved ${args.output} (${stat.size} bytes).`)
      }
      const stdout = result.stdout.trim()
      if (stdout) notes.push(truncate(stdout, 8000))
      return { content: notes.join('\n\n') || `${app.label} finished.` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `${STUDIO_APPS[args.app]?.label ?? args.app}: ${args.commands.map((c) => c.id).join(', ')}`
})

export const studioTools = [studioCommandsTool, studioRunTool]

export type StudioToolContext = ToolContext
