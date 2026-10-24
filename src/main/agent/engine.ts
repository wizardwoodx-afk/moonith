import {
  DEFAULT_MOONWRIGHT_CONFIG,
  IterationBudget,
  buildMemoryReviewPrompt,
  buildSkillReviewPrompt,
  evaluateStopGates,
  finalizeHeldAnswer,
  memoryNudgeMessage,
  shouldNudgeMemory,
  shouldNudgeSkill,
  skillNudgeMessage
} from '../backend/core/index'
import type {
  ImpulseConfig,
  ModelMessage,
  ModelResponse,
  ToolCall,
  ToolResult,
  TurnResult
} from '../backend/core/types'
import { makePorts } from '../backend/adapter'
import type { Provider, ProviderToolSpec } from '../backend/provider'
import type { BackendStore } from '../backend/store'
import { Annotation, END, START, StateGraph } from '../selfimpulse/roi/runtime/index.js'
import type { DurableContext } from '../selfimpulse/durable/index'
import { createStep, executeStep } from '../selfimpulse/workflow/index'
import type { AgentTool } from './tools/types'
import type { ChatMessage } from '@shared/types'

/**
 * SELF-ΡΟΗ powers the control flow; SelfImpulse owns every policy and side effect.
 *
 * A turn is a small state graph: prepare → model → tools/answer. The existing
 * provider, approval, artifact, task, memory, and skill ports are used directly,
 * so there is still one transcript and one tool runtime. Crew sub-agents enter
 * through the same graph, and adjacent delegation calls execute concurrently.
 * Ordinary tools stay ordered, which also keeps approval prompts sequential.
 */

export interface ToolOutcome {
  content: string
  isError?: boolean
  mutatedPaths?: string[]
}

export interface EngineInput {
  provider: Provider
  tools: AgentTool[]
  systemPrompt: string
  history: ModelMessage[]
  userMessage: string
  context?: string
  memoryStore: BackendStore['memories']
  skillsDir: string
  config: Partial<ImpulseConfig>
  durable?: DurableContext
  /** Synchronous egress boundary invoked immediately before every provider call. */
  protectModelMessages?: (messages: ModelMessage[]) => ModelMessage[]
  signal: AbortSignal
  onText: (delta: string) => void
  onTool: (callId: string, name: string, args: Record<string, unknown>) => Promise<ToolOutcome>
  /** New user steering drained between model iterations, never during a tool call. */
  drainUserMessages?: () => ModelMessage[]
  emit: (event: string, payload: unknown) => void
}

type Usage = TurnResult['usage']
type StopReason = TurnResult['stopReason']
type Ports = ReturnType<typeof makePorts>

const CREW_DELEGATION_TOOL = 'delegate_to_crew'

const CaptainState = Annotation.Root({
  turnId: Annotation<string>(),
  messages: Annotation<ModelMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  modelResponse: Annotation<ModelResponse | null>({
    reducer: (_left, right) => right,
    default: () => null
  }),
  apiCallCount: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0
  }),
  finalResponse: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null
  }),
  pendingVerificationResponse: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null
  }),
  pendingVerificationResponsePreviewed: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false
  }),
  mutatedPaths: Annotation<string[]>({
    reducer: (left, right) => [...new Set([...left, ...right])],
    default: () => []
  }),
  iterationsSinceSkill: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0
  }),
  iterationsSinceMemory: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0
  }),
  skillUsedThisTurn: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false
  }),
  memoryWrittenThisTurn: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false
  }),
  stopGateNudges: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0
  }),
  budgetGraceCall: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false
  }),
  toolCalls: Annotation<number>({
    reducer: (left, right) => left + right,
    default: () => 0
  }),
  usage: Annotation<Usage>({
    reducer: (left, right) => ({
      prompt: left.prompt + right.prompt,
      completion: left.completion + right.completion,
      total: left.total + right.total
    }),
    default: () => ({ prompt: 0, completion: 0, total: 0 })
  }),
  stopReason: Annotation<StopReason | null>({
    reducer: (_left, right) => right,
    default: () => null
  })
})

type CaptainTurnState = typeof CaptainState.State

interface CompletedToolCall {
  call: ToolCall
  result: ToolResult
}

/** SelfImpulse's tool schema, as the provider's function spec. */
export function toolToWireSpec(tool: AgentTool): ProviderToolSpec {
  const { $schema: _schema, ...parameters } = tool.inputSchema
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters
    }
  }
}

export function toolsToWireSpecs(tools: AgentTool[]): ProviderToolSpec[] {
  return tools.map(toolToWireSpec)
}

/** Convert persisted chat rows without losing the tool half of a transcript. */
export function toEngineHistory(messages: ChatMessage[]): ModelMessage[] {
  return messages
    .filter(
      (message) =>
        message.role === 'user' || message.role === 'assistant' || message.role === 'tool'
    )
    .map((message) => ({
      role: message.role as ModelMessage['role'],
      content: message.content,
      ...(message.toolCalls?.length
        ? {
            toolCalls: message.toolCalls.map((call) => ({
              id: call.id,
              name: call.name,
              args: (call.arguments ?? {}) as Record<string, unknown>
            }))
          }
        : {}),
      ...(message.role === 'tool' ? { toolCallId: message.toolCallId, name: message.name } : {})
    }))
}

/**
 * Non-final exits are not successful task completions. The task runtime uses
 * this to persist an error instead of silently marking an exhausted run done.
 */
export function turnFailureMessage(result: TurnResult): string | null {
  switch (result.stopReason) {
    case 'error':
      return result.error || 'The model call failed before the turn completed.'
    case 'max_iterations':
      return 'The agent reached its model iteration limit before producing a final answer.'
    case 'budget_exhausted':
      return 'The agent exhausted its turn budget before producing a final answer.'
    case 'prelude_break':
      return 'The agent stopped before producing a final answer.'
    case 'final':
    case 'interrupted':
      return null
  }
}

export async function runEngineTurn(input: EngineInput): Promise<TurnResult> {
  const config: ImpulseConfig = { ...DEFAULT_MOONWRIGHT_CONFIG, ...input.config }
  const specs = toolsToWireSpecs(input.tools)
  const ports = makePorts({
    provider: input.provider,
    runtime: { definitions: () => specs },
    memoryStore: input.memoryStore,
    skillsDir: input.skillsDir,
    emit: input.emit,
    now: () => Date.now(),
    extraTools: [],
    // The graph's tool node owns call ids and executes input.onTool directly.
    // This port remains only for makePorts' provider/memory/skills assembly.
    runTool: async () => '',
    onText: input.onText
  })
  const tools = ports.listTools()
  const budget = new IterationBudget(config.maxIterations)

  const prepare = async (state: CaptainTurnState) => {
    if (input.signal.aborted) return { stopReason: 'interrupted' as const }
    if (!budget.allows(state.apiCallCount, config.maxIterations, state.budgetGraceCall)) {
      return {
        stopReason: (budget.remaining === 0 ? 'budget_exhausted' : 'max_iterations') as StopReason
      }
    }

    budget.consume()
    const messages: ModelMessage[] = input.drainUserMessages?.() ?? []
    let iterationsSinceSkill = state.iterationsSinceSkill + 1
    let iterationsSinceMemory = state.iterationsSinceMemory + 1

    if (
      config.skillNudgeInterval > 0 &&
      iterationsSinceSkill >= config.skillNudgeInterval &&
      !state.skillUsedThisTurn
    ) {
      const nudge = skillNudgeMessage()
      messages.push(nudge)
      iterationsSinceSkill = 0
      ports.emit('agent:nudge', {
        turnId: state.turnId,
        kind: 'skill',
        message: nudge.content
      })
    }
    if (
      config.memoryNudgeInterval > 0 &&
      iterationsSinceMemory >= config.memoryNudgeInterval &&
      !state.memoryWrittenThisTurn
    ) {
      const nudge = memoryNudgeMessage()
      messages.push(nudge)
      iterationsSinceMemory = 0
      ports.emit('agent:nudge', {
        turnId: state.turnId,
        kind: 'memory',
        message: nudge.content
      })
    }

    return {
      apiCallCount: state.apiCallCount + 1,
      iterationsSinceSkill,
      iterationsSinceMemory,
      modelResponse: null,
      messages
    }
  }

  const model = async (state: CaptainTurnState) => {
    ports.emit('agent:api_call', { turnId: state.turnId, call: state.apiCallCount })
    try {
      const stepId = `model:${state.apiCallCount}`
      const response = await executeStep(
        createStep<ModelMessage[], ModelResponse>({
          id: stepId,
          execute: ({ input: messages }) => {
            const protectedMessages = input.protectModelMessages?.(messages) ?? messages
            return ports.callModel(protectedMessages, {
              tools,
              temperature: config.temperature,
              maxTokens: config.maxOutputTokens,
              signal: input.signal
            })
          }
        }),
        state.messages,
        {
          durable: input.durable,
          signal: input.signal,
          runId: state.turnId,
          validateOutput: () => {
            if (input.signal.aborted) {
              throw input.signal.reason ?? new DOMException('The turn was interrupted.', 'AbortError')
            }
          },
          onEvent: (event) =>
            ports.emit('agent:workflow_step', {
              ...event,
              turnId: state.turnId,
              kind: 'model',
              error:
                event.error instanceof Error
                  ? event.error.message
                  : event.error
                    ? String(event.error)
                    : undefined
            })
        }
      )
      if (!response.text && !response.toolCalls.length) {
        ports.emit('agent:empty_response', { turnId: state.turnId })
      }
      return {
        modelResponse: response,
        usage: {
          prompt: response.usage?.prompt ?? 0,
          completion: response.usage?.completion ?? 0,
          total: response.usage?.total ?? 0
        }
      }
    } catch (error) {
      ports.emit('agent:error', {
        turnId: state.turnId,
        error: error instanceof Error ? error.message : String(error)
      })
      // Provider failures must reach AgentRuntime's error path. Returning a
      // partial TurnResult here used to make failed tasks look successful.
      throw error
    }
  }

  const executeCall = async (turnId: string, call: ToolCall): Promise<CompletedToolCall> => {
    ports.emit('agent:tool', { turnId, tool: call.name, args: call.args, callId: call.id })
    if (!input.tools.some((tool) => tool.name === call.name)) {
      return {
        call,
        result: { ok: false, error: `Tool "${call.name}" is not granted to this turn; execution was refused.` }
      }
    }
    try {
      const outcome = await executeStep(
        createStep<Record<string, unknown>, ToolOutcome>({
          id: `tool:${call.id}`,
          execute: ({ input: args }) => input.onTool(call.id, call.name, args)
        }),
        call.args,
        {
          durable: input.durable,
          signal: input.signal,
          runId: turnId,
          validateOutput: () => {
            if (input.signal.aborted) {
              throw input.signal.reason ?? new DOMException('The turn was interrupted.', 'AbortError')
            }
          },
          onEvent: (event) =>
            ports.emit('agent:workflow_step', {
              ...event,
              turnId,
              kind: 'tool',
              callId: call.id,
              tool: call.name,
              error:
                event.error instanceof Error
                  ? event.error.message
                  : event.error
                    ? String(event.error)
                    : undefined
            })
        }
      )
      return {
        call,
        result: {
          ok: !outcome.isError,
          output: outcome.content,
          ...(outcome.mutatedPaths?.length ? { mutatedPaths: outcome.mutatedPaths } : {})
        }
      }
    } catch (error) {
      return {
        call,
        result: { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  }

  const runTools = async (state: CaptainTurnState) => {
    const response = state.modelResponse
    if (!response) throw new Error('The tool node has no model response to execute.')

    const completed: CompletedToolCall[] = []
    for (let index = 0; index < response.toolCalls.length; ) {
      const parallelCrew = response.toolCalls[index].name === CREW_DELEGATION_TOOL
      let end = index + 1
      if (parallelCrew) {
        while (
          end < response.toolCalls.length &&
          response.toolCalls[end].name === CREW_DELEGATION_TOOL
        ) {
          end += 1
        }
      }
      const batch = response.toolCalls.slice(index, end)
      if (batch.length > 1) {
        ports.emit('agent:crew_parallel', {
          turnId: state.turnId,
          count: batch.length,
          callIds: batch.map((call) => call.id)
        })
      }
      // Promise.all also handles a one-tool batch. The loop does not start the
      // next batch until this one finishes, preserving ordinary tool ordering.
      completed.push(...(await Promise.all(batch.map((call) => executeCall(state.turnId, call)))))
      index = end
    }

    const messages: ModelMessage[] = [
      { role: 'assistant', content: response.text, toolCalls: response.toolCalls },
      ...completed.map(({ call, result }) => ({
        role: 'tool' as const,
        toolCallId: call.id,
        name: call.name,
        content:
          JSON.stringify(result.ok ? (result.output ?? '') : { error: result.error }) ?? ''
      }))
    ]
    const mutatedPaths = completed.flatMap(({ result }) => result.mutatedPaths ?? [])
    const usedSkill = completed.some(
      ({ call }) => call.name === 'skill_manage' || call.name === 'skill_use'
    )
    const wroteMemory = completed.some(
      ({ call }) => call.name === 'memory_write' || call.name === 'memory_add'
    )

    return {
      messages,
      toolCalls: completed.length,
      mutatedPaths,
      skillUsedThisTurn: state.skillUsedThisTurn || usedSkill,
      memoryWrittenThisTurn: state.memoryWrittenThisTurn || wroteMemory,
      iterationsSinceSkill: usedSkill ? 0 : state.iterationsSinceSkill,
      iterationsSinceMemory: wroteMemory ? 0 : state.iterationsSinceMemory
    }
  }

  const answer = async (state: CaptainTurnState) => {
    const text = state.modelResponse?.text ?? ''
    const assistant: ModelMessage = { role: 'assistant', content: text }
    const outcome = await evaluateStopGates({
      mutatedPaths: state.mutatedPaths,
      finalResponse: text,
      messages: [...state.messages, assistant],
      nudges: state.stopGateNudges
    })

    if (outcome.continueTurn && outcome.nudge) {
      ports.emit('agent:stop_gate', {
        turnId: state.turnId,
        nudge: outcome.nudge,
        reason: outcome.nudge
      })
      return {
        messages: [
          assistant,
          {
            role: 'assistant' as const,
            content: outcome.pendingVerificationResponse,
            synthetic: true,
            name: 'interim_answer'
          },
          { role: 'user' as const, content: outcome.nudge, synthetic: true, name: 'stop_gate' }
        ],
        stopGateNudges: state.stopGateNudges + 1,
        pendingVerificationResponse: outcome.pendingVerificationResponse,
        finalResponse: null
      }
    }

    return {
      messages: [assistant],
      finalResponse: text,
      pendingVerificationResponse: null,
      stopReason: 'final' as const
    }
  }

  const graph = new StateGraph(CaptainState)
    .addNode('prepare', prepare)
    .addNode('model', model)
    .addNode('tools', runTools)
    .addNode('answer', answer)
    .addEdge(START, 'prepare')
    .addConditionalEdges('prepare', (state) => (state.stopReason ? END : 'model'))
    .addConditionalEdges('model', (state) => {
      if (state.modelResponse?.toolCalls.length) return 'tools'
      return state.modelResponse?.text ? 'answer' : 'prepare'
    })
    .addEdge('tools', 'prepare')
    .addConditionalEdges('answer', (state) =>
      state.stopReason === 'final' ? END : 'prepare'
    )
    .compile()

  const messages: ModelMessage[] = [{ role: 'system', content: input.systemPrompt }, ...input.history]
  if (input.context) {
    messages.push({ role: 'user', content: input.context, synthetic: true, name: 'context' })
  }
  messages.push({ role: 'user', content: input.userMessage })
  const turnId = `turn_${ports.now().toString(36)}`

  const state = (await graph.invoke(
    { turnId, messages },
    {
      signal: input.signal,
      // Each model iteration can traverse prepare/model/tools or answer.
      recursionLimit: Math.max(100, config.maxIterations * 4 + 20)
    }
  )) as CaptainTurnState

  const stopReason = state.stopReason ?? 'error'
  // A held answer is a fallback for an exhausted/interrupted turn, not a
  // replacement for a later answer that already passed the gates.
  const finalResponse =
    stopReason === 'final' ? state.finalResponse : (finalizeHeldAnswer(state) ?? state.finalResponse)

  const review = maybeStartBackgroundReview({
    input,
    config,
    ports,
    state,
    finalResponse,
    stopReason
  })
  const result: TurnResult = {
    finalResponse,
    messages: state.messages,
    apiCallCount: state.apiCallCount,
    usage: state.usage,
    toolCalls: state.toolCalls,
    stopReason,
    ...(stopReason === 'error' ? { error: 'The agent graph ended without a final answer.' } : {}),
    ...(review ? { review } : {})
  }
  ports.emit('agent:turn_done', {
    turnId: state.turnId,
    apiCallCount: state.apiCallCount,
    toolCalls: state.toolCalls,
    usage: state.usage,
    stopReason
  })
  return result
}

function maybeStartBackgroundReview(args: {
  input: EngineInput
  config: ImpulseConfig
  ports: Ports
  state: CaptainTurnState
  finalResponse: string | null
  stopReason: StopReason
}): TurnResult['review'] | undefined {
  const { input, config, ports, state, finalResponse, stopReason } = args
  if (
    !config.backgroundReview ||
    !finalResponse ||
    stopReason === 'error' ||
    stopReason === 'interrupted' ||
    input.signal.aborted
  ) {
    return undefined
  }

  const toolNames = new Set(input.tools.map((tool) => tool.name))
  const skills = shouldNudgeSkill({
    nudgeInterval: config.skillNudgeInterval,
    iterationsSinceSkill: state.iterationsSinceSkill,
    skillToolAvailable: toolNames.has('skill_manage')
  })
  const memory = shouldNudgeMemory({
    nudgeInterval: config.memoryNudgeInterval,
    iterationsSinceMemory: state.iterationsSinceMemory,
    memoryToolAvailable: toolNames.has('memory_write')
  })
  if (!skills && !memory) return undefined

  const review = { memory, skills }
  ports.emit('agent:review', { turnId: state.turnId, ...review })
  // Review is deliberately detached from delivery, matching the existing
  // learning policy. It gets a filtered tool set and cannot start another review.
  void runBackgroundReview({ ...args, review })
  return review
}

async function runBackgroundReview(args: {
  input: EngineInput
  config: ImpulseConfig
  ports: Ports
  state: CaptainTurnState
  finalResponse: string | null
  review: { memory: boolean; skills: boolean }
}): Promise<void> {
  const { input, config, ports, state, finalResponse, review } = args
  try {
    const reviewTools = input.tools.filter(
      (tool) =>
        (review.skills && tool.name === 'skill_manage') ||
        (review.memory && tool.name.startsWith('memory_'))
    )
    if (!reviewTools.length) return

    const transcript = state.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => `${message.role}: ${message.content ?? ''}`)
      .join('\n')
      .slice(-6000)
    const instructions: string[] = []
    if (review.skills) {
      instructions.push(
        buildSkillReviewPrompt({
          taskSummary: finalResponse ?? '(no answer)',
          existingSkills: await ports.skills.list(),
          transcriptExcerpt: transcript
        })
      )
    }
    if (review.memory) {
      instructions.push(
        buildMemoryReviewPrompt({
          taskSummary: finalResponse ?? '(no answer)',
          existingMemories: await ports.memory.list(),
          transcriptExcerpt: transcript
        })
      )
    }

    const result = await runEngineTurn({
      ...input,
      // Review has a different prompt and must never reuse Captain's model keys.
      durable: undefined,
      tools: reviewTools,
      systemPrompt: [
        'You are the background reviewer for SelfImpulse. You never answer the user directly.',
        'Review the completed turn and, only when warranted, persist what was learned.'
      ].join('\n'),
      history: [],
      userMessage: instructions.join('\n\n'),
      context: undefined,
      config: {
        ...input.config,
        backgroundReview: false,
        maxIterations: config.reviewMaxIterations
      },
      onText: () => undefined
    })
    ports.emit('agent:review_done', {
      turnId: state.turnId,
      wrote: result.toolCalls,
      text: result.finalResponse
    })
  } catch (error) {
    ports.emit('agent:review_error', {
      turnId: state.turnId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
