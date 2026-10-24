/**
 * Nomos identity — principals, agents, scoped capabilities and delegation.
 *
 * A PRINCIPAL is who the work is for: the local user, or an organisation an
 * enterprise deployment acts on behalf of. An AGENT is who acts: the Captain,
 * a Crew seat, a mission runner. An agent never acts on its own authority —
 * it acts under a principal, holding a scoped set of capabilities.
 *
 * DELEGATION IS SUBSET-ONLY. When the Captain hands work to a Crew seat, the
 * seat's scopes must be a subset of the Captain's. A delegated agent can be
 * narrower than its parent, never wider; requesting a capability the parent
 * does not hold is refused, not silently dropped. Revocation is immediate and
 * total: a revoked agent is denied at the gate even mid-run.
 */
import {
  ALL_CAPABILITIES,
  isCapability,
  type Capability
} from './types'

export type PrincipalKind = 'user' | 'organization'

export interface Principal {
  id: string
  kind: PrincipalKind
  displayName: string
  createdAt: string
}

export type AgentStatus = 'active' | 'revoked'

export interface AgentIdentity {
  agentId: string
  principalId: string
  displayName: string
  /** The capabilities this agent currently holds. Never wider than `granted`. */
  scopes: Capability[]
  /** The delegation ceiling: the widest set this agent may ever hold. Equal
   *  to `scopes` for a top-level agent; a narrowing of the parent's scopes
   *  for a delegated seat. Updates may vary within this ceiling, never past it. */
  granted: Capability[]
  /** The agent that delegated to this one, or null for top-level agents. */
  delegatedFrom: string | null
  status: AgentStatus
  createdAt: string
  revokedAt?: string | null
  revokedReason?: string | null
}

export type ScopeNarrowing =
  | { ok: true; scopes: Capability[] }
  | { ok: false; reason: string }

/** Narrow a parent's scopes to a requested set. The result is a subset of the
 *  parent's scopes; anything the parent lacks is refused, never invented. */
export function narrowScopes(parent: readonly Capability[], requested: readonly Capability[]): ScopeNarrowing {
  const parentSet = new Set(parent)
  const granted: Capability[] = []
  for (const capability of requested) {
    if (!isCapability(capability)) {
      return { ok: false, reason: `unknown capability "${String(capability)}" — only declared capabilities can be granted` }
    }
    if (!parentSet.has(capability)) {
      return { ok: false, reason: `the delegating agent does not hold "${capability}" — a delegated agent can never be wider than its parent` }
    }
    if (!granted.includes(capability)) granted.push(capability)
  }
  return { ok: true, scopes: granted }
}

/** The capabilities a set of tools requires, per the tool→capability table
 *  the gate uses. Imported lazily by the caller to keep this module pure. */
export function capabilitiesForTools(
  tools: readonly { name: string }[],
  capabilityOf: (toolName: string) => Capability
): Capability[] {
  const out = new Set<Capability>()
  for (const tool of tools) out.add(capabilityOf(tool.name))
  return [...out]
}

export class IdentityRegistry {
  private principals = new Map<string, Principal>()
  private agents = new Map<string, AgentIdentity>()

  registerPrincipal(principal: Principal): Principal {
    if (this.principals.has(principal.id)) {
      throw new Error(`principal "${principal.id}" is already registered`)
    }
    this.principals.set(principal.id, principal)
    return principal
  }

  getPrincipal(principalId: string): Principal | undefined {
    return this.principals.get(principalId)
  }

  /** Register a top-level agent (no delegation). Its scope set is its own
   *  ceiling: the app's top-level authority, set at bootstrap. */
  registerAgent(agent: Omit<AgentIdentity, 'delegatedFrom' | 'status' | 'createdAt' | 'granted'> & {
    delegatedFrom?: string | null
    createdAt?: string
  }): AgentIdentity {
    return this.putAgent({
      ...agent,
      granted: [...agent.scopes],
      delegatedFrom: agent.delegatedFrom ?? null,
      status: 'active',
      createdAt: agent.createdAt ?? new Date().toISOString()
    })
  }

  /** Delegate: register an agent whose scopes are a narrowing of the
   *  parent's. Refuses when the parent is unknown, revoked, or does not hold
   *  everything requested. The narrowing becomes the seat's ceiling. */
  delegateAgent(
    parentAgentId: string,
    child: { agentId: string; displayName: string; requested: Capability[] }
  ): { ok: true; agent: AgentIdentity } | { ok: false; reason: string } {
    const parent = this.agents.get(parentAgentId)
    if (!parent) return { ok: false, reason: `the delegating agent "${parentAgentId}" is not registered` }
    if (parent.status !== 'active') {
      return { ok: false, reason: `the delegating agent "${parentAgentId}" is ${parent.status} — it cannot delegate` }
    }
    const narrowed = narrowScopes(parent.scopes, child.requested)
    if (!narrowed.ok) return { ok: false, reason: narrowed.reason }
    /* Re-delegation of the SAME seat id replaces its identity outright: the
     * new scopes are exactly the new narrowing, never a merge with the old
     * set, so a seat cannot accumulate authority across task changes. */
    const agent = this.putAgent({
      agentId: child.agentId,
      principalId: parent.principalId,
      displayName: child.displayName,
      scopes: narrowed.scopes,
      granted: narrowed.scopes,
      delegatedFrom: parentAgentId,
      status: 'active',
      createdAt: this.agents.get(child.agentId)?.createdAt ?? new Date().toISOString()
    })
    return { ok: true, agent }
  }

  /** Re-delegation: refresh a seat's scopes (a Crew seat's tool set changes
   *  per task). The new set must fit inside the ORIGINAL delegation ceiling:
   *  a seat may vary within its grant, but a seat that was granted read-only
   *  can never widen itself toward the parent's full scope set. */
  updateScopes(agentId: string, requested: Capability[]): { ok: true; agent: AgentIdentity } | { ok: false; reason: string } {
    const agent = this.agents.get(agentId)
    if (!agent) return { ok: false, reason: `agent "${agentId}" is not registered` }
    const narrowed = narrowScopes(agent.granted, requested)
    if (!narrowed.ok) return { ok: false, reason: narrowed.reason }
    const updated: AgentIdentity = { ...agent, scopes: narrowed.scopes }
    this.agents.set(agentId, updated)
    return { ok: true, agent: updated }
  }

  getAgent(agentId: string): AgentIdentity | undefined {
    return this.agents.get(agentId)
  }

  /** An agent is usable only while active, under a known principal, with the
   *  capability in its (possibly narrowed) scope set. */
  hasCapability(agentId: string, capability: Capability): boolean {
    const agent = this.agents.get(agentId)
    if (!agent || agent.status !== 'active') return false
    if (!this.principals.has(agent.principalId)) return false
    return agent.scopes.includes(capability)
  }

  /** Revoke an agent: every later gate decision for it denies, mid-run
   *  included. Idempotent, and it does not touch other agents — revocation is
   *  per seat, never a blanket stop (that is the kill switch). */
  revokeAgent(agentId: string, reason: string): { ok: boolean; reason?: string } {
    const agent = this.agents.get(agentId)
    if (!agent) return { ok: false, reason: `agent "${agentId}" is not registered` }
    if (agent.status === 'revoked') return { ok: true }
    this.agents.set(agentId, {
      ...agent,
      status: 'revoked',
      revokedAt: new Date().toISOString(),
      revokedReason: reason
    })
    return { ok: true }
  }

  activeAgents(): AgentIdentity[] {
    return [...this.agents.values()].filter((agent) => agent.status === 'active')
  }

  /** Drop a seat entirely (a finished Crew run). Unlike revoke — which keeps
   *  the identity for the audit trail — the seat is gone, so the gate denies
   *  it with `nomos-identity-unknown`. The trust engine is separate; a caller
   *  that wants the score gone too calls `trust.forget(agentId)`. */
  forgetAgent(agentId: string): void {
    this.agents.delete(agentId)
  }

  private putAgent(agent: AgentIdentity): AgentIdentity {
    if (!this.principals.has(agent.principalId)) {
      throw new Error(`agent "${agent.agentId}" references unknown principal "${agent.principalId}"`)
    }
    for (const scope of agent.scopes) {
      if (!isCapability(scope)) throw new Error(`agent "${agent.agentId}" holds unknown capability "${String(scope)}"`)
    }
    if (!ALL_CAPABILITIES.every((capability) => isCapability(capability))) {
      throw new Error('capability table is corrupt')
    }
    this.agents.set(agent.agentId, agent)
    return agent
  }
}
