import type {
  AgentCapability,
  AgentRiskCeiling,
  AgentRole,
  GovernanceSettings
} from '@shared/governance'

/** Structural boundary: policy tests do not need Zod or a concrete tool runtime. */
export interface PolicyTool {
  name: string
  sideEffect: 'none' | 'read' | 'write' | 'execute' | 'network'
  risk: 'low' | 'medium' | 'high'
}

export interface PolicyDecision {
  allowed: boolean
  role: AgentRole
  reason: string
  capability?: AgentCapability
}

const RISK_RANK: Record<AgentRiskCeiling, number> = { low: 0, medium: 1, high: 2 }

const PRESETS: Record<
  Exclude<AgentRole, 'custom'>,
  { capabilities: ReadonlySet<AgentCapability>; maxRisk: AgentRiskCeiling }
> = {
  executor: {
    capabilities: new Set(['read', 'write', 'execute', 'network', 'delegate']),
    maxRisk: 'high'
  },
  researcher: {
    capabilities: new Set(['read', 'network', 'delegate']),
    maxRisk: 'medium'
  },
  viewer: {
    capabilities: new Set(['read']),
    maxRisk: 'low'
  }
}

export function resolveTaskRole(assigned: AgentRole | undefined): AgentRole {
  /* Older tasks predate role assignment. Executor is the compatibility role;
   * changing the default for new tasks must not silently rewrite old tasks. */
  return assigned ?? 'executor'
}

function wildcardMatch(pattern: string, value: string): boolean {
  const escaped = pattern
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i').test(value)
}

function matchesAny(patterns: readonly string[], value: string): boolean {
  return patterns.some((pattern) => pattern.trim() && wildcardMatch(pattern, value))
}

function requiredCapability(tool: PolicyTool): AgentCapability | null {
  if (tool.name === 'delegate_to_crew') return 'delegate'
  return tool.sideEffect === 'none' ? null : tool.sideEffect
}

/**
 * One authoritative action-time decision. Tool-list filtering is only a
 * usability optimisation; the runtime calls this again immediately before
 * validation, approval, or execution so cached model calls cannot bypass it.
 */
export function authorizeTool(
  assignedRole: AgentRole | undefined,
  settings: GovernanceSettings,
  tool: PolicyTool
): PolicyDecision {
  const role = resolveTaskRole(assignedRole)
  const profile =
    role === 'custom'
      ? {
          capabilities: new Set(settings.custom.capabilities),
          maxRisk: settings.custom.maxRisk
        }
      : PRESETS[role]

  if (role === 'custom' && matchesAny(settings.custom.toolDenylist, tool.name)) {
    return {
      allowed: false,
      role,
      reason: `The Custom role explicitly denies ${tool.name}.`
    }
  }
  if (
    role === 'custom' &&
    settings.custom.toolAllowlist.length > 0 &&
    !matchesAny(settings.custom.toolAllowlist, tool.name)
  ) {
    return {
      allowed: false,
      role,
      reason: `${tool.name} is not in the Custom role's tool allowlist.`
    }
  }

  const capability = requiredCapability(tool)
  if (capability && !profile.capabilities.has(capability)) {
    return {
      allowed: false,
      role,
      capability,
      reason: `${role === 'custom' ? 'Custom' : role[0].toUpperCase() + role.slice(1)} does not grant the ${capability} capability required by ${tool.name}.`
    }
  }
  if (RISK_RANK[tool.risk] > RISK_RANK[profile.maxRisk]) {
    return {
      allowed: false,
      role,
      capability: capability ?? undefined,
      reason: `${tool.name} is ${tool.risk} risk, above the ${profile.maxRisk}-risk ceiling for this role.`
    }
  }
  return {
    allowed: true,
    role,
    capability: capability ?? undefined,
    reason: `${role === 'custom' ? 'Custom' : role[0].toUpperCase() + role.slice(1)} grants this action.`
  }
}

export function permittedTools<T extends PolicyTool>(
  assignedRole: AgentRole | undefined,
  settings: GovernanceSettings,
  tools: readonly T[]
): T[] {
  return tools.filter((tool) => authorizeTool(assignedRole, settings, tool).allowed)
}
