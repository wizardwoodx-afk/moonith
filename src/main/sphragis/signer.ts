/**
 * The receipt signer — Ed25519, with the private key held the way this app
 * holds every secret: sealed with the OS keychain (Electron safeStorage),
 * persisted under the app profile, and NEVER crossing into the renderer.
 *
 * The signing key is generated once, on first use. The renderer receives
 * only verification RESULTS and the public key id; it never receives key
 * material, and the model never sees a signing operation at all.
 *
 * When the OS keychain is unavailable the signer is simply absent: receipts
 * are still minted, chained and tamper-evident, and they SAY they are
 * unsigned (see UNSIGNED_NOTE). An unsigned receipt is an honest artefact;
 * a fake signature would not be.
 */
import { safeStorage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  randomBytes,
  type KeyObject
} from 'node:crypto'

export interface ReceiptSigner {
  readonly keyId: string
  readonly publicKeyHex: string
  /** Sign a 32-byte digest (given as hex). Returns a hex signature. */
  signDigest(digestHex: string): string
}

export function keyIdFor(publicKeyHex: string): string {
  return createHash('sha256').update(publicKeyHex, 'utf8').digest('hex').slice(0, 16)
}

/** PKCS#8 DER prefix for a 32-byte Ed25519 seed. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

function privateKeyFromSeed(seed: Buffer): KeyObject {
  if (seed.length !== 32) throw new Error('an Ed25519 seed is 32 bytes')
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

/** A signer built from raw key material. Used by probes and by hosts with no
 *  keychain; the production path is KeychainReceiptSigner. */
export function signerFromSeed(seed: Buffer): ReceiptSigner {
  const privateKey = privateKeyFromSeed(seed)
  const publicKeyHex = publicKeyHexOf(privateKey)
  return {
    keyId: keyIdFor(publicKeyHex),
    publicKeyHex,
    signDigest(digestHex: string): string {
      return edSign(null, Buffer.from(digestHex, 'hex'), privateKey).toString('hex')
    }
  }
}

/** A fresh random signer — probes, and one-shot verification fixtures. */
export function ephemeralSigner(): ReceiptSigner {
  return signerFromSeed(randomBytes(32))
}

/** Verify a signature over a digest with a hex-encoded SPKI public key. */
export function verifyDigestSignature(digestHex: string, signatureHex: string, publicKeyHex: string): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyHex, 'hex'),
      format: 'der',
      type: 'spki'
    })
    return edVerify(null, Buffer.from(digestHex, 'hex'), publicKey, Buffer.from(signatureHex, 'hex'))
  } catch {
    return false
  }
}

/**
 * The production signer. The seed is generated on first use and sealed with
 * safeStorage; loading it back requires the same OS keychain. If the
 * keychain is unavailable, `loadKeychainSigner` returns null and the caller
 * proceeds unsigned — see the module header.
 */
export function loadKeychainSigner(profileRoot: string): ReceiptSigner | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  const file = `${profileRoot}/sphragis/signing-key.json`
  try {
    let sealed: string | null = null
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { secret?: unknown }
      if (typeof parsed.secret === 'string' && parsed.secret.startsWith('enc:')) sealed = parsed.secret
    } catch {
      /* no key yet */
    }
    let seed: Buffer
    if (sealed) {
      seed = Buffer.from(safeStorage.decryptString(Buffer.from(sealed.slice(4), 'base64')), 'hex')
    } else {
      seed = randomBytes(32)
      mkdirSync(`${profileRoot}/sphragis`, { recursive: true })
      writeFileSync(
        file,
        JSON.stringify({
          secret: `enc:${safeStorage.encryptString(seed.toString('hex')).toString('base64')}`
        }),
        'utf8'
      )
    }
    return signerFromSeed(seed)
  } catch {
    return null
  }
}
