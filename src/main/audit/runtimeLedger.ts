import { promises as fs } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { AuditEntry, RuntimeAuditIntegrity } from '@shared/audit'
import {
  AUDIT_ZERO_HASH,
  canonicalAuditJson,
  createChainedAuditLine,
  signAuditPayload,
  verifyAuditPayload,
  type AuditChainReport
} from './chain'
import type { AuditIdentity } from './identity'
import { writeAuditFileDurably } from './durableWrite'

/** The chain state of the ACTIVE segment, cached between appends. */
interface LedgerState {
  entries: AuditEntry[]
  head: string
  /** 1-based segment number; rotation archives `runtime.jsonl.<segment - 1>`. */
  segment: number
  /** The signed head of the segment that ended before this one, if any. */
  previousHead: string | null
}

interface ParsedLedger extends LedgerState {
  report: AuditChainReport
}

interface SignedAnchor {
  version: number
  segment: number
  entries: number
  head: string
  previousHead: string | null
}

/** The signed head anchor's format version — it names the segment it pins. */
const ANCHOR_VERSION = 2

/** How often a fresh signed anchor is written during steady-state appends. */
export const DEFAULT_ANCHOR_INTERVAL = 32

/** How often an append re-reads the WHOLE file instead of just its tail. */
const FULL_REREAD_EVERY = 25

/** How many trailing lines the cheap per-append re-read inspects. */
const TAIL_REREAD_LINES = 3

/** Bytes read from the end of the file for a tail re-read. */
const TAIL_READ_BYTES = 256 * 1024

/** One segment's worth of lines before the ledger rotates. */
export const DEFAULT_MAX_LEDGER_LINES = 200_000

export interface RuntimeAuditLedgerOptions {
  /** Test/override seam for the rotation cap. */
  maxLines?: number
  /** Test/override seam for the signed-anchor cadence. */
  anchorInterval?: number
}

function parseObject(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function splitLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim().length > 0)
}

/**
 * Verifies the live, append-only ledger. Unlike an export it has no trailer:
 * every line carries its own Ed25519 signature over the canonical
 * `{ i, entry, prev, hash }`. Rebuilding a modified chain therefore requires
 * the sealed seed, while verifying it needs nothing but the public key — pass
 * `auditVerifierFromPublicKey(...)` and no secret is involved at all.
 */
export function verifyRuntimeLedgerLines(
  lines: readonly string[],
  identity: AuditIdentity
): ParsedLedger {
  const entries: AuditEntry[] = []
  let prev = AUDIT_ZERO_HASH
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const parsed = parseObject(lines[index])
    if (!parsed) {
      return {
        entries,
        head: prev,
        segment: 1,
        previousHead: null,
        report: { ok: false, line: lineNumber, reason: `line ${lineNumber} is not valid JSON` }
      }
    }
    const { sig, ...unsigned } = parsed
    if (!verifyAuditPayload(unsigned, sig, identity)) {
      return {
        entries,
        head: prev,
        segment: 1,
        previousHead: null,
        report: {
          ok: false,
          line: lineNumber,
          reason: `line ${lineNumber} has an invalid signature`
        }
      }
    }
    const { hash, ...body } = unsigned
    const entry = body.entry as AuditEntry | undefined
    if (
      body.i !== index ||
      body.prev !== prev ||
      !isHash(hash) ||
      !entry ||
      entry.kind !== 'runtime' ||
      typeof entry.ts !== 'string' ||
      !entry.data ||
      typeof entry.data !== 'object'
    ) {
      return {
        entries,
        head: prev,
        segment: 1,
        previousHead: null,
        report: {
          ok: false,
          line: lineNumber,
          reason: `line ${lineNumber} is malformed or breaks the chain`
        }
      }
    }
    const expected = createChainedAuditLine(entry, index, prev)
    if (expected.hash !== hash || expected.line !== canonicalAuditJson(unsigned)) {
      return {
        entries,
        head: prev,
        segment: 1,
        previousHead: null,
        report: { ok: false, line: lineNumber, reason: `line ${lineNumber} was modified` }
      }
    }
    entries.push(entry)
    prev = hash
  }
  return {
    entries,
    head: prev,
    segment: 1,
    previousHead: null,
    report: { ok: true, entries: entries.length, line: null }
  }
}

/**
 * A single-writer, durable JSONL ledger. Appends are serialized and fsynced,
 * every line is signed, and the chain head is pinned by a separate signed
 * anchor so a truncated tail cannot pass as an intact log.
 *
 * WHAT MAKES IT TAMPER-EVIDENT, HONESTLY
 *   - per-line signatures: planting, editing or reordering a line needs the
 *     sealed seed;
 *   - the cached head is re-checked against the file before EVERY append, so a
 *     live process refuses to extend a file that was truncated, replaced or
 *     grown underneath it;
 *   - the signed anchor, rewritten every `anchorInterval` appends and on every
 *     integrity check/`flush()`, so a truncation that happened while the
 *     process was down is still caught at the next open. The honest limit of
 *     that cadence: at most `anchorInterval` appends of tail can be discarded
 *     between two anchors without the live check noticing — which is why a
 *     shutdown flush and the periodic `status()` poll exist.
 *
 * Integrity failures are sticky: state is cleared and the append throws rather
 * than extending a chain whose evidence has already been contradicted.
 */
export class RuntimeAuditLedger {
  private state: LedgerState | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly maxLines: number
  private readonly anchorInterval: number

  constructor(
    private readonly file: string,
    private readonly identity: AuditIdentity,
    options: RuntimeAuditLedgerOptions = {}
  ) {
    this.maxLines = Math.max(1, options.maxLines ?? DEFAULT_MAX_LEDGER_LINES)
    this.anchorInterval = Math.max(1, options.anchorInterval ?? DEFAULT_ANCHOR_INTERVAL)
  }

  /** The public half of the key that signs this ledger — safe to publish. */
  get publicKey(): string {
    return this.identity.publicKey
  }

  private get anchorFile(): string {
    return `${this.file}.head.json`
  }

  private segmentFile(segment: number): string {
    return `${this.file}.${segment}`
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => undefined)
    return result
  }

  private anchorBody(state: LedgerState): SignedAnchor {
    return {
      version: ANCHOR_VERSION,
      segment: state.segment,
      entries: state.entries.length,
      head: state.head,
      previousHead: state.previousHead
    }
  }

  private async writeAnchor(state: LedgerState): Promise<void> {
    const body = this.anchorBody(state)
    const line = canonicalAuditJson({ ...body, sig: signAuditPayload(body, this.identity) })
    await writeAuditFileDurably(this.anchorFile, `${line}\n`, { mode: 0o600 })
  }

  private async readAllLines(): Promise<string[]> {
    const text = await fs.readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    return splitLines(text)
  }

  /**
   * The last `count` lines, read from the END of the file. Reading the tail
   * instead of the whole ledger is what keeps the per-append integrity check
   * affordable on a 200 000-line segment.
   */
  private async readTailLines(count: number): Promise<string[]> {
    let handle: fs.FileHandle | undefined
    try {
      handle = await fs.open(this.file, 'r')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    try {
      const { size } = await handle.stat()
      if (size === 0) return []
      const window = Math.min(size, TAIL_READ_BYTES)
      const start = size - window
      const buffer = Buffer.alloc(window)
      await handle.read(buffer, 0, window, start)
      const lines = splitLines(buffer.toString('utf8'))
      if (start > 0 && lines.length > 0 && !parseObject(lines[0])) lines.shift()
      return lines.slice(-count)
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  /** Parse and re-verify one on-disk line; returns its index, prev and hash. */
  private lineFacts(line: string): { i: number; prev: string; hash: string } | string {
    const parsed = parseObject(line)
    if (!parsed) return 'a trailing ledger line is not valid JSON'
    const { sig, ...unsigned } = parsed
    if (!verifyAuditPayload(unsigned, sig, this.identity)) {
      return `line ${String(parsed.i)} on disk is not signed by this machine’s key`
    }
    const { hash, ...body } = unsigned
    if (!isHash(hash) || typeof body.i !== 'number' || typeof body.prev !== 'string') {
      return `line ${String(body.i)} on disk is malformed`
    }
    return { i: body.i, hash, prev: body.prev }
  }

  /**
   * Cheap pre-append check: does the file's own tail still end where this
   * process thinks it ends? Returns null when the disk agrees, or the reason
   * it does not.
   */
  private async tailDisagreement(state: LedgerState): Promise<string | null> {
    const lines = await this.readTailLines(TAIL_REREAD_LINES)
    if (lines.length === 0) {
      if (state.entries.length === 0) return null
      return (
        `${basename(this.file)} is gone: this process holds ${state.entries.length} signed ` +
        'lines and none remain on disk'
      )
    }
    let previousHash: string | null = null
    let lastIndex = -1
    for (const line of lines) {
      const facts = this.lineFacts(line)
      if (typeof facts === 'string') return facts
      if (previousHash !== null && facts.prev !== previousHash) {
        return `the chain breaks in the trailing lines — line ${facts.i + 1} does not name the hash of the line before it`
      }
      previousHash = facts.hash
      lastIndex = facts.i
    }
    if (lastIndex !== state.entries.length - 1) {
      return (
        `${basename(this.file)} no longer ends where this process left it: it holds ` +
        `${state.entries.length} signed lines but the file's last line is numbered ${lastIndex + 1} — ` +
        'lines were deleted, inserted or the file was replaced'
      )
    }
    if (previousHash !== state.head) {
      return `the chain head on disk is not the head this process holds — the trailing line was rewritten`
    }
    return null
  }

  private async loadAnchor(): Promise<SignedAnchor | null> {
    const text = await fs
      .readFile(this.anchorFile, 'utf8')
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return ''
        throw error
      })
    if (!text) return null
    const parsed = parseObject(text.trim())
    if (!parsed) return null
    const { sig, ...body } = parsed
    if (
      body.version !== ANCHOR_VERSION ||
      typeof body.segment !== 'number' ||
      !Number.isInteger(body.segment) ||
      typeof body.entries !== 'number' ||
      !Number.isInteger(body.entries) ||
      !isHash(body.head) ||
      !(body.previousHead === null || body.previousHead === undefined || isHash(body.previousHead)) ||
      typeof sig !== 'string' ||
      !verifyAuditPayload(body, sig, this.identity)
    ) {
      return null
    }
    return {
      version: ANCHOR_VERSION,
      segment: body.segment as number,
      entries: body.entries as number,
      head: body.head as string,
      previousHead: (body.previousHead as string | undefined) ?? null
    }
  }

  /**
   * A crash can land between archiving a full segment and writing the new
   * segment's anchor, which would leave the live anchor naming more lines than
   * the empty active file holds. That is a rotation boundary, not a truncation,
   * and the archived segment proves it: verify the archive against the anchor
   * before calling it a loss.
   */
  private async recoveredRotation(anchor: SignedAnchor): Promise<LedgerState | null> {
    if (anchor.segment < 1) return null
    let archived: string
    try {
      archived = await fs.readFile(this.segmentFile(anchor.segment), 'utf8')
    } catch {
      return null
    }
    const parsed = verifyRuntimeLedgerLines(splitLines(archived), this.identity)
    if (!parsed.report.ok) return null
    if (parsed.entries.length !== anchor.entries || parsed.head !== anchor.head) return null
    const next: LedgerState = {
      entries: [],
      head: AUDIT_ZERO_HASH,
      segment: anchor.segment + 1,
      previousHead: anchor.head
    }
    await this.writeAnchor(next)
    return next
  }

  private async read(): Promise<ParsedLedger> {
    const lines = await this.readAllLines()
    const parsed = verifyRuntimeLedgerLines(lines, this.identity)
    if (!parsed.report.ok) return parsed

    const anchor = await this.loadAnchor()
    if (!anchor) {
      if (lines.length === 0) {
        return { ...parsed, segment: 1, previousHead: null }
      }
      return {
        ...parsed,
        report: { ok: false, line: null, reason: 'the signed head anchor is missing' }
      }
    }

    if (anchor.entries > parsed.entries.length) {
      const rotated = parsed.entries.length === 0 ? await this.recoveredRotation(anchor) : null
      if (rotated) {
        return { ...rotated, report: { ok: true, entries: 0, line: null } }
      }
      return {
        ...parsed,
        segment: anchor.segment,
        previousHead: anchor.previousHead,
        report: {
          ok: false,
          line: parsed.entries.length + 1,
          reason: `the ledger is truncated: the signed anchor records ${anchor.entries} entries but only ${parsed.entries.length} remain`
        }
      }
    }

    let anchoredHead = AUDIT_ZERO_HASH
    for (let index = 0; index < anchor.entries; index += 1) {
      anchoredHead = createChainedAuditLine(parsed.entries[index], index, anchoredHead).hash
    }
    if (anchoredHead !== anchor.head) {
      return {
        ...parsed,
        segment: anchor.segment,
        previousHead: anchor.previousHead,
        report: { ok: false, line: null, reason: 'the signed head anchor names a different chain' }
      }
    }

    const state: LedgerState = {
      entries: parsed.entries,
      head: parsed.head,
      segment: anchor.segment,
      previousHead: anchor.previousHead
    }

    /* A crash can happen after a complete signed line is fsynced but before
     * its anchor is renamed. That authentic suffix is safe to commit; missing
     * anchored lines, by contrast, were rejected above. */
    if (anchor.entries !== parsed.entries.length && this.identity.canSign) {
      await this.writeAnchor(state)
    }
    return { ...state, report: parsed.report }
  }

  private async open(): Promise<LedgerState> {
    if (this.state) return this.state
    const parsed = await this.read()
    if (!parsed.report.ok) {
      throw new Error(
        `Runtime audit integrity check failed at line ${parsed.report.line ?? '?'}: ${parsed.report.reason}. Refusing to append.`
      )
    }
    this.state = {
      entries: parsed.entries,
      head: parsed.head,
      segment: parsed.segment,
      previousHead: parsed.previousHead
    }
    return this.state
  }

  /**
   * Re-read the file and compare it with the cached chain before appending.
   * Full re-read every `FULL_REREAD_EVERY` lines (which also re-commits the
   * anchor through `read()`), trailing lines otherwise. Any disagreement
   * clears the cache, so the next caller re-verifies from disk rather than
   * letting one bad write poison a permanently stale cache.
   */
  private async revalidateAgainstDisk(state: LedgerState): Promise<void> {
    let failure: string | null
    if (state.entries.length % FULL_REREAD_EVERY === 0) {
      const fresh = await this.read()
      if (!fresh.report.ok) {
        failure = `line ${fresh.report.line ?? '?'}: ${fresh.report.reason ?? 'verification failed'}`
      } else if (
        fresh.entries.length !== state.entries.length ||
        fresh.head !== state.head ||
        fresh.segment !== state.segment
      ) {
        failure =
          `the recomputed chain head does not match this process's cached head ` +
          `(${fresh.entries.length} lines on disk versus ${state.entries.length} held)`
      } else {
        failure = null
      }
    } else {
      failure = await this.tailDisagreement(state)
    }
    if (failure) {
      this.state = null
      throw new Error(
        `Runtime audit integrity check failed: ${failure}. Refusing to append to a contradicted ledger.`
      )
    }
  }

  /** Move a full segment to `runtime.jsonl.<n>` and open the next one, chained. */
  private async rotate(state: LedgerState): Promise<LedgerState> {
    const closingHead = state.head
    const archive = this.segmentFile(state.segment)
    const archiveAnchor = `${archive}.head.json`
    const anchorLine = canonicalAuditJson({
      ...this.anchorBody(state),
      sig: signAuditPayload(this.anchorBody(state), this.identity)
    })
    /* Pin the segment being archived under its own name BEFORE the rename, so
     * the archive stays verifiable after the live anchor moves on. */
    await writeAuditFileDurably(archiveAnchor, `${anchorLine}\n`, { mode: 0o600 })
    await fs.rename(this.file, archive)
    const next: LedgerState = {
      entries: [],
      head: AUDIT_ZERO_HASH,
      segment: state.segment + 1,
      previousHead: closingHead
    }
    await this.writeAnchor(next)
    return next
  }

  append(entry: AuditEntry): Promise<void> {
    return this.exclusive(async () => {
      const opened = await this.open()
      await this.revalidateAgainstDisk(opened)
      let state = opened
      if (state.entries.length >= this.maxLines) {
        try {
          state = await this.rotate(state)
        } catch (error) {
          this.state = null
          throw error
        }
      }
      const chained = createChainedAuditLine(entry, state.entries.length, state.head)
      const sig = signAuditPayload(chained.unsigned, this.identity)
      const line = canonicalAuditJson({ ...chained.unsigned, sig })
      await fs.mkdir(dirname(this.file), { recursive: true })
      const handle = await fs.open(this.file, 'a')
      try {
        await handle.writeFile(`${line}\n`, 'utf8')
        await handle.sync()
      } catch (error) {
        this.state = null
        throw error
      } finally {
        await handle.close()
      }
      const next: LedgerState = {
        ...state,
        entries: [...state.entries, entry],
        head: chained.hash
      }
      /* Steady-state cost cap: pin on the first line of a segment and then
       * every `anchorInterval` appends — `flush()` and `verifyFromDisk()` pin
       * on demand. */
      if (
        next.entries.length === 1 ||
        next.entries.length % this.anchorInterval === 0 ||
        next.entries.length >= this.maxLines
      ) {
        try {
          await this.writeAnchor(next)
        } catch (error) {
          this.state = null
          throw error
        }
      }
      this.state = next
    })
  }

  entries(): Promise<AuditEntry[]> {
    return this.exclusive(async () => [...(await this.open()).entries])
  }

  /**
   * Pin the current chain head to a signed anchor. Called on shutdown and by
   * any caller that must not leave a window of unanchored appends.
   */
  flush(): Promise<void> {
    return this.exclusive(async () => {
      await this.writeAnchor(await this.open())
    })
  }

  verifyFromDisk(): Promise<RuntimeAuditIntegrity> {
    return this.exclusive(async () => {
      const parsed = await this.read()
      if (parsed.report.ok) {
        const state: LedgerState = {
          entries: parsed.entries,
          head: parsed.head,
          segment: parsed.segment,
          previousHead: parsed.previousHead
        }
        this.state = state
        if (this.identity.canSign) {
          try {
            await this.writeAnchor(state)
          } catch (error) {
            this.state = null
            throw error
          }
        }
        return {
          ok: true,
          entries: parsed.entries.length,
          head: parsed.head,
          publicKey: this.identity.publicKey
        }
      }
      this.state = null
      return {
        ok: false,
        entries: parsed.entries.length,
        head: parsed.head,
        publicKey: this.identity.publicKey,
        reason: `Line ${parsed.report.line ?? '?'}: ${parsed.report.reason ?? 'verification failed'}`
      }
    })
  }
}
