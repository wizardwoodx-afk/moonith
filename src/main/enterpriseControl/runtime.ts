import { join } from 'node:path'
import { DEFAULT_NAMESPACE_ID, LOCAL_OWNER_PRINCIPAL_ID, type EnterpriseAction, type EnterpriseAuthorization, type EnterpriseDecision, type EnterpriseResourceKind } from '../../shared/enterpriseControl'
import { runtimeAudit } from '../audit/runtime'
import { getDefaultAuditKey } from '../audit/keyProvider'
import { getPaths } from '../paths'
import { EnterpriseControlService } from './service'
import { nativeAgentPrincipalId, nativeToolAction } from './policy'

let instance: EnterpriseControlService | undefined

/** Lazy native singleton; no listener, sidecar, CLI, or external control service. */
export function enterpriseControl(): EnterpriseControlService {
  if (!instance) {
    instance = new EnterpriseControlService({
      file: join(getPaths().root, 'enterprise', 'control-plane.json'),
      loadKey: getDefaultAuditKey,
      audit: (event) =>
        runtimeAudit.record({
          actor: 'system',
          actorId: 'enterprise-control-plane',
          ...event
        })
    })
  }
  return instance
}

export interface EnterpriseMissionPrincipal {
  id: string
  name: string
}

/**
 * Native mission admission. Every seat receives its own identity once, then
 * both the human run grant and each agent's exact mission/agent grants are
 * checked. A revoked binding, disabled identity, or matching Restriction stops
 * the mission before executeTeam creates worktrees or invokes a provider.
 */
export async function authorizeMissionTeam(args: {
  missionId: string
  teamId: string
  seats: EnterpriseMissionPrincipal[]
}): Promise<EnterpriseDecision[]> {
  const control = enterpriseControl()
  const decisions: EnterpriseDecision[] = []
  const refuse = (): never => {
    const denied = decisions.filter((decision) => !decision.allowed)
    throw new Error(
      `Enterprise Control Plane refused mission ${args.missionId}: ${denied
        .slice(0, 4)
        .map((decision) => `${decision.principalId} ${decision.action} — ${decision.reason}`)
        .join('; ')}`
    )
  }
  // A denied human run does not enroll new agent identities as a side effect.
  decisions.push(await control.authorize({
    principalId: LOCAL_OWNER_PRINCIPAL_ID,
    action: 'mission.run',
    resource: { kind: 'mission', namespaceId: DEFAULT_NAMESPACE_ID, id: args.missionId }
  }))
  if (decisions[0]?.allowed !== true) refuse()
  for (const seat of args.seats) {
    await control.ensureAgentPrincipal(args.teamId, seat.id, seat.name)
  }
  const requests: EnterpriseAuthorization[] = []
  for (const seat of args.seats) {
    const principalId = nativeAgentPrincipalId(args.teamId, seat.id)
    requests.push(
      {
        principalId,
        action: 'mission.run' as const,
        resource: { kind: 'mission' as const, namespaceId: DEFAULT_NAMESPACE_ID, id: args.missionId }
      },
      {
        principalId,
        action: 'agent.invoke' as const,
        resource: { kind: 'agent' as const, namespaceId: DEFAULT_NAMESPACE_ID, id: seat.id }
      }
    )
  }
  for (const request of requests) decisions.push(await control.authorize(request))
  if (decisions.some((decision) => !decision.allowed)) refuse()
  return decisions
}


/**
 * Additional action-time boundary for Captain and Crew. Existing task-role
 * RBAC still runs first; this native grant/restriction check must also pass.
 */
export async function authorizeNativeTaskTool(args: {
  taskId: string
  actor: 'captain' | 'crew'
  agentName?: string
  toolName: string
}): Promise<EnterpriseDecision> {
  const control = enterpriseControl()
  const teamId = args.actor === 'captain' ? 'captain' : 'crew'
  const seatId = args.actor === 'captain' ? args.taskId : `${args.taskId}:${args.agentName ?? 'worker'}`
  const name = args.actor === 'captain' ? `Captain · ${args.taskId}` : `Crew · ${args.agentName ?? 'worker'}`
  const principalId = await control.ensureAgentPrincipal(teamId, seatId, name)
  const mapped = nativeToolAction(args.toolName)
  return control.authorize({
    principalId,
    action: mapped.action,
    resource: { kind: mapped.kind, namespaceId: DEFAULT_NAMESPACE_ID, id: mapped.resourceId }
  })
}

/** Enforce a local human memory or approval operation through the same policy. */
export async function requireLocalEnterprise(
  action: EnterpriseAction,
  kind: EnterpriseResourceKind,
  resourceId: string
): Promise<void> {
  const decision = await enterpriseControl().authorize({
    principalId: LOCAL_OWNER_PRINCIPAL_ID,
    action,
    resource: { kind, namespaceId: DEFAULT_NAMESPACE_ID, id: resourceId }
  })
  if (!decision.allowed) throw new Error(`Enterprise Control Plane refused ${action}: ${decision.reason}`)
}
