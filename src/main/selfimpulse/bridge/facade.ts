/**
 * THE FACADE — one engine, Knight's hands.
 *
 * Boot order in `main/index.ts`: `store.init()` → `initSelfImpulseEngine()` →
 * `registerIpc()` → window. By the time a renderer can talk, the engine has:
 *
 *   • a workspace on disk (`<userData>/selfimpulse/workspace`);
 *   • Knight's tool pack registered in `SELFIMPULSE_TOOLS`;
 *   • Knight's configured provider mirrored into the engine's own registry;
 *   • the provider key in the OS keychain under the engine's key ref;
 *   • a model caller that streams through Knight's `Provider` (one key, one
 *     failover path, one place that spends money).
 *
 * Nothing here fabricates readiness. No provider, key or model means the engine
 * reports `wired: false` with the reason and keeps running its local tools —
 * the model-planned step then refuses in words, which is the engine's contract.
 */
import { BrowserWindow } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Provider } from '../../backend/provider'
import { store } from '../../store'
import { IPC } from '@shared/ipc'
import {
  setKnightChat,
  setEngineWorkspace,
  selfImpulseDir,
  type KnightChatRequest,
  type KnightChatResponse
} from '../host/knight'
import {
  addProvider,
  listProviders,
  setModelPrefs,
  setProviderKey,
  updateProvider,
  type ProviderKind as EngineProviderKind
} from '../selfimpulse/engine/providers'
import {
  selfimpulseSession,
  subscribeSelfImpulse
} from '../selfimpulse/engine/selfimpulse'
import { knightToolContext, registerKnightTools } from './knightTools'

/** The registry id the engine sees. Knight's own provider keeps its own id. */
const ENGINE_PROVIDER_ID = 'knight'

export interface SelfImpulseEngineStatus {
  wired: boolean
  providerId: string | null
  model: string | null
  tools: string[]
  workspace: string
  reason: string | null
}

let status: SelfImpulseEngineStatus | null = null
let broadcasting = false

function engineKind(kind: string): EngineProviderKind {
  if (kind === 'anthropic') return 'anthropic'
  if (kind === 'compatible') return 'custom'
  if (kind === 'openai') return 'openai'
  return 'custom'
}

function knightKind(kind: string): 'anthropic' | 'openai' {
  return kind === 'anthropic' ? 'anthropic' : 'openai'
}

interface ChatBinding {
  providerId: string
  name: string
  baseUrl?: string
  kind: string
  apiKey: string
  model: string
}

/**
 * One model call, through Knight's provider. The engine has already applied
 * its egress guard and its tier routing before this runs; this function only
 * turns the request into a stream and sums the usage it actually received.
 */
async function knightModelCall(req: KnightChatRequest, binding: ChatBinding): Promise<KnightChatResponse> {
  const provider = new Provider({
    providerId: binding.providerId,
    baseUrl: binding.baseUrl,
    apiKey: binding.apiKey,
    model: req.model || binding.model,
    kind: knightKind(binding.kind)
  })

  const messages: Array<{ role: string; content: string }> = []
  if (req.system) messages.push({ role: 'system', content: req.system })
  for (const message of req.messages) messages.push({ role: message.role, content: message.content })

  let content = ''
  let input = 0
  let output = 0
  const started = Date.now()

  for await (const event of provider.stream(messages, {
    temperature: req.temperature,
    maxTokens: req.max_tokens
  })) {
    if (event.type === 'text') {
      content += event.delta
    } else if (event.type === 'usage') {
      input = Number(event.usage.prompt_tokens ?? event.usage.input_tokens ?? input)
      output = Number(event.usage.completion_tokens ?? event.usage.output_tokens ?? output)
    }
  }

  return {
    content,
    model: req.model || binding.model,
    usage: { input_tokens: input, output_tokens: output },
    duration_ms: Date.now() - started
  }
}

/** Idempotent: boot calls it once; a second call returns the same verdict. */
export function initSelfImpulseEngine(): SelfImpulseEngineStatus {
  if (status) return status

  const workspace = join(selfImpulseDir(), 'workspace')
  mkdirSync(workspace, { recursive: true })
  setEngineWorkspace(workspace)

  const settings = store.getPublicSettings()
  const tools = registerKnightTools(knightToolContext(workspace, settings.allowShell))

  const providerId = settings.defaultProviderId ?? null
  const stored = providerId ? store.getProvider(providerId) : undefined
  const apiKey = providerId ? store.getProviderSecret(providerId) : undefined
  const model = settings.defaultModel || stored?.models?.[0] || ''

  if (!stored || !apiKey || !model) {
    /* A removed provider must not leave the engine routing to its last key.
     * Disable the tier route and drop the caller, so the next step refuses
     * with the reason below instead of reaching a stale endpoint. */
    setModelPrefs({ enabled: false })
    setKnightChat(null)
    const unwired: SelfImpulseEngineStatus = {
      wired: false,
      providerId: providerId ?? null,
      model: model || null,
      tools,
      workspace,
      reason:
        'no default model provider is configured — the engine runs its local tools, and any model-planned step refuses in words until a provider, key and model are chosen in Settings.'
    }
    status = unwired
    startSelfImpulseBroadcast()
    return unwired
  }

  const kind = engineKind(stored.kind)
  const existing = listProviders().find((entry) => entry.id === ENGINE_PROVIDER_ID)

  if (existing) {
    updateProvider(ENGINE_PROVIDER_ID, {
      kind,
      label: stored.name,
      baseUrl: stored.baseUrl,
      defaultModel: model,
      enabled: true
    })
  } else {
    addProvider({
      id: ENGINE_PROVIDER_ID,
      kind,
      label: stored.name,
      baseUrl: stored.baseUrl,
      defaultModel: model
    })
  }

  /* The engine's own contract checks `providerHasKey` before it plans. Its key
   * store is the same OS keychain Knight's `SecretStore` uses, so this is the
   * real credential, encrypted, not a placeholder flag. */
  const keyWrite = setProviderKey(ENGINE_PROVIDER_ID, apiKey, kind)
  if (!keyWrite.ok) {
    const refused: SelfImpulseEngineStatus = {
      wired: false,
      providerId,
      model,
      tools,
      workspace,
      reason: keyWrite.refused ?? 'the provider key could not be stored in the OS keychain.'
    }
    status = refused
    startSelfImpulseBroadcast()
    return refused
  }

  setModelPrefs({
    enabled: true,
    cheap: { providerId: ENGINE_PROVIDER_ID, model },
    big: { providerId: ENGINE_PROVIDER_ID, model }
  })

  const binding: ChatBinding = {
    providerId: stored.id,
    name: stored.name,
    baseUrl: stored.baseUrl,
    kind: stored.kind,
    apiKey,
    model
  }
  setKnightChat((req) => knightModelCall(req, binding))

  const ready: SelfImpulseEngineStatus = { wired: true, providerId, model, tools, workspace, reason: null }
  status = ready
  startSelfImpulseBroadcast()
  return ready
}

/**
 * Re-bind after the user changes provider settings. The chat seam, key and
 * tier route are all derived state, so they are rebuilt from the same
 * `initSelfImpulseEngine` path rather than patched piecemeal.
 */
export function refreshSelfImpulseEngine(): SelfImpulseEngineStatus {
  status = null
  return initSelfImpulseEngine()
}

export function selfImpulseEngineStatus(): SelfImpulseEngineStatus {
  return (
    status ?? {
      wired: false,
      providerId: null,
      model: null,
      tools: [],
      workspace: join(selfImpulseDir(), 'workspace'),
      reason: 'the engine has not been initialised yet.'
    }
  )
}

/**
 * Push every session change to the renderer. The engine commits on each
 * decision, so the UI sees the same state the receipts describe — there is no
 * second copy to drift.
 */
export function startSelfImpulseBroadcast(): void {
  if (broadcasting) return
  broadcasting = true
  subscribeSelfImpulse(() => {
    const session = selfimpulseSession()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.eventSelfImpulse, session)
    }
  })
}
