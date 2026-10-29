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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Task } from '@shared/types'
import type { ToolContext } from './tools/types'
import { governanceService } from '../services/governance'
import { toolExecutionGateway } from './gateway/gateway'

const h = vi.hoisted(() => {
  const gate = {
    recordOutcome: vi.fn(),
    recordApproval: vi.fn(),
    identities: { revokeAgent: vi.fn(), forgetAgent: vi.fn() }
  }
  return {
    gate,
    store: {
      getTask: vi.fn(),
      saveTask: vi.fn(async () => undefined),
      getPublicSettings: vi.fn(() => ({
        governance: {
          defaultRole: 'executor',
          custom: {
            capabilities: ['read', 'write', 'execute', 'network', 'delegate'],
            maxRisk: 'high',
            toolAllowlist: [],
            toolDenylist: []
          },
          dlp: { mode: 'off', categories: [] }
        }
      }))
    },
    approvals: {
      request: vi.fn(),
      isAlwaysAllowed: vi.fn(() => false),
      cancelTask: vi.fn()
    },
    governToolCall: vi.fn(),
    registerCrewSeat: vi.fn(),
    runEngineTurn: vi.fn(),
    receipts: {
      recordIntent: vi.fn(async (_intent: { args: Record<string, unknown> }) => undefined),
      recordResult: vi.fn(async () => undefined)
    },
    requiresReceipt: vi.fn(() => false),
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
  requiresReceipt: h.requiresReceipt,
  digestOfValue: () => 'digest'
}))
vi.mock('../emitter', () => ({ sendTaskEvent: vi.fn(), toast: vi.fn() }))
vi.mock('../paths', () => ({ ensureTaskWorkspace: () => 'C:/ws' }))
vi.mock('../audit/runtime', () => ({
  runtimeAudit: { record: vi.fn(async () => true) }
}))
vi.mock('../enterpriseControl/runtime', () => ({
  authorizeNativeTaskTool: vi.fn(async () => ({
    allowed: true,
    principalId: 'local-owner',
    action: 'tool.invoke',
    resource: { kind: 'tool', namespaceId: 'default' },
    reason: 'test allow'
  }))
}))
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
vi.mock('../services/subagents', () => ({
  subAgentService: h.subAgents,
  CREW_SPECIALISTS: {},
  crewDisplayName: (id: string) => (id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Specialist'),
  engineCrewAgents: () => []
}))
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
  steering: unknown
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
  return {
    taskId: 't1',
    controller: new AbortController(),
    stopped,
    steering: {
      drain: () => [],
      commit: () => undefined,
      restore: () => undefined,
      hasItems: () => false
    }
  }
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
  recordEngineCrew(
    task: Task,
    attribution: { provider: string; model: string },
    update: any,
    runs: Map<string, any>
  ): Promise<void>
}

const internals = agentRuntime as unknown as RuntimeInternals

beforeEach(() => {
  vi.clearAllMocks()
  h.approvals.isAlwaysAllowed.mockReturnValue(false)
  h.governToolCall.mockResolvedValue(steerDecision)
  h.store.saveTask.mockResolvedValue(undefined)
  h.requiresReceipt.mockReturnValue(false)
})

afterEach(() => vi.restoreAllMocks())

describe('immutable tool argument boundary', () => {
  beforeEach(() => {
    // Keep the runtime path real; avoid gateway journal/passport IO.
    vi.spyOn(toolExecutionGateway, 'execute').mockImplementation(async (request) => ({
      ...await request.execute(),
      isError: false,
      journalEntryId: request.ids.actionId
    }))
    h.requiresReceipt.mockReturnValue(true)
    h.approvals.request.mockResolvedValue(true)
  })

  it.each(['original', 'display'] as const)(
    'ignores mutation of %s arguments while approval is pending',
    async (source) => {
      const task = makeTask()
      const input = { path: 'safe.txt', nested: { items: [{ text: 'safe' }] } }
      const expected = { path: 'safe.txt', nested: { items: [{ text: 'safe' }] } }
      let approve!: (value: boolean) => void
      h.approvals.request.mockImplementationOnce(() => new Promise<boolean>((resolve) => { approve = resolve }))
      const summarize = vi.fn((args) => `write ${args.path}`)
      const review = vi.fn(async (_args: unknown) => undefined)
      const execute = vi.fn(async (args) => ({ content: JSON.stringify(args) }))
      const tool = { ...writeTool, summarize, approvalReview: review, execute }
      const pending = internals.executeToolCall(task, new Map([[tool.name, tool]]),
        { id: 'snapshot-call', name: tool.name, arguments: input }, makeRun(), makeContext(task), 'msg-1')
      await vi.waitFor(() => expect(h.approvals.request).toHaveBeenCalledTimes(1))

      const exposed = source === 'original' ? input : task.steps[0].args as typeof input
      exposed.path = 'changed.txt'
      exposed.nested.items[0].text = 'changed'
      exposed.nested.items.push({ text: 'extra' })
      approve(true)
      const result = await pending

      expect(result).toMatchObject({ isError: false, content: JSON.stringify(expected) })
      const snapshot = h.governToolCall.mock.calls[0][0].args
      expect(snapshot).toEqual(expected)
      expect(summarize.mock.calls[0][0]).toBe(snapshot)
      expect(review.mock.calls[0][0]).toBe(snapshot)
      expect(execute.mock.calls[0][0]).toBe(snapshot)
      expect(h.receipts.recordIntent.mock.calls[0][0].args).toBe(snapshot)
      expect(vi.mocked(toolExecutionGateway.execute).mock.calls[0][0].args).toBe(snapshot)
      expect(h.approvals.request.mock.calls[0][1].details).toBe(JSON.stringify(expected, null, 2))
      expect(Object.isFrozen(snapshot.nested.items[0])).toBe(true)
      expect(h.gate.recordApproval).toHaveBeenCalledWith('act-1', 'human')
      expect(h.receipts.recordResult).toHaveBeenCalledWith('act-1', 'success', { digest: 'digest' })
    }
  )

  it('snapshots before asynchronous governance and keeps approval details isolated from display edits', async () => {
    const task = makeTask()
    const input = { path: 'safe.txt', nested: { text: 'safe' } }
    let decide!: (value: typeof steerDecision) => void
    h.governToolCall.mockImplementationOnce(() => new Promise((resolve) => { decide = resolve }))
    const tool = { ...writeTool, execute: vi.fn(async (args) => ({ content: JSON.stringify(args) })) }
    const pending = internals.executeToolCall(task, new Map([[tool.name, tool]]),
      { id: 'snapshot-call', name: tool.name, arguments: input }, makeRun(), makeContext(task), 'msg-1')
    await vi.waitFor(() => expect(h.governToolCall).toHaveBeenCalledTimes(1))
    input.nested.text = 'original changed'
    ;(task.steps[0].args as typeof input).path = 'display changed'
    decide(steerDecision)
    const result = await pending
    expect(JSON.parse(result.content)).toEqual({ path: 'safe.txt', nested: { text: 'safe' } })
    expect(JSON.parse(h.approvals.request.mock.calls[0][1].details)).toEqual({ path: 'safe.txt', nested: { text: 'safe' } })
  })

  it('preserves parsed defaults and freezes the DLP result before approvalReview', async () => {
    const task = makeTask()
    const protectedArgs = { path: 'safe.txt', nested: { text: '[redacted]' }, mode: 'append' }
    const protect = vi.spyOn(governanceService, 'protectToolArguments').mockReturnValue({
      args: protectedArgs, findings: [], total: 1
    })
    const review = vi.fn(async (args) => {
      expect(Reflect.set(args, 'path', 'changed.txt')).toBe(false)
      expect(Reflect.set(args.nested, 'text', 'changed')).toBe(false)
      expect(() => Object.defineProperty(args, 'extra', { value: true })).toThrow(TypeError)
      protectedArgs.nested.text = 'later DLP mutation'
      return undefined
    })
    const tool = {
      ...writeTool,
      schema: z.object({ path: z.string(), nested: z.object({ text: z.string() }), mode: z.string().default('append') }),
      approvalReview: review,
      execute: vi.fn(async (args) => ({ content: JSON.stringify(args) }))
    }
    const result = await internals.executeToolCall(task, new Map([[tool.name, tool]]),
      { id: 'snapshot-call', name: tool.name, arguments: { path: 'safe.txt', nested: { text: 'secret' } } },
      makeRun(), makeContext(task), 'msg-1')
    expect(protect.mock.calls[0][3]).toEqual({ path: 'safe.txt', nested: { text: 'secret' }, mode: 'append' })
    expect(JSON.parse(result.content)).toEqual({ path: 'safe.txt', nested: { text: '[redacted]' }, mode: 'append' })
    expect(review).toHaveBeenCalledTimes(1)
  })

  it.each(['allow', 'always-allowed'] as const)('preserves defaults and receipt behavior for %s actions', async (mode) => {
    const task = makeTask()
    h.governToolCall.mockResolvedValue({ ...steerDecision, decision: mode === 'allow' ? 'allow' : 'steer' })
    h.approvals.isAlwaysAllowed.mockReturnValue(mode === 'always-allowed')
    const review = vi.fn(async () => undefined)
    const tool = {
      ...writeTool,
      schema: z.object({ path: z.string(), options: z.object({ append: z.boolean() }).default({ append: true }) }),
      approvalReview: review,
      execute: vi.fn(async (args) => ({ content: JSON.stringify(args) }))
    }
    const result = await internals.executeToolCall(task, new Map([[tool.name, tool]]),
      { id: 'snapshot-call', name: tool.name, arguments: { path: 'safe.txt' } },
      makeRun(), makeContext(task), 'msg-1')
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.content)).toEqual({ path: 'safe.txt', options: { append: true } })
    expect(Object.isFrozen(tool.execute.mock.calls[0][0].options)).toBe(true)
    expect(h.approvals.request).not.toHaveBeenCalled()
    expect(review).not.toHaveBeenCalled()
    expect(h.gate.recordApproval).not.toHaveBeenCalled()
    expect(h.receipts.recordIntent).toHaveBeenCalledWith(expect.objectContaining({
      ids: { runId: 't1', taskId: 't1', actionId: 'act-1', agentId: 'Captain', principalId: 'local-user' },
      tool: 'write_file',
      authorization: expect.objectContaining({ approvedBy: null, approvedAt: null })
    }))
    expect(h.gate.recordOutcome).toHaveBeenCalledWith('act-1', 'success')
  })

  it('rejects unsupported parsed values before governance, approval, receipts or execution', async () => {
    const task = makeTask()
    const tool = { ...writeTool, schema: z.object({ value: z.any() }), execute: vi.fn(async () => ({ content: 'unexpected' })) }
    const result = await internals.executeToolCall(task, new Map([[tool.name, tool]]),
      { id: 'snapshot-call', name: tool.name, arguments: { value: new Date() } },
      makeRun(), makeContext(task), 'msg-1')
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/unsupported tool arguments/i)
    expect(h.governToolCall).not.toHaveBeenCalled()
    expect(h.approvals.request).not.toHaveBeenCalled()
    expect(h.receipts.recordIntent).not.toHaveBeenCalled()
    expect(tool.execute).not.toHaveBeenCalled()
    expect(task.steps[0].status).toBe('error')
  })
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

describe('engine crew recording lifecycle', () => {
  it('creates and tracks subagent runs as the engine emits crew events', async () => {
    const task = makeTask()
    const attribution = { provider: 'Gemini', model: 'gemini-flash' }
    const crewRuns = new Map<string, any>()
    const fakeRun = { id: 'session-1', steps: [] }
    h.subAgents.begin.mockResolvedValue(fakeRun)

    // Started event initializes the subagent run
    await internals.recordEngineCrew(
      task,
      attribution,
      { sessionId: 'session-1', specialist: 'techne', kind: 'started', instruction: 'write code' },
      crewRuns
    )
    expect(h.subAgents.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'session-1',
        name: 'Techne',
        instruction: 'write code'
      })
    )

    // Step event records a subagent tool step
    await internals.recordEngineCrew(
      task,
      attribution,
      {
        sessionId: 'session-1',
        specialist: 'techne',
        kind: 'step',
        step: { id: 'st-1', tool: 'write_file', status: 'ok', detail: 'wrote code.ts' }
      },
      crewRuns
    )
    expect(h.subAgents.saveRun).toHaveBeenCalled()

    // Finished event completes the run
    await internals.recordEngineCrew(
      task,
      attribution,
      {
        sessionId: 'session-1',
        specialist: 'techne',
        kind: 'finished',
        report: 'All done.'
      },
      crewRuns
    )
    expect(h.subAgents.finish).toHaveBeenCalledWith(
      fakeRun,
      'done',
      expect.objectContaining({ summary: 'All done.' })
    )
  })
})

describe('delivered files are anchored to their turn', () => {
  it('hands the assistant message id to the tool context so writes land under that turn', async () => {
    const execute = vi.fn(async (_args: unknown, _ctx: unknown) => ({ content: 'written' }))
    const tool = {
      name: 'write_file',
      title: 'Write a file',
      description: '',
      sideEffect: 'write',
      risk: 'low',
      approval: 'never',
      summarize: () => 'write a.txt',
      execute
    } as unknown as AgentTool
    h.governToolCall.mockResolvedValue({
      decision: 'allow',
      rule: 'auto',
      reason: 'test allow',
      actionId: 'act-1',
      capability: 'fs.write'
    })

    const task = makeTask()
    task.messages = [
      { id: 'msg-owner', role: 'assistant', content: '', createdAt: new Date().toISOString() }
    ] as typeof task.messages

    await internals.executeToolCall(
      task,
      new Map([['write_file', tool]]),
      { id: 'call-9', name: 'write_file', arguments: { path: 'a.txt' } },
      makeRun(),
      makeContext(task),
      'msg-owner'
    )

    expect(execute).toHaveBeenCalled()
    expect(execute.mock.calls[0][1]).toMatchObject({ messageId: 'msg-owner' })
  })
})

describe('editMessage', () => {

  it('edits a user message, truncates subsequent messages, and relaunches the agent', async () => {
    const task = makeTask()
    task.messages = [
      { id: 'msg-1', role: 'user', content: 'Original prompt', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'msg-2', role: 'assistant', content: 'Old response', createdAt: '2026-01-01T00:00:01Z' },
      { id: 'msg-3', role: 'user', content: 'Follow-up', createdAt: '2026-01-01T00:00:02Z' }
    ]
    task.steps = [
      { id: 'step-1', messageId: 'msg-2', tool: 'test', title: 'test', status: 'ok', startedAt: '2026-01-01' }
    ]
    h.store.getTask.mockReturnValue(task)
    const launchSpy = vi.spyOn(agentRuntime as any, 'launch').mockImplementation(() => {})

    const updated = await agentRuntime.editMessage({
      taskId: task.id,
      messageId: 'msg-1',
      content: 'Updated prompt'
    })

    expect(updated.messages).toHaveLength(1)
    expect(updated.messages[0].content).toBe('Updated prompt')
    expect(updated.steps).toHaveLength(0)
    expect(updated.status).toBe('running')
    expect(launchSpy).toHaveBeenCalledWith(task.id)
    launchSpy.mockRestore()
  })
})
