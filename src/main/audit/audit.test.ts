import { describe, expect, it } from 'vitest'
import { buildAuditChain, deriveSealKey, verifyAuditChain } from './chain'
import type { AuditEntry } from '@shared/audit'

/* A fixed fixture secret — these tests never touch the real keychain, and a
 * fixed timestamp set keeps the expected bytes reproducible. */
const SEAL_KEY = deriveSealKey('unit-test-secret, never the keychain')
const OTHER_KEY = deriveSealKey('a different machine’s secret')

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
  return buildAuditChain(fixtureEntries(), SEAL_KEY)
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
    expect(parsed[4].sig).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic: the same entries produce identical bytes', () => {
    expect(buildAuditChain(fixtureEntries(), SEAL_KEY)).toEqual(exportedLines())
  })

  it('exports an empty record as a trailer-only file', () => {
    const lines = buildAuditChain([], SEAL_KEY)
    expect(lines).toHaveLength(1)
    expect(verifyAuditChain(lines, SEAL_KEY)).toEqual({ ok: true, entries: 0 })
  })
})

describe('verifyAuditChain', () => {
  it('verifies an untampered export', () => {
    expect(verifyAuditChain(exportedLines(), SEAL_KEY)).toEqual({ ok: true, entries: 4 })
  })

  it('detects a modified line at that line', () => {
    const lines = exportedLines()
    const tampered = JSON.parse(lines[1]) as Record<string, unknown>
    ;(tampered.entry as Record<string, unknown>).data = { id: 'r1', mission: 'rewritten', signed: true }
    lines[1] = JSON.stringify(tampered)

    const report = verifyAuditChain(lines, SEAL_KEY)
    expect(report.ok).toBe(false)
    expect(report.line).toBe(2)
    expect(report.reason).toContain('modified')
  })

  it('detects a deleted line at the break it causes', () => {
    const lines = exportedLines()
    lines.splice(1, 1) // drop the second entry

    const report = verifyAuditChain(lines, SEAL_KEY)
    expect(report.ok).toBe(false)
    expect(report.line).toBe(2) // the following entry now carries a stale prev
  })

  it('detects a reordered pair', () => {
    const lines = exportedLines()
    const first = lines[0]
    lines[0] = lines[1]
    lines[1] = first

    const report = verifyAuditChain(lines, SEAL_KEY)
    expect(report.ok).toBe(false)
    expect(report.line).toBe(1)
  })

  it('rejects a file truncated down to the trailer', () => {
    const lines = exportedLines()
    lines.splice(3, 1) // drop the final entry, keep the trailer

    const report = verifyAuditChain(lines, SEAL_KEY)
    expect(report.ok).toBe(false)
    expect(report.reason).toContain('truncated')
  })

  it('rejects a file truncated past the trailer', () => {
    const report = verifyAuditChain(exportedLines().slice(0, -1), SEAL_KEY)
    expect(report.ok).toBe(false)
    expect(report.reason).toContain('trailer')
  })

  it('rejects an empty file', () => {
    const report = verifyAuditChain([], SEAL_KEY)
    expect(report.ok).toBe(false)
  })

  it('rejects a file whose chain was rebuilt under a different key', () => {
    /* The hashes themselves are keyless, so a forged chain verifies up to
     * the seal — the HMAC is what makes the export unforgeable. */
    const forged = buildAuditChain(fixtureEntries(), OTHER_KEY)
    const report = verifyAuditChain(forged, SEAL_KEY)
    expect(report.ok).toBe(false)
    expect(report.line).toBeNull()
    expect(report.reason).toContain('signature')
  })
})
