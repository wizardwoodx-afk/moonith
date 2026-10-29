/**
 * The governance decision journal — on-disk evidence.
 *
 * Append-only JSONL under the app profile: one line per decision, one line
 * per annotation (an approval or an outcome that landed after the decision).
 * The in-memory ring inside the gate serves the UI; this file is what an
 * auditor gets when they ask for the record. Nothing here is ever rewritten:
 * corrections are new lines, so the history of a decision is visible.
 *
 * TAMPER-EVIDENT HASH CHAIN: Every line carries its 0-based sequence `seq`,
 * `prev` (the SHA-256 hash of the preceding line, rooted at 64 zeros), and its
 * own SHA-256 `hash` over the deterministic canonical form of the line. Any
 * insertion, deletion, reordering, or modification of any field breaks the
 * chain at that exact line and fails cryptographic verification.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GovernanceJournalSink, GovernanceRecord } from './types'

export const JOURNAL_ZERO_HASH = '0'.repeat(64)

export interface JournalChainMeta {
  seq?: number
  prev?: string
  hash?: string
}

export type JournalLine =
  | ({ kind: 'decision' } & GovernanceRecord & JournalChainMeta)
  | ({
      kind: 'annotation'
      actionId: string
      approvedBy?: string
      approvedAt?: string
      outcome?: GovernanceRecord['outcome']
    } & JournalChainMeta)

export interface JournalVerifyResult {
  valid: boolean
  count: number
  error?: string
  brokenAtIndex?: number
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

export function canonicalJournalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

export function computeJournalLineHash(payload: Record<string, unknown>): string {
  const { hash: _hash, ...body } = payload
  return createHash('sha256').update(canonicalJournalJson(body), 'utf8').digest('hex')
}

export class GovernanceJournal implements GovernanceJournalSink {
  private queue: Promise<void> = Promise.resolve()
  private lines: JournalLine[] = []
  private lastHash: string = JOURNAL_ZERO_HASH
  private seq: number = 0
  private initialized = false

  constructor(private readonly file: string) {}

  /**
   * Append one decision. The returned promise resolves only after the line is
   * durably on disk, and REJECTS when it could not be written: the gate's
   * durable path awaits it and refuses the action when it fails, so this file
   * is evidence the caller can rely on, not a best-effort trace.
   *
   * Writes stay serialised: two concurrent decisions must not interleave
   * lines. A failed write does not wedge the queue — the next append is still
   * attempted — but each caller sees its own failure.
   */
  append(record: GovernanceRecord): Promise<void> {
    const line: JournalLine = { kind: 'decision', ...record }
    this.lines.push(line)
    return this.enqueue(line)
  }

  annotate(
    actionId: string,
    patch: { approvedBy?: string; approvedAt?: string; outcome?: GovernanceRecord['outcome'] }
  ): Promise<void> {
    const line: JournalLine = { kind: 'annotation', actionId, ...patch }
    this.lines.push(line)
    return this.enqueue(line)
  }

  private async prepareLine(line: JournalLine): Promise<JournalLine> {
    if (!this.initialized) {
      this.initialized = true
      try {
        const existing = await GovernanceJournal.read(this.file)
        if (existing.length > 0) {
          this.seq = existing.length
          const last = existing[existing.length - 1]
          this.lastHash = last.hash || computeJournalLineHash(last as unknown as Record<string, unknown>)
        }
      } catch {
        /* start fresh if read fails */
      }
    }
    line.seq = this.seq++
    line.prev = this.lastHash
    line.hash = computeJournalLineHash(line as unknown as Record<string, unknown>)
    this.lastHash = line.hash
    return line
  }

  private enqueue(line: JournalLine): Promise<void> {
    const write = this.queue.then(async () => {
      await this.prepareLine(line)
      await fs.mkdir(dirname(this.file), { recursive: true })
      await fs.appendFile(this.file, `${canonicalJournalJson(line)}\n`, 'utf8')
    })
    /* The queue itself must survive a failed write, or one bad append would
     * reject every later one. The caller's promise still carries the error. */
    this.queue = write.catch(() => undefined)
    return write
  }

  /** Everything appended this session (the file may hold more). */
  sessionLines(): JournalLine[] {
    return [...this.lines]
  }

  /** Read the whole file back, tolerating a missing or truncated tail. */
  static async read(file: string): Promise<JournalLine[]> {
    const text = await fs.readFile(file, 'utf8').catch(() => '')
    const out: JournalLine[] = []
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue
      try {
        out.push(JSON.parse(raw) as JournalLine)
      } catch {
        /* A torn final line (a crash mid-append) is skipped, not fatal. */
      }
    }
    return out
  }

  /** Verify cryptographic integrity of journal lines. */
  static verify(lines: readonly JournalLine[]): JournalVerifyResult {
    if (lines.length === 0) return { valid: true, count: 0 }
    let expectedPrev = JOURNAL_ZERO_HASH
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.hash || !line.prev) {
        return {
          valid: false,
          count: lines.length,
          brokenAtIndex: i,
          error: `Line ${i} is missing tamper-proof chain metadata (hash or prev)`
        }
      }
      if (line.prev !== expectedPrev) {
        return {
          valid: false,
          count: lines.length,
          brokenAtIndex: i,
          error: `Hash chain broken at line ${i}: expected prev ${expectedPrev}, found ${line.prev}`
        }
      }
      const expectedHash = computeJournalLineHash(line as unknown as Record<string, unknown>)
      if (line.hash !== expectedHash) {
        return {
          valid: false,
          count: lines.length,
          brokenAtIndex: i,
          error: `Tamper detected at line ${i}: recomputed hash does not match stored hash`
        }
      }
      expectedPrev = line.hash
    }
    return { valid: true, count: lines.length }
  }

  /** Verify cryptographic integrity of a journal file on disk. */
  static async verifyFile(file: string): Promise<JournalVerifyResult> {
    const lines = await GovernanceJournal.read(file)
    return GovernanceJournal.verify(lines)
  }

  /** Fold decision + annotation lines into the records they describe. */
  static fold(lines: readonly JournalLine[]): GovernanceRecord[] {
    const byAction = new Map<string, GovernanceRecord>()
    for (const line of lines) {
      if (line.kind === 'decision') {
        const { kind: _kind, prev: _p, hash: _h, seq: _s, ...record } = line as unknown as Record<string, unknown>
        byAction.set(record.actionId as string, record as unknown as GovernanceRecord)
      } else {
        const record = byAction.get(line.actionId)
        if (!record) continue
        if (line.approvedBy) record.approvedBy = line.approvedBy
        if (line.approvedAt) record.approvedAt = line.approvedAt
        if (line.outcome) record.outcome = line.outcome
      }
    }
    return [...byAction.values()]
  }
}

/** The journal file inside a profile root. */
export function governanceJournalPath(root: string): string {
  return join(root, 'nomos', 'governance.jsonl')
}
