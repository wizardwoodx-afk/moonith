import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deriveSealKey, buildAuditChain, verifyAuditChain } from './chain'
import { RuntimeAuditLedger } from './runtimeLedger'
import { RuntimeAuditService } from './runtimeService'
import type { AuditEntry } from '@shared/audit'

const KEY = deriveSealKey('runtime-ledger-test-key')
let directory = ''
let file = ''

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
    const ledger = new RuntimeAuditLedger(file, KEY)
    await ledger.append(entry('policy.check'))
    await ledger.append(entry('tool.completed'))
    expect(await ledger.verifyFromDisk()).toMatchObject({ ok: true, entries: 2 })
    const exported = buildAuditChain(await ledger.entries(), KEY)
    expect(verifyAuditChain(exported, KEY)).toEqual({ ok: true, entries: 2 })
  })

  it('detects edits and refuses to extend the contradicted chain', async () => {
    const ledger = new RuntimeAuditLedger(file, KEY)
    await ledger.append(entry('policy.check'))
    const raw = await fs.readFile(file, 'utf8')
    await fs.writeFile(file, raw.replace('policy.check', 'policy.rewritten'), 'utf8')
    const reopened = new RuntimeAuditLedger(file, KEY)
    expect(await reopened.verifyFromDisk()).toMatchObject({ ok: false })
    await expect(reopened.append(entry('tool.completed'))).rejects.toThrow(/Refusing to append/)
  })

  it('detects suffix truncation against the signed head anchor', async () => {
    const ledger = new RuntimeAuditLedger(file, KEY)
    await ledger.append(entry('one'))
    await ledger.append(entry('two'))
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n')
    await fs.writeFile(file, `${lines[0]}\n`, 'utf8')
    const report = await new RuntimeAuditLedger(file, KEY).verifyFromDisk()
    expect(report.ok).toBe(false)
    expect(report.reason).toContain('truncated')
  })

  it('recovers an authentic signed line fsynced before its anchor', async () => {
    const ledger = new RuntimeAuditLedger(file, KEY)
    await ledger.append(entry('one'))
    const firstAnchor = await fs.readFile(`${file}.head.json`, 'utf8')
    await ledger.append(entry('two'))
    await fs.writeFile(`${file}.head.json`, firstAnchor, 'utf8')
    expect(await new RuntimeAuditLedger(file, KEY).verifyFromDisk()).toMatchObject({
      ok: true,
      entries: 2
    })
  })

  it('rejects a ledger rebuilt under another key', async () => {
    await new RuntimeAuditLedger(file, KEY).append(entry('one'))
    const other = new RuntimeAuditLedger(file, deriveSealKey('other-key'))
    expect(await other.verifyFromDisk()).toMatchObject({ ok: false })
  })
})

describe('runtime audit service', () => {
  it('scrubs metadata and supports filtered event queries', async () => {
    let tick = 0
    const service = new RuntimeAuditService({
      file,
      loadKey: async () => KEY,
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
        detail: 'Role denied write for person@example.com'
      })
    ).toBe(true)
    await service.record({
      actor: 'crew',
      actorId: 'crew-1',
      taskId: 'task-2',
      action: 'dlp.model',
      outcome: 'redacted',
      metadata: { categories: ['email'] }
    })
    expect(await service.events({ taskId: 'task-1' })).toHaveLength(1)
    expect(await service.events({ outcome: 'redacted' })).toHaveLength(1)
    expect(await service.events({ query: 'write_file' })).toHaveLength(1)
    const entries = await service.entries()
    expect(JSON.stringify(entries)).not.toContain('person@example.com')
    expect(JSON.stringify(entries)).toContain('[redacted:email]')
    expect(await service.status()).toMatchObject({ ok: true, entries: 2 })
  })

  it('bounds evidence and serializes circular metadata safely', async () => {
    const service = new RuntimeAuditService({ file, loadKey: async () => KEY })
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
    expect(serialized).toContain('[circular]')
    expect(serialized).toContain('[truncated]')
    expect(serialized).toContain('[redacted:secret]')
    expect(serialized).not.toContain('x'.repeat(4_100))
  })
})
