import type { ToolOutcome } from '../agent/engine'
import type { TurnResult } from '../backend/core/types'
import type { PermissionMode } from '@shared/types'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineClient, EngineEvent } from './client'
import { engineProviderId } from './config'

/** What a single turn hands the engine; the engine owns everything else. */
export interface EngineTurnInput {
  systemPrompt: string
  userMessage: string
  /** Skills and memory index, injected ahead of the user message. */
  context?: string
  signal: AbortSignal
  onText: (delta: string) => void
}

export interface EngineStepUpdate {
  id: string
  tool: string
  status: 'running' | 'ok' | 'error'
  detail?: string
  output?: string
  error?: string
}

/** One observable moment in a specialist's own engine session. */
export interface EngineCrewUpdate {
  kind: 'started' | 'step' | 'finished'
  /** The engine session the specialist works in. */
  sessionId: string
  specialist: string
  /** The brief the captain handed it, when the pairing is known. */
  instruction?: string
  step?: EngineStepUpdate
  report?: string
  error?: string
}

export interface EngineTurnHost {
  taskId: string
  title: string
  workspace: string
  permissionMode: PermissionMode
  model: { providerId: string; model: string }
  /** Existing engine session for this task, persisted by the caller. */
  sessionId?: string
  onSession(sessionId: string): void
  executeTool(name: string, args: Record<string, unknown>, callId: string): Promise<ToolOutcome>
  onThinking(delta: string): void
  onStep(step: EngineStepUpdate): void
  /** Work the engine itself spawned as a sub-agent, for the team receipts. */
  onCrew(crew: EngineCrewUpdate): void
  permission(input: { action: string; resources: string[] }): Promise<'once' | 'always' | 'reject'>
}

export class EngineUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineUnavailableError'
  }
}

/** Tools the engine reaches through the bridge already ran in our runtime. */
const BRIDGE_PREFIX = 'selfimpulse_'
/** The engine's own sub-agent tool; its input names the specialist and the brief. */
const SUBAGENT_TOOL = 'subagent'

/** `selfimpulse_tc9c22cf81c_list_files` is one of ours, seen from outside. */
function bridgedToolName(name: string): string {
  const stripped = name.startsWith(BRIDGE_PREFIX) ? name.slice(BRIDGE_PREFIX.length) : name
  const underscore = stripped.indexOf('_')
  return underscore > 0 ? stripped.slice(underscore + 1) : stripped
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((item) => (item && typeof item === 'object' && 'text' in item ? String((item as { text: unknown }).text) : ''))
      .join('')
  }
  return ''
}

/**
 * Runs one SelfImpulse turn on the execution engine.
 *
 * The engine owns the session, the model/tool loop, compaction, retries and
 * subagents. Tools reach it through the MCP bridge and still execute in this
 * process through SelfImpulse's governed runtime.
 */
export async function runEngineTurn(
  input: EngineTurnInput,
  host: EngineTurnHost,
  client: EngineClient
): Promise<TurnResult> {
  const interruptedBeforeExecution: TurnResult = {
    finalResponse: null,
    messages: [],
    apiCallCount: 0,
    usage: { prompt: 0, completion: 0, total: 0 },
    toolCalls: 0,
    stopReason: 'interrupted'
  }
  if (input.signal.aborted) return interruptedBeforeExecution

  const model = {
    providerID: engineProviderId(host.model.providerId),
    id: host.model.model
  }
  let sessionId = host.sessionId
  if (!sessionId) {
    const session = await client.createSession({
      title: host.title,
      model,
      directory: host.workspace
    })
    sessionId = session.id
    host.onSession(session.id)
  }
  if (input.signal.aborted) return interruptedBeforeExecution

  /* The engine keeps the system prompt as a session instruction, so nothing has
   * to be written into the user's workspace for the model to see it. Older
   * engines have no such route; they read the workspace's AGENTS.md instead. */
  let promptDelivered = false
  try {
    await client.putInstruction(sessionId, 'selfimpulse', input.systemPrompt)
    promptDelivered = true
  } catch {
    promptDelivered = false
  }
  if (input.signal.aborted) return interruptedBeforeExecution
  if (!promptDelivered) {
    try {
      writeFileSync(join(host.workspace, 'AGENTS.md'), input.systemPrompt, 'utf8')
    } catch {
      // A locked workspace is not a reason to skip the turn.
    }
  }

  let text = ''
  let ended = ''
  let toolCalls = 0
  let steps = 0
  let promptTokens = 0
  let completionTokens = 0
  let failure: string | undefined
  const nativeSteps = new Map<string, EngineStepUpdate>()
  /* The engine names a tool only when its input starts; the call event that
   * follows carries the id alone. Call ids are scoped to their session. */
  const toolNames = new Map<string, Map<string, string>>()

  interface CrewWatch {
    specialist: string
    instruction?: string
    text: string
    report: string
    steps: number
    finished: boolean
  }
  /** Briefs the captain handed the engine's subagent tool, waiting for their session. */
  const pendingBriefs: Array<{ specialist: string; instruction?: string }> = []
  const crewSessions = new Map<string, CrewWatch>()

  /** Claims the brief that belongs to this specialist, if one is waiting. */
  const takeBrief = (agent: string): { specialist: string; instruction?: string } => {
    const index = pendingBriefs.findIndex((brief) => brief.specialist === agent)
    if (index >= 0) return pendingBriefs.splice(index, 1)[0]
    if (agent) return { specialist: agent }
    const next = pendingBriefs.shift()
    return { specialist: next?.specialist ?? 'specialist', instruction: next?.instruction }
  }

  const crewStart = (childId: string, agent: string): void => {
    if (crewSessions.has(childId)) return
    const brief = takeBrief(agent)
    crewSessions.set(childId, {
      specialist: brief.specialist,
      instruction: brief.instruction,
      text: '',
      report: '',
      steps: 0,
      finished: false
    })
    host.onCrew({
      kind: 'started',
      sessionId: childId,
      specialist: brief.specialist,
      instruction: brief.instruction
    })
  }

  let settleTurn: ((outcome: 'succeeded' | 'failed' | 'interrupted') => void) | undefined
  const done = new Promise<'succeeded' | 'failed' | 'interrupted'>((resolve) => {
    settleTurn = resolve
  })

  const finish = (outcome: 'succeeded' | 'failed' | 'interrupted'): void => {
    settleTurn?.(outcome)
    settleTurn = undefined
  }

  const unsubscribe = client.onEvent((event: EngineEvent) => {
    const data = (event.data ?? {}) as Record<string, unknown>
    const eventSession = typeof data.sessionID === 'string' ? data.sessionID : undefined
    if (!eventSession) return
    /* The event feed is global. Only explicit parent links establish ownership,
     * including descendants of known children; pending briefs are metadata only.
     * Check this before permissions, tool maps, or any host callback. */
    if (event.type === 'session.created' && eventSession !== sessionId) {
      const parentId = typeof data.parentID === 'string' ? data.parentID : undefined
      if (parentId && (parentId === sessionId || crewSessions.has(parentId))) {
        crewStart(eventSession, String(data.agent ?? ''))
      }
      return
    }
    if (eventSession !== sessionId && !crewSessions.has(eventSession)) return

    if (event.type === 'session.tool.input.started') {
      const id = typeof data.id === 'string' ? data.id : ''
      const name = typeof data.name === 'string' ? data.name : ''
      if (id && name) {
        let names = toolNames.get(eventSession)
        if (!names) toolNames.set(eventSession, (names = new Map()))
        names.set(id, name)
      }
      return
    }
    const toolId = typeof data.id === 'string' ? data.id : ''
    const toolName = toolNames.get(eventSession)?.get(toolId) ?? 'tool'
    if (event.type === 'permission.asked') {
      const action = String(data.action ?? 'tool')
      const resources = Array.isArray(data.resources) ? data.resources.map(String) : []
      const requestId = String(data.id ?? '')
      void host
        .permission({ action, resources })
        .then((decision) => client.replyPermission(eventSession, requestId, decision))
        .catch(() => client.replyPermission(eventSession, requestId, 'reject'))
      return
    }
    if (eventSession !== sessionId) {
      const crew = crewSessions.get(eventSession)
      if (!crew) return
      switch (event.type) {
        case 'session.text.delta':
          crew.text += typeof data.delta === 'string' ? data.delta : ''
          break
        case 'session.text.ended':
          if (typeof data.text === 'string') crew.report = data.text
          break
        case 'session.tool.called':
          host.onCrew({
            kind: 'step',
            sessionId: eventSession,
            specialist: crew.specialist,
            step: {
              id: toolId || `${eventSession}:${crew.steps++}`,
              tool: bridgedToolName(toolName),
              status: 'running',
              detail: JSON.stringify(data.input ?? {}).slice(0, 240)
            }
          })
          break
        case 'session.tool.success':
        case 'session.tool.failed':
          host.onCrew({
            kind: 'step',
            sessionId: eventSession,
            specialist: crew.specialist,
            step: {
              id: toolId || `${eventSession}:${crew.steps++}`,
              tool: bridgedToolName(toolName),
              status: event.type === 'session.tool.success' ? 'ok' : 'error',
              output: toText(data.content).slice(0, 400),
              ...(event.type === 'session.tool.failed'
                ? {
                    error: String(
                      (data.error as { message?: string } | undefined)?.message ?? 'The tool failed.'
                    ).slice(0, 400)
                  }
                : {})
            }
          })
          break
        case 'session.execution.succeeded':
        case 'session.execution.failed':
        case 'session.execution.interrupted': {
          if (crew.finished) break
          crew.finished = true
          const report = crew.report || crew.text
          host.onCrew({
            kind: 'finished',
            sessionId: eventSession,
            specialist: crew.specialist,
            ...(event.type === 'session.execution.succeeded'
              ? { report: report || `${crew.specialist} finished without a written report.` }
              : {
                  error:
                    event.type === 'session.execution.interrupted'
                      ? 'The specialist was interrupted before it reported.'
                      : String((data.error as { message?: string } | undefined)?.message ?? 'The specialist failed.'),
                  ...(report ? { report } : {})
                })
          })
          break
        }
        default:
          break
      }
      return
    }
    switch (event.type) {
      case 'session.text.delta':
        text += typeof data.delta === 'string' ? data.delta : ''
        input.onText(typeof data.delta === 'string' ? data.delta : '')
        break
      case 'session.text.ended':
        ended = typeof data.text === 'string' ? data.text : ended
        break
      case 'session.reasoning.delta':
        if (typeof data.delta === 'string') host.onThinking(data.delta)
        break
      case 'session.tool.called': {
        toolCalls += 1
        /* Bridged tools already ran in our runtime, which recorded them with a
         * title a person can read. The engine's copy would only repeat it. */
        if (toolName.startsWith(BRIDGE_PREFIX)) break
        const args = (data.input ?? {}) as { agent?: unknown; prompt?: unknown }
        const specialist = toolName === SUBAGENT_TOOL ? String(args.agent ?? '').toLowerCase() : ''
        if (specialist) {
          pendingBriefs.push({
            specialist,
            instruction: typeof args.prompt === 'string' ? args.prompt : undefined
          })
        }
        const step: EngineStepUpdate = {
          id: toolId,
          tool: toolName,
          status: 'running',
          ...(specialist ? { detail: `Specialist ${specialist}` } : {})
        }
        nativeSteps.set(step.id, step)
        host.onStep(step)
        break
      }
      case 'session.tool.success':
      case 'session.tool.failed': {
        const id = toolId
        const previous = nativeSteps.get(id)
        if (!previous) break
        const step: EngineStepUpdate = {
          ...previous,
          status: event.type === 'session.tool.success' ? 'ok' : 'error',
          output: toText(data.content),
          ...(event.type === 'session.tool.failed'
            ? { error: String((data.error as { message?: string } | undefined)?.message ?? 'Tool failed') }
            : {})
        }
        nativeSteps.set(id, step)
        host.onStep(step)
        break
      }
      case 'session.step.started':
        steps += 1
        break
      case 'session.step.ended':
      case 'session.step.failed': {
        /* The main turn's tokens arrive here; `usage.recorded` is emitted only
         * for title and compaction work. */
        const tokens = (data.tokens ?? {}) as {
          input?: number
          output?: number
          reasoning?: number
          cache?: { read?: number; write?: number }
        }
        const input = Number(tokens.input ?? 0) || 0
        const cacheRead = Number(tokens.cache?.read ?? 0) || 0
        const cacheWrite = Number(tokens.cache?.write ?? 0) || 0
        promptTokens += input + cacheRead + cacheWrite
        completionTokens += (Number(tokens.output ?? 0) || 0) + (Number(tokens.reasoning ?? 0) || 0)
        break
      }
      case 'session.execution.succeeded':
        finish('succeeded')
        break
      case 'session.execution.failed':
        failure = String((data.error as { message?: string } | undefined)?.message ?? 'The engine turn failed.')
        finish('failed')
        break
      case 'session.execution.interrupted':
        finish('interrupted')
        break
      default:
        break
    }
  })

  const onAbort = (): void => {
    void client.interrupt(sessionId!).catch(() => undefined)
  }
  input.signal.addEventListener('abort', onAbort, { once: true })

  try {
    if (input.signal.aborted) return interruptedBeforeExecution
    const contextBlock = input.context?.trim()
    const userText = contextBlock
      ? `<context>\n${contextBlock}\n</context>\n\n${input.userMessage}`
      : input.userMessage
    await client.waitForTools(host.workspace)
    if (input.signal.aborted) return interruptedBeforeExecution
    await client.prompt(sessionId, userText)
    const outcome = await done
    if (input.signal.aborted && outcome !== 'succeeded') {
      return {
        finalResponse: text || null,
        messages: [{ role: 'assistant', content: text }],
        apiCallCount: Math.max(1, steps),
        usage: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
        toolCalls,
        stopReason: 'interrupted'
      }
    }
    if (outcome === 'failed') {
      throw new Error(failure ?? 'The engine turn failed.')
    }
    if (outcome === 'interrupted') {
      return {
        finalResponse: text || null,
        messages: [{ role: 'assistant', content: text }],
        apiCallCount: Math.max(1, steps),
        usage: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
        toolCalls,
        stopReason: 'interrupted'
      }
    }
    return {
      finalResponse: ended || text || null,
      messages: [{ role: 'assistant', content: ended || text }],
      apiCallCount: Math.max(1, steps),
      usage: {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens
      },
      toolCalls,
      stopReason: 'final'
    }
  } finally {
    input.signal.removeEventListener('abort', onAbort)
    unsubscribe()
  }
}
