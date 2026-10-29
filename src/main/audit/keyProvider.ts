import type { AuditIdentity } from './identity'

/**
 * Supplies the signing identity. Kept as an injectable provider so the pure
 * ledger tests and the exported-file verifier never touch the Electron
 * keychain — a verifier can be handed `auditVerifierFromPublicKey` instead.
 */
export type AuditIdentityProvider = () => Promise<AuditIdentity>

/** The production provider, imported lazily so `electron` stays out of pure tests. */
export async function getDefaultAuditIdentity(): Promise<AuditIdentity> {
  const { loadAuditSigningKey } = await import('./keychain')
  return loadAuditSigningKey()
}
