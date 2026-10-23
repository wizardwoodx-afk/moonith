import { MemoryManager, ImpulseAgent, SkillManager } from './core/index'
import type { ModelMessage, ImpulsePorts, ToolSpec } from './core/types'
import { makePorts } from './adapter'
import type { Provider, ProviderToolSpec } from './provider'
import type { BackendStore } from './store'

/**
 * The ImpulseCore runner — the agent turn, driven by the TypeScript ImpulseCore core.
 *
 * The core lives in `src/main/backend/core/` and is bundled with the main
 * process. This module wires it to the provider, tool runtime, memory ledger
 * and workspace skills, and adds the three tools the learning loop needs.
 *
 * Ported from the earlier desktop shell.
 */

/** The tool specs the ImpulseCore core sees in addition to the backend's own tools. */
export function moonwrightToolSpecs(): ToolSpec[] {
  return [
    {
      name: 'skill_manage',
      description:
        'Create, improve, pin, archive or list reusable skills. Use action=create to save a procedure ' +
        'that will recur; action=patch to improve an existing one. Never archive a skill you did not review.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'patch', 'pin', 'unpin', 'archive', 'restore', 'list']
          },
          id: { type: 'string', description: 'The skill id, for every action except create' },
          name: { type: 'string', description: 'lowercase-hyphenated name (create)' },
          description: {
            type: 'string',
            description: 'one sentence, at most 60 characters (create/patch)'
          },
          body: { type: 'string', description: 'the SKILL.md body (create/patch)' },
          platforms: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } }
        },
        required: ['action']
      }
    },
    {
      name: 'memory_write',
      description:
        'Persist one durable fact about the user, the project or a decision. One fact per entry. ' +
        'Never store secrets or anything that is only true for this conversation.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'the single fact to remember' },
          scope: { type: 'string', description: 'global or a project scope' },
          tags: { type: 'array', items: { type: 'string' } }
        },
        required: ['text']
      }
    },
    {
      name: 'memory_search',
      description: 'Recall what is already known about the user, the project or earlier decisions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' }
        },
        required: ['query']
      }
    }
  ]
}

export interface ImpulseTurnOptions {
  provider: Provider
  runtime: { definitions(): ProviderToolSpec[] }
  memoryStore: BackendStore['memories']
  skillsDir: string
  emit: (event: string, payload: unknown) => void
  messages?: ModelMessage[]
  userMessage: string
  systemPrompt: string
  extraTools?: ProviderToolSpec[]
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  config?: Record<string, unknown>
  signal?: AbortSignal
}

/**
 * Runs one turn with the ImpulseCore core.
 */
export async function runImpulseTurn(
  options: ImpulseTurnOptions
): Promise<{
  finalResponse: string | null
  usage: { prompt: number; completion: number; total: number }
  apiCallCount: number
  toolCalls: number
  stopReason: string
  review?: { memory: boolean; skills: boolean }
  skills: Awaited<ReturnType<SkillManager['list']>>
}> {
  const ports = makePorts({
    provider: options.provider,
    runtime: options.runtime,
    memoryStore: options.memoryStore,
    skillsDir: options.skillsDir,
    emit: options.emit,
    now: () => Date.now(),
    extraTools: options.extraTools ?? [],
    runTool: options.runTool
  })

  const skillManager = new SkillManager(ports as unknown as ImpulsePorts)
  const memoryManager = new MemoryManager(ports as unknown as ImpulsePorts)

  // The three learning-loop tools.
  const specs = moonwrightToolSpecs()
  const handlers: Record<string, (args: Record<string, any>) => Promise<unknown>> = {
    async skill_manage(args) {
      switch (args.action) {
        case 'create': {
          const res = await skillManager.write({
            name: args.name || '',
            description: args.description || '',
            body: args.body || '',
            platforms: args.platforms,
            tags: args.tags
          } as never)
          if (!res.ok || !res.bundle) {
            return {
              ok: false,
              error: `The skill contract rejected it: ${res.validation.errors.join('; ')}`
            }
          }
          return { ok: true, id: res.bundle.id, name: res.bundle.name }
        }
        case 'patch': {
          const res = await skillManager.patch(args.id, {
            description: args.description,
            body: args.body,
            platforms: args.platforms,
            tags: args.tags
          })
          if (!res.ok || !res.bundle) {
            return {
              ok: false,
              error: `The skill contract rejected it: ${res.validation.errors.join('; ')}`
            }
          }
          return { ok: true, id: res.bundle.id, name: res.bundle.name }
        }
        case 'pin':
          await skillManager.setPinned(args.id, true)
          return { ok: true, id: args.id, pinned: true }
        case 'unpin':
          await skillManager.setPinned(args.id, false)
          return { ok: true, id: args.id, pinned: false }
        case 'archive':
          return { ok: await skillManager.archive(args.id) }
        case 'restore':
          return { ok: await skillManager.restore(args.id) }
        case 'list':
        default: {
          const skills = await skillManager.list()
          return {
            ok: true,
            skills: skills.map((skill) => ({
              id: skill.id,
              name: skill.name,
              description: skill.description
            }))
          }
        }
      }
    },
    async memory_write(args) {
      const record = await memoryManager.add(args.text || '', args.scope || 'global', args.tags || [])
      return { ok: true, id: record.id }
    },
    async memory_search(args) {
      const hits = await memoryManager.search(args.query || '', args.limit || 8)
      return { ok: true, hits: hits.map((hit) => hit.text) }
    }
  }

  const toolDefs = [...ports.listTools(), ...specs]
  const runTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (handlers[name]) return handlers[name](args)
    return options.runTool(name, args)
  }

  // The agent's own tools include the learning-loop ones.
  ports.listTools = () => toolDefs
  ports.runTool = async (name, args) =>
    toCoreResult(name, await runTool(name, args))

  // Context injected before the user's message: what we already know, and the
  // index of installed skills.
  const contextParts: string[] = []
  const memoryContext = await memoryManager.context(options.userMessage || '', 6)
  if (memoryContext) contextParts.push(memoryContext)
  const skillIndex = await skillManager.index(24)
  if (skillIndex && skillIndex !== '(no skills installed)') {
    contextParts.push(`## Installed skills\n${skillIndex}`)
  }

  const agent = new ImpulseAgent({
    ports: ports as unknown as ImpulsePorts,
    config: (options.config ?? {}) as never,
    systemPrompt: options.systemPrompt,
    history: options.messages ?? []
  } as never)

  const result = await agent.runTurn({
    userMessage: options.userMessage,
    context: contextParts.length ? contextParts.join('\n\n') : undefined
  } as never)

  return {
    finalResponse: result.finalResponse,
    usage: result.usage,
    apiCallCount: result.apiCallCount,
    toolCalls: result.toolCalls,
    stopReason: result.stopReason,
    review: result.review,
    skills: await skillManager.list()
  }
}

function toCoreResult(
  name: string,
  raw: unknown
): { ok: boolean; output?: unknown; error?: string; mutatedPaths?: string[] } {
  const record = (raw ?? {}) as {
    ok?: boolean
    error?: string
    path?: string
    mutatedPaths?: string[]
  }
  if (record.error) return { ok: false, error: record.error, output: raw }
  const mutatedPaths = record.mutatedPaths
    ? [...record.mutatedPaths]
    : name === 'write_file' && record.path
      ? [record.path]
      : undefined
  return {
    ok: record.ok !== false,
    output: raw,
    ...(mutatedPaths ? { mutatedPaths } : {})
  }
}
