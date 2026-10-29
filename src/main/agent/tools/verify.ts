import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ToolContext } from './types'
import { defineTool, toolResultError } from './types'
import { spawnAudited } from './shell'
import { resolveSafePath } from '../../security'
import { truncate } from '../../util'

/**
 * The agent could edit files and declare success without any evidence. This tool
 * asks a project how it verifies itself — by reading the manifests that are really
 * on disk — runs exactly that, and reports the verdict with the failing tail.
 * Two rules carried over from the mission checker that nothing ever imported:
 * a check that could not run is *not* a failed check, and a check the project
 * does not have is never invented.
 */

export type CheckCategory = 'typecheck' | 'tests'

export interface ProcessRequest {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
}

export interface ProcessOutcome {
  stdout: string
  stderr: string
  /** Null when the process never reported one — killed, signalled or refused. */
  exitCode: number | null
  timedOut: boolean
}

export type ProcessRunner = (request: ProcessRequest) => Promise<ProcessOutcome>

export interface ProjectCheck {
  category: CheckCategory
  label: string
  command: string
  args: string[]
  timeoutSeconds: number
  /** The manifest entry this came from: the proof the check is real. */
  from: string
  /** npm-family checks are meaningless with no dependencies installed. */
  needsNodeModules: boolean
}

interface CheckReport {
  check: ProjectCheck
  ran: boolean
  reason?: string
  exitCode?: number | null
  timedOut?: boolean
  tail?: string
  seconds?: number
  budgetSeconds: number
}

/** Every token this tool can put on a command line, and nothing shell-shaped. */
const SAFE_TOKEN = /^[A-Za-z0-9_@:./+-]{1,64}$/
const TYPECHECK_SCRIPTS = ['typecheck', 'type-check', 'tsc']
const TEST_SCRIPTS = ['test', 'test:unit', 'test:run']
const DEFAULT_TIMEOUT: Record<CheckCategory, number> = { typecheck: 240, tests: 600 }
const OUTPUT_CAP = 20000

function checkEnv(): NodeJS.ProcessEnv {
  /* The same allowlist run_command runs with; shell.ts keeps its copy private
   * and this tool must stay independently importable. */
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
  env.NO_COLOR = '1'
  return env
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export const runProjectCommand: ProcessRunner = async ({ command, args, cwd, timeoutMs }) => {
  const line = [command, ...args]
  if (!line.every((token) => SAFE_TOKEN.test(token))) {
    return {
      stdout: '',
      stderr: `Refused: "${line.join(' ')}" is not a plain command line.`,
      exitCode: null,
      timedOut: false
    }
  }
  try {
    const result = await spawnAudited(line.join(' '), cwd, {
      timeout: timeoutMs,
      env: checkEnv()
    })
    return { stdout: asText(result.stdout), stderr: asText(result.stderr), exitCode: 0, timedOut: false }
  } catch (error) {
    const failure = error as Error & {
      code?: number | string
      stdout?: string
      stderr?: string
      killed?: boolean
    }
    return {
      stdout: asText(failure.stdout),
      stderr: asText(failure.stderr),
      exitCode: typeof failure.code === 'number' ? failure.code : null,
      timedOut: Boolean(failure.killed)
    }
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function hasEntry(dir: string, name: string): Promise<boolean> {
  try {
    await fs.stat(join(dir, name))
    return true
  } catch {
    return false
  }
}

async function findEntry(dir: string, pattern: RegExp): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir)
    return entries.find((entry) => pattern.test(entry)) ?? null
  } catch {
    return null
  }
}

function manifestSection(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function pickScript(scripts: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const body = scripts[name]
    if (typeof body !== 'string' || !body.trim()) continue
    /* The stub `npm init` writes exits 1 by design; running it would be
     * reported as a failing test suite that never existed. */
    if (/no test specified/i.test(body)) continue
    if (name.startsWith('-') || !SAFE_TOKEN.test(name)) continue
    return name
  }
  return null
}

export async function discoverChecks(
  dir: string,
  kind: 'auto' | CheckCategory = 'auto'
): Promise<ProjectCheck[]> {
  const found: ProjectCheck[] = []
  const add = (check: ProjectCheck) => {
    if (kind !== 'auto' && check.category !== kind) return
    const key = `${check.category}|${check.command} ${check.args.join(' ')}`
    if (found.some((c) => `${c.category}|${c.command} ${c.args.join(' ')}` === key)) return
    found.push(check)
  }

  const rawManifest = await readText(join(dir, 'package.json'))
  if (rawManifest) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawManifest)
    } catch {
      parsed = undefined
    }
    if (parsed && typeof parsed === 'object') {
      const manifest = parsed as Record<string, unknown>
      const scripts = manifestSection(manifest.scripts)
      const deps = { ...manifestSection(manifest.dependencies), ...manifestSection(manifest.devDependencies) }

      const typecheckScript = pickScript(scripts, TYPECHECK_SCRIPTS)
      if (typecheckScript) {
        add({
          category: 'typecheck',
          label: 'Typecheck',
          command: 'npm',
          args: ['run', typecheckScript],
          timeoutSeconds: DEFAULT_TIMEOUT.typecheck,
          from: `package.json scripts.${typecheckScript}`,
          needsNodeModules: true
        })
      } else if (deps.typescript && (await hasEntry(dir, 'tsconfig.json'))) {
        add({
          category: 'typecheck',
          label: 'Typecheck',
          command: 'npx',
          args: ['tsc', '--noEmit'],
          timeoutSeconds: DEFAULT_TIMEOUT.typecheck,
          from: 'package.json typescript dependency + tsconfig.json',
          needsNodeModules: true
        })
      }

      const testScript = pickScript(scripts, TEST_SCRIPTS)
      if (testScript) {
        add({
          category: 'tests',
          label: 'Test suite',
          command: 'npm',
          args: ['run', testScript],
          timeoutSeconds: DEFAULT_TIMEOUT.tests,
          from: `package.json scripts.${testScript}`,
          needsNodeModules: true
        })
      } else if (deps.vitest) {
        const config = await findEntry(dir, /^vitest\.config\.[a-z]+$/)
        if (config) {
          add({
            category: 'tests',
            label: 'Test suite',
            command: 'npx',
            args: ['vitest', 'run'],
            timeoutSeconds: DEFAULT_TIMEOUT.tests,
            from: config,
            needsNodeModules: true
          })
        }
      }
    }
  }

  const pyproject = await readText(join(dir, 'pyproject.toml'))
  const hasPytest = (await hasEntry(dir, 'pytest.ini')) || Boolean(pyproject && /\bpytest\b/.test(pyproject))
  if (hasPytest) {
    add({
      category: 'tests',
      label: 'Test suite',
      command: process.platform === 'win32' ? 'python' : 'python3',
      args: ['-m', 'pytest', '-q'],
      timeoutSeconds: DEFAULT_TIMEOUT.tests,
      from: 'pytest.ini / pyproject.toml',
      needsNodeModules: false
    })
  }

  if (await hasEntry(dir, 'go.mod')) {
    add({
      category: 'typecheck',
      label: 'Typecheck',
      command: 'go',
      args: ['build', './...'],
      timeoutSeconds: DEFAULT_TIMEOUT.typecheck,
      from: 'go.mod',
      needsNodeModules: false
    })
    add({
      category: 'tests',
      label: 'Test suite',
      command: 'go',
      args: ['test', './...'],
      timeoutSeconds: DEFAULT_TIMEOUT.tests,
      from: 'go.mod',
      needsNodeModules: false
    })
  }

  if (await hasEntry(dir, 'Cargo.toml')) {
    add({
      category: 'typecheck',
      label: 'Typecheck',
      command: 'cargo',
      args: ['check', '--all-targets'],
      timeoutSeconds: 600,
      from: 'Cargo.toml',
      needsNodeModules: false
    })
    add({
      category: 'tests',
      label: 'Test suite',
      command: 'cargo',
      args: ['test'],
      timeoutSeconds: 600,
      from: 'Cargo.toml',
      needsNodeModules: false
    })
  }

  return found
}

function commandLine(check: ProjectCheck): string {
  return [check.command, ...check.args].join(' ')
}

function failureTail(outcome: ProcessOutcome): string {
  const combined = [outcome.stdout, outcome.stderr].filter((part) => part && part.trim()).join('\n')
  const lines = combined
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
  return truncate(lines.slice(-12).join('\n'), 3000)
}

async function runOneCheck(
  check: ProjectCheck,
  dir: string,
  run: ProcessRunner,
  timeoutOverride?: number
): Promise<CheckReport> {
  const budgetSeconds = timeoutOverride ?? check.timeoutSeconds
  if (check.needsNodeModules && !(await hasEntry(dir, 'node_modules'))) {
    return {
      check,
      ran: false,
      budgetSeconds,
      reason: 'dependencies are not installed, and nothing was installed on your behalf'
    }
  }
  const started = Date.now()
  let outcome: ProcessOutcome
  try {
    outcome = await run({ command: check.command, args: check.args, cwd: dir, timeoutMs: budgetSeconds * 1000 })
  } catch (error) {
    return {
      check,
      ran: false,
      budgetSeconds,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
  const passed = !outcome.timedOut && outcome.exitCode === 0
  return {
    check,
    ran: true,
    budgetSeconds,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    seconds: Math.round(((Date.now() - started) / 1000) * 10) / 10,
    tail: passed ? undefined : failureTail(outcome)
  }
}

function indent(value: string): string {
  return value
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n')
}

function formatVerdict(dir: string, reports: CheckReport[]): string {
  const failed = reports.filter((r) => r.ran && (r.timedOut || r.exitCode !== 0)).length
  const passed = reports.length - failed - reports.filter((r) => !r.ran).length

  const lines: string[] = [`Project checks — ${dir}`, '']
  for (const report of reports) {
    const { check } = report
    if (!report.ran) {
      lines.push(`NOT RUN · ${check.label} · ${commandLine(check)}`)
      lines.push(`  ${report.reason}`)
      lines.push('')
      continue
    }
    const status = report.timedOut ? 'TIMEOUT' : report.exitCode === 0 ? 'PASS' : 'FAIL'
    lines.push(`${status} · ${check.label} · ${commandLine(check)}`)
    lines.push(
      `  from ${check.from} · ${report.seconds}s · ${
        report.timedOut ? `timed out after ${report.budgetSeconds}s` : `exit code ${report.exitCode ?? 'unknown'}`
      }`
    )
    if (status !== 'PASS' && report.tail) {
      lines.push('  last lines of output:')
      lines.push(indent(report.tail))
    }
    lines.push('')
  }

  let verdict: string
  if (failed > 0) verdict = `Verdict: FAIL — ${failed} of ${reports.length} checks failed.`
  else if (passed === 0)
    verdict = `Verdict: NOT MEASURED — no check actually ran; that is not a pass.`
  else if (reports.length > passed)
    verdict = `Verdict: PARTIAL — ${passed} passed, ${reports.length - passed} could not run.`
  else verdict = `Verdict: PASS — ${passed} check${passed === 1 ? '' : 's'} passed.`

  lines.push(verdict)
  return truncate(lines.join('\n').trim(), OUTPUT_CAP)
}

export function createRunChecksTool(run: ProcessRunner = runProjectCommand) {
  return defineTool({
    name: 'run_checks',
    title: 'Run project checks',
    description:
      'Run the checks a project already defines for itself — its typecheck and its test suite — and return the verdict with the failing output. Discovery reads the real manifests on disk; nothing is installed and no check is invented. Use this as the evidence before claiming an edit works.',
    schema: z.object({
      path: z
        .string()
        .optional()
        .describe('Project folder holding the manifests. Defaults to the task workspace and must stay inside a granted folder.'),
      kind: z
        .enum(['auto', 'typecheck', 'tests'])
        .optional()
        .describe('Which checks to run. Default "auto" runs every check the project actually supports.'),
      timeoutSeconds: z
        .number()
        .int()
        .min(1)
        .max(900)
        .optional()
        .describe('Budget per check in seconds (default 240 for typecheck, 600 for tests).')
    }),
    /* Runs the project's own command, so it is an execution, not a read — but the
     * command is never the model's: it is derived from manifests on disk, the path
     * is sandboxed, nothing is installed and nothing is written. That is a far
     * smaller surface than run_command, so it asks under policy instead of always. */
    sideEffect: 'execute',
    risk: 'medium',
    approval: 'policy',
    execute: async (args, ctx) => {
      if (!ctx.allowShell) {
        return {
          content:
            "Project checks run the project's own commands, so they follow the shell permission. Enable it in Settings → Permissions.",
          isError: true
        }
      }
      let dir: string
      try {
        dir = await resolveSafePath(ctx.roots, args.path ?? ctx.workspace, { mode: 'read' })
      } catch (error) {
        return toolResultError(error)
      }
      try {
        const stat = await fs.stat(dir)
        if (!stat.isDirectory()) {
          return { content: 'Run checks against a project folder, not a single file.', isError: true }
        }
      } catch {
        return { content: `No folder to check at ${dir}.`, isError: true }
      }

      const checks = await discoverChecks(dir, args.kind ?? 'auto')
      if (!checks.length) {
        const requested = args.kind === 'typecheck' || args.kind === 'tests' ? args.kind : null
        return {
          content: [
            requested
              ? `No ${requested === 'tests' ? 'test suite' : 'typecheck'} is runnable in ${dir}, so nothing ran.`
              : `Nothing to run — ${dir} defines no check this tool can recognise.`,
            '',
            'Looked for: package.json scripts (typecheck / test), tsconfig.json with the compiler available, vitest config, pytest.ini / pyproject.toml, go.mod, Cargo.toml.',
            'Nothing ran and nothing was invented. If this project verifies itself another way, say so plainly rather than reporting a pass.'
          ].join('\n')
        }
      }

      const reports: CheckReport[] = []
      for (const check of checks) {
        reports.push(await runOneCheck(check, dir, run, args.timeoutSeconds))
      }
      const failed = reports.some((report) => report.ran && (report.timedOut || report.exitCode !== 0))
      return { content: formatVerdict(dir, reports), isError: failed || undefined }
    },
    summarize: (args) => {
      const scope = args.path ? ` in ${args.path}` : ''
      if (args.kind === 'typecheck') return `Run the project's typecheck${scope}`
      if (args.kind === 'tests') return `Run the project's test suite${scope}`
      return `Run the project's own typecheck and test suite, whichever it has${scope}`
    }
  })
}

export const runChecksTool = createRunChecksTool()

export const verifyTools = [runChecksTool]
