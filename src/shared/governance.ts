/**
 * Enterprise control-plane contracts shared by the main process and renderer.
 * Defaults deliberately preserve the existing desktop behaviour: new tasks are
 * Executors and data-loss prevention is opt-in.
 */

export type AgentRole = 'executor' | 'researcher' | 'viewer' | 'custom'
export type AgentCapability = 'read' | 'write' | 'execute' | 'network' | 'delegate'
export type AgentRiskCeiling = 'low' | 'medium' | 'high'

export interface CustomAgentPolicy {
  capabilities: AgentCapability[]
  maxRisk: AgentRiskCeiling
  /** Empty means every tool allowed by the capabilities. Supports `*`. */
  toolAllowlist: string[]
  /** Deny rules always win. Supports `*`. */
  toolDenylist: string[]
}

export type DlpMode = 'off' | 'redact' | 'block'
export type SensitiveDataCategory =
  | 'api-key'
  | 'private-key'
  | 'jwt'
  | 'secret'
  | 'email'
  | 'credit-card'
  | 'phone'

export interface DlpSettings {
  mode: DlpMode
  categories: SensitiveDataCategory[]
}

export interface GovernanceSettings {
  /** Assigned to newly created tasks. Existing tasks keep their own role. */
  defaultRole: AgentRole
  /** The shared definition used by tasks whose role is `custom`. */
  custom: CustomAgentPolicy
  dlp: DlpSettings
}

export interface DlpFindingSummary {
  category: SensitiveDataCategory
  count: number
}

export interface DlpInspection {
  total: number
  findings: DlpFindingSummary[]
  redacted: string
}

export const ALL_SENSITIVE_DATA_CATEGORIES: SensitiveDataCategory[] = [
  'api-key',
  'private-key',
  'jwt',
  'secret',
  'email',
  'credit-card',
  'phone'
]

export const DEFAULT_GOVERNANCE_SETTINGS: GovernanceSettings = {
  defaultRole: 'executor',
  custom: {
    capabilities: ['read', 'write', 'execute', 'network', 'delegate'],
    maxRisk: 'high',
    toolAllowlist: [],
    toolDenylist: []
  },
  dlp: {
    mode: 'off',
    categories: ALL_SENSITIVE_DATA_CATEGORIES.filter((category) => category !== 'phone')
  }
}

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  executor: 'Executor',
  researcher: 'Researcher',
  viewer: 'Viewer',
  custom: 'Custom'
}

export const SENSITIVE_DATA_LABELS: Record<SensitiveDataCategory, string> = {
  'api-key': 'API keys & tokens',
  'private-key': 'Private keys',
  jwt: 'JSON web tokens',
  secret: 'Passwords & secret fields',
  email: 'Email addresses',
  'credit-card': 'Payment cards',
  phone: 'Phone numbers'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function allowedValues<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: readonly T[]
): T[] {
  if (!Array.isArray(value)) return [...fallback]
  return [...new Set(value.filter((item): item is T => allowed.includes(item as T)))]
}

function stringList(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.slice(0, 200))
    )
  ].slice(0, 200)
}

export function normalizeAgentRole(
  input: unknown,
  fallback: AgentRole = 'executor'
): AgentRole {
  return input === 'executor' || input === 'researcher' || input === 'viewer' || input === 'custom'
    ? input
    : fallback
}

/** Treat persisted settings and renderer IPC as untrusted input. */
export function normalizeGovernanceSettings(
  input: unknown,
  fallback: GovernanceSettings = DEFAULT_GOVERNANCE_SETTINGS
): GovernanceSettings {
  const root = record(input)
  const custom = record(root.custom)
  const dlp = record(root.dlp)
  const capabilities: AgentCapability[] = ['read', 'write', 'execute', 'network', 'delegate']
  const risks: AgentRiskCeiling[] = ['low', 'medium', 'high']
  const modes: DlpMode[] = ['off', 'redact', 'block']
  return {
    defaultRole: normalizeAgentRole(root.defaultRole, fallback.defaultRole),
    custom: {
      capabilities: allowedValues(custom.capabilities, capabilities, fallback.custom.capabilities),
      maxRisk: risks.includes(custom.maxRisk as AgentRiskCeiling)
        ? (custom.maxRisk as AgentRiskCeiling)
        : fallback.custom.maxRisk,
      toolAllowlist: stringList(custom.toolAllowlist, fallback.custom.toolAllowlist),
      toolDenylist: stringList(custom.toolDenylist, fallback.custom.toolDenylist)
    },
    dlp: {
      mode: modes.includes(dlp.mode as DlpMode) ? (dlp.mode as DlpMode) : fallback.dlp.mode,
      categories: allowedValues(
        dlp.categories,
        ALL_SENSITIVE_DATA_CATEGORIES,
        fallback.dlp.categories
      )
    }
  }
}

export const GOVERNANCE_IPC = {
  inspect: 'governance:inspect-dlp'
} as const
