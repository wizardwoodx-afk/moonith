/**
 * The enterprise layers — the shared contract.
 *
 * Three layers sit underneath the agent brain, each with one job and one
 * name:
 *
 *   Nomos    (νόμος, "law")     — the governance gate. Who may do what,
 *                                 under whose authority, decided the same
 *                                 way on every path. src/main/nomos/
 *   Sphragis (σφραγίς, "seal")  — signed action receipts. Evidence that an
 *                                 action was authorized and what became of
 *                                 it. src/main/sphragis/
 *   Aion     (αἰών, "enduring")  — durable missions. Long-running workflows
 *                                 that survive a crash without repeating
 *                                 their side effects. src/main/aion/
 *
 * This module holds what crosses module boundaries: the governed-action
 * shape both the agent runtime and the mission runner execute through, the
 * IPC channels the audit pane talks over, and the view types the renderer
 * renders. It has no runtime dependencies on its own.
 */

/* ── the governed action ─────────────────────────────────────────────────── */

/** One proposed side effect, handed to the gate with everything needed to
 *  judge it and to run it only if judged allowed. */
export interface GovernedAction {
  /** The action name as the gate's capability table knows it. */
  tool: string
  /** Validated arguments. */
  args: Record<string, unknown>
  /** Human-readable summary for the governance record and the approval card. */
  detail: string
  sideEffect: 'none' | 'read' | 'write' | 'execute' | 'network'
  risk: 'low' | 'medium' | 'high'
  approval: 'never' | 'policy' | 'always'
  /** The raw effect. Runs ONLY when the gate allows. */
  effect: () => Promise<{ content: string; isError?: boolean }>
}

export type GovernedVerdict = 'allow' | 'steer' | 'deny'

export interface GovernedResult {
  content: string
  isError: boolean
  decision: GovernedVerdict
  /** The rule that decided. */
  rule: string
  /** False when the gate refused — in which case `effect` never ran. */
  executed: boolean
  /** The action id, for joining with receipts. */
  actionId: string
}

/** Runs a governed action: judges it, then executes it only if allowed. */
export type GovernedRunner = (action: GovernedAction) => Promise<GovernedResult>

/* ── IPC channels ────────────────────────────────────────────────────────── */

export const NOMOS_IPC = {
  summary: 'nomos:summary',
  recent: 'nomos:recent',
  kill: 'nomos:kill',
  release: 'nomos:release'
} as const

export const SPHRAGIS_IPC = {
  summary: 'sphragis:summary',
  recent: 'sphragis:recent',
  verify: 'sphragis:verify'
} as const

export const AION_IPC = {
  list: 'aion:list',
  get: 'aion:get',
  approve: 'aion:approve',
  cancel: 'aion:cancel',
  resume: 'aion:resume',
  reconcile: 'aion:reconcile',
  startRepoScan: 'aion:startRepoScan'
} as const

/* ── view types ──────────────────────────────────────────────────────────── */

export interface GovernanceSummaryView {
  allow: number
  steer: number
  deny: number
  approved: number
  outcomes: { success: number; failure: number; denied: number; unknown: number }
  killEngaged: boolean
  killReason: string | null
  killAt: string | null
  killBy: string | null
  agents: number
}

/** The kill switch as the renderer sees it. Engaging it denies every governed
 *  action for every agent until released; it is persisted, so it survives a
 *  restart — a kill switch that forgets itself is not a kill switch. */
export interface KillSwitchState {
  engaged: boolean
  reason: string | null
  at: string | null
  by: string | null
}

export interface GovernanceRecordView {
  actionId: string
  ts: string
  decision: 'allow' | 'steer' | 'deny'
  rule: string
  reason: string
  /** What was proposed, in words. */
  detail: string
  tool: string
  agentId: string
  trust: number
  outcome: 'success' | 'failure' | 'denied' | 'unknown' | null
  approvedBy: string | null
}

export interface ReceiptSummaryView {
  intents: number
  results: number
  signed: number
  unsigned: number
  openIntents: number
  lastTs: string | null
  keyId: string | null
}

export interface ReceiptView {
  seq: number
  ts: string
  kind: 'intent' | 'result'
  tool: string
  action: string
  actionId: string
  agentId: string
  outcome: 'success' | 'failure' | 'denied' | 'unknown' | null
  signed: boolean
}

export interface ReceiptVerifyView {
  ok: boolean
  signed: boolean
  receipts: number
  problems: string[]
}

export type MissionStatusView =
  | 'running'
  | 'waiting-approval'
  | 'waiting-signal'
  | 'sleeping'
  | 'needs-reconciliation'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface MissionStepView {
  id: string
  kind: 'action' | 'approval' | 'timer' | 'signal'
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'waiting'
  attempts: number
}

export interface MissionSummaryView {
  missionId: string
  workflowId: string
  status: MissionStatusView
  startedAt: string
  updatedAt: string
  steps: MissionStepView[]
  pendingApproval: { stepId: string; title: string; summary: string } | null
  error: string | null
}
