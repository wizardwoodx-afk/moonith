/**
 * Sphragis — the barrel, and the production wiring.
 *
 * `receiptService()` hands out the one service the app mints through. Built
 * lazily so importing this module stays probe-friendly: the keychain signer
 * and the journal path only resolve inside a running Electron app.
 */
import { join } from 'node:path'
import { getPaths } from '../paths'
import { ReceiptService } from './service'
import { loadKeychainSigner } from './signer'

export * from './schema'
export { ReceiptService, type ReceiptServiceDeps, type RecordIntentInput, type ReceiptSummary } from './service'
export {
  loadKeychainSigner,
  signerFromSeed,
  ephemeralSigner,
  verifyDigestSignature,
  keyIdFor,
  type ReceiptSigner
} from './signer'
export { verifyReceiptChain, verifyReceipt, type ReceiptVerificationReport } from './verify'

let singleton: ReceiptService | null = null

/** The one receipt service, rooted at the app profile. */
export function receiptService(): ReceiptService {
  if (!singleton) {
    const root = getPaths().root
    singleton = new ReceiptService({
      signer: loadKeychainSigner(root),
      file: join(root, 'sphragis', 'receipts.jsonl')
    })
  }
  return singleton
}

/** Probe/test helper: replace the singleton. */
export function setReceiptService(service: ReceiptService | null): void {
  singleton = service
}
