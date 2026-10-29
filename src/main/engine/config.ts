import type { PermissionMode, ProviderKind } from '@shared/types'

/**
 * The execution engine is a separate process with its own configuration
 * format. This module turns SelfImpulse settings into that format without ever
 * writing a key to disk: API keys are referenced as `{env:VAR}` templates and
 * the values travel in the child process environment only.
 */

export interface EngineProviderInput {
  id: string
  name: string
  kind: ProviderKind
  baseUrl?: string
  models: string[]
  apiKey?: string
  enabled: boolean
}

export interface EngineBridgeInput {
  command: string[]
  environment: Record<string, string>
}

export interface EngineConfigInput {
  providers: EngineProviderInput[]
  bridge?: EngineBridgeInput
  permissionMode: PermissionMode
  model?: { providerId: string; model: string }
  /** Task workspace used as the engine's project directory. */
  directory?: string
  /** Specialists the engine may spawn as sub-agents. */
  subagents?: EngineSubagent[]
  /** Which sub-agents the task's own permission role allows. */
  crew?: CrewPermissionInput
}

export interface EngineSubagent {
  id: string
  description: string
  system: string
}

export interface EngineConfigResult {
  config: Record<string, unknown>
  env: Record<string, string>
  /** SelfImpulse provider id → engine provider id. */
  providerIds: Record<string, string>
  /** Engine provider id → model ids offered by that provider. */
  models: Record<string, string[]>
}

const PACKAGE_BY_KIND: Record<ProviderKind, string> = {
  openai: '@opencode/ai/providers/openai-compatible',
  compatible: '@opencode/ai/providers/openai-compatible',
  anthropic: '@opencode/ai/providers/anthropic-compatible'
}

export function engineProviderId(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'provider'
}

export function engineKeyEnv(providerId: string): string {
  const suffix = providerId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
  return `SI_ENGINE_KEY_${suffix}`
}

/**
 * Mutations and reads both belong to SelfImpulse's governed toolbelt, so the
 * engine's own copies are denied and disappear from its tool list. A denied
 * tool never reaches the filesystem: writes still pass diff review and
 * checkpoints, and reads stay inside the task's granted folders. In manual mode
 * the bridged webfetch is approved by our broker like every other action.
 *
 * `subagent` is deliberately absent: spawning a specialist is the engine's own
 * job, and the crew it may name is restricted by the rules built below.
 */
const NATIVE_DENIED = [
  'edit',
  'write',
  'patch',
  'shell',
  'read',
  'glob',
  'grep',
  'webfetch',
  'websearch',
  'skill',
  'question',
  /* Denying the code-mode umbrella turns code mode off, so the model cannot
   * run code inside the engine outside the governed belt. */
  'execute'
] as const

export interface PermissionRule {
  action: string
  resource: string
  effect: 'allow' | 'deny' | 'ask'
}

export interface CrewPermissionInput {
  /** False when the task's role does not grant delegation at all. */
  allowed: boolean
  /** The specialist ids the engine may spawn; every other agent stays denied. */
  agentIds: string[]
}

export function permissionRules(
  _mode: PermissionMode,
  crew: CrewPermissionInput = { allowed: false, agentIds: [] }
): PermissionRule[] {
  const rules: PermissionRule[] = NATIVE_DENIED.map((action) => ({
    action,
    resource: '*',
    effect: 'deny'
  }))
  /* The engine hides a tool whose last matching rule is a blanket deny, so the
   * crew's ids are appended after it: delegation allowed means the subagent
   * tool is visible and only these specialists are offered to the model. */
  rules.push({ action: 'subagent', resource: '*', effect: 'deny' })
  if (crew.allowed) {
    for (const id of crew.agentIds) {
      rules.push({ action: 'subagent', resource: id, effect: 'allow' })
    }
  }
  return rules
}

export function buildEngineConfig(input: EngineConfigInput): EngineConfigResult {
  const providers: Record<string, unknown> = {}
  const env: Record<string, string> = {}
  const providerIds: Record<string, string> = {}
  const models: Record<string, string[]> = {}

  for (const provider of input.providers) {
    if (!provider.enabled) continue
    if (!provider.baseUrl && provider.kind !== 'anthropic') continue
    const engineId = engineProviderId(provider.id)
    if (providers[engineId]) continue
    const keyEnv = engineKeyEnv(engineId)
    const settings: Record<string, unknown> = {
      ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
      ...(provider.apiKey ? { apiKey: `{env:${keyEnv}}` } : {})
    }
    if (provider.apiKey) env[keyEnv] = provider.apiKey
    const modelIds = [...new Set(provider.models.map((model) => model.trim()).filter(Boolean))]
    providers[engineId] = {
      name: provider.name,
      package: PACKAGE_BY_KIND[provider.kind] ?? PACKAGE_BY_KIND.compatible,
      settings,
      models: Object.fromEntries(modelIds.map((model) => [model, { name: model }]))
    }
    providerIds[provider.id] = engineId
    models[engineId] = modelIds
  }

  const config: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false,
    update: 'disable',
    share: 'disabled',
    providers,
    permissions: permissionRules(input.permissionMode, input.crew),
    ...(input.subagents?.length
      ? {
          agents: Object.fromEntries(
            input.subagents.map((agent) => [
              agent.id,
              { description: agent.description, mode: 'subagent', system: agent.system }
            ])
          )
        }
      : {}),
    ...(input.model && providers[engineProviderId(input.model.providerId)]
      ? {
          model: {
            providerID: engineProviderId(input.model.providerId),
            model: input.model.model
          }
        }
      : {}),
    ...(input.bridge
      ? {
          mcp: {
            servers: {
              selfimpulse: {
                type: 'local',
                command: input.bridge.command,
                environment: input.bridge.environment,
                // Our tools mirror the full schema themselves; code mode would
                // bury them behind another layer.
                codemode: false
              }
            }
          }
        }
      : {})
  }

  return { config, env, providerIds, models }
}
