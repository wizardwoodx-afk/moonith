/** SelfImpulse Enterprise Control Plane — native, in-process policy contracts. */

export const ENTERPRISE_CONTROL_IPC = {
  snapshot: 'enterprise-control:snapshot',
  mutate: 'enterprise-control:mutate',
  authorize: 'enterprise-control:authorize',
  revision: 'enterprise-control:revision'
} as const

export const ENTERPRISE_ACTIONS = [
  'mission.run',
  'agent.invoke',
  'tool.use',
  'memory.read',
  'memory.write',
  'approval.decide',
  'enterprise.manage'
] as const
export type EnterpriseAction = (typeof ENTERPRISE_ACTIONS)[number]

export const ENTERPRISE_RESOURCE_KINDS = [
  'namespace',
  'mission',
  'agent',
  'tool',
  'memory',
  'approval',
  'enterprise'
] as const
export type EnterpriseResourceKind = (typeof ENTERPRISE_RESOURCE_KINDS)[number]

export type EnterpriseLifecycle = 'active' | 'disabled' | 'archived'
export type EnterprisePrincipalKind = 'human' | 'agent'

/** Omitting id scopes the rule to every resource of this kind in this namespace. */
export interface EnterpriseResource {
  kind: EnterpriseResourceKind
  namespaceId: string
  id?: string
}

interface EnterpriseEntity {
  id: string
  lifecycle: EnterpriseLifecycle
  createdAt: string
  updatedAt: string
}

export interface EnterpriseNamespace extends EnterpriseEntity {
  name: string
  description: string
}

export interface EnterprisePrincipal extends EnterpriseEntity {
  kind: EnterprisePrincipalKind
  name: string
  namespaceId: string
  /** Stable team/seat provenance for native per-agent identities. */
  agentRef?: { teamId: string; seatId: string }
}

export interface EnterpriseRole extends EnterpriseEntity {
  namespaceId: string
  name: string
  description: string
  actions: EnterpriseAction[]
  resourceKinds: EnterpriseResourceKind[]
}

export interface EnterpriseAccessBinding extends EnterpriseEntity {
  namespaceId: string
  principalId: string
  roleId: string
  resource: EnterpriseResource
}

export interface EnterpriseRestriction extends EnterpriseEntity {
  namespaceId: string
  /** Null applies the deny rule to every principal in the namespace. */
  principalId: string | null
  name: string
  actions: EnterpriseAction[]
  resource: EnterpriseResource
}

export interface EnterpriseControlState {
  format: 'selfimpulse-enterprise-control/1'
  revision: number
  defaultNamespaceId: string
  namespaces: EnterpriseNamespace[]
  principals: EnterprisePrincipal[]
  roles: EnterpriseRole[]
  bindings: EnterpriseAccessBinding[]
  restrictions: EnterpriseRestriction[]
}

export interface EnterpriseRevisionInfo {
  revision: number
  at: string
  actor: string
  reason: string
  digest: string
}

export interface EnterpriseAuthorization {
  principalId: string
  action: EnterpriseAction
  resource: EnterpriseResource
}

export interface EnterpriseDecision extends EnterpriseAuthorization {
  allowed: boolean
  reason: string
  revision: number
  evaluatedAt: string
  grantedBy: string[]
  deniedBy: string[]
}

export interface EnterpriseControlSnapshot {
  state: EnterpriseControlState
  revisions: EnterpriseRevisionInfo[]
  recentDecisions: EnterpriseDecision[]
  security: {
    execution: 'native-in-process'
    defaultPolicy: 'deny'
    denyOverrides: true
    isolation: string
  }
}

export type EnterpriseControlOperation =
  | {
      type: 'namespace.create'
      namespace: { id: string; name: string; description?: string }
    }
  | {
      type: 'role.upsert'
      role: {
        id: string
        namespaceId: string
        name: string
        description?: string
        actions: EnterpriseAction[]
        resourceKinds: EnterpriseResourceKind[]
      }
    }
  | {
      type: 'binding.upsert'
      binding: {
        id: string
        namespaceId: string
        principalId: string
        roleId: string
        resource: EnterpriseResource
      }
    }
  | {
      type: 'restriction.upsert'
      restriction: {
        id: string
        namespaceId: string
        principalId: string | null
        name: string
        actions: EnterpriseAction[]
        resource: EnterpriseResource
      }
    }
  | {
      type: 'lifecycle.set'
      kind: 'namespace' | 'principal' | 'role' | 'binding' | 'restriction'
      id: string
      lifecycle: EnterpriseLifecycle
    }
  | { type: 'revision.restore'; revision: number }

export interface EnterpriseControlMutation {
  expectedRevision: number
  reason: string
  operation: EnterpriseControlOperation
}

export const LOCAL_OWNER_PRINCIPAL_ID = 'human:local-owner'
export const DEFAULT_NAMESPACE_ID = 'default'
export const AGENT_ROLE_ID = 'role:native-agent'
export const OWNER_ROLE_ID = 'role:local-owner'

export function isEnterpriseAction(value: unknown): value is EnterpriseAction {
  return typeof value === 'string' && ENTERPRISE_ACTIONS.includes(value as EnterpriseAction)
}

export function isEnterpriseResourceKind(value: unknown): value is EnterpriseResourceKind {
  return typeof value === 'string' && ENTERPRISE_RESOURCE_KINDS.includes(value as EnterpriseResourceKind)
}
