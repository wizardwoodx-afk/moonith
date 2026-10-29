import { describe, expect, it } from 'vitest'
import { buildAuditChain, verifyAuditChain } from './chain'
import { auditVerifierFromPublicKey, testAuditIdentityFromPassphrase } from './identity'
import type { AuditEntry } from '@shared/audit'

/* Fixed fixtures — these tests never touch the real keychain, and a fixed
 * timestamp set keeps the expected bytes reproducible. */
const IDENTITY = testAuditIdentityFromPassphrase('unit-test-secret, never the keychain')
const OTHER_IDENTITY = testAuditIdentityFromPassphrase('a different machine’s secret')

function fixtureEntries(): AuditEntry[] {
  return [
    {
      kind: 'receipt',
      ts: '2026-01-01T10:00:00.000Z',
      data: { id: 'r1', mission: 'q3 brief', signed: true }
    },
    {
      kind: 'approval',
      ts: '2026-01-01T10:05:00.000Z',
      data: { id: 'a1', action: 'shell', settledBy: 'human', status: 'approved' }
    },
    {
      kind: 'trace',
      ts: '2026-01-01T10:06:00.000Z',
      data: { messageId: 'm1', role: 'selfimpulse', step: { kind: 'tool', tool: 'read_file' } }
    },
    {
      kind: 'trace',
      ts: '2026-01-01T10:07:00.000Z',
      data: { messageId: 'm1', role: 'selfimpulse', step: { kind: 'plan', steps: ['draft'] } }
    }
  ]
}

function exportedLines(): string[] {
  return buildAuditChain(fixtureEntries(), IDENTITY)
}

describe('buildAuditChain', () => {
  it('chains each entry to the previous hash under a signed trailer', () => {
    const lines = exportedLines()
    const parsed = lines.map((line) => JSON.parse(line))
    expect(parsed).toHaveLength(5) // four entries + the trailer

    expect(parsed[0].prev).toBe('0'.repeat(64))
    for (let i = 1; i < 4; i += 1) {
      expect(parsed[i].prev).toBe(parsed[i - 1].hash)
    }
    expect(parsed[4].trailer).toBe(true)
    expect(parsed[4].entries).toBe(4)
    expect(parsed[4].head).toBe(parsed[3].hash)
    expect(parsed[4].sig).toMatch(/^[0-9a-f]{128}$/)
  })

  it('is deterministic: the same entries produce identical bytes', () => {
    expect(buildAuditChain(fixtureEntries(), IDENTITY)).toEqual(exportedLines())
  })

  it('exports an empty record as a trailer-only file', () => {
    const lines = buildAuditChain([], IDENTITY)
    expect(lines).toHaveLength(1)
    expect(verifyAuditChain(lines, IDENTITY)).toEqual({ ok: true, entries: 0 })
  })
})

describe('verifyAuditChain', () => {
  it('verifies an untampered export', () => {
    expect(verifyAuditChain(exportedLines(), IDENTITY)).toEqual({ ok: true, entries: 4 })
  })

  it('detects a modified line at that line', () => {
    const lines = exportedLines()
    const tampered = JSON.parse(lines[1]) as Record<string, unknown>
    ;(tampered.entry as Record<string, unknown>).data = { id: 'r1', mission: 'rewritten', signed: true }
    lines[1] = JSON.stringify(tampered)

    const report = verifyAuditChain(lines, IDENTITY)
    expect(report.ok).toBe(false)
    expect(report.line).toBe(2)
    expect(report.reason).toContain('modified')
  })

  it('detects a deleted line at the break it causes', () => {
    const lines = exportedLines()
    lines.splice(1, 1) // drop the second entry

    const report = verifyAuditChain(lines, IDENTITY)
    expect(report.ok).toBe(false)
    expect(report.line).toBe(2) // the following entry now carries a stale prev
  })

  it('detects a reordered pair', () => {
    const lines = exportedLines()
    const first = lines[0]
    lines[0] = lines[1]
    lines[1] = first

    const report = verifyAuditChain(lines, IDENTITY)
    expect(report.ok).toBe(false)
    expect(report.line).toBe(1)
  })

  it('rejects a file truncated down to the trailer', () => {
    const lines = exportedLines()
    lines.splice(3, 1) // drop the final entry, keep the trailer

    const report = verifyAuditChain(lines, IDENTITY)
    expect(report.ok).toBe(false)
    expect(report.reason).toContain('truncated')
  })

  it('rejects a file truncated past the trailer', () => {
    const report = verifyAuditChain(exportedLines().slice(0, -1), IDENTITY)
    expect(report.ok).toBe(false)
    expect(report.reason).toContain('trailer')
  })

  it('rejects an empty file', () => {
    const report = verifyAuditChain([], IDENTITY)
    expect(report.ok).toBe(false)
  })

  it('rejects a file whose chain was rebuilt under a different key', () => {
    /* The hashes themselves are keyless, so a forged chain verifies up to
     * the signature — the Ed25519 signature is what makes the export
     * unforgeable without the sealed seed. */
    const forged = buildAuditChain(fixtureEntries(), OTHER_IDENTITY)
    const report = verifyAuditChain(forged, IDENTITY)
    expect(report.ok).toBe(false)
    expect(report.line).toBeNull()
    expect(report.reason).toContain('signature')
  })

  it('verifies with the public key alone — no signing secret required', () => {
    /* The whole point of going asymmetric: an auditor holding nothing but the
     * published public key can prove the file is intact and genuinely signed,
     * and still cannot forge a single line. */
    const verifier = auditVerifierFromPublicKey(IDENTITY.publicKey)
    const lines = exportedLines()
    expect(verifyAuditChain(lines, verifier)).toEqual({ ok: true, entries: 4 })
    expect(verifyAuditChain(lines, auditVerifierFromPublicKey(OTHER_IDENTITY.publicKey)).ok).toBe(
      false
    )
    expect(() => verifier.sign('anything')).toThrow(/cannot sign/)
  })

  it('detects a trailer whose entry count was edited under a valid-looking chain', () => {
    const lines = exportedLines()
    const trailer = JSON.parse(lines[4]) as Record<string, unknown>
    lines[4] = JSON.stringify({ ...trailer, entries: 3 })
    const report = verifyAuditChain(lines, IDENTITY)
    expect(report.ok).toBe(false)
    expect(report.reason).toContain('added after the export was signed')
  })
})
