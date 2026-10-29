import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildAuditChain, verifyAuditChain, verifyAuditPayload } from './chain'
import { auditVerifierFromPublicKey, testAuditIdentityFromPassphrase } from './identity'
import { RuntimeAuditLedger, verifyRuntimeLedgerLines } from './runtimeLedger'
import { RuntimeAuditService } from './runtimeService'
import type { AuditEntry } from '@shared/audit'

/* Deterministic fixture identities — these tests never touch the keychain. */
const IDENTITY = testAuditIdentityFromPassphrase('runtime-ledger-test-key')
const OTHER_IDENTITY = testAuditIdentityFromPassphrase('other-key')

let directory = ''
let file = ''

function splitNonEmpty(text: string): string[] {
  return text.split('\n').filter((line) => line.trim().length > 0)
}

function entry(action: string): AuditEntry {
  return {
    kind: 'runtime',
    ts: '2026-10-24T10:00:00.000Z',
    data: { actor: 'captain', actorId: 'Captain', action, outcome: 'ok' }
  }
}

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'selfimpulse-runtime-audit-'))
  file = join(directory, 'runtime.jsonl')
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('persistent runtime audit ledger', () => {
  it('appends signed entries and converts them to a verifiable export', async () => {
    const ledger = new RuntimeAuditLedger(file, IDENTITY)
    await ledger.append(entry('policy.check'))
    await ledger.append(entry('tool.completed'))
    expect(await ledger.verifyFromDisk()).toMatchObject({ ok: true, entries: 2 })
    const exported = buildAuditChain(await ledger.entries(), IDENTITY)
    expect(verifyAuditChain(exported, IDENTITY)).toEqual({ ok: true, entries: 2 })
  })

  it('detects edits and refuses to extend the contradicted chain', async () => {
    const ledger = new RuntimeAuditLedger(file, IDENTITY)
    await ledger.append(entry('policy.check'))
    const raw = await fs.readFile(file, 'utf8')
    await fs.writeFile(file, raw.replace('policy.check', 'policy.rewritten'), 'utf8')
    const reopened = new RuntimeAuditLedger(file, IDENTITY)
    expect(await reopened.verifyFromDisk()).toMatchObject({ ok: false })
    await expect(reopened.append(entry('tool.completed'))).rejects.toThrow(/Refusing to append/)
  })

  it('detects suffix truncation against the signed head anchor', async () => {
    const ledger = new RuntimeAuditLedger(file, IDENTITY)
    await ledger.append(entry('one'))
    await ledger.append(entry('two'))
    /* The anchor is written on the first line of a segment and then every
     * ANCHOR_INTERVAL appends; flush() is how a caller pins it now. */
    await ledger.flush()
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n')
    await fs.writeFile(file, `${lines[0]}\n`, 'utf8')
    const report = await new RuntimeAuditLedger(file, IDENTITY).verifyFromDisk()
    expect(report.ok).toBe(false)
    expect(report.reason).toContain('truncated')
  })

  it('recovers an authentic signed line fsynced before its anchor', async () => {
    const ledger = new RuntimeAuditLedger(file, IDENTITY)
    await ledger.append(entry('one'))
    const firstAnchor = await fs.readFile(`${file}.head.json`, 'utf8')
    await ledger.append(entry('two'))
    await fs.writeFile(`${file}.head.json`, firstAnchor, 'utf8')
    expect(await new RuntimeAuditLedger(file, IDENTITY).verifyFromDisk()).toMatchObject({
      ok: true,
      entries: 2
    })
  })

  it('rejects a ledger rebuilt under another key', async () => {
    await new RuntimeAuditLedger(file, IDENTITY).append(entry('one'))
    const other = new RuntimeAuditLedger(file, OTHER_IDENTITY)
    expect(await other.verifyFromDisk()).toMatchObject({ ok: false })
  })

  it('verifies every line with the public key alone, and cannot be signed with it', async () => {
    /* The point of going asymmetric: an auditor or a second machine proves the
     * file intact and genuinely signed while holding no secret at all — and
     * still cannot plant a line. */
    const ledger = new RuntimeAuditLedger(file, IDENTITY)
    await ledger.append(entry('one'))
    await ledger.append(entry('two'))

    const auditor = auditVerifierFromPublicKey(IDENTITY.publicKey)
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    for (const [index, line] of lines.entries()) {
      const { sig, ...unsigned } = JSON.parse(line) as Record<string, unknown>
      expect(verifyAuditPayload(unsigned, sig, auditor)).toBe(true)
      expect(verifyRuntimeLedgerLines(lines.slice(0, index + 1), auditor).report.ok).toBe(true)
    }
    expect(await new RuntimeAuditLedger(file, auditor).verifyFromDisk()).toMatchObject({
      ok: true,
      entries: 2,
      publicKey: IDENTITY.publicKey
    })
    await expect(new RuntimeAuditLedger(file, auditor).append(entry('planted'))).rejects.toThrow(
      /cannot sign/
    )
    /* A different key's verifier rejects the same file. */
    expect(
      (await new RuntimeAuditLedger(file, OTHER_IDENTITY).verifyFromDisk()).ok
    ).toBe(false)
  })

  it('rotates a full segment to runtime.jsonl.<n> and chains the next one', async () => {
    const ledger = new RuntimeAuditLedger(file, IDENTITY, { maxLines: 3, anchorInterval: 3 })
    for (const action of ['a', 'b', 'c', 'd']) await ledger.append(entry(action))

    const archived = await fs.readFile(`${file}.1`, 'utf8')
    const archivedLines = splitNonEmpty(archived)
    expect(archivedLines).toHaveLength(3)
    expect(verifyRuntimeLedgerLines(archivedLines, IDENTITY).report).toMatchObject({ ok: true })
    /* The archive keeps its own signed pin after the live anchor moves on. */
    const archiveAnchor = JSON.parse((await fs.readFile(`${file}.1.head.json`, 'utf8')).trim()) as {
      entries: number
      head: string
      sig: string
    }
    expect(archiveAnchor.entries).toBe(3)
    expect(verifyRuntimeLedgerLines(archivedLines, IDENTITY).head).toBe(archiveAnchor.head)

    const active = splitNonEmpty(await fs.readFile(file, 'utf8'))
    expect(active).toHaveLength(1)
    const report = await new RuntimeAuditLedger(file, IDENTITY, { maxLines: 3, anchorInterval: 3 })
      .verifyFromDisk()
    expect(report).toMatchObject({ ok: true, entries: 1 })
    /* And the fresh segment remembers the head it follows. */
    const anchor = JSON.parse((await fs.readFile(`${file}.head.json`, 'utf8')).trim()) as {
      segment: number
      previousHead: string
    }
    expect(anchor.segment).toBe(2)
    expect(anchor.previousHead).toBe(archiveAnchor.head)
  })

  it('writes the signed anchor every anchorInterval appends', async () => {
    const ledger = new RuntimeAuditLedger(file, IDENTITY, { anchorInterval: 4 })
    const pinned: number[] = []
    for (let index = 1; index <= 9; index += 1) {
      await ledger.append(entry(`e${index}`))
      const anchor = JSON.parse((await fs.readFile(`${file}.head.json`, 'utf8')).trim()) as {
        entries: number
      }
      pinned.push(anchor.entries)
    }
    /* Pinned at 1 (segment start), then 4 and 8 — never on every single write. */
    expect(pinned).toEqual([1, 1, 1, 4, 4, 4, 4, 8, 8])
    expect((await ledger.verifyFromDisk()).entries).toBe(9)
  })
})

describe('runtime audit service', () => {
  it('scrubs secrets and supports filtered event queries', async () => {
    let tick = 0
    const service = new RuntimeAuditService({
      file,
      loadIdentity: async () => IDENTITY,
      now: () => `2026-10-24T10:00:0${tick++}.000Z`
    })
    expect(
      await service.record({
        actor: 'captain',
        actorId: 'Captain',
        taskId: 'task-1',
        role: 'researcher',
        action: 'policy.check',
        outcome: 'denied',
        target: 'write_file',
        detail: 'Role denied write; the header carried sk-abcdefghijklmnopqrstuvwx'
      })
    ).toBe(true)
    await service.record({
      actor: 'crew',
      actorId: 'crew-1',
      taskId: 'task-2',
      action: 'dlp.model',
      outcome: 'redacted',
      metadata: { categories: ['api-key'] }
    })
    expect(await service.events({ taskId: 'task-1' })).toHaveLength(1)
    expect(await service.events({ outcome: 'redacted' })).toHaveLength(1)
    expect(await service.events({ query: 'write_file' })).toHaveLength(1)
    const entries = await service.entries()
    /* The repo's audit scrubber (src/main/selfimpulse/security/auditScrub.ts)
     * redacts credential SHAPES and credential-named members while leaving
     * ordinary prose alone — that is its documented contract. */
    expect(JSON.stringify(entries)).not.toContain('sk-abcdefghijklmnopqrstuvwx')
    expect(JSON.stringify(entries)).toContain('[redacted]')
    expect(await service.status()).toMatchObject({ ok: true, entries: 2 })
  })

  it('bounds evidence and serializes circular metadata safely', async () => {
    const service = new RuntimeAuditService({ file, loadIdentity: async () => IDENTITY })
    const circular: Record<string, unknown> = { secret: 'short' }
    circular.self = circular
    expect(
      await service.record({
        actor: 'system',
        actorId: 'test',
        action: 'tool.completed',
        outcome: 'ok',
        detail: 'x'.repeat(5_000),
        metadata: { circular }
      })
    ).toBe(true)
    const entries = await service.entries()
    const serialized = JSON.stringify(entries)
    expect(serialized).toContain('[redacted]')
    expect(serialized).toContain('[truncated]')
    expect(serialized).not.toContain('short')
    expect(serialized).not.toContain('x'.repeat(4_100))
  })
})
