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
import { ensureTaskWorkspace } from '../paths'
import { isWithin } from '../security'
import { newId, nowIso, truncate } from '../util'
import { addUsage, type CompletionResult } from './types'
import { providerError, streamCompletion } from './providers'
import { buildSystemPrompt } from './prompt'
import { getBuiltinTools } from './tools'
import type { AgentTool, ToolContext } from './tools/types'
import { artifactKindForPath, mimeForPath } from '../services/documents'
import { mcpManager } from '../services/mcp'
import { composioManager } from '../services/composio'
import { memoryService } from '../services/memory'
import { skillService } from '../services/skills'
import { subAgentService } from '../services/subagents'
import { usageService } from '../services/usage'
import { isFailoverWorthy } from './failover'
import { runEngineTurn, type ToolOutcome } from './engine'
import { getBackend } from '../backend'
import { backendSkillsDir } from '../backend/paths'
import { Provider, resolveConfig } from '../backend/provider'
import type { ModelMessage } from '../backend/core/types'

interface RunState {
  taskId: string
  controller: AbortController
  stopped: boolean
  pendingSteer: boolean
}

interface ResolvedProvider {
  id: string
  name: string
  kind: 'anthropic' | 'openai' | 'compatible'
  apiKey: string
  baseUrl?: string
  model: string
}

const MAX_ROUNDS = 50
const MAX_STEPS = 500

function withoutSchemaMetadata(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _schema, ...rest } = schema
  return rest
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
  return `The user attached these files. They are copied into the task workspace and can be read with file tools:\n${lines.join('\n')}`
}

class AgentRuntime {
  private runs = new Map<string, RunState>()

  isRunning(taskId: string): boolean {
    return this.runs.has(taskId)
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
    task.messages.push(userMessage)

    if (attachments.length) {
      task.messages.push({
        id: newId('msg'),
        role: 'user',
        content: attachmentManifest(attachments),
        createdAt: nowIso(),
        hidden: true
      })
    }

    if (active) {
      active.pendingSteer = true
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
      pendingSteer: false
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
      const providers = this.resolveProviders(task, settings)
      const tools = await this.collectTools(task, run, providers, settings)
      const toolMap = new Map(tools.map((tool) => [tool.name, tool]))
      const skills = await skillService.promptIndex().catch(() => '')
      const lastUser = [...task.messages]
        .reverse()
        .find((message) => message.role === 'user' && !message.hidden)?.content
      const memory = await memoryService
        .promptIndex(`${task.title}\n${task.objective}\n${lastUser ?? ''}`, task.folders)
        .catch(() => '')
      const system = buildSystemPrompt({
        task,
        workspace: ensureTaskWorkspace(task.id),
        settings,
        skills,
        memory
      })

      const backend = getBackend()
      const provider = this.resolveEngineProvider(task, settings)

      // The Moonwright core takes the transcript up to the last user message,
      // and the user message itself.
      const lastUserIndex = findLastUserIndex(task.messages)
      const userMessage = lastUserIndex >= 0 ? task.messages[lastUserIndex] : undefined
      const history: ModelMessage[] = task.messages
        .slice(0, lastUserIndex < 0 ? task.messages.length : lastUserIndex)
        .filter((message) => message.role === 'user' || message.role === 'assistant')
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
            : {})
        }))

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

      const toolContext = this.createToolContext(task, settings)
      const context = [skills, memory].filter(Boolean).join('\n\n')

      const result = await runEngineTurn({
        provider,
        tools,
        systemPrompt: system,
        history,
        userMessage: userMessage?.content ?? '',
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
            assistantMessage.id
          ),
        emit: (event, payload) => this.handleEngineEvent(task, event, payload)
      })

      assistantMessage.content = result.finalResponse || assistantMessage.content
      task.usage = addUsage(task.usage, {
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
      await this.commit(task)
      if (run.stopped) return
      await this.finish(task, 'done')
    } catch (error) {
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
      if (!run.stopped && task.status === 'running') {
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
    providers: ResolvedProvider[],
    settings: PublicSettings
  ): Promise<AgentTool[]> {
    let mcpTools: AgentTool[] = []
    try {
      mcpTools = mcpManager.getAgentTools()
    } catch (error) {
      toast('error', `MCP tools unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
    let composioTools: AgentTool[] = []
    try {
      composioTools = await composioManager.getAgentTools()
    } catch {
      // The Composio page reports the connection error; a task should still run.
    }

    const base = [...getBuiltinTools(task.mode), ...mcpTools, ...composioTools]
    const delegate: AgentTool = {
      name: 'delegate_to_crew',
      title: 'Delegate to a Crew sub-agent',
      description:
        'Hand a focused, self-contained job to a named Crew sub-agent. The sub-agent works with ' +
        `${task.permissionMode === 'skip' ? 'read and write tools' : 'read-only tools'} in this task's workspace, ` +
        'reports findings back to you, and never speaks to the user. Use it for independent research, ' +
        'codebase inspection, or checking one specific question in parallel. Do not use it to ask the user anything.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Short role name for the sub-agent, for example "Docs Scout" or "Test Runner".'
          },
          instruction: {
            type: 'string',
            description:
              'The complete job in one self-contained brief: what to inspect, what to do, and what to report back.'
          }
        },
        required: ['name', 'instruction'],
        additionalProperties: false
      },
      schema: z.object({
        name: z.string().trim().min(1).max(60),
        instruction: z.string().trim().min(1).max(8000)
      }),
      sideEffect: 'network',
      risk: 'low',
      approval: 'never',
      execute: async (args: { name: string; instruction: string }, context) =>
        this.runSubAgent(
          task,
          run,
          providers[0],
          args.name,
          args.instruction,
          [...base, readSkill],
          context
        ),
      summarize: (args: { name: string; instruction: string }) =>
        `${args.name} · ${truncate(args.instruction, 160)}`
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
    provider: ResolvedProvider,
    name: string,
    instruction: string,
    tools: AgentTool[],
    context: ToolContext
  ): Promise<{ content: string; isError?: boolean }> {
    const run = await subAgentService.begin({
      taskId: task.id,
      taskTitle: task.title,
      name,
      instruction,
      provider: provider.kind,
      model: provider.model
    })
    const allowed = tools.filter(
      (tool) =>
        tool.name !== 'delegate_to_crew' &&
        (tool.approval === 'never' || task.permissionMode === 'skip')
    )
    const toolMap = new Map(allowed.map((tool) => [tool.name, tool]))
    const providerTools = allowed.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: withoutSchemaMetadata(tool.inputSchema)
    }))
    const workspace = ensureTaskWorkspace(task.id)
    const system = `You are ${name}, a Crew sub-agent inside Knight Cowork. The Captain delegated one focused job to you.
Do the job with the tools you have, verify what you can, then reply with a compact report: findings, file paths, and anything the Captain must know.
You never address the user directly, never ask questions, and never claim work you did not do.
Workspace: ${workspace}
Granted folders:
${context.roots.map((root) => `- ${root}`).join('\n')}
${task.permissionMode === 'skip' ? 'Write access is allowed inside the workspace.' : 'This job is read-only: do not modify files or run shell commands.'}`
    const messages: ChatMessage[] = [
      {
        id: newId('msg'),
        role: 'user',
        content: instruction,
        createdAt: nowIso()
      }
    ]
    const subContext: ToolContext = { ...context, setPlan: () => undefined }

    try {
      for (let round = 0; round < 8; round++) {
        if (parent.stopped) {
          await subAgentService.finish(run, 'stopped', { error: 'The parent task was stopped.' })
          return { content: `${name} stopped because the task was stopped.`, isError: true }
        }
        const completion = await streamCompletion({
          kind: provider.kind,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          model: provider.model,
          system,
          messages,
          tools: providerTools,
          signal: parent.controller.signal,
          onText: () => undefined
        })
        await usageService
          .record({
            agentId: `Crew · ${name}`,
            providerId: provider.id,
            model: provider.model,
            usage: completion.usage
          })
          .catch(() => undefined)
        messages.push({
          id: newId('msg'),
          role: 'assistant',
          content: completion.text,
          createdAt: nowIso(),
          toolCalls: completion.toolCalls.map((call) => ({
            id: call.id,
            name: call.name,
            arguments: call.arguments
          }))
        })
        if (!completion.toolCalls.length) {
          const summary = completion.text.trim() || `${name} finished without a written report.`
          run.summary = truncate(summary, 8000)
          await subAgentService.finish(run, 'done', { summary: run.summary })
          return { content: `Crew report from ${name}:\n\n${truncate(summary, 20000)}` }
        }
        for (const call of completion.toolCalls) {
          if (parent.stopped) break
          const tool = toolMap.get(call.name)
          const stepId = newId('step')
          if (!tool) {
            messages.push({
              id: newId('msg'),
              role: 'tool',
              content: `Unknown tool "${call.name}".`,
              createdAt: nowIso(),
              toolCallId: call.id,
              name: call.name,
              error: true
            })
            run.steps.push({
              id: stepId,
              tool: call.name,
              title: call.name,
              status: 'error',
              detail: 'Unknown tool',
              at: nowIso()
            })
            await subAgentService.saveRun(run)
            continue
          }
          const record: SubAgentStep = {
            id: stepId,
            tool: tool.name,
            title: tool.title,
            detail: tool.summarize
              ? tool.summarize(call.arguments)
              : truncate(JSON.stringify(call.arguments), 240),
            status: 'running',
            at: nowIso()
          }
          run.steps.push(record)
          await subAgentService.saveRun(run)
          let content = ''
          let isError = false
          try {
            let args: unknown = call.arguments
            if (tool.schema) {
              const parsed = tool.schema.safeParse(call.arguments)
              if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '))
              args = parsed.data
            }
            const result = await tool.execute(args, subContext)
            content = truncate(result.content, 30000)
            isError = Boolean(result.isError)
          } catch (error) {
            content = `Tool error: ${error instanceof Error ? error.message : String(error)}`
            isError = true
          }
          record.status = isError ? 'error' : 'ok'
          record.detail = isError ? truncate(content, 400) : record.detail
          await subAgentService.saveRun(run)
          messages.push({
            id: newId('msg'),
            role: 'tool',
            content,
            createdAt: nowIso(),
            toolCallId: call.id,
            name: call.name,
            error: isError
          })
        }
      }
      const summary = `${name} reached the sub-agent step limit before finishing.`
      await subAgentService.finish(run, 'error', { error: summary })
      return { content: summary, isError: true }
    } catch (error) {
      if (parent.stopped) {
        await subAgentService.finish(run, 'stopped', { error: 'The parent task was stopped.' })
        return { content: `${name} stopped because the task was stopped.`, isError: true }
      }
      const message = error instanceof Error ? error.message : String(error)
      await subAgentService.finish(run, 'error', { error: message })
      return { content: `Crew sub-agent failed: ${message}`, isError: true }
    }
  }

  private resolveProviders(task: Task, settings: PublicSettings): ResolvedProvider[] {
    const providerId = task.providerId || settings.defaultProviderId
    const provider = providerId ? store.getProvider(providerId) : undefined
    if (!provider) {
      throw new Error('Connect an AI provider in Settings to get started.')
    }
    if (!provider.enabled) {
      throw new Error(`The provider “${provider.name}” is disabled. Enable it in Settings.`)
    }
    const apiKey = store.getProviderSecret(provider.id)
    if (!apiKey) {
      throw new Error(`Add an API key for ${provider.name} in Settings.`)
    }
    const model = task.model || settings.defaultModel || provider.models[0]
    if (!model) {
      throw new Error('Choose a model for this task in the composer or in Settings.')
    }

    const primary: ResolvedProvider = {
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      apiKey,
      baseUrl: provider.baseUrl,
      model
    }
    const candidates = [primary]
    for (const alternate of settings.providers) {
      if (alternate.id === primary.id || !alternate.enabled || !alternate.models[0]) continue
      const alternateKey = store.getProviderSecret(alternate.id)
      if (!alternateKey) continue
      candidates.push({
        id: alternate.id,
        name: alternate.name,
        kind: alternate.kind,
        apiKey: alternateKey,
        baseUrl: alternate.baseUrl,
        model: alternate.models[0]
      })
    }
    return candidates
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

  /** Moonwright's own events, mapped onto the task surface the renderer sees. */
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
    return {
      task,
      workspace,
      roots: [...new Set([workspace, ...task.folders])],
      allowShell: settings.allowShell,
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
    messageId: string
  ): Promise<ToolOutcome> {
    const tool = toolMap.get(call.name)
    const rawArgs = (call.arguments ?? {}) as Record<string, unknown>

    if (!tool) {
      const content = `Unknown tool "${call.name}".`
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
        this.appendToolMessage(task, call, content, true)
        await this.commit(task)
        return { content, isError: true }
      }
      args = parsed.data
    }

    const step: StepRecord = {
      id: newId('step'),
      tool: tool.name,
      title: tool.title,
      detail: tool.summarize ? tool.summarize(args) : truncate(JSON.stringify(rawArgs), 240),
      status: 'waiting',
      args: rawArgs,
      messageId,
      startedAt: nowIso()
    }
    task.steps.push(step)
    if (task.steps.length > MAX_STEPS) {
      task.steps.splice(0, task.steps.length - MAX_STEPS)
    }

    const needsApproval =
      tool.approval === 'policy' &&
      task.permissionMode !== 'skip' &&
      !approvals.isAlwaysAllowed(task.id, tool.name) &&
      (task.permissionMode === 'manual' || tool.risk === 'high')

    if (needsApproval) {
      step.status = 'waiting'
      task.status = 'waiting'
      await this.commit(task)

      const approved = await approvals.request(task.id, {
        tool: tool.name,
        title: tool.title,
        summary: step.detail || tool.title,
        details: approvalDetails(tool, rawArgs),
        risk: tool.risk,
        allowAlways: true
      })

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
    await this.commit(task)

    let outcome: ToolOutcome
    try {
      const result = await tool.execute(args, context)
      step.status = result.isError ? 'error' : 'ok'
      step.output = truncate(result.content, 6000)
      if (result.isError) step.error = truncate(firstLine(result.content), 500)
      this.appendToolMessage(task, call, truncate(result.content, 30_000), result.isError)
      outcome = {
        content: truncate(result.content, 30_000),
        isError: result.isError,
        mutatedPaths: mutatedPathsFor(tool.name, rawArgs)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      step.status = 'error'
      step.error = truncate(message, 500)
      step.output = truncate(message, 6000)
      this.appendToolMessage(task, call, `Tool error: ${message}`, true)
      outcome = { content: `Tool error: ${message}`, isError: true }
    }
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

  private async registerArtifact(
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
