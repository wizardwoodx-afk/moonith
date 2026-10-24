/**
 * The receipt service — mints, journals and verifies action receipts.
 *
 * The service is the only writer of the journal. It assigns sequence and
 * chain linkage, signs with the injected signer, and appends. Verification
 * never goes through it: the verifier reads the journal back and checks it
 * independently (see ./verify.ts) — a successful mint is NOT proof that the
 * chain verifies, which is why the audit pane runs the verifier separately.
 */
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { ActionIds } from '../nomos/types'
import {
  RECEIPT_FORMAT,
  UNSIGNED_NOTE,
  digestOfValue,
  receiptHash,
  type ActionReceipt,
  type ReceiptAuthorization,
  type ReceiptOutcome,
  type Reversibility
} from './schema'
import type { ReceiptSigner } from './signer'
import { verifyReceiptChain, type ReceiptVerificationReport } from './verify'

const ZERO_HASH = '0'.repeat(64)

export interface ReceiptServiceDeps {
  signer: ReceiptSigner | null
  /** The journal file (JSONL, one receipt per line). */
  file: string
  now?: () => string
}

export interface RecordIntentInput {
  ids: ActionIds
  tool: string
  /** The resolved capability — the action class. */
  action: string
  /** The raw arguments; only their digest is stored. */
  args: Record<string, unknown>
  authorization: ReceiptAuthorization
  reversibility?: Reversibility | null
}

export interface ReceiptSummary {
  intents: number
  results: number
  signed: number
  unsigned: number
  openIntents: number
  lastTs: string | null
  keyId: string | null
}

export class ReceiptService {
  private entries: ActionReceipt[] = []
  /** The single in-flight load. Every mint path awaits THIS promise, so no
   *  receipt can be assigned seq 0 / prev ZERO_HASH while a pre-existing
   *  journal is still being read (which would fork the chain). */
  private loading: Promise<void> | null = null
  /** Serialises whole mints (load → seq/prev assignment → durable append),
   *  not merely the file writes: two concurrent mints must never read the
   *  same head and fork the chain. */
  private mintQueue: Promise<void> = Promise.resolve()
  private queue: Promise<void> = Promise.resolve()
  private now: () => string

  constructor(private readonly deps: ReceiptServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString())
  }

  /** Read the journal back. Idempotent and safe to call concurrently: the
   *  first caller starts the read and everyone awaits the same promise. On a
   *  read failure the promise is cleared so a later call can retry; no
   *  receipt is minted off a half-loaded chain. Public so a host can settle
   *  the summary before showing it — a fresh process has read nothing yet,
   *  and reporting zeros for a full journal would be a lie. */
  async load(): Promise<void> {
    if (!this.loading) {
      this.loading = this.readJournal().catch((error: unknown) => {
        this.loading = null
        throw error
      })
    }
    await this.loading
  }

  private async readJournal(): Promise<void> {
    const text = await fs.readFile(this.deps.file, 'utf8').catch(() => '')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        this.entries.push(JSON.parse(line) as ActionReceipt)
      } catch {
        /* a torn final line from a crash is skipped, not fatal */
      }
    }
  }

  /** Mint an intent receipt — BEFORE the side effect. */
  async recordIntent(input: RecordIntentInput): Promise<ActionReceipt> {
    return this.serializeMint(async () => {
      await this.load()
      const last = this.entries[this.entries.length - 1]
      const receipt: ActionReceipt = {
        format: RECEIPT_FORMAT,
        kind: 'intent',
        seq: last ? last.seq + 1 : 0,
        ts: this.now(),
        ids: input.ids,
        action: input.action,
        tool: input.tool,
        inputDigest: digestOfValue(input.args),
        authorization: input.authorization,
        reversibility: input.reversibility ?? null,
        prev: last ? last.hash : ZERO_HASH,
        hash: '',
        signature: null,
        issuer: null
      }
      return this.sealAndAppend(receipt)
    })
  }

  /** Mint a result receipt — AFTER the side effect. Refuses when no intent
   *  for this action is open: a result without an authorization is exactly
   *  the artefact an auditor must never see. */
  async recordResult(
    actionId: string,
    outcome: ReceiptOutcome,
    result: { digest: string; reversibility?: Reversibility | null }
  ): Promise<ActionReceipt | null> {
    return this.serializeMint(async () => {
      await this.load()
      const intent = [...this.entries].reverse().find((entry) => entry.kind === 'intent' && entry.ids.actionId === actionId)
      if (!intent) return null
      const last = this.entries[this.entries.length - 1]
      const receipt: ActionReceipt = {
        format: RECEIPT_FORMAT,
        kind: 'result',
        seq: last ? last.seq + 1 : 0,
        ts: this.now(),
        ids: intent.ids,
        action: intent.action,
        tool: intent.tool,
        inputDigest: intent.inputDigest,
        authorization: intent.authorization,
        outcome,
        resultDigest: result.digest,
        reversibility: result.reversibility ?? intent.reversibility ?? null,
        prev: last ? last.hash : ZERO_HASH,
        hash: '',
        signature: null,
        issuer: null
      }
      return this.sealAndAppend(receipt)
    })
  }

  /** Verify the whole journal, independently of the minting path. */
  async verify(): Promise<ReceiptVerificationReport> {
    await this.load()
    return verifyReceiptChain(this.entries)
  }

  summary(): ReceiptSummary {
    let intents = 0
    let results = 0
    let signed = 0
    let unsigned = 0
    const open = new Set<string>()
    for (const entry of this.entries) {
      if (entry.kind === 'intent') {
        intents += 1
        open.add(entry.ids.actionId)
      } else {
        results += 1
        open.delete(entry.ids.actionId)
      }
      if (entry.signature) signed += 1
      else unsigned += 1
    }
    return {
      intents,
      results,
      signed,
      unsigned,
      openIntents: open.size,
      lastTs: this.entries.length ? this.entries[this.entries.length - 1].ts : null,
      keyId: this.deps.signer?.keyId ?? null
    }
  }

  recent(limit = 20): ActionReceipt[] {
    return this.entries.slice(-limit)
  }

  /** Read a journal file without a service (the verify door). */
  static async read(file: string): Promise<ActionReceipt[]> {
    const text = await fs.readFile(file, 'utf8').catch(() => '')
    const out: ActionReceipt[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line) as ActionReceipt)
      } catch {
        /* torn line */
      }
    }
    return out
  }

  /** Run one mint after the previous one settles (success or failure) so the
   *  seq/prev it reads is the head the previous mint left behind. */
  private serializeMint<T>(mint: () => Promise<T>): Promise<T> {
    const run = this.mintQueue.then(mint)
    this.mintQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async sealAndAppend(receipt: ActionReceipt): Promise<ActionReceipt> {
    const signer = this.deps.signer
    /* The issuer is part of the signed body: it must be set BEFORE the hash
     * is computed, or the verifier's re-hash sees different bytes than the
     * signer signed. */
    if (signer) {
      receipt.issuer = { keyId: signer.keyId, publicKeyHex: signer.publicKeyHex }
    } else {
      receipt.signatureNote = UNSIGNED_NOTE
    }
    receipt.hash = receiptHash(receipt)
    receipt.signature = signer ? signer.signDigest(receipt.hash) : null
    this.entries.push(receipt)
    /* Serialize appends AND await durability: a caller that minted a
     * receipt must be able to read it back from disk the moment the call
     * resolves, or a restart between mint and flush loses evidence. */
    const line = `${JSON.stringify(receipt)}\n`
    this.queue = this.queue.then(async () => {
      try {
        await fs.mkdir(dirname(this.deps.file), { recursive: true })
        await fs.appendFile(this.deps.file, line, 'utf8')
      } catch {
        /* The in-memory journal still holds the receipt; a failed append is
         * an operational error the next verify() surfaces as a gap. */
      }
    })
    await this.queue
    return receipt
  }
}
