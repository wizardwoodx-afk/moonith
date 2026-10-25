import { promises as fs } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { z } from 'zod'
import type {
  Artifact,
  AttachmentRef,
  ChatMessage,
  PlanItem,
  PublicSettings,
  SendMessageInput,
  StepRecord,
  SubAgentStep,
  Task,
  ToolCallInfo
} from '@shared/types'
import { approvals } from '../approvals'
import { sendTaskEvent, toast } from '../emitter'
import { store } from '../store'
import { ensureTaskWorkspace, getPaths } from '../paths'
import { isWithin } from '../security'
import { newId, nowIso, truncate } from '../util'
import { addUsage } from './types'
import { providerError } from './providers'
import { buildSystemPrompt } from './prompt'
import { getBuiltinTools } from './tools'
import type { AgentTool, ToolContext } from './tools/types'
import { artifactKindForPath, mimeForPath } from '../services/documents'
import { mcpManager } from '../services/mcp'
import { connectorsManager } from '../services/connectors'
import { memoryService } from '../services/memory'
import { skillService } from '../services/skills'
import { subAgentService } from '../services/subagents'
import { usageService } from '../services/usage'
import { governanceService, type GovernanceActor } from '../services/governance'
import { runEngineTurn, toEngineHistory, turnFailureMessage, type ToolOutcome } from './engine'
import { getBackend } from '../backend'
import { backendSkillsDir } from '../backend/paths'
import { Provider, resolveConfig } from '../backend/provider'
import { DurableStore } from '../selfimpulse/durable/index'
import type { DurableContext, DurableEvent } from '../selfimpulse/durable/index'
import { createStep, executeStep } from '../selfimpulse/workflow/index'
import { TurnInputQueue } from '../selfimpulse/impulseRuntime/index'
import {
  runCrewHandoffs,
  type CrewDelegation,
  type CrewJob
} from '../selfimpulse/crewMesh/index'
import { authorizeNativeTaskTool } from '../enterpriseControl/runtime'
import {
  browserScope as coworkerBrowserScope,
  ensureCoworkerWorkspace,
  handoffCoworkerArtifact
} from '../selfimpulse/coworker/workspaces'

let durableStore: DurableStore | undefined

function getDurableStore(): DurableStore {
  durableStore ??= new DurableStore(getPaths().durable)
  return durableStore
}

interface RunState {
  taskId: string
  controller: AbortController
  stopped: boolean
  steering: TurnInputQueue<ChatMessage>
}

/** Existing task-role RBAC and native enterprise policy are both mandatory. */
async function enterpriseToolDenial(
  task: Task,
  actor: GovernanceActor,
  tool: AgentTool
): Promise<string | null> {
  if (actor.actor === 'system') return 'Enterprise Control Plane has no agent identity for this action.'
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

const MAX_ROUNDS = 50
const MAX_STEPS = 500
const MAX_CREW_JOBS = 4

const crewJobSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .describe('Short specialist name, for example "Docs Scout" or "Test Runner".'),
    purpose: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .optional()
      .describe('One short phrase describing why this specialist is useful.'),
    instruction: z
      .string()
      .trim()
      .min(1)
      .max(8000)
      .describe('A self-contained brief: what to inspect or do, and what to report back.')
  })
  .strict()

const crewDelegationSchema = z.union([
  crewJobSchema,
  z
    .object({
      jobs: z
        .array(crewJobSchema)
        .min(1)
        .max(MAX_CREW_JOBS)
        .describe('Independent specialist jobs to run as one supervised Crew Mesh team.')
    })
    .strict()
])

type CrewDelegationInput = z.infer<typeof crewDelegationSchema>

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
  return `The user attached these files. They are copied into the task workspace and can be read with file tools:\n${lines.join('\n')}`
}

class AgentRuntime {
  private runs = new Map<string, RunState>()

  isRunning(taskId: string): boolean {
    return this.runs.has(taskId)
  }

  /** Recover only active work. Paused tasks remain under explicit user control. */
  async recoverActiveTasks(): Promise<void> {
    const active = store
      .listTasks()
      .filter((task) => task.status === 'running' || task.status === 'waiting')
    for (const task of active) {
      if (!this.runs.has(task.id)) await this.resume(task.id)
    }
  }

  async flushDurability(): Promise<void> {
    await durableStore?.flush()
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

    if (active) {
      for (const message of incoming) active.steering.enqueue(message)
    } else {
      task.status = 'running'
      task.error = undefined
      task.completedAt = undefined
    }
    await store.saveTask(task)
    this.publish(task)

    if (!active) this.launch(task.id)
    return task
  }

  async steer(input: SendMessageInput): Promise<Task> {
    return this.sendMessage(input)
  }

  async stop(taskId: string): Promise<void> {
    const task = store.getTask(taskId)
    if (!task) return
    governanceService.audit(
      task,
      { actor: 'system', actorId: 'local-user' },
      'task.stop_requested',
      'info'
    )
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
    this.prepareReplay(task)
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
    void this.loop(taskId, state)
  }

  private async loop(taskId: string, run: RunState): Promise<void> {
    const task = this.requireTask(taskId)
    try {
      await this.reconcileToolResults(task)
      await this.commit(task)

      const settings = store.getPublicSettings()
      const provider = this.resolveEngineProvider(task, settings)
      const allTools = await this.collectTools(task, run, provider, settings)
      const tools = governanceService.permittedTools(task, allTools)
      /* Keep the complete map for the second, action-time check. A cached or
       * injected call for a hidden tool must receive a policy denial, not an
       * ambiguous "unknown tool" response. */
      const toolMap = new Map(allTools.map((tool) => [tool.name, tool]))
      const skills = await skillService.promptIndex().catch(() => '')
      const lastUser = [...task.messages]
        .reverse()
        .find((message) => message.role === 'user' && !message.hidden)?.content
      const memory = await memoryService
        .promptIndex(`${task.title}\n${task.objective}\n${lastUser ?? ''}`, task.folders)
        .catch(() => '')
      const system = `${buildSystemPrompt({
        task,
        workspace: ensureTaskWorkspace(task.id),
        settings,
        skills,
        memory
      })}\n\nEnterprise agent role: ${governanceService.role(task)}. Only tools granted to this role are listed. If a previously planned action is denied by policy, do not retry it or attempt to bypass the boundary; explain the limitation and choose an allowed alternative.`

      const backend = getBackend()

      // The ImpulseCore core takes the transcript up to the last user message,
      // and the user message itself.
      const lastUserIndex = findLastUserIndex(task.messages)
      const userMessage = lastUserIndex >= 0 ? task.messages[lastUserIndex] : undefined
      const history = toEngineHistory(
        task.messages.slice(0, lastUserIndex < 0 ? task.messages.length : lastUserIndex)
      )
      const durableRunId = `captain:${task.id}:${userMessage?.id ?? 'no-user'}`
      const durable = await getDurableStore().context(durableRunId, {
        signal: run.controller.signal,
        onEvent: (event) => this.handleDurableEvent(task, event)
      })

      if (task.status !== 'running') {
        task.status = 'running'
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

      const toolContext = this.createToolContext(task, settings, durableRunId)
      const context = [skills, memory].filter(Boolean).join('\n\n')
      // Messages already represented by this initial history/userMessage pair
      // must not be injected a second time at the first prepare checkpoint.
      const representedSteering = run.steering.drain()
      for (const message of representedSteering) run.steering.commit(message)
      let drainedSteering: ChatMessage[] = []

      const result = await runEngineTurn({
        provider,
        tools,
        durable,
        protectModelMessages: (messages) =>
          governanceService.protectModelMessages(
            task,
            { actor: 'captain', actorId: 'Captain', runId: durableRunId },
            messages
          ),
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
        onText: (delta) => {
          assistantMessage.content += delta
          sendTaskEvent({
            type: 'delta',
            taskId: task.id,
            messageId: assistantMessage.id,
            delta
          })
        },
        onTool: async (callId, name, args) =>
          this.executeToolCall(
            task,
            toolMap,
            { id: callId, name, arguments: args },
            run,
            toolContext,
            assistantMessage.id,
            durable
          ),
        emit: (event, payload) => this.handleEngineEvent(task, event, payload)
      })

      assistantMessage.content = result.finalResponse || assistantMessage.content
      if (!durable.hasCompleted('telemetry:usage')) {
        const previousUsage = task.usage
        await durable.run('telemetry:usage', async () => {
          task.usage = addUsage(previousUsage, {
            input: result.usage.prompt,
            output: result.usage.completion,
            total: result.usage.total
          })
          await usageService
            .record({
              agentId: 'Captain',
              providerId: provider.settings.providerId ?? 'knight',
              model: provider.settings.model ?? '',
              usage: {
                input: result.usage.prompt,
                output: result.usage.completion,
                total: result.usage.total
              }
            })
            .catch(() => undefined)
          // Persist the usage and final transcript before the journal marks
          // this telemetry step complete. Replay then skips both additions.
          await this.commit(task)
        })
      }
      await this.commit(task)
      if (run.stopped) return
      if (result.stopReason === 'interrupted') {
        await this.finish(task, 'paused')
        governanceService.audit(
          task,
          { actor: 'captain', actorId: 'Captain', runId: durableRunId },
          'task.paused',
          'info'
        )
        return
      }
      const failure = turnFailureMessage(result)
      if (failure) throw new Error(failure)
      if (run.steering.hasItems()) return
      await this.finish(task, 'done')
      governanceService.audit(
        task,
        { actor: 'captain', actorId: 'Captain', runId: durableRunId },
        'task.completed',
        'ok'
      )
    } catch (error) {
      if (run.stopped) {
        await this.commit(task).catch(() => undefined)
        return
      }
      task.error = providerError(error)
      task.status = 'error'
      governanceService.audit(
        task,
        { actor: 'captain', actorId: 'Captain' },
        'task.failed',
        'error',
        undefined,
        task.error
      )
      await this.commit(task).catch(() => undefined)
      toast('error', task.error)
    } finally {
      this.runs.delete(taskId)
      if (!run.stopped && run.steering.hasItems()) {
        task.status = 'running'
        task.error = undefined
        task.completedAt = undefined
        await store.saveTask(task).catch(() => undefined)
        this.publish(task)
        if (!this.runs.has(taskId)) this.launch(taskId)
        return
      }
      if (!this.runs.has(taskId) && !run.stopped && task.status === 'running') {
        task.status = 'done'
        task.completedAt = nowIso()
        await store.saveTask(task).catch(() => undefined)
        this.publish(task)
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
    const delegate: AgentTool = {
      name: 'delegate_to_crew',
      title: 'Delegate to Crew Mesh',
      description:
        'Hand one focused job, or a jobs array with up to four independent jobs, to named Crew specialists. ' +
        `Specialists work with ${task.permissionMode === 'skip' ? 'read and write tools' : 'read-only tools'} ` +
        'in this task workspace, run with bounded parallelism, and report back to you without speaking to the user. ' +
        'Give every job a self-contained instruction and an optional short purpose. Do not use Crew to ask the user anything.',
      inputSchema: z.toJSONSchema(crewDelegationSchema, {
        unrepresentable: 'any'
      }) as Record<string, unknown>,
      schema: crewDelegationSchema,
      sideEffect: 'network',
      risk: 'low',
      approval: 'never',
      execute: async (args: CrewDelegationInput, context) => {
        const jobs: CrewJob[] = 'jobs' in args ? args.jobs : [args]
        const batchId = context.callId ?? newId('crew-batch')
        if (jobs.length > 1) {
          context.toast(
            'info',
            `Crew Mesh is supervising ${jobs.length} specialists with up to 3 active at once.`
          )
        }
        const results = await runCrewHandoffs(
          jobs,
          (job, delegation) =>
            this.runSubAgent(
              task,
              run,
              provider,
              job,
              [...base, readSkill],
              context,
              delegation
            ),
          { batchId, signal: run.controller.signal, maxConcurrency: 3 }
        )
        if (jobs.length === 1) return results[0]
        return {
          content: results.map((result) => result.content).join('\n\n---\n\n'),
          // Partial team success remains usable; every individual report keeps its own error state.
          isError: results.every((result) => result.isError)
        }
      },
      summarize: (args: CrewDelegationInput) => {
        const jobs: CrewJob[] = 'jobs' in args ? args.jobs : [args]
        return jobs.length === 1
          ? `${jobs[0].name} · ${truncate(jobs[0].instruction, 160)}`
          : `Crew Mesh · ${jobs.map((job) => job.name).join(', ')}`
      }
    }
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
    for (const tool of [...base, readSkill, delegate]) {
      byName.set(tool.name, tool)
    }
    return [...byName.values()]
  }

  private async runSubAgent(
    task: Task,
    parent: RunState,
    provider: Provider,
    job: CrewJob,
    tools: AgentTool[],
    context: ToolContext,
    delegation?: CrewDelegation
  ): Promise<{ content: string; isError?: boolean }> {
    const { name, instruction, purpose } = job
    const run = await subAgentService.begin({
      id: context.callId
        ? `${context.durableRunId ?? `captain:${task.id}`}:crew:${context.callId}${
            delegation && delegation.batchSize > 1 ? `:job-${delegation.jobIndex + 1}` : ''
          }`
        : undefined,
      taskId: task.id,
      taskTitle: task.title,
      name,
      instruction,
      provider: provider.settings.providerId ?? 'knight',
      model: provider.settings.model ?? '',
      purpose,
      isolation: { workspace: 'private', browser: 'per-run' },
      agentPath: delegation?.agentPath ?? ['Captain', name],
      depth: delegation?.depth ?? 1,
      batchId: delegation?.batchId,
      batchSize: delegation?.batchSize ?? 1,
      jobIndex: delegation?.jobIndex ?? 0
    })
    const actor: GovernanceActor = {
      actor: 'crew',
      actorId: run.id,
      runId: `crew:${run.id}`
    }
    governanceService.audit(
      task,
      actor,
      'crew.started',
      'info',
      name,
      undefined,
      { instructionHash: governanceService.payloadHash(instruction) }
    )
    // Sub-agents never prompt, so 'always' tools are withheld from them entirely.
    // Role filtering is intersected with (never unioned with) this restriction.
    const crewCandidates = tools.filter((tool) => tool.name !== 'delegate_to_crew')
    const allowed = governanceService
      .permittedTools(task, crewCandidates)
      .filter(
        (tool) =>
          tool.approval === 'never' ||
          (tool.approval === 'policy' && task.permissionMode === 'skip')
      )
    const allowedNames = new Set(allowed.map((tool) => tool.name))
    const toolMap = new Map(crewCandidates.map((tool) => [tool.name, tool]))
    const sharedWorkspace = ensureTaskWorkspace(task.id)
    const workspace = ensureCoworkerWorkspace(task.id, run.id)
    const writeRoots = [...new Set([workspace, ...task.folders])]
    const readRoots = [...new Set([workspace, sharedWorkspace, ...task.folders])]
    const system = `You are ${name}, a Crew specialist inside SelfImpulse. The Captain delegated one focused job to you.
Specialist purpose: ${purpose ?? 'Focused delegated work'}.
Do the job with the tools you have, verify what you can, then reply with a compact report: findings, file paths, and anything the Captain must know.
You never address the user directly, never ask questions, and never claim work you did not do.
Private workspace (your writes): ${workspace}
Shared task workspace (read-only): ${sharedWorkspace}
Granted folders:
${task.folders.map((root) => `- ${root}`).join('\n') || '- None'}
${task.permissionMode === 'skip' ? 'Write access is allowed only inside your private workspace and explicitly granted folders.' : 'This job is read-only: do not modify files or run shell commands.'}
Inherited enterprise role: ${governanceService.role(task)}. Your tools are the intersection of that role and the Crew restrictions above; delegation cannot widen them.`
    const subContext: ToolContext = {
      ...context,
      workspace,
      roots: writeRoots,
      readRoots,
      browserScope: coworkerBrowserScope(task.id, run.id),
      browserLabel: `Crew · ${name}`,
      actor: 'crew',
      setPlan: () => undefined,
      addArtifact: async (absPath, previewAbsPath) => {
        // Explicitly granted folders may be edited directly, but only a file
        // from the private workspace is eligible for shared artifact handoff.
        // Do not turn a successful external write into a post-write error or
        // copy user files into the task without an explicit handoff.
        const promoted = await handoffCoworkerArtifact(absPath, workspace, sharedWorkspace, run.id)
        if (!promoted) return null
        const promotedPreview = previewAbsPath
          ? ((await handoffCoworkerArtifact(previewAbsPath, workspace, sharedWorkspace, run.id)) ?? undefined)
          : undefined
        return this.registerArtifact(task, promoted, promotedPreview)
      }
    }
    const backend = getBackend()

    try {
      const durable = await getDurableStore().context(`crew:${run.id}`, {
        signal: parent.controller.signal,
        onEvent: (event) => this.handleDurableEvent(task, event)
      })
      const result = await runEngineTurn({
        provider,
        tools: allowed,
        durable,
        protectModelMessages: (messages) =>
          governanceService.protectModelMessages(task, actor, messages),
        systemPrompt: system,
        history: [],
        userMessage: instruction,
        memoryStore: backend.store.memories,
        skillsDir: backendSkillsDir(),
        config: {
          maxIterations: 8,
          delegationMaxIterations: 0,
          skillNudgeInterval: 10,
          memoryNudgeInterval: 15,
          backgroundReview: false,
          temperature: 0.2,
          maxOutputTokens: 4096
        },
        signal: parent.controller.signal,
        onText: () => undefined,
        onTool: async (callId, toolName, args) => {
          if (parent.stopped) {
            return { content: 'The parent task was stopped.', isError: true }
          }
          const tool = toolMap.get(toolName)
          const stepId = newId('step')
          if (!tool) {
            run.steps.push({
              id: stepId,
              tool: toolName,
              title: toolName,
              status: 'error',
              detail: 'Unknown tool',
              at: nowIso()
            })
            governanceService.audit(
              task,
              actor,
              'tool.completed',
              'error',
              toolName,
              'Unknown tool'
            )
            await subAgentService.saveRun(run, {
              type: 'tool_finished',
              label: `${toolName} refused`
            })
            return { content: `Unknown tool "${toolName}".`, isError: true }
          }
          const decision = governanceService.authorize(task, actor, tool)
          let denial = decision.allowed ? null : decision.reason
          if (!denial && !allowedNames.has(tool.name)) {
            denial = 'The Crew no-prompt boundary does not grant this tool to sub-agents.'
            governanceService.audit(
              task,
              actor,
              'crew.policy',
              'denied',
              tool.name,
              denial
            )
          }
          if (!denial) denial = await enterpriseToolDenial(task, actor, tool)
          if (denial) {
            run.steps.push({
              id: stepId,
              tool: tool.name,
              title: tool.title,
              status: 'error',
              detail: denial,
              at: nowIso()
            })
            await subAgentService.saveRun(run, {
              type: 'tool_finished',
              label: `${tool.title} denied by policy`
            })
            return { content: `Policy denied ${tool.name}: ${denial}`, isError: true }
          }
          const record: SubAgentStep = {
            id: stepId,
            tool: tool.name,
            title: tool.title,
            detail: tool.summarize
              ? tool.summarize(args)
              : truncate(JSON.stringify(args), 240),
            status: 'running',
            at: nowIso()
          }
          run.steps.push(record)
          await subAgentService.saveRun(run, {
            type: 'tool_started',
            label: tool.title
          })
          let content = ''
          let isError = false
          try {
            let parsedArgs: unknown = args
            if (tool.schema) {
              const parsed = tool.schema.safeParse(args)
              if (!parsed.success) {
                throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '))
              }
              parsedArgs = parsed.data
            }
            const protection = governanceService.protectToolArguments(
              task,
              actor,
              tool,
              parsedArgs as Record<string, unknown>
            )
            parsedArgs = protection.args
            record.detail = tool.summarize
              ? tool.summarize(parsedArgs)
              : truncate(JSON.stringify(parsedArgs), 240)
            governanceService.audit(
              task,
              actor,
              'tool.started',
              'info',
              tool.name,
              undefined,
              { callId, argsHash: governanceService.payloadHash(parsedArgs) }
            )
            const outcome = await tool.execute(parsedArgs, { ...subContext, callId })
            content = truncate(outcome.content, 30000)
            isError = Boolean(outcome.isError)
          } catch (error) {
            content = `Tool error: ${error instanceof Error ? error.message : String(error)}`
            isError = true
          }
          governanceService.audit(
            task,
            actor,
            'tool.completed',
            isError ? 'error' : 'ok',
            tool.name,
            isError ? content : undefined,
            { callId, outputHash: governanceService.payloadHash(content) }
          )
          record.status = isError ? 'error' : 'ok'
          record.detail = isError ? truncate(content, 400) : record.detail
          await subAgentService.saveRun(run, {
            type: 'tool_finished',
            label: `${tool.title} ${isError ? 'failed' : 'finished'}`
          })
          return { content, isError }
        },
        emit: (event, payload) => this.recordEngineAudit(task, actor, event, payload)
      })
      run.usage = {
        prompt: result.usage.prompt,
        completion: result.usage.completion,
        total: result.usage.total
      }

      if (!durable.hasCompleted('telemetry:usage')) {
        await durable.run('telemetry:usage', async () => {
          await usageService
            .record({
              agentId: `Crew · ${name}`,
              providerId: provider.settings.providerId ?? 'knight',
              model: provider.settings.model ?? '',
              usage: {
                input: result.usage.prompt,
                output: result.usage.completion,
                total: result.usage.total
              }
            })
            .catch(() => undefined)
        })
      }

      if (parent.stopped || result.stopReason === 'interrupted') {
        await subAgentService.finish(run, 'stopped', { error: 'The parent task was stopped.' })
        governanceService.audit(task, actor, 'crew.completed', 'info', name, 'Stopped')
        return { content: `${name} stopped because the task was stopped.`, isError: true }
      }
      const failure = turnFailureMessage(result)
      if (failure) throw new Error(failure)

      const summary =
        (result.finalResponse ?? '').trim() || `${name} finished without a written report.`
      run.summary = truncate(summary, 8000)
      await subAgentService.finish(run, 'done', { summary: run.summary })
      governanceService.audit(task, actor, 'crew.completed', 'ok', name, undefined, {
        summaryHash: governanceService.payloadHash(run.summary)
      })
      return { content: `Crew report from ${name}:\n\n${truncate(summary, 20000)}` }
    } catch (error) {
      if (parent.stopped) {
        await subAgentService.finish(run, 'stopped', { error: 'The parent task was stopped.' })
        governanceService.audit(task, actor, 'crew.completed', 'info', name, 'Stopped')
        return { content: `${name} stopped because the task was stopped.`, isError: true }
      }
      const message = error instanceof Error ? error.message : String(error)
      await subAgentService.finish(run, 'error', { error: message })
      governanceService.audit(task, actor, 'crew.completed', 'error', name, message)
      return { content: `Crew sub-agent failed: ${message}`, isError: true }
    }
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
    if (stored && !apiKey) {
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

  private recordEngineAudit(
    task: Task,
    actor: GovernanceActor,
    event: string,
    payload: unknown
  ): void {
    const data = (payload ?? {}) as Record<string, unknown>
    const turnId = typeof data.turnId === 'string' ? data.turnId : undefined
    switch (event) {
      case 'provider:attempt':
        governanceService.audit(
          task,
          actor,
          'model.provider',
          'info',
          String(data.providerId ?? 'unknown'),
          undefined,
          { turnId, model: data.model }
        )
        break
      case 'agent:turn_done':
        governanceService.audit(
          task,
          actor,
          'turn.completed',
          data.stopReason === 'error' ? 'error' : 'ok',
          String(data.stopReason ?? 'unknown'),
          undefined,
          {
            turnId,
            apiCallCount: data.apiCallCount,
            toolCalls: data.toolCalls,
            usage: data.usage
          }
        )
        break
      case 'agent:error':
        governanceService.audit(
          task,
          actor,
          'model.error',
          'error',
          undefined,
          String(data.error ?? 'The model call failed.'),
          { turnId }
        )
        break
      case 'agent:review_done':
        governanceService.audit(task, actor, 'review.completed', 'ok', undefined, undefined, {
          turnId,
          wrote: data.wrote
        })
        break
      case 'agent:repetition_guard':
        governanceService.audit(
          task,
          actor,
          'turn.repetition_guard',
          'error',
          undefined,
          String(data.message ?? 'Repetitive model output was stopped.')
        )
        break
      case 'agent:crew_parallel':
        governanceService.audit(task, actor, 'crew.parallel', 'info', undefined, undefined, {
          turnId,
          count: data.count,
          callIds: data.callIds
        })
        break
      default:
        break
    }
  }

  /** ImpulseCore's own events, mapped onto the task surface the renderer sees. */
  private handleEngineEvent(task: Task, event: string, payload: unknown): void {
    this.recordEngineAudit(
      task,
      { actor: 'captain', actorId: 'Captain' },
      event,
      payload
    )
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
      case 'agent:crew_parallel':
        toast('info', `Running ${Number(data.count ?? 2)} Crew agents in parallel.`)
        break
      case 'provider:attempt':
        if (data.providerId) toast('info', `Using ${String(data.providerId)}.`)
        break
      case 'agent:durable':
        if (data.type === 'step_retry') {
          toast('info', `Retrying ${String(data.key ?? 'a durable step')}…`)
        }
        break
      case 'agent:workflow_step':
        if (data.kind === 'approval' && data.type === 'step_replayed') {
          toast('info', 'Using the recorded approval decision.')
        }
        break
      case 'agent:error':
        toast('error', String(data.error ?? 'The agent run failed.'))
        break
      default:
        break
    }
  }

  private handleDurableEvent(task: Task, event: DurableEvent): void {
    this.handleEngineEvent(task, 'agent:durable', event)
  }

  private createToolContext(
    task: Task,
    settings: PublicSettings,
    durableRunId: string
  ): ToolContext {
    const workspace = ensureTaskWorkspace(task.id)
    const roots = [...new Set([workspace, ...task.folders])]
    return {
      task,
      workspace,
      roots,
      readRoots: roots,
      browserScope: coworkerBrowserScope(task.id),
      browserLabel: 'Captain',
      actor: 'captain',
      allowShell: settings.allowShell,
      durableRunId,
      addArtifact: (absPath, previewAbsPath) =>
        this.registerArtifact(task, absPath, previewAbsPath),
      setBrowser: (state) => {
        task.browser = state
        sendTaskEvent({ type: 'browser', taskId: task.id, browser: state })
      },
      setPlan: (steps) => {
        task.plan = mergePlan(task.plan, steps)
      },
      toast: (level, message) => toast(level, message)
    }
  }

  private async executeToolCall(
    task: Task,
    toolMap: Map<string, AgentTool>,
    call: ToolCallInfo,
    run: RunState,
    context: ToolContext,
    messageId: string,
    durable?: DurableContext
  ): Promise<ToolOutcome> {
    const tool = toolMap.get(call.name)
    const rawArgs = (call.arguments ?? {}) as Record<string, unknown>
    const actor: GovernanceActor = {
      actor: 'captain',
      actorId: 'Captain',
      runId: durable?.runId ?? `captain:${task.id}`
    }
    const assistantMessage = task.messages.find(
      (message) => message.id === messageId && message.role === 'assistant'
    )
    if (assistantMessage && !(assistantMessage.toolCalls ?? []).some((item) => item.id === call.id)) {
      assistantMessage.toolCalls = [...(assistantMessage.toolCalls ?? []), call]
    }

    if (!tool) {
      const content = `Unknown tool "${call.name}".`
      governanceService.audit(task, actor, 'tool.completed', 'error', call.name, content)
      this.appendToolMessage(task, call, content, true)
      await this.commit(task)
      return { content, isError: true }
    }

    const decision = governanceService.authorize(task, actor, tool)
    let denial = decision.allowed ? null : decision.reason
    if (!denial) denial = await enterpriseToolDenial(task, actor, tool)
    if (denial) {
      const content = `Policy denied ${tool.name}: ${denial} Do not retry or bypass this action.`
      task.steps.push({
        id: newId('step'),
        tool: tool.name,
        title: tool.title,
        detail: denial,
        status: 'error',
        error: 'Denied by agent role policy',
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
        governanceService.audit(
          task,
          actor,
          'tool.completed',
          'error',
          tool.name,
          content,
          { callId: call.id, argsHash: governanceService.payloadHash(rawArgs) }
        )
        this.appendToolMessage(task, call, content, true)
        await this.commit(task)
        return { content, isError: true }
      }
      args = parsed.data
    }

    let effectiveRawArgs = rawArgs
    try {
      const protection = governanceService.protectToolArguments(
        task,
        actor,
        tool,
        args as Record<string, unknown>
      )
      args = protection.args
      effectiveRawArgs = protection.args
    } catch (error) {
      const content = error instanceof Error ? error.message : String(error)
      task.steps.push({
        id: newId('step'),
        tool: tool.name,
        title: tool.title,
        detail: 'Blocked by data-loss prevention before tool execution',
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
      detail: tool.summarize ? tool.summarize(args) : truncate(JSON.stringify(effectiveRawArgs), 240),
      status: 'waiting',
      args: effectiveRawArgs,
      messageId,
      startedAt: nowIso()
    }
    task.steps.push(step)
    if (task.steps.length > MAX_STEPS) {
      task.steps.splice(0, task.steps.length - MAX_STEPS)
    }

    // 'always' tools (shell, recursive delete) ask in every mode, including skip.
    // Only an explicit per-task "always allow" for this tool bypasses the prompt.
    const alwaysAllowed = tool.allowAlways !== false && approvals.isAlwaysAllowed(task.id, tool.name)
    const needsApproval =
      tool.approval !== 'never' &&
      !alwaysAllowed &&
      (tool.approval === 'always' ||
        task.permissionMode === 'manual' ||
        (task.permissionMode !== 'skip' && tool.risk === 'high'))

    if (needsApproval) {
      step.status = 'waiting'
      task.status = 'waiting'
      await this.commit(task)

      const requestApproval = () => {
        governanceService.audit(
          task,
          actor,
          'approval.requested',
          'requested',
          tool.name,
          step.detail || tool.title,
          { callId: call.id, argsHash: governanceService.payloadHash(effectiveRawArgs) }
        )
        return approvals.request(task.id, {
          tool: tool.name,
          title: tool.title,
          summary: step.detail || tool.title,
          details: approvalDetails(tool, effectiveRawArgs),
          risk: tool.risk,
          allowAlways: tool.allowAlways !== false,
          review: tool.approvalReview?.(effectiveRawArgs)
        })
      }
      const approved = durable
        ? await executeStep(
            createStep<void, boolean>({
              id: `approval:${call.id}`,
              execute: requestApproval
            }),
            undefined,
            {
              durable,
              signal: run.controller.signal,
              runId: durable.runId,
              validateOutput: () => {
                if (run.stopped || run.controller.signal.aborted) {
                  throw (
                    run.controller.signal.reason ?? new DOMException('The task was stopped.', 'AbortError')
                  )
                }
              },
              onEvent: (event) =>
                this.handleEngineEvent(task, 'agent:workflow_step', {
                  ...event,
                  kind: 'approval',
                  callId: call.id,
                  error:
                    event.error instanceof Error
                      ? event.error.message
                      : event.error
                        ? String(event.error)
                        : undefined
                })
            }
          )
        : await requestApproval()

      governanceService.audit(
        task,
        actor,
        run.stopped ? 'approval.cancelled' : 'approval.decision',
        run.stopped ? 'info' : approved ? 'approved' : 'denied',
        tool.name,
        undefined,
        { callId: call.id }
      )
      if (run.stopped) {
        step.status = 'error'
        step.error = 'Stopped'
        step.endedAt = nowIso()
        const content = 'Tool execution was interrupted by the user.'
        this.appendToolMessage(task, call, content, true)
        await this.commit(task)
        return { content, isError: true }
      }
      if (!approved) {
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
    }

    step.status = 'running'
    governanceService.audit(
      task,
      actor,
      'tool.started',
      'info',
      tool.name,
      undefined,
      {
        callId: call.id,
        argsHash: governanceService.payloadHash(effectiveRawArgs),
        approval: needsApproval ? 'human' : 'not-required'
      }
    )
    await this.commit(task)

    let outcome: ToolOutcome
    try {
      const result = await tool.execute(args, { ...context, callId: call.id })
      step.status = result.isError ? 'error' : 'ok'
      step.output = truncate(result.content, 6000)
      if (result.isError) step.error = truncate(firstLine(result.content), 500)
      this.appendToolMessage(task, call, truncate(result.content, 30_000), result.isError)
      outcome = {
        content: truncate(result.content, 30_000),
        isError: result.isError,
        mutatedPaths: mutatedPathsFor(tool.name, effectiveRawArgs)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      step.status = 'error'
      step.error = truncate(message, 500)
      step.output = truncate(message, 6000)
      this.appendToolMessage(task, call, `Tool error: ${message}`, true)
      outcome = { content: `Tool error: ${message}`, isError: true }
    }
    governanceService.audit(
      task,
      actor,
      'tool.completed',
      outcome.isError ? 'error' : 'ok',
      tool.name,
      step.error,
      {
        callId: call.id,
        outputHash: governanceService.payloadHash(outcome.content),
        mutatedPaths: outcome.mutatedPaths ?? [],
        durationMs: Math.max(0, Date.now() - new Date(step.startedAt).getTime())
      }
    )
    step.endedAt = nowIso()
    await this.commit(task)
    return outcome
  }

  private appendToolMessage(
    task: Task,
    call: ToolCallInfo,
    content: string,
    isError?: boolean
  ): void {
    task.messages.push({
      id: newId('msg'),
      role: 'tool',
      content,
      createdAt: nowIso(),
      toolCallId: call.id,
      name: call.name,
      error: isError
    })
  }

  /** Remove only the interrupted attempt; durable entries reconstruct it. */
  private prepareReplay(task: Task): void {
    const lastUser = findLastUserIndex(task.messages)
    if (lastUser < 0) return
    const removedMessageIds = new Set(
      task.messages
        .slice(lastUser + 1)
        .filter((message) => message.role === 'assistant' || message.role === 'tool')
        .map((message) => message.id)
    )
    if (!removedMessageIds.size) return

    task.messages = task.messages.filter(
      (message, index) =>
        index <= lastUser || (message.role !== 'assistant' && message.role !== 'tool')
    )
    for (const step of task.steps) {
      if (
        step.messageId &&
        removedMessageIds.has(step.messageId) &&
        (step.status === 'running' || step.status === 'waiting')
      ) {
        step.status = 'error'
        step.error = 'Interrupted; durable replay will retry this step.'
        step.endedAt = nowIso()
      }
    }
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
    previewAbsPath?: string
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
    const artifact: Artifact = {
      id: existing?.id ?? newId('artifact'),
      name: basename(absPath),
      relPath,
      previewRelPath,
      kind: artifactKindForPath(absPath),
      mimeType: mimeForPath(absPath),
      size,
      createdAt: existing?.createdAt ?? nowIso()
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
        if (!stat.isFile()) continue
        let destination: string
        if (isWithin(workspace, ref.path)) {
          destination = ref.path
        } else {
          const safeName = basename(ref.path).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
          destination = join(dir, `${newId('att').slice(0, 16)}-${safeName}`)
          await fs.copyFile(ref.path, destination)
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
