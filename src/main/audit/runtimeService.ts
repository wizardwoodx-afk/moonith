import type {
  AuditEntry,
  AuditEventQuery,
  AuditEventView,
  RuntimeAuditEvent,
  RuntimeAuditIntegrity
} from '@shared/audit'
/* The repo's authoritative scrubber — secrets never reach the trail. Task 4's
 * governance DLP exposes the same `scrubAuditValue` name; re-pointing this one
 * import is the only change needed when it lands. */
import { scrubAuditValue } from '../selfimpulse/security/auditScrub'
import { RuntimeAuditLedger } from './runtimeLedger'
import { getDefaultAuditIdentity, type AuditIdentityProvider } from './keyProvider'

export interface RuntimeAuditServiceOptions {
  file: string
  loadIdentity?: AuditIdentityProvider
  now?: () => string
}

const MAX_AUDIT_DEPTH = 8
const MAX_AUDIT_ITEMS = 100
const MAX_AUDIT_STRING = 4_000

/** Bound evidence after scrubbing so an accidental huge/cyclic tool value
 * cannot turn the audit ledger into an unbounded copy of task content. */
function boundedAuditValue(
  value: unknown,
  depth = 0,
  ancestors: WeakSet<object> = new WeakSet()
): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_AUDIT_STRING
      ? `${value.slice(0, MAX_AUDIT_STRING)}…[truncated]`
      : value
  }
  if (value == null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'object') return undefined
  if (depth >= MAX_AUDIT_DEPTH) return '[truncated:depth]'
  if (ancestors.has(value)) return '[truncated:circular]'
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_AUDIT_ITEMS)
        .map((item) => boundedAuditValue(item, depth + 1, ancestors))
    }
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(
      0,
      MAX_AUDIT_ITEMS
    )) {
      output[key] = boundedAuditValue(child, depth + 1, ancestors)
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}

/** Privacy-safe event recording and query facade over the signed live ledger. */
export class RuntimeAuditService {
  private readonly file: string
  private readonly loadIdentity: AuditIdentityProvider
  private readonly now: () => string
  private ledgerPromise: Promise<RuntimeAuditLedger> | null = null
  /* The last evidence write that FAILED, retained on purpose. `record()` must
   * not crash a tool over a secondary writer, but a swallowed failure is how an
   * audit gap becomes invisible — so the failure is kept and reported through
   * status() as the most recent one, not as a cleared flag on the next success. */
  private lastRecordFailure: { error: string; at: string } | null = null

  constructor(options: RuntimeAuditServiceOptions) {
    this.file = options.file
    this.loadIdentity = options.loadIdentity ?? getDefaultAuditIdentity
    this.now = options.now ?? (() => new Date().toISOString())
  }

  private async ledger(): Promise<RuntimeAuditLedger> {
    if (!this.ledgerPromise) {
      this.ledgerPromise = this.loadIdentity().then(
        (identity) => new RuntimeAuditLedger(this.file, identity)
      )
    }
    try {
      return await this.ledgerPromise
    } catch (error) {
      // A transient keychain failure must not poison all later attempts.
      this.ledgerPromise = null
      throw error
    }
  }

  async record(event: RuntimeAuditEvent): Promise<boolean> {
    try {
      const scrubbed = scrubAuditValue(event)
      const entry: AuditEntry = {
        kind: 'runtime',
        ts: this.now(),
        data: boundedAuditValue(scrubbed) as Record<string, unknown>
      }
      await (await this.ledger()).append(entry)
      return true
    } catch (error) {
      // Governance stays fail-visible through status()/export rather than
      // crashing a tool over a secondary evidence writer — but the failure is
      // named and timestamped, so an audit gap is auditable too.
      this.lastRecordFailure = {
        error: error instanceof Error ? error.message : String(error),
        at: this.now()
      }
      return false
    }
  }

  async status(): Promise<RuntimeAuditIntegrity> {
    const failed = this.lastRecordFailure
    try {
      const integrity = await (await this.ledger()).verifyFromDisk()
      return {
        ...integrity,
        lastRecordError: failed?.error ?? null,
        lastRecordFailedAt: failed?.at ?? null
      }
    } catch (error) {
      return {
        ok: false,
        entries: 0,
        head: null,
        reason: error instanceof Error ? error.message : String(error),
        lastRecordError: failed?.error ?? null,
        lastRecordFailedAt: failed?.at ?? null
      }
    }
  }

  /** Pin the ledger head to a fresh signed anchor — call this on shutdown. */
  async flush(): Promise<void> {
    await (await this.ledger()).flush()
  }

  async entries(): Promise<AuditEntry[]> {
    return (await this.ledger()).entries()
  }

  async events(query: AuditEventQuery = {}): Promise<AuditEventView[]> {
    const entries = await this.entries()
    const needle = typeof query.query === 'string' ? query.query.trim().toLowerCase() : ''
    const requestedLimit = query.limit == null ? 100 : Number(query.limit)
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(500, Math.floor(requestedLimit)))
      : 100
    const views: AuditEventView[] = []
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]
      const data = entry.data as unknown as RuntimeAuditEvent
      if (query.action && data.action !== query.action) continue
      if (query.taskId && data.taskId !== query.taskId) continue
      if (query.outcome && data.outcome !== query.outcome) continue
      if (needle) {
        const searchText = [
          data.action,
          data.target,
          data.taskId,
          data.actorId,
          data.role,
          data.outcome,
          JSON.stringify(data.metadata ?? {})
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!searchText.includes(needle)) continue
      }
      views.push({ ...data, sequence: index + 1, ts: entry.ts })
      if (views.length >= limit) break
    }
    return views
  }
}
