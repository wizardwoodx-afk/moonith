/**
 * Persistent Action Journal for the Tool Execution Gateway.
 *
 * Append-only fail-closed record of all tool calls, parameters digest,
 * idempotency metadata, execution duration, and outcome hashes.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export interface ActionJournalRecord {
  actionId: string
  agentId: string
  tool: string
  timestamp: string
  idempotencyKey?: string
  resourceVersion?: string
  argsDigest: string
  status: 'allowed' | 'denied' | 'executed' | 'failed'
  resultDigest?: string
  durationMs?: number
  error?: string
}

export class ActionJournal {
  private logPath: string

  constructor(baseDir?: string) {
    this.logPath = join(baseDir ?? process.cwd(), 'action-journal.jsonl')
  }

  setPath(path: string): void {
    this.logPath = path
  }

  /**
   * Appends an action entry to the persistent journal.
   */
  async append(record: ActionJournalRecord): Promise<void> {
    const line = JSON.stringify(record) + '\n'
    await fs.mkdir(join(this.logPath, '..'), { recursive: true })
    await fs.appendFile(this.logPath, line, 'utf8')
  }

  /**
   * Calculates a SHA-256 digest of arbitrary data.
   */
  static digest(data: unknown): string {
    const text = typeof data === 'string' ? data : JSON.stringify(data)
    return createHash('sha256').update(text).digest('hex')
  }
}

export const actionJournal = new ActionJournal()
