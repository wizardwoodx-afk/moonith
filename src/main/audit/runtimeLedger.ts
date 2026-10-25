import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import type { AuditEntry, RuntimeAuditIntegrity } from '@shared/audit'
import {
  AUDIT_ZERO_HASH,
  canonicalAuditJson,
  createChainedAuditLine,
  signAuditPayload,
  type AuditChainReport
} from './chain'
import { atomicWriteFile } from '../atomic'

interface LedgerState {
  entries: AuditEntry[]
  head: string
}

interface ParsedLedger extends LedgerState {
  report: AuditChainReport
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

function sameSignature(left: string, right: string): boolean {
  return isHash(left) && isHash(right) &&
    timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

/**
 * Verifies the live, append-only ledger. Unlike an export it has no trailer:
 * every line carries its own HMAC over {i, entry, prev, hash}. An attacker
 * cannot rebuild a modified chain without the OS-keychain-protected key.
 */
export function verifyRuntimeLedgerLines(
  lines: readonly string[],
  sealKey: Buffer
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
        report: { ok: false, line: lineNumber, reason: `line ${lineNumber} is not valid JSON` }
      }
    }
    const { sig, ...unsigned } = parsed
    if (typeof sig !== 'string' || !sameSignature(sig, signAuditPayload(unsigned, sealKey))) {
      return {
        entries,
        head: prev,
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
        report: { ok: false, line: lineNumber, reason: `line ${lineNumber} was modified` }
      }
    }
    entries.push(entry)
    prev = hash
  }
  return { entries, head: prev, report: { ok: true, entries: entries.length, line: null } }
}

/**
 * A single-writer, durable JSONL ledger. Appends are serialized and fsynced.
 * Integrity failures are sticky: subsequent appends re-read and refuse rather
 * than extending a chain whose evidence has already been contradicted.
 */
export class RuntimeAuditLedger {
  private state: LedgerState | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly sealKey: Buffer
  ) {}

  private get anchorFile(): string {
    return `${this.file}.head.json`
  }

  private async writeAnchor(state: LedgerState): Promise<void> {
    const anchor = { version: 1, entries: state.entries.length, head: state.head }
    const sig = signAuditPayload(anchor, this.sealKey)
    await atomicWriteFile(this.anchorFile, `${canonicalAuditJson({ ...anchor, sig })}\n`)
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async read(): Promise<ParsedLedger> {
    const text = await fs.readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    const lines = text.split('\n').filter((line) => line.trim().length > 0)
    const parsed = verifyRuntimeLedgerLines(lines, this.sealKey)
    if (!parsed.report.ok) return parsed

    const anchorText = await fs
      .readFile(this.anchorFile, 'utf8')
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return ''
        throw error
      })
    if (!anchorText) {
      if (lines.length === 0) return parsed
      return {
        ...parsed,
        report: { ok: false, line: null, reason: 'the signed head anchor is missing' }
      }
    }
    const anchor = parseObject(anchorText.trim())
    const sig = anchor?.sig
    const body = anchor ? { version: anchor.version, entries: anchor.entries, head: anchor.head } : null
    if (
      !anchor ||
      !body ||
      anchor.version !== 1 ||
      typeof anchor.entries !== 'number' ||
      !Number.isInteger(anchor.entries) ||
      !isHash(anchor.head) ||
      typeof sig !== 'string' ||
      !sameSignature(sig, signAuditPayload(body, this.sealKey))
    ) {
      return {
        ...parsed,
        report: { ok: false, line: null, reason: 'the signed head anchor is invalid' }
      }
    }
    const anchoredCount = anchor.entries as number
    if (anchoredCount > parsed.entries.length) {
      return {
        ...parsed,
        report: {
          ok: false,
          line: parsed.entries.length + 1,
          reason: `the ledger is truncated: the signed anchor records ${anchoredCount} entries but only ${parsed.entries.length} remain`
        }
      }
    }
    let anchoredHead = AUDIT_ZERO_HASH
    for (let index = 0; index < anchoredCount; index += 1) {
      anchoredHead = createChainedAuditLine(parsed.entries[index], index, anchoredHead).hash
    }
    if (anchoredHead !== anchor.head) {
      return {
        ...parsed,
        report: { ok: false, line: null, reason: 'the signed head anchor names a different chain' }
      }
    }

    /* A crash can happen after a complete signed line is fsynced but before
     * its anchor is renamed. That authentic suffix is safe to commit. Missing
     * anchored lines, by contrast, were rejected above. */
    if (anchoredCount !== parsed.entries.length) {
      await this.writeAnchor({ entries: parsed.entries, head: parsed.head })
    }
    return parsed
  }

  private async open(): Promise<LedgerState> {
    if (this.state) return this.state
    const parsed = await this.read()
    if (!parsed.report.ok) {
      throw new Error(
        `Runtime audit integrity check failed at line ${parsed.report.line ?? '?'}: ${parsed.report.reason}. Refusing to append.`
      )
    }
    this.state = { entries: parsed.entries, head: parsed.head }
    return this.state
  }

  append(entry: AuditEntry): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.open()
      const chained = createChainedAuditLine(entry, state.entries.length, state.head)
      const sig = signAuditPayload(chained.unsigned, this.sealKey)
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
      const next = { entries: [...state.entries, entry], head: chained.hash }
      try {
        await this.writeAnchor(next)
      } catch (error) {
        this.state = null
        throw error
      }
      this.state = next
    })
  }

  entries(): Promise<AuditEntry[]> {
    return this.exclusive(async () => [...(await this.open()).entries])
  }

  verifyFromDisk(): Promise<RuntimeAuditIntegrity> {
    return this.exclusive(async () => {
      const parsed = await this.read()
      if (parsed.report.ok) {
        this.state = { entries: parsed.entries, head: parsed.head }
        return {
          ok: true,
          entries: parsed.entries.length,
          head: parsed.head
        }
      }
      this.state = null
      return {
        ok: false,
        entries: parsed.entries.length,
        head: parsed.head,
        reason: `Line ${parsed.report.line ?? '?'}: ${parsed.report.reason ?? 'verification failed'}`
      }
    })
  }
}
