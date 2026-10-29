/**
 * The audit signing identity — Ed25519, and the reason the audit ledger is
 * honestly tamper-evident rather than merely self-consistent.
 *
 * WHY ASYMMETRIC. The audit seal used to be an HMAC-SHA-256 keyed by a secret
 * derived from the keychain. That has a fatal property for an evidence format:
 * verification needs the SAME secret as signing, so anyone holding the secret
 * can also forge a contradiction-free log, and no third party (an auditor, a
 * later build of this app, the receiver of an export) can verify anything
 * without being handed the signing key. Ed25519 splits those powers: the
 * ledger is signed with the sealed private seed, and the public key alone —
 * not a secret, publishable with an export — is enough to verify it.
 *
 * The private seed never leaves the main process (the same rule the Sphragis
 * receipt signer follows in `src/main/sphragis/signer.ts`), and an identity
 * built from the public key alone (`auditVerifierFromPublicKey`) cannot sign.
 *
 * The key pair is derived DETERMINISTICALLY from a 32-byte seed, so a profile
 * restored from backup reproduces exactly the same public key and keeps
 * verifying the evidence it signed before the restore.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as ed25519Sign,
  verify as ed25519Verify,
  type KeyObject
} from 'node:crypto'

/** PKCS#8 DER prefix for a 32-byte Ed25519 seed (same constant as sphragis). */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

/** An Ed25519 signature is 64 bytes — 128 hex characters. */
export const AUDIT_SIGNATURE_HEX = /^[0-9a-f]{128}$/

export interface AuditIdentity {
  readonly algorithm: 'ed25519'
  /** The SPKI public key, hex-encoded — verifiable without any secret. */
  readonly publicKey: string
  /** Whether this identity holds the sealed private half and can write anchors. */
  readonly canSign: boolean
  /** Sign a payload string; returns the hex signature. Throws without a secret. */
  sign(payload: string): string
  /** Verify a hex signature over a payload string. Never throws. */
  verify(payload: string, signature: string): boolean
}

function privateKeyFromSeed(seed: Buffer): KeyObject {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) {
    throw new Error('an Ed25519 audit signing seed is exactly 32 bytes')
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8'
  })
}

function publicKeyHexOf(privateKey: KeyObject): string {
  const publicKey = createPublicKey(privateKey)
  return Buffer.from(publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('hex')
}

/** A short stable handle for a key, so a report can name which key signed. */
export function auditKeyId(publicKey: string): string {
  return createHash('sha256').update(publicKey, 'utf8').digest('hex').slice(0, 16)
}

/** Verify with a hex-encoded SPKI public key; a malformed signature is a no, not a throw. */
export function verifyWithPublicKey(payload: string, signature: string, publicKey: string): boolean {
  if (typeof signature !== 'string' || !AUDIT_SIGNATURE_HEX.test(signature)) return false
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'hex'), format: 'der', type: 'spki' })
    return ed25519Verify(null, Buffer.from(payload, 'utf8'), key, Buffer.from(signature, 'hex'))
  } catch {
    return false
  }
}

/** The production identity: both halves, derived from the sealed seed. */
export function auditIdentityFromSeed(seed: Buffer): AuditIdentity {
  const privateKey = privateKeyFromSeed(seed)
  const publicKey = publicKeyHexOf(privateKey)
  return {
    algorithm: 'ed25519',
    publicKey,
    canSign: true,
    sign(payload: string): string {
      return ed25519Sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('hex')
    },
    verify(payload: string, signature: string): boolean {
      return verifyWithPublicKey(payload, signature, publicKey)
    }
  }
}

/**
 * A public-key-only verifier — what an auditor or a second machine holds.
 * It can verify every signed line and refuses, loudly, to sign anything.
 */
export function auditVerifierFromPublicKey(publicKey: string): AuditIdentity {
  const normalized = (publicKey ?? '').toLowerCase()
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new Error('an Ed25519 audit public key is hex-encoded SPKI')
  }
  /* Fail fast on an unusable key rather than at the first verify() call. */
  createPublicKey({ key: Buffer.from(normalized, 'hex'), format: 'der', type: 'spki' })
  return {
    algorithm: 'ed25519',
    publicKey: normalized,
    canSign: false,
    sign(): string {
      throw new Error(
        'This audit identity holds only the public key, so it cannot sign. ' +
          'Load the sealed signing key from the profile that produced the evidence.'
      )
    },
    verify(payload: string, signature: string): boolean {
      return verifyWithPublicKey(payload, signature, normalized)
    }
  }
}

/** A throwaway signing identity for tests — never persisted, never production. */
export function createTestAuditIdentity(): AuditIdentity {
  const { privateKey } = generateKeyPairSync('ed25519')
  const publicKey = Buffer.from(
    createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer
  ).toString('hex')
  return {
    algorithm: 'ed25519',
    publicKey,
    canSign: true,
    sign(payload: string): string {
      return ed25519Sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('hex')
    },
    verify(payload: string, signature: string): boolean {
      return verifyWithPublicKey(payload, signature, publicKey)
    }
  }
}

/** A deterministic signing identity from a fixed passphrase — reproducible fixtures. */
export function testAuditIdentityFromPassphrase(passphrase: string): AuditIdentity {
  return auditIdentityFromSeed(createHash('sha256').update(passphrase, 'utf8').digest())
}

/** A fresh random seed for a newly minted production key. */
export function newAuditSeed(): Buffer {
  return randomBytes(32)
}
