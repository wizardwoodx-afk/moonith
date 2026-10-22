/**
 * OpenAI-compatible provider client with SSE streaming, tool calling and
 * automatic failover between the providers that hold credentials.
 *
 * Ported from Seamoon's `electron/backend/provider.js`.
 */

export interface ProviderDefinition {
  id: string
  name: string
  baseUrl: string
  apiKeyEnv: string[]
  defaultModel: string
  extraHeaders?: Record<string, string>
  note?: string
}

export interface AvailableProvider extends ProviderDefinition {
  hasKey: boolean
  keyEnv: string | null
  available: boolean
}

export interface ResolvedProviderConfig {
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
  kind?: 'anthropic' | 'openai'
}

export interface ProviderSettings {
  providerId?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  kind?: 'anthropic' | 'openai'
  extraHeaders?: Record<string, string>
  requestTimeoutMs?: number
  [key: string]: unknown
}

export interface ProviderAttempt {
  providerId: string
  baseUrl: string
  model: string
  apiKey?: string
}

/** An OpenAI-style function tool spec. */
export interface ProviderToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: object
  }
}

export interface StreamOptions {
  tools?: ProviderToolSpec[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export type ProviderEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; index: number; id: string; name: string; args: string }
  | { type: 'tool_delta'; index: number; args: string }
  | { type: 'usage'; usage: Record<string, number> }
  | { type: 'done' }

export interface WireMessage {
  role: string
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  [key: string]: unknown
}

function readEnvConfig(): { baseUrl: string; apiKey: string; model: string } {
  const base = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || ''
  const key = process.env.OPENAI_API_KEY || ''
  const model = process.env.OPENAI_MODEL || ''
  return { baseUrl: base.replace(/\/+$/, ''), apiKey: key, model }
}

/**
 * Providers the backend can talk to out of the box. Each is OpenAI-compatible,
 * so one client implementation covers them all.
 */
export const BUILTIN_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    baseUrl: 'https://api.githubcopilot.com',
    apiKeyEnv: [],
    defaultModel: 'gpt-4o',
    extraHeaders: { 'Copilot-Integration-Id': 'knight', 'Editor-Version': 'vscode/1.95.0' },
    note: 'Uses your own GitHub token (gh auth token).'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: ['GEMINI_API_KEY_1', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY'],
    defaultModel: 'models/gemini-2.5-flash'
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: ['MISTRAL_API_KEY_3', 'MISTRAL_API_KEY_1', 'MISTRAL_API_KEY'],
    defaultModel: 'codestral-2508'
  },
  {
    id: 'cohere',
    name: 'Cohere',
    baseUrl: 'https://api.cohere.com/compatibility/v1',
    apiKeyEnv: ['COHERE_API_KEY', 'COHERE_API_KEY_2'],
    defaultModel: 'command-a-03-2025'
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyEnv: ['CEREBRAS_API_KEY_2', 'CEREBRAS_API_KEY_5', 'CEREBRAS_API_KEY'],
    defaultModel: 'gpt-oss-120b'
  },
  {
    id: 'openai',
    name: 'OpenAI-compatible (env)',
    baseUrl: '',
    apiKeyEnv: ['OPENAI_API_KEY'],
    defaultModel: ''
  }
]

function keyFor(provider: ProviderDefinition): { key: string; env: string | null } {
  for (const env of provider.apiKeyEnv || []) {
    if (process.env[env]) return { key: process.env[env] as string, env }
  }
  return { key: '', env: null }
}

export function availableProviders(): AvailableProvider[] {
  return BUILTIN_PROVIDERS.map((provider) => {
    const { key, env } = keyFor(provider)
    return {
      ...provider,
      hasKey: Boolean(key),
      keyEnv: env,
      // Copilot's key comes from the user's GitHub token, not an env var.
      available: provider.id === 'copilot' ? true : Boolean(key) || !provider.apiKeyEnv?.length
    }
  })
}

/** Pick the provider configuration to use, honouring explicit user settings first. */
export function resolveConfig(settings: ProviderSettings = {}): ResolvedProviderConfig {
  if (settings.baseUrl) {
    const env = readEnvConfig()
    return {
      providerId: settings.providerId || 'custom',
      baseUrl: settings.baseUrl.replace(/\/+$/, ''),
      apiKey: settings.apiKey || env.apiKey,
      model: settings.model || env.model || '',
      kind: settings.kind
    }
  }
  const list = availableProviders()
  const preferred = list.find((p) => p.id === settings.providerId && p.available)
  const chosen = preferred || list.find((p) => p.available)
  if (!chosen) {
    const env = readEnvConfig()
    return {
      providerId: 'openai',
      baseUrl: env.baseUrl,
      apiKey: env.apiKey,
      model: env.model,
      kind: settings.kind
    }
  }
  const { key } = keyFor(chosen)
  return {
    providerId: chosen.id,
    baseUrl: chosen.baseUrl,
    apiKey: key,
    model: settings.model || chosen.defaultModel,
    kind: settings.kind
  }
}

export interface TierConfig {
  thinking: boolean
  effort: string | null
  visibility: boolean
  context: number
  multiplier: string
}

export const DEFAULT_TIER_CONFIG: Record<string, TierConfig> = {
  auto: { thinking: false, effort: null, visibility: true, context: 200000, multiplier: '1x' },
  swift: { thinking: false, effort: null, visibility: true, context: 200000, multiplier: '0.5x' },
  balanced: { thinking: false, effort: null, visibility: true, context: 400000, multiplier: '1x' },
  deep: { thinking: true, effort: 'high', visibility: true, context: 1000000, multiplier: '2x' },
  agentic: { thinking: true, effort: 'maximum', visibility: true, context: 1000000, multiplier: '1.5x' },
  lean: { thinking: false, effort: null, visibility: true, context: 128000, multiplier: '0.25x' }
}

export interface ModelTier {
  id: string
  name: string
  desc: string
  env: string[]
}

export const MODEL_TIERS: ModelTier[] = [
  {
    id: 'auto',
    name: 'Auto',
    desc: 'Picks the tier that fits the task and the credits you have left.',
    env: ['OPENAI_MODEL']
  },
  {
    id: 'swift',
    name: 'Swift',
    desc: 'Short answers, fewest tokens, nothing wasted on deliberation.',
    env: ['KNIGHT_FAST_MODEL']
  },
  {
    id: 'balanced',
    name: 'Balanced',
    desc: 'The everyday tier: capable, but not spending credits on extra thinking.',
    env: ['KNIGHT_BALANCED_MODEL']
  },
  {
    id: 'deep',
    name: 'Deep',
    desc: 'Reasons before answering. Use it when the answer has to be right.',
    env: ['KNIGHT_ULTIMATE_MODEL']
  },
  {
    id: 'agentic',
    name: 'Agentic',
    desc: 'Maximum reasoning depth, for the tasks that need the whole budget.',
    env: ['KNIGHT_CANTUS_MODEL']
  },
  {
    id: 'lean',
    name: 'Lean',
    desc: 'The cheapest thing that still finishes the job.',
    env: ['KNIGHT_EFFICIENT_MODEL']
  }
]

export const THINKING_EFFORTS = ['low', 'medium', 'high', 'extra-high', 'maximum']

export function tierModel(tier: ModelTier, fallbackModel: string): string {
  for (const env of tier.env || []) {
    if (process.env[env]) return process.env[env] as string
  }
  return fallbackModel
}

export class Provider {
  settings: ProviderSettings
  lastUsed: string | null = null
  onAttempt: ((cfg: ProviderAttempt) => void) | undefined

  constructor(settings: ProviderSettings) {
    this.settings = settings
  }

  config(): ResolvedProviderConfig {
    const resolved = resolveConfig(this.settings)
    return {
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      providerId: resolved.providerId,
      kind: resolved.kind
    }
  }

  /**
   * Ordered list of endpoints to try. The configured one first, then every other
   * provider whose credentials are present — so a rate-limited or out-of-credit
   * provider degrades into the next working one instead of failing the run.
   */
  candidates(): ResolvedProviderConfig[] {
    const primary = this.config()
    const out: ResolvedProviderConfig[] = []
    if (primary.baseUrl && primary.apiKey) out.push(primary)
    for (const provider of availableProviders()) {
      if (provider.id === primary.providerId) continue
      const { key } = keyFor(provider)
      if (!provider.baseUrl || !key) continue
      out.push({
        providerId: provider.id,
        baseUrl: provider.baseUrl,
        apiKey: key,
        model: provider.defaultModel,
        kind: 'openai'
      })
    }
    if (!out.length && primary.baseUrl) out.push(primary)
    return out
  }

  headers(cfg: ResolvedProviderConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      ...(this.settings.extraHeaders || {})
    }
  }

  async listModels(): Promise<Array<{ id: string; label: string }>> {
    const cfg = this.config()
    if (!cfg.baseUrl) throw new Error('No provider base URL configured')
    const res = await fetch(`${cfg.baseUrl}/models`, { headers: this.headers(cfg) })
    if (!res.ok) {
      throw new Error(`models request failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
    }
    const json = (await res.json()) as {
      data?: Array<{ id?: string; name?: string }>
      models?: Array<{ id?: string; name?: string }>
    }
    return (json.data || json.models || []).map((model) => ({
      id: model.id || model.name || '',
      label: model.id || model.name || ''
    }))
  }

  /**
   * Streams a chat completion. Yields events:
   *   { type: "text", delta }
   *   { type: "tool_call", index, id, name, args }
   *   { type: "tool_delta", index, args }
   *   { type: "usage", usage }
   *   { type: "done" }
   */
  async *stream(
    messages: WireMessage[],
    options: StreamOptions = {}
  ): AsyncGenerator<ProviderEvent, void, unknown> {
    const candidates = this.candidates()
    if (!candidates.length) {
      throw new Error('No provider is configured and no API key was found in the environment')
    }

    let lastError: Error | null = null
    for (const cfg of candidates) {
      let yielded = false
      try {
        this.onAttempt?.(cfg)
        yield* this.streamWith(
          cfg.model ? cfg : { ...cfg, model: candidates[0].model },
          messages,
          {
            ...options,
            onFirst: () => {
              yielded = true
            }
          }
        )
        this.lastUsed = cfg.providerId
        return
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        // Only fall over to another provider if this attempt produced nothing:
        // retrying mid-stream would duplicate the text the user already saw.
        if (yielded || !Provider.retriable(lastError) || options.signal?.aborted) break
        continue
      }
    }
    throw lastError || new Error('provider failed')
  }

  static retriable(error: unknown): boolean {
    const message = String((error as { message?: string })?.message || '')
    return (
      /\b(402|429|500|502|503|504)\b/.test(message) ||
      /quota|credits|rate limit|temporarily/i.test(message)
    )
  }

  private async *streamWith(
    cfg: ResolvedProviderConfig,
    messages: WireMessage[],
    options: StreamOptions & { onFirst?: () => void }
  ): AsyncGenerator<ProviderEvent, void, unknown> {
    const timeout = AbortSignal.timeout(this.settings.requestTimeoutMs || 60000)
    const signal = options.signal
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

    // Anthropic has its own wire format; the same event contract comes out.
    if (cfg.kind === 'anthropic') {
      const { streamAnthropic } = await import('./anthropic')
      for await (const event of streamAnthropic({
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl || undefined,
        model: cfg.model,
        messages,
        tools: options.tools,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        signal: combined
      })) {
        if (event.type === 'text') options.onFirst?.()
        yield event
      }
      return
    }

    const body = {
      model: cfg.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(options.tools && options.tools.length
        ? { tools: options.tools, tool_choice: 'auto' }
        : {})
    }

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(cfg),
      body: JSON.stringify(body),
      signal: combined
    })
    if (!res.ok) {
      const text = (await res.text()).slice(0, 400)
      throw new Error(`provider ${res.status}: ${text}`)
    }
    if (!res.body) throw new Error('provider returned an empty body')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const toolCalls = new Map<number, { index: number; id: string; name: string; args: string }>()

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue
        let json: {
          choices?: Array<{
            delta?: {
              content?: string
              tool_calls?: Array<{
                index?: number
                id?: string
                function?: { name?: string; arguments?: string }
              }>
            }
          }>
          usage?: Record<string, number>
        }
        try {
          json = JSON.parse(payload)
        } catch {
          continue
        }
        const choice = json.choices?.[0]
        const delta = choice?.delta
        if (delta?.content) {
          options.onFirst?.()
          yield { type: 'text', delta: delta.content }
        }
        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index ?? 0
            if (!toolCalls.has(index)) {
              toolCalls.set(index, {
                index,
                id: toolCall.id ?? '',
                name: toolCall.function?.name ?? '',
                args: ''
              })
            }
            const record = toolCalls.get(index)!
            if (toolCall.id) record.id = toolCall.id
            if (toolCall.function?.name) record.name = toolCall.function.name
            if (toolCall.function?.arguments) {
              record.args += toolCall.function.arguments
              yield { type: 'tool_delta', index, args: toolCall.function.arguments }
            }
          }
        }
        if (json.usage) yield { type: 'usage', usage: json.usage }
      }
    }

    for (const call of toolCalls.values()) {
      yield { type: 'tool_call', id: call.id, name: call.name, args: call.args, index: call.index }
    }
    yield { type: 'done' }
  }

  async complete(messages: WireMessage[], options: StreamOptions = {}): Promise<string> {
    let out = ''
    for await (const event of this.stream(messages, options)) {
      if (event.type === 'text') out += event.delta
    }
    return out
  }
}
