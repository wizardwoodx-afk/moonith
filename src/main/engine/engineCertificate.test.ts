import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  carriesSelfImpulseCertificate,
  certificateTable,
  embeddedCertificateSubjects
} from '../../../scripts/verify-engine-unsigned.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): Buffer => readFileSync(join(here, 'fixtures', name))

/**
 * A minimal PE with one certificate table entry holding the given DER. The
 * guard reads the table through the PE data directory, so the test has to
 * build a real one rather than a stub.
 */
function syntheticPE(der: Buffer): Buffer {
  const peOffset = 0x80
  const certificateOffset = 0x400
  const buffer = Buffer.alloc(certificateOffset + 8 + der.length)

  buffer.write('MZ', 0, 'ascii')
  buffer.writeUInt32LE(peOffset, 0x3c)
  buffer.writeUInt32LE(0x00004550, peOffset)
  buffer.writeUInt16LE(0x8664, peOffset + 4)
  buffer.writeUInt16LE(0xf0, peOffset + 16)

  const optional = peOffset + 24
  buffer.writeUInt16LE(0x20b, optional)
  const directory = optional + 112
  buffer.writeUInt32LE(certificateOffset, directory + 4 * 8)
  buffer.writeUInt32LE(der.length + 8, directory + 4 * 8 + 4)

  buffer.writeUInt32LE(der.length + 8, certificateOffset)
  buffer.writeUInt16LE(0x0200, certificateOffset + 4)
  buffer.writeUInt16LE(0x0002, certificateOffset + 6)
  der.copy(buffer, certificateOffset + 8)
  return buffer
}

describe('the engine packaging guard', () => {
  it('reads the certificate table out of a PE', () => {
    const pe = syntheticPE(fixture('upstream-engine-cert.der'))
    expect(certificateTable(pe)).not.toBeNull()
    expect(certificateTable(Buffer.alloc(16))).toBeNull()
  })

  it('finds the certificate subjects inside the signature', () => {
    const pe = syntheticPE(fixture('upstream-engine-cert.der'))
    const subjects = embeddedCertificateSubjects(pe)
    expect(subjects.length).toBeGreaterThan(0)
    expect(subjects.join(' ')).toMatch(/Anomaly/i)
  })

  it('lets the upstream authors signature through', () => {
    const pe = syntheticPE(fixture('upstream-engine-cert.der'))
    expect(carriesSelfImpulseCertificate(pe)).toEqual([])
  })

  it('catches our own certificate on the engine', () => {
    const pe = syntheticPE(fixture('selfimpulse-cert.der'))
    const found = carriesSelfImpulseCertificate(pe)
    expect(found.length).toBeGreaterThan(0)
    expect(found.join(' ')).toMatch(/SelfImpulse/i)
  })
})
