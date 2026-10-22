import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  MemoryRecord,
  ModelMessage,
  ModelResponse,
  SkillBundle,
  ToolResult,
  ToolSpec
} from './core/types'
import type { Provider, ProviderToolSpec, WireMessage } from './provider'
import type { BackendMemory, BackendStore } from './store'

/**
 * The Moonwright core is driven through a small set of ports. This module
 * implements those ports over the backend's provider, tool runtime, memory
 * ledger and workspace skills.
 *
 * Ported from Seamoon's `electron/backend/moonwright-bridge.js`.
 *
 * One fix over the original: the core declares a flat tool spec
 * (`{ name, description, parameters }`) while the tool runtime speaks the
 * OpenAI wire shape (`{ type: 'function', function: { … } }`). The original
 * handed the wire shape straight to the core, so the core could never see a
 * tool name. Here the conversion happens at the port boundary — flat in the
 * core, wire on the wire.
 */

export interface MemoryPort {
  list(scope?: string): Promise<MemoryRecord[]>
  add(record: Omit<MemoryRecord, 'id' | 'createdAt'>): Promise<MemoryRecord>
  remove(id: string): Promise<boolean>
  search(query: string, limit?: number): Promise<MemoryRecord[]>
  summarize(records: MemoryRecord[]): Promise<string>
}

export interface SkillsPort {
  list(): Promise<SkillBundle[]>
  read(id: string): Promise<SkillBundle | null>
  write(bundle: SkillBundle): Promise<SkillBundle>
  remove(id: string): Promise<boolean>
  setPinned(id: string, pinned: boolean): Promise<void>
}

/** An OpenAI-style function spec, as the provider expects it. */
export type WireToolSpec = ProviderToolSpec

export function toFlatTool(spec: WireToolSpec | ToolSpec): ToolSpec {
  if ('function' in spec && spec.function) {
    return {
      name: spec.function.name,
      description: spec.function.description,
      parameters: spec.function.parameters as Record<string, unknown>
    }
  }
  return spec as ToolSpec
}

export function toWireTool(spec: ToolSpec | WireToolSpec): WireToolSpec {
  if ('function' in spec && spec.function) return spec as WireToolSpec
  const flat = spec as ToolSpec
  return {
    type: 'function',
    function: {
      name: flat.name,
      description: flat.description,
      parameters: flat.parameters
    }
  }
}

export function skillFrontmatter(skill: Partial<SkillBundle>): string {
  return [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `version: ${skill.version}`,
    `author: ${skill.author}`,
    ...(skill.platforms && skill.platforms.length
      ? [`platforms: [${skill.platforms.join(', ')}]`]
      : []),
    'metadata:',
    '  moonwright:',
    `    tags: [${(skill.tags || []).join(', ')}]`,
    '---',
    ''
  ].join('\n')
}

/** Parses a SKILL.md back into a bundle. */
export function parseSkillMarkdown(text: string, id: string): SkillBundle | null {
  const front = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!front) return null
  const meta: Record<string, string> = {}
  for (const line of front[1].split('\n')) {
    const match = /^([a-zA-Z_]+):\s*(.*)$/.exec(line)
    if (match) meta[match[1]] = match[2].trim()
  }
  const tags = /tags:\s*\[(.*?)\]/.exec(front[1])?.[1] ?? ''
  return {
    id,
    name: meta.name || id,
    description: meta.description || '',
    version: meta.version || '0.1.0',
    author: meta.author || 'Moonwright',
    platforms: /platforms:\s*\[(.*?)\]/.exec(front[1])?.[1]
      ? /platforms:\s*\[(.*?)\]/.exec(front[1])![1]
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
    tags: tags
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    body: front[2] || '',
    createdAt: 0,
    updatedAt: 0
  }
}

/**
 * The skills port: a bundle is a directory with a SKILL.md.
 * LobeHub installs `<id>/SKILL.md`, ClawHub installs `<owner>/<slug>/SKILL.md` —
 * both layouts are read.
 */
export function makeSkillsPort(skillsDir: string): SkillsPort {
  const skillDir = (id: string): string => join(skillsDir, id)

  const skills: SkillsPort = {
    async list() {
      let entries: Array<{ name: string; isDirectory: () => boolean }> = []
      try {
        entries = readdirSync(skillsDir, { withFileTypes: true })
      } catch {
        return []
      }
      const out: SkillBundle[] = []
      const read = (id: string, file: string): void => {
        const bundle = parseSkillMarkdown(readFileSync(file, 'utf8'), id)
        if (!bundle) return
        const stat = statSync(file)
        bundle.createdAt = stat.birthtimeMs || stat.mtimeMs
        bundle.updatedAt = stat.mtimeMs
        bundle.path = file
        bundle.pinned = /pinned:\s*true/i.test(readFileSync(file, 'utf8'))
        out.push(bundle)
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const dir = join(skillsDir, entry.name)
        const direct = join(dir, 'SKILL.md')
        if (existsSync(direct)) {
          read(entry.name, direct)
          continue
        }
        // ClawHub installs under <owner>/<slug>/SKILL.md
        let nested: Array<{ name: string; isDirectory: () => boolean }> = []
        try {
          nested = readdirSync(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const child of nested) {
          if (!child.isDirectory()) continue
          const file = join(dir, child.name, 'SKILL.md')
          if (existsSync(file)) read(`${entry.name}/${child.name}`, file)
        }
      }
      return out
    },

    async read(id) {
      const candidates = [join(skillsDir, id, 'SKILL.md')]
      try {
        for (const entry of readdirSync(join(skillsDir, id), { withFileTypes: true })) {
          if (entry.isDirectory()) candidates.push(join(skillsDir, id, entry.name, 'SKILL.md'))
        }
      } catch {
        /* the skill may not be namespaced */
      }
      for (const file of candidates) {
        if (!existsSync(file)) continue
        const bundle = parseSkillMarkdown(readFileSync(file, 'utf8'), id)
        if (!bundle) continue
        const stat = statSync(file)
        bundle.createdAt = stat.birthtimeMs || stat.mtimeMs
        bundle.updatedAt = stat.mtimeMs
        bundle.path = file
        return bundle
      }
      return null
    },

    async write(bundle) {
      const dir = skillDir(bundle.id)
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'SKILL.md')
      writeFileSync(file, `${skillFrontmatter(bundle)}${bundle.body || ''}\n`, 'utf8')
      return { ...bundle, path: file, updatedAt: Date.now() }
    },

    async remove(id) {
      const dir = skillDir(id)
      if (!dir.startsWith(skillsDir)) return false
      rmSync(dir, { recursive: true, force: true })
      return true
    },

    async setPinned(id, pinned) {
      const bundle = await skills.read(id)
      if (!bundle) return
      const file = join(skillDir(id), 'SKILL.md')
      const text = readFileSync(file, 'utf8')
      const next = pinned
        ? text.replace(/^(---[\s\S]*?)^---/m, (match) => `${match}\npinned: true`)
        : text.replace(/^pinned:\s*true\n?/m, '')
      writeFileSync(file, next, 'utf8')
    }
  }

  return skills
}

/**
 * Translates the agent's message list into the OpenAI wire format. The
 * Moonwright core keeps tool calls in a `toolCalls` field; the API wants them
 * inline on the assistant turn, and tool results need their call id.
 */
export function toWireMessages(messages: ModelMessage[]): WireMessage[] {
  const out: WireMessage[] = []
  for (const message of messages) {
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length) {
      out.push({
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args || {}) }
        }))
      })
      continue
    }
    if (message.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: message.toolCallId || '',
        content: message.content ?? ''
      })
      continue
    }
    out.push({ role: message.role, content: message.content ?? '' })
  }
  return out
}

/** Wraps a raw tool result in the core's `ToolResult` shape. */
export function toToolResult(name: string, raw: unknown): ToolResult {
  const record = (raw ?? {}) as {
    ok?: boolean
    error?: string
    path?: string
    mutatedPaths?: string[]
  }
  if (record.error) {
    return { ok: false, error: record.error, output: raw }
  }
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

export interface PortOptions {
  provider: Provider
  runtime: { definitions(): WireToolSpec[] }
  memoryStore: BackendStore['memories']
  skillsDir: string
  emit: (event: string, payload: unknown) => void
  now: () => number
  extraTools?: WireToolSpec[]
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  /** Called with every streamed text delta, so the UI can show it live. */
  onText?: (delta: string) => void
}

/** Builds the Moonwright ports over the backend's services. */
export function makePorts(options: PortOptions): {
  callModel: (
    messages: ModelMessage[],
    callOptions?: {
      tools?: ToolSpec[]
      temperature?: number
      maxTokens?: number
      signal?: AbortSignal
    }
  ) => Promise<ModelResponse>
  listTools: () => ToolSpec[]
  runTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>
  memory: MemoryPort
  skills: SkillsPort
  emit: (event: string, payload: unknown) => void
  now: () => number
} {
  const { provider, runtime, memoryStore, skillsDir, emit, now, extraTools = [], runTool, onText } =
    options
  const skills = makeSkillsPort(skillsDir)

  const memory: MemoryPort = {
    async list(scope) {
      const all = memoryStore.all()
      return scope
        ? all.filter((entry) => entry.scope === scope).map(toMemoryRecord)
        : all.map(toMemoryRecord)
    },
    async add(record) {
      const saved = memoryStore.insert({
        id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        text: record.text,
        scope: record.scope ?? 'global',
        tags: record.tags ?? [],
        source: 'agent',
        createdAt: now()
      })
      return toMemoryRecord(saved)
    },
    async remove(id) {
      return memoryStore.remove(id)
    },
    async search(query, limit = 8) {
      const terms = String(query || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 2)
      const all = memoryStore.all()
      if (!terms.length) return all.slice(-limit).map(toMemoryRecord)
      return all
        .map((entry) => {
          const hay = `${entry.text} ${(entry.tags || []).join(' ')}`.toLowerCase()
          let score = 0
          for (const term of terms) if (hay.includes(term)) score += 1
          return { entry, score }
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item) => toMemoryRecord(item.entry))
    },
    async summarize(records) {
      if (!records.length) return ''
      const text = records.map((record) => `- ${record.text}`).join('\n')
      try {
        const out = await provider.complete(
          [
            {
              role: 'system',
              content:
                "Compress the user's remembered facts into at most five short bullet points. Keep only durable facts. No preamble."
            },
            { role: 'user', content: text }
          ],
          {}
        )
        return out.trim()
      } catch {
        return text
      }
    }
  }

  return {
    callModel: async (messages, callOptions) => {
      const response: ModelResponse = {
        text: null,
        toolCalls: [],
        usage: undefined,
        finishReason: 'stop'
      }
      const streamOptions = {
        ...(callOptions?.temperature !== undefined ? { temperature: callOptions.temperature } : {}),
        ...(callOptions?.maxTokens !== undefined ? { maxTokens: callOptions.maxTokens } : {}),
        ...(callOptions?.signal ? { signal: callOptions.signal } : {}),
        ...(callOptions?.tools ? { tools: callOptions.tools.map(toWireTool) } : {})
      }
      for await (const event of provider.stream(toWireMessages(messages), streamOptions)) {
        if (event.type === 'text') {
          response.text = (response.text || '') + event.delta
          onText?.(event.delta)
        } else if (event.type === 'tool_call') {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(event.args || '{}') as Record<string, unknown>
          } catch {
            args = {}
          }
          response.toolCalls.push({
            id: event.id || `call_${response.toolCalls.length}`,
            name: event.name,
            args
          })
        } else if (event.type === 'usage') {
          // the provider reports snake_case; the Moonwright core expects camelCase
          const usage = event.usage || {}
          response.usage = {
            prompt: usage.prompt_tokens ?? usage.prompt ?? 0,
            completion: usage.completion_tokens ?? usage.completion ?? 0,
            total: usage.total_tokens ?? usage.total ?? 0
          }
        }
      }
      return response
    },
    listTools: () => [
      ...runtime.definitions().map(toFlatTool),
      ...extraTools.map(toFlatTool)
    ],
    runTool: async (name, args) => toToolResult(name, await runTool(name, args)),
    memory,
    skills,
    emit: (event, payload) => emit(event, payload),
    now: () => now()
  }
}

function toMemoryRecord(entry: BackendMemory): MemoryRecord {
  return {
    id: entry.id,
    text: entry.text,
    scope: entry.scope,
    tags: entry.tags ?? [],
    createdAt: entry.createdAt
  }
}
