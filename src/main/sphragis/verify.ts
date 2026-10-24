/**
 * The receipt verifier — independent of everything that minted the receipts.
 *
 * It takes the journal and nothing else: no app state, no signer, no config.
 * Each receipt carries its own issuer public key, so the chain can be
 * checked by anyone holding the file. Four things are checked, and each
 * failure names what broke:
 *
 *   1. FORMAT      — a line that is not a current-format receipt is refused.
 *   2. HASH        — every receipt's hash is recomputed from its own bytes.
 *   3. CHAIN       — prev/hash linkage, in order, from the zero hash.
 *   4. SIGNATURE   — Ed25519 over the hash, with the receipt's issuer key.
 *   5. PAIRING     — every result follows its intent; an intent that never
 *                    closed is reported (that is the crash-reconciliation
 *                    signal, and hiding it would defeat the purpose).
 */
import type { ActionReceipt } from './schema'
import { RECEIPT_FORMAT, receiptHash } from './schema'
import { verifyDigestSignature } from './signer'

export interface ReceiptVerificationReport {
  ok: boolean
  /** True when every receipt carried a verifying signature. */
  signed: boolean
  receipts: number
  /** Human-readable problems, one per finding. */
  problems: string[]
}

const ZERO_HASH = '0'.repeat(64)

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function isHex128(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{128}$/.test(value)
}

export function verifyReceiptChain(entries: readonly ActionReceipt[]): ReceiptVerificationReport {
  const problems: string[] = []
  if (entries.length === 0) {
    return { ok: false, signed: false, receipts: 0, problems: ['the receipt journal is empty'] }
  }

  const openIntents = new Set<string>()
  const closedIntents = new Set<string>()
  let allSigned = true
  let prev = ZERO_HASH

  entries.forEach((entry, index) => {
    const at = `receipt ${index + 1} (seq ${entry?.seq ?? '?'})`
    if (entry.format !== RECEIPT_FORMAT) {
      problems.push(`${at}: unknown receipt format "${String(entry.format)}"`)
      return
    }
    if (!isHex64(entry.hash)) {
      problems.push(`${at}: carries no chain hash`)
      return
    }
    if (entry.prev !== prev) {
      problems.push(
        `${at}: the chain breaks here — an entry was deleted, inserted or reordered`
      )
    }
    const recomputed = receiptHash(entry)
    if (recomputed !== entry.hash) {
      problems.push(`${at}: its bytes do not hash to its recorded hash — it was modified after signing`)
    }
    if (!entry.signature || !entry.issuer?.publicKeyHex) {
      allSigned = false
      problems.push(
        `${at}: carries no issuer signature${entry.signatureNote ? ` (${entry.signatureNote})` : ''} — the chain is tamper-evident but authorship is not attested`
      )
    } else if (!isHex128(entry.signature)) {
      problems.push(`${at}: its signature is not a valid Ed25519 signature`)
    } else if (!verifyDigestSignature(entry.hash, entry.signature, entry.issuer.publicKeyHex)) {
      problems.push(`${at}: signature verification FAILED — the receipt was not signed by the issuer it names`)
    }

    if (entry.kind === 'intent') {
      if (openIntents.has(entry.ids.actionId)) {
        problems.push(`${at}: a second intent for action "${entry.ids.actionId}" before its first closed`)
      }
      openIntents.add(entry.ids.actionId)
    } else if (entry.kind === 'result') {
      if (!openIntents.has(entry.ids.actionId)) {
        problems.push(
          `${at}: a result for action "${entry.ids.actionId}" has no preceding intent receipt`
        )
      }
      openIntents.delete(entry.ids.actionId)
      closedIntents.add(entry.ids.actionId)
    } else {
      problems.push(`${at}: unknown receipt kind "${String(entry.kind)}"`)
    }
    prev = entry.hash
  })

  for (const actionId of openIntents) {
    problems.push(
      `action "${actionId}" has an intent receipt with no result — the run ended mid-action; reconcile before retrying (do not replay blind)`
    )
  }

  return { ok: problems.length === 0, signed: allSigned, receipts: entries.length, problems }
}

/** One receipt, checked on its own: hash and signature. Used by the audit
 *  pane when it shows a single receipt's verification state. */
export function verifyReceipt(entry: ActionReceipt): { ok: boolean; reason?: string } {
  if (entry.format !== RECEIPT_FORMAT) return { ok: false, reason: 'unknown receipt format' }
  if (receiptHash(entry) !== entry.hash) return { ok: false, reason: 'the receipt was modified after signing' }
  if (!entry.signature || !entry.issuer?.publicKeyHex) {
    return { ok: false, reason: 'the receipt carries no issuer signature' }
  }
  if (!verifyDigestSignature(entry.hash, entry.signature, entry.issuer.publicKeyHex)) {
    return { ok: false, reason: 'signature verification failed' }
  }
  return { ok: true }
}
