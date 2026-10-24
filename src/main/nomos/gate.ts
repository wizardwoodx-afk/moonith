/**
 * The Nomos gate — the ONE place an action is judged.
 *
 * `govern()` is called by every effectful path in the app: the Captain loop,
 * Crew sub-agents, durable mission steps, MCP tools, connectors and computer
 * use. It resolves the acting agent's identity, evaluates policy against it,
 * consults the kill switch first of all, records the decision, and returns
 * allow / steer / deny. Nothing else in the codebase may decide whether an
 * action may run.
 *
 * The gate is synchronous by design: a decision must not depend on I/O.
 * `govern()` is fire-and-forget and is NOT durable evidence; every effectful
 * caller must use `governAwait()`, which resolves only after the decision
 * record is on disk and REFUSES the action (deny) when that write fails.
 */
import { IdentityRegistry } from './identity'
import { TrustEngine } from './trust'
import { KillSwitch, type KillSwitchState } from './kill'
import { DEFAULT_RULES, capabilityForTool, evaluatePolicy, type PolicyRule } from './policy'
import type {
  ActionIds,
  Capability,
  GovernanceDecision,
  GovernanceJournalSink,
  GovernanceRecord,
  GovernanceRequest
} from './types'

/** How many decision records the in-memory ring keeps for the UI. */
const RECORD_RING = 500

export interface GovernOptions {
  /** Extra rules, evaluated before the defaults (trusted startup only). */
  rules?: readonly PolicyRule[]
  /** Mint the actionId when the caller did not. */
  now?: () => string
}

export class GovernanceGate {
  readonly identities: IdentityRegistry
  readonly trust: TrustEngine
  readonly kill: KillSwitch

  private records: GovernanceRecord[] = []
  private journal: GovernanceJournalSink | null
  private now: () => string
  private extraRules: readonly PolicyRule[]

  constructor(deps: {
    identities?: IdentityRegistry
    trust?: TrustEngine
    kill?: KillSwitch
    journal?: GovernanceJournalSink | null
    now?: () => string
    rules?: readonly PolicyRule[]
  } = {}) {
    this.identities = deps.identities ?? new IdentityRegistry()
    this.trust = deps.trust ?? new TrustEngine()
    this.kill = deps.kill ?? new KillSwitch()
    this.journal = deps.journal ?? null
    this.now = deps.now ?? (() => new Date().toISOString())
    this.extraRules = deps.rules ?? []
  }

  /** Judge one proposed action. Records the decision in memory and starts the
   *  journal write, but does NOT wait for it. Fire-and-forget: a caller that
   *  is about to touch the world must use `governAwait()` instead. */
  govern(request: GovernanceRequest): GovernanceDecision {
    const { decision } = this.judge(request)
    void Promise.resolve(this.journal?.append(decision.record)).catch(() => {
      /* Not durable by contract; governAwait() is the durable door. */
    })
    return decision.public
  }

  /** Judge and wait for the decision record to be durably appended. The
   *  runtime uses this so an executed action always has its decision on disk
   *  BEFORE the side effect happens — and FAILS CLOSED: when the record
   *  cannot be persisted, the returned decision is a deny, so no effectful
   *  caller can proceed past a broken journal. */
  async governAwait(request: GovernanceRequest): Promise<GovernanceDecision> {
    const { decision } = this.judge(request)
    try {
      await this.journal?.append(decision.record)
    } catch (error) {
      return this.refuseUnrecorded(decision, error)
    }
    return decision.public
  }

  /** Turn a decision whose record could not be written into a denial. The
   *  provisional in-memory record is corrected too (it was never durable, so
   *  correcting it is not rewriting evidence) — the UI and the trust signal
   *  must agree with what the caller was told. */
  private refuseUnrecorded(
    decision: { public: GovernanceDecision; record: GovernanceRecord },
    error: unknown
  ): GovernanceDecision {
    const detail = error instanceof Error ? error.message : String(error)
    const reason = `the governance decision for "${decision.record.tool}" could not be written to the journal (${detail}) — the action is refused, not run unrecorded`
    decision.record.decision = 'deny'
    decision.record.rule = 'nomos-journal-unavailable'
    decision.record.reason = reason
    decision.record.outcome = 'denied'
    return {
      decision: 'deny',
      rule: 'nomos-journal-unavailable',
      reason,
      actionId: decision.record.actionId,
      ts: decision.record.ts,
      trust: decision.record.trust,
      capability: decision.record.capability
    }
  }

  /** Annotate the decision with WHO approved a steered action, and when. */
  recordApproval(actionId: string, by: string): void {
    const record = this.records.find((entry) => entry.actionId === actionId)
    if (!record) return
    record.approvedBy = by
    record.approvedAt = this.now()
    void Promise.resolve(
      this.journal?.annotate?.(actionId, { approvedBy: by, approvedAt: record.approvedAt })
    ).catch(() => {
      /* Annotations are corrections to a record that is already durable; a
       * failed annotation degrades the trail, it does not reopen the action. */
    })
  }

  /** Annotate the decision with the measured outcome; feeds the trust engine.
   *  'denied' is recorded when the action never ran because it was refused. */
  recordOutcome(actionId: string, outcome: 'success' | 'failure' | 'denied' | 'unknown'): void {
    const record = this.records.find((entry) => entry.actionId === actionId)
    if (record) {
      record.outcome = outcome
      void Promise.resolve(this.journal?.annotate?.(actionId, { outcome })).catch(() => {
        /* see recordApproval */
      })
    }
    /* Only a resolvable agent moves the trust signal. An evicted record (or
     * an id-less one) must not create a phantom '' entry that would follow
     * every unknown action around forever. */
    const agentId = record?.agentId
    if (!agentId) return
    if (outcome === 'success') this.trust.recordSuccess(agentId)
    else if (outcome === 'failure' || outcome === 'denied') this.trust.recordFailure(agentId)
  }

  /* ── kill switch ─────────────────────────────────────────────────────── */

  engageKill(reason: string, by = 'local-user'): KillSwitchState {
    return this.kill.engage(reason, by)
  }

  releaseKill(by = 'local-user'): KillSwitchState {
    return this.kill.release(by)
  }

  killState(): KillSwitchState {
    return this.kill.getState()
  }

  /* ── records ─────────────────────────────────────────────────────────── */

  /** The most recent decisions, newest last. */
  recent(limit = 50): GovernanceRecord[] {
    return this.records.slice(-limit)
  }

  /** This session's decision counts. Honest by construction: it counts what
   *  this process decided, not what some log claims. */
  summary(): {
    allow: number
    steer: number
    deny: number
    approved: number
    outcomes: { success: number; failure: number; denied: number; unknown: number }
    killEngaged: boolean
    agents: number
  } {
    let allow = 0
    let steer = 0
    let deny = 0
    let approved = 0
    const outcomes = { success: 0, failure: 0, denied: 0, unknown: 0 }
    for (const record of this.records) {
      if (record.decision === 'allow') allow += 1
      else if (record.decision === 'steer') steer += 1
      else deny += 1
      if (record.approvedBy) approved += 1
      if (record.outcome) outcomes[record.outcome] += 1
    }
    return {
      allow,
      steer,
      deny,
      approved,
      outcomes,
      killEngaged: this.kill.engaged,
      agents: this.identities.activeAgents().length
    }
  }

  /** Test/probe helper: forget this session's records. */
  resetRecords(): void {
    this.records = []
  }

  private judge(request: GovernanceRequest): {
    decision: { public: GovernanceDecision; record: GovernanceRecord }
  } {
    const identity = this.identities.getAgent(request.ids.agentId) ?? null
    const trustView = this.trust.view(request.ids.agentId)
    const capability: Capability =
      request.capability ?? capabilityForTool(request.tool, request.sideEffect)

    /* The kill switch is checked here, before policy, so its reason is exact
     * even if the policy rule set is ever replaced. The policy engine also
     * carries a kill rule: two doors, one answer. */
    if (this.kill.engaged) {
      const state = this.kill.getState()
      return {
        decision: this.finalize(request, {
          decision: 'deny',
          rule: 'nomos-kill-switch',
          reason: `the emergency kill switch is engaged${state.reason ? ` (${state.reason})` : ''} — every action is refused until it is released`,
          trust: trustView.score,
          capability
        })
      }
    }

    const verdict = evaluatePolicy(
      { request, context: { identity, trust: trustView, killEngaged: false } },
      [...this.extraRules, ...defaultRuleSet()]
    )
    return { decision: this.finalize(request, { ...verdict, trust: trustView.score, capability }) }
  }

  /** Record the decision in the ring, adjust trust, and return both the
   *  public decision and the record. Appending to the journal is the
   *  caller's choice (fire-and-forget in govern(), awaited in governAwait()). */
  private finalize(
    request: GovernanceRequest,
    verdict: { decision: GovernanceDecision['decision']; rule: string; reason: string; trust: number; capability: Capability }
  ): { public: GovernanceDecision; record: GovernanceRecord } {
    const ts = this.now()
    const record: GovernanceRecord = {
      actionId: request.ids.actionId,
      ts,
      decision: verdict.decision,
      rule: verdict.rule,
      reason: verdict.reason,
      detail: request.detail ?? '',
      tool: request.tool,
      agentId: request.ids.agentId,
      principalId: request.ids.principalId,
      trust: verdict.trust,
      capability: verdict.capability,
      missionId: request.missionId ?? null,
      approvedBy: null,
      approvedAt: null,
      outcome: verdict.decision === 'deny' ? 'denied' : null
    }
    this.records.push(record)
    if (this.records.length > RECORD_RING) {
      this.records.splice(0, this.records.length - RECORD_RING)
    }
    if (verdict.decision === 'deny') {
      /* The agent attempted something it should not: that is a measured
       * fact about the agent, and it moves the trust signal down. */
      this.trust.recordDenial(request.ids.agentId)
    }
    return {
      record,
      public: {
        decision: verdict.decision,
        rule: verdict.rule,
        reason: verdict.reason,
        actionId: request.ids.actionId,
        ts,
        trust: verdict.trust,
        capability: verdict.capability
      }
    }
  }
}

/* Kept as a function so a probe can swap the rule set without mutating the
 * exported constant. */
function defaultRuleSet(): PolicyRule[] {
  return [...DEFAULT_RULES]
}

export type { ActionIds }
