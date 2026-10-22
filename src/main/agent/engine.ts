import { MoonwrightAgent } from '../backend/core/index'
import type {
  ModelMessage,
  MoonwrightConfig,
  MoonwrightPorts,
  ToolResult,
  TurnResult
} from '../backend/core/types'
import { makePorts } from '../backend/adapter'
import type { Provider, ProviderToolSpec } from '../backend/provider'
import type { BackendStore } from '../backend/store'
import { newId } from '../util'
import type { AgentTool } from './tools/types'

/**
 * The merged agent engine.
 *
 * Moonwright's phase machine drives the turn — the budget, the four stop
 * gates, the skill and memory nudges and the post-turn review all come from
 * the transplanted core — while the tools, the approval flow, the artifact
 * registry and the plan live in Knight's runtime and are injected through the
 * ports. One engine, one set of tools, one transcript.
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
  config: Partial<MoonwrightConfig>
  signal: AbortSignal
  onText: (delta: string) => void
  onTool: (callId: string, name: string, args: Record<string, unknown>) => Promise<ToolOutcome>
  emit: (event: string, payload: unknown) => void
}

/** Knight's tool schema, as the provider's function spec. */
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

export async function runEngineTurn(input: EngineInput): Promise<TurnResult> {
  const specs = toolsToWireSpecs(input.tools)

  const ports = makePorts({
    provider: input.provider,
    runtime: { definitions: () => specs },
    memoryStore: input.memoryStore,
    skillsDir: input.skillsDir,
    emit: input.emit,
    now: () => Date.now(),
    extraTools: [],
    runTool: async () => '',
    onText: input.onText
  })

  // The core calls `runTool(name, args)` without the call id, so the ids are
  // captured from the model response and matched back by name and arguments.
  let pendingCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
  const callModel = ports.callModel
  ports.callModel = async (messages, options) => {
    const response = await callModel(messages, options)
    pendingCalls = response.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      args: call.args
    }))
    return response
  }

  const runTool = ports.runTool
  ports.runTool = async (name, args): Promise<ToolResult> => {
    const wanted = JSON.stringify(args)
    let index = pendingCalls.findIndex((call) => call.name === name)
    if (index >= 0 && JSON.stringify(pendingCalls[index].args) !== wanted) {
      const exact = pendingCalls.findIndex(
        (call) => call.name === name && JSON.stringify(call.args) === wanted
      )
      if (exact >= 0) index = exact
    }
    const call = index >= 0 ? pendingCalls.splice(index, 1)[0] : undefined
    try {
      const outcome = await input.onTool(call?.id ?? newId('call'), name, args)
      return {
        ok: !outcome.isError,
        output: outcome.content,
        ...(outcome.mutatedPaths?.length ? { mutatedPaths: outcome.mutatedPaths } : {})
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  void runTool

  const agent = new MoonwrightAgent({
    ports: ports as unknown as MoonwrightPorts,
    config: input.config as MoonwrightConfig,
    systemPrompt: input.systemPrompt,
    history: input.history
  })

  return agent.runTurn({
    userMessage: input.userMessage,
    context: input.context
  })
}
