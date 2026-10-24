/**
 * Agent runtime governance edges.
 *
 * Two outcomes the audit trail must not lose:
 *
 *   - a human denying — or stopping — a steered action settles the gate
 *     record as `denied`. Otherwise the decision stays open and trust never
 *     sees the refusal;
 *   - a Crew seat is registered once, used under the registry's own agent id,
 *     refused outright if registration fails, and revoked + forgotten when
 *     the run ends.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@shared/types'
import type { ToolContext } from './tools/types'

const h = vi.hoisted(() => {
  const gate = {
    recordOutcome: vi.fn(),
    recordApproval: vi.fn(),
    identities: { revokeAgent: vi.fn(), forgetAgent: vi.fn() }
  }
  return {
    gate,
    store: { getTask: vi.fn(), saveTask: vi.fn(async () => undefined) },
    approvals: {
      request: vi.fn(),
      isAlwaysAllowed: vi.fn(() => false),
      cancelTask: vi.fn()
    },
    governToolCall: vi.fn(),
    registerCrewSeat: vi.fn(),
    runEngineTurn: vi.fn(),
    receipts: {
      recordIntent: vi.fn(async () => undefined),
      recordResult: vi.fn(async () => undefined)
    },
    subAgents: {
      begin: vi.fn(),
      saveRun: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      list: vi.fn()
    },
    usage: { record: vi.fn(async () => undefined) }
  }
})

vi.mock('../store', () => ({ store: h.store }))
vi.mock('../nomos', () => ({ LOCAL_PRINCIPAL_ID: 'local-user', nomosGate: () => h.gate }))
vi.mock('../approvals', () => ({ approvals: h.approvals }))
vi.mock('../sphragis', () => ({
  receiptService: () => h.receipts,
  requiresReceipt: () => false,
  digestOfValue: () => 'digest'
}))
vi.mock('../emitter', () => ({ sendTaskEvent: vi.fn(), toast: vi.fn() }))
vi.mock('../paths', () => ({ ensureTaskWorkspace: () => 'C:/ws' }))
vi.mock('./governed', () => ({
  captainActionIds: () => ({
    runId: 't1',
    taskId: 't1',
    actionId: 'act-1',
    agentId: 'Captain',
    principalId: 'local-user'
  }),
  governToolCall: h.governToolCall,
  registerCrewSeat: h.registerCrewSeat
}))
vi.mock('./providers', () => ({ providerError: (error: unknown) => String(error) }))
vi.mock('./prompt', () => ({ buildSystemPrompt: () => '' }))
vi.mock('./tools', () => ({ getBuiltinTools: () => [] }))
vi.mock('./engine', () => ({ runEngineTurn: h.runEngineTurn }))
vi.mock('../services/mcp', () => ({ mcpManager: { getAgentTools: () => [] } }))
vi.mock('../services/connectors', () => ({ connectorsManager: { getAgentTools: async () => [] } }))
vi.mock('../services/memory', () => ({ memoryService: { promptIndex: async () => '' } }))
vi.mock('../services/skills', () => ({
  skillService: { promptIndex: async () => '', readForTool: async () => '' }
}))
vi.mock('../services/subagents', () => ({ subAgentService: h.subAgents }))
vi.mock('../services/usage', () => ({ usageService: h.usage }))
vi.mock('../services/documents', () => ({
  artifactKindForPath: () => 'text',
  mimeForPath: () => 'text/plain'
}))
vi.mock('../backend', () => ({ getBackend: () => ({ store: { memories: {} } }) }))
vi.mock('../backend/paths', () => ({ backendSkillsDir: () => '' }))
vi.mock('../backend/provider', () => ({ Provider: class {}, resolveConfig: () => ({}) }))

import { agentRuntime } from './runtime'
import type { AgentTool } from './tools/types'

/** Structural mirror of the runtime's internal run state. */
interface RunState {
  taskId: string
  controller: AbortController
  stopped: boolean
  pendingSteer: boolean
}

const steerDecision = {
  decision: 'steer' as const,
  rule: 'policy-approval',
  reason: 'this action needs your approval',
  actionId: 'act-1',
  capability: 'fs.write'
}

function makeTask(): Task {
  return {
    id: 't1',
    title: 'Task',
    objective: '',
    status: 'running',
    mode: 'captain',
    permissionMode: 'manual',
    messages: [],
    steps: [],
    plan: [],
    artifacts: [],
    folders: [],
    createdAt: new Date().toISOString()
  } as unknown as Task
}

function makeRun(stopped = false): RunState {
  return { taskId: 't1', controller: new AbortController(), stopped, pendingSteer: false }
}

function makeContext(task: Task): ToolContext {
  return {
    task,
    workspace: 'C:/ws',
    roots: ['C:/ws'],
    allowShell: false,
    addArtifact: async () => null,
    setBrowser: () => undefined,
    setPlan: () => undefined,
    toast: () => undefined
  } as unknown as ToolContext
}

const writeTool = {
  name: 'write_file',
  title: 'Write a file',
  description: '',
  sideEffect: 'write',
  risk: 'high',
  approval: 'always',
  summarize: () => 'write a.txt',
  execute: vi.fn(async () => ({ content: 'written' }))
} as unknown as AgentTool

/** Reach the private tool path without widening the public API. */
interface RuntimeInternals {
  executeToolCall(
    task: Task,
    toolMap: Map<string, AgentTool>,
    call: { id: string; name: string; arguments: Record<string, unknown> },
    run: RunState,
    context: ToolContext,
    messageId: string
  ): Promise<{ content: string; isError: boolean }>
  runSubAgent(
    task: Task,
    parent: RunState,
    provider: unknown,
    name: string,
    instruction: string,
    tools: AgentTool[],
    context: ToolContext
  ): Promise<{ content: string; isError?: boolean }>
}

const internals = agentRuntime as unknown as RuntimeInternals

beforeEach(() => {
  vi.clearAllMocks()
  h.approvals.isAlwaysAllowed.mockReturnValue(false)
  h.governToolCall.mockResolvedValue(steerDecision)
  h.store.saveTask.mockResolvedValue(undefined)
})

describe('human denial of a steered action', () => {
  it('records the denied outcome and never runs the tool', async () => {
    h.approvals.request.mockResolvedValue(false)
    const task = makeTask()

    const result = await internals.executeToolCall(
      task,
      new Map([['write_file', writeTool]]),
      { id: 'call-1', name: 'write_file', arguments: { path: 'a.txt' } },
      makeRun(),
      makeContext(task),
      'msg-1'
    )

    expect(result.isError).toBe(true)
    expect(writeTool.execute).not.toHaveBeenCalled()
    expect(h.gate.recordOutcome).toHaveBeenCalledWith('act-1', 'denied')
    expect(h.gate.recordOutcome).toHaveBeenCalledTimes(1)
  })

  it('records the denied outcome when the user stops the run while it waits', async () => {
    h.approvals.request.mockResolvedValue(true)
    const task = makeTask()

    const result = await internals.executeToolCall(
      task,
      new Map([['write_file', writeTool]]),
      { id: 'call-2', name: 'write_file', arguments: { path: 'a.txt' } },
      makeRun(true),
      makeContext(task),
      'msg-2'
    )

    expect(result.content).toMatch(/interrupted by the user/)
    expect(writeTool.execute).not.toHaveBeenCalled()
    expect(h.gate.recordOutcome).toHaveBeenCalledWith('act-1', 'denied')
    expect(h.gate.recordOutcome).toHaveBeenCalledTimes(1)
  })
})

describe('crew seat lifecycle', () => {
  const provider = { settings: { providerId: 'p', model: 'm' } }

  it('refuses the job when the seat cannot be registered', async () => {
    h.registerCrewSeat.mockReturnValue({ ok: false, reason: 'seat already active' })
    h.subAgents.begin.mockResolvedValue({ steps: [] })
    const task = makeTask()

    const result = await internals.runSubAgent(
      task,
      makeRun(),
      provider,
      'Docs Scout',
      'read the docs',
      [],
      makeContext(task)
    )

    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/could not be registered/)
    expect(h.runEngineTurn).not.toHaveBeenCalled()
    expect(h.subAgents.finish).toHaveBeenCalledWith(
      expect.anything(),
      'error',
      expect.objectContaining({ error: expect.stringContaining('could not be registered') })
    )
  })

  it('revokes and forgets the registered seat when the run finishes', async () => {
    h.registerCrewSeat.mockReturnValue({ ok: true, agentId: 'crew:docs-scout' })
    h.subAgents.begin.mockResolvedValue({ steps: [] })
    h.runEngineTurn.mockResolvedValue({
      finalResponse: 'done',
      usage: { prompt: 1, completion: 2, total: 3 }
    })
    const task = makeTask()

    const result = await internals.runSubAgent(
      task,
      makeRun(),
      provider,
      'Docs Scout',
      'read the docs',
      [],
      makeContext(task)
    )

    expect(result.isError).toBeFalsy()
    expect(h.gate.identities.revokeAgent).toHaveBeenCalledWith(
      'crew:docs-scout',
      'crew run finished'
    )
    expect(h.gate.identities.forgetAgent).toHaveBeenCalledWith('crew:docs-scout')
  })
})
