/**
 * The signed audit log — the contract between the main process and the
 * settings pane.
 *
 * The export is deterministic JSON-lines: the same engine state always
 * produces a byte-identical file. Every line is one recorded decision,
 * chained to the line before it (see src/main/audit/chain.ts), and the final
 * trailer line carries the HMAC-SHA-256 signature made with a key sealed in
 * the OS keychain.
 */

export const AUDIT_IPC = {
  summary: 'audit:summary',
  events: 'audit:events',
  export: 'audit:export',
  verify: 'audit:verify'
} as const

export type AuditEntryKind = 'receipt' | 'approval' | 'trace' | 'runtime'

export type RuntimeAuditOutcome =
  | 'info'
  | 'allowed'
  | 'denied'
  | 'requested'
  | 'approved'
  | 'redacted'
  | 'blocked'
  | 'ok'
  | 'error'

export type RuntimeAuditEvent = {
  actor: 'captain' | 'crew' | 'system'
  actorId: string
  taskId?: string
  runId?: string
  role?: import('./governance').AgentRole
  action: string
  outcome: RuntimeAuditOutcome
  target?: string
  detail?: string
  /** Metadata is scrubbed and size-limited before it reaches the ledger. */
  metadata?: Record<string, unknown>
}

export interface AuditEventView extends RuntimeAuditEvent {
  sequence: number
  ts: string
}

export interface AuditEventQuery {
  query?: string
  taskId?: string
  outcome?: RuntimeAuditOutcome
  limit?: number
}

export interface RuntimeAuditIntegrity {
  ok: boolean
  entries: number
  head: string | null
  reason?: string
}

/**
 * One recorded decision, exactly as the engine session holds it — nothing is
 * synthesised at export time. `ts` is the engine's own timestamp for the
 * decision; the serialiser never stamps the current time, which is what keeps
 * the export deterministic.
 */
export interface AuditEntry {
  kind: AuditEntryKind
  ts: string
  data: Record<string, unknown>
}

export interface AuditSummary {
  entries: number
  receipts: number
  approvals: number
  traces: number
  runtime: number
  runtimeIntegrity: RuntimeAuditIntegrity
  firstTs: string | null
  lastTs: string | null
}

export interface AuditExportResult {
  path: string
  entries: number
}

export type AuditVerifyResult =
  | { ok: true; path: string; entries: number }
  | { ok: false; path: string; line: number | null; reason: string }
