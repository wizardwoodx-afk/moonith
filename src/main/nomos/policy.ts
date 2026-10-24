/**
 * Nomos policy — deterministic, ordered, fail-closed.
 *
 * Rules are pure functions of (request, context). The first rule that
 * returns a verdict wins; if every rule abstains the default speaks. The
 * default is ALLOW only for actions that have already passed identity and
 * capability checks and are low-risk — everything else is steered to a human
 * or denied outright.
 *
 * FAIL-CLOSED IS LOAD-BEARING. If a rule throws, or returns a verdict that
 * is not a well-formed decision, evaluation returns a DENY naming the
 * failure. A governance layer that fails open is worse than none: it grants
 * authority precisely when its own machinery is broken.
 */
import type {
  Capability,
  GovernanceDecisionKind,
  GovernanceRequest,
  PermissionMode
} from './types'
import type { AgentIdentity } from './identity'
import type { TrustView } from './trust'

/* ── the tool → capability table ─────────────────────────────────────────── */

/** What each built-in tool requires. Unknown tools (MCP servers, connectors)
 *  map to 'tool.other': only an agent explicitly holding that scope — today,
 *  the top-level Captain — may call them. */
export const CAPABILITY_BY_TOOL: Record<string, Capability> = {
  list_files: 'fs.read',
  read_file: 'fs.read',
  search_files: 'fs.read',
  write_file: 'fs.write',
  edit_file: 'fs.write',
  make_directory: 'fs.write',
  move_path: 'fs.write',
  delete_path: 'fs.delete',
  run_command: 'shell.exec',
  web_fetch: 'net.fetch',
  web_search: 'net.fetch',
  browser_open: 'browser.control',
  browser_click: 'browser.control',
  browser_type: 'browser.control',
  browser_select: 'browser.control',
  browser_press: 'browser.control',
  browser_scroll: 'browser.control',
  browser_extract: 'browser.control',
  browser_screenshot: 'browser.control',
  browser_back: 'browser.control',
  browser_wait: 'browser.control',
  browser_show: 'browser.control',
  create_document: 'document.create',
  create_spreadsheet: 'document.create',
  create_presentation: 'document.create',
  create_pdf: 'document.create',
  /* studio_commands spawns an external CLI too (to read its command
   * registry); it is not a filesystem read. Classifying it as shell.exec is
   * the truthful scope, and capabilityForTool() derives the same from its
   * 'execute' side effect. */
  studio_commands: 'shell.exec',
  studio_run: 'studio.run',
  remember: 'memory.write',
  recall_memory: 'memory.read',
  update_plan: 'tool.other',
  delegate_to_crew: 'mission.dispatch',
  read_skill: 'tool.other'
}

/** The capability an action requires. The caller may override the table. */
export function capabilityForTool(
  tool: string,
  sideEffect: GovernanceRequest['sideEffect']
): Capability {
  if (sideEffect === 'execute') return 'shell.exec'
  return CAPABILITY_BY_TOOL[tool] ?? 'tool.other'
}

/* ── the rule engine ─────────────────────────────────────────────────────── */

export interface PolicyVerdict {
  decision: GovernanceDecisionKind
  /** Machine-readable rule id — this is what lands in the audit record. */
  rule: string
  /** Human-readable reason — this is what the user reads. */
  reason: string
}

export interface PolicyContext {
  /** The resolved agent identity, or null when the agent is unknown. */
  identity: AgentIdentity | null
  trust: TrustView
  killEngaged: boolean
}

export interface PolicyEvaluation {
  request: GovernanceRequest
  context: PolicyContext
}

export type PolicyRule = (evaluation: PolicyEvaluation) => PolicyVerdict | null

function verdict(decision: GovernanceDecisionKind, rule: string, reason: string): PolicyVerdict {
  return { decision, rule, reason }
}

/** Rule 1 — the kill switch. When engaged, nothing runs, for anyone. */
export const killSwitchRule: PolicyRule = ({ context }) =>
  context.killEngaged
    ? verdict('deny', 'nomos-kill-switch', 'the emergency kill switch is engaged — every action is refused until it is released')
    : null

/** Rule 2 — identity. Unknown, revoked or principal-less agents are denied. */
export const identityRule: PolicyRule = ({ request, context }) => {
  const identity = context.identity
  if (!identity) {
    return verdict('deny', 'nomos-identity-unknown', `agent "${request.ids.agentId}" has no registered identity — it cannot act`)
  }
  if (identity.status === 'revoked') {
    return verdict(
      'deny',
      'nomos-identity-revoked',
      `agent "${identity.displayName}" was revoked${identity.revokedReason ? ` (${identity.revokedReason})` : ''} — it cannot act`
    )
  }
  return null
}

/** Rule 3 — capability scope. The action's capability must be granted. */
export const capabilityRule: PolicyRule = ({ request, context }) => {
  const identity = context.identity
  if (!identity) return null // the identity rule already denied
  const required =
    request.capability ?? capabilityForTool(request.tool, request.sideEffect)
  if (!identity.scopes.includes(required)) {
    return verdict(
      'deny',
      'nomos-capability-not-granted',
      `agent "${identity.displayName}" does not hold the "${required}" capability that "${request.tool}" requires`
    )
  }
  return null
}

/** Rule 4 — high-risk actions always reach a human. Trust never waives this. */
export const highRiskRule: PolicyRule = ({ request }) =>
  request.risk === 'high'
    ? verdict(
        'steer',
        'nomos-high-risk-requires-human',
        `"${request.tool}" is a high-risk action — it runs only with a human's approval, whatever the agent's trust score`
      )
    : null

/** Rule 5 — the tool's own always-approval contract. */
export const alwaysApprovalRule: PolicyRule = ({ request }) =>
  request.approval === 'always'
    ? verdict('steer', 'nomos-tool-requires-approval', `"${request.tool}" always requires approval before it runs`)
    : null

/** Rule 6 — policy tools ask in manual mode, or when trust is low. */
export const policyApprovalRule: PolicyRule = ({ request, context }) => {
  if (request.approval !== 'policy') return null
  const manual = request.permissionMode === 'manual'
  const lowTrust = context.trust.band === 'low'
  if (!manual && !lowTrust) return null
  const why = manual
    ? 'this task runs in manual mode'
    : `this agent's trust is low (${context.trust.score.toFixed(2)})`
  return verdict('steer', 'nomos-policy-approval', `"${request.tool}" needs approval — ${why}`)
}

/** The ordered rule set. Order is part of the policy: the kill switch and
 *  identity speak before anything else, and high-risk outranks trust. */
export const DEFAULT_RULES: readonly PolicyRule[] = [
  killSwitchRule,
  identityRule,
  capabilityRule,
  highRiskRule,
  alwaysApprovalRule,
  policyApprovalRule
]

const VALID_DECISIONS: readonly GovernanceDecisionKind[] = ['allow', 'steer', 'deny']

function isVerdict(value: unknown): value is PolicyVerdict {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.decision === 'string' &&
    VALID_DECISIONS.includes(v.decision as GovernanceDecisionKind) &&
    typeof v.rule === 'string' &&
    v.rule.length > 0 &&
    typeof v.reason === 'string' &&
    v.reason.length > 0
  )
}

const ENGINE_FAILURE = (rule: string, reason: string): PolicyVerdict =>
  verdict('deny', rule, reason)

/**
 * Evaluate one proposed action. Deterministic, total, and fail-closed:
 * every path returns a well-formed verdict, and every failure path denies.
 */
export function evaluatePolicy(
  evaluation: PolicyEvaluation,
  rules: readonly PolicyRule[] = DEFAULT_RULES
): PolicyVerdict {
  for (const rule of rules) {
    let result: PolicyVerdict | null
    try {
      result = rule(evaluation)
    } catch (error) {
      return ENGINE_FAILURE(
        'nomos-policy-engine-unavailable',
        `the policy engine failed while deciding "${evaluation.request.tool}" (${error instanceof Error ? error.message : String(error)}) — the action is refused, not allowed`
      )
    }
    if (result === null) continue
    if (!isVerdict(result)) {
      return ENGINE_FAILURE(
        'nomos-policy-malformed-decision',
        `the policy engine returned a malformed decision for "${evaluation.request.tool}" — the action is refused, not allowed`
      )
    }
    return result
  }
  /* Every rule abstained: the action passed identity and capability checks
   * and is low-risk with no approval contract. Allow it, but name the rule
   * that allowed it so the audit trail never shows an anonymous allow. */
  return verdict(
    'allow',
    'nomos-default-allow',
    'identity and capability verified; low-risk action with no approval contract'
  )
}

/** The default decision for an action whose mode needs no approval and whose
 *  risk is low. Exported for tests and for the mission runner, which has no
 *  interactive approval surface. */
export function allowVerdict(reason = 'nomos-default-allow'): PolicyVerdict {
  return verdict('allow', reason, 'identity and capability verified; low-risk action with no approval contract')
}

export function permissionModeAllowsAuto(mode: PermissionMode | undefined): boolean {
  return mode === 'auto' || mode === 'skip'
}
