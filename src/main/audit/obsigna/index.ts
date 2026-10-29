/**
 * Obsigna Evidence Subsystem.
 *
 * Named from Latin "obsignare" (to seal, sign, attest with a seal).
 * Produces cryptographic Ed25519-signed receipts directly tied to
 * action journal records, maintaining an unbroken, verifiable hash chain.
 */
import { createHash, verify as edVerify, createPublicKey } from 'node:crypto'
import type { ReceiptSigner } from '../../sphragis/signer'
import { ephemeralSigner } from '../../sphragis/signer'
import type { ActionJournalRecord } from '../../agent/gateway/actionJournal'

export interface ObsignaReceipt {
  receiptId: string
  actionId: string
  tool: string
  timestamp: string
  argsDigest: string
  resultDigest: string
  prevHash: string
  receiptHash: string
  signature: string
  keyId: string
  publicKeyHex?: string
}

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000'

export class ObsignaEngine {
  private lastHash = GENESIS_HASH
  private receipts: ObsignaReceipt[] = []
  private signer: ReceiptSigner

  constructor(signer?: ReceiptSigner) {
    this.signer = signer ?? ephemeralSigner()
  }

  setSigner(signer: ReceiptSigner): void {
    this.signer = signer
  }

  /**
   * Mints and cryptographically signs a receipt linked to a journal action.
   */
  mintReceipt(record: ActionJournalRecord): ObsignaReceipt {
    const prevHash = this.lastHash
    const receiptId = `obs_${Date.now()}_${record.actionId.slice(-6)}`
    const resultDigest = record.resultDigest ?? GENESIS_HASH

    const payload = `${receiptId}:${record.actionId}:${record.tool}:${record.timestamp}:${record.argsDigest}:${resultDigest}:${prevHash}`
    const receiptHash = createHash('sha256').update(payload, 'utf8').digest('hex')
    const signature = this.signer.signDigest(receiptHash)

    const receipt: ObsignaReceipt = {
      receiptId,
      actionId: record.actionId,
      tool: record.tool,
      timestamp: record.timestamp,
      argsDigest: record.argsDigest,
      resultDigest,
      prevHash,
      receiptHash,
      signature,
      keyId: this.signer.keyId,
      publicKeyHex: this.signer.publicKeyHex
    }

    this.lastHash = receiptHash
    this.receipts.push(receipt)
    return receipt
  }

  /**
   * Verifies an individual receipt's Ed25519 signature and hash integrity.
   */
  static verifyReceipt(receipt: ObsignaReceipt, publicKeyHex: string): boolean {
    const payload = `${receipt.receiptId}:${receipt.actionId}:${receipt.tool}:${receipt.timestamp}:${receipt.argsDigest}:${receipt.resultDigest}:${receipt.prevHash}`
    const expectedHash = createHash('sha256').update(payload, 'utf8').digest('hex')
    if (expectedHash !== receipt.receiptHash) return false

    try {
      const publicKey = createPublicKey({
        key: Buffer.from(publicKeyHex, 'hex'),
        format: 'der',
        type: 'spki'
      })
      return edVerify(
        null,
        Buffer.from(receipt.receiptHash, 'hex'),
        publicKey,
        Buffer.from(receipt.signature, 'hex')
      )
    } catch {
      return false
    }
  }

  /**
   * Verifies an entire chain of receipts back to the genesis zero-hash.
   */
  static verifyChain(receipts: ObsignaReceipt[], publicKeyHex: string): { valid: boolean; brokenAt?: string } {
    let expectedPrev = GENESIS_HASH
    for (const receipt of receipts) {
      if (receipt.prevHash !== expectedPrev) {
        return { valid: false, brokenAt: receipt.receiptId }
      }
      if (!this.verifyReceipt(receipt, publicKeyHex)) {
        return { valid: false, brokenAt: receipt.receiptId }
      }
      expectedPrev = receipt.receiptHash
    }
    return { valid: true }
  }

  getReceipts(): ObsignaReceipt[] {
    return [...this.receipts]
  }

  clear(): void {
    this.lastHash = GENESIS_HASH
    this.receipts = []
  }
}

export const obsigna = new ObsignaEngine()
