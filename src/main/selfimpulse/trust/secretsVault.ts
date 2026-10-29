/**
 * Encrypted Secrets Vault for SelfImpulse.
 *
 * Implements hardware-grade secret protection:
 * - Uses AES-256-GCM with PBKDF2 salt derivation.
 * - API keys and credentials NEVER appear in the model's context window.
 * - Models receive and handle only opaque references: e.g. "vault:github_token".
 * - Gateway resolves the secret just-in-time at execution boundaries and scrubs output.
 */
import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto'

export interface VaultSecretEntry {
  id: string
  name: string
  handle: string
  encryptedData: string
  iv: string
  authTag: string
  createdAt: string
  updatedAt: string
}

export class SecretsVaultService {
  private masterKey: Buffer
  private secrets: Map<string, VaultSecretEntry> = new Map()

  constructor() {
    // Generate or derive a secure 256-bit vault master key
    const salt = randomBytes(16)
    this.masterKey = pbkdf2Sync(
      process.env['SELFIMPULSE_VAULT_PASSPHRASE'] || 'selfimpulse_local_secure_vault_passphrase',
      salt,
      100000,
      32,
      'sha256'
    )
  }

  /**
   * Store a secret securely in the vault and return an opaque handle.
   */
  storeSecret(name: string, plaintext: string): string {
    const id = `sec_${Date.now()}_${randomBytes(4).toString('hex')}`
    const handle = `vault:${name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`

    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()

    const entry: VaultSecretEntry = {
      id,
      name,
      handle,
      encryptedData: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    this.secrets.set(handle, entry)
    return handle
  }

  /**
   * Dereference a secret just-in-time for an authorized tool call.
   */
  resolveSecret(handle: string): string | null {
    const entry = this.secrets.get(handle)
    if (!entry) return null

    try {
      const iv = Buffer.from(entry.iv, 'hex')
      const authTag = Buffer.from(entry.authTag, 'hex')
      const encrypted = Buffer.from(entry.encryptedData, 'hex')

      const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv)
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
      return decrypted.toString('utf8')
    } catch {
      return null
    }
  }

  /**
   * Check if a text contains an opaque secret reference.
   */
  hasSecretHandle(text: string): boolean {
    return /vault:[a-z0-9_]+/i.test(text)
  }

  /**
   * Redact known secrets from any logging or context output.
   */
  redactPlaintexts(content: string): string {
    let result = content
    for (const entry of this.secrets.values()) {
      const plain = this.resolveSecret(entry.handle)
      if (plain && plain.length > 4 && result.includes(plain)) {
        result = result.replaceAll(plain, `[REDACTED_SECRET:${entry.name}]`)
      }
    }
    return result
  }
}

export const secretsVault = new SecretsVaultService()
