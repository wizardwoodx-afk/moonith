/**
 * The signed audit log — the contract between the main process and the
 * settings pane.
 *
 * The export is deterministic JSON-lines: the same engine state always
 * produces a byte-identical file. Every line is one recorded decision,
 * chained to the line before it (see src/main/audit/chain.ts), and the final
 * trailer line carries the Ed25519 signature made with the private seed
 * sealed in the OS keychain. The signature is asymmetric on purpose: verifying
 * evidence needs only the public key, never the signing secret.
 *
 * The same chain also runs live, as an append-only ledger of runtime events
 * (`runtime.jsonl`) — see src/main/audit/runtimeLedger.ts. `RuntimeAuditIntegrity`
 * is how that ledger reports itself to the pane.
 */

export const AUDIT_IPC = {
  summary: 'audit:summary',
  events: 'audit:events',
  export: 'audit:export',
  verify: 'audit:verify'
} as const

export type AuditEntryKind = 'receipt' | 'approval' | 'trace' | 'runtime'

/** How a runtime action ended, as recorded in the live ledger. */
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

/**
 * One runtime fact on its way into the signed ledger. `role` is the governed
 * agent role when the caller knows it; it stays a plain string here so this
 * contract does not depend on the governance module's type.
 */
export type RuntimeAuditEvent = {
  actor: 'captain' | 'crew' | 'system'
  actorId: string
  taskId?: string
  runId?: string
  role?: string
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
  /** Exact match on the event's `action`, e.g. `tool.completed`. */
  action?: string
  taskId?: string
  outcome?: RuntimeAuditOutcome
  limit?: number
}

export interface RuntimeAuditIntegrity {
  ok: boolean
  entries: number
  head: string | null
  reason?: string
  /** The Ed25519 public key the ledger is signed under — publishable, and the
   *  only thing a third party needs to verify the file. */
  publicKey?: string | null
  /** Most recent failed evidence write, retained so a swallow can be seen. */
  lastRecordError?: string | null
  lastRecordFailedAt?: string | null
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
