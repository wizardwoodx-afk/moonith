/**
 * Build guard for the bundled execution engine.
 *
 * The engine is a separate third-party MIT binary that ships inside
 * resources/engine. Two rules have to hold for every package we produce:
 *
 *   1. It reaches the user byte for byte as its authors built it. A modified
 *      engine is a modified dependency, whatever the reason. The upstream
 *      authors' own Authenticode signature is part of that binary, and it
 *      stays with it — shipping it untouched is the whole point of rule 1.
 *   2. It never carries SelfImpulse's code-signing certificate. The
 *      certificate says "SelfImpulse published this"; saying that about
 *      someone else's executable is a false claim.
 *
 * electron-builder signs every .exe it copies into the package, so the second
 * rule needs a check that runs after packing rather than a setting we trust.
 * That check has to name our certificate rather than any certificate: the
 * engine arrives already signed by its own authors, and rejecting that would
 * reject a correct package.
 */
import { createHash, X509Certificate } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Our own certificate. Anything carrying this identity in the engine is ours. */
const SELF_IMPUlSE_SUBJECT = /selfimpulse/i

/**
 * The PE certificate table: the directory entry that points at the
 * Authenticode signature.
 */
export function certificateTable(buffer) {
  if (buffer.length < 0x40) return null
  const peOffset = buffer.readUInt32LE(0x3c)
  if (buffer.readUInt32LE(peOffset) !== 0x00004550) return null
  const optionalHeader = peOffset + 24
  const magic = buffer.readUInt16LE(optionalHeader)
  const directories = magic === 0x20b ? optionalHeader + 112 : optionalHeader + 96
  const entry = directories + 4 * 8
  if (entry + 8 > buffer.length) return null
  const offset = buffer.readUInt32LE(entry)
  const size = buffer.readUInt32LE(entry + 4)
  if (!size || offset + size > buffer.length) return null
  return { offset, size }
}

/**
 * The signatures inside the certificate table, as PKCS#7 blobs. A table holds
 * one or more WIN_CERTIFICATE structures, each an 8-byte header followed by
 * the signed data.
 */
function signatureBlobs(buffer) {
  const table = certificateTable(buffer)
  if (!table) return []
  const blobs = []
  const end = table.offset + table.size
  let cursor = table.offset
  while (cursor + 8 <= end) {
    const length = buffer.readUInt32LE(cursor)
    if (length < 8 || cursor + length > end) break
    blobs.push(buffer.subarray(cursor + 8, cursor + length))
    cursor += Math.ceil(length / 8) * 8
  }
  return blobs
}

/**
 * The subjects of every certificate embedded in the signature.
 *
 * The signed data is a PKCS#7 SignedData blob, which carries its certificates
 * as DER inside it. A DER certificate starts with a SEQUENCE header, so the
 * blobs are scanned for that header and each candidate is parsed; anything
 * that does not parse is not a certificate and is skipped.
 */
export function embeddedCertificateSubjects(buffer) {
  const subjects = []
  for (const blob of signatureBlobs(buffer)) {
    for (let i = 0; i + 4 < blob.length; i++) {
      if (blob[i] !== 0x30) continue
      let headerLength = 4
      if (blob[i + 1] === 0x82) {
        headerLength = 4
      } else if (blob[i + 1] === 0x81) {
        headerLength = 3
      } else {
        continue
      }
      const length = blob.readUInt16BE(i + headerLength - 2)
      const end = i + headerLength + length
      if (length <= 0 || end > blob.length) continue
      try {
        const cert = new X509Certificate(blob.subarray(i, end))
        subjects.push(cert.subject)
      } catch {
        /* not a certificate */
      }
    }
  }
  return subjects
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Whether the binary carries a certificate issued to SelfImpulse. The engine
 * arrives signed by its own authors; that signature is part of the upstream
 * build and stays. Only our own name on it would be a false claim.
 */
export function carriesSelfImpulseCertificate(buffer) {
  return embeddedCertificateSubjects(buffer).filter((subject) =>
    SELF_IMPUlSE_SUBJECT.test(subject)
  )
}

function listFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...listFiles(full))
    else found.push(full)
  }
  return found
}

export async function afterPack(context) {
  const packaged = join(context.appOutDir, 'resources', 'engine')
  if (!existsSync(packaged)) {
    throw new Error(`The execution engine is missing from the package: ${packaged}`)
  }
  const source = join(context.packager.info.projectDir, 'resources', 'engine')
  const problems = []

  for (const file of listFiles(packaged)) {
    const name = relative(packaged, file)
    const original = join(source, name)
    if (!existsSync(original)) {
      problems.push(`${name} is not part of the vendored engine`)
      continue
    }
    const bytes = readFileSync(file)
    if (sha256(bytes) !== sha256(readFileSync(original))) {
      problems.push(`${name} was modified during packaging`)
      continue
    }
    if (!name.endsWith('.exe')) continue
    const ours = carriesSelfImpulseCertificate(bytes)
    if (ours.length > 0) {
      problems.push(`${name} carries SelfImpulse's certificate (${ours.join('; ')})`)
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `The execution engine must ship untouched and free of our certificate.\n  ${problems.join('\n  ')}`
    )
  }
  console.log('  • engine verified unmodified and free of our certificate')
}

export default afterPack
