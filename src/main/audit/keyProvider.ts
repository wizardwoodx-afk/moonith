export type AuditKeyProvider = () => Promise<Buffer>

/** Keep Electron keychain access out of pure ledger tests and exported-file verification. */
export async function getDefaultAuditKey(): Promise<Buffer> {
  const { loadAuditSigningKey } = await import('./keychain')
  return loadAuditSigningKey()
}
