import { join } from 'node:path'
import type { ModelMessage, ToolSpec } from './core/types'
import { runMoonwrightTurn } from './moonwright'
import type { Provider, ProviderToolSpec, WireMessage } from './provider'
import type { BackendStore } from './store'
import { ToolRuntime, type ToolPermissions } from './tools'

/**
 * Agent runtime: a tool-calling loop on top of the provider, with delegation
 * to sub-agents (Explore / Plan / Custom roles) and per-run token accounting.
 *
 * Ported from Seamoon's `electron/backend/agent.js`.
 */

export interface BuiltinRole {
  id: string
  name: string
  color: string
  description: string
  prompt: string
  tools: string[] | null
  readOnly: boolean
}

export const BUILTIN_ROLES: Record<string, BuiltinRole> = {
  explore: {
    id: 'explore',
    name: 'Explore',
    color: '#4d9c61',
    description: 'Read-only scout. Searches the workspace and reports what it finds.',
    prompt:
      'You are an Explore agent. Locate relevant files and facts in the workspace. ' +
      'Use list_dir, search and read_file. Never modify anything. ' +
      'Finish with a concise, factual report of what you found and where.',
    tools: ['list_dir', 'read_file', 'search'],
    readOnly: true
  },
  plan: {
    id: 'plan',
    name: 'Plan',
    color: '#538cab',
    description: 'Architect. Turns a request into an ordered, concrete plan.',
    prompt:
      'You are a Plan agent. Convert the request into an ordered implementation plan. ' +
      'Ground every step in a real file path you have read. ' +
      'Finish with the numbered plan and nothing else.',
    tools: ['list_dir', 'read_file', 'search'],
    readOnly: true
  },
  custom: {
    id: 'custom',
    name: 'Custom agent',
    color: '#b3bab4',
    description: 'A sub-agent with a role you define.',
    prompt: 'You are a sub-agent. Follow the role you are given and finish with your answer.',
    tools: ['list_dir', 'read_file', 'search', 'write_file', 'run_command'],
    readOnly: false
  }
}

export const DELEGATE_TOOL: ProviderToolSpec = {
  type: 'function',
  function: {
    name: 'delegate_to_agent',
    description:
      'Hand a self-contained task to a sub-agent and receive its report. ' +
      'Available agents: explore, plan, or a custom agent id.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'explore | plan | <custom agent id>' },
        task: { type: 'string', description: 'What the sub-agent must find out or produce' }
      },
      required: ['agent', 'task']
    }
  }
}

export interface RunnerUsage {
  prompt: number
  completion: number
  total: number
  calls: number
}

export interface RunnerIntegrations {
  marketplace?: { context?: () => string }
  connectors?: {
    connected: boolean
    toolDefinitions(input: { limit?: number }): Promise<ProviderToolSpec[]>
    execute(input: { tool: string; args: Record<string, unknown> }): Promise<unknown>
  }
  computer?: {
    enabled: boolean
    invoke(name: string, args: Record<string, unknown>): Promise<unknown>
    definitions?(): ProviderToolSpec[]
  }
  uitars?: {
    enabled: boolean
    run(input: { instruction: string; maxSteps?: number }): Promise<unknown>
  }
  mcp?: {
    listTools(): Promise<
      Array<{
        id?: string
        name?: string
        description?: string
        serverName?: string
        schema?: Record<string, unknown>
        error?: string
      }>
    >
    callTool(id: string, args: Record<string, unknown>): Promise<unknown>
  }
  permissions?: {
    ask(request: {
      tool?: string
      args?: unknown
      session?: unknown
    }): Promise<{ allowed: boolean; reason?: string }>
  }
  work?: {
    connected(): boolean
    tools(): ProviderToolSpec[]
    run(name: string, args: Record<string, unknown>): Promise<unknown>
  }
  externalAgent?: { agent(prompt: string): Promise<unknown> }
}

export interface RunnerSettings {
  systemPrompt: string
  permissions: ToolPermissions
  sandbox: boolean
  memoryEnabled: boolean
  maxIterations: number
  maxOutputTokens: number
  temperature: number
  tier: string
  tierConfig: Record<string, Partial<ToolSpec> & { thinking?: boolean; effort?: string | null }>
  [key: string]: unknown
}

export interface RunnerSession {
  id: string
  title: string
}

export interface RunnerOptions {
  provider: Provider
  store: BackendStore
  emit: (event: string, payload: unknown) => void
  settings: RunnerSettings
  workspace: string
  integrations?: RunnerIntegrations
}

export interface RunResult {
  text: string
  usage: RunnerUsage
  apiCallCount?: number
  toolCalls?: number
  stopReason?: string
  review?: { memory: boolean; skills: boolean }
  stopped?: boolean
}

interface ResolvedAgent {
  id: string
  name: string
  prompt: string
  tools: string[] | null
  readOnly?: boolean
  canDelegate?: boolean
}

export class AgentRunner {
  private readonly provider: Provider
  private readonly store: BackendStore
  private readonly emit: (event: string, payload: unknown) => void
  settings: RunnerSettings
  workspace: string
  private readonly integrations: RunnerIntegrations
  /** session id -> abort controller, so a running turn can be stopped. */
  private readonly aborts = new Map<string, AbortController>()

  constructor(options: RunnerOptions) {
    this.provider = options.provider
    this.store = options.store
    this.emit = options.emit
    this.settings = options.settings
    this.workspace = options.workspace
    this.integrations = options.integrations ?? {}
  }

  stop(sessionId: string): void {
    const controller = this.aborts.get(sessionId)
    if (controller) controller.abort()
  }

  async run(input: {
    session: RunnerSession
    agentId?: string
    userMessage: string
    opts?: { isolate?: boolean; history?: unknown[]; depth?: number }
  }): Promise<RunResult> {
    const opts = input.opts ?? {}
    const controller = new AbortController()
    this.aborts.set(input.session.id, controller)

    const agent =
      input.agentId === 'knight'
        ? {
            id: 'knight',
            name: 'SelfImpulse',
            role: 'orchestrator',
            prompt: this.settings.systemPrompt,
            tools: null
          }
        : this.resolveAgent(input.agentId ?? 'explore')

    const runtime = new ToolRuntime({
      workspace: this.workspace,
      permissions: this.settings.permissions,
      sandbox: this.settings.sandbox !== false,
      // "ask" really asks: the renderer is prompted, and an unanswered prompt
      // is a refusal rather than a silent yes.
      onAsk: async (name: string) => {
        const answer = await this.integrations.permissions?.ask({
          tool: name,
          args: { __session: input.session.id }
        })
        return Boolean(answer?.allowed)
      }
    })

    // The Moonwright core is the default engine; the legacy loop stays as a fallback.
    try {
      return await this.runWithMoonwright({
        session: input.session,
        agent,
        runtime,
        userMessage: input.userMessage,
        opts,
        controller
      })
    } catch (error) {
      this.emit('agent:error', {
        sessionId: input.session.id,
        agentId: agent.id,
        error: `Moonwright core failed, falling back: ${error}`
      })
    }

    const messages: WireMessage[] = []
    const system = this.buildSystemPrompt(agent)
    if (system) messages.push({ role: 'system', content: system })

    if (!opts.isolate) {
      const history = this.store.messages
        .all()
        .filter((message) => message.sessionId === input.session.id)
      for (const message of history) {
        if (message.role === 'user' || message.role === 'assistant') {
          messages.push({ role: message.role, content: message.content })
        }
      }
    }
    if (input.userMessage) messages.push({ role: 'user', content: input.userMessage })

    const toolSet = await this.buildToolSet(agent, runtime, opts)
    const tools = toolSet.canDelegate
      ? [
          ...toolSet.roleTools,
          DELEGATE_TOOL,
          ...toolSet.connectorsTools,
          ...toolSet.computerTools,
          ...toolSet.groundedActionsTools,
          ...toolSet.workTools,
          ...toolSet.mcpTools,
          ...toolSet.openClawTools
        ]
      : [
          ...toolSet.roleTools,
          ...toolSet.connectorsTools,
          ...toolSet.computerTools,
          ...toolSet.groundedActionsTools,
          ...toolSet.workTools,
          ...toolSet.mcpTools,
          ...toolSet.openClawTools
        ]

    const usage: RunnerUsage = { prompt: 0, completion: 0, total: 0, calls: 0 }
    const maxIterations = this.settings.maxIterations || 12
    let finalText = ''

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        let text = ''
        const pendingCalls = new Map<
          number,
          { index: number; id: string; name: string; args: string }
        >()

        for await (const event of this.provider.stream(messages, {
          tools,
          temperature: this.settings.temperature,
          maxTokens: Math.min(this.settings.maxOutputTokens || 4096, 8192),
          signal: controller.signal
        })) {
          if (event.type === 'text') {
            text += event.delta
            this.emit('agent:delta', {
              sessionId: input.session.id,
              agentId: agent.id,
              delta: event.delta
            })
          } else if (event.type === 'tool_delta') {
            const record = pendingCalls.get(event.index) ?? {
              index: event.index,
              id: '',
              name: '',
              args: ''
            }
            record.args += event.args
            pendingCalls.set(event.index, record)
          } else if (event.type === 'tool_call') {
            pendingCalls.set(event.index, {
              index: event.index,
              id: event.id,
              name: event.name,
              args: event.args
            })
          } else if (event.type === 'usage' && event.usage) {
            usage.prompt += event.usage.prompt_tokens || 0
            usage.completion += event.usage.completion_tokens || 0
            usage.total += event.usage.total_tokens || 0
            usage.calls += 1
          }
        }

        if (text.trim()) {
          messages.push({ role: 'assistant', content: text })
          finalText = text
        }

        if (pendingCalls.size === 0) break

        const calls = [...pendingCalls.values()].filter((call) => call.name)
        messages.push({
          role: 'assistant',
          content: text || null,
          tool_calls: calls.map((call, index) => ({
            id: call.id || `call_${index}`,
            type: 'function' as const,
            function: { name: call.name, arguments: call.args || '{}' }
          }))
        })

        for (const call of calls) {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(call.args || '{}') as Record<string, unknown>
          } catch {
            args = {}
          }
          this.emit('agent:status', {
            sessionId: input.session.id,
            agentId: agent.id,
            status: 'tool',
            tool: call.name
          })

          let result: Record<string, unknown> | undefined
          if (call.name === 'delegate_to_agent') {
            result = (await this.delegate({
              session: input.session,
              args,
              parentAgent: agent,
              depth: opts.depth || 0
            })) as unknown as Record<string, unknown>
          } else if (call.name.startsWith('connectors_')) {
            result = (await this.runConnectors(call.name.replace(/^connectors_/, ''), args)) as unknown as Record<
              string,
              unknown
            >
          } else if (call.name.startsWith('computer_')) {
            result = (await this.integrations.computer?.invoke(call.name, args)) as unknown as Record<
              string,
              unknown
            >
          } else if (call.name === 'grounded_actions') {
            const res = (await this.integrations.uitars?.run({
              instruction: args.instruction as string,
              maxSteps: args.maxSteps as number | undefined
            })) as { steps?: unknown[]; summary?: string } | undefined
            this.emit('agent:tool', {
              sessionId: input.session.id,
              agentId: agent.id,
              tool: 'grounded_actions',
              args,
              result: { ok: true, steps: (res?.steps || []).length, summary: res?.summary }
            })
            result = res as unknown as Record<string, unknown>
          } else {
            result = (await runtime.invoke(call.name, args)) as unknown as Record<string, unknown>
            this.emit('agent:tool', {
              sessionId: input.session.id,
              agentId: agent.id,
              tool: call.name,
              args,
              result
            })
          }

          if (result?.finished) {
            finalText = (result.summary as string) || finalText
          }

          messages.push({
            role: 'tool',
            tool_call_id: call.id || 'call_0',
            content: JSON.stringify(result).slice(0, 12000)
          })

          if (result?.finished) {
            this.emit('agent:done', {
              sessionId: input.session.id,
              agentId: agent.id,
              usage,
              summary: finalText
            })
            this.recordUsage(input.session, agent, usage)
            return { text: finalText, usage }
          }
        }
      }

      this.emit('agent:done', {
        sessionId: input.session.id,
        agentId: agent.id,
        usage,
        summary: finalText
      })
      this.recordUsage(input.session, agent, usage)
      return { text: finalText, usage }
    } catch (error) {
      if (controller.signal.aborted) {
        this.emit('agent:stopped', { sessionId: input.session.id, agentId: agent.id })
        return { text: finalText, usage, stopped: true }
      }
      const message = error instanceof Error ? error.message : String(error)
      this.emit('agent:error', {
        sessionId: input.session.id,
        agentId: agent.id,
        error: message
      })
      throw error
    } finally {
      this.aborts.delete(input.session.id)
    }
  }

  /**
   * The tool set for a turn: the role's own tools, plus the live Connectors
   * tools, the opt-in computer-use tools and the Grounded Actions capability.
   */
  async buildToolSet(
    agent: ResolvedAgent,
    runtime: ToolRuntime,
    opts: { isolate?: boolean } = {}
  ): Promise<{
    roleTools: ProviderToolSpec[]
    connectorsTools: ProviderToolSpec[]
    computerTools: ProviderToolSpec[]
    groundedActionsTools: ProviderToolSpec[]
    workTools: ProviderToolSpec[]
    mcpTools: ProviderToolSpec[]
    openClawTools: ProviderToolSpec[]
    canDelegate: boolean
  }> {
    const roleTools = runtime.definitions().filter((definition) => {
      if (!agent.tools) return true
      const name = definition.function.name
      if (name === 'finish') return true
      return agent.tools.includes(name)
    })
    // Connectors tools are real, live tools from the user's own Connectors account.
    const connectorsTools = await this.connectorsToolDefinitions()
    // Computer use is opt-in and only offered when the user switched it on.
    const computerTools = this.integrations.computer?.definitions?.() ?? []
    // Work Files (the surface SubscriptionAccount 365 reasons over) — only when connected.
    const workTools = this.integrations.work?.connected() ? this.integrations.work.tools() : []
    // MCP connectors (the GitHub MCP Server, Microsoft Learn, …) expose their own tools.
    const mcpTools = await this.mcpToolDefinitions()
    // ExternalAgent: hand a task to a running ExternalAgent gateway.
    const openClawTools: ProviderToolSpec[] = this.integrations.externalAgent
      ? [
          {
            type: 'function',
            function: {
              name: 'externalAgent_agent',
              description:
                'Run a task on a running ExternalAgent gateway — the self-hosted agent that also answers on ' +
                'your chat app and the rest. Use it for work that belongs in that session.',
              parameters: {
                type: 'object',
                properties: {
                  prompt: { type: 'string', description: 'The task for the ExternalAgent agent' }
                },
                required: ['prompt']
              }
            }
          }
        ]
      : []
    // Grounded Actions is a capability, not a separate app: when configured, the agent
    // can hand a GUI task to the grounded action model.
    const groundedActionsTools: ProviderToolSpec[] = this.integrations.uitars?.enabled
      ? [
          {
            type: 'function',
            function: {
              name: 'grounded_actions',
              description:
                'Hand a desktop task to the Grounded Actions GUI agent. It looks at the screen, ' +
                'grounds the target and clicks, types, scrolls or drags until the task is done.',
              parameters: {
                type: 'object',
                properties: {
                  instruction: {
                    type: 'string',
                    description: 'What to do on the screen, in plain language'
                  },
                  maxSteps: { type: 'number', description: 'Maximum steps to take (default 12)' }
                },
                required: ['instruction']
              }
            }
          }
        ]
      : []
    // Only the orchestrator may delegate; a sub-agent that could delegate would
    // spawn another sub-agent and recurse forever.
    const canDelegate = agent.canDelegate !== false && !opts.isolate
    return {
      roleTools,
      connectorsTools,
      computerTools,
      groundedActionsTools,
      workTools,
      mcpTools,
      openClawTools,
      canDelegate
    }
  }

  /**
   * The tools of every connected MCP server, as callable model functions.
   */
  async mcpToolDefinitions(): Promise<ProviderToolSpec[]> {
    const mcp = this.integrations.mcp
    if (!mcp) return []
    let tools: Awaited<ReturnType<NonNullable<RunnerIntegrations['mcp']>['listTools']>> = []
    try {
      tools = await mcp.listTools()
    } catch {
      return []
    }
    return tools
      .filter((tool) => tool.name && !tool.error)
      .map((tool) => ({
        type: 'function' as const,
        function: {
          name: `mcp_${String(tool.name).replace(/[^a-zA-Z0-9_]/g, '_')}`,
          description: `[${tool.serverName || 'MCP'}] ${tool.description || tool.name}`,
          parameters:
            tool.schema && Object.keys(tool.schema).length
              ? tool.schema
              : { type: 'object', properties: {} }
        }
      }))
  }

  /**
   * Runs a turn with the TypeScript Moonwright core.
   */
  async runWithMoonwright(input: {
    session: RunnerSession
    agent: ResolvedAgent
    runtime: ToolRuntime
    userMessage: string
    opts: { isolate?: boolean; depth?: number }
    controller: AbortController
  }): Promise<RunResult> {
    const { session, agent, runtime, userMessage, opts, controller } = input
    const toolSet = await this.buildToolSet(agent, runtime, opts)
    const extraTools: ProviderToolSpec[] = [
      ...toolSet.connectorsTools,
      ...toolSet.computerTools,
      ...toolSet.groundedActionsTools,
      ...toolSet.workTools,
      ...toolSet.mcpTools,
      ...toolSet.openClawTools,
      ...(toolSet.canDelegate ? [DELEGATE_TOOL] : [])
    ]

    const history: ModelMessage[] = opts.isolate
      ? []
      : this.store.messages
          .all()
          .filter(
            (message) =>
              message.sessionId === session.id &&
              (message.role === 'user' || message.role === 'assistant')
          )
          .map((message) => ({
            role: message.role as ModelMessage['role'],
            content: message.content
          }))

    const emit = (event: string, payload: unknown): void =>
      this.emit(event, {
        sessionId: session.id,
        agentId: agent.id,
        ...(payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {})
      })

    const runTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      if (name === 'delegate_to_agent') {
        return this.delegate({ session, args, parentAgent: agent, depth: opts.depth || 0 })
      }
      if (name.startsWith('connectors_')) {
        return this.runConnectors(name.replace(/^connectors_/, ''), args)
      }
      if (name.startsWith('computer_')) {
        return this.integrations.computer?.invoke(name, args)
      }
      if (name === 'grounded_actions') {
        return this.integrations.uitars?.run({
          instruction: args.instruction as string,
          maxSteps: args.maxSteps as number | undefined
        })
      }
      if (name.startsWith('work_')) {
        const result = await this.integrations.work?.run(name, args)
        emit('agent:tool', { tool: name, args, result })
        return result
      }
      if (name.startsWith('mcp_')) {
        const result = await this.runMcpTool(name.replace(/^mcp_/, ''), args)
        emit('agent:tool', { tool: name, args, result })
        return result
      }
      if (name === 'externalAgent_agent') {
        const result = await this.integrations.externalAgent?.agent(args.prompt as string)
        emit('agent:tool', { tool: name, args, result })
        return result
      }
      const result = await runtime.invoke(name, args)
      emit('agent:tool', { tool: name, args, result })
      return result
    }

    const result = await runMoonwrightTurn({
      provider: this.provider,
      runtime,
      memoryStore: this.store.memories,
      skillsDir: join(this.workspace, '.agents', 'skills'),
      emit,
      messages: history,
      userMessage,
      systemPrompt: this.buildSystemPrompt(agent),
      extraTools,
      runTool,
      config: {
        maxIterations: (this.settings.maxIterations as number) || 500,
        delegationMaxIterations: (this.settings.delegationMaxIterations as number) || 50,
        skillNudgeInterval: (this.settings.skillNudgeInterval as number) ?? 10,
        memoryNudgeInterval: (this.settings.memoryNudgeInterval as number) ?? 15,
        backgroundReview: this.settings.backgroundReview !== false,
        temperature: this.settings.temperature,
        maxOutputTokens: this.settings.maxOutputTokens
      },
      signal: controller.signal
    })

    return {
      text: result.finalResponse ?? '',
      usage: {
        prompt: result.usage.prompt,
        completion: result.usage.completion,
        total: result.usage.total,
        calls: result.apiCallCount
      },
      apiCallCount: result.apiCallCount,
      toolCalls: result.toolCalls,
      stopReason: result.stopReason,
      review: result.review
    }
  }

  /** Calls one MCP tool by its catalogue name. */
  async runMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const mcp = this.integrations.mcp
    if (!mcp) return { ok: false, error: 'No MCP client' }
    try {
      const tools = await mcp.listTools()
      const found = tools.find((tool) => tool.name === name || tool.id?.endsWith(`:${name}`))
      if (!found || !found.id) return { ok: false, error: `No MCP tool named "${name}"` }
      const data = await mcp.callTool(found.id, args)
      return { ok: true, data }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  resolveAgent(id: string): ResolvedAgent {
    const custom = this.store.agents.findById(id)
    if (custom) {
      return {
        id: custom.id,
        name: custom.name,
        prompt: custom.prompt,
        tools: custom.tools,
        readOnly: custom.readOnly as boolean | undefined
      }
    }
    if (BUILTIN_ROLES[id]) return BUILTIN_ROLES[id]
    return BUILTIN_ROLES.explore
  }

  buildSystemPrompt(agent: ResolvedAgent): string {
    const base =
      agent.id === 'knight'
        ? this.settings.systemPrompt
        : `${agent.prompt}\n\nYou are running as the "${agent.name}" sub-agent of SelfImpulse.`
    const tier = this.tier()
    const tierNote = tier.thinking
      ? `Think carefully before answering. Reasoning effort: ${tier.effort || 'high'}. Show your reasoning only if asked.`
      : 'Answer directly and concisely.'
    const memory = this.settings.memoryEnabled ? this.buildMemoryContext() : ''
    const skills = this.buildSkillContext()
    return [base, tierNote, memory, skills].filter(Boolean).join('\n\n')
  }

  buildSkillContext(): string {
    const ctx = this.integrations.marketplace?.context?.() || ''
    if (!ctx) return ''
    return `Installed skills:\n${ctx}`
  }

  /** Live tool definitions from the user's Connectors account (empty when not connected). */
  async connectorsToolDefinitions(): Promise<ProviderToolSpec[]> {
    const connectors = this.integrations.connectors
    if (!connectors || !connectors.connected) return []
    try {
      return await connectors.toolDefinitions({ limit: 40 })
    } catch {
      return []
    }
  }

  async runConnectors(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const connectors = this.integrations.connectors
    if (!connectors?.connected) return { ok: false, error: 'Connectors is not connected.' }
    try {
      const res = await connectors.execute({ tool, args })
      this.emit('agent:tool', {
        sessionId: null,
        agentId: 'knight',
        tool: `connectors.${tool}`,
        args,
        result: res
      })
      return res
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** The active model tier and its overrides. */
  tier(): {
    id: string
    name: string
    thinking: boolean
    effort: string | null
    visibility: boolean
    context: number
    multiplier: string
  } {
    const id = this.settings.tier || 'auto'
    const base = {
      id,
      name: id,
      thinking: false,
      effort: null as string | null,
      visibility: true,
      context: 200000,
      multiplier: '1x'
    }
    const cfg = (this.settings.tierConfig ?? {})[id] ?? {}
    return { ...base, ...cfg, id }
  }

  buildMemoryContext(): string {
    const memories = this.store.memories.all().slice(-12)
    if (!memories.length) return ''
    const lines = memories.map((memory) => `- [${memory.scope || 'global'}] ${memory.text}`)
    return `SelfImpulse memory (facts worth remembering):\n${lines.join('\n')}`
  }

  /** Runs a sub-agent to completion and returns its report as a tool result. */
  async delegate(input: {
    session: RunnerSession
    args: Record<string, unknown>
    parentAgent: ResolvedAgent
    depth?: number
  }): Promise<{ ok: boolean; error?: string; agent?: string; report?: string }> {
    const depth = input.depth ?? 0
    if (depth >= 2) {
      return {
        ok: false,
        error: 'Delegation depth limit reached (2).',
        agent: input.args.agent as string
      }
    }
    const agentId = (input.args.agent as string) || 'explore'
    const task = (input.args.task as string) || ''
    const agent = this.resolveAgent(agentId)

    this.emit('agent:delegate', {
      sessionId: input.session.id,
      agentId: input.parentAgent.id,
      subAgentId: agent.id,
      subAgentName: agent.name,
      task,
      status: 'running'
    })

    const childRunner = new AgentRunner({
      provider: this.provider,
      store: this.store,
      emit: this.emit,
      settings: { ...this.settings, systemPrompt: agent.prompt, memoryEnabled: false },
      workspace: this.workspace,
      integrations: this.integrations
    })

    let report = ''
    try {
      const res = await childRunner.run({
        session: { ...input.session, id: input.session.id },
        agentId: agent.id,
        userMessage: task,
        opts: { isolate: true }
      })
      report = res.text || ''
    } catch (error) {
      report = `Sub-agent failed: ${error instanceof Error ? error.message : String(error)}`
    }

    this.emit('agent:delegate', {
      sessionId: input.session.id,
      agentId: input.parentAgent.id,
      subAgentId: agent.id,
      subAgentName: agent.name,
      task,
      status: 'done',
      report
    })

    return { ok: true, agent: agent.name, report }
  }

  recordUsage(session: RunnerSession, agent: ResolvedAgent, usage: RunnerUsage): void {
    const day = new Date().toISOString().slice(0, 10)
    const entry = this.store.usage.find(
      (bucket) => bucket.day === day && bucket.agentId === agent.id
    )
    if (entry) {
      entry.prompt += usage.prompt
      entry.completion += usage.completion
      entry.total += usage.total
      entry.calls += usage.calls
      entry.sessions = ((entry.sessions as number) ?? 0) + 1
      this.store.usage.save()
    } else {
      this.store.usage.insert({
        id: `use_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        day,
        agentId: agent.id,
        prompt: usage.prompt,
        completion: usage.completion,
        total: usage.total,
        calls: usage.calls,
        sessions: 1
      })
    }
    this.store.sessions.update(session.id, { usage: usage.total, updatedAt: Date.now() })
  }
}
