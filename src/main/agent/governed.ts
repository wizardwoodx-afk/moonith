/**
 * The governed execution path — Nomos and Sphragis wired into the runtime.
 *
 * Every tool call the Captain or a Crew sub-agent makes crosses the gate
 * BEFORE it touches the world, and every high-impact one is bracketed by a
 * signed receipt pair. This module is the seam between the agent runtime
 * (src/main/agent/) and the two layers underneath it:
 *
 *   Nomos    — decides: identity, capability, kill switch, risk, approval.
 *              Fail-closed: an unknown agent, a missing capability or a
 *              broken policy engine denies, never allows.
 *   Sphragis — attests: a signed intent BEFORE the effect, a signed result
 *              AFTER it, digests only — raw content never enters a receipt.
 *
 * Production resolves the two singletons lazily (nomosGate() /
 * receiptService()), which only works inside a running Electron app; tests
 * inject their own gate and receipt service through `deps`, so importing
 * this module never touches the filesystem, Electron or the keychain.
 */
import { newId, truncate } from '../util'
import {
  CAPTAIN_AGENT_ID,
  LOCAL_PRINCIPAL_ID,
  capabilityForTool,
  crewAgentId,
  nomosGate,
  type ActionIds,
  type Capability,
  type GovernanceDecision,
  type GovernanceGate
} from '../nomos'
import {
  digestOfValue,
  receiptService,
  requiresReceipt,
  type ReceiptService
} from '../sphragis'
import type { GovernedAction, GovernedResult } from '@shared/enterprise'
import type { PermissionMode } from '@shared/types'
import type { AgentTool, ToolContext } from './tools/types'

export interface GovernedDeps {
  gate?: GovernanceGate
  receipts?: ReceiptService
}

/** Production resolution (the lazy singletons), or the injected deps a test
 *  provides. Never called at module load — only inside a running app. */
export function resolveGovernance(deps?: GovernedDeps): {
  gate: GovernanceGate
  receipts: ReceiptService
} {
  return {
    gate: deps?.gate ?? nomosGate(),
    receipts: deps?.receipts ?? receiptService()
  }
}

/** Mint the ids for a Captain action: the Captain acts for the local owner,
 *  and every attempt gets a fresh actionId so decisions, approvals, receipts
 *  and outcomes can always be joined. */
export function captainActionIds(taskId: string, runId: string): ActionIds {
  return {
    runId,
    taskId,
    actionId: newId('act'),
    agentId: CAPTAIN_AGENT_ID,
    principalId: LOCAL_PRINCIPAL_ID
  }
}

/** Govern one tool call and return the decision. The decision is recorded,
 *  and the journal append is awaited, so an executed action always has its
 *  decision on disk BEFORE the side effect happens. */
export function governToolCall(
  input: {
    ids: ActionIds
    tool: string
    args: Record<string, unknown>
    sideEffect: GovernedAction['sideEffect']
    risk: GovernedAction['risk']
    approval: GovernedAction['approval']
    /** What this call does, in words — lands in the governance record. */
    detail?: string
    permissionMode?: PermissionMode
    missionId?: string
  },
  deps?: GovernedDeps
): Promise<GovernanceDecision> {
  const { gate } = resolveGovernance(deps)
  return gate.governAwait({
    ids: input.ids,
    tool: input.tool,
    args: input.args,
    sideEffect: input.sideEffect,
    risk: input.risk,
    approval: input.approval,
    detail: input.detail,
    permissionMode: input.permissionMode,
    missionId: input.missionId
  })
}

/**
 * The governed execution of one effect, shared by every caller.
 *
 *   govern -> (steer is settled by `onSteer`: the human either approved or
 *   did not) -> intent receipt -> execute exactly once -> result receipt ->
 *   outcome.
 *
 * The P0 guarantee lives in the two early returns: a denied action — and a
 * steered action nobody approved — NEVER reaches `effect`. Zero side effects,
 * not best-effort. There is exactly one implementation of that sequence, so
 * the agent runtime and the durable mission runner cannot drift apart on the
 * one property that matters most.
 */
async function runGovernedEffect(core: {
  ids: ActionIds
  /** The action's identity for the gate: name, effect kind, risk, contract. */
  tool: { name: string; sideEffect: GovernedAction['sideEffect']; risk: GovernedAction['risk']; approval: GovernedAction['approval'] }
  /** What this call does, in words — lands in the governance record. */
  detail: string
  /** The raw arguments; only their digest is ever kept. */
  args: Record<string, unknown>
  /** The effect. Runs ONLY when the gate allows. */
  effect: () => Promise<{ content: string; isError?: boolean }>
  permissionMode?: PermissionMode
  missionId?: string
  /** Called when the gate steers. Resolve true = approved, false = denied. */
  onSteer?: (decision: GovernanceDecision) => Promise<boolean>
  deps?: GovernedDeps
}): Promise<{
  content: string
  isError: boolean
  decision: 'allow' | 'steer' | 'deny'
  rule: string
  actionId: string
  executed: boolean
}> {
  const { gate, receipts } = resolveGovernance(core.deps)
  /* The decision must be DURABLE before anything else happens. `governAwait`
   * already turns a failed journal write into a deny; the try/catch is the
   * second belt: if the gate itself throws (an injected sink that rejects,
   * a broken gate), the effect is still refused rather than reached. */
  let decision: GovernanceDecision
  try {
    decision = await governToolCall(
      {
        ids: core.ids,
        tool: core.tool.name,
        args: core.args,
        sideEffect: core.tool.sideEffect,
        risk: core.tool.risk,
        approval: core.tool.approval,
        detail: core.detail,
        permissionMode: core.permissionMode,
        missionId: core.missionId
      },
      { gate, receipts }
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      content: `Blocked by the governance gate (governance-journal-unavailable): the decision for "${core.tool.name}" could not be persisted (${detail}) — the action was refused, not run unrecorded`,
      isError: true,
      decision: 'deny' as const,
      rule: 'governance-journal-unavailable',
      actionId: core.ids.actionId,
      executed: false
    }
  }

  /* Denied — and a steer nobody approved — are the same shape to the
   * caller: the effect never ran. `executed: false` is the honest flag; the
   * `decision` field keeps the gate's verdict for the audit trail. */
  const blocked = {
    content: `Blocked by the governance gate (${decision.rule}): ${decision.reason}`,
    isError: true,
    rule: decision.rule,
    actionId: decision.actionId,
    executed: false
  }
  if (decision.decision === 'deny') {
    return { ...blocked, decision: 'deny' as const }
  }

  let approvedBy: string | null = null
  let approvedAt: string | null = null
  if (decision.decision === 'steer') {
    const approved = core.onSteer ? await core.onSteer(decision) : false
    if (!approved) {
      return { ...blocked, decision: 'steer' as const }
    }
    approvedBy = 'human'
    approvedAt = new Date().toISOString()
    gate.recordApproval(decision.actionId, approvedBy)
  }

  /* The receipt barrier: a high-impact action (it executes something, or it
   * is high-risk) mints its intent BEFORE the effect. Low-risk reads are
   * journalled by the governance record alone — a receipt for every read
   * would be noise, and noise is how audit trails get ignored. */
  const needsReceipt = requiresReceipt({ sideEffect: core.tool.sideEffect, risk: core.tool.risk })
  if (needsReceipt) {
    await receipts.recordIntent({
      ids: core.ids,
      tool: core.tool.name,
      action: decision.capability,
      args: core.args,
      authorization: {
        decision: decision.decision,
        rule: decision.rule,
        reason: decision.reason,
        approvedBy,
        approvedAt
      }
    })
  }

  /* Execute exactly once. A throwing effect is a failed action, not a failed
   * run: the outcome is recorded, a failure receipt is minted, and the error
   * is handed back as content — never rethrown. */
  let result: { content: string; isError: boolean }
  try {
    const outcome = await core.effect()
    result = { content: outcome.content, isError: Boolean(outcome.isError) }
  } catch (error) {
    result = {
      content: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
      isError: true
    }
  }

  if (needsReceipt) {
    await receipts.recordResult(decision.actionId, result.isError ? 'failure' : 'success', {
      digest: digestOfValue({ content: truncate(result.content, 30_000) })
    })
  }
  gate.recordOutcome(decision.actionId, result.isError ? 'failure' : 'success')

  return {
    content: result.content,
    isError: result.isError,
    decision: decision.decision,
    rule: decision.rule,
    actionId: decision.actionId,
    executed: true
  }
}

/** The full governed execution of an AgentTool. */
export async function executeGovernedTool(input: {
  tool: AgentTool
  /** Schema-validated arguments, as the tool expects them. */
  args: unknown
  /** The raw arguments, as the model sent them; only their digest is kept. */
  rawArgs: Record<string, unknown>
  ctx: ToolContext
  ids: ActionIds
  permissionMode?: PermissionMode
  missionId?: string
  /** Called when the gate steers. Resolve true = approved, false = denied. */
  onSteer?: (decision: GovernanceDecision) => Promise<boolean>
  deps?: GovernedDeps
}): Promise<{
  content: string
  isError: boolean
  decision: 'allow' | 'steer' | 'deny'
  rule: string
  actionId: string
  executed: boolean
}> {
  return runGovernedEffect({
    ids: input.ids,
    tool: {
      name: input.tool.name,
      sideEffect: input.tool.sideEffect,
      risk: input.tool.risk,
      approval: input.tool.approval
    },
    detail: input.tool.title,
    args: input.rawArgs,
    effect: () => input.tool.execute(input.args, input.ctx),
    permissionMode: input.permissionMode,
    missionId: input.missionId,
    onSteer: input.onSteer,
    deps: input.deps
  })
}

/**
 * Run a plain `GovernedAction` through the gate and the receipt chain.
 *
 * This is the door the durable mission runner uses: a mission step hands over
 * an action describing its effect, and gets back a result saying whether the
 * gate allowed it, what ran, and under which rule. A mission has no
 * interactive approval surface, so the default `onSteer` refuses — a step
 * that needs a human must park at an approval step in the workflow, where the
 * wait is durable and visible, rather than silently proceeding.
 */
export async function runGovernedAction(
  action: GovernedAction,
  options: {
    ids: ActionIds
    permissionMode?: PermissionMode
    missionId?: string
    onSteer?: (decision: GovernanceDecision) => Promise<boolean>
    deps?: GovernedDeps
  }
): Promise<GovernedResult> {
  const result = await runGovernedEffect({
    ids: options.ids,
    tool: {
      name: action.tool,
      sideEffect: action.sideEffect,
      risk: action.risk,
      approval: action.approval
    },
    detail: action.detail,
    args: action.args,
    effect: action.effect,
    permissionMode: options.permissionMode,
    missionId: options.missionId,
    onSteer: options.onSteer,
    deps: options.deps
  })
  return {
    content: result.content,
    isError: result.isError,
    decision: result.decision,
    rule: result.rule,
    executed: result.executed,
    actionId: result.actionId
  }
}

/**
 * Delegate a Crew seat. The seat's authority is exactly the set of
 * capabilities the granted tools require, narrowed from the Captain's full
 * scope set: a sub-agent can never be wider than the tools it was handed,
 * and the narrowing is enforced at delegation time, not hoped for
 * afterwards. Re-registering a name re-delegates the seat, which is how a
 * per-task tool set stays the seat's ceiling.
 */
export function registerCrewSeat(
  name: string,
  tools: readonly AgentTool[],
  deps?: GovernedDeps
): { ok: true; agentId: string } | { ok: false; reason: string } {
  const { gate } = resolveGovernance(deps)
  const requested = new Set<Capability>()
  for (const tool of tools) requested.add(capabilityForTool(tool.name, tool.sideEffect))
  const delegated = gate.identities.delegateAgent(CAPTAIN_AGENT_ID, {
    agentId: crewAgentId(name),
    displayName: name,
    requested: [...requested]
  })
  if (!delegated.ok) return { ok: false, reason: delegated.reason }
  return { ok: true, agentId: delegated.agent.agentId }
}
