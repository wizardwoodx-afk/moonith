/**
 * Discovery is where the bugs are: a checker that invents a check, or reports
 * "could not run" as "failed", teaches the agent to lie about its own work.
 * These tests run against real manifests in real temp folders and mock only the
 * process runner, so every assertion is about what was chosen and why.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolContext } from './types'
import { createRunChecksTool, runProjectCommand, type ProcessOutcome, type ProcessRequest, type ProcessRunner } from './verify'
import { requiresReceipt } from '../../sphragis/schema'
import { capabilityForTool } from '../../nomos/policy'
import { isAllowedInPlanMode } from './types'

const created: string[] = []

afterAll(async () => {
  for (const dir of created) {
    /* The shell runner kills its own child, so a timed-out process can hold its
     * working folder on Windows for a moment. Retry rather than leak it. */
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch {
        await new Promise((wait) => setTimeout(wait, 600))
      }
    }
  }
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'si-verify-'))
  created.push(dir)
  return dir
}

function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

function depsInstalled(dir: string): void {
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
}

function contextIn(dir: string): ToolContext {
  return {
    roots: [dir],
    readRoots: [dir],
    workspace: dir,
    task: {} as never,
    allowShell: true,
    addArtifact: async () => null,
    setBrowser: () => undefined,
    setPlan: () => undefined,
    toast: () => undefined
  } as unknown as ToolContext
}

const PASSED: ProcessOutcome = { stdout: '', stderr: '', exitCode: 0, timedOut: false }

function harness(outcome: (request: ProcessRequest) => ProcessOutcome = () => PASSED) {
  const calls: ProcessRequest[] = []
  const run: ProcessRunner = async (request) => {
    calls.push(request)
    return outcome(request)
  }
  return { calls, run }
}

describe('check discovery', () => {
  it('runs a declared typecheck without claiming a test suite exists', async () => {
    const dir = tempProject()
    writeManifest(dir, { scripts: { typecheck: 'tsc -p tsconfig.node.json --noEmit' } })
    depsInstalled(dir)
    const { calls, run } = harness()

    const result = await createRunChecksTool(run).execute({}, contextIn(dir))

    expect(calls.map((call) => [call.command, ...call.args].join(' '))).toEqual(['npm run typecheck'])
    expect(result.content).toContain('Typecheck')
    expect(result.content).not.toContain('Test suite')
    expect(result.content).toContain('Verdict: PASS')
    expect(result.isError).toBeFalsy()
  })

  it('selects both checks when the project defines both', async () => {
    const dir = tempProject()
    writeManifest(dir, { scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' } })
    writeFileSync(join(dir, 'vitest.config.ts'), 'export default {}', 'utf8')
    depsInstalled(dir)
    const { calls, run } = harness()

    await createRunChecksTool(run).execute({}, contextIn(dir))

    expect(calls.map((call) => [call.command, ...call.args].join(' '))).toEqual([
      'npm run typecheck',
      'npm run test'
    ])
  })

  it('falls back to the config file when the test script is missing but the runner is a dependency', async () => {
    const dir = tempProject()
    writeManifest(dir, {
      scripts: { typecheck: 'tsc --noEmit' },
      devDependencies: { vitest: '^5.0.0' }
    })
    writeFileSync(join(dir, 'vitest.config.mts'), 'export default {}', 'utf8')
    depsInstalled(dir)
    const { calls, run } = harness()

    const result = await createRunChecksTool(run).execute({}, contextIn(dir))

    expect(calls.map((call) => [call.command, ...call.args].join(' '))).toEqual([
      'npm run typecheck',
      'npx vitest run'
    ])
    expect(result.content).toContain('Verdict: PASS — 2 checks passed.')
  })

  it('treats the package-manager stub as no test suite at all', async () => {
    const dir = tempProject()
    writeManifest(dir, { scripts: { test: 'echo "Error: no test specified" && exit 1' } })
    depsInstalled(dir)
    const { calls, run } = harness()

    const result = await createRunChecksTool(run).execute({}, contextIn(dir))

    expect(calls).toHaveLength(0)
    expect(result.content).toContain('Nothing to run')
    expect(result.isError).toBeFalsy()
  })

  it('uses the compiler itself when only tsconfig.json and the dependency prove it can run', async () => {
    const dir = tempProject()
    writeManifest(dir, { devDependencies: { typescript: '^5.9.0' } })
    writeFileSync(join(dir, 'tsconfig.json'), '{}', 'utf8')
    depsInstalled(dir)
    const { calls, run } = harness()

    await createRunChecksTool(run).execute({}, contextIn(dir))

    expect(calls).toHaveLength(1)
    expect([calls[0].command, ...calls[0].args].join(' ')).toBe('npx tsc --noEmit')
  })

  it('reads a rust project without needing node_modules', async () => {
    const dir = tempProject()
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x"\n', 'utf8')
    const { calls, run } = harness()

    await createRunChecksTool(run).execute({}, contextIn(dir))

    expect(calls.map((call) => [call.command, ...call.args].join(' '))).toEqual([
      'cargo check --all-targets',
      'cargo test'
    ])
    expect(calls[0].cwd).toBe(dir)
  })

  it('refuses to claim a python check from a manifest that never mentions the runner', async () => {
    const dir = tempProject()
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n', 'utf8')
    const { calls, run } = harness()

    const result = await createRunChecksTool(run).execute({}, contextIn(dir))

    expect(calls).toHaveLength(0)
    expect(result.content).toContain('Nothing to run')
  })

  it('says so plainly when the project has nothing runnable', async () => {
    const dir = tempProject()
    writeFileSync(join(dir, 'README.md'), 'just notes', 'utf8')
    const { calls, run } = harness()

    const result = await createRunChecksTool(run).execute({}, contextIn(dir))

    expect(calls).toHaveLength(0)
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('Nothing to run')
    expect(result.content).toContain('nothing was invented')
  })

  it('names the missing check when only one kind was asked for', async () => {
    const dir = tempProject()
    writeManifest(dir, { scripts: { test: 'vitest run' } })
    depsInstalled(dir)
    const { calls, run } = harness()

    const result = await createRunChecksTool(run).execute({ kind: 'typecheck' }, contextIn(dir))

    expect(calls).toHaveLength(0)
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('No typecheck is runnable')
  })
})

describe('verdict reporting', () => {
  it('surfaces the failing tail and the exit code, never the whole log', async () => {
    const dir = tempProject()
    writeManifest(dir, { scripts: { test: 'vitest run' } })
    depsInstalled(dir)
    const noise = Array.from({ length: 200 }, (_, i) => `noise line ${i}`).join('\n')
    const { run } = harness(() => ({
      stdout: noise,
      stderr: 'expected 2 to be 3',
      exitCode: 1,
      timedOut: false
    }))

    const result = await createRunChecksTool(run).execute({}, contextIn(dir))

    expect(result.isError).toBe(true)
    expect(result.content).toContain('exit code 1')
    expect(result.content).toContain('expected 2 to be 3')
    expect(result.content).toContain('noise line 199')
    expect(result.content).not.toContain('noise line 0')
    expect(result.content).toContain('Verdict: FAIL')
  })

  it('reports a check that could not run as unmeasured rather than failed', async () => {
    const dir = tempProject()
    writeManifest(dir, { scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' } })
    const { calls, run } = harness()

    const result = await createRunChecksTool(run).execute({}, contextIn(dir))

    expect(calls).toHaveLength(0)
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('NOT RUN')
    expect(result.content).toContain('not installed')
    expect(result.content).toContain('not a pass')
    expect(result.content).not.toContain('exit code')
  })

  it('keeps a timeout inside its budget and says which check timed out', async () => {
    const dir = tempProject()
    writeManifest(dir, { scripts: { test: 'vitest run' } })
    depsInstalled(dir)
    const { calls, run } = harness((request) => {
      expect(request.timeoutMs).toBe(45_000)
      return { stdout: '', stderr: '', exitCode: null, timedOut: true }
    })

    const result = await createRunChecksTool(run).execute({ timeoutSeconds: 45 }, contextIn(dir))

    expect(calls).toHaveLength(1)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('TIMEOUT')
    expect(result.content).toContain('timed out after 45s')
    expect(result.content).toContain('Verdict: FAIL')
  })

  it('honours the kind filter', async () => {
    const dir = tempProject()
    writeManifest(dir, { scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' } })
    depsInstalled(dir)
    const { calls, run } = harness()

    await createRunChecksTool(run).execute({ kind: 'tests' }, contextIn(dir))

    expect(calls.map((call) => call.args)).toEqual([['run', 'test']])
  })

  it('survives a runner that throws instead of reporting an exit code', async () => {
    const dir = tempProject()
    writeManifest(dir, { scripts: { test: 'vitest run' } })
    depsInstalled(dir)
    const run: ProcessRunner = async () => {
      throw new Error('the executor exploded')
    }

    const result = await createRunChecksTool(run).execute({}, contextIn(dir))

    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('the executor exploded')
    expect(result.content).toContain('NOT RUN')
  })
})

describe('sandbox and approval contract', () => {
  it('refuses a path outside the folders granted to the task', async () => {
    const dir = tempProject()
    writeManifest(dir, { scripts: { test: 'vitest run' } })
    depsInstalled(dir)
    const outside = tempProject()
    writeManifest(outside, { scripts: { test: 'vitest run' } })
    depsInstalled(outside)
    const { calls, run } = harness()

    const result = await createRunChecksTool(run).execute({ path: outside }, contextIn(dir))

    expect(calls).toHaveLength(0)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('outside the folders granted to this task')
  })

  it('reads only: no file appears in the project and no mutation is claimed', async () => {
    const dir = tempProject()
    writeManifest(dir, { scripts: { typecheck: 'tsc --noEmit' } })
    depsInstalled(dir)
    const before = readdirSync(dir).sort()
    const addArtifact = vi.fn()
    const ctx = { ...contextIn(dir), addArtifact }

    const result = await createRunChecksTool(() => Promise.resolve(PASSED)).execute({}, ctx)

    expect(readdirSync(dir).sort()).toEqual(before)
    expect(addArtifact).not.toHaveBeenCalled()
    expect(result).not.toHaveProperty('mutatedPaths')
  })

  it('follows the shell permission, because a project script is still a command', async () => {
    const dir = tempProject()
    writeManifest(dir, { scripts: { test: 'vitest run' } })
    depsInstalled(dir)
    const { calls, run } = harness()

    const result = await createRunChecksTool(run).execute({}, { ...contextIn(dir), allowShell: false })

    expect(calls).toHaveLength(0)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Settings → Permissions')
  })

  it('is an execution that earns a receipt and never runs unattended in plan mode', () => {
    const tool = createRunChecksTool()
    expect(tool.sideEffect).toBe('execute')
    expect(tool.risk).toBe('medium')
    expect(tool.approval).toBe('policy')
    expect(requiresReceipt({ sideEffect: tool.sideEffect, risk: tool.risk })).toBe(true)
    expect(capabilityForTool(tool.name, tool.sideEffect)).toBe('shell.exec')
    expect(isAllowedInPlanMode(tool)).toBe(false)
    expect(tool.summarize?.({})).toContain("typecheck and test suite")
    expect(tool.title).not.toMatch(/npm|vitest|typescript/i)
  })
})

describe('the real process runner', () => {
  it('kills a process that outruns its budget instead of hanging', async () => {
    const dir = tempProject()
    writeFileSync(join(dir, 'sleeper.js'), 'setTimeout(() => {}, 3000)', 'utf8')
    const started = Date.now()

    const outcome = await runProjectCommand({ command: 'node', args: ['sleeper.js'], cwd: dir, timeoutMs: 800 })

    expect(outcome.timedOut).toBe(true)
    expect(outcome.exitCode).toBeNull()
    expect(Date.now() - started).toBeLessThan(2500)
  })

  it('reports the exit code and stderr of a process that really failed', async () => {
    const dir = tempProject()
    writeFileSync(join(dir, 'boom.js'), 'console.error("it broke"); process.exit(4)', 'utf8')

    const outcome = await runProjectCommand({ command: 'node', args: ['boom.js'], cwd: dir, timeoutMs: 30_000 })

    expect(outcome.timedOut).toBe(false)
    expect(outcome.exitCode).toBe(4)
    expect(outcome.stderr).toContain('it broke')
  })

  it('refuses a command line that is not a plain command name', async () => {
    const outcome = await runProjectCommand({
      command: 'npm',
      args: ['run', 'test && del C:\\'],
      cwd: process.cwd(),
      timeoutMs: 1000
    })

    expect(outcome.exitCode).toBeNull()
    expect(outcome.stderr).toContain('Refused')
  })
})
