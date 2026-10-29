import { engineSupervisor, type EngineStatus } from './supervisor'
import { toolBridge } from './bridge'
import { buildEngineConfig } from './config'
import type { EngineClient } from './client'
import { store, openSecret } from '../store'
import { engineCrewAgents } from '../services/subagents'
import type { PermissionMode } from '@shared/types'

export interface PreparedEngine {
  client: EngineClient
  providerId: string
  model: string
}

export class EngineUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineUnavailable'
  }
}

/**
 * Starts (or reuses) the execution engine with the current settings and hands
 * back a client. Keys are decrypted here and passed through the child's
 * environment; the generated config only references them as `{env:...}`.
 */
export async function prepareEngine(input: {
  providerId?: string
  model?: string
  permissionMode: PermissionMode
  /** The task's permission role decides whether the engine may spawn the crew. */
  canDelegate: boolean
}): Promise<PreparedEngine> {
  const settings = store.getPublicSettings()
  const chosenId = input.providerId || settings.defaultProviderId
  const stored = chosenId ? store.getProvider(chosenId) : undefined
  if (!chosenId || !stored) throw new EngineUnavailable('Connect an AI provider in Settings to get started.')
  if (!stored.enabled) throw new EngineUnavailable(`The provider “${stored.name}” is disabled.`)
  const apiKey = openSecret(stored.secret)
  if (!apiKey) throw new EngineUnavailable(`The provider “${stored.name}” has no key saved.`)
  if (stored.kind !== 'anthropic' && !stored.baseUrl) {
    throw new EngineUnavailable(`The provider “${stored.name}” needs a base URL before the engine can use it.`)
  }
  const model = input.model || settings.defaultModel || stored.models[0]
  if (!model) throw new EngineUnavailable(`The provider “${stored.name}” has no model to run.`)

  const bridge = await toolBridge.start()
  const subagents = engineCrewAgents()
  const built = buildEngineConfig({
    providers: settings.providers.map((provider) => {
      const secret = openSecret(store.getProvider(provider.id)?.secret)
      return {
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        baseUrl: provider.baseUrl,
        models: provider.models,
        apiKey: secret,
        enabled: provider.enabled
      }
    }),
    bridge: {
      command: [process.execPath, engineSupervisor.bridgeScript()],
      environment: {
        ELECTRON_RUN_AS_NODE: '1',
        SI_ENGINE_PIPE: bridge.pipePath,
        SI_ENGINE_TOKEN: bridge.token
      }
    },
    permissionMode: input.permissionMode,
    model: { providerId: chosenId, model },
    subagents,
    crew: { allowed: input.canDelegate, agentIds: subagents.map((agent) => agent.id) }
  })

  const client = await engineSupervisor.start({
    config: built.config,
    env: built.env,
    providerCount: settings.providers.filter((provider) => provider.enabled).length
  })
  return { client, providerId: chosenId, model }
}

export function engineStatus(): EngineStatus {
  return engineSupervisor.status()
}

export async function stopEngine(): Promise<void> {
  await engineSupervisor.stop()
  await toolBridge.stop()
}
