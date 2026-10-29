import { promises as fs } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { z } from 'zod'
import type {
  Artifact,
  AttachmentRef,
  ChatMessage,
  EditMessageInput,
  PlanItem,
  PublicSettings,
  SendMessageInput,
  StepRecord,
  SubAgentRun,
  SubAgentStep,
  Task,
  ToolCallInfo
} from '@shared/types'
import { approvals } from '../approvals'
import { LOCAL_PRINCIPAL_ID, nomosGate } from '../nomos'
import { digestOfValue, receiptService, requiresReceipt } from '../sphragis'
import { sendTaskEvent, toast } from '../emitter'
import { store } from '../store'
import { resolveAgentName } from '@shared/identity'
import { ensureTaskWorkspace, getPaths } from '../paths'
import { isWithin, extractMentionedFolders } from '../security'
import { newId, nowIso, truncate } from '../util'
import { captainActionIds, governToolCall } from './governed'
import { toolExecutionGateway } from './gateway/gateway'
import { createToolArgumentSnapshot } from './toolArgumentSnapshot'
import { DurableStore, type DurableContext } from '../selfimpulse/durable/index'
import { AtroposVirtualActor } from './durable/virtualActor'
import { DaedalusCodingHarness } from './harness/daedalusHarness'
import JSZip from 'jszip'
import { addUsage } from './types'
import { providerError } from './providers'
import { buildSystemPrompt } from './prompt'
import { getBuiltinTools } from './tools'
import type { AgentTool, ToolContext } from './tools/types'
import { isAllowedInPlanMode } from './tools/types'
import { runTripwires, type TripwireVerdict } from './tripwires'
import { artifactKindForPath, mimeForPath } from '../services/documents'
import { mcpManager } from '../services/mcp'
import { connectorsManager } from '../services/connectors'
import { memoryService } from '../services/memory'
import { skillService } from '../services/skills'
import { subAgentService, crewDisplayName, engineCrewAgents, type EngineCrewAgent } from '../services/subagents'
import { learnFromTask } from './learning'
import { usageService } from '../services/usage'
import { governanceService, type GovernanceActor } from '../services/governance'
import { authorizeTool, type PolicyTool } from '../selfimpulse/governance/policy'
import { authorizeNativeTaskTool } from '../enterpriseControl/runtime'
import { runEngineTurn, toEngineHistory, turnFailureMessage, type ToolOutcome } from './engine'
import { prepareEngine, EngineUnavailable } from '../engine'
import { runEngineTurn as runEngineLayerTurn, type EngineCrewUpdate, type EngineStepUpdate } from '../engine/run'
import { toolBridge } from '../engine/bridge'
import { getBackend } from '../backend'
import { backendSkillsDir } from '../backend/paths'
import { Provider, resolveConfig } from '../backend/provider'
import type { ModelMessage, TurnResult } from '../backend/core/types'
import { TurnInputQueue } from '../selfimpulse/impulseRuntime/index'

interface RunState {
  taskId: string
  controller: AbortController
  stopped: boolean
  steering: TurnInputQueue<ChatMessage>
}

const MAX_ROUNDS = 50
const MAX_STEPS = 500

/**
 * The policy shape of crew delegation. Delegation itself is the engine's own
 * sub-agent tool now, so the task's role is asked through this name before the
 * engine is configured — the crew either exists for the turn or is hidden.
 */
const CREW_POLICY_TOOL: PolicyTool = {
  name: 'delegate_to_crew',
  sideEffect: 'network',
  risk: 'low'
}

/** Existing task-role RBAC and native enterprise policy are both mandatory. */
async function enterpriseToolDenial(
  task: Task,
  actor: GovernanceActor,
  tool: AgentTool
): Promise<string | null> {
  if (actor.actor === 'system') {
    return 'Enterprise Control Plane has no agent identity for this action.'
  }
  try {
    const decision = await authorizeNativeTaskTool({
      taskId: task.id,
      actor: actor.actor,
      agentName: actor.actorId,
      toolName: tool.name
    })
    return decision.allowed ? null : decision.reason
  } catch (error) {
    return `Enterprise Control Plane could not authorize the action; failing closed. ${
      error instanceof Error ? error.message : String(error)
    }`
  }
}

function mergePlan(existing: PlanItem[], steps: string[]): PlanItem[] {
  const byText = new Map(existing.map((item) => [item.text, item]))
  const next: PlanItem[] = steps.map((text) => {
    const previous = byText.get(text)
    return {
      id: previous?.id ?? newId('plan'),
      text,
      status: previous?.status ?? 'pending'
    }
  })
  let activeAssigned = false
  for (const item of next) {
    if (item.status === 'done') continue
    if (!activeAssigned) {
      item.status = 'active'
      activeAssigned = true
    } else if (item.status === 'active') {
      item.status = 'pending'
    }
  }
  return next
}

function attachmentManifest(attachments: AttachmentRef[]): string {
  const lines = attachments.map(
    (file) =>
      `- ${file.name} → ${file.relPath ?? file.path}${file.mimeType ? ` (${file.mimeType})` : ''}`
  )
  return `The user attached these files and folders. They are available in the task workspace or granted folders and can be inspected, read, or unpacked with file and archive tools:\n${lines.join('\n')}`
}

/** The name the owner gave their agent, for prompts the agent reads about itself. */
function agentLabel(): string {
  try {
    return resolveAgentName(store.getPublicSettings().agentName)
  } catch {
    return resolveAgentName()
  }
}

class AgentRuntime {
  private runs = new Map<string, RunState>()

  isRunning(taskId: string): boolean {
    return this.runs.has(taskId)
  }

  /**
   * A process that died mid-turn leaves its task claiming to work forever, and
   * nothing survives the restart to make that true. Cleared at startup so the
   * board reports what is actually running.
   */
  async reconcileInterrupted(): Promise<number> {
    let cleared = 0
    for (const summary of store.listTasks()) {
      if (summary.status !== 'running' && summary.status !== 'waiting') continue
      if (this.runs.has(summary.id)) continue
      const task = store.getTask(summary.id)
      if (!task) continue
      task.status = 'error'
      task.error = 'Stopped when the app closed. Send a message to continue.'
      const last = [...task.messages].reverse().find((message) => message.role === 'assistant')
      if (last && !last.content.trim()) last.error = true
      await store.saveTask(task)
      this.publish(task)
      cleared++
    }
    return cleared
  }

  async sendMessage(input: SendMessageInput): Promise<Task> {
    const task = this.requireTask(input.taskId)
    const active = this.runs.get(task.id)
    const text = input.text.trim()
    const attachments = await this.copyAttachments(task, input.attachments ?? [])
    if (!text && !attachments.length) throw new Error('Write a message first.')

    const userMessage: ChatMessage = {
      id: newId('msg'),
      role: 'user',
      content: text,
      createdAt: nowIso(),
      attachments: attachments.length ? attachments : undefined
    }
    /* The manifest must come before the question. A turn is built from the last
     * visible user message plus the history ahead of it, so a manifest pushed
     * after the question reaches neither and the model never learns a file is
     * attached. */
    const incoming: ChatMessage[] = []

    if (attachments.length) {
      incoming.push({
        id: newId('msg'),
        role: 'user',
        content: attachmentManifest(attachments),
        createdAt: nowIso(),
        hidden: true
      })
    }
    incoming.push(userMessage)
    task.messages.push(...incoming)

    /* A message sent while work is running takes the wheel: the running turn
     * stops and this one starts next, the same way editing a message stops the
     * turn first. Queuing it instead left the user watching an answer they had
     * already superseded. */
    if (active && !active.controller.signal.aborted && !active.stopped) await this.stop(task.id)
    this.runs.delete(task.id)
    task.status = 'running'
    task.error = undefined
    task.completedAt = undefined
    await store.saveTask(task)
    this.publish(task)

    this.launch(task.id)
    return task
  }

  async editMessage(input: EditMessageInput): Promise<Task> {
    const task = this.requireTask(input.taskId)
    const content = input.content.trim()
    if (!content) throw new Error('Message content cannot be empty.')

    if (this.runs.has(task.id)) {
      await this.stop(task.id)
    }

    const messageIndex = task.messages.findIndex((m) => m.id === input.messageId)
    if (messageIndex === -1) throw new Error('Message not found.')

    // Update the message content
    task.messages[messageIndex].content = content
    task.messages[messageIndex].createdAt = nowIso()

    // Truncate subsequent messages and purge corresponding steps
    const keptMessages = task.messages.slice(0, messageIndex + 1)
    const removedMessageIds = new Set(task.messages.slice(messageIndex + 1).map((m) => m.id))
    task.messages = keptMessages
    task.steps = task.steps.filter((s) => !s.messageId || !removedMessageIds.has(s.messageId))

    task.status = 'running'
    task.error = undefined
    task.completedAt = undefined

    await store.saveTask(task)
    this.publish(task)

    this.launch(task.id)
    return task
  }

  async steer(input: SendMessageInput): Promise<Task> {
    return this.sendMessage(input)
  }

  async stop(taskId: string): Promise<void> {
    const task = store.getTask(taskId)
    if (!task) return
    const run = this.runs.get(taskId)
    if (run) {
      run.stopped = true
      run.controller.abort()
      approvals.cancelTask(taskId)
    }
    if (task.status === 'running' || task.status === 'waiting' || task.status === 'paused') {
      task.status = 'paused'
      task.error = undefined
      await store.saveTask(task)
      this.publish(task)
    }
  }

  async resume(taskId: string): Promise<void> {
    const task = this.requireTask(taskId)
    if (this.runs.has(taskId)) return
    if (!task.messages.length) return
    task.status = 'running'
    task.error = undefined
    task.completedAt = undefined
    await store.saveTask(task)
    this.publish(task)
    this.launch(taskId)
  }

  private requireTask(taskId: string): Task {
    const task = store.getTask(taskId)
    if (!task) throw new Error('Task not found.')
    return task
  }

  private launch(taskId: string): void {
    if (this.runs.has(taskId)) return
    const state: RunState = {
      taskId,
      controller: new AbortController(),
      stopped: false,
      steering: new TurnInputQueue<ChatMessage>('all')
    }
    this.runs.set(taskId, state)
    void this.loop(taskId, state).catch((error) => {
      // The loop has its own error handling; this guard exists so a failure
      // before it (a task deleted mid-launch) cannot become an unhandled
      // rejection that leaves a stale run behind.
      this.runs.delete(taskId)
      console.error('[agent] the run loop failed:', error)
    })
  }

  private async loop(taskId: string, run: RunState): Promise<void> {
    const task = this.requireTask(taskId)
    try {
      await this.reconcileToolResults(task)
      await this.commit(task)

      const settings = store.getPublicSettings()
      const provider = this.resolveEngineProvider(task, settings)
      const allTools = await this.collectTools(task, run, provider, settings)
      const tools = governanceService
        .permittedTools(task, allTools)
        .filter((tool) => task.permissionMode !== 'plan' || isAllowedInPlanMode(tool))
      /* Keep the complete map for the second, action-time check: the model
       * may still name a tool filtered out of its list. */
      const toolMap = new Map(allTools.map((tool) => [tool.name, tool]))
      const skills = await skillService.promptIndex().catch(() => '')
      const lastUser = [...task.messages]
        .reverse()
        .find((message) => message.role === 'user' && !message.hidden)?.content
      const memory = await memoryService
        .promptIndex(`${task.title}\n${task.objective}\n${lastUser ?? ''}`, task.folders)
        .catch(() => '')
      /* Delegation is the engine's own sub-agent tool, so the task's permission
       * role answers before the engine is configured: a role that does not grant
       * it leaves the tool hidden from the model rather than promised to it. */
      const crew =
        settings.engineMode === 'engine' &&
        authorizeTool(task.agentRole, settings.governance, CREW_POLICY_TOOL).allowed
          ? engineCrewAgents(skills)
          : []
      const system = buildSystemPrompt({
        task,
        workspace: ensureTaskWorkspace(task.id),
        settings,
        skills,
        memory,
        crew: crew.map((agent) => agent.id)
      })

      const backend = getBackend()

      // The ImpulseCore core takes the transcript up to the last user message,
      // and the user message itself.
      const lastUserIndex = findLastUserIndex(task.messages)
      const userMessage = lastUserIndex >= 0 ? task.messages[lastUserIndex] : undefined
      const history = toEngineHistory(
        task.messages.slice(0, lastUserIndex < 0 ? task.messages.length : lastUserIndex)
      )

      if (task.status !== 'running') {
        task.status = 'running'
        task.stop = undefined
        this.publish(task)
      }

      const assistantMessage: ChatMessage = {
        id: newId('msg'),
        role: 'assistant',
        content: '',
        createdAt: nowIso()
      }
      task.messages.push(assistantMessage)
      this.publish(task)

      const toolContext = this.createToolContext(task, settings)
      const context = [skills, memory].filter(Boolean).join('\n\n')
      // Messages already represented by this initial history/userMessage pair
      // must not be injected a second time at the first prepare checkpoint.
      const representedSteering = run.steering.drain()
      for (const message of representedSteering) run.steering.commit(message)
      let drainedSteering: ChatMessage[] = []

      let durable: DurableContext | undefined
      try {
        const durableStore = new DurableStore(getPaths().durable)
        durable = await durableStore.context(task.id, { signal: run.controller.signal })
      } catch (err) {
        console.warn('[runtime] could not construct durable context:', err)
      }

      const runInternal = (): Promise<TurnResult> =>
        runEngineTurn({
          provider,
          durable,
          tools,
          systemPrompt: system,
          history,
          userMessage: userMessage?.content ?? '',
          drainUserMessages: () => {
            drainedSteering = run.steering.drain()
            return toEngineHistory(drainedSteering)
          },
          commitUserMessages: () => {
            for (const message of drainedSteering) run.steering.commit(message)
            drainedSteering = []
          },
          restoreUserMessages: () => {
            run.steering.restore()
            drainedSteering = []
          },
          context,
          memoryStore: backend.store.memories,
          skillsDir: backendSkillsDir(),
          config: {
            maxIterations: MAX_ROUNDS,
            delegationMaxIterations: 12,
            skillNudgeInterval: 10,
            memoryNudgeInterval: 15,
            verifyOnStop: true,
            preVerifyContinue: true,
            kanbanTerminalTool: false,
            lateLspVerdicts: true,
            backgroundReview: true,
            temperature: 0.2,
            maxOutputTokens: 4096,
            reviewMaxIterations: 12
          },
          signal: run.controller.signal,
          protectModelMessages: (messages) =>
            governanceService.protectModelMessages(
              task,
              { actor: 'captain', actorId: 'Captain', runId: `captain:${task.id}` },
              messages
            ),
          onText: (delta) => {
            assistantMessage.content += delta
            sendTaskEvent({
              type: 'delta',
              taskId: task.id,
              messageId: assistantMessage.id,
              delta
            })
          },
          onTool: async (callId, name, args, thoughtSignature) =>
            this.executeToolCall(
              task,
              toolMap,
              {
                id: callId,
                name,
                arguments: args,
                ...(thoughtSignature ? { thoughtSignature } : {})
              },
              run,
              toolContext,
              assistantMessage.id
            ),
          emit: (event, payload) => this.handleEngineEvent(task, event, payload)
        })

      let result: TurnResult
      if (settings.engineMode === 'engine') {
        try {
          result = await this.runOnExecutionEngine({
            task,
            run,
            settings,
            tools,
            toolMap,
            toolContext,
            system,
            history,
            context,
            crew,
            assistantMessage
          })
        } catch (error) {
          if (!(error instanceof EngineUnavailable)) throw error
          toast('info', `${error.message} The built-in loop is handling this turn.`)
          result = await runInternal()
        }
      } else {
        result = await runInternal()
      }

      const guarded = runTripwires('output', result.finalResponse ?? '')
      assistantMessage.content = guarded.text || assistantMessage.content
      for (const finding of guarded.findings) this.recordTripwire(task, 'output', finding)
      /* A run that stopped early used to be silent: the reason existed only in
       * memory and then disappeared. Oversight reads this. */
      task.stop = result.stopReason === 'final' ? undefined : { reason: result.stopReason, at: nowIso() }
      task.usage = addUsage(task.usage, {
        input: result.usage.prompt,
        output: result.usage.completion,
        total: result.usage.total
      })
      await usageService
        .record({
          agentId: 'Captain',
          providerId: provider.settings.providerId ?? 'selfimpulse',
          model: provider.settings.model ?? '',
          usage: {
            input: result.usage.prompt,
            output: result.usage.completion,
            total: result.usage.total
          }
        })
        .catch(() => undefined)
      await this.commit(task)
      if (run.stopped) return
      const failure = turnFailureMessage(result)
      if (failure) throw new Error(failure)
      if (run.steering.hasItems()) return
      await this.finish(task, 'done')
    } catch (error) {
      // Purge any empty assistant messages that never produced content or tools
      task.messages = task.messages.filter(
        (m) => m.role !== 'assistant' || m.content.trim() !== '' || Boolean(m.toolCalls?.length)
      )
      if (run.stopped) {
        await this.commit(task).catch(() => undefined)
        return
      }
      task.error = providerError(error)
      task.status = 'error'
      await this.commit(task).catch(() => undefined)
      toast('error', task.error)
    } finally {
      this.runs.delete(taskId)
      // Ensure lingering empty assistant messages without content are not persisted
      task.messages = task.messages.filter(
        (m) => m.role !== 'assistant' || m.content.trim() !== '' || Boolean(m.toolCalls?.length)
      )
      if (!run.stopped && run.steering.hasItems()) {
        task.status = 'running'
        task.error = undefined
        task.completedAt = undefined
        await store.saveTask(task).catch(() => undefined)
        this.publish(task)
        if (!this.runs.has(taskId)) this.launch(taskId)
        return
      }
      if (!run.stopped && task.status === 'running') {
        task.status = 'done'
        task.completedAt = nowIso()
        await store.saveTask(task).catch(() => undefined)
        this.publish(task)
        /* Learning is a side effect of a finished turn, never part of it: a
         * failure here must not change what the user already received. */
        void learnFromTask(task)
          .then((outcome) => {
            if (outcome.recorded) console.log(`[learning] ${outcome.memory} / ${outcome.proposal} for ${task.id}`)
          })
          .catch((error) => console.error('[learning] could not learn from the finished task:', error))
      }
    }
  }

  private async collectTools(
    task: Task,
    run: RunState,
    provider: Provider,
    settings: PublicSettings
  ): Promise<AgentTool[]> {
    let mcpTools: AgentTool[] = []
    try {
      mcpTools = mcpManager.getAgentTools()
    } catch (error) {
      toast('error', `MCP tools unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
    let connectorsTools: AgentTool[] = []
    try {
      connectorsTools = await connectorsManager.getAgentTools()
    } catch {
      // The Connectors page reports the connection error; a task should still run.
    }

    const base = [...getBuiltinTools(task.mode), ...mcpTools, ...connectorsTools]
    const readSkill: AgentTool = {
      name: 'read_skill',
      title: 'Read an installed skill',
      description:
        'Load the full SKILL.md for an installed skill by id. Call this before using a skill listed in the system prompt.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The skill id from the installed list.' } },
        required: ['id'],
        additionalProperties: false
      },
      schema: z.object({ id: z.string().trim().min(1).max(200) }),
      sideEffect: 'read',
      risk: 'low',
      approval: 'never',
      execute: async (args: { id: string }) => ({ content: await skillService.readForTool(args.id) }),
      summarize: (args: { id: string }) => args.id
    }

    const byName = new Map<string, AgentTool>()
    for (const tool of [...base, readSkill]) {
      byName.set(tool.name, tool)
    }
    return [...byName.values()]
  }

  /**
   * The provider for this turn. The task's provider and model are resolved
   * first; the backend's client adds every other credentialed provider as a
   * failover, so a rate-limited or out-of-credit provider degrades into the
   * next working one instead of failing the turn.
   */
  private resolveEngineProvider(task: Task, settings: PublicSettings): Provider {
    const providerId = task.providerId || settings.defaultProviderId
    const stored = providerId ? store.getProvider(providerId) : undefined
    if (providerId && !stored) {
      throw new Error('Connect an AI provider in Settings to get started.')
    }
    if (stored && !stored.enabled) {
      throw new Error(`The provider “${stored.name}” is disabled. Enable it in Settings.`)
    }
    const apiKey = stored ? store.getProviderSecret(stored.id) : ''
    if (stored && !apiKey && stored.kind !== 'compatible') {
      throw new Error(`Add an API key for ${stored.name} in Settings.`)
    }
    const model = task.model || settings.defaultModel || stored?.models[0] || ''
    const config = resolveConfig({
      providerId: providerId ?? undefined,
      baseUrl: stored?.baseUrl,
      apiKey,
      model
    })
    if (!config.model) {
      throw new Error('Choose a model for this task in the composer or in Settings.')
    }
    return new Provider({
      providerId: config.providerId,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      kind: stored?.kind === 'anthropic' ? 'anthropic' : 'openai'
    })
  }

  /**
   * Runs one turn on the execution engine. The engine owns the loop, retries,
   * compaction and subagents; every tool still executes here through the
   * bridge, so governance, approvals, receipts and diff review are unchanged.
   */
  private async runOnExecutionEngine(input: {
    task: Task
    run: RunState
    settings: PublicSettings
    tools: AgentTool[]
    toolMap: Map<string, AgentTool>
    toolContext: ToolContext
    system: string
    history: ModelMessage[]
    context: string
    crew: EngineCrewAgent[]
    assistantMessage: ChatMessage
  }): Promise<TurnResult> {
    const { task, run, tools, toolMap, toolContext, assistantMessage, crew } = input
    const prepared = await prepareEngine({
      providerId: task.providerId || input.settings.defaultProviderId,
      model: task.model || input.settings.defaultModel,
      permissionMode: task.permissionMode,
      canDelegate: crew.length > 0
    })

    /* The engine spawns its own specialists now. Their sessions are the crew
     * runs the team panel shows, so the two are keyed by the child session id. */
    const crewRuns = new Map<string, SubAgentRun>()
    const attribution = {
      provider:
        input.settings.providers.find((item) => item.id === prepared.providerId)?.name ??
        prepared.providerId,
      model: prepared.model
    }
    let crewLedger: Promise<void> = Promise.resolve()
    const onCrew = (update: EngineCrewUpdate): void => {
      crewLedger = crewLedger
        .then(() => this.recordEngineCrew(task, attribution, update, crewRuns))
        .catch(() => undefined)
    }

    const executeTool = async (
      name: string,
      args: Record<string, unknown>,
      callId: string
    ): Promise<ToolOutcome> =>
      this.executeToolCall(
        task,
        toolMap,
        { id: callId, name, arguments: args },
        run,
        toolContext,
        assistantMessage.id
      )

    const scope = engineScope(task.id)
    toolBridge.register(scope, {
      listTools: () =>
        tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>
        })),
      callTool: (name, args) => executeTool(name, args, newId('call'))
    })

    /* The engine session starts empty. A task that held earlier conversation
     * before its first engine turn gets that conversation once, as context. */
    const seed = task.engineSessionId ? '' : renderSeedTranscript(input.history)
    const lastUserIndex = findLastUserIndex(task.messages)
    const manifest =
      lastUserIndex > 0 && task.messages[lastUserIndex - 1]?.hidden
        ? task.messages[lastUserIndex - 1].content
        : ''
    const userText =
      [seed, manifest, task.messages[lastUserIndex]?.content ?? '']
        .map((part) => part.trim())
        .filter(Boolean)
        .join('\n\n') || 'Continue.'

    try {
      return await runEngineLayerTurn(
        {
          systemPrompt: engineSystemPrompt(input.system),
          userMessage: userText,
          context: input.context,
          signal: run.controller.signal,
          onText: (delta) => {
            assistantMessage.content += delta
            sendTaskEvent({
              type: 'delta',
              taskId: task.id,
              messageId: assistantMessage.id,
              delta
            })
          }
        },
        {
          taskId: task.id,
          title: task.title,
          workspace: toolContext.workspace,
          permissionMode: task.permissionMode,
          model: { providerId: prepared.providerId, model: prepared.model },
          sessionId: task.engineSessionId,
          onSession: (sessionId) => {
            task.engineSessionId = sessionId
          },
          executeTool,
          onThinking: (delta) => {
            assistantMessage.thinking = (assistantMessage.thinking ?? '') + delta
            sendTaskEvent({
              type: 'thinking',
              taskId: task.id,
              messageId: assistantMessage.id,
              delta
            })
          },
          onStep: (step) => this.recordEngineStep(task, assistantMessage.id, step),
          onCrew,
          permission: (request) => this.askEnginePermission(task, request.action, request.resources)
        },
        prepared.client
      )
    } finally {
      toolBridge.unregister(scope)
      await crewLedger.catch(() => undefined)
    }
  }

  /**
   * One observable moment of a specialist the engine spawned, turned into the
   * crew receipt the team panel reads. The engine session id is the run id, so
   * a report always lands on the run that produced it.
   */
  private async recordEngineCrew(
    task: Task,
    attribution: { provider: string; model: string },
    update: EngineCrewUpdate,
    runs: Map<string, SubAgentRun>
  ): Promise<void> {
    const name = crewDisplayName(update.specialist)
    let run = runs.get(update.sessionId)
    if (!run) {
      run = await subAgentService.begin({
        id: update.sessionId,
        taskId: task.id,
        taskTitle: task.title,
        name,
        instruction: update.instruction || 'Work handed to a specialist by the engine.',
        provider: attribution.provider,
        model: attribution.model,
        agentPath: [resolveAgentName(store.getPublicSettings().agentName), name],
        depth: 1
      })
      runs.set(update.sessionId, run)
    }
    if (update.kind === 'started') return
    if (update.kind === 'step' && update.step) {
      const step: SubAgentStep = {
        id: update.step.id,
        tool: update.step.tool,
        title: update.step.tool,
        detail: update.step.detail ?? update.step.output ?? update.step.error,
        status: update.step.status,
        at: nowIso()
      }
      const known = run.steps.findIndex((item) => item.id === step.id)
      if (known >= 0) run.steps[known] = step
      else run.steps.push(step)
      if (run.steps.length > MAX_STEPS) run.steps.splice(0, run.steps.length - MAX_STEPS)
      await subAgentService.saveRun(run, {
        type: step.status === 'running' ? 'tool_started' : 'tool_finished',
        label: `${step.tool}${step.detail ? ` · ${truncate(step.detail, 120)}` : ''}`
      })
      return
    }
    if (update.kind === 'finished') {
      await subAgentService.finish(run, update.error ? 'error' : 'done', {
        ...(update.report ? { summary: truncate(update.report, 8000) } : {}),
        ...(update.error ? { error: update.error } : {})
      })
      runs.delete(update.sessionId)
    }
  }

  /** Step rows the engine reports for its own work (subagents included). */
  private recordEngineStep(task: Task, messageId: string, update: EngineStepUpdate): void {
    let step = task.steps.find((item) => item.id === update.id)
    if (!step) {
      step = {
        id: update.id || newId('step'),
        tool: update.tool,
        title: update.detail ?? update.tool,
        status: 'running',
        messageId,
        startedAt: nowIso()
      }
      task.steps.push(step)
      if (task.steps.length > MAX_STEPS) task.steps.splice(0, task.steps.length - MAX_STEPS)
    }
    step.status = update.status
    if (update.output !== undefined) step.output = truncate(update.output, 6000)
    if (update.error !== undefined) step.error = truncate(update.error, 500)
    if (update.status !== 'running') step.endedAt = nowIso()
    this.publish(task)
  }

  private async askEnginePermission(
    task: Task,
    action: string,
    resources: string[]
  ): Promise<'once' | 'always' | 'reject'> {
    const tool = `engine.${action}`
    if (approvals.isAlwaysAllowed(task.id, tool)) return 'always'
    const approved = await approvals.request(task.id, {
      tool,
      title: `Allow the engine to ${action}?`,
      summary: truncate(resources.join('\n') || action, 240),
      details: resources.join('\n'),
      risk: action === 'shell' ? 'high' : 'medium',
      allowAlways: true
    })
    if (!approved) return 'reject'
    return approvals.isAlwaysAllowed(task.id, tool) ? 'always' : 'once'
  }

  /** ImpulseCore's own events, mapped onto the task surface the renderer sees. */
  private handleEngineEvent(task: Task, event: string, payload: unknown): void {
    const data = (payload ?? {}) as Record<string, unknown>
    switch (event) {
      case 'agent:nudge':
        toast('info', String(data.message ?? 'The agent kept going.'))
        break
      case 'agent:stop_gate':
        toast('info', String(data.reason ?? 'The agent is verifying the work before answering.'))
        break
      case 'agent:review':
        toast('info', 'Reviewing the turn for skills and memory.')
        break
      case 'agent:budget_warning':
        toast('info', String(data.message ?? 'The turn is close to its step budget.'))
        break
      case 'provider:attempt':
        if (data.providerId) toast('info', `Using ${String(data.providerId)}.`)
        break
      case 'agent:error':
        toast('error', String(data.error ?? 'The agent run failed.'))
        break
      default:
        break
    }
  }

  private createToolContext(task: Task, settings: PublicSettings): ToolContext {
    const workspace = ensureTaskWorkspace(task.id)
    const mentioned = extractMentionedFolders(
      [task.objective, task.title, ...task.messages.map((m) => m.content)].join('\n')
    )
    let foldersChanged = false
    for (const folder of mentioned) {
      if (!task.folders.some((f) => isWithin(f, folder) && isWithin(folder, f))) {
        task.folders.push(folder)
        foldersChanged = true
      }
    }
    if (foldersChanged) {
      void store.saveTask(task).catch(() => undefined)
    }
    const roots = [...new Set([workspace, ...task.folders, ...mentioned])]
    const actor = new AtroposVirtualActor(task.id)
    const harness = new DaedalusCodingHarness(actor, workspace)
    const context: ToolContext = {
      task,
      workspace,
      roots,
      readRoots: roots,
      harness,
      browserScope: task.id,
      browserLabel: agentLabel(),
      actor: 'captain',
      allowShell: settings.allowShell,
      durableRunId: `captain:${task.id}`,
      addArtifact: (absPath, previewAbsPath) =>
        this.registerArtifact(task, absPath, previewAbsPath, context.messageId),
      setBrowser: (state) => {
        task.browser = state
        sendTaskEvent({ type: 'browser', taskId: task.id, browser: state })
      },
      setPlan: (steps) => {
        task.plan = mergePlan(task.plan, steps)
      },
      toast: (level, message) => toast(level, message)
    }
    return context
  }

  private async executeToolCall(
    task: Task,
    toolMap: Map<string, AgentTool>,
    call: ToolCallInfo,
    run: RunState,
    context: ToolContext,
    messageId: string
  ): Promise<ToolOutcome> {
    const tool = toolMap.get(call.name)
    const rawArgs = (call.arguments ?? {}) as Record<string, unknown>
    const actor: GovernanceActor = {
      actor: 'captain',
      actorId: 'Captain',
      runId: `captain:${task.id}`
    }
    const assistantMessage = task.messages.find(
      (message) => message.id === messageId && message.role === 'assistant'
    )
    if (
      assistantMessage &&
      !(assistantMessage.toolCalls ?? []).some((item) => item.id === call.id)
    ) {
      assistantMessage.toolCalls = [...(assistantMessage.toolCalls ?? []), call]
    }

    if (!tool) {
      const content = `Unknown tool "${call.name}".`
      governanceService.audit(task, actor, 'tool.completed', 'error', call.name, content, {
        callId: call.id
      })
      this.appendToolMessage(task, call, content, true)
      await this.commit(task)
      return { content, isError: true }
    }

    const policy = governanceService.authorize(task, actor, tool)
    let denial = policy.allowed ? null : policy.reason
    let denialSource = 'Denied by agent role or enterprise policy'
    if (!denial) denial = await enterpriseToolDenial(task, actor, tool)
    if (!denial && task.permissionMode === 'plan' && !isAllowedInPlanMode(tool)) {
      denial = `Plan mode is read-only, so ${tool.name} does not run. Write the plan instead and let the user switch modes before anything changes.`
      denialSource = 'Blocked by Plan mode'
    }
    if (denial) {
      const content = `Policy denied ${tool.name}: ${denial} Do not retry or bypass this action.`
      task.steps.push({
        id: newId('step'),
        tool: tool.name,
        title: tool.title,
        detail: denial,
        status: 'error',
        error: denialSource,
        messageId,
        startedAt: nowIso(),
        endedAt: nowIso()
      })
      if (task.steps.length > MAX_STEPS) task.steps.splice(0, task.steps.length - MAX_STEPS)
      this.appendToolMessage(task, call, content, true)
      await this.commit(task)
      return { content, isError: true }
    }

    let args: unknown = rawArgs
    if (tool.schema) {
      const parsed = tool.schema.safeParse(rawArgs)
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
          .join('; ')
        const content = `Invalid arguments for ${tool.name}: ${issues}`
        governanceService.audit(task, actor, 'tool.completed', 'error', tool.name, content, {
          callId: call.id,
          argsHash: governanceService.payloadHash(rawArgs)
        })
        this.appendToolMessage(task, call, content, true)
        await this.commit(task)
        return { content, isError: true }
      }
      args = parsed.data
    }

    let effectiveRawArgs: Record<string, unknown>
    let displayArgs: Record<string, unknown>
    let argumentBlockDetail = 'Blocked by data-loss prevention before tool execution'
    try {
      const protection = governanceService.protectToolArguments(
        task,
        actor,
        tool,
        args as Record<string, unknown>
      )
      argumentBlockDetail = 'Blocked by unsupported tool arguments before tool execution'
      // Seal the parsed/DLP-protected action before any review can await or
      // expose it. Every action consumer shares this snapshot, never UI data.
      const snapshot = createToolArgumentSnapshot(protection.args)
      args = snapshot.executionArgs
      effectiveRawArgs = snapshot.executionArgs
      displayArgs = snapshot.displayArgs
    } catch (error) {
      const content = error instanceof Error ? error.message : String(error)
      task.steps.push({
        id: newId('step'),
        tool: tool.name,
        title: tool.title,
        detail: argumentBlockDetail,
        status: 'error',
        error: content,
        messageId,
        startedAt: nowIso(),
        endedAt: nowIso()
      })
      if (task.steps.length > MAX_STEPS) task.steps.splice(0, task.steps.length - MAX_STEPS)
      this.appendToolMessage(task, call, content, true)
      await this.commit(task)
      return { content, isError: true }
    }

    const step: StepRecord = {
      id: newId('step'),
      tool: tool.name,
      title: tool.title,
      detail: tool.summarize
        ? tool.summarize(args)
        : truncate(JSON.stringify(effectiveRawArgs), 240),
      status: 'waiting',
      args: displayArgs,
      messageId,
      startedAt: nowIso()
    }
    task.steps.push(step)
    if (task.steps.length > MAX_STEPS) {
      task.steps.splice(0, task.steps.length - MAX_STEPS)
    }

    /* The gate judges first — identity, capability, kill switch, risk and
     * approval, decided the same way on every path. Its steer already
     * encodes the old needsApproval policy (high risk, 'always', manual
     * mode, low trust) PLUS the identity and capability checks, so the
     * approval question is now simply: did the gate steer, and has the
     * user not already always-allowed this tool for this task? */
    const actionIds = captainActionIds(task.id, task.id)
    const decision = await governToolCall({
      ids: actionIds,
      tool: tool.name,
      args: effectiveRawArgs,
      sideEffect: tool.sideEffect,
      risk: tool.risk,
      approval: tool.approval,
      permissionMode: task.permissionMode
    })

    // A denial never reaches the tool: zero side effects, no approval prompt.
    if (decision.decision === 'deny') {
      step.status = 'error'
      step.error = decision.reason
      step.endedAt = nowIso()
      const content = `Blocked by the governance gate (${decision.rule}): ${decision.reason}`
      this.appendToolMessage(task, call, content, true)
      await this.commit(task)
      return { content, isError: true }
    }

    const needsApproval = decision.decision === 'steer' && !approvals.isAlwaysAllowed(task.id, tool.name)

    if (needsApproval) {
      step.status = 'waiting'
      task.status = 'waiting'
      await this.commit(task)

      const approved = await approvals.request(task.id, {
        tool: tool.name,
        title: tool.title,
        summary: step.detail || tool.title,
        details: approvalDetails(tool, effectiveRawArgs),
        risk: tool.risk,
        allowAlways: tool.allowAlways !== false,
        review: await tool.approvalReview?.(args, context)
      })

      if (run.stopped) {
        /* The user stopped the run while this action waited: it never ran,
         * so the governance record must not keep an open outcome. */
        nomosGate().recordOutcome(decision.actionId, 'denied')
        step.status = 'error'
        step.error = 'Stopped'
        step.endedAt = nowIso()
        const content = 'Tool execution was interrupted by the user.'
        this.appendToolMessage(task, call, content, true)
        await this.commit(task)
        return { content, isError: true }
      }
      if (!approved) {
        // The human said no: the action was refused, not failed.
        nomosGate().recordOutcome(decision.actionId, 'denied')
        step.status = 'error'
        step.error = 'Permission denied'
        step.endedAt = nowIso()
        const content = `The user denied permission to run ${tool.name}. Do not retry the same action; ask the user how to proceed or choose a different approach.`
        this.appendToolMessage(task, call, content, true)
        task.status = 'running'
        await this.commit(task)
        return { content, isError: true }
      }
      task.status = 'running'
      // The human approved a steered action: annotate the gate record.
      nomosGate().recordApproval(decision.actionId, 'human')
    }

    step.status = 'running'
    await this.commit(task)

    /* The receipt barrier: a high-impact tool (it executes something, or it
     * is high-risk) mints a signed intent BEFORE the effect and a result
     * AFTER it. Low-risk reads are journaled by the governance record
     * alone — a receipt for every read would be noise. */
    const gate = nomosGate()
    const receipts = receiptService()
    const needsReceipt = requiresReceipt({ sideEffect: tool.sideEffect, risk: tool.risk })
    if (needsReceipt) {
      await receipts.recordIntent({
        ids: actionIds,
        tool: tool.name,
        action: decision.capability,
        args: effectiveRawArgs,
        authorization: {
          decision: decision.decision,
          rule: decision.rule,
          reason: decision.reason,
          approvedBy: needsApproval ? 'human' : null,
          approvedAt: needsApproval ? nowIso() : null
        }
      })
    }

    let outcome: ToolOutcome
    /* Files this call writes are delivered under the turn that asked for them,
     * not dumped in one block at the end of the conversation. */
    context.messageId = assistantMessage?.id
    try {
      const gatewayRes = await toolExecutionGateway.execute({
        ids: actionIds,
        tool: {
          name: tool.name,
          sideEffect: tool.sideEffect,
          risk: tool.risk,
          approval: tool.approval
        },
        args: effectiveRawArgs,
        execute: async () => {
          return await tool.execute(args, { ...context, callId: call.id })
        }
      })
      const result = {
        content: gatewayRes.content,
        isError: gatewayRes.isError
      }
      step.status = result.isError ? 'error' : 'ok'
      step.output = truncate(result.content, 6000)
      if (result.isError) step.error = truncate(firstLine(result.content), 500)
      const content = truncate(result.content, 30_000)
      if (needsReceipt) {
        await receipts.recordResult(decision.actionId, result.isError ? 'failure' : 'success', {
          digest: digestOfValue({ content })
        })
      }
      gate.recordOutcome(decision.actionId, result.isError ? 'failure' : 'success')
      governanceService.audit(
        task,
        actor,
        'tool.completed',
        result.isError ? 'error' : 'ok',
        tool.name,
        firstLine(content),
        {
          callId: call.id,
          stepId: step.id,
          argsHash: governanceService.payloadHash(effectiveRawArgs)
        }
      )
      this.appendToolMessage(task, call, content, result.isError)
      outcome = {
        content,
        isError: result.isError,
        mutatedPaths: mutatedPathsFor(tool.name, effectiveRawArgs)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      step.status = 'error'
      step.error = truncate(message, 500)
      step.output = truncate(message, 6000)
      const content = `Tool error: ${message}`
      if (needsReceipt) {
        await receipts.recordResult(decision.actionId, 'failure', {
          digest: digestOfValue({ content })
        })
      }
      gate.recordOutcome(decision.actionId, 'failure')
      governanceService.audit(task, actor, 'tool.completed', 'error', tool.name, content, {
        callId: call.id,
        stepId: step.id,
        argsHash: governanceService.payloadHash(effectiveRawArgs)
      })
      this.appendToolMessage(task, call, content, true)
      outcome = { content, isError: true }
    }
    step.endedAt = nowIso()
    await this.commit(task)
    return outcome
  }

  /** A tripwire that fires is a visible event, not a silent edit: the reason
   *  lands in the activity trail so the user can see what was withheld or
   *  marked, and so a false positive is debuggable. */
  private recordTripwire(
    task: Task,
    point: 'content' | 'output',
    finding: TripwireVerdict
  ): void {
    task.steps.push({
      id: newId('step'),
      tool: `tripwire:${point}`,
      title: point === 'output' ? 'Answer checked before display' : 'Retrieved content marked',
      detail: finding.reason,
      status: 'ok',
      startedAt: nowIso(),
      endedAt: nowIso()
    })
    if (task.steps.length > MAX_STEPS) task.steps.splice(0, task.steps.length - MAX_STEPS)
    this.publish(task)
  }

  private appendToolMessage(
    task: Task,
    call: ToolCallInfo,
    content: string,
    isError?: boolean
  ): void {
    /* Tool output is the widest untrusted-text surface the agent has: web
     * pages, file contents and command logs all arrive here and go straight
     * back to the model. Our own failures are left alone. */
    const guarded = isError ? { text: content, findings: [] as TripwireVerdict[] } : runTripwires('content', content)
    for (const finding of guarded.findings) this.recordTripwire(task, 'content', finding)
    task.messages.push({
      id: newId('msg'),
      role: 'tool',
      content: guarded.text,
      createdAt: nowIso(),
      toolCallId: call.id,
      name: call.name,
      error: isError
    })
  }

  private async reconcileToolResults(task: Task): Promise<void> {
    const results = new Set(
      task.messages
        .filter((message) => message.role === 'tool' && message.toolCallId)
        .map((message) => message.toolCallId as string)
    )
    for (const message of [...task.messages]) {
      if (message.role !== 'assistant') continue
      for (const call of message.toolCalls ?? []) {
        if (results.has(call.id)) continue
        task.messages.push({
          id: newId('msg'),
          role: 'tool',
          content: 'Tool did not return a result because the run was interrupted.',
          createdAt: nowIso(),
          toolCallId: call.id,
          name: call.name,
          error: true,
          hidden: true
        })
        results.add(call.id)
      }
    }
  }

  async registerArtifact(
    task: Task,
    absPath: string,
    previewAbsPath?: string,
    messageId?: string
  ): Promise<Artifact | null> {
    const workspace = ensureTaskWorkspace(task.id)
    if (!isWithin(workspace, absPath)) return null
    let size = 0
    try {
      size = (await fs.stat(absPath)).size
    } catch {
      return null
    }
    const relPath = relative(workspace, absPath).replace(/\\/g, '/')
    const previewRelPath =
      previewAbsPath && isWithin(workspace, previewAbsPath)
        ? relative(workspace, previewAbsPath).replace(/\\/g, '/')
        : undefined

    const existing = task.artifacts.find((artifact) => artifact.relPath === relPath)
    const resolvedMessageId =
      messageId ||
      [...task.messages].reverse().find((m) => m.role === 'assistant')?.id ||
      existing?.messageId
    const artifact: Artifact = {
      id: existing?.id ?? newId('artifact'),
      name: basename(absPath),
      relPath,
      previewRelPath,
      kind: artifactKindForPath(absPath),
      mimeType: mimeForPath(absPath),
      size,
      createdAt: existing?.createdAt ?? nowIso(),
      messageId: resolvedMessageId
    }
    task.artifacts = task.artifacts.filter((item) => item.relPath !== relPath)
    task.artifacts.push(artifact)
    await store.saveTask(task)
    sendTaskEvent({ type: 'artifact', taskId: task.id, artifact })
    this.publish(task)
    return artifact
  }

  private async copyAttachments(task: Task, refs: AttachmentRef[]): Promise<AttachmentRef[]> {
    if (!refs.length) return []
    const workspace = ensureTaskWorkspace(task.id)
    const dir = join(workspace, 'attachments')
    await fs.mkdir(dir, { recursive: true })
    const copied: AttachmentRef[] = []

    for (const ref of refs) {
      if (!ref.path) continue
      try {
        const stat = await fs.stat(ref.path)
        const safeName = basename(ref.path).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')

        if (stat.isDirectory()) {
          // Auto-grant folder to task roots if not already granted
          if (!task.folders.some((f) => isWithin(f, ref.path) && isWithin(ref.path, f))) {
            task.folders.push(ref.path)
          }
          const destination = join(dir, safeName)
          await fs.cp(ref.path, destination, { recursive: true }).catch(() => undefined)
          copied.push({
            id: newId('attachment'),
            name: ref.name?.trim() || basename(ref.path),
            path: destination,
            relPath: relative(workspace, destination).replace(/\\/g, '/'),
            size: 0,
            mimeType: 'inode/directory'
          })
          continue
        }

        if (!stat.isFile()) continue
        let destination: string
        if (isWithin(workspace, ref.path)) {
          destination = ref.path
        } else {
          destination = join(dir, `${newId('att').slice(0, 16)}-${safeName}`)
          await fs.copyFile(ref.path, destination)
        }

        // If it's a zip archive, auto-unpack it alongside so its files are immediately readable
        if (ref.path.toLowerCase().endsWith('.zip')) {
          try {
            const zipBuffer = await fs.readFile(destination)
            const zip = await JSZip.loadAsync(zipBuffer)
            const unpackDir = join(dir, `${basename(safeName, '.zip')}_unpacked`)
            await fs.mkdir(unpackDir, { recursive: true })
            for (const [relFile, zipEntry] of Object.entries(zip.files)) {
              if (zipEntry.dir) {
                await fs.mkdir(join(unpackDir, relFile), { recursive: true })
              } else {
                await fs.mkdir(join(unpackDir, relFile, '..'), { recursive: true })
                const fileBuf = await zipEntry.async('nodebuffer')
                await fs.writeFile(join(unpackDir, relFile), fileBuf)
              }
            }
          } catch (zipErr) {
            console.warn('[attachments] could not auto-unpack zip:', zipErr)
          }
        }

        copied.push({
          id: newId('attachment'),
          name: ref.name?.trim() || basename(ref.path),
          path: destination,
          relPath: relative(workspace, destination).replace(/\\/g, '/'),
          size: stat.size,
          mimeType: ref.mimeType ?? mimeForPath(destination)
        })
      } catch {
        // Skip files that disappeared or cannot be read.
      }
    }
    return copied
  }

  private async finish(task: Task, status: 'done' | 'paused'): Promise<void> {
    task.status = status
    if (status === 'done') {
      task.completedAt = nowIso()
      task.plan = task.plan.map((item) => ({ ...item, status: 'done' as const }))
    }
    await this.commit(task)
  }

  private async commit(task: Task): Promise<void> {
    await store.saveTask(task)
    this.publish(task)
  }

  private publish(task: Task): void {
    sendTaskEvent({ type: 'task', task })
  }
}

/** Bridge scopes pick a task out of the tool name the engine sends back. */
function engineScope(taskId: string): string {
  return `t${taskId.replace(/[^a-zA-Z0-9]/g, '').slice(-10)}`
}

/** The engine gets this as a session instruction; this adds its one rule. */
function engineSystemPrompt(system: string): string {
  return `${system}

## Execution engine
This session runs on SelfImpulse's execution engine. Every file, shell, web, MCP and integration action must use the selfimpulse_* tools, which run through SelfImpulse's governance, approvals and diff review. The engine's own edit, read and shell tools are disabled on purpose. The one exception is its subagent tool: handing a job to a specialist is the engine's own work, and the specialist uses those same selfimpulse_* tools inside this workspace.`
}

/** Conversation a task had before its first engine turn, sent once as context. */
function renderSeedTranscript(history: ModelMessage[]): string {
  const lines = history
    .filter(
      (message) =>
        (message.role === 'user' || message.role === 'assistant') && message.content?.trim()
    )
    .map(
      (message) =>
        `${message.role === 'user' ? 'User' : 'Assistant'}: ${(message.content ?? '').trim()}`
    )
    .join('\n\n')
  if (!lines) return ''
  const tail = lines.length > 12_000 ? lines.slice(-12_000) : lines
  return `<earlier-conversation>\n${tail}\n</earlier-conversation>`
}

function approvalDetails(tool: AgentTool, args: Record<string, unknown>): string {
  if (tool.name === 'run_command' && typeof args.command === 'string') {
    return truncate(args.command, 4000)
  }
  try {
    return truncate(JSON.stringify(args, null, 2), 4000)
  } catch {
    return ''
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim()) ?? value
}

/** The index of the last message the user actually wrote (attachments are hidden). */
function findLastUserIndex(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'user' && !message.hidden) return index
  }
  return -1
}

const MUTATING_TOOLS = new Set([  'write_file',
  'edit_file',
  'delete_path',
  'move_path',
  'make_directory',
  'create_document',
  'create_pdf',
  'create_presentation',
  'create_spreadsheet'
])

/**
 * The paths a tool call touched. The engine's verify gates use this to keep
 * the turn alive until the edited files actually check out.
 */
function mutatedPathsFor(toolName: string, args: Record<string, unknown>): string[] | undefined {
  if (!MUTATING_TOOLS.has(toolName)) return undefined
  const out: string[] = []
  for (const key of ['path', 'file', 'filePath', 'from', 'to', 'target']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) out.push(value)
  }
  return out.length ? out : undefined
}

export const agentRuntime = new AgentRuntime()
