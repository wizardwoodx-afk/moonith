import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Task 21 — the backend integration surface is default-deny.
 *
 * `mcp_*`, `connectors_*`, `computer_*` and `grounded_actions` reach outside the
 * workspace (a desktop click, a third-party connector, an MCP server tool), so
 * an unlisted name must be refused before the integration is touched, and the
 * refusal must land on the audit sink the runner already uses (`agent:tool`).
 * A rule that names the tool explicitly still decides, so the user can grant it
 * deliberately — and an `ask` nobody answers stays a no.
 */

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: vi.fn(),
    decryptString: vi.fn()
  },
  shell: { openExternal: vi.fn(async () => undefined), openPath: vi.fn(async () => '') },
  app: {
    getPath: () => {
      throw new Error('the gate test must not touch the real backend root')
    }
  }
}))

import { AgentRunner, type RunnerSettings } from './runner'
import { ToolRuntime, isIntegrationToolName, type ToolPermissions } from './tools'
import { DEFAULT_PERMISSIONS } from './index'
import type { BackendStore } from './store'
import type { Provider } from './provider'

let workspace = ''

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'selfimpulse-gate-'))
  writeFileSync(join(workspace, 'note.txt'), 'hello from the workspace\n', 'utf8')
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

interface Harness {
  runner: AgentRunner
  events: Array<{ event: string; payload: Record<string, unknown> }>
  asked: string[]
  ran: { mcp: string[]; connectors: string[]; computer: string[]; grounded: string[] }
}

/** A runner whose integrations record every call, so a bypass cannot hide. */
function makeRunner(
  permissions: ToolPermissions = {},
  answer: boolean | undefined = undefined
): Harness {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = []
  const asked: string[] = []
  const ran: Harness['ran'] = { mcp: [], connectors: [], computer: [], grounded: [] }

  const settings = {
    systemPrompt: 'test prompt',
    permissions,
    sandbox: true,
    memoryEnabled: false,
    maxIterations: 4,
    maxOutputTokens: 1024,
    temperature: 0,
    tier: 'auto',
    tierConfig: {}
  } as unknown as RunnerSettings

  const runner = new AgentRunner({
    provider: {} as unknown as Provider,
    store: {} as unknown as BackendStore,
    emit: (event: string, payload: unknown) =>
      events.push({ event, payload: (payload ?? {}) as Record<string, unknown> }),
    settings,
    workspace,
    integrations: {
      mcp: {
        // `runner.ts` advertises an MCP tool as `mcp_${sanitized(name)}`, so the
        // callable name of the entry below is `mcp_read_file`.
        listTools: async () => [
          { id: 'filesystem:read_file', name: 'read_file', serverName: 'filesystem' }
        ],
        callTool: async (id: string) => {
          ran.mcp.push(id)
          return { ok: true }
        }
      },
      connectors: {
        connected: true,
        toolDefinitions: async () => [],
        execute: async ({ tool }: { tool: string }) => {
          ran.connectors.push(tool)
          return { ok: true }
        }
      },
      computer: {
        enabled: true,
        invoke: async (name: string) => {
          ran.computer.push(name)
          return { ok: true }
        }
      },
      uitars: {
        enabled: true,
        run: async ({ instruction }: { instruction: string }) => {
          ran.grounded.push(instruction)
          return { ok: true, steps: [], summary: 'clicked' }
        }
      },
      // `undefined` here is the realistic "nobody is answering" case: the
      // broker is absent, so an ask must resolve to a refusal.
      permissions:
        answer === undefined
          ? undefined
          : {
              ask: async (request: { tool?: string }) => {
                asked.push(String(request.tool ?? ''))
                return { allowed: Boolean(answer) }
              }
            }
    }
  })

  return { runner, events, asked, ran }
}

const INTEGRATION_CALLS: Array<{ name: string; label: string }> = [
  { name: 'mcp_filesystem_read_file', label: 'mcp' },
  { name: 'connectors_github_create_issue', label: 'connectors' },
  { name: 'computer_click', label: 'computer' },
  { name: 'grounded_actions', label: 'grounded' }
]

describe('backend integration permission gate', () => {
  it.each(INTEGRATION_CALLS)(
    'refuses $label ($name) when no permission rule was ever set for it',
    async ({ name }) => {
      const { runner, ran } = makeRunner()
      const result = await runner.dispatch(name, {})

      expect(ran.mcp).toEqual([])
      expect(ran.connectors).toEqual([])
      expect(ran.computer).toEqual([])
      expect(ran.grounded).toEqual([])
      expect(result.ok).toBe(false)
      expect(String(result.error ?? '')).toMatch(/permission|blocked/i)
    }
  )

  it('audits the denied call on the event sink the runner already uses', async () => {
    const { runner, events } = makeRunner()
    await runner.dispatch('mcp_filesystem_read_file', {})

    const toolEvents = events.filter((event) => event.event === 'agent:tool')
    expect(toolEvents).toHaveLength(1)
    expect(toolEvents[0].payload.tool).toBe('mcp_filesystem_read_file')
    expect(toolEvents[0].payload.outcome).toBe('denied')
    expect(toolEvents[0].payload.result).toMatchObject({
      ok: false,
      error: 'Tool "mcp_filesystem_read_file" is blocked by the permission rules.'
    })
  })

  it('lets an explicit allow rule grant one integration tool', async () => {
    const { runner, ran } = makeRunner({ mcp_read_file: 'allow' })
    const result = await runner.dispatch('mcp_read_file', {})

    expect(result.ok).toBe(true)
    expect(ran.mcp).toEqual(['filesystem:read_file'])
  })

  it('lets a prefix rule grant the whole surface it names', async () => {
    const { runner, ran } = makeRunner({ 'mcp_*': 'allow' })
    const result = await runner.dispatch('mcp_read_file', {})

    expect(result.ok).toBe(true)
    expect(ran.mcp).toEqual(['filesystem:read_file'])
  })

  it('asks before an integration call the rules mark as ask, and honours the answer', async () => {
    const granted = makeRunner({ computer_click: 'ask' }, true)
    const allowed = await granted.runner.dispatch('computer_click', {})
    expect(allowed.ok).toBe(true)
    expect(granted.ran.computer).toEqual(['computer_click'])
    expect(granted.asked).toEqual(['computer_click'])

    const refused = makeRunner({ computer_click: 'ask' }, false)
    const blocked = await refused.runner.dispatch('computer_click', {})
    expect(blocked.ok).toBe(false)
    expect(String(blocked.error ?? '')).toMatch(/permission|blocked/i)
    expect(refused.ran.computer).toEqual([])
  })

  it('treats an unanswered ask as a refusal, never a silent yes', async () => {
    const { runner, ran } = makeRunner({ grounded_actions: 'ask' })
    const result = await runner.dispatch('grounded_actions', { instruction: 'open notepad' })

    expect(result.ok).toBe(false)
    expect(String(result.error ?? '')).toMatch(/permission|blocked/i)
    expect(ran.grounded).toEqual([])
  })

  it('keeps an explicit deny rule denying, and does not widen the gate past the integrations', () => {
    expect(isIntegrationToolName('mcp_anything')).toBe(true)
    expect(isIntegrationToolName('connectors_anything')).toBe(true)
    expect(isIntegrationToolName('computer_click')).toBe(true)
    expect(isIntegrationToolName('grounded_actions')).toBe(true)
    expect(isIntegrationToolName('read_file')).toBe(false)
    expect(isIntegrationToolName('run_command')).toBe(false)
    expect(isIntegrationToolName('finish')).toBe(false)
  })

  it('leaves the user-facing workspace tools allowed and run_command asking', async () => {
    const runtime = new ToolRuntime({ workspace, permissions: DEFAULT_PERMISSIONS })
    for (const name of ['read_file', 'list_dir', 'search', 'write_file', 'finish']) {
      expect(await runtime.allowed(name), name).toBe(true)
    }
    // `ask` with nobody answering is still no.
    expect(await runtime.allowed('run_command')).toBe(false)

    const answered: string[] = []
    const brokered = new ToolRuntime({
      workspace,
      permissions: DEFAULT_PERMISSIONS,
      onAsk: async (name: string) => {
        answered.push(name)
        return true
      }
    })
    expect(await brokered.allowed('run_command')).toBe(true)
    expect(answered).toEqual(['run_command'])
  })

  it('dispatches a workspace tool through the gated router without touching an integration', async () => {
    const { runner, ran } = makeRunner(DEFAULT_PERMISSIONS)
    const result = await runner.dispatch('read_file', { path: 'note.txt' })

    expect(result.ok).toBe(true)
    expect(String(result.content ?? '')).toContain('hello from the workspace')
    expect(ran.mcp).toEqual([])
    expect(ran.computer).toEqual([])
    expect(ran.connectors).toEqual([])
    expect(ran.grounded).toEqual([])
  })

  it('refuses an integration call even with the shipped defaults, because ask goes unanswered', async () => {
    for (const { name } of INTEGRATION_CALLS) {
      const { runner, ran } = makeRunner(DEFAULT_PERMISSIONS)
      const result = await runner.dispatch(name, {})
      expect(result.ok, name).toBe(false)
      expect(String(result.error ?? ''), name).toMatch(/permission|blocked/i)
      expect(ran.mcp, name).toEqual([])
      expect(ran.connectors, name).toEqual([])
      expect(ran.computer, name).toEqual([])
      expect(ran.grounded, name).toEqual([])
    }
  })
})
