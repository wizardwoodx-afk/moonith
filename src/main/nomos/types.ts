/**
 * Nomos (νόμος, "law") — the shared governance layer of SelfImpulse.
 *
 * WHY THIS EXISTS. Before any tool touches the world it crosses ONE function:
 * `govern()` in ./gate.ts. Every route uses the same gate — the Captain loop,
 * Crew sub-agents, durable missions, MCP tools, connectors and computer use —
 * so "who is acting, under whose authority, with which scoped capability, and
 * what was decided" has exactly one answer, recorded the same way everywhere.
 *
 * THE FOUR PARTS.
 *   identity.ts — principals (the human/org) and agents (the Captain, Crew
 *                 seats, mission runners), each holding a SCOPED capability
 *                 set. A delegated agent's scopes can only ever be a subset
 *                 of its parent's: scope narrowing is enforced at delegation
 *                 time, not hoped for afterwards.
 *   trust.ts    — a trust SCORE per agent. It is one input to a decision and
 *                 never the decision: a highly trusted agent still cannot run
 *                 a high-risk action without a human, and a trusted agent can
 *                 still be denied.
 *   policy.ts   — deterministic, ordered rules. Unknown or high-risk actions
 *                 are denied by default; a rule that throws or returns a
 *                 malformed verdict fails CLOSED (deny), never open.
 *   gate.ts     — the gate itself: kill switch, policy evaluation, the
 *                 governance decision record, and the approval/outcome
 *                 annotations that close the loop.
 *
 * The design reference for this layer is recorded in THIRD-PARTY-NOTICES.md
 * (Microsoft Agent Governance Toolkit, MIT). No upstream code is used; this
 * is a clean-room implementation under SelfImpulse's own name.
 */

/** A scoped capability. Capabilities are the unit of authority: an agent may
 *  only attempt actions whose capability it holds. */
export type Capability =
  | 'fs.read'
  | 'fs.write'
  | 'fs.delete'
  | 'shell.exec'
  | 'net.fetch'
  | 'browser.control'
  | 'document.create'
  | 'studio.run'
  | 'mission.dispatch'
  | 'memory.read'
  | 'memory.write'
  | 'tool.other'

export const ALL_CAPABILITIES: readonly Capability[] = [
  'fs.read',
  'fs.write',
  'fs.delete',
  'shell.exec',
  'net.fetch',
  'browser.control',
  'document.create',
  'studio.run',
  'mission.dispatch',
  'memory.read',
  'memory.write',
  'tool.other'
]

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && (ALL_CAPABILITIES as readonly string[]).includes(value)
}

/** The one stable ID schema. Every governed action — and every receipt and
 *  mission step that refers to it — carries these five ids, so a decision, an
 *  approval, a tool result and a signed receipt can always be joined. */
export interface ActionIds {
  /** The run this action belongs to (a task run, or a mission run). */
  runId: string
  /** The task inside the run, when the action belongs to one. */
  taskId: string
  /** The action itself — minted by the gate caller, unique per attempt. */
  actionId: string
  /** Which agent is acting (e.g. "Captain", "crew:docs-scout"). */
  agentId: string
  /** On whose authority the agent acts (the local owner, or an org). */
  principalId: string
}

export type GovernanceDecisionKind = 'allow' | 'steer' | 'deny'

export type PermissionMode = 'manual' | 'auto' | 'skip'

/** Everything the gate needs to judge one proposed action. Pure data: the
 *  gate holds no hidden state beyond the registries it was built with. */
export interface GovernanceRequest {
  ids: ActionIds
  /** The tool/action name as the caller knows it. */
  tool: string
  /** Validated arguments (the caller has already schema-checked them). */
  args: Record<string, unknown>
  sideEffect: 'none' | 'read' | 'write' | 'execute' | 'network'
  risk: 'low' | 'medium' | 'high'
  /** The tool's own approval contract. */
  approval: 'never' | 'policy' | 'always'
  /** The task's permission mode, when the action belongs to a task. */
  permissionMode?: PermissionMode
  /** Human-readable summary of what this specific call does — the arguments
   *  as a sentence. The rule's reason says WHY a decision was reached; this
   *  says WHAT was proposed, and it is what an auditor reads first. */
  detail?: string
  /** Explicit capability, when the caller knows better than the tool table. */
  capability?: Capability
  /** The durable mission this action belongs to, when it belongs to one. */
  missionId?: string
}

/** The decision, as returned to the caller. `rule` is the machine-readable
 *  name of the rule that decided; `reason` is what a human reads. */
export interface GovernanceDecision {
  decision: GovernanceDecisionKind
  rule: string
  reason: string
  actionId: string
  ts: string
  /** The agent's trust score AT DECISION TIME — evidence, not authority. */
  trust: number
  capability: Capability
}

/** The decision record — the audit artefact. Approval and outcome are null
 *  until the corresponding annotation lands; the record is never rewritten,
 *  only annotated (see gate.ts). */
export interface GovernanceRecord {
  actionId: string
  ts: string
  decision: GovernanceDecisionKind
  rule: string
  reason: string
  /** What was proposed, in words. Empty when the caller said nothing. */
  detail: string
  tool: string
  agentId: string
  principalId: string
  trust: number
  capability: Capability
  missionId: string | null
  approvedBy: string | null
  approvedAt: string | null
  outcome: 'success' | 'failure' | 'denied' | 'unknown' | null
}

/** Where decision records go. The gate appends; the sink decides where.
 *
 *  `append` may return a promise. `governAwait()` awaits it and treats a
 *  rejection as a REFUSAL: a decision that could not be persisted cannot
 *  authorise an effect. The file-backed sink (./journal.ts) resolves only
 *  after the line is durably written and rejects when it is not.
 *
 *  `annotate` is the correction channel: a decision is never rewritten, so an
 *  approval or an outcome that lands afterwards is a new line naming the
 *  action it belongs to. It is optional because a sink that only keeps the
 *  decisions is still a valid sink — the in-memory ring already holds the
 *  annotation, and the gate calls it defensively. */
export interface GovernanceJournalSink {
  append(record: GovernanceRecord): void | Promise<void>
  annotate?(
    actionId: string,
    patch: { approvedBy?: string; approvedAt?: string; outcome?: GovernanceRecord['outcome'] }
  ): void | Promise<void>
}
