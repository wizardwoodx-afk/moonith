/**
 * The governance decision journal — on-disk evidence.
 *
 * Append-only JSONL under the app profile: one line per decision, one line
 * per annotation (an approval or an outcome that landed after the decision).
 * The in-memory ring inside the gate serves the UI; this file is what an
 * auditor gets when they ask for the record. Nothing here is ever rewritten:
 * corrections are new lines, so the history of a decision is visible.
 */
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GovernanceJournalSink, GovernanceRecord } from './types'

export type JournalLine =
  | ({ kind: 'decision' } & GovernanceRecord)
  | {
      kind: 'annotation'
      actionId: string
      approvedBy?: string
      approvedAt?: string
      outcome?: GovernanceRecord['outcome']
    }

export class GovernanceJournal implements GovernanceJournalSink {
  private queue: Promise<void> = Promise.resolve()
  private lines: JournalLine[] = []

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

  private enqueue(line: JournalLine): Promise<void> {
    const write = this.queue.then(async () => {
      await fs.mkdir(dirname(this.file), { recursive: true })
      await fs.appendFile(this.file, `${JSON.stringify(line)}\n`, 'utf8')
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

  /** Fold decision + annotation lines into the records they describe. */
  static fold(lines: readonly JournalLine[]): GovernanceRecord[] {
    const byAction = new Map<string, GovernanceRecord>()
    for (const line of lines) {
      if (line.kind === 'decision') {
        const { kind: _kind, ...record } = line
        byAction.set(record.actionId, record)
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
