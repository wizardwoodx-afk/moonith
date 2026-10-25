import { createHash } from 'node:crypto'
import {
  AGENT_ROLE_ID,
  DEFAULT_NAMESPACE_ID,
  LOCAL_OWNER_PRINCIPAL_ID,
  OWNER_ROLE_ID,
  ENTERPRISE_ACTIONS,
  ENTERPRISE_RESOURCE_KINDS,
  type EnterpriseAccessBinding,
  type EnterpriseAction,
  type EnterpriseAuthorization,
  type EnterpriseControlState,
  type EnterpriseDecision,
  type EnterpriseResource,
  type EnterpriseResourceKind,
  type EnterpriseRestriction
} from '../../shared/enterpriseControl'

/**
 * Authorization semantics adapted for SelfImpulse's native desktop runtime:
 * exact namespace/resource matching, default deny, and Restrictions overriding
 * every grant. This is policy enforcement, not a claim of OS/host tenant isolation.
 */

const ENTITY_TIMES = (now: number): { createdAt: string; updatedAt: string } => {
  const at = new Date(now).toISOString()
  return { createdAt: at, updatedAt: at }
}

export function createDefaultEnterpriseState(now = Date.now()): EnterpriseControlState {
  const times = ENTITY_TIMES(now)
  return {
    format: 'selfimpulse-enterprise-control/1',
    revision: 1,
    defaultNamespaceId: DEFAULT_NAMESPACE_ID,
    namespaces: [
      {
        id: DEFAULT_NAMESPACE_ID,
        name: 'Local workspace',
        description: 'Native SelfImpulse agents, missions, tools, memory, and approvals on this profile.',
        lifecycle: 'active',
        ...times
      }
    ],
    principals: [
      {
        id: LOCAL_OWNER_PRINCIPAL_ID,
        kind: 'human',
        name: 'Local owner',
        namespaceId: DEFAULT_NAMESPACE_ID,
        lifecycle: 'active',
        ...times
      }
    ],
    roles: [
      {
        id: OWNER_ROLE_ID,
        namespaceId: DEFAULT_NAMESPACE_ID,
        name: 'Workspace owner',
        description: 'Full native control-plane and workspace permissions for this local profile.',
        actions: [...ENTERPRISE_ACTIONS],
        resourceKinds: [...ENTERPRISE_RESOURCE_KINDS],
        lifecycle: 'active',
        ...times
      },
      {
        id: AGENT_ROLE_ID,
        namespaceId: DEFAULT_NAMESPACE_ID,
        name: 'Native mission agent',
        description: 'Run assigned missions and use governed tools and memory. No control-plane administration or approval self-decision.',
        actions: ['mission.run', 'agent.invoke', 'tool.use', 'memory.read', 'memory.write'],
        resourceKinds: ['mission', 'agent', 'tool', 'memory'],
        lifecycle: 'active',
        ...times
      }
    ],
    bindings: [
      {
        id: 'binding:local-owner',
        namespaceId: DEFAULT_NAMESPACE_ID,
        principalId: LOCAL_OWNER_PRINCIPAL_ID,
        roleId: OWNER_ROLE_ID,
        resource: { kind: 'namespace', namespaceId: DEFAULT_NAMESPACE_ID, id: DEFAULT_NAMESPACE_ID },
        lifecycle: 'active',
        ...times
      }
    ],
    restrictions: []
  }
}

export function nativeAgentPrincipalId(teamId: string, seatId: string): string {
  const readable = `agent:${encodeURIComponent(teamId)}:${encodeURIComponent(seatId)}`
  if (readable.length <= 140) return readable
  // Preserve a valid bounded IPC id even for unusually long or heavily escaped
  // team/seat identifiers. The readable provenance remains on agentRef.
  return `agent:${createHash('sha256').update(`${teamId}\0${seatId}`).digest('hex').slice(0, 40)}`
}

export function nativeAgentBindingId(principalId: string): string {
  return `binding:${principalId}`
}

/** Actual Captain/Crew memory tools map to memory actions; all others are tool.use. */
export function nativeToolAction(toolName: string): {
  action: EnterpriseAction
  kind: EnterpriseResourceKind
  resourceId: string
} {
  if (toolName === 'remember') return { action: 'memory.write', kind: 'memory', resourceId: 'captain' }
  if (toolName === 'recall_memory') return { action: 'memory.read', kind: 'memory', resourceId: 'captain' }
  return { action: 'tool.use', kind: 'tool', resourceId: toolName }
}

/** A namespace-scoped rule covers resources in that namespace; other kinds match exactly or by omitted id. */
export function enterpriseResourceMatches(rule: EnterpriseResource, actual: EnterpriseResource): boolean {
  if (rule.namespaceId !== actual.namespaceId) return false
  if (rule.kind === 'namespace') return rule.id === undefined || rule.id === actual.namespaceId
  if (rule.kind !== actual.kind) return false
  return rule.id === undefined || rule.id === actual.id
}

function restrictionMatches(
  restriction: EnterpriseRestriction,
  principalId: string,
  action: EnterpriseAction,
  resource: EnterpriseResource
): boolean {
  return (
    restriction.lifecycle === 'active' &&
    restriction.namespaceId === resource.namespaceId &&
    (restriction.principalId === null || restriction.principalId === principalId) &&
    restriction.actions.includes(action) &&
    enterpriseResourceMatches(restriction.resource, resource)
  )
}

function bindingMatches(
  binding: EnterpriseAccessBinding,
  state: EnterpriseControlState,
  principalId: string,
  action: EnterpriseAction,
  resource: EnterpriseResource
): boolean {
  if (
    binding.lifecycle !== 'active' ||
    binding.namespaceId !== resource.namespaceId ||
    binding.principalId !== principalId ||
    !enterpriseResourceMatches(binding.resource, resource)
  ) {
    return false
  }
  const role = state.roles.find((candidate) => candidate.id === binding.roleId)
  return Boolean(
    role &&
      role.lifecycle === 'active' &&
      role.namespaceId === resource.namespaceId &&
      role.actions.includes(action) &&
      role.resourceKinds.includes(resource.kind)
  )
}

export function authorizeEnterprise(
  state: EnterpriseControlState,
  request: EnterpriseAuthorization,
  now = Date.now()
): EnterpriseDecision {
  const base = {
    ...request,
    revision: state.revision,
    evaluatedAt: new Date(now).toISOString()
  }
  const principal = state.principals.find((candidate) => candidate.id === request.principalId)
  if (!principal) {
    return { ...base, allowed: false, reason: 'Default deny: principal does not exist.', grantedBy: [], deniedBy: [] }
  }
  if (principal.lifecycle !== 'active') {
    return {
      ...base,
      allowed: false,
      reason: `Default deny: principal is ${principal.lifecycle}.`,
      grantedBy: [],
      deniedBy: []
    }
  }
  const namespace = state.namespaces.find((candidate) => candidate.id === request.resource.namespaceId)
  if (!namespace || namespace.lifecycle !== 'active') {
    return {
      ...base,
      allowed: false,
      reason: `Default deny: resource namespace is ${namespace?.lifecycle ?? 'missing'}.`,
      grantedBy: [],
      deniedBy: []
    }
  }

  const deniedBy = state.restrictions
    .filter((restriction) => restrictionMatches(restriction, request.principalId, request.action, request.resource))
    .map((restriction) => restriction.id)
  const grantedBy = state.bindings
    .filter((binding) => bindingMatches(binding, state, request.principalId, request.action, request.resource))
    .map((binding) => binding.id)

  if (deniedBy.length > 0) {
    return {
      ...base,
      allowed: false,
      reason: `Denied by Restriction${deniedBy.length > 1 ? 's' : ''} ${deniedBy.join(', ')}; deny rules override grants.`,
      grantedBy,
      deniedBy
    }
  }
  if (grantedBy.length === 0) {
    return {
      ...base,
      allowed: false,
      reason: 'Default deny: no active AccessBinding and Role grant this exact action and resource scope.',
      grantedBy,
      deniedBy
    }
  }
  return {
    ...base,
    allowed: true,
    reason: `Allowed by ${grantedBy.join(', ')}; no matching Restriction.`,
    grantedBy,
    deniedBy
  }
}
