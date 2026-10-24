/**
 * The Aion journal — append-only JSONL on disk, one file per mission.
 *
 * Every append is awaited by the caller, so a transition is durable before
 * the code that caused it moves on. A torn final line (a crash mid-append)
 * is skipped on read rather than failing the mission: the last transition
 * is lost, and losing the last transition is survivable — inventing one is
 * not.
 */
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { JournalRecord, MissionJournal } from './workflow'

export class FileMissionJournal implements MissionJournal {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  async append(record: JournalRecord): Promise<void> {
    const line = `${JSON.stringify(record)}\n`
    this.queue = this.queue.then(async () => {
      await fs.mkdir(dirname(this.file), { recursive: true })
      await fs.appendFile(this.file, line, 'utf8')
    })
    await this.queue
  }

  async read(): Promise<JournalRecord[]> {
    const text = await fs.readFile(this.file, 'utf8').catch(() => '')
    const out: JournalRecord[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line) as JournalRecord)
      } catch {
        /* torn tail — skip */
      }
    }
    return out
  }

  async exists(): Promise<boolean> {
    return fs
      .access(this.file)
      .then(() => true)
      .catch(() => false)
  }
}

/** In-memory journal for probes. Same contract, no disk. The records are
 *  public and readonly so a test can assert exactly what a mission appended
 *  without reaching into a private field. */
export class MemoryMissionJournal implements MissionJournal {
  constructor(readonly records: JournalRecord[] = []) {}

  async append(record: JournalRecord): Promise<void> {
    this.records.push(record)
  }

  async read(): Promise<JournalRecord[]> {
    return [...this.records]
  }

  async exists(): Promise<boolean> {
    return this.records.length > 0
  }
}
